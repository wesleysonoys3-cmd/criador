/* =========================================================
 * youtube/service.js — Orquestração da publicação (PARTE 8)
 * ---------------------------------------------------------
 * 8.1 Conectar canal (OAuth 2.0 oficial)
 * 8.2 Gerenciamento (estado, data, desconectar, reconectar)
 * 8.3 Publicação (agora/agendar/privado/não listado/público)
 * 8.4 Segurança (tokens criptografados, emergência, atividades)
 *
 * O único insumo externo é o Client ID/Secret do Google Cloud
 * (conta do próprio dono) definido em YT_CLIENT_ID / YT_CLIENT_SECRET.
 * Sem credenciais, o módulo informa isso de forma honesta — sem botão falso.
 * =======================================================*/
import path from 'node:path';
import state, { SCHEMA, normalizeOwner } from './state.js';
import { encryptJson, decryptJson, maskSecret, setKeyFile } from './crypto.js';
import { oauthConfig, isConfigured, makePkce, newState, buildAuthUrl, exchangeCode, ensureFresh, revokeToken } from './oauth.js';
import { fetchMyChannel, fetchVideosStats } from './client.js';
import { publish as publishOne, republishStatus, countToday, findDuplicate, dedupeKey, fileFingerprint, VISIBILITIES, PUB_STATUS, MAX_RETRY_ATTEMPTS } from './publisher.js';
import * as scheduler from './scheduler.js';
import { normalizeConfig, DEFAULT_CONFIG, shouldRun } from './scheduler.js';
import { validateSchedule, TIMEZONES, DEFAULT_TIMEZONE, isValidTimezone, utcToZonedParts } from './batch.js';
import { listProfiles } from '../autoclips/profiles.js';
import { list as listPlatformCatalog, byId as platformById, implementedIds } from './platforms.js';

const _log = (...a) => console.log('[YOUTUBE][service]', ...a);

let _initialized = false;
let _autoclipsSvc = null;
let _retryTimer = null;

function nowIso() { return new Date().toISOString(); }

export function init({ dataDir = null, autoclipsSvc = null } = {}) {
  if (dataDir) state.setDataDir(dataDir);
  setKeyFile(path.resolve(process.cwd(), 'youtube/data/.ytkey'));
  if (autoclipsSvc) _autoclipsSvc = autoclipsSvc;

  scheduler.init({
    getConfig: async () => getConfig(),
    getConnection: async () => state.connection,
    publishNext: (cfg) => autoPublishOnce(cfg),
  });

  /* Fila de tentativas (Etapa 6): reprocessa falhas transitórias vencidas. */
  if (!_retryTimer) {
    _retryTimer = setInterval(() => { retryTick().catch((e) => _log('retry erro: ' + String((e && e.message) || e))); }, 120000);
    if (_retryTimer.unref) _retryTimer.unref();
  }

  if (!_initialized) {
    _initialized = true;
    state.loadAll()
      .then(() => {
        // Limpa sessões OAuth pendentes muito antigas (>15 min).
        const now = Date.now();
        let changed = false;
        Object.keys(state.oauthSessions || {}).forEach((k) => {
          const s = state.oauthSessions[k];
          if (!s || !s.createdAt || (now - Date.parse(s.createdAt)) > 15 * 60 * 1000) { delete state.oauthSessions[k]; changed = true; }
        });
        if (changed) state.saveOauthSessions(state.oauthSessions).catch(() => {});
        _log('init: dataDir=' + state.dataDir + ' · configurado=' + isConfigured() + ' · conexão=' + (state.connection ? state.connection.status : 'nenhuma'));
      })
      .catch((e) => _log('loadAll erro: ' + String((e && e.message) || e)));
  }
  return { ok: true, dataDir: state.dataDir, configured: isConfigured(), connected: !!(state.connection && state.connection.status === 'conectado') };
}

/* ---------------- Configuração ---------------- */
export function getConfig() {
  return state.config ? normalizeConfig(state.config) : normalizeConfig(null);
}

export async function saveConfig(input) {
  const cfg = normalizeConfig(Object.assign({}, state.config || {}, input || {}));
  cfg.updatedAt = nowIso();
  await state.saveConfig(cfg);
  state.appendActivity({ type: 'config_atualizada', by: 'usuario' });
  return { ok: true, config: cfg };
}

export async function setEmergencyStop(on) {
  const cfg = getConfig();
  cfg.emergencyStop = !!on;
  cfg.updatedAt = nowIso();
  await state.saveConfig(cfg);
  state.appendActivity({ type: on ? 'emergencia_ativada' : 'emergencia_desativada', by: 'usuario' });
  return { ok: true, config: cfg };
}

/* ---------------- 8.1 / 8.2 Conexão ---------------- */
/* Rótulos legíveis das permissões concedidas (por plataforma). */
const SCOPE_LABELS = {
  'youtube.upload': 'Enviar vídeos',
  'youtube.readonly': 'Ler dados do canal',
  'https://www.googleapis.com/auth/youtube.upload': 'Enviar vídeos',
  'https://www.googleapis.com/auth/youtube.readonly': 'Ler dados do canal',
};
function permissionLabel(scope) {
  const s = String(scope || '');
  return SCOPE_LABELS[s] || s.split('/').pop() || s;
}

/* Identidade unificada da conta, independente da rede. */
function accountIdentity(acc) {
  if (acc && acc.account) return acc.account;
  const ch = (acc && acc.channel) || {};
  return { id: ch.id || null, name: ch.title || '', handle: ch.handle || '', avatar: ch.thumbnail || '' };
}

function publicAccount(acc) {
  if (!acc) return null;
  const id = accountIdentity(acc);
  return {
    id: acc.id,
    platform: acc.platform || 'youtube',
    platformLabel: (platformById(acc.platform || 'youtube') || {}).label || (acc.platform || 'youtube'),
    status: acc.status || 'desconhecido',
    primary: !!acc.primary,
    account: { id: id.id || null, name: id.name || '', handle: id.handle || '', avatar: id.avatar || '' },
    channel: acc.channel || null,
    scopes: acc.scopes || [],
    permissions: (acc.scopes || []).map(permissionLabel),
    authorizedAt: acc.authorizedAt || null,
    connectedAt: acc.connectedAt || null,
    lastRefreshAt: acc.lastRefreshAt || null,
    expiresAt: acc.expiresAt || null,
  };
}

function publicConnection() { return publicAccount(state.connection); }

export function status() {
  const cfg = getConfig();
  const ocfg = oauthConfig();
  const gate = shouldRun(cfg, state.connection, new Date());
  const accounts = state.allAccounts().map(publicAccount);
  return {
    ok: true,
    schema: SCHEMA,
    configured: ocfg.configured,
    clientIdMasked: ocfg.clientId ? maskSecret(ocfg.clientId) : '',
    redirectUri: ocfg.redirectUri,
    scopes: ['youtube.upload', 'youtube.readonly'],
    connected: !!(state.connection && state.connection.status === 'conectado'),
    connection: publicConnection(),
    accounts,
    accountsCount: accounts.length,
    implementedPlatforms: implementedIds(),
    config: cfg,
    autoGate: gate,
    todayPublished: countToday(state),
    publicationsCount: state.publications.size,
    profiles: listProfiles().map((p) => ({ key: p.key, label: p.label })),
    envHint: {
      needsClientId: !ocfg.clientId,
      needsClientSecret: !ocfg.clientSecret,
      vars: ['YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REDIRECT_URI (opcional)'],
    },
  };
}

/* ---------------- Catálogo de redes e contas (Etapa 5) ---------------- */
export function platforms() {
  const ocfg = oauthConfig();
  const items = listPlatformCatalog().map((p) => {
    const configured = p.oauthImplemented
      ? (p.id === 'youtube' ? ocfg.configured : false)
      : false;
    const connected = state.accountsFor(p.id).length;
    return Object.assign({}, p, {
      configured,
      canConnect: !!p.oauthImplemented,
      connectedCount: connected,
      blockedReason: !p.oauthImplemented
        ? ('Integração oficial com ' + p.label + ' não implementada: ' + p.requirement)
        : (configured ? null : 'Credenciais ausentes: defina ' + p.envVars.join(' e ') + '.'),
    });
  });
  return { ok: true, items, implemented: implementedIds() };
}

export function listAccounts() {
  return { ok: true, items: state.allAccounts().map(publicAccount) };
}

export async function setPrimaryAccount(id) {
  const acc = state.getAccount(id);
  if (!acc) return { ok: false, reason: 'Conta não encontrada.' };
  const done = await state.setPrimary(id);
  if (!done) return { ok: false, reason: 'Não foi possível definir a conta principal.' };
  state.appendActivity({ type: 'conta_primaria', id });
  return { ok: true, items: state.allAccounts().map(publicAccount) };
}

export async function authUrl(hostBase, platform) {
  const pid = String(platform || 'youtube').trim().toLowerCase();
  const plat = platformById(pid);
  if (!plat) return { ok: false, code: 'plataforma_desconhecida', reason: 'Plataforma não reconhecida: ' + pid };
  if (!plat.oauthImplemented) {
    return { ok: false, code: 'nao_implementado', reason: 'Integração oficial com ' + plat.label + ' ainda não implementada. ' + plat.requirement };
  }
  const cfg = oauthConfig();
  if (!cfg.configured) {
    return { ok: false, code: 'sem_credenciais', reason: 'Credenciais OAuth do Google não configuradas (YT_CLIENT_ID / YT_CLIENT_SECRET).' };
  }
  const redirectUri = hostBase ? (hostBase.replace(/\/$/, '') + '/api/youtube/oauth/callback') : cfg.redirectUri;
  const pkce = makePkce();
  const st = newState();
  state.oauthSessions[st] = { verifier: pkce.verifier, createdAt: nowIso(), redirectUri, platform: pid };
  await state.saveOauthSessions(state.oauthSessions);
  const url = buildAuthUrl({ clientId: cfg.clientId, redirectUri, state: st, codeChallenge: pkce.challenge });
  return { ok: true, url, platform: pid };
}

export async function handleCallback({ code, state: st, error }) {
  const cfg = oauthConfig();
  if (error) return { ok: false, reason: 'Autorização recusada pelo Google: ' + String(error) };
  if (!cfg.configured) return { ok: false, reason: 'Credenciais OAuth não configuradas.' };
  const sess = st && state.oauthSessions ? state.oauthSessions[st] : null;
  if (!sess) return { ok: false, reason: 'Sessão de autorização inválida ou expirada. Tente conectar novamente.' };
  delete state.oauthSessions[st];
  await state.saveOauthSessions(state.oauthSessions);

  const ex = await exchangeCode({ code, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: sess.redirectUri, codeVerifier: sess.verifier });
  if (!ex.ok) return { ok: false, reason: ex.reason };
  const tokens = ex.tokens;

  const ch = await fetchMyChannel(tokens.accessToken);
  if (!ch.ok) return { ok: false, reason: ch.reason || 'Não foi possível ler o canal conectado.' };

  const pid = sess.platform || 'youtube';
  const c = ch.channel;
  const conn = {
    schema: SCHEMA,
    id: pid + ':' + (c.id || Date.now().toString(36)),
    platform: pid,
    owner: 'local',
    status: 'conectado',
    channel: c,                                             // compatibilidade (canal do YouTube)
    account: {                                              // identidade unificada multi-rede
      id: c.id || null,
      name: c.title || '',
      handle: c.handle || '',
      avatar: c.thumbnail || '',
      description: c.description || '',
      country: c.country || '',
      subscriberCount: c.subscriberCount || null,
      videoCount: c.videoCount || null,
    },
    scopes: String(tokens.scope || '').split(' ').filter(Boolean),
    authorizedAt: nowIso(),
    connectedAt: nowIso(),
    lastRefreshAt: nowIso(),
    expiresAt: tokens.expiresAt,
    tokensEnc: await encryptJson({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt }),
  };
  await state.saveAccount(conn);
  state.appendActivity({ type: 'conta_conectada', platform: pid, account: c.title, accountId: c.id });
  _log('conta conectada:', pid, '→', c.title, '(' + c.id + ')');
  return { ok: true, account: publicAccount(state.getAccount(conn.id)), connection: publicConnection() };
}

/* Acesso ao token válido (renova quando perto de expirar). */
async function ensureAccessToken(accountId) {
  const conn = accountId ? state.getAccount(accountId) : state.connection;
  if (!conn) {
    return accountId
      ? { ok: false, code: 'conta_inexistente', reason: 'Conta não encontrada.' }
      : { ok: false, code: 'sem_conexao', reason: 'Nenhuma conta conectada.' };
  }
  if (conn.status !== 'conectado') return { ok: false, code: 'sem_conexao', reason: 'Conta não está conectada (' + conn.status + ').' };
  const cfg = oauthConfig();
  if (!cfg.configured) return { ok: false, code: 'sem_credenciais', reason: 'Credenciais OAuth não configuradas.' };
  const tokens = await decryptJson(conn.tokensEnc);
  if (!tokens || !tokens.accessToken) return { ok: false, code: 'sem_tokens', reason: 'Tokens indisponíveis: reconecte a conta.' };

  const fresh = await ensureFresh({ tokens, clientId: cfg.clientId, clientSecret: cfg.clientSecret });
  if (!fresh.ok) {
    conn.status = fresh.revoked ? 'revogado' : 'expirado';
    conn.updatedAt = nowIso();
    await state.saveAccount(conn);
    state.appendActivity({ type: 'conexao_invalida', id: conn.id, status: conn.status });
    return { ok: false, code: conn.status, reason: fresh.reason || 'Falha ao renovar o acesso da conta.' };
  }
  if (fresh.refreshed) {
    conn.tokensEnc = await encryptJson(fresh.tokens);
    conn.expiresAt = fresh.tokens.expiresAt;
    conn.lastRefreshAt = nowIso();
    conn.status = 'conectado';
    await state.saveAccount(conn);
  }
  return { ok: true, accessToken: fresh.tokens.accessToken, account: publicAccount(conn) };
}

/* Reconecta/atualiza uma conta específica (ou a principal). */
export async function refreshAccount(accountId) {
  const conn = accountId ? state.getAccount(accountId) : state.connection;
  if (!conn) return { ok: false, reason: 'Conta não encontrada.' };
  const r = await ensureAccessToken(conn.id);
  if (!r.ok) return r;
  const ch = await fetchMyChannel(r.accessToken);
  if (ch.ok) {
    conn.channel = ch.channel;
    conn.account = Object.assign({}, conn.account || {}, {
      id: ch.channel.id, name: ch.channel.title, handle: ch.channel.handle, avatar: ch.channel.thumbnail,
    });
    conn.status = 'conectado';
    await state.saveAccount(conn);
    state.appendActivity({ type: 'conta_atualizada', id: conn.id, account: ch.channel.title });
  }
  return { ok: true, account: publicAccount(state.getAccount(conn.id)), items: state.allAccounts().map(publicAccount) };
}

export async function refreshConnection() { return refreshAccount(null); }

/* Desconecta uma conta específica (revoga o token quando possível). */
export async function disconnectAccount(accountId) {
  const conn = accountId ? state.getAccount(accountId) : state.connection;
  if (!conn) return { ok: false, reason: 'Conta não encontrada.' };
  let revoked = false;
  const tokens = await decryptJson(conn.tokensEnc);
  const tok = (tokens && (tokens.refreshToken || tokens.accessToken)) || null;
  if (tok) { const r = await revokeToken(tok); revoked = !!r.ok; }
  const wasPrimary = !!conn.primary;
  const platform = conn.platform || 'youtube';
  await state.removeAccount(conn.id);
  if (wasPrimary) {
    const next = state.accountsFor(platform)[0];
    if (next) await state.setPrimary(next.id);
  }
  state.appendActivity({ type: 'conta_desconectada', id: conn.id, platform, revoked });
  return { ok: true, revoked, items: state.allAccounts().map(publicAccount) };
}

export async function disconnect() { return disconnectAccount(null); }

/* ---------------- 8.3 Publicação ---------------- */
function pickJobFile(job) {
  const r = job && job.render;
  if (r && Array.isArray(r.files) && r.files.length) return r.files[0];
  if (r && typeof r.outputPath === 'string' && r.outputPath) return r.outputPath;
  return null;
}

/* Convenção de saída do AutoClips quando o render é concluído. */
function renderedPathFor(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.resolve(process.cwd(), 'autoclips/out', safe, 'final.mp4');
}

async function resolveFromJob(jobId, owner) {
  if (!_autoclipsSvc) return { reason: 'Módulo AutoClips indisponível.' };
  const g = await _autoclipsSvc.get(jobId, owner);
  if (!g || g.ok === false || !g.job) return { reason: 'Tarefa do AutoClips não encontrada.' };
  const metadata = g.metadata || null;                 // metadados completos
  const filePath = pickJobFile(g.job) || renderedPathFor(g.job.id);
  return { job: g.job, metadata, filePath };
}

export async function publish(input = {}, owner) {
  const o = normalizeOwner(owner || input.owner);
  const cfg = getConfig();

  let metadata = input.metadata || null;
  let filePath = input.filePath || null;
  let jobId = input.jobId || null;

  if (jobId && (!metadata || !filePath)) {
    const r = await resolveFromJob(jobId, owner);
    if (r.reason && !r.job) return { ok: false, reason: r.reason };
    metadata = metadata || r.metadata;
    filePath = filePath || r.filePath;
  }

  if (!filePath && jobId) {
    return { ok: false, code: 'render_pendente', reason: 'A tarefa ainda não tem um arquivo renderizado. Conclua o render (ffmpeg) ou informe um arquivo local.' };
  }

  /* Conta de destino: explícita (multi-conta) ou a principal. */
  const targetAccountId = input.accountId || (input.account && input.account.id) || null;
  const auth = await ensureAccessToken(targetAccountId);
  const accessToken = auth.ok ? auth.accessToken : null;

  /* Reaproveita um registro existente (retry do lote/fila) para não duplicar. */
  const reuse = input.reuseId ? state.getPublication(input.reuseId) : null;

  const res = await publishOne({
    state, accessToken, filePath, metadata, jobId, owner: o,
    accountId: targetAccountId || (auth.account && auth.account.id) || null,
    platform: (auth.account && auth.account.platform) || 'youtube',
    visibility: input.visibility || cfg.defaultVisibility,
    scheduledAt: input.scheduledAt || null,
    config: cfg,
    reuse,
    authError: auth.ok ? null : auth.reason,
    authCode: auth.ok ? null : auth.code,
    reasonLabel: input.note || (jobId ? 'auto/manual (job)' : 'manual'),
  });

  // Recontagem para a próxima trava diária já refletir este resultado.
  return { ok: res.ok, code: res.code || null, reason: res.reason || null, publication: res.publication };
}

export async function republish(id, visibility, owner) {
  const pub = state.getPublication(id);
  if (!pub) return { ok: false, reason: 'Publicação não encontrada.' };
  if (owner && normalizeOwner(owner) !== normalizeOwner(pub.owner)) return { ok: false, reason: 'Publicação não encontrada.' };
  if (VISIBILITIES.indexOf(String(visibility)) < 0) return { ok: false, reason: 'Visibilidade inválida.' };
  const auth = await ensureAccessToken();
  if (!auth.ok) return { ok: false, code: auth.code, reason: auth.reason };
  return await republishStatus({ state, accessToken: auth.accessToken, publication: pub, visibility });
}

export function listPublications(owner) { return { ok: true, items: state.listPublications(owner), statuses: PUB_STATUS, visibilities: VISIBILITIES }; }

export async function removePublication(id, owner) {
  const pub = state.getPublication(id);
  if (!pub) return { ok: false, reason: 'Publicação não encontrada.' };
  if (owner && normalizeOwner(owner) !== normalizeOwner(pub.owner)) return { ok: false, reason: 'Publicação não encontrada.' };
  await state.removePublication(id);
  return { ok: true };
}

/* ================= Etapa 6 — Publicação em lote, agendamento e retry ================= */

/* Resolve os cortes escolhidos (job do AutoClips ou arquivo/metadados explícitos). */
async function resolveCuts(input, owner) {
  const out = [];
  const list = Array.isArray(input.cuts) ? input.cuts : [];
  for (const item of list) {
    const rawId = item && (item.jobId || item.id);
    const jobId = rawId ? String(rawId) : null;
    let metadata = (item && item.metadata) || null;
    let filePath = (item && item.filePath) || null;
    let title = (item && item.title) || null;
    if (jobId && (!metadata || !filePath)) {
      const r = await resolveFromJob(jobId, owner);
      if (r.reason && !r.job) { out.push({ jobId, title, error: r.reason }); continue; }
      metadata = metadata || r.metadata;
      filePath = filePath || r.filePath;
      title = title || (r.job && r.job.title) || null;
    }
    if (!filePath) { out.push({ jobId, title, error: 'Sem arquivo de vídeo renderizado.' }); continue; }
    out.push({
      jobId, title, metadata, filePath,
      accountIds: Array.isArray(item.accountIds) ? item.accountIds.map((x) => String(x)) : null,
    });
  }
  return out;
}

/* Resolve as contas de destino (explícitas ou a conta principal). */
function resolveAccounts(input) {
  let ids = [];
  if (Array.isArray(input.accountIds)) ids = input.accountIds.map((x) => String(x));
  else if (input.accountIds) ids = [String(input.accountIds)];
  else if (Array.isArray(input.accounts)) ids = input.accounts.map((x) => String((x && x.id) || x));
  if (!ids.length) { const p = state.connection; return p ? [p] : []; }
  const seen = new Set(); const out = [];
  for (const id of ids) { const a = state.getAccount(id); if (a && !seen.has(a.id)) { seen.add(a.id); out.push(a); } }
  return out;
}

function batchPolicy(input) {
  const cfg = getConfig();
  const mode = String(input.mode || 'now') === 'schedule' ? 'schedule' : 'now';
  const vis = VISIBILITIES.indexOf(String(input.visibility || '')) >= 0 ? String(input.visibility) : cfg.defaultVisibility;
  const issues = [];
  let scheduledAt = null;
  if (mode === 'schedule') {
    const v = validateSchedule({ mode, date: input.date, time: input.time, timezone: input.timezone });
    if (!v.ok) issues.push.apply(issues, v.issues); else scheduledAt = v.scheduledAt;
  }
  if (cfg.emergencyStop) issues.push('Botão de emergência ativo: publicações interrompidas.');
  return { cfg, mode, visibility: vis, scheduledAt, issues };
}

/* Pré-visualização do lote (sem efeitos): mostra o que seria publicado. */
export async function previewBatch(input = {}, owner) {
  const pol = batchPolicy(input);
  const cuts = await resolveCuts(input, owner);
  const accounts = resolveAccounts(input);
  const issues = pol.issues.slice();
  if (!cuts.length) issues.push('Selecione ao menos um corte para publicar.');
  if (!accounts.length) issues.push('Nenhuma conta conectada para publicar.');

  const plan = cuts.map((cut) => {
    const targets = cut.accountIds && cut.accountIds.length
      ? accounts.filter((a) => cut.accountIds.indexOf(String(a.id)) >= 0)
      : accounts;
    return {
      jobId: cut.jobId || null, title: cut.title || null,
      eligible: !cut.error, error: cut.error || null,
      targets: targets.map((a) => ({ accountId: a.id, name: (a.account && a.account.name) || '', platform: a.platform || 'youtube' })),
    };
  });
  const total = plan.reduce((n, p) => n + p.targets.length, 0);
  return {
    ok: issues.length === 0, mode: pol.mode, visibility: pol.visibility, scheduledAt: pol.scheduledAt,
    counts: { cuts: cuts.length, accounts: accounts.length, targets: total }, issues, plan,
    connections: accounts.map(publicAccount),
  };
}

/*
 * Publica em lote: vários cortes × várias redes × várias contas.
 * mode 'now' → publica imediatamente; 'schedule' → envia já como privado
 * com publishAt (agendamento oficial da plataforma).
 */
export async function publishBatch(input = {}, owner) {
  const o = normalizeOwner(owner || input.owner);
  const pol = batchPolicy(input);
  if (pol.issues.length && pol.mode === 'schedule' && !pol.scheduledAt) {
    return { ok: false, code: 'agendamento_invalido', reason: pol.issues.join(' '), issues: pol.issues };
  }
  const cuts = await resolveCuts(input, owner);
  if (!cuts.length) return { ok: false, code: 'sem_cortes', reason: 'Selecione ao menos um corte para publicar.' };
  const accounts = resolveAccounts(input);
  if (!accounts.length) return { ok: false, code: 'sem_contas', reason: 'Nenhuma conta conectada. Conecte uma conta em Minhas redes sociais.' };

  const results = [];
  let okCount = 0;
  for (const cut of cuts) {
    if (cut.error) { results.push({ jobId: cut.jobId || null, title: cut.title || null, ok: false, code: 'sem_arquivo', reason: cut.error }); continue; }
    const targets = cut.accountIds && cut.accountIds.length
      ? accounts.filter((a) => cut.accountIds.indexOf(String(a.id)) >= 0)
      : accounts;
    if (!targets.length) { results.push({ jobId: cut.jobId || null, title: cut.title || null, ok: false, code: 'sem_contas', reason: 'Nenhuma conta selecionada para este corte.' }); continue; }
    for (const acc of targets) {
      const r = await publish({
        jobId: cut.jobId, filePath: cut.filePath, metadata: cut.metadata,
        visibility: pol.visibility, scheduledAt: pol.scheduledAt,
        accountId: acc.id, note: input.note || 'lote',
      }, o);
      if (r.ok) okCount++;
      results.push({
        jobId: cut.jobId || null,
        title: cut.title || (r.publication && r.publication.snippet && r.publication.snippet.title) || null,
        accountId: acc.id, accountName: (acc.account && acc.account.name) || '', platform: acc.platform || 'youtube',
        ok: !!r.ok, code: r.code || null, reason: r.reason || null,
        publicationId: (r.publication && r.publication.id) || null,
        url: (r.publication && r.publication.url) || null,
        status: (r.publication && r.publication.status) || null,
        scheduledAt: (r.publication && r.publication.scheduledAt) || null,
      });
    }
  }
  state.appendActivity({ type: 'lote_publicacao', mode: pol.mode, total: results.length, ok: okCount });
  return {
    ok: okCount > 0, mode: pol.mode, scheduledAt: pol.scheduledAt, visibility: pol.visibility,
    counts: { total: results.length, ok: okCount, fail: results.length - okCount }, results,
  };
}

/* Publicações de erro com tentativa vencida e dentro do limite. */
export function dueRetries(now) {
  const t = now ? Date.parse(now) : Date.now();
  return state.allPublications().filter((p) =>
    p.status === 'erro' && p.nextAttemptAt && Date.parse(p.nextAttemptAt) <= t && (p.attempts || 0) < MAX_RETRY_ATTEMPTS
  );
}

/* Reprocessa uma publicação que falhou (mesmo registro, sem duplicar). */
export async function retryPublication(id, owner) {
  const pub = state.getPublication(id);
  if (!pub) return { ok: false, reason: 'Publicação não encontrada.' };
  if (owner && normalizeOwner(owner) !== normalizeOwner(pub.owner)) return { ok: false, reason: 'Publicação não encontrada.' };
  if (pub.status === 'publicado' || pub.status === 'agendado') return { ok: false, code: 'ja_concluida', reason: 'Esta publicação já foi concluída.' };
  if ((pub.attempts || 0) >= MAX_RETRY_ATTEMPTS) return { ok: false, code: 'limite_tentativas', reason: 'Limite de tentativas atingido (' + MAX_RETRY_ATTEMPTS + ').' };
  const metadata = pub.snippet ? { title: pub.snippet.title, description: pub.snippet.description, tags: pub.snippet.tags } : null;
  return await publish({
    jobId: pub.jobId, filePath: pub.filePath, metadata,
    visibility: pub.visibility, scheduledAt: pub.scheduledAt,
    accountId: pub.accountId, note: 'retry', reuseId: pub.id,
  }, pub.owner);
}

/* Executa a fila de retry (chamado pelo tick em segundo plano). */
export async function retryTick() {
  const due = dueRetries();
  const results = [];
  for (const pub of due) {
    const r = await retryPublication(pub.id, pub.owner);
    results.push({ id: pub.id, ok: !!r.ok, code: r.code || null, reason: r.reason || null });
  }
  if (results.length) state.appendActivity({ type: 'retry_tick', total: results.length, ok: results.filter((x) => x.ok).length });
  return { ok: true, ran: results.length, results };
}

/* Central de publicações (Etapa 6): contadores, agendadas, falhas e recentes. */
export function publicationsCenter(owner) {
  const items = state.listPublications(owner);
  const now = Date.now();
  const byStatus = {};
  for (const p of items) byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  const upcoming = items
    .filter((p) => p.status === 'agendado' && p.scheduledAt && Date.parse(p.scheduledAt) > now)
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  const failed = items.filter((p) => p.status === 'erro' || p.status === 'bloqueado');
  return {
    ok: true,
    counts: {
      total: items.length,
      publicado: byStatus.publicado || 0, agendado: byStatus.agendado || 0,
      enviando: byStatus.enviando || 0, erro: byStatus.erro || 0,
      bloqueado: byStatus.bloqueado || 0, rascunho: byStatus.rascunho || 0, cancelado: byStatus.cancelado || 0,
    },
    byStatus,
    upcoming: upcoming.slice(0, 100),
    failed: failed.slice(0, 100),
    recent: items.slice(0, 100),
    retryPending: dueRetries().length,
    timezones: TIMEZONES, defaultTimezone: DEFAULT_TIMEZONE,
  };
}

/* Calendário de agendamentos agrupado por data (dia). */
export function scheduleCalendar(owner, range) {
  const r = range || {};
  const fromT = r.from ? Date.parse(r.from) : 0;
  const toT = r.to ? Date.parse(r.to) : Infinity;
  const items = state.listPublications(owner).filter((p) => p.scheduledAt);
  const days = {};
  for (const p of items) {
    const t = Date.parse(p.scheduledAt);
    if (!Number.isFinite(t) || t < fromT || t > toT) continue;
    const key = String(p.scheduledAt).slice(0, 10);
    (days[key] = days[key] || []).push({
      id: p.id, jobId: p.jobId || null, accountId: p.accountId || null,
      title: (p.snippet && p.snippet.title) || 'Corte',
      status: p.status, scheduledAt: p.scheduledAt, url: p.url || null,
      local: utcToZonedParts(p.scheduledAt, (r.timezone || DEFAULT_TIMEZONE)) || null,
    });
  }
  const list = Object.keys(days).sort().map((d) => ({
    date: d,
    items: days[d].sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt))),
  }));
  return { ok: true, days: list, timezone: r.timezone || DEFAULT_TIMEZONE, timezones: TIMEZONES, defaultTimezone: DEFAULT_TIMEZONE };
}

export function timezones() {
  return { ok: true, items: TIMEZONES, default: DEFAULT_TIMEZONE, check: isValidTimezone };
}

export function activity(limit = 60) {
  const items = state.activity.slice(-Math.max(1, Math.min(400, limit))).reverse();
  return { ok: true, items };
}

/* ---------------- Parte 9 — Estatísticas (usado pelo Analytics) ---------------- */
/* Devolve um token de acesso válido (renovando se necessário) para o módulo Analytics. */
export async function getAccessToken() {
  const r = await ensureAccessToken();
  return r.ok ? { ok: true, accessToken: r.accessToken } : r;
}

/* Busca estatísticas oficiais de vídeos publicados (visualizações, curtidas, comentários). */
export async function fetchVideoStats(videoIds) {
  const auth = await ensureAccessToken();
  if (!auth.ok) return { ok: false, code: auth.code, reason: auth.reason };
  return await fetchVideosStats({ accessToken: auth.accessToken, videoIds });
}

/* ---------------- Publicação automática (8.3) ---------------- */
export async function autoPublishOnce(cfg) {
  const c = cfg || getConfig();
  if (!_autoclipsSvc) return { ran: false, reason: 'Módulo AutoClips indisponível.' };

  const listed = await _autoclipsSvc.list('local');
  const jobs = (listed && listed.items) || [];
  const candidates = jobs.filter((j) => {
    if (j.status !== 'concluido' && j.status !== 'renderizado') return false;
    const score = j.qa && typeof j.qa.score === 'number' ? j.qa.score : 0;
    if (score < c.minScore) return false;
    if (c.profiles.length && c.profiles.indexOf(j.profileKey) < 0) return false;
    return true;
  }).sort((a, b) => ((b.qa && b.qa.score) || 0) - ((a.qa && a.qa.score) || 0));

  const primary = state.connection;
  for (const j of candidates) {
    const g = await _autoclipsSvc.get(j.id, 'local');
    const filePath = pickJobFile(g && g.job) || renderedPathFor(j.id);
    const fp = await fileFingerprint(filePath);
    if (!fp.exists) continue; // sem arquivo renderizado → honestamente pula
    const key = dedupeKey({ jobId: j.id, accountId: primary && primary.id, filePath, size: fp.size, mtimeMs: fp.mtimeMs });
    if (findDuplicate(state, key)) continue;
    const r = await publish({ jobId: j.id, filePath, visibility: c.defaultVisibility, note: 'automatica' }, 'local');
    const c2 = getConfig(); c2.lastAutoAt = nowIso();
    await state.saveConfig(c2);
    state.appendActivity({ type: 'auto_publicacao', id: r.publication && r.publication.id, ok: !!r.ok, reason: r.reason || '' });
    return { ran: true, ok: !!r.ok, reason: r.reason || null, publication: r.publication };
  }
  return { ran: false, reason: 'nenhum corte elegível com arquivo renderizado' };
}

export { VISIBILITIES, PUB_STATUS, DEFAULT_CONFIG };

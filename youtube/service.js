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
import { publish as publishOne, republishStatus, countToday, findDuplicate, dedupeKey, fileFingerprint, VISIBILITIES, PUB_STATUS } from './publisher.js';
import * as scheduler from './scheduler.js';
import { normalizeConfig, DEFAULT_CONFIG, shouldRun } from './scheduler.js';
import { listProfiles } from '../autoclips/profiles.js';

const _log = (...a) => console.log('[YOUTUBE][service]', ...a);

let _initialized = false;
let _autoclipsSvc = null;

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
function publicConnection() {
  const c = state.connection;
  if (!c) return null;
  return {
    status: c.status,
    channel: c.channel || null,
    scopes: c.scopes || [],
    authorizedAt: c.authorizedAt || null,
    connectedAt: c.connectedAt || null,
    lastRefreshAt: c.lastRefreshAt || null,
    expiresAt: c.expiresAt || null,
  };
}

export function status() {
  const cfg = getConfig();
  const ocfg = oauthConfig();
  const gate = shouldRun(cfg, state.connection, new Date());
  return {
    ok: true,
    schema: SCHEMA,
    configured: ocfg.configured,
    clientIdMasked: ocfg.clientId ? maskSecret(ocfg.clientId) : '',
    redirectUri: ocfg.redirectUri,
    scopes: ['youtube.upload', 'youtube.readonly'],
    connected: !!(state.connection && state.connection.status === 'conectado'),
    connection: publicConnection(),
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

export async function authUrl(hostBase) {
  const cfg = oauthConfig();
  if (!cfg.configured) {
    return { ok: false, code: 'sem_credenciais', reason: 'Credenciais OAuth do Google não configuradas (YT_CLIENT_ID / YT_CLIENT_SECRET).' };
  }
  const redirectUri = hostBase ? (hostBase.replace(/\/$/, '') + '/api/youtube/oauth/callback') : cfg.redirectUri;
  const pkce = makePkce();
  const st = newState();
  state.oauthSessions[st] = { verifier: pkce.verifier, createdAt: nowIso(), redirectUri };
  await state.saveOauthSessions(state.oauthSessions);
  const url = buildAuthUrl({ clientId: cfg.clientId, redirectUri, state: st, codeChallenge: pkce.challenge });
  return { ok: true, url };
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

  const conn = {
    schema: SCHEMA,
    owner: 'local',
    status: 'conectado',
    channel: ch.channel,
    scopes: String(tokens.scope || '').split(' ').filter(Boolean),
    authorizedAt: nowIso(),
    connectedAt: nowIso(),
    lastRefreshAt: nowIso(),
    expiresAt: tokens.expiresAt,
    tokensEnc: await encryptJson({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt }),
  };
  await state.saveConnection(conn);
  state.appendActivity({ type: 'canal_conectado', channel: ch.channel.title, channelId: ch.channel.id });
  _log('canal conectado:', ch.channel.title, '(' + ch.channel.id + ')');
  return { ok: true, connection: publicConnection() };
}

/* Acesso ao token válido (renova quando perto de expirar). */
async function ensureAccessToken() {
  const conn = state.connection;
  if (!conn || conn.status !== 'conectado') return { ok: false, code: 'sem_conexao', reason: 'Canal do YouTube não conectado.' };
  const cfg = oauthConfig();
  if (!cfg.configured) return { ok: false, code: 'sem_credenciais', reason: 'Credenciais OAuth não configuradas.' };
  const tokens = await decryptJson(conn.tokensEnc);
  if (!tokens || !tokens.accessToken) return { ok: false, code: 'sem_tokens', reason: 'Tokens indisponíveis: reconecte o canal.' };

  const fresh = await ensureFresh({ tokens, clientId: cfg.clientId, clientSecret: cfg.clientSecret });
  if (!fresh.ok) {
    conn.status = fresh.revoked ? 'revogado' : 'expirado';
    conn.updatedAt = nowIso();
    await state.saveConnection(conn);
    state.appendActivity({ type: 'conexao_invalida', status: conn.status });
    return { ok: false, code: conn.status, reason: fresh.reason || 'Falha ao renovar o acesso ao canal.' };
  }
  if (fresh.refreshed) {
    conn.tokensEnc = await encryptJson(fresh.tokens);
    conn.expiresAt = fresh.tokens.expiresAt;
    conn.lastRefreshAt = nowIso();
    conn.status = 'conectado';
    await state.saveConnection(conn);
  }
  return { ok: true, accessToken: fresh.tokens.accessToken };
}

export async function refreshConnection() {
  const conn = state.connection;
  if (!conn) return { ok: false, reason: 'Nenhum canal conectado.' };
  const r = await ensureAccessToken();
  if (!r.ok) return r;
  const ch = await fetchMyChannel(r.accessToken);
  if (ch.ok) {
    conn.channel = ch.channel;
    conn.status = 'conectado';
    await state.saveConnection(conn);
    state.appendActivity({ type: 'canal_atualizado', channel: ch.channel.title });
  }
  return { ok: true, connection: publicConnection() };
}

export async function disconnect() {
  const conn = state.connection;
  let revoked = false;
  if (conn) {
    const tokens = await decryptJson(conn.tokensEnc);
    const tok = (tokens && (tokens.refreshToken || tokens.accessToken)) || null;
    if (tok) { const r = await revokeToken(tok); revoked = !!r.ok; }
  }
  await state.clearConnection();
  state.appendActivity({ type: 'canal_desconectado', revoked });
  return { ok: true, revoked };
}

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

  const auth = await ensureAccessToken();
  const accessToken = auth.ok ? auth.accessToken : null;

  const res = await publishOne({
    state, accessToken, filePath, metadata, jobId, owner: o,
    visibility: input.visibility || cfg.defaultVisibility,
    scheduledAt: input.scheduledAt || null,
    config: cfg,
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

  for (const j of candidates) {
    const g = await _autoclipsSvc.get(j.id, 'local');
    const filePath = pickJobFile(g && g.job) || renderedPathFor(j.id);
    const fp = await fileFingerprint(filePath);
    if (!fp.exists) continue; // sem arquivo renderizado → honestamente pula
    const key = dedupeKey({ jobId: j.id, filePath, size: fp.size, mtimeMs: fp.mtimeMs });
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

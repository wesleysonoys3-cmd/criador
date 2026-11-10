/* =========================================================
 * pesquisa/service.js — Pesquisa autorizada (Módulo 2)
 * ---------------------------------------------------------
 * Regras determinísticas (sem IA):
 *   • Autorização por PIN: guarda SOMENTE hash scrypt no backend,
 *     com limite de tentativas + bloqueio temporário e sessão
 *     de autorização com validade e revogação.
 *   • Pesquisa na internet reutilizando o gate de saída já
 *     existente (safeFetchInternet/whitelist/anti-IP-privado),
 *     injetado pelo server (não cria nova integração de rede).
 *   • Cache de pesquisas/páginas (economia — §2.3).
 *   • Catálogo de recursos com origem, licença e versão.
 *   • Registro de fontes consultadas.
 *   • Integração com a Memória (consulta antes de pesquisar e
 *     gravação dos recursos aprovados).
 * NUNCA grava o PIN em texto puro e NUNCA o registra em logs.
 * =======================================================*/
import path from 'node:path';
import crypto from 'node:crypto';
import state, {
  SCHEMA, newSessionToken, cacheKey, nowIso,
  MAX_FAILED_ATTEMPTS, LOCK_MS, SESSION_TTL_MS,
  SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_KEYLEN,
  MAX_CACHE, MAX_CATALOG, MAX_SOURCES,
} from './state.js';

const _log = (...a) => console.log('[PESQUISA][service]', ...a);

let _initialized = false;
let _loadP = null;

/* Injetados pelo server (reuso das estruturas existentes) */
let _fetchFn = null;   // (url, opts) => Response-like (safeFetchInternet)
let _allowFn = null;   // (urlOrHost) => { ok, reason, host }
let _memorySvc = null; // memoria/service.js

const PIN_MIN = 4;
const PIN_MAX = 64;
const CATALOG_KINDS = ['biblioteca', 'engine', 'documentacao', 'exemplo', 'repositorio', 'tutorial', 'modelo', 'componente', 'grafico', 'som', 'outro'];

/* ---------------- Segurança: nunca guardar segredos no catálogo ---------------- */
const SECRET_KEY_RE = /(pass(word)?|senha|token|secret|api[_-]?key|apikey|credenc|authorization|bearer|private[_-]?key|cookie|session[_-]?id|pin)/i;
const SECRET_VALUE_RE = /\b(sk-[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}|Bearer\s+[A-Za-z0-9._-]{10,})\b/g;
function scrub(value, depth = 0) {
  if (depth > 8) return { value: '[removido]', redacted: true };
  if (value === null || value === undefined) return { value, redacted: false };
  if (typeof value === 'string') {
    if (SECRET_VALUE_RE.test(value)) { SECRET_VALUE_RE.lastIndex = 0; return { value: value.replace(SECRET_VALUE_RE, '[removido]'), redacted: true }; }
    return { value, redacted: false };
  }
  if (typeof value !== 'object') return { value, redacted: false };
  if (Array.isArray(value)) {
    let redacted = false;
    const out = value.map(v => { const r = scrub(v, depth + 1); redacted = redacted || r.redacted; return r.value; });
    return { value: out, redacted };
  }
  let redacted = false;
  const out = {};
  for (const k of Object.keys(value)) {
    if (SECRET_KEY_RE.test(k)) { out[k] = '[removido]'; redacted = true; continue; }
    const r = scrub(value[k], depth + 1);
    out[k] = r.value; redacted = redacted || r.redacted;
  }
  return { value: out, redacted };
}

/* ---------------- Init ---------------- */
export function init({ dataDir = null, fetchFn = null, allowFn = null, memorySvc = null } = {}) {
  state.setDataDir(dataDir || path.resolve(process.cwd(), 'pesquisa/data'));
  if (typeof fetchFn === 'function') _fetchFn = fetchFn;
  if (typeof allowFn === 'function') _allowFn = allowFn;
  if (memorySvc) _memorySvc = memorySvc;
  if (!_initialized) {
    _initialized = true;
    _loadP = state.loadAll().catch(e => _log('loadAll erro:', String(e?.message || e)));
  }
  _applyEnvPin();
  return { ok: true, dataDir: state.dataDir, hasPin: !!state.config.pinHash };
}

/** Reforço imediato (async) para garantir config/sessões carregados. */
async function _ensureLoaded() {
  if (_loadP) { try { await _loadP; } catch {} _loadP = null; }
}

/**
 * Configuração segura via ambiente: PESQUISA_PIN_HASH deve conter o
 * hash completo no formato "scrypt$N$r$p$saltB64$hashB64".
 * Se presente, tem precedência (não exige UI para configurar).
 */
function _applyEnvPin() {
  const env = String(process.env.PESQUISA_PIN_HASH || '').trim();
  if (!env) return;
  if (!/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(env)) {
    _log('PESQUISA_PIN_HASH inválido (ignorado). Esperado formato scrypt$N$r$p$saltB64$hashB64.');
    return;
  }
  if (state.config.pinHash !== env) {
    state.config.pinHash = env;
    state.config.pinAlg = 'scrypt';
    state.config.pinSource = 'env';
    state.config.pinUpdatedAt = state.config.pinUpdatedAt || nowIso();
    state.saveConfig().catch(() => {});
    _log('PIN carregado de PESQUISA_PIN_HASH (hash, config segura por ambiente).');
  } else {
    state.config.pinSource = 'env';
  }
}

/* ---------------- Hash do PIN (scrypt + salt aleatório) ---------------- */
/** Gera o hash seguro de um PIN (uso: configurar por ambiente/CLI). */
export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pin), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

function _verifyPin(pin, storedHash) {
  try {
    const parts = String(storedHash || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10);
    if (!N || !r || !p) return false;
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    const dk = crypto.scryptSync(String(pin), salt, expected.length, { N, r, p });
    return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
  } catch { return false; }
}

function _validPin(pin) {
  const s = String(pin == null ? '' : pin);
  if (s.length < PIN_MIN || s.length > PIN_MAX) return `O PIN deve ter entre ${PIN_MIN} e ${PIN_MAX} caracteres.`;
  if (/^\s|\s$/.test(s)) return 'O PIN não pode começar/terminar com espaços.';
  return null;
}

function _lockInfo() {
  const now = Date.now();
  const until = Number(state.config.lockedUntilMs || 0);
  const remainingMs = Math.max(0, until - now);
  return { locked: remainingMs > 0, lockedUntilMs: until, remainingMs, failedAttempts: Number(state.config.failedAttempts || 0) };
}

/* ---------------- Status ---------------- */
export async function status() {
  await _ensureLoaded();
  const removed = state.purgeExpiredSessions();
  if (removed) state.saveSessions().catch(() => {});
  const lock = _lockInfo();
  return {
    ok: true,
    schema: SCHEMA,
    hasPin: !!state.config.pinHash,
    pinSource: state.config.pinSource || null,
    pinUpdatedAt: state.config.pinUpdatedAt || null,
    locked: lock.locked,
    lockedUntilMs: lock.lockedUntilMs,
    remainingMs: lock.remainingMs,
    failedAttempts: lock.failedAttempts,
    maxAttempts: MAX_FAILED_ATTEMPTS,
    lockMs: LOCK_MS,
    sessionTtlMs: SESSION_TTL_MS,
    sessions: state.sessions.size,
    cacheEntries: state.cache.size,
    catalogCount: state.catalog.length,
    sourcesCount: state.sources.length,
    limits: { cache: MAX_CACHE, catalog: MAX_CATALOG, sources: MAX_SOURCES },
    network: { fetchAvailable: !!_fetchFn, allowAvailable: !!_allowFn },
    memory: !!_memorySvc,
  };
}

/* ---------------- Autorização por PIN ---------------- */
export async function setupPin(pin) {
  await _ensureLoaded();
  const err = _validPin(pin);
  if (err) return { ok: false, reason: err, code: 'INVALID_PIN_FORMAT' };
  if (state.config.pinSource === 'env') return { ok: false, reason: 'O PIN é definido por configuração de ambiente (PESQUISA_PIN_HASH). Altere a configuração segura do servidor.', code: 'PIN_ENV_MANAGED' };
  if (state.config.pinHash) return { ok: false, reason: 'Já existe um PIN configurado. Use a troca de PIN informando o atual.', code: 'PIN_ALREADY_SET' };
  state.config.pinHash = hashPin(pin);
  state.config.pinAlg = 'scrypt';
  state.config.pinSource = 'ui';
  state.config.pinUpdatedAt = nowIso();
  state.config.failedAttempts = 0;
  state.config.lockedUntilMs = 0;
  await state.saveConfig();
  return { ok: true, hasPin: true, pinSource: 'ui' };
}

export async function changePin(currentPin, newPin) {
  await _ensureLoaded();
  if (state.config.pinSource === 'env') return { ok: false, reason: 'O PIN é definido por configuração de ambiente (PESQUISA_PIN_HASH).', code: 'PIN_ENV_MANAGED' };
  if (!state.config.pinHash) return { ok: false, reason: 'Nenhum PIN configurado ainda.', code: 'NO_PIN' };
  const lock = _lockInfo();
  if (lock.locked) return { ok: false, reason: `Bloqueado temporariamente. Tente novamente em ${Math.ceil(lock.remainingMs / 1000)}s.`, code: 'LOCKED', remainingMs: lock.remainingMs };
  if (!_verifyPin(currentPin, state.config.pinHash)) {
    await _registerFailure();
    const after = _lockInfo();
    return { ok: false, reason: after.locked ? `PIN atual incorreto. Bloqueado por ${Math.ceil(after.remainingMs / 1000)}s.` : `PIN atual incorreto. Tentativas restantes: ${Math.max(0, MAX_FAILED_ATTEMPTS - after.failedAttempts)}.`, code: 'INVALID_PIN', remaining: Math.max(0, MAX_FAILED_ATTEMPTS - after.failedAttempts) };
  }
  const err = _validPin(newPin);
  if (err) return { ok: false, reason: err, code: 'INVALID_PIN_FORMAT' };
  state.config.pinHash = hashPin(newPin);
  state.config.pinSource = 'ui';
  state.config.pinUpdatedAt = nowIso();
  state.config.failedAttempts = 0;
  state.config.lockedUntilMs = 0;
  await state.saveConfig();
  // Troca de PIN revoga todas as sessões existentes por segurança.
  const n = state.sessions.size;
  state.sessions.clear();
  await state.saveSessions();
  return { ok: true, hasPin: true, revokedSessions: n };
}

async function _registerFailure() {
  const lock = _lockInfo();
  if (lock.locked) return;
  state.config.failedAttempts = Number(state.config.failedAttempts || 0) + 1;
  if (state.config.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    state.config.failedAttempts = 0;
    state.config.lockedUntilMs = Date.now() + LOCK_MS;
  }
  await state.saveConfig();
}

export async function authorize(pin) {
  await _ensureLoaded();
  if (!state.config.pinHash) return { ok: false, reason: 'Nenhum PIN configurado. Configure um PIN de autorização para liberar pesquisas.', code: 'NO_PIN' };
  const lock = _lockInfo();
  if (lock.locked) return { ok: false, reason: `Acesso bloqueado temporariamente. Tente novamente em ${Math.ceil(lock.remainingMs / 1000)}s.`, code: 'LOCKED', remainingMs: lock.remainingMs };
  if (!_verifyPin(pin, state.config.pinHash)) {
    await _registerFailure();
    const after = _lockInfo();
    return {
      ok: false,
      code: 'INVALID_PIN',
      reason: after.locked
        ? `PIN incorreto. Acesso bloqueado por ${Math.ceil(after.remainingMs / 1000)}s.`
        : `PIN incorreto. Tentativas restantes: ${Math.max(0, MAX_FAILED_ATTEMPTS - after.failedAttempts)}.`,
      remaining: Math.max(0, MAX_FAILED_ATTEMPTS - after.failedAttempts),
      locked: after.locked,
      lockedUntilMs: after.lockedUntilMs,
    };
  }
  state.config.failedAttempts = 0;
  state.config.lockedUntilMs = 0;
  await state.saveConfig();
  state.purgeExpiredSessions();
  const token = newSessionToken();
  const now = Date.now();
  const session = { token, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_TTL_MS).toISOString() };
  state.sessions.set(token, session);
  await state.saveSessions();
  return { ok: true, token, expiresAt: session.expiresAt, ttlMs: SESSION_TTL_MS };
}

export async function checkSession(token) {
  await _ensureLoaded();
  if (!token) return { ok: false, reason: 'Sessão ausente.', code: 'NO_TOKEN' };
  const s = state.sessions.get(String(token));
  if (!s) return { ok: false, reason: 'Sessão inválida ou revogada.', code: 'INVALID_TOKEN' };
  if (!s.expiresAt || new Date(s.expiresAt).getTime() <= Date.now()) {
    state.sessions.delete(String(token));
    await state.saveSessions();
    return { ok: false, reason: 'Sessão expirada.', code: 'EXPIRED_TOKEN' };
  }
  return { ok: true, session: { createdAt: s.createdAt, expiresAt: s.expiresAt } };
}

export async function revoke(token) {
  await _ensureLoaded();
  const had = state.sessions.delete(String(token || ''));
  if (had) await state.saveSessions();
  return { ok: true, revoked: had };
}

export async function revokeAll() {
  await _ensureLoaded();
  const n = state.sessions.size;
  state.sessions.clear();
  await state.saveSessions();
  return { ok: true, revoked: n };
}

export async function listSessions() {
  await _ensureLoaded();
  const removed = state.purgeExpiredSessions();
  if (removed) await state.saveSessions();
  return {
    ok: true,
    items: [...state.sessions.values()].map(s => ({ tokenShort: String(s.token).slice(0, 12) + '…', createdAt: s.createdAt, expiresAt: s.expiresAt })),
  };
}

async function _requireSession(token) {
  const c = await checkSession(token);
  return c.ok ? { ok: true } : { ok: false, reason: c.reason, code: c.code };
}

/* ---------------- Pesquisa na internet ---------------- */
function _stripTags(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function _decodeDdgUrl(href) {
  try {
    const raw = String(href || '');
    if (/^https?:\/\//i.test(raw)) return raw;
    const href2 = raw.startsWith('//') ? 'https:' + raw : raw;
    const u = new URL(href2, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : u.href;
  } catch { return String(href || ''); }
}

/** Busca textual via DuckDuckGo HTML, reaproveitando o fetch seguro §11. */
async function _internetSearch(query, numResults) {
  if (!_fetchFn) throw new Error('camada de rede indisponível.');
  const n = Math.max(1, Math.min(10, parseInt(numResults || 5, 10) || 5));
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await _fetchFn(url, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
  const txt = await res.text();
  const titles = [];
  const reT = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = reT.exec(txt)) !== null && titles.length < n) {
    titles.push({ url: _decodeDdgUrl(m[1]), title: _stripTags(m[2]).slice(0, 200) });
  }
  const snips = [];
  const reS = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = reS.exec(txt)) !== null && snips.length < n) {
    snips.push(_stripTags(m[1]).slice(0, 600));
  }
  const results = titles.map((t, i) => ({ rank: i + 1, title: t.title, url: t.url, snippet: snips[i] || '' }));
  return results;
}

async function _consultMemory(query) {
  if (!_memorySvc || typeof _memorySvc.search !== 'function') return [];
  try {
    const r = _memorySvc.search({ query, limit: 5, track: true }, null);
    const items = (r && Array.isArray(r.items)) ? r.items : [];
    return items.map(it => ({ id: it.id, title: it.title, status: it.status, category: it.category, project: it.project || null }));
  } catch { return []; }
}

/**
 * Pesquisa autorizada: exige sessão válida; consulta a memória antes;
 * usa cache; senão vai à internet (gate §11); registra a fonte.
 */
export async function search(query, { token = '', numResults = 5 } = {}) {
  await _ensureLoaded();
  const sess = await _requireSession(token);
  if (!sess.ok) return { ok: false, reason: sess.reason || 'Internet não autorizada.', code: sess.code || 'NOT_AUTHORIZED' };
  const q = String(query == null ? '' : query).trim();
  if (!q) return { ok: false, reason: 'Informe o termo da pesquisa.', code: 'EMPTY_QUERY' };
  const qSafe = scrub(q).value;
  const n = Math.max(1, Math.min(10, parseInt(numResults || 5, 10) || 5));

  const memoryHits = await _consultMemory(qSafe);

  const key = cacheKey('search', `${qSafe.toLowerCase()}|${n}`);
  const hit = state.cacheGet(key);
  if (hit) {
    state.saveCache().catch(() => {});
    return { ok: true, cached: true, query: qSafe, count: (hit.payload?.results || []).length, results: hit.payload?.results || [], memoryHits, source: hit.payload?.source || 'cache', cachedAt: new Date(hit.atMs || Date.now()).toISOString() };
  }

  let results = [];
  let source = 'ddg_html';
  try {
    results = await _internetSearch(qSafe, n);
  } catch (err) {
    const code = err && err.code;
    return { ok: false, reason: `Falha na pesquisa: ${String(err && err.message || err)}`, code: code || 'SEARCH_FAILED', memoryHits };
  }

  state.cacheSet({ key, kind: 'search', atMs: Date.now(), payload: { results, source } });
  await state.saveCache();
  await _recordSource({ kind: 'search', query: qSafe, results: results.length });
  return { ok: true, cached: false, query: qSafe, count: results.length, results, memoryHits, source, note: 'Conteúdo textual sanitizado (gate de saída §11).' };
}

/** Lê uma página autorizada (reaproveita o fetch seguro §11) com cache. */
export async function fetchPage(url, { token = '' } = {}) {
  await _ensureLoaded();
  const sess = await _requireSession(token);
  if (!sess.ok) return { ok: false, reason: sess.reason || 'Internet não autorizada.', code: sess.code || 'NOT_AUTHORIZED' };
  const u = String(url == null ? '' : url).trim();
  if (!u) return { ok: false, reason: 'Informe a URL.', code: 'EMPTY_URL' };
  if (!/^https?:\/\//i.test(u)) return { ok: false, reason: 'Somente URLs http/https são permitidas.', code: 'INVALID_URL' };
  if (_allowFn) {
    const allow = _allowFn(u);
    if (!allow.ok) return { ok: false, reason: allow.reason || 'Domínio não permitido pelo gate de saída.', code: 'HOST_DENIED' };
  }
  const key = cacheKey('fetch', u);
  const hit = state.cacheGet(key);
  if (hit) {
    state.saveCache().catch(() => {});
    return { ok: true, cached: true, url: u, status: hit.payload?.status || 200, contentType: hit.payload?.contentType || '', content: hit.payload?.content || '', contentLength: hit.payload?.contentLength || 0, cachedAt: new Date(hit.atMs || Date.now()).toISOString() };
  }
  if (!_fetchFn) return { ok: false, reason: 'camada de rede indisponível.', code: 'NO_NETWORK' };
  try {
    const res = await _fetchFn(u, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const contentType = (res.headers && res.headers.get) ? (res.headers.get('content-type') || '') : '';
    let content;
    if (/text|html|json|xml|markdown|yaml|javascript|css|csv/i.test(contentType)) content = await res.text();
    else content = `[BINÁRIO ${contentType.slice(0, 100)} · não lido por segurança §11]`;
    const payload = { status: res.status || 200, contentType, content: String(content).slice(0, 20000), contentLength: String(content).length };
    state.cacheSet({ key, kind: 'fetch', atMs: Date.now(), payload });
    await state.saveCache();
    await _recordSource({ kind: 'fetch', url: u, host: (() => { try { return new URL(u).hostname; } catch { return ''; } })() });
    return { ok: true, cached: false, url: u, ...payload, note: 'Conteúdo sanitizado (gate de saída §11).' };
  } catch (err) {
    return { ok: false, reason: `Falha ao ler a página: ${String(err && err.message || err)}`, code: (err && err.code) || 'FETCH_FAILED' };
  }
}

async function _recordSource(entry) {
  state.sources.push({ at: nowIso(), ...entry });
  await state.saveSources();
}

export async function listSources(limit = 50) {
  await _ensureLoaded();
  const n = Math.max(1, Math.min(MAX_SOURCES, parseInt(limit || 50, 10) || 50));
  return { ok: true, items: state.sources.slice(-n).reverse() };
}

/* ---------------- Catálogo de recursos ---------------- */
export async function catalogAdd(input = {}, { token = '' } = {}) {
  await _ensureLoaded();
  const sess = await _requireSession(token);
  if (!sess.ok) return { ok: false, reason: sess.reason || 'Internet não autorizada.', code: sess.code || 'NOT_AUTHORIZED' };
  const data = scrub(input).value || {};
  const name = String(data.name || data.title || '').slice(0, 160).trim();
  if (!name) return { ok: false, reason: 'Informe o nome do recurso.', code: 'EMPTY_NAME' };
  let kind = String(data.kind || 'outro').trim().toLowerCase();
  if (CATALOG_KINDS.indexOf(kind) === -1) kind = 'outro';
  const item = {
    id: 'res_' + Date.now().toString(36) + '_' + crypto.randomBytes(2).toString('hex'),
    name,
    kind,
    origin: String(data.origin || data.url || '').slice(0, 300).trim() || null,
    license: String(data.license || '').slice(0, 120).trim() || null,
    licenseUrl: String(data.licenseUrl || '').slice(0, 300).trim() || null,
    version: String(data.version || '').slice(0, 60).trim() || null,
    notes: String(data.notes || '').slice(0, 2000).trim() || null,
    createdAt: nowIso(),
  };
  if (state.catalog.length >= MAX_CATALOG) state.catalog = state.catalog.slice(-(MAX_CATALOG - 1));
  state.catalog.push(item);
  await state.saveCatalog();
  // Memória (Módulo 4): registrar o recurso aprovado com origem e licença.
  if (_memorySvc && typeof _memorySvc.register === 'function') {
    try {
      _memorySvc.register({
        kind: 'recurso', category: 'recursos',
        title: item.name,
        summary: [item.kind, item.license ? `licença: ${item.license}` : ''].filter(Boolean).join(' · '),
        content: item.notes || '',
        tags: [item.kind, item.license].filter(Boolean),
        source: { origin: item.origin || 'pesquisa', ref: item.origin || null },
        status: 'Pendente',
      }, null);
    } catch (e) { _log('memoria.register falhou (ignorado):', String(e?.message || e)); }
  }
  return { ok: true, item };
}

export async function listCatalog() {
  await _ensureLoaded();
  return { ok: true, items: [...state.catalog].reverse() };
}

export async function removeCatalog(id) {
  await _ensureLoaded();
  const before = state.catalog.length;
  state.catalog = state.catalog.filter(r => r.id !== String(id));
  const removed = before !== state.catalog.length;
  if (removed) await state.saveCatalog();
  return { ok: true, removed };
}

export async function cacheClear() {
  await _ensureLoaded();
  await state.cacheClear();
  return { ok: true };
}

export const CATALOG_KIND_OPTIONS = CATALOG_KINDS.slice();
export { MAX_FAILED_ATTEMPTS, LOCK_MS, SESSION_TTL_MS };

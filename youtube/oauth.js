/* =========================================================
 * youtube/oauth.js — Google OAuth 2.0 + YouTube (PARTE 8.1)
 * ---------------------------------------------------------
 * Fluxo oficial (Authorization Code + PKCE):
 *   CONECTAR CANAL → autorização Google → callback → tokens no backend.
 * Nunca pedimos nem armazenamos a senha do Google: apenas os tokens
 * retornados pelo Google, guardados criptografados (ver crypto.js).
 *
 * Escopos mínimos:
 *   - youtube.upload     (enviar vídeos)
 *   - youtube.readonly   (ler dados do canal conectado)
 *
 * Sem dependências novas: usa o fetch nativo do Node (>= 18).
 * =======================================================*/
import crypto from 'node:crypto';

const _log = (...a) => console.log('[YOUTUBE][oauth]', ...a);

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

/* Lê a configuração OAuth do ambiente (insumo externo do dono da conta). */
export function oauthConfig() {
  const clientId = String(process.env.YT_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.YT_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.YT_REDIRECT_URI || '').trim()
    || ('http://localhost:' + String(process.env.PORT || '3000') + '/api/youtube/oauth/callback');
  return { clientId, clientSecret, redirectUri, configured: !!(clientId && clientSecret) };
}

export function isConfigured() { return oauthConfig().configured; }

/* PKCE (S256) — protege o fluxo de autorização. */
export function makePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function newState() { return crypto.randomBytes(16).toString('hex'); }

export function buildAuthUrl({ clientId, redirectUri, state, codeChallenge }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return AUTH_URL + '?' + p.toString();
}

async function httpJson(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
    let data = null;
    const text = await r.text().catch(() => '');
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { ok: r.ok, status: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTokens(json, nowMs) {
  const now = nowMs || Date.now();
  const expiresIn = Number(json && json.expires_in) || 3600;
  return {
    accessToken: (json && json.access_token) || '',
    refreshToken: (json && json.refresh_token) || '',
    tokenType: (json && json.token_type) || 'Bearer',
    scope: (json && json.scope) || SCOPES.join(' '),
    expiresAt: new Date(now + expiresIn * 1000).toISOString(),
  };
}

export async function exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier }) {
  const body = new URLSearchParams({
    code: String(code || ''),
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  const r = await httpJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok || !r.data || !r.data.access_token) {
    return { ok: false, reason: (r.data && (r.data.error_description || r.data.error)) || ('Falha na troca de código (HTTP ' + r.status + ').') };
  }
  return { ok: true, tokens: normalizeTokens(r.data) };
}

export async function refreshAccessToken({ refreshToken, clientId, clientSecret }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: String(refreshToken || ''),
    grant_type: 'refresh_token',
  });
  const r = await httpJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok || !r.data || !r.data.access_token) {
    const code = (r.data && r.data.error) || '';
    return { ok: false, revoked: code === 'invalid_grant', reason: (r.data && (r.data.error_description || r.data.error)) || ('Falha ao renovar acesso (HTTP ' + r.status + ').') };
  }
  return { ok: true, tokens: normalizeTokens(r.data) };
}

export async function revokeToken(token) {
  const r = await httpJson(REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: String(token || '') }).toString(),
  });
  return { ok: r.ok, status: r.status };
}

/* Renova o token quando perto de expirar (margem de 60s). */
export async function ensureFresh({ tokens, clientId, clientSecret, marginSec = 60 }) {
  const expiresAt = tokens && tokens.expiresAt ? Date.parse(tokens.expiresAt) : 0;
  if (expiresAt && Date.now() < expiresAt - marginSec * 1000) return { ok: true, tokens, refreshed: false };
  if (!tokens || !tokens.refreshToken) return { ok: false, reason: 'Sem refresh_token: reconecte o canal.' };
  const r = await refreshAccessToken({ refreshToken: tokens.refreshToken, clientId, clientSecret });
  if (!r.ok) return r;
  // o Google não devolve novo refresh_token no refresh — preserva o atual
  return { ok: true, refreshed: true, tokens: Object.assign({}, r.tokens, { refreshToken: tokens.refreshToken }) };
}

export { _log as _oauthLog };

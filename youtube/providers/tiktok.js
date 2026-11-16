/* =========================================================
 * youtube/providers/tiktok.js — TikTok for Developers · OAuth + Post
 * ---------------------------------------------------------
 * Integração oficial (Login Kit + Content Posting API):
 *   - Autorização: https://www.tiktok.com/v2/auth/authorize/
 *   - Token/refresh: https://open.tiktokapis.com/v2/oauth/token/
 *   - Perfil:         https://open.tiktokapis.com/v2/user/info/
 *   - Publicar vídeo: /v2/post/publish/video/init/ (FILE_UPLOAD) + status
 *
 * Honestidade (regra do projeto):
 *   - NUNCA pedimos senha do TikTok: só tokens oficiais.
 *   - Sem TT_CLIENT_KEY/TT_CLIENT_SECRET a integração informa isso.
 *   - Publicar exige o app aprovado (auditoria do TikTok). App não auditado
 *     só consegue publicar como SELF_ONLY (privado) — informamos isso.
 * =======================================================*/
import fs from 'node:fs/promises';
import path from 'node:path';
import { httpJson, form, pickError } from './http.js';

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const API = 'https://open.tiktokapis.com/v2';

export const id = 'tiktok';
export const label = 'TikTok';
export const envVars = ['TT_CLIENT_KEY', 'TT_CLIENT_SECRET', 'TT_REDIRECT_URI (opcional)'];
export const authScopes = ['user.info.basic', 'video.publish'];
export const scopes = authScopes;
export const accountKind = 'conta TikTok';
export const usesPkce = false;
export const defaultVisibility = 'private';

/* privacy_level oficiais da Content Posting API. */
export const PRIVACY_LEVELS = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];

const MIME_BY_EXT = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/x-m4v' };

export function config() {
  const clientId = String(process.env.TT_CLIENT_KEY || '').trim();
  const clientSecret = String(process.env.TT_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.TT_REDIRECT_URI || '').trim()
    || ('http://localhost:' + String(process.env.PORT || '3000') + '/api/youtube/oauth/callback');
  return { clientId, clientSecret, redirectUri, configured: !!(clientId && clientSecret) };
}

export function buildAuthUrl({ clientId, redirectUri, state }) {
  const p = new URLSearchParams({
    client_key: clientId,
    response_type: 'code',
    scope: authScopes.join(','),
    redirect_uri: redirectUri,
    state,
  });
  return AUTH_URL + '?' + p.toString();
}

export async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  const r = await httpJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ client_key: clientId, client_secret: clientSecret, code: String(code || ''), grant_type: 'authorization_code', redirect_uri: redirectUri }),
  });
  const accessToken = r.data && r.data.access_token;
  if (!r.ok || !accessToken) {
    return { ok: false, reason: pickError(r.data, 'Falha na troca de código do TikTok (HTTP ' + r.status + ').') };
  }
  return { ok: true, tokens: normalize(r.data) };
}

export async function refresh({ refreshToken, clientId, clientSecret }) {
  if (!refreshToken) return { ok: false, reason: 'Sem refresh_token: reconecte a conta do TikTok.' };
  const cfg = config();
  const cid = clientId || cfg.clientId;
  const sec = clientSecret || cfg.clientSecret;
  const r = await httpJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ client_key: cid, client_secret: sec, grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const accessToken = r.data && r.data.access_token;
  if (!r.ok || !accessToken) {
    const revoked = r.status === 400 || r.status === 401;
    return { ok: false, revoked, reason: pickError(r.data, 'Falha ao renovar o token do TikTok (HTTP ' + r.status + ').') };
  }
  const merged = normalize(r.data);
  if (!merged.refreshToken) merged.refreshToken = refreshToken; // o TikTok costuma devolver, mas preserva por segurança
  return { ok: true, tokens: merged };
}

function normalize(json) {
  const j = json || {};
  const now = Date.now();
  const expiresIn = Number(j.expires_in) || 86400;
  const refreshExpiresIn = Number(j.refresh_expires_in) || 0;
  return {
    accessToken: j.access_token || '',
    refreshToken: j.refresh_token || '',
    tokenType: j.token_type || 'Bearer',
    scope: j.scope || authScopes.join(','),
    expiresAt: new Date(now + expiresIn * 1000).toISOString(),
    refreshExpiresAt: refreshExpiresIn ? new Date(now + refreshExpiresIn * 1000).toISOString() : null,
    openId: j.open_id || null,
  };
}

export async function identity(accessToken) {
  const r = await httpJson(API + '/user/info/?fields=open_id,union_id,avatar_url,display_name', {
    headers: { authorization: 'Bearer ' + accessToken },
  });
  const user = r.data && r.data.data && r.data.data.user;
  if (!r.ok || !user) {
    return { ok: false, reason: pickError(r.data, 'Não foi possível ler o perfil do TikTok (HTTP ' + r.status + ').') };
  }
  return {
    ok: true,
    account: {
      id: String(user.open_id || ''),
      name: user.display_name || 'TikTok',
      handle: '',
      avatar: user.avatar_url || '',
      kind: 'tiktok',
    },
  };
}

export async function revoke(token) {
  const cfg = config();
  const r = await httpJson(REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ client_key: cfg.clientId, client_secret: cfg.clientSecret, token: String(token || '') }),
  });
  return { ok: r.ok, status: r.status };
}

function mimeFor(filePath) {
  return MIME_BY_EXT[path.extname(String(filePath || '')).toLowerCase()] || 'video/mp4';
}

/* Traduz a visibilidade do AutoClips para o privacy_level do TikTok. */
function privacyFor(visibility, audited) {
  const v = String(visibility || '').toLowerCase();
  if (!audited) return 'SELF_ONLY';                 // app não auditado: só privado
  if (v === 'public' || v === 'unlisted') return 'PUBLIC_TO_EVERYONE';
  return 'SELF_ONLY';
}

/*
 * Publica um vídeo via Content Posting API (FILE_UPLOAD, arquivo local).
 * Retorna { ok, code?, reason?, url?, videoId?, scheduled? }.
 */
export async function publish({ accessToken, filePath, metadata, visibility, scheduledAt }) {
  if (scheduledAt) {
    return { ok: false, code: 'agendamento_nao_suportado', reason: 'A Content Posting API do TikTok não expõe agendamento por API: publique agora ou exporte o vídeo para agendar no app.' };
  }
  let stat;
  try { stat = await fs.stat(filePath); } catch { return { ok: false, code: 'validacao', reason: 'Arquivo de vídeo não encontrado no servidor.' }; }
  if (!stat.isFile() || stat.size <= 0) return { ok: false, code: 'validacao', reason: 'Arquivo de vídeo inválido.' };

  const m = metadata || {};
  const title = String(m.title || '').trim().slice(0, 150) || 'Corte';
  const audited = String(process.env.TT_APP_AUDITED || '').toLowerCase() === 'true';
  const privacy = privacyFor(visibility, audited);

  const init = await httpJson(API + '/post/publish/video/init/', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: { title, privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false },
      source_info: { source: 'FILE_UPLOAD', video_size: stat.size, chunk_size: stat.size, total_chunk_count: 1 },
    }),
  });
  const d = init.data && init.data.data;
  if (!init.ok || !d || !d.upload_url) {
    return { ok: false, code: 'upload', reason: pickError(init.data, 'O TikTok recusou iniciar o upload (HTTP ' + init.status + '). App pode não estar aprovado para publicação.') };
  }
  const publishId = d.publish_id;

  // Envia os bytes do arquivo local.
  let buf;
  try { buf = await fs.readFile(filePath); } catch (e) { return { ok: false, code: 'upload', reason: 'Falha ao ler o arquivo: ' + String((e && e.message) || e) }; }
  const put = await httpJson(d.upload_url, {
    method: 'PUT',
    headers: { 'content-type': mimeFor(filePath), 'content-range': 'bytes 0-' + (buf.length - 1) + '/' + buf.length },
    body: buf,
  }, 120000);
  if (!put.ok) return { ok: false, code: 'upload', reason: pickError(put.data, 'Falha no upload para o TikTok (HTTP ' + put.status + ').') };

  // Verifica o processamento final.
  let last = null;
  for (let i = 0; i < 20; i++) {
    const st = await httpJson(API + '/post/publish/status/fetch/', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ publish_id: publishId }),
    });
    last = st.data && st.data.data;
    const status = last && last.status;
    if (status === 'PUBLISH_COMPLETE') {
      return { ok: true, videoId: publishId, url: null, scheduled: false, privacy };
    }
    if (status === 'FAILED') {
      return { ok: false, code: 'upload', reason: (last && last.fail_reason) || 'O TikTok informou falha na publicação.' };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { ok: false, code: 'upload', reason: 'O TikTok ainda está processando o vídeo (publish_id ' + publishId + '). Consulte o status no TikTok.' };
}

export default { id, label, envVars, scopes, config, buildAuthUrl, exchangeCode, refresh, identity, revoke, publish };

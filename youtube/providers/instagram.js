/* =========================================================
 * youtube/providers/instagram.js — Instagram (Meta) · OAuth + Reels
 * ---------------------------------------------------------
 * Integração oficial "Instagram API with Instagram Login"
 * (contas Business/Creator):
 *   - Autorização: https://www.instagram.com/oauth/authorize
 *   - Troca de código: https://api.instagram.com/oauth/access_token
 *   - Token de longa duração (60 dias) + renovação: graph.instagram.com
 *   - Publicação de Reels: /{ig-user-id}/media → media_publish
 *
 * Honestidade (regra do projeto):
 *   - NUNCA pedimos senha do Instagram: só tokens oficiais.
 *   - Sem IG_CLIENT_ID/IG_CLIENT_SECRET a integração informa isso.
 *   - A publicação de Reels exige o vídeo em URL PÚBLICA (a Meta baixa
 *     a mídia) e app Meta com a permissão de publicação aprovada.
 *     Quando faltar, devolvemos o motivo real, sem fingir envio.
 * =======================================================*/
import { httpJson, form, pickError } from './http.js';

const AUTH_URL = 'https://www.instagram.com/oauth/authorize';
const TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH = 'https://graph.instagram.com';
const API_VER = 'v21.0';

export const id = 'instagram';
export const label = 'Instagram';
export const envVars = ['IG_CLIENT_ID', 'IG_CLIENT_SECRET', 'IG_REDIRECT_URI (opcional)'];
export const authScopes = ['instagram_business_basic', 'instagram_business_content_publish'];
export const scopes = authScopes;
export const accountKind = 'conta profissional (Business/Creator)';
export const usesPkce = false;
export const defaultVisibility = 'public';

const LONG_LIVED_SECONDS = 60 * 24 * 60 * 60; // 60 dias

export function config() {
  const clientId = String(process.env.IG_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.IG_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.IG_REDIRECT_URI || '').trim()
    || ('http://localhost:' + String(process.env.PORT || '3000') + '/api/youtube/oauth/callback');
  return { clientId, clientSecret, redirectUri, configured: !!(clientId && clientSecret) };
}

export function buildAuthUrl({ clientId, redirectUri, state }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: authScopes.join(','),
    state,
  });
  return AUTH_URL + '?' + p.toString();
}

/* Código → token curto → token de longa duração (60 dias). */
export async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  const r = await httpJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code: String(code || '') }),
  });
  const shortToken = r.data && r.data.access_token;
  if (!r.ok || !shortToken) {
    return { ok: false, reason: pickError(r.data, 'Falha na troca de código do Instagram (HTTP ' + r.status + ').') };
  }
  // Troca por token de longa duração (best-effort: se falhar, usa o curto).
  const long = await httpJson(GRAPH + '/access_token?grant_type=ig_exchange_token&client_secret=' + encodeURIComponent(clientSecret) + '&access_token=' + encodeURIComponent(shortToken));
  const useLong = long.ok && long.data && long.data.access_token;
  const accessToken = useLong ? long.data.access_token : shortToken;
  const expiresIn = Number((useLong && long.data.expires_in) || r.data.expires_in) || (useLong ? LONG_LIVED_SECONDS : 3600);
  return {
    ok: true,
    tokens: {
      accessToken,
      refreshToken: '',
      tokenType: 'Bearer',
      scope: String((r.data && r.data.permissions) || authScopes.join(',')),
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      userId: (r.data && r.data.user_id) ? String(r.data.user_id) : null,
      longLived: !!useLong,
    },
  };
}

/* O Instagram renova com o PRÓPRIO access_token (não usa refresh_token). */
export async function refresh({ accessToken, refreshToken }) {
  const t = String(refreshToken || accessToken || '').trim();
  if (!t) return { ok: false, reason: 'Sem token para renovar: reconecte a conta.' };
  const r = await httpJson(GRAPH + '/refresh_access_token?grant_type=ig_refresh_token&access_token=' + encodeURIComponent(t));
  const tok = r.data && r.data.access_token;
  if (!r.ok || !tok) {
    const revoked = r.status === 400 || r.status === 401;
    return { ok: false, revoked, reason: pickError(r.data, 'Falha ao renovar o token do Instagram (HTTP ' + r.status + ').') };
  }
  const expiresIn = Number(r.data.expires_in) || LONG_LIVED_SECONDS;
  return {
    ok: true,
    tokens: {
      accessToken: tok, refreshToken: '', tokenType: 'Bearer',
      scope: authScopes.join(','), expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), longLived: true,
    },
  };
}

/* Identidade da conta profissional conectada. */
export async function identity(accessToken) {
  const r = await httpJson(GRAPH + '/' + API_VER + '/me?fields=user_id,username,name,account_type,profile_picture_url&access_token=' + encodeURIComponent(accessToken));
  if (!r.ok || !r.data) {
    return { ok: false, reason: pickError(r.data, 'Não foi possível ler o perfil do Instagram (HTTP ' + r.status + ').') };
  }
  const u = r.data || {};
  return {
    ok: true,
    account: {
      id: String(u.user_id || u.id || ''),
      name: u.name || u.username || '',
      handle: u.username ? ('@' + u.username) : '',
      avatar: u.profile_picture_url || '',
      kind: u.account_type || '',
    },
  };
}

/* O Instagram não expõe endpoint de revogação de token: removemos localmente. */
export async function revoke() { return { ok: true, local: true }; }

function buildCaption(metadata) {
  const m = metadata || {};
  const title = String(m.title || '').trim();
  const description = String(m.description || '').trim();
  const tags = (Array.isArray(m.tags) ? m.tags : []).map((t) => String(t || '').trim()).filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : '#' + t.replace(/\s+/g, '')));
  return [title, description, tags.join(' ')].filter(Boolean).join('\n\n').slice(0, 2200);
}

/*
 * Publica um Reels. exige URL pública do vídeo (a Meta baixa a mídia).
 * Retorna sempre { ok, code?, reason?, url?, videoId?, scheduled? }.
 */
export async function publish({ accessToken, account, publicVideoUrl, metadata, scheduledAt }) {
  if (scheduledAt) {
    return { ok: false, code: 'agendamento_nao_suportado', reason: 'A API do Instagram não permite agendar Reels: publique agora ou exporte o vídeo para agendar no app do Instagram.' };
  }
  const igUserId = String((account && account.account && account.account.id) || '').trim();
  if (!igUserId) return { ok: false, code: 'conta_invalida', reason: 'Conta do Instagram sem identificador: reconecte a conta.' };
  if (!publicVideoUrl) {
    return {
      ok: false, code: 'url_publica_necessaria',
      reason: 'A publicação de Reels exige o vídeo em uma URL pública (a Meta baixa a mídia). Configure AUTOCLIPS_PUBLIC_BASE_URL apontando para este servidor ou exporte o vídeo para publicar manualmente no app.',
    };
  }

  const caption = buildCaption(metadata);
  const body = form({ media_type: 'REELS', video_url: publicVideoUrl, caption, share_to_feed: 'true', access_token: accessToken });
  const media = await httpJson(GRAPH + '/' + API_VER + '/' + encodeURIComponent(igUserId) + '/media', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  const containerId = media.data && media.data.id;
  if (!media.ok || !containerId) {
    return { ok: false, code: 'upload', reason: pickError(media.data, 'A Meta recusou a criação do container de Reels (HTTP ' + media.status + ').') };
  }

  // Aguarda o processamento do vídeo (a Meta baixa e prepara a mídia).
  for (let i = 0; i < 30; i++) {
    const st = await httpJson(GRAPH + '/' + API_VER + '/' + encodeURIComponent(containerId) + '?fields=status_code,status&access_token=' + encodeURIComponent(accessToken));
    const code = st.data && st.data.status_code;
    if (code === 'FINISHED') break;
    if (code === 'ERROR' || code === 'EXPIRED') {
      return { ok: false, code: 'upload', reason: (st.data && st.data.status) || 'A Meta falhou ao processar o vídeo.' };
    }
    if (i === 29) return { ok: false, code: 'upload', reason: 'A Meta ainda está processando o vídeo; tente novamente em instantes (a criação do container expira em 24h).' };
    await new Promise((r) => setTimeout(r, 5000));
  }

  const pub = await httpJson(GRAPH + '/' + API_VER + '/' + encodeURIComponent(igUserId) + '/media_publish', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ creation_id: containerId, access_token: accessToken }),
  });
  const mediaId = pub.data && pub.data.id;
  if (!pub.ok || !mediaId) {
    return { ok: false, code: 'upload', reason: pickError(pub.data, 'A Meta recusou a publicação do Reels (HTTP ' + pub.status + ').') };
  }
  return { ok: true, videoId: String(mediaId), url: 'https://www.instagram.com/reel/' + String(mediaId), scheduled: false };
}

export default { id, label, envVars, scopes, config, buildAuthUrl, exchangeCode, refresh, identity, revoke, publish };

/* =========================================================
 * youtube/client.js — Cliente da YouTube Data API v3 (PARTE 8)
 * ---------------------------------------------------------
 * Chamadas oficiais via fetch nativo (sem dependências novas):
 *   - channels.list  (canal conectado)
 *   - videos.insert  (upload resumable)
 *   - videos.update  (ajustar metadados/visibilidade)
 *   - videos.list    (status do vídeo publicado)
 *
 * IMPORTANTE (regra do projeto): a API oficial NÃO baixa o vídeo
 * original a partir de uma URL qualquer — o envio é sempre feito
 * a partir de um ARQUIVO local já renderizado.
 * =======================================================*/
import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';
const _log = (...a) => console.log('[YOUTUBE][client]', ...a);

export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // trava de segurança (evita estourar memória)

const MIME_BY_EXT = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.m4v': 'video/x-m4v',
};

export function mimeForFile(filePath) {
  return MIME_BY_EXT[path.extname(String(filePath || '')).toLowerCase()] || 'video/*';
}

async function httpJson(url, opts = {}, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
    const text = await r.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { ok: r.ok, status: r.status, data, headers: r.headers };
  } finally {
    clearTimeout(timer);
  }
}

function apiError(r) {
  const e = (r && r.data && r.data.error) || {};
  const msg = e.message || ('Falha na chamada à API (HTTP ' + (r && r.status) + ').');
  const reason = (e.errors && e.errors[0] && e.errors[0].reason) || '';
  return { ok: false, status: r && r.status, reason: msg, apiReason: reason, quota: reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' };
}

/* Canal conectado (8.1 / 8.2). */
export async function fetchMyChannel(accessToken) {
  const url = API + '/channels?part=snippet,statistics,contentDetails&mine=true';
  const r = await httpJson(url, { headers: { authorization: 'Bearer ' + accessToken } });
  if (!r.ok) return apiError(r);
  const items = (r.data && r.data.items) || [];
  if (!items.length) return { ok: false, reason: 'Nenhum canal encontrado para esta conta Google.' };
  const c = items[0];
  return {
    ok: true,
    channel: {
      id: c.id,
      title: (c.snippet && c.snippet.title) || '',
      handle: (c.snippet && c.snippet.customUrl) || '',
      description: (c.snippet && c.snippet.description) || '',
      thumbnail: (c.snippet && c.snippet.thumbnails && (c.snippet.thumbnails.default || {}).url) || '',
      country: (c.snippet && c.snippet.country) || '',
      subscriberCount: (c.statistics && c.statistics.subscriberCount) || null,
      videoCount: (c.statistics && c.statistics.videoCount) || null,
    },
  };
}

/* Upload resumable (8.3). Envia um ARQUIVO LOCAL. */
export async function uploadVideo({ accessToken, filePath, snippet, status, timeoutMs = 120000 }) {
  let stat;
  try { stat = await fs.stat(filePath); } catch { return { ok: false, reason: 'Arquivo de vídeo não encontrado: ' + filePath }; }
  if (!stat.isFile()) return { ok: false, reason: 'O caminho informado não é um arquivo.' };
  if (stat.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'Arquivo grande demais para envio (limite de ' + Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)) + ' MB nesta versão).' };
  }
  const mime = mimeForFile(filePath);

  // 1) Inicia a sessão de upload resumable
  const init = await httpJson(UPLOAD + '?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + accessToken,
      'content-type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(stat.size),
      'X-Upload-Content-Type': mime,
    },
    body: JSON.stringify({ snippet: snippet || {}, status: status || {} }),
  });
  if (!init.ok) return apiError(init);
  const location = init.headers && init.headers.get && init.headers.get('location');
  if (!location) return { ok: false, reason: 'O Google não retornou a URL de upload.' };

  // 2) Envia os bytes do arquivo
  let buf;
  try { buf = await fs.readFile(filePath); } catch (e) { return { ok: false, reason: 'Falha ao ler o arquivo: ' + String((e && e.message) || e) }; }
  const put = await httpJson(location, {
    method: 'PUT',
    headers: { 'content-type': mime, 'content-length': String(buf.length) },
    body: buf,
  }, timeoutMs);
  if (!put.ok) return apiError(put);
  const v = (put.data && put.data.id) ? put.data : null;
  if (!v) return { ok: false, reason: 'Resposta inesperada do YouTube no upload.' };
  return { ok: true, video: { id: v.id, snippet: v.snippet || {}, status: v.status || {} } };
}

/* Ajusta metadados/visibilidade de um vídeo já enviado (ex.: agendar). */
export async function updateVideo({ accessToken, videoId, snippet, status }) {
  const body = { id: videoId };
  if (snippet) body.snippet = snippet;
  if (status) body.status = status;
  const r = await httpJson(API + '/videos?part=snippet,status', {
    method: 'PUT',
    headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return apiError(r);
  const v = r.data && r.data.items ? r.data.items[0] : null;
  return { ok: true, video: v ? { id: v.id, snippet: v.snippet || {}, status: v.status || {} } : null };
}

/* Estatísticas em lote (PARTE 9 — Analytics). Aceita até 50 ids por chamada. */
export const MAX_STATS_BATCH = 50;

export async function fetchVideosStats({ accessToken, videoIds }) {
  const ids = (videoIds || []).map((v) => String(v || '').trim()).filter(Boolean);
  if (!ids.length) return { ok: true, videos: [] };
  const out = [];
  for (let i = 0; i < ids.length; i += MAX_STATS_BATCH) {
    const chunk = ids.slice(i, i + MAX_STATS_BATCH);
    const r = await httpJson(API + '/videos?part=snippet,statistics&id=' + encodeURIComponent(chunk.join(',')), {
      headers: { authorization: 'Bearer ' + accessToken },
    });
    if (!r.ok) return apiError(r);
    for (const v of ((r.data && r.data.items) || [])) {
      out.push({
        id: v.id,
        title: (v.snippet && v.snippet.title) || '',
        publishedAt: (v.snippet && v.snippet.publishedAt) || '',
        statistics: v.statistics || {},
      });
    }
  }
  return { ok: true, videos: out };
}

/* Status atual de um vídeo (verificação pós-publicação). */
export async function fetchVideo({ accessToken, videoId }) {
  const r = await httpJson(API + '/videos?part=snippet,status,statistics&id=' + encodeURIComponent(videoId), {
    headers: { authorization: 'Bearer ' + accessToken },
  });
  if (!r.ok) return apiError(r);
  const v = r.data && r.data.items ? r.data.items[0] : null;
  if (!v) return { ok: false, reason: 'Vídeo não encontrado (pode ter sido removido).' };
  return { ok: true, video: { id: v.id, snippet: v.snippet || {}, status: v.status || {}, statistics: v.statistics || {} } };
}

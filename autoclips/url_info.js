/* =========================================================
 * autoclips/url_info.js — Metadados reais de um vídeo por URL
 * ---------------------------------------------------------
 * Busca SOMENTE informações públicas (oEmbed / Open Graph):
 *   título, autor, miniatura e duração quando disponíveis.
 *
 * O que este módulo NÃO faz (honestidade):
 *   - não baixa o vídeo;
 *   - não contorna DRM, bloqueios ou autenticação;
 *   - não obtém transcrição (isso é insumo do usuário/Etapa 3).
 *
 * Se o gate NETWORK_OUTBOUND_ENABLED=off, nada é buscado.
 * =======================================================*/
const _log = (...a) => console.log('[AUTOCLIPS][url_info]', ...a);

const UA = 'Mozilla/5.0 (compatible; TIAgente-AutoClips/1.0)';
const DEFAULT_TIMEOUT = 9000;

function gateOpen() {
  return String(process.env.NETWORK_OUTBOUND_ENABLED || 'on').trim().toLowerCase() !== 'off';
}

async function getText(url, { timeoutMs = DEFAULT_TIMEOUT, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: Object.assign({ 'user-agent': UA, accept: 'text/html,application/json,*/*' }, headers),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function getJson(url, opts) {
  const r = await getText(url, opts);
  if (!r.ok) return { ok: false, status: r.status, reason: 'HTTP ' + r.status };
  try { return { ok: true, data: JSON.parse(r.body) }; }
  catch { return { ok: false, reason: 'Resposta não é JSON.' }; }
}

/* Extrai <meta property="og:*"> e <title> de um HTML. */
function parseOpenGraph(html) {
  const pick = (prop) => {
    const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
    const m = html.match(re);
    return m ? decodeEntities(m[1]) : null;
  };
  const titleTag = (() => {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? decodeEntities(m[1]).trim() : null;
  })();
  const dur = pick('og:video:duration') || pick('video:duration') || pick('og:video:tag');
  return {
    title: pick('og:title') || pick('twitter:title') || titleTag,
    description: pick('og:description') || pick('twitter:description') || pick('description'),
    thumbnail: pick('og:image') || pick('twitter:image'),
    duration: Number.isFinite(Number(dur)) ? Number(dur) : null,
    siteName: pick('og:site_name'),
  };
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; }
}

/* oEmbed do YouTube (público, sem chave). */
async function youTubeOEmbed(url, opts) {
  const r = await getJson('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url), opts);
  if (!r.ok) return null;
  const d = r.data || {};
  return {
    provider: 'YouTube', title: d.title || null, author: d.author_name || null,
    thumbnail: d.thumbnail_url || null, duration: null,
    width: d.width || null, height: d.height || null,
  };
}

/* oEmbed do Vimeo (público, sem chave). */
async function vimeoOEmbed(url, opts) {
  const r = await getJson('https://vimeo.com/api/oembed.json?url=' + encodeURIComponent(url), opts);
  if (!r.ok) return null;
  const d = r.data || {};
  return {
    provider: 'Vimeo', title: d.title || null, author: d.author_name || null,
    thumbnail: d.thumbnail_url || null, duration: Number.isFinite(Number(d.duration)) ? Number(d.duration) : null,
    width: d.width || null, height: d.height || null,
  };
}

/* API pública do Dailymotion. */
async function dailymotionInfo(url, opts) {
  const id = (String(url).match(/video\/([a-zA-Z0-9]+)/) || [])[1];
  if (!id) return null;
  const r = await getJson('https://api.dailymotion.com/video/' + id + '?fields=title,owner.screenname,thumbnail_720_url,duration', opts);
  if (!r.ok) return null;
  const d = r.data || {};
  return {
    provider: 'Dailymotion', title: d.title || null, author: d['owner.screenname'] || null,
    thumbnail: d.thumbnail_720_url || null, duration: Number.isFinite(Number(d.duration)) ? Number(d.duration) : null,
  };
}

/* Busca metadados reais do vídeo. Nunca lança: devolve { ok, reason }. */
export async function fetchVideoInfo(rawUrl, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
  const value = String(rawUrl || '').trim();
  if (!value) return { ok: false, reason: 'URL vazia.' };
  let u; try { u = new URL(value); } catch { return { ok: false, reason: 'Endereço inválido.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Apenas http(s).' };
  if (!gateOpen()) return { ok: false, code: 'internet_off', reason: 'Saída de rede desligada (NETWORK_OUTBOUND_ENABLED=off).' };

  const h = host(value);
  const opts = { timeoutMs };
  const tried = [];

  try {
    let info = null;
    if (h.endsWith('youtube.com') || h === 'youtu.be') { info = await youTubeOEmbed(value, opts); tried.push('youtube-oembed'); }
    else if (h.endsWith('vimeo.com')) { info = await vimeoOEmbed(value, opts); tried.push('vimeo-oembed'); }
    else if (h.endsWith('dailymotion.com') || h === 'dai.ly') { info = await dailymotionInfo(value, opts); tried.push('dailymotion-api'); }

    // Fallback: Open Graph da própria página (funciona em muitos sites).
    if (!info || (!info.title && !info.thumbnail)) {
      const page = await getText(value, opts);
      tried.push('open-graph');
      if (page.ok) {
        const og = parseOpenGraph(page.body);
        info = {
          provider: (info && info.provider) || og.siteName || h || 'Site',
          title: (info && info.title) || og.title || null,
          author: (info && info.author) || null,
          thumbnail: (info && info.thumbnail) || og.thumbnail || null,
          duration: (info && info.duration) || og.duration || null,
          description: og.description || null,
        };
      }
    }

    if (!info || (!info.title && !info.thumbnail)) {
      return { ok: false, reason: 'Não foi possível ler informações públicas desta página.', tried };
    }

    const durNum = (info.duration == null || info.duration === '') ? null : Number(info.duration);
    return {
      ok: true,
      url: u.toString(),
      host: h,
      provider: info.provider || h,
      title: info.title || null,
      author: info.author || null,
      thumbnail: info.thumbnail || null,
      duration: Number.isFinite(durNum) ? durNum : null,
      description: info.description || null,
      width: info.width || null,
      height: info.height || null,
      fetchedAt: new Date().toISOString(),
      tried,
      note: 'Metadados públicos (oEmbed/Open Graph). Sem download do vídeo e sem contornar proteções.',
    };
  } catch (e) {
    const msg = String((e && e.message) || e);
    _log('fetchVideoInfo erro: ' + msg);
    return { ok: false, reason: 'Falha ao consultar a URL: ' + msg, tried };
  }
}

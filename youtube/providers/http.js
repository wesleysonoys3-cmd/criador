/* =========================================================
 * youtube/providers/http.js — helper HTTP dos provedores OAuth
 * ---------------------------------------------------------
 * Pequeno utilitário compartilhado por instagram.js e tiktok.js.
 * Usa o fetch nativo do Node (>= 18): sem dependências novas.
 * =======================================================*/

export async function httpJson(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
    const text = await r.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { ok: r.ok, status: r.status, data, headers: r.headers };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

export function form(obj) {
  return new URLSearchParams(
    Object.keys(obj || {}).reduce((acc, k) => {
      const v = obj[k];
      if (v !== undefined && v !== null && v !== '') acc[k] = String(v);
      return acc;
    }, {})
  ).toString();
}

/* Extrai a mensagem de erro de respostas variadas das APIs da Meta/TikTok. */
export function pickError(data, fallback) {
  if (!data) return fallback;
  const d = data.error || data.errors;
  if (typeof data.error_message === 'string' && data.error_message) return data.error_message;
  if (typeof data.message === 'string' && data.message) return data.message;
  if (d && typeof d === 'object') {
    if (typeof d.message === 'string' && d.message) return d.message;
    if (typeof d.error_user_msg === 'string' && d.error_user_msg) return d.error_user_msg;
  }
  if (typeof data.raw === 'string' && data.raw) return data.raw.slice(0, 300);
  return fallback;
}

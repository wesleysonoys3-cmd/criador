// browser_agent.mjs · Browser Agent v1 MÍNIMO (2 funções: browserOpen + browserGetPageInfo)
// Objetivo: abrir página web em navegador e extrair info básica (title, preview, links, meta).
// SEM cliques / SEM login / SEM formulários (versão 1 do usuário).
//
// Backends automáticos (escolhido no init):
//   A) MCP integrated_browser (quando rodando DENTRO do ambiente TRAE / IDE com MCP server ativado)
//      → navegação de verdade com browser controlado via MCP tools.
//   B) Fallback fetch+parseHtml (standalone / sem MCP) → usa safeFetchInternet + parser regex leve
//      → extrai title / meta description / hrefs / text preview. Títulos e links funcionam.
//
// Proteções herdadas do NET_OUTBOUND + isAllowedOutboundDomain:
//   - Só HTTP/HTTPS.
//   - Whitelist de domínios NETWORK_OUTBOUND_WHITELIST.
//   - Bloqueia IP privado (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10, *.local, *.corp).
//   - sanitizeForInternet em todos os campos devolvidos ao LLM (REDACT keys).

export class BrowserAgent {
  constructor({ allowFn = null, sanitizeFn = null, netEnabled = true, webFetchToolEnabled = true, fetchFn = null } = {}) {
    this.contexts = new Map();
    this.counter = 1;
    this.allowFn = allowFn || (() => ({ ok: true }));
    this.sanitizeFn = sanitizeFn || ((x) => String(x || ''));
    this.netEnabled = !!netEnabled;
    this.webFetchToolEnabled = !!webFetchToolEnabled;
    this.fetchFn = fetchFn || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    this.mcpRun = typeof (globalThis.__MCP_BRIDGE__ && globalThis.__MCP_BRIDGE__.run) === 'function' ? globalThis.__MCP_BRIDGE__.run : null;
    this.backend = this.mcpRun ? 'MCP_INTEGRATED_BROWSER' : 'FETCH_PARSE';
  }

  // ===================== HELPERS PARSER HTML LEVE (fallback sem browser real) =====================
  _stripTags(html) {
    return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  _parseHtmlLight(html) {
    const s = String(html || '');
    const titleMatch = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descMatch = s.match(/<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']{0,500})["']/i) || s.match(/<meta[^>]+content\s*=\s*["']([^"']{0,500})["'][^>]*name\s*=\s*["']description["']/i);
    const hrefs = [];
    const hrefRe = /<a\s[^>]*?href\s*=\s*(["'])([^"']{1,2000})\1/gi; let m;
    while ((m = hrefRe.exec(s)) !== null) hrefs.push(m[2]);
    return { title: titleMatch ? this._stripTags(titleMatch[1]).slice(0, 200) : '', description: descMatch ? this._stripTags(descMatch[1]).slice(0, 500) : '', hrefs };
  }

  // ===================== VALIDAÇÃO URL + WHITELIST / IP PRIVADO =====================
  _validateUrl(rawUrl) {
    if (!this.netEnabled) return { ok: false, reason: 'NETWORK_OUTBOUND_ENABLED=off (gate geral fechado).', code: 'GATE_OFF' };
    if (!this.webFetchToolEnabled) return { ok: false, reason: 'Ferramenta web_fetch / browser desligada (NETWORK_OUTBOUND_TOOL_WEB_FETCH=off).', code: 'TOOL_OFF' };
    if (!rawUrl || typeof rawUrl !== 'string') return { ok: false, reason: 'url inválida (vazia).', code: 'URL_INVALID' };
    let u; try { u = new URL(rawUrl.trim()); } catch { return { ok: false, reason: `URL malformada: ${String(rawUrl).slice(0, 200)}`, code: 'URL_INVALID' }; }
    if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, reason: `Protocolo não permitido: ${u.protocol} (só http/https).`, code: 'PROTOCOL_DENIED' };
    const alw = this.allowFn(u.href); if (alw && alw.ok === false) return { ok: false, reason: alw.reason || 'domínio não permitido.', code: 'HOST_DENIED' };
    return { ok: true, url: u.href, host: u.hostname };
  }

  // ===================== browserOpen(url) → contexto com browser aberto =====================
  async open(rawUrl, opts = {}) {
    const v = this._validateUrl(rawUrl); if (!v.ok) return { ok: false, error: v.reason, code: v.code };
    const timeoutMs = Math.max(5000, Math.min(120000, parseInt(opts.timeoutMs || '60000', 10)));
    const ctx = { id: 'br_' + Date.now().toString(36) + '_' + (this.counter++), url: v.url, host: v.host, backend: this.backend, openAtMs: Date.now(), lastInfo: null };
    let fetched;
    try {
      if (this.backend === 'FETCH_PARSE') {
        fetched = await this._openFetch(ctx, { timeoutMs });
      } else {
        fetched = await this._openMcp(ctx, { timeoutMs });
      }
      if (fetched && fetched.ok === false) return fetched;
      this.contexts.set(ctx.id, ctx);
      return { ok: true, contextId: ctx.id, backend: this.backend, title: ctx.lastInfo?.title || '', finalUrl: ctx.lastInfo?.url || v.url, status: ctx.lastInfo?.status || 200 };
    } catch (err) {
      return { ok: false, error: `browser_open falhou: ${err.message || String(err)}`, code: err.code || 'OPEN_FAILED' };
    }
  }

  async _openFetch(ctx, { timeoutMs }) {
    if (!this.fetchFn) return { ok: false, error: 'FETCH backend requer fetchFn ou globalThis.fetch.', code: 'FETCH_MISSING' };
    const signal = typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(timeoutMs) : undefined;
    const res = await this.fetchFn(ctx.url, { redirect: 'follow', signal, headers: { 'User-Agent': 'Mozilla/5.0 TiAgente-BrowserAgent/v1 (fetch fallback; research only)' } });
    const contentType = res.headers.get('content-type') || '';
    if (!/text|html|json|xml|markdown/i.test(contentType)) return { ok: false, error: `Tipo de conteúdo bloqueado: ${contentType.slice(0, 100)} (só text/html).`, code: 'CONTENT_BLOCKED' };
    const html = await res.text();
    const parsed = this._parseHtmlLight(html);
    const preview = this.sanitizeFn(this._stripTags(html)).slice(0, 10000);
    ctx.lastInfo = { backend: 'FETCH_PARSE', status: res.status, url: res.url || ctx.url, title: this.sanitizeFn(parsed.title), description: this.sanitizeFn(parsed.description), links: parsed.hrefs.slice(0, 100).map(h => this.sanitizeFn(h)), textPreview: preview, contentType };
    return { ok: true };
  }

  async _openMcp(ctx, { timeoutMs }) {
    try {
      // Passo 1: navigate
      await this._callMcp('browser_navigate', { url: ctx.url, wait_ms: 2500 });
      // Passo 2: snapshot
      const snap = await this._callMcp('browser_snapshot', {}) || {};
      const title = (snap && snap.title) ? snap.title : '';
      const preview = (snap && snap.contentText) ? String(snap.contentText) : '';
      const links = Array.isArray(snap.links) ? snap.links.map(l => typeof l === 'string' ? l : (l.href || l.url || '')).filter(Boolean) : [];
      ctx.lastInfo = { backend: 'MCP_INTEGRATED_BROWSER', status: 200, url: snap.url || ctx.url, title: this.sanitizeFn(title), description: this.sanitizeFn(''), links: links.slice(0, 100).map(l => this.sanitizeFn(l)), textPreview: this.sanitizeFn(preview).slice(0, 10000), contentType: 'text/html' };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `MCP browser falhou: ${err.message || String(err)}`, code: 'MCP_FAILED' };
    }
  }

  async _callMcp(tool, args) {
    if (!this.mcpRun) throw new Error('MCP bridge não disponível.');
    return await this.mcpRun('integrated_browser', tool, args || {});
  }

  // ===================== browserGetPageInfo(contextId) → info da página aberta =====================
  getInfo(contextId) {
    const ctx = this.contexts.get(String(contextId || ''));
    if (!ctx) return { ok: false, error: 'contexto browser não existe (já fechado ou nunca aberto).', code: 'CONTEXT_NOT_FOUND' };
    const info = ctx.lastInfo;
    if (!info) return { ok: false, error: 'contexto existe mas nenhuma página foi carregada ainda.', code: 'NO_PAGE_INFO' };
    return { ok: true, contextId: ctx.id, backend: ctx.backend, openAtMs: ctx.openAtMs, status: info.status || 200, finalUrl: info.url, title: info.title, description: info.description, textPreview: info.textPreview, links: Array.isArray(info.links) ? info.links.slice(0, 100) : [], linksCount: Array.isArray(info.links) ? info.links.length : 0, contentType: info.contentType || '' };
  }

  close(contextId) { if (contextId) this.contexts.delete(String(contextId)); else this.contexts.clear(); }
}

// Singleton opcional para tool registry usar (lazy init via server.js)
export function createBrowserAgent(opts) { return new BrowserAgent(opts); }

export default BrowserAgent;

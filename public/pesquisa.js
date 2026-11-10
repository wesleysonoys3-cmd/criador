/* =========================================================
 * public/pesquisa.js — Aba "Pesquisa e Recursos" (frontend)
 * ---------------------------------------------------------
 * Consome somente /api/pesquisa/* (backend pesquisa/service.js).
 * Fluxo do Módulo 2:
 *   • Autorização por PIN (sessão com validade/revogação).
 *   • Pesquisa na internet (com cache) consumindo o gate §11.
 *   • Catálogo de recursos com origem/licença/versão.
 *   • Registro de fontes consultadas.
 * O PIN nunca é armazenado: é usado só para obter a sessão; guardamos
 * apenas o token da sessão (sessionStorage, some ao fechar a aba).
 * =======================================================*/

const API = '/api/pesquisa';
const TOKEN_KEY = 'psq_token_v1';

const STATE = {
  inited: false,
  view: 'loading',   // loading | setup | auth | main
  status: null,
  token: (() => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } })(),
  sessionExpiresAt: null,
  query: '',
  results: [],
  memoryHits: [],
  cached: false,
  catalog: [],
  sources: [],
  openPage: null,    // { url, content, contentType, status }
  busy: false,
};

const KIND_LABEL = {
  biblioteca: 'Biblioteca', engine: 'Engine', documentacao: 'Documentação', exemplo: 'Exemplo',
  repositorio: 'Repositório', tutorial: 'Tutorial', modelo: 'Modelo', componente: 'Componente',
  grafico: 'Gráfico', som: 'Som', outro: 'Outro',
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmtDate = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};

async function api(path, { method = 'GET', body = null } = {}) {
  const url = new URL(API + path, location.origin);
  const opts = { method, headers: {} };
  if (STATE.token) opts.headers['x-pesquisa-token'] = STATE.token;
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url.toString(), opts);
  let data = null;
  try { data = await r.json(); } catch { data = { ok: false, reason: 'Resposta inválida do servidor.' }; }
  if (!r.ok || data.ok === false) {
    const err = new Error(data.reason || data.error || 'Não foi possível concluir a operação.');
    err.code = data.code || '';
    err.raw = data;
    throw err;
  }
  return data;
}

function toast(msg, kind = 'info') {
  const host = $('#psq-toasts');
  if (!host) return;
  const colors = {
    info: 'border-sky-400/30 bg-sky-500/20 text-sky-100',
    ok: 'border-emerald-400/30 bg-emerald-500/20 text-emerald-100',
    err: 'border-rose-400/30 bg-rose-500/20 text-rose-100',
  };
  const d = document.createElement('div');
  d.className = `pointer-events-auto max-w-[420px] rounded-xl border px-3 py-2 text-[12px] shadow-xl backdrop-blur ${colors[kind] || colors.info}`;
  d.textContent = msg;
  host.appendChild(d);
  setTimeout(() => {
    d.style.transition = 'opacity .3s, transform .3s';
    d.style.opacity = '0'; d.style.transform = 'translateY(6px)';
    setTimeout(() => d.remove(), 320);
  }, 4800);
}

function saveToken(tok) {
  STATE.token = tok || '';
  try { if (tok) sessionStorage.setItem(TOKEN_KEY, tok); else sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

/* ---------------- render ---------------- */
function render() {
  const body = $('#psq-body');
  if (!body) return;
  if (STATE.view === 'loading') { body.innerHTML = '<div class="text-[12px] text-slate-400">Carregando…</div>'; return; }
  if (STATE.view === 'setup') { body.innerHTML = renderSetup(); bindFocus('#psq-setup-pin'); return; }
  if (STATE.view === 'auth') { body.innerHTML = renderAuth(); bindFocus('#psq-auth-pin'); return; }
  body.innerHTML = renderMain();
  bindFocus('#psq-q');
}

function renderSetup() {
  const st = STATE.status || {};
  const envManaged = st.pinSource === 'env';
  if (envManaged) {
    return `<div class="max-w-[760px] space-y-3">
      <div class="text-[13px] font-bold text-sky-200">Autorização por PIN</div>
      <div class="rounded-2xl border border-sky-400/20 bg-sky-500/5 p-3 text-[12px] text-sky-100">
        O PIN é definido por <b>configuração segura de ambiente</b> (PESQUISA_PIN_HASH). Nenhum PIN é gravado pela interface.
        Informe o PIN configurado no servidor para liberar as pesquisas.
      </div>
      <button data-psq-act="to-auth" class="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-[12px] font-semibold">Informar PIN</button>
    </div>`;
  }
  return `<div class="max-w-[760px] space-y-3">
    <div class="text-[13px] font-bold text-sky-200">Definir PIN de autorização</div>
    <div class="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3 text-[12px] text-amber-100 space-y-1">
      <div>Antes de liberar pesquisas na internet, defina um <b>PIN de autorização</b>.</div>
      <div class="text-amber-200/80">Por segurança: o PIN é gravado no backend somente como <b>hash scrypt</b> (nunca em texto puro), nunca é enviado a serviços externos/IA e não aparece em logs. Escolha um PIN novo — não reutilize um PIN já exposto em conversas.</div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label class="text-[11px] text-slate-400">Novo PIN (4–64 caracteres)
        <input id="psq-setup-pin" type="password" autocomplete="new-password" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100" placeholder="••••••"></label>
      <label class="text-[11px] text-slate-400">Confirmar PIN
        <input id="psq-setup-pin2" type="password" autocomplete="new-password" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100" placeholder="••••••"></label>
    </div>
    <div class="flex items-center gap-2">
      <button data-psq-act="setup" class="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-[12px] font-semibold">Definir PIN</button>
      <span class="text-[10.5px] text-slate-500">Após definir, informe o PIN para abrir a sessão de pesquisa.</span>
    </div>
  </div>`;
}

function renderAuth() {
  const st = STATE.status || {};
  const locked = st.locked;
  const remaining = locked ? Math.ceil((st.remainingMs || 0) / 1000) : 0;
  return `<div class="max-w-[760px] space-y-3">
    <div class="text-[13px] font-bold text-sky-200">Autorizar pesquisa na internet</div>
    ${locked
      ? `<div class="rounded-2xl border border-rose-400/20 bg-rose-500/5 p-3 text-[12px] text-rose-100">Acesso bloqueado temporariamente por excesso de tentativas. Tente novamente em <b>${remaining}s</b>.</div>`
      : `<div class="text-[12px] text-slate-400">Informe o PIN para abrir uma sessão de autorização. Tentativas restantes: <b class="text-slate-200">${Math.max(0, (st.maxAttempts || 5) - (st.failedAttempts || 0))}</b>.</div>`}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label class="text-[11px] text-slate-400">PIN
        <input id="psq-auth-pin" type="password" autocomplete="current-password" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100" placeholder="••••••"></label>
    </div>
    <div class="flex items-center gap-2">
      <button data-psq-act="authorize" ${locked ? 'disabled' : ''} class="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-[12px] font-semibold">Autorizar</button>
      <span class="text-[10.5px] text-slate-500">A sessão expira em ${Math.round((st.sessionTtlMs || 7200000) / 60000)} min e pode ser revogada a qualquer momento.</span>
    </div>
  </div>`;
}

function renderMain() {
  const st = STATE.status || {};
  const results = STATE.results || [];
  const resultsHtml = results.map(r => `<div class="rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
      <div class="flex items-start gap-2">
        <span class="text-[10px] text-slate-500 font-mono mt-[2px]">${esc(r.rank)}</span>
        <div class="min-w-0 flex-1">
          <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" class="text-[12.5px] font-semibold text-sky-200 hover:text-sky-100 break-words">${esc(r.title || r.url)}</a>
          <div class="text-[10px] text-slate-500 font-mono truncate">${esc(r.url)}</div>
          ${r.snippet ? `<div class="mt-1 text-[11.5px] text-slate-400">${esc(r.snippet)}</div>` : ''}
          <div class="mt-1.5 flex items-center gap-1.5">
            <button data-psq-act="read" data-url="${esc(r.url)}" class="text-[10.5px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Ler página</button>
            <button data-psq-act="catalog-add-open" data-url="${esc(r.url)}" data-name="${esc(r.title || '')}" class="text-[10.5px] px-2 py-0.5 rounded-md border border-emerald-400/20 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200">Salvar no catálogo</button>
          </div>
        </div>
      </div>
    </div>`).join('');

  const memHtml = (STATE.memoryHits || []).length
    ? `<div class="rounded-2xl border border-violet-400/20 bg-violet-500/5 p-3 space-y-1.5">
        <div class="text-[12px] font-semibold text-violet-200">Memória relacionada (consultada antes de pesquisar)</div>
        ${STATE.memoryHits.map(m => `<div class="text-[11px] text-slate-300 flex items-center gap-2">
          <span class="px-1.5 py-[1px] rounded bg-white/5 border border-white/10 text-[10px] text-slate-400">${esc(m.category)}</span>
          <span class="truncate">${esc(m.title)}</span>
          <span class="ml-auto text-[10px] text-slate-500">${esc(m.status)}</span>
        </div>`).join('')}
      </div>`
    : '';

  const catalogHtml = (STATE.catalog || []).length
    ? STATE.catalog.map(r => `<div class="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
        <span class="px-1.5 py-[1px] rounded bg-white/5 border border-white/10 text-[10px] text-slate-400 mt-[1px]">${esc(KIND_LABEL[r.kind] || r.kind)}</span>
        <div class="min-w-0 flex-1">
          <div class="text-[12px] text-slate-200 truncate">${esc(r.name)}</div>
          <div class="text-[10.5px] text-slate-500 truncate">
            ${r.origin ? `<span class="font-mono">${esc(r.origin)}</span>` : ''}
            ${r.license ? ` · licença ${esc(r.license)}` : ' · licença não informada'}
            ${r.version ? ` · v${esc(r.version)}` : ''}
          </div>
        </div>
        <button data-psq-act="catalog-remove" data-id="${esc(r.id)}" class="text-[10.5px] px-2 py-0.5 rounded-md border border-rose-400/20 bg-rose-500/5 hover:bg-rose-500/15 text-rose-300">Remover</button>
      </div>`).join('')
    : '<div class="text-[11px] text-slate-500">Nenhum recurso no catálogo ainda.</div>';

  const sourcesHtml = (STATE.sources || []).length
    ? STATE.sources.map(s => `<div class="flex items-center gap-2 text-[10.5px] text-slate-400 border-b border-white/5 py-1">
        <span class="text-slate-500 font-mono">${fmtDate(s.at)}</span>
        <span class="px-1.5 rounded bg-white/5 border border-white/10">${esc(s.kind)}</span>
        <span class="truncate">${esc(s.query || s.url || '')}</span>
        ${s.results != null ? `<span class="ml-auto text-slate-500">${esc(s.results)} resultado(s)</span>` : ''}
      </div>`).join('')
    : '<div class="text-[11px] text-slate-500">Nenhuma fonte registrada ainda.</div>';

  const pageHtml = STATE.openPage ? `<div class="rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-white/10 text-[10.5px] text-slate-500">
        <span class="font-mono truncate">${esc(STATE.openPage.url)}</span>
        <span class="ml-auto">${esc(STATE.openPage.contentType || '')} · ${esc(STATE.openPage.status || '')}</span>
        <button data-psq-act="close-read" class="text-slate-400 hover:text-white px-1.5">fechar</button>
      </div>
      <pre class="max-h-[320px] overflow-auto p-3 text-[11px] text-slate-300 whitespace-pre-wrap break-words">${esc((STATE.openPage.content || '').slice(0, 12000))}</pre>
    </div>` : '';

  return `<div class="space-y-3">
    <div class="flex items-center gap-2 flex-wrap text-[11px]">
      <span class="px-2 py-[2px] rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 font-semibold">Autorizado</span>
      <span class="text-slate-500">sessão expira em ${esc(fmtDate(STATE.sessionExpiresAt || (st.sessions ? null : null)))}</span>
      <span class="text-slate-500">· tentativas: ${esc(st.failedAttempts || 0)}/${esc(st.maxAttempts || 5)}</span>
      <span class="text-slate-500">· cache: ${esc(st.cacheEntries || 0)}</span>
      <button data-psq-act="revoke" class="ml-auto text-[11px] px-2.5 py-1 rounded-lg border border-rose-400/20 bg-rose-500/5 hover:bg-rose-500/15 text-rose-300">Revogar sessão</button>
    </div>

    <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
      <div class="text-[12px] font-semibold text-sky-200">Pesquisar (documentação, bibliotecas, engines, exemplos, recursos com licença)</div>
      <div class="flex items-center gap-2 flex-wrap">
        <input id="psq-q" class="flex-1 min-w-[240px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100" placeholder="Ex.: Phaser 3 tilemap documentation" value="${esc(STATE.query)}">
        <button data-psq-act="search" class="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-[12px] font-semibold">Pesquisar</button>
        <button data-psq-act="cache-clear" class="px-2.5 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-[11px]" title="Limpar o cache de pesquisas/páginas">Limpar cache</button>
      </div>
      <div class="text-[10.5px] text-slate-500">A memória é consultada antes da pesquisa. Resultados úteis ficam em cache para não repetir consultas. Conteúdo sempre sanitizado pelo gate de saída §11.</div>
    </div>

    ${memHtml}

    ${(results.length || STATE.query) ? `<div class="rounded-2xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
      <div class="flex items-center gap-2">
        <div class="text-[12px] font-semibold text-sky-200">Resultados</div>
        ${STATE.cached ? '<span class="px-2 py-[2px] rounded-full border border-amber-400/30 bg-amber-500/10 text-amber-200 text-[10px] font-bold">cache</span>' : ''}
        <span class="ml-auto text-[10.5px] text-slate-500">${results.length} resultado(s)</span>
      </div>
      <div class="space-y-2">${resultsHtml || '<div class="text-[11px] text-slate-500">Nenhum resultado. Ajuste o termo e pesquise novamente.</div>'}</div>
    </div>` : ''}

    ${pageHtml}

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
        <div class="flex items-center gap-2">
          <div class="text-[12px] font-semibold text-sky-200">Catálogo de recursos</div>
          <span class="ml-auto text-[10.5px] text-slate-500">${(STATE.catalog || []).length}</span>
        </div>
        <div class="space-y-1.5">${catalogHtml}</div>
        <div id="psq-catalog-form" class="hidden rounded-xl border border-white/10 bg-black/20 p-2.5 space-y-2 mt-2">
          <div class="text-[11px] font-semibold text-slate-300">Adicionar recurso</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label class="text-[10.5px] text-slate-400 md:col-span-2">Nome
              <input id="psq-c-name" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100"></label>
            <label class="text-[10.5px] text-slate-400">Tipo
              <select id="psq-c-kind" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100">
                ${Object.keys(KIND_LABEL).map(k => `<option value="${k}">${KIND_LABEL[k]}</option>`).join('')}
              </select></label>
            <label class="text-[10.5px] text-slate-400">Licença
              <input id="psq-c-license" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100" placeholder="MIT, Apache-2.0, CC-BY..."></label>
            <label class="text-[10.5px] text-slate-400">Origem (URL)
              <input id="psq-c-origin" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100"></label>
            <label class="text-[10.5px] text-slate-400">Versão
              <input id="psq-c-version" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100" placeholder="3.80.1"></label>
          </div>
          <div class="flex items-center gap-1.5">
            <button data-psq-act="catalog-save" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11.5px] font-semibold">Salvar recurso</button>
            <button data-psq-act="catalog-cancel" class="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-[11.5px]">Cancelar</button>
          </div>
        </div>
        <button data-psq-act="catalog-add-open" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-emerald-400/20 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200">Adicionar manualmente</button>
      </div>

      <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
        <div class="text-[12px] font-semibold text-sky-200">Fontes consultadas</div>
        <div class="max-h-[280px] overflow-auto">${sourcesHtml}</div>
      </div>
    </div>
  </div>`;
}

function bindFocus(sel) { const el = $(sel); if (el) { try { el.focus(); } catch {} } }

/* ---------------- ações ---------------- */
async function loadStatus() {
  try {
    const s = await api('/status');
    STATE.status = s;
    return s;
  } catch (e) { toast(e.message || 'Falha ao consultar o módulo.', 'err'); STATE.status = STATE.status || {}; return STATE.status; }
}

async function refresh() {
  const st = STATE.status || {};
  try { STATE.catalog = (await api('/catalog')).items || []; } catch { STATE.catalog = []; }
  try { STATE.sources = (await api('/sources')).items || []; } catch { STATE.sources = []; }
  STATE.status = await loadStatus();
  render();
}

async function boot() {
  await loadStatus();
  if (STATE.token) {
    try {
      const c = await api('/check', { method: 'POST', body: { token: STATE.token } });
      STATE.sessionExpiresAt = c.session && c.session.expiresAt;
      STATE.view = 'main';
      await refresh();
      return;
    } catch { saveToken(''); }
  }
  STATE.view = (STATE.status && STATE.status.hasPin) ? 'auth' : 'setup';
  render();
}

async function doSetup() {
  const pin = ($('#psq-setup-pin') && $('#psq-setup-pin').value) || '';
  const pin2 = ($('#psq-setup-pin2') && $('#psq-setup-pin2').value) || '';
  if (!pin) { toast('Informe um PIN.', 'err'); return; }
  if (pin !== pin2) { toast('Os PINs não conferem.', 'err'); return; }
  try {
    await api('/pin', { method: 'POST', body: { pin } });
    const el1 = $('#psq-setup-pin'); const el2 = $('#psq-setup-pin2');
    if (el1) el1.value = ''; if (el2) el2.value = '';
    toast('PIN definido com segurança (hash no backend). Agora autorize para pesquisar.', 'ok');
    STATE.view = 'auth';
    await loadStatus();
    render();
  } catch (e) { toast(e.message || 'Falha ao definir o PIN.', 'err'); }
}

async function doAuthorize() {
  const el = $('#psq-auth-pin');
  const pin = (el && el.value) || '';
  if (!pin) { toast('Informe o PIN.', 'err'); return; }
  STATE.busy = true;
  try {
    const d = await api('/authorize', { method: 'POST', body: { pin } });
    if (el) el.value = ''; // nunca mantém o PIN na tela
    saveToken(d.token);
    STATE.sessionExpiresAt = d.expiresAt;
    toast('Pesquisa liberada.', 'ok');
    STATE.view = 'main';
    await refresh();
  } catch (e) {
    if (el) el.value = '';
    toast(e.message || 'PIN incorreto.', 'err');
    await loadStatus();
    render();
  } finally { STATE.busy = false; }
}

async function doRevoke() {
  if (!window.confirm('Revogar a sessão de autorização? Será necessário informar o PIN novamente.')) return;
  try { await api('/revoke', { method: 'POST', body: { token: STATE.token } }); } catch {}
  saveToken('');
  STATE.sessionExpiresAt = null;
  STATE.results = []; STATE.memoryHits = []; STATE.openPage = null;
  toast('Sessão revogada.', 'ok');
  STATE.view = 'auth';
  await loadStatus();
  render();
}

async function doSearch() {
  const q = ($('#psq-q') && $('#psq-q').value.trim()) || '';
  if (!q) { toast('Informe o termo da pesquisa.', 'err'); return; }
  STATE.query = q;
  try {
    const d = await api('/search', { method: 'POST', body: { query: q, numResults: 5 } });
    STATE.results = d.results || [];
    STATE.memoryHits = d.memoryHits || [];
    STATE.cached = !!d.cached;
    STATE.openPage = null;
    toast(d.cached ? 'Resultados vindos do cache.' : `${STATE.results.length} resultado(s) encontrado(s).`, 'ok');
    await refresh();
  } catch (e) {
    if (e.code === 'INVALID_TOKEN' || e.code === 'EXPIRED_TOKEN') { saveToken(''); STATE.view = 'auth'; await loadStatus(); render(); }
    toast(e.message || 'Falha na pesquisa.', 'err');
  }
}

async function doRead(url) {
  try {
    const d = await api('/fetch', { method: 'POST', body: { url } });
    STATE.openPage = { url: d.url, content: d.content, contentType: d.contentType, status: d.status };
    render();
    toast('Página lida.', 'ok');
    try { STATE.sources = (await api('/sources')).items || []; } catch {}
  } catch (e) { toast(e.message || 'Falha ao ler a página.', 'err'); }
}

function openCatalogForm(prefill) {
  const f = $('#psq-catalog-form');
  if (!f) return;
  f.classList.remove('hidden');
  if (prefill) {
    const set = (id, v) => { const el = $(id); if (el && v) el.value = v; };
    set('#psq-c-name', prefill.name);
    set('#psq-c-origin', prefill.url);
  }
  bindFocus('#psq-c-name');
}

async function doCatalogSave() {
  const resource = {
    name: ($('#psq-c-name') && $('#psq-c-name').value.trim()) || '',
    kind: ($('#psq-c-kind') && $('#psq-c-kind').value) || 'outro',
    license: ($('#psq-c-license') && $('#psq-c-license').value.trim()) || '',
    origin: ($('#psq-c-origin') && $('#psq-c-origin').value.trim()) || '',
    version: ($('#psq-c-version') && $('#psq-c-version').value.trim()) || '',
  };
  if (!resource.name) { toast('Informe o nome do recurso.', 'err'); return; }
  try {
    await api('/catalog', { method: 'POST', body: { resource } });
    toast('Recurso salvo no catálogo e registrado na Memória.', 'ok');
    await refresh();
  } catch (e) { toast(e.message || 'Falha ao salvar o recurso.', 'err'); }
}

async function doCatalogRemove(id) {
  try { await api('/catalog/' + encodeURIComponent(id), { method: 'DELETE', body: {} }); toast('Recurso removido.', 'ok'); await refresh(); }
  catch (e) { toast(e.message || 'Falha ao remover.', 'err'); }
}

async function doCacheClear() {
  try { await api('/cache/clear', { method: 'POST', body: {} }); toast('Cache limpo.', 'ok'); await loadStatus(); render(); }
  catch (e) { toast(e.message || 'Falha ao limpar o cache.', 'err'); }
}

/* ---------------- bind (delegação) ---------------- */
function onClick(ev) {
  const t = ev.target.closest('[data-psq-act]');
  if (!t) return;
  const act = t.getAttribute('data-psq-act');
  if (act === 'setup') doSetup();
  else if (act === 'to-auth') { STATE.view = 'auth'; render(); }
  else if (act === 'authorize') doAuthorize();
  else if (act === 'revoke') doRevoke();
  else if (act === 'search') doSearch();
  else if (act === 'read') doRead(t.getAttribute('data-url'));
  else if (act === 'close-read') { STATE.openPage = null; render(); }
  else if (act === 'catalog-add-open') openCatalogForm({ name: t.getAttribute('data-name'), url: t.getAttribute('data-url') });
  else if (act === 'catalog-save') doCatalogSave();
  else if (act === 'catalog-cancel') { const f = $('#psq-catalog-form'); if (f) f.classList.add('hidden'); }
  else if (act === 'catalog-remove') doCatalogRemove(t.getAttribute('data-id'));
  else if (act === 'cache-clear') doCacheClear();
  else if (act === 'lock') doRevoke();
  else if (act === 'reload') { loadStatus().then(refresh); }
}

document.addEventListener('click', onClick);
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (!ev.target) return;
  if (ev.target.id === 'psq-q') doSearch();
  else if (ev.target.id === 'psq-auth-pin') doAuthorize();
  else if (ev.target.id === 'psq-setup-pin2') doSetup();
});

/* =========================================================
 * Hooks da aba (chamados por public/app.js)
 * =======================================================*/
window.__pesquisaOnTabOpen = function () {
  try {
    if (!STATE.inited) { STATE.inited = true; boot(); }
    else if (STATE.view === 'main') { refresh(); }
    else { loadStatus().then(() => render()); }
  } catch (e) { console.error('[pesquisa] open erro:', e); }
};
window.__pesquisaOnTabClose = function () {};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { if ($('#psq-panel') && !$('#psq-panel').classList.contains('hidden')) window.__pesquisaOnTabOpen(); });
} else {
  if ($('#psq-panel') && !$('#psq-panel').classList.contains('hidden')) window.__pesquisaOnTabOpen();
}

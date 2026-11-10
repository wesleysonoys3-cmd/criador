/* =========================================================
 * public/memoria.js — Aba "Memória do Tiagente" (frontend do módulo)
 * ---------------------------------------------------------
 * Consome somente /api/memoria/* (backend memoria/service.js).
 * Painel do Módulo 3.6: consultar, pesquisar, visualizar soluções
 * confirmadas, erros, projetos, corrigir, excluir e desativar categorias.
 * Sem IA: tudo é lido e gravado por regras determinísticas.
 * =======================================================*/

const API = '/api/memoria';

const STATE = {
  inited: false,
  view: 'list',      // list | editor | categories
  status: null,
  categories: [],
  items: [],
  query: '',
  filterCategory: '',
  filterStatus: '',
  editing: null,     // registro em edição (ou null = novo)
  busy: false,
};

const CATEGORY_META = {
  projetos: { letter: 'A', label: 'Projetos', color: 'text-sky-300 border-sky-400/30 bg-sky-500/10' },
  tecnica: { letter: 'B', label: 'Técnica', color: 'text-violet-300 border-violet-400/30 bg-violet-500/10' },
  procedimentos: { letter: 'C', label: 'Procedimentos', color: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10' },
  erros: { letter: 'D', label: 'Erros', color: 'text-rose-300 border-rose-400/30 bg-rose-500/10' },
  preferencias: { letter: 'E', label: 'Preferências', color: 'text-amber-300 border-amber-400/30 bg-amber-500/10' },
  recursos: { letter: 'F', label: 'Recursos', color: 'text-cyan-300 border-cyan-400/30 bg-cyan-500/10' },
};
const STATUS_META = {
  Pendente: 'text-slate-300 border-white/15 bg-white/5',
  Testado: 'text-sky-300 border-sky-400/30 bg-sky-500/10',
  Confirmado: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
  Rejeitado: 'text-rose-300 border-rose-400/30 bg-rose-500/10',
  Desatualizado: 'text-amber-300 border-amber-400/30 bg-amber-500/10',
};
const KIND_LABEL = {
  tarefa: 'Tarefa', projeto: 'Projeto', conhecimento: 'Conhecimento',
  procedimento: 'Procedimento', erro: 'Erro', preferencia: 'Preferência', recurso: 'Recurso',
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

async function api(path, { method = 'GET', body = null, params = null } = {}) {
  const url = new URL(API + path, location.origin);
  if (params) for (const k of Object.keys(params)) {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') url.searchParams.set(k, params[k]);
  }
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url.toString(), opts);
  let data = null;
  try { data = await r.json(); } catch { data = { ok: false, error: 'Resposta inválida do servidor.' }; }
  if (!r.ok || data.ok === false) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
}

function toast(msg, kind = 'info') {
  const host = $('#mem-toasts');
  if (!host) return;
  const colors = {
    info: 'border-violet-400/30 bg-violet-500/20 text-violet-100',
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
  }, 4600);
}

/* ---------------- render ---------------- */
function render() {
  const body = $('#mem-body');
  if (!body) return;
  if (STATE.view === 'editor') { body.innerHTML = renderEditor(); bindEditor(); return; }
  if (STATE.view === 'categories') { body.innerHTML = renderCategories(); bindCategories(); return; }
  body.innerHTML = renderList();
}

function catBadge(cat) {
  const m = CATEGORY_META[cat] || { letter: '?', label: cat, color: 'text-slate-300 border-white/10 bg-white/5' };
  return `<span class="inline-flex items-center gap-1 px-2 py-[2px] rounded-full border text-[10px] font-bold ${m.color}">
    <span class="font-black">${m.letter}</span>${esc(m.label)}</span>`;
}
function statusBadge(status) {
  const cls = STATUS_META[status] || STATUS_META.Pendente;
  return `<span class="px-2 py-[2px] rounded-full border text-[10px] font-bold ${cls}">${esc(status)}</span>`;
}

function renderList() {
  if (!STATE.items.length) {
    return `<div class="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center text-slate-400 text-[13px]">
      Nenhum registro encontrado. Use <span class="text-violet-300 font-semibold">Nova memória</span> para registrar uma tarefa, conhecimento, erro ou preferência.
    </div>`;
  }
  const cards = STATE.items.map((r) => {
    const meta = CATEGORY_META[r.category] || {};
    return `<div class="rounded-2xl border border-white/10 bg-white/[0.02] hover:border-violet-400/30 transition p-3">
      <div class="flex items-start gap-2 flex-wrap">
        ${catBadge(r.category)}
        ${statusBadge(r.status)}
        <span class="px-2 py-[2px] rounded-full border border-white/10 bg-white/5 text-[10px] text-slate-400">${esc(KIND_LABEL[r.kind] || r.kind)}</span>
        ${r.project ? `<span class="px-2 py-[2px] rounded-full border border-white/10 bg-white/5 text-[10px] text-slate-400">projeto: ${esc(r.project)}</span>` : `<span class="px-2 py-[2px] rounded-full border border-white/10 bg-white/5 text-[10px] text-slate-400">geral</span>`}
        <span class="ml-auto text-[10px] text-slate-500 font-mono">${fmtDate(r.updatedAt || r.createdAt)}</span>
      </div>
      <div class="mt-2 text-[13px] font-semibold text-slate-100">${esc(r.title)}</div>
      ${r.summary ? `<div class="mt-1 text-[12px] text-slate-400 whitespace-pre-wrap">${esc(String(r.summary).slice(0, 400))}</div>` : ''}
      <div class="mt-2 flex items-center gap-2 flex-wrap text-[10px] text-slate-500">
        ${(r.tags || []).map(t => `<span class="px-1.5 py-[1px] rounded bg-white/5 border border-white/10">${esc(t)}</span>`).join('')}
        <span class="ml-auto">origem: ${esc(r.source && r.source.origin || '—')}${r.useCount ? ` · usado ${r.useCount}x` : ''}</span>
      </div>
      <div class="mt-2.5 flex items-center gap-1.5 flex-wrap">
        <button data-mem-act="use" data-id="${esc(r.id)}" class="text-[11px] px-2 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Reutilizar</button>
        <button data-mem-act="validate" data-id="${esc(r.id)}" data-status="Confirmado" class="text-[11px] px-2 py-1 rounded-lg border border-emerald-400/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200">Confirmar</button>
        <button data-mem-act="validate" data-id="${esc(r.id)}" data-status="Testado" class="text-[11px] px-2 py-1 rounded-lg border border-sky-400/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200">Testado</button>
        <button data-mem-act="validate" data-id="${esc(r.id)}" data-status="Rejeitado" class="text-[11px] px-2 py-1 rounded-lg border border-rose-400/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200">Rejeitar</button>
        <button data-mem-act="edit" data-id="${esc(r.id)}" class="text-[11px] px-2 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Corrigir</button>
        <button data-mem-act="detail" data-id="${esc(r.id)}" class="text-[11px] px-2 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Detalhes</button>
        <button data-mem-act="delete" data-id="${esc(r.id)}" class="text-[11px] px-2 py-1 rounded-lg border border-rose-400/20 bg-rose-500/5 hover:bg-rose-500/15 text-rose-300 ml-auto">Excluir</button>
      </div>
    </div>`;
  }).join('');

  const catOptions = ['<option value="">Todas as categorias</option>']
    .concat(Object.keys(CATEGORY_META).map(k => `<option value="${k}" ${STATE.filterCategory === k ? 'selected' : ''}>${CATEGORY_META[k].letter} · ${CATEGORY_META[k].label}</option>`));
  const statusOptions = ['<option value="">Todos os estados</option>']
    .concat(['Pendente', 'Testado', 'Confirmado', 'Rejeitado', 'Desatualizado'].map(s => `<option value="${s}" ${STATE.filterStatus === s ? 'selected' : ''}>${s}</option>`));

  return `<div class="space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <input id="mem-q" type="text" value="${esc(STATE.query)}" placeholder="Pesquisar na memória (ex.: pontuação, Phaser, erro de build)…"
        class="flex-1 min-w-[220px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-violet-400/50">
      <button data-mem-act="search" class="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold">Pesquisar</button>
      <select id="mem-cat" class="rounded-xl border border-white/10 bg-black/30 px-2 py-2 text-[12px] text-slate-200">${catOptions.join('')}</select>
      <select id="mem-status" class="rounded-xl border border-white/10 bg-black/30 px-2 py-2 text-[12px] text-slate-200">${statusOptions.join('')}</select>
    </div>
    <div class="text-[11px] text-slate-500">${STATE.items.length} registro(s)${STATE.query ? ` para “${esc(STATE.query)}”` : ''}.</div>
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">${cards}</div>
  </div>`;
}

function renderEditor() {
  const r = STATE.editing || {};
  const catOptions = Object.keys(CATEGORY_META).map(k =>
    `<option value="${k}" ${r.category === k ? 'selected' : ''}>${CATEGORY_META[k].letter} · ${CATEGORY_META[k].label}</option>`).join('');
  const kindOptions = Object.keys(KIND_LABEL).map(k =>
    `<option value="${k}" ${(r.kind || 'conhecimento') === k ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('');
  const statusOptions = ['Pendente', 'Testado', 'Confirmado', 'Rejeitado', 'Desatualizado'].map(s =>
    `<option value="${s}" ${(r.status || 'Pendente') === s ? 'selected' : ''}>${s}</option>`).join('');
  return `<div class="max-w-[900px] space-y-3">
    <div class="text-[13px] font-bold text-violet-200">${r.id ? 'Corrigir registro' : 'Nova memória'}</div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label class="text-[11px] text-slate-400">Título
        <input id="mem-f-title" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100" value="${esc(r.title || '')}"></label>
      <label class="text-[11px] text-slate-400">Projeto (opcional — vazio = conhecimento geral)
        <input id="mem-f-project" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100" value="${esc(r.project || '')}"></label>
      <label class="text-[11px] text-slate-400">Categoria
        <select id="mem-f-category" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100">${catOptions}</select></label>
      <label class="text-[11px] text-slate-400">Tipo
        <select id="mem-f-kind" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100">${kindOptions}</select></label>
      <label class="text-[11px] text-slate-400">Estado de validação
        <select id="mem-f-status" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100">${statusOptions}</select></label>
      <label class="text-[11px] text-slate-400">Etiquetas (separadas por vírgula)
        <input id="mem-f-tags" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100" value="${esc((r.tags || []).join(', '))}"></label>
    </div>
    <label class="block text-[11px] text-slate-400">Resumo
      <textarea id="mem-f-summary" rows="2" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100">${esc(r.summary || '')}</textarea></label>
    <label class="block text-[11px] text-slate-400">Detalhes / solução
      <textarea id="mem-f-content" rows="6" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100 font-mono">${esc(r.content || '')}</textarea></label>
    <div class="flex items-center gap-2">
      <button data-mem-act="save" class="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold">${r.id ? 'Salvar alterações' : 'Registrar'}</button>
      <button data-mem-act="cancel" class="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-[12px]">Cancelar</button>
      <span class="text-[10.5px] text-slate-500">Nunca guarde senhas, tokens ou chaves de API — o módulo remove automaticamente.</span>
    </div>
  </div>`;
}

function renderCategories() {
  const rows = STATE.categories.map((c) => {
    const m = CATEGORY_META[c.key] || {};
    return `<div class="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <div class="flex items-center gap-2 min-w-0">${catBadge(c.key)}<span class="text-[12px] text-slate-300 truncate">${esc(c.label)}</span></div>
      <button data-mem-act="toggle-cat" data-cat="${c.key}" data-enabled="${c.enabled ? '0' : '1'}"
        class="ml-auto text-[11px] px-2.5 py-1 rounded-lg border ${c.enabled ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-white/10 bg-white/5 text-slate-400'}">${c.enabled ? 'Ativa' : 'Desativada'}</button>
    </div>`;
  }).join('');
  return `<div class="max-w-[820px] space-y-3">
    <div class="text-[13px] font-bold text-violet-200">Categorias de memória</div>
    <div class="text-[11px] text-slate-500">Desativar uma categoria a oculta da lista e das buscas (os registros não são apagados).</div>
    <div class="space-y-2">${rows}</div>
    <div class="flex items-center gap-2 pt-1">
      <button data-mem-act="backup" class="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-[12px]">Baixar backup</button>
      <button data-mem-act="restore" class="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-[12px]">Restaurar backup</button>
      <button data-mem-act="back" class="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-[12px] ml-auto">Voltar</button>
    </div>
  </div>`;
}

/* ---------------- ações ---------------- */
async function loadList() {
  const params = { limit: 300 };
  if (STATE.query) params.q = STATE.query;
  if (STATE.filterCategory) params.category = STATE.filterCategory;
  if (STATE.filterStatus) params.status = STATE.filterStatus;
  try {
    const data = STATE.query
      ? await api('/search', { params })
      : await api('/list', { params });
    STATE.items = data.items || [];
  } catch (e) {
    toast(e.message || 'Falha ao carregar a memória.', 'err');
    STATE.items = [];
  }
  render();
}

async function loadCategories() {
  try {
    const d = await api('/categories');
    STATE.categories = d.categories || [];
  } catch { /* mantém */ }
}

function openEditor(record) {
  STATE.editing = record || null;
  STATE.view = 'editor';
  render();
}

function readForm() {
  const val = (id) => { const el = $(id); return el ? el.value : ''; };
  return {
    title: val('#mem-f-title').trim(),
    project: val('#mem-f-project').trim(),
    category: val('#mem-f-category'),
    kind: val('#mem-f-kind'),
    status: val('#mem-f-status'),
    tags: val('#mem-f-tags').split(',').map(s => s.trim()).filter(Boolean),
    summary: val('#mem-f-summary').trim(),
    content: val('#mem-f-content'),
    source: { origin: 'usuario' },
  };
}

async function save() {
  const body = readForm();
  if (!body.title) { toast('Informe um título.', 'err'); return; }
  try {
    if (STATE.editing && STATE.editing.id) {
      await api('/record/' + encodeURIComponent(STATE.editing.id), { method: 'PUT', body });
      toast('Registro atualizado.', 'ok');
    } else {
      const r = await api('/register', { method: 'POST', body });
      toast(r.redacted ? 'Registrado (credenciais detectadas foram removidas).' : 'Registro criado.', 'ok');
    }
    STATE.view = 'list';
    await loadList();
  } catch (e) { toast(e.message || 'Falha ao salvar.', 'err'); }
}

async function validate(id, status) {
  try {
    await api('/record/' + encodeURIComponent(id) + '/validate', { method: 'POST', body: { status } });
    toast('Validação atualizada: ' + status, 'ok');
    await loadList();
  } catch (e) { toast(e.message || 'Falha ao validar.', 'err'); }
}

async function markUsed(id) {
  try { await api('/record/' + encodeURIComponent(id) + '/use', { method: 'POST', body: {} }); toast('Marcado como reutilizado.', 'ok'); await loadList(); }
  catch (e) { toast(e.message || 'Falha.', 'err'); }
}

async function remove(id) {
  if (!window.confirm('Excluir este registro da memória? A ação não pode ser desfeita.')) return;
  try { await api('/record/' + encodeURIComponent(id), { method: 'DELETE', body: {} }); toast('Registro excluído.', 'ok'); await loadList(); }
  catch (e) { toast(e.message || 'Falha ao excluir.', 'err'); }
}

async function showDetail(id) {
  try {
    const d = await api('/record/' + encodeURIComponent(id));
    const r = d.record || {};
    const parts = [];
    parts.push('Título: ' + (r.title || ''));
    if (r.category) parts.push('Categoria: ' + (CATEGORY_META[r.category] ? CATEGORY_META[r.category].label : r.category));
    if (r.kind) parts.push('Tipo: ' + (KIND_LABEL[r.kind] || r.kind));
    parts.push('Estado: ' + (r.status || ''));
    if (r.project) parts.push('Projeto: ' + r.project);
    if (r.source) parts.push('Origem: ' + (r.source.origin || '—') + (r.source.ref ? ' (' + r.source.ref + ')' : ''));
    parts.push('Criado: ' + fmtDate(r.createdAt));
    parts.push('Atualizado: ' + fmtDate(r.updatedAt));
    if (r.summary) parts.push('\nResumo:\n' + r.summary);
    if (r.content) parts.push('\nDetalhes:\n' + r.content);
    if (r.evidence) parts.push('\nEvidência:\n' + r.evidence);
    if (r.files && r.files.length) parts.push('\nArquivos:\n' + r.files.join('\n'));
    if (r.versions && r.versions.length) parts.push('\nVersões: ' + r.versions.length + ' alteração(ões) registrada(s).');
    window.alert(parts.join('\n'));
  } catch (e) { toast(e.message || 'Falha ao abrir.', 'err'); }
}

async function toggleCat(cat, enabled) {
  try { await api('/category', { method: 'POST', body: { category: cat, enabled } }); await loadCategories(); STATE.view = 'categories'; render(); toast('Categoria atualizada.', 'ok'); }
  catch (e) { toast(e.message || 'Falha.', 'err'); }
}

async function backup() {
  try {
    const d = await api('/backup');
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'memoria-tiagente-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Backup gerado.', 'ok');
  } catch (e) { toast(e.message || 'Falha ao gerar backup.', 'err'); }
}

function restore() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const d = await api('/restore', { method: 'POST', body: parsed });
      toast('Backup restaurado: ' + (d.inserted || 0) + ' inserido(s), ' + (d.skipped || 0) + ' ignorado(s).', 'ok');
      await loadList();
    } catch (e) { toast(e.message || 'Backup inválido.', 'err'); }
  });
  input.click();
}

/* ---------------- bind ---------------- */
function onClick(ev) {
  const t = ev.target.closest('[data-mem-act]');
  if (!t) return;
  const act = t.getAttribute('data-mem-act');
  const id = t.getAttribute('data-id');
  if (act === 'search') { STATE.query = ($('#mem-q') && $('#mem-q').value.trim()) || ''; loadList(); }
  else if (act === 'new') { openEditor(null); }
  else if (act === 'categories') { STATE.view = 'categories'; loadCategories().then(render); }
  else if (act === 'back') { STATE.view = 'list'; render(); }
  else if (act === 'save') { save(); }
  else if (act === 'cancel') { STATE.view = 'list'; render(); }
  else if (act === 'edit' && id) { api('/record/' + encodeURIComponent(id)).then(d => openEditor(d.record)).catch(e => toast(e.message, 'err')); }
  else if (act === 'validate' && id) { validate(id, t.getAttribute('data-status')); }
  else if (act === 'use' && id) { markUsed(id); }
  else if (act === 'detail' && id) { showDetail(id); }
  else if (act === 'delete' && id) { remove(id); }
  else if (act === 'toggle-cat') { toggleCat(t.getAttribute('data-cat'), t.getAttribute('data-enabled') === '1'); }
  else if (act === 'backup') { backup(); }
  else if (act === 'restore') { restore(); }
  else if (act === 'reload') { loadCategories().then(loadList); }
}

function bindEditor() {
  const f = $('#mem-f-title'); if (f) f.focus();
}

function bindCategories() { /* ações via delegação */ }

document.addEventListener('click', onClick);
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target && ev.target.id === 'mem-q') { STATE.query = ev.target.value.trim(); loadList(); }
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (!t) return;
  if (t.id === 'mem-cat') { STATE.filterCategory = t.value; loadList(); }
  else if (t.id === 'mem-status') { STATE.filterStatus = t.value; loadList(); }
});

/* =========================================================
 * Hooks da aba (chamados por public/app.js)
 * =======================================================*/
window.__memoriaOnTabOpen = function () {
  try {
    if (!STATE.inited) { STATE.inited = true; loadCategories().then(loadList); }
    else { loadList(); }
  } catch (e) { console.error('[memoria] open erro:', e); }
};
window.__memoriaOnTabClose = function () {};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { if ($('#mem-panel') && !$('#mem-panel').classList.contains('hidden')) window.__memoriaOnTabOpen(); });
} else {
  if ($('#mem-panel') && !$('#mem-panel').classList.contains('hidden')) window.__memoriaOnTabOpen();
}

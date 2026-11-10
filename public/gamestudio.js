/* =========================================================
 * public/gamestudio.js — Aba "Game Studio" (frontend do módulo)
 * ---------------------------------------------------------
 * Consome somente /api/gamestudio/* (backend gamestudio/service.js).
 * Fluxo do Módulo 1.3: Novo jogo · Meus projetos · Jogos 2D/3D ·
 * Pré-visualização · Editar por comando · Salvar versões ·
 * Testar · Histórico de alterações.
 * Sem IA: criação/edição/teste são determinísticos no backend.
 * =======================================================*/

const API = '/api/gamestudio';

const STATE = {
  inited: false,
  view: 'list',        // list | new | detail
  games: [],
  templates: [],
  resources: [],
  status: null,
  detail: null,        // { game, versions, tests, commands, resources }
  previewUrl: null,
  busy: false,
  confirmPublish: false, // passo de confirmação explícita de publicação
  detailTab: 'jogar',    // aba interna do jogo: jogar | ajustes | publicar | historico
  newGenre: '',          // modelo escolhido na galeria de ideias
  newDraft: { name: '', description: '' }, // preserva o rascunho ao trocar de modelo
};

const STATUS_META = {
  rascunho: 'text-slate-300 border-white/15 bg-white/5',
  pronto: 'text-sky-300 border-sky-400/30 bg-sky-500/10',
  testado: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
  publicado: 'text-violet-300 border-violet-400/30 bg-violet-500/10',
};
const QUICK_COMMANDS = ['mais rápido', 'mais devagar', 'dificuldade difícil', 'mais inimigos', 'jogador verde', 'fundo preto'];

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmtDate = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};
const numToHex = (n) => '#' + (Number(n) & 0xffffff).toString(16).padStart(6, '0');
const asHex = (v) => (typeof v === 'number' ? numToHex(v) : (/^#[0-9a-f]{3,6}$/i.test(String(v || '')) ? String(v) : '#000000'));
const genreLabel = (key) => {
  const t = STATE.templates.find(x => x.genre === key || x.key === key);
  return t ? t.label : key;
};

async function api(path, { method = 'GET', body = null } = {}) {
  const url = new URL(API + path, location.origin);
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url.toString(), opts);
  let data = null;
  try { data = await r.json(); } catch { data = { ok: false, reason: 'Resposta inválida do servidor.' }; }
  if (!r.ok || data.ok === false) throw new Error(data.reason || data.error || 'Não foi possível concluir a operação.');
  return data;
}

function toast(msg, kind = 'info') {
  const host = $('#gs-toasts');
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
  const body = $('#gs-body');
  if (!body) return;
  if (STATE.view === 'new') { body.innerHTML = renderNew(); bindNew(); return; }
  if (STATE.view === 'detail') { body.innerHTML = renderDetail(); return; }
  body.innerHTML = renderList();
}

function statusBadge(status) {
  const cls = STATUS_META[status] || STATUS_META.rascunho;
  return `<span class="px-2 py-[2px] rounded-full border text-[10px] font-bold ${cls}">${esc(status)}</span>`;
}

/* Ícone do motor (2D = controle · 3D = cubo) usado na galeria de ideias */
function modelIcon(type) {
  if (type === '3d') {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9.2"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="2.5" y="7.5" width="19" height="9.5" rx="4.75"/><path d="M7 10.5v3M5.5 12h3M16 11h3M17.5 9.5v3"/></svg>';
}

/* Abas internas do jogo (evitam empilhar tudo numa tela só) */
const DETAIL_TABS = [
  { key: 'jogar', label: 'Jogar' },
  { key: 'ajustes', label: 'Ajustes' },
  { key: 'publicar', label: 'Publicar' },
  { key: 'historico', label: 'Histórico' },
];

/* Guarda o que o usuário já digitou antes de redesenhar a tela de criação */
function captureDraft() {
  const n = $('#gs-f-name');
  const d = $('#gs-f-desc');
  const prev = STATE.newDraft || { name: '', description: '' };
  STATE.newDraft = {
    name: n ? n.value : prev.name,
    description: d ? d.value : prev.description,
  };
}

function renderList() {
  if (!STATE.games.length) {
    return `<div class="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center space-y-3">
      <div class="w-12 h-12 mx-auto rounded-2xl bg-violet-500/15 text-violet-200 grid place-items-center">${modelIcon('3d')}</div>
      <div class="text-[13px] text-slate-200 font-semibold">Nenhum jogo por aqui ainda</div>
      <div class="text-[12px] text-slate-500 max-w-[440px] mx-auto">Escolha um modelo e crie seu primeiro jogo em segundos — 2D (Phaser) ou 3D (Three.js).</div>
      <button data-gs-act="new" class="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold">Criar meu primeiro jogo</button>
    </div>`;
  }
  const cards = STATE.games.map((g) => {
    const pub = g.publication && g.publication.active;
    return `<div class="rounded-2xl border border-white/10 bg-white/[0.02] hover:border-violet-400/30 transition p-3.5 flex flex-col">
      <div class="flex items-center gap-1.5 flex-wrap">
        <span class="px-2 py-[2px] rounded-full border border-white/10 bg-white/5 text-[10px] font-bold text-slate-300">${g.type === '3d' ? '3D' : '2D'}</span>
        <span class="px-2 py-[2px] rounded-full border border-violet-400/30 bg-violet-500/10 text-[10px] font-bold text-violet-200">${esc(g.genreLabel || genreLabel(g.genre))}</span>
        ${statusBadge(g.status)}
        ${pub ? `<span class="px-2 py-[2px] rounded-full border text-[10px] font-bold ${g.publication.public ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/30 bg-amber-500/10 text-amber-200'}">${g.publication.public ? 'no ar' : 'link privado'}</span>` : ''}
      </div>
      <div class="mt-2 text-[14px] font-semibold text-slate-100 truncate">${esc(g.name)}</div>
      <div class="mt-0.5 text-[11.5px] text-slate-400 leading-snug min-h-[32px]">${g.description ? esc(g.description) : '<span class="text-slate-600">Sem descrição</span>'}</div>
      <div class="mt-2 text-[10.5px] text-slate-500">Atualizado ${fmtDate(g.updatedAt)} · ${g.versionsCount} versão(ões) · ${g.testsCount} teste(s)</div>
      <div class="mt-3 flex items-center gap-1.5 flex-wrap">
        <button data-gs-act="open" data-id="${esc(g.id)}" class="text-[11.5px] px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Abrir jogo</button>
        <button data-gs-act="test" data-id="${esc(g.id)}" class="text-[11.5px] px-3 py-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200">Testar</button>
        <button data-gs-act="delete" data-id="${esc(g.id)}" class="text-[11.5px] px-2.5 py-1.5 rounded-lg text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 ml-auto" title="Excluir do Game Studio">Excluir</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <div class="text-[12px] text-slate-400">${STATE.games.length} jogo(s)</div>
      <button data-gs-act="new" class="ml-auto px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold">+ Novo jogo</button>
    </div>
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">${cards}</div>
  </div>`;
}

function renderNew() {
  const only2d = STATE.templates.filter(t => t.type !== '3d');
  const only3d = STATE.templates.filter(t => t.type === '3d');
  const draft = STATE.newDraft || { name: '', description: '' };
  const selected = STATE.newGenre
    || (only2d[0] && only2d[0].genre)
    || (only3d[0] && only3d[0].genre)
    || '';
  STATE.newGenre = selected;

  const card = (t) => {
    const on = t.genre === selected;
    return `<button type="button" data-gs-act="pick-genre" data-genre="${esc(t.genre)}" class="text-left rounded-2xl border p-3 flex items-start gap-3 transition ${on ? 'border-violet-400/60 bg-violet-500/10' : 'border-white/10 bg-white/[0.02] hover:border-violet-300/30 hover:bg-white/[0.04]'}">
      <span class="shrink-0 w-10 h-10 rounded-xl grid place-items-center ${t.type === '3d' ? 'bg-violet-500/20 text-violet-200' : 'bg-sky-500/15 text-sky-200'}">${modelIcon(t.type)}</span>
      <span class="min-w-0">
        <span class="block text-[12.5px] font-semibold text-slate-100">${esc(t.label)}</span>
        <span class="block text-[11px] text-slate-400 leading-snug">${esc(t.description)}</span>
      </span>
      <span class="ml-auto shrink-0 text-[13px] ${on ? 'text-violet-300' : 'text-transparent'}">✓</span>
    </button>`;
  };
  const group = (title, hint, list) => list.length ? `<div class="space-y-2">
      <div class="flex items-baseline gap-2">
        <span class="text-[11.5px] font-bold text-violet-200 uppercase tracking-wide">${title}</span>
        <span class="text-[10.5px] text-slate-500">${hint}</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">${list.map(card).join('')}</div>
    </div>` : '';

  return `<div class="max-w-[880px] space-y-4">
    <div class="space-y-1">
      <div class="text-[14px] font-bold text-slate-100">Criar um jogo novo</div>
      <div class="text-[11.5px] text-slate-500">Dê um nome, escolha um modelo e pronto — você ajusta o resto depois, jogando.</div>
    </div>
    <label class="block text-[11px] text-slate-400">Nome do jogo
      <input id="gs-f-name" value="${esc(draft.name)}" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-[13px] text-slate-100" placeholder="Ex.: Caverna Azul"></label>
    <label class="block text-[11px] text-slate-400">Descrição <span class="text-slate-600">(opcional)</span>
      <input id="gs-f-desc" value="${esc(draft.description)}" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12.5px] text-slate-100" placeholder="Uma frase sobre o objetivo do jogo"></label>
    ${group('2D · Phaser 3', 'clássicos em tela plana', only2d)}
    ${group('3D · Three.js', 'câmera em perspectiva', only3d)}
    <div class="flex items-center gap-2 pt-1">
      <button data-gs-act="create" class="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12.5px] font-semibold">Criar jogo</button>
      <button data-gs-act="cancel" class="px-3.5 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-[12.5px]">Cancelar</button>
    </div>
  </div>`;
}

function renderDetail() {
  const d = STATE.detail;
  if (!d) return '<div class="text-[12px] text-slate-400">Carregando…</div>';
  const g = d.game;
  const tab = DETAIL_TABS.some(t => t.key === STATE.detailTab) ? STATE.detailTab : 'jogar';
  STATE.detailTab = tab;
  const pubActive = !!(g.publication && g.publication.active);

  const tabs = DETAIL_TABS.map(t =>
    `<button data-gs-act="detail-tab" data-tab="${t.key}" class="px-3 py-1.5 rounded-lg text-[11.5px] font-semibold transition ${tab === t.key ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}">${t.label}${t.key === 'publicar' && pubActive ? '<span class="text-emerald-300"> •</span>' : ''}</button>`).join('');

  let panel = '';
  if (tab === 'ajustes') panel = renderTabAjustes(g);
  else if (tab === 'publicar') panel = renderPublication(g);
  else if (tab === 'historico') panel = renderTabHistorico(d, g);
  else panel = renderTabJogar(g);

  return `<div class="space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <button data-gs-act="back" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">‹ Meus projetos</button>
      <div class="text-[15px] font-bold text-slate-100 truncate">${esc(g.name)}</div>
      <span class="px-2 py-[2px] rounded-full border border-white/10 bg-white/5 text-[10px] font-bold text-slate-300">${g.type === '3d' ? '3D' : '2D'}</span>
      <span class="px-2 py-[2px] rounded-full border border-violet-400/30 bg-violet-500/10 text-[10px] font-bold text-violet-200">${esc(g.genreLabel)}</span>
      ${statusBadge(g.status)}
      <div class="ml-auto flex items-center gap-1.5">
        ${pubActive ? `<button data-gs-act="copy" data-url="${esc(g.publication.url)}" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Copiar link</button>` : ''}
        <button data-gs-act="test" data-id="${esc(g.id)}" class="text-[11px] px-3 py-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 font-semibold">Testar</button>
      </div>
    </div>

    <div class="flex items-center gap-1 flex-wrap border-b border-white/10 pb-2">${tabs}</div>

    ${panel}

    <details class="rounded-2xl border border-white/10 bg-white/[0.02]">
      <summary class="cursor-pointer select-none px-3 py-2 text-[11.5px] text-slate-400 hover:text-slate-200">Detalhes técnicos</summary>
      <div class="px-3 pb-3 pt-1 space-y-1.5">
        ${(d.resources || []).map(r => `<div class="text-[11px] text-slate-400">${esc(r.name)} ${esc(r.version)} · licença ${esc(r.license)} · <span class="font-mono text-slate-500">${esc(r.url)}</span></div>`).join('')}
        <div class="text-[11px] text-slate-500">Projeto no workspace: <span class="font-mono">${esc(g.slug)}</span> · arquivos: ${esc((g.files || []).join(', '))}</div>
      </div>
    </details>
  </div>`;
}

function renderTabJogar(g) {
  const url = STATE.previewUrl || g.previewUrl || '';
  return `<div class="space-y-3">
    <div class="rounded-2xl border border-white/10 overflow-hidden bg-black/40">
      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-white/10 text-[10.5px] text-slate-500">
        <span id="gs-url" class="font-mono truncate">${esc(url)}</span>
        <button data-gs-act="reload-preview" data-id="${esc(g.id)}" class="ml-auto shrink-0 px-2 py-0.5 rounded-md border border-sky-400/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200">Atualizar prévia</button>
      </div>
      <iframe id="gs-frame" sandbox="allow-forms allow-scripts" title="Pré-visualização do jogo"
        class="w-full block bg-black" style="height:min(56vh,520px)" src="${url ? esc(url) : 'about:blank'}"></iframe>
    </div>

    <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
      <div class="text-[12px] font-semibold text-violet-200">Descreva uma mudança</div>
      <div class="flex items-center gap-2 flex-wrap">
        <input id="gs-cmd" class="flex-1 min-w-[220px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-slate-100" placeholder="Ex.: deixe o jogador verde e mais rápido">
        <button data-gs-act="command" data-id="${esc(g.id)}" class="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold">Aplicar</button>
      </div>
      <div class="flex items-center gap-1.5 flex-wrap">
        ${QUICK_COMMANDS.map(q => `<button data-gs-act="quick" data-id="${esc(g.id)}" data-cmd="${esc(q)}" class="text-[10.5px] px-2 py-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">${esc(q)}</button>`).join('')}
      </div>
    </div>
  </div>`;
}

function renderTabAjustes(g) {
  const c = g.config || {};
  return `<div class="rounded-2xl border border-white/10 bg-white/[0.02] p-3 space-y-3">
    <div class="text-[12px] font-semibold text-violet-200">Ajustes rápidos</div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
      <label class="text-[10.5px] text-slate-400">Cor do jogador
        <input id="gs-c-player" type="color" value="${esc(asHex(c.playerColor))}" class="mt-1 w-full h-8 rounded-lg border border-white/10 bg-black/30"></label>
      <label class="text-[10.5px] text-slate-400">Cor do inimigo
        <input id="gs-c-enemy" type="color" value="${esc(asHex(c.enemyColor))}" class="mt-1 w-full h-8 rounded-lg border border-white/10 bg-black/30"></label>
      <label class="text-[10.5px] text-slate-400">Cor do item
        <input id="gs-c-item" type="color" value="${esc(asHex(c.itemColor))}" class="mt-1 w-full h-8 rounded-lg border border-white/10 bg-black/30"></label>
      <label class="text-[10.5px] text-slate-400">Fundo
        <input id="gs-c-bg" type="color" value="${esc(asHex(c.background))}" class="mt-1 w-full h-8 rounded-lg border border-white/10 bg-black/30"></label>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
      <label class="text-[10.5px] text-slate-400">Velocidade: <span id="gs-v-speed">${esc(c.speed)}</span>
        <input id="gs-c-speed" type="range" min="80" max="900" step="10" value="${esc(c.speed)}" class="mt-1 w-full"></label>
      <label class="text-[10.5px] text-slate-400">Dificuldade
        <select id="gs-c-diff" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100">
          ${['facil', 'normal', 'dificil'].map(dd => `<option value="${dd}" ${c.difficulty === dd ? 'selected' : ''}>${dd}</option>`).join('')}
        </select></label>
      <label class="text-[10.5px] text-slate-400">Inimigos extras
        <input id="gs-c-enemies" type="number" min="0" max="12" value="${esc(c.extraEnemies)}" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100"></label>
    </div>
    <button data-gs-act="save-config" data-id="${esc(g.id)}" class="px-3 py-2 rounded-xl border border-violet-400/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-100 text-[12px] font-semibold">Salvar ajustes</button>
  </div>`;
}

function renderTabHistorico(d, g) {
  const commands = (d.commands || []).slice().reverse().map(cm =>
    `<div class="text-[11px] text-slate-400 border-b border-white/5 py-1 flex items-center gap-2">
      <span class="text-slate-500 font-mono">${fmtDate(cm.at)}</span>
      <span class="text-slate-300">${esc(cm.text)}</span>
      <span class="ml-auto text-slate-500">${esc((cm.changed || []).join(', '))}</span>
    </div>`).join('') || '<div class="text-[11px] text-slate-500">Sem alterações registradas.</div>';

  const tests = (d.tests || []).slice().reverse().map(t =>
    `<div class="rounded-lg border ${t.ok ? 'border-emerald-400/20 bg-emerald-500/5' : 'border-rose-400/20 bg-rose-500/5'} px-2.5 py-1.5">
      <div class="text-[11px] ${t.ok ? 'text-emerald-200' : 'text-rose-200'} font-semibold flex items-center gap-2">
        ${t.ok ? 'Aprovado' : 'Falhas'} · ${t.passed}/${t.passed + t.failed}
        <span class="ml-auto text-slate-500 font-mono font-normal">${fmtDate(t.at)}</span>
      </div>
      <div class="mt-1 space-y-0.5">${(t.checks || []).map(ck =>
        `<div class="text-[10.5px] ${ck.ok ? 'text-slate-400' : 'text-rose-300'}">${ck.ok ? '✓' : '✕'} ${esc(ck.name)}${ck.detail ? ' — ' + esc(ck.detail) : ''}</div>`).join('')}</div>
    </div>`).join('') || '<div class="text-[11px] text-slate-500">Nenhum teste executado.</div>';

  const versions = (d.versions || []).slice().reverse().map(v =>
    `<div class="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
      <span class="text-[11px] text-slate-300 truncate">${esc(v.label)}</span>
      <span class="text-[10px] text-slate-500 font-mono ml-auto">${fmtDate(v.at)}</span>
      <button data-gs-act="restore" data-id="${esc(g.id)}" data-version="${esc(v.id)}" class="text-[10.5px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Restaurar</button>
    </div>`).join('') || '<div class="text-[11px] text-slate-500">Sem versões.</div>';

  return `<div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
    <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
      <div class="text-[12px] font-semibold text-violet-200">Testes</div>
      ${tests}
    </div>
    <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
      <div class="text-[12px] font-semibold text-violet-200">Histórico de versões</div>
      <div class="space-y-1.5">${versions}</div>
    </div>
    <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
      <div class="text-[12px] font-semibold text-violet-200">Alterações por comando</div>
      ${commands}
    </div>
  </div>`;
}

function renderPublication(g) {
  const pub = g.publication;
  const builds = g.buildsCount || 0;
  const latest = g.latestBuild;
  const active = pub && pub.active;

  const head = `<div class="flex items-center gap-2 flex-wrap">
      <div class="text-[12px] font-semibold text-violet-200">Publicação</div>
      ${active
        ? `<span class="px-2 py-[2px] rounded-full border text-[10px] font-bold ${pub.public ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/30 bg-amber-500/10 text-amber-200'}">${pub.public ? 'Público' : 'Privado'}</span>
           <span class="px-2 py-[2px] rounded-full border border-white/10 bg-white/5 text-[10px] text-slate-400">versão publicada v${esc(pub.version)}</span>
           <span class="text-[10px] text-slate-500 font-mono">${fmtDate(pub.publishedAt)}</span>`
        : `<span class="px-2 py-[2px] rounded-full border border-white/10 bg-white/5 text-[10px] text-slate-400">Não publicado</span>`}
      <span class="ml-auto text-[10px] text-slate-500">${builds} build(s)${latest ? ' · último v' + esc(latest.number) : ''}</span>
    </div>`;

  if (active) {
    const full = new URL(pub.url, location.origin).toString();
    return `<div class="rounded-2xl border border-white/10 bg-white/[0.02] p-3 space-y-2.5">
      ${head}
      <div class="flex items-center gap-2 flex-wrap">
        <input readonly value="${esc(full)}" class="flex-1 min-w-[220px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-slate-300 font-mono">
        <button data-gs-act="copy" data-url="${esc(pub.url)}" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Copiar link</button>
        <a href="${esc(pub.url)}" target="_blank" rel="noopener" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-sky-400/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200">Abrir</a>
      </div>
      ${STATE.confirmPublish ? confirmPanel(g, pub.public) : `
      <div class="flex items-center gap-1.5 flex-wrap">
        <button data-gs-act="publish" data-id="${esc(g.id)}" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-violet-400/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-100">Atualizar publicação</button>
        <button data-gs-act="build" data-id="${esc(g.id)}" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Gerar novo build</button>
        <button data-gs-act="unpublish" data-id="${esc(g.id)}" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-rose-400/20 bg-rose-500/5 hover:bg-rose-500/15 text-rose-300">Retirar do ar</button>
      </div>`}
    </div>`;
  }

  return `<div class="rounded-2xl border border-white/10 bg-white/[0.02] p-3 space-y-2.5">
    ${head}
    ${STATE.confirmPublish ? confirmPanel(g, true) : `
    <div class="flex items-center gap-1.5 flex-wrap">
      <button data-gs-act="build" data-id="${esc(g.id)}" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Gerar build de produção</button>
      <button data-gs-act="publish" data-id="${esc(g.id)}" class="text-[11px] px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Publicar</button>
    </div>
    <div class="text-[10.5px] text-slate-500">Publicar gera um build congelado da versão atual e exige confirmação explícita. Jogo privado fica acessível apenas pelo link de prévia.</div>`}
  </div>`;
}

function confirmPanel(g, isPublic) {
  return `<div class="rounded-xl border border-amber-400/30 bg-amber-500/10 p-2.5 space-y-2">
    <div class="text-[11px] text-amber-100">Publicar este jogo na internet? Qualquer pessoa com o link poderá jogar.</div>
    <label class="text-[10.5px] text-amber-100/90 flex items-center gap-1.5">
      <input type="checkbox" id="gs-pub-public" ${isPublic ? 'checked' : ''} class="accent-violet-500">
      Tornar público (desmarcado = privado, acessível apenas pelo link de prévia)
    </label>
    <div class="flex items-center gap-1.5">
      <button data-gs-act="publish-confirm" data-id="${esc(g.id)}" class="text-[11px] px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold">Confirmar publicação</button>
      <button data-gs-act="publish-cancel" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Cancelar</button>
    </div>
  </div>`;
}

function bindNew() {
  const f = $('#gs-f-name');
  if (f) f.focus();
}

/* ---------------- ações ---------------- */
async function loadCatalog() {
  try {
    const [t, s] = await Promise.all([api('/templates'), api('/status')]);
    STATE.templates = t.templates || [];
    STATE.resources = t.resources || [];
    STATE.status = s;
  } catch (e) { toast(e.message || 'Falha ao carregar catálogo.', 'err'); }
}

async function loadList() {
  try {
    const d = await api('/games');
    STATE.games = d.items || [];
  } catch (e) {
    toast(e.message || 'Falha ao carregar os jogos.', 'err');
    STATE.games = [];
  }
  render();
}

async function openDetail(id) {
  try {
    const d = await api('/game/' + encodeURIComponent(id));
    STATE.detail = d;
    STATE.previewUrl = null;
    STATE.confirmPublish = false;
    STATE.view = 'detail';
    render();
    await startPreview(id, false);
  } catch (e) { toast(e.message || 'Falha ao abrir o jogo.', 'err'); }
}

async function startPreview(id, reload) {
  try {
    const d = await api('/game/' + encodeURIComponent(id) + '/preview', { method: 'POST', body: {} });
    STATE.previewUrl = d.url + (reload ? ('?t=' + Date.now()) : '');
    const frame = $('#gs-frame');
    if (frame) frame.src = STATE.previewUrl;
    const label = $('#gs-url');
    if (label) label.textContent = STATE.previewUrl;
  } catch (e) { toast(e.message || 'Falha na pré-visualização.', 'err'); }
}

async function createGame() {
  const name = ($('#gs-f-name') && $('#gs-f-name').value.trim()) || '';
  const genre = STATE.newGenre || '';
  const description = ($('#gs-f-desc') && $('#gs-f-desc').value.trim()) || '';
  if (!name) { toast('Informe o nome do jogo.', 'err'); return; }
  if (!genre) { toast('Escolha um modelo para o jogo.', 'err'); return; }
  if (STATE.busy) return;
  STATE.busy = true;
  try {
    const d = await api('/create', { method: 'POST', body: { name, genre, description } });
    toast('Jogo criado: ' + d.game.name, 'ok');
    if (d.hints && d.hints.length) toast('Memória: ' + d.hints.length + ' registro(s) relacionado(s) encontrado(s).', 'info');
    STATE.newDraft = { name: '', description: '' };
    STATE.newGenre = '';
    await loadList();
    await openDetail(d.game.id);
  } catch (e) { toast(e.message || 'Falha ao criar o jogo.', 'err'); }
  finally { STATE.busy = false; }
}

async function runCommand(id, text) {
  if (!text) { toast('Descreva a alteração desejada.', 'err'); return; }
  try {
    const d = await api('/game/' + encodeURIComponent(id) + '/command', { method: 'POST', body: { text } });
    toast('Alteração aplicada: ' + (d.changed || []).join(', '), 'ok');
    await openDetail(id);
  } catch (e) { toast(e.message || 'Falha ao aplicar o comando.', 'err'); }
}

async function saveConfig(id) {
  const body = {
    patch: {
      playerColor: $('#gs-c-player') && $('#gs-c-player').value,
      enemyColor: $('#gs-c-enemy') && $('#gs-c-enemy').value,
      itemColor: $('#gs-c-item') && $('#gs-c-item').value,
      background: $('#gs-c-bg') && $('#gs-c-bg').value,
      speed: Number($('#gs-c-speed') && $('#gs-c-speed').value),
      difficulty: $('#gs-c-diff') && $('#gs-c-diff').value,
      extraEnemies: Number($('#gs-c-enemies') && $('#gs-c-enemies').value),
    },
  };
  try {
    const d = await api('/game/' + encodeURIComponent(id) + '/command', { method: 'POST', body });
    if (!d.changed || !d.changed.length) { toast('Nenhuma alteração nos ajustes.', 'info'); return; }
    toast('Ajustes salvos: ' + d.changed.join(', '), 'ok');
    await openDetail(id);
  } catch (e) { toast(e.message || 'Falha ao salvar os ajustes.', 'err'); }
}

async function runTest(id) {
  try {
    const d = await api('/game/' + encodeURIComponent(id) + '/test', { method: 'POST', body: {} });
    const r = d.result;
    toast(r.ok ? ('Teste aprovado (' + r.passed + '/' + (r.passed + r.failed) + ').') : ('Teste com ' + r.failed + ' falha(s).'), r.ok ? 'ok' : 'err');
    if (STATE.view === 'detail') await openDetail(id); else await loadList();
  } catch (e) { toast(e.message || 'Falha ao testar.', 'err'); }
}

async function restoreVersion(id, versionId) {
  if (!window.confirm('Restaurar esta versão do jogo? O estado atual será guardado no histórico.')) return;
  try {
    await api('/game/' + encodeURIComponent(id) + '/restore', { method: 'POST', body: { versionId } });
    toast('Versão restaurada.', 'ok');
    await openDetail(id);
  } catch (e) { toast(e.message || 'Falha ao restaurar.', 'err'); }
}

async function removeGame(id) {
  if (!window.confirm('Excluir este jogo do Game Studio? A pasta no workspace é mantida.')) return;
  try {
    await api('/game/' + encodeURIComponent(id), { method: 'DELETE', body: {} });
    toast('Jogo removido.', 'ok');
    STATE.view = 'list';
    await loadList();
  } catch (e) { toast(e.message || 'Falha ao excluir.', 'err'); }
}

function copyLink(url) {
  const full = new URL(url || '', location.origin).toString();
  const done = () => toast('Link copiado: ' + full, 'ok');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(full).then(done).catch(() => window.prompt('Copie o link do jogo:', full));
  } else { window.prompt('Copie o link do jogo:', full); }
}

/* ---------------- Publicação (ETAPA 5) ---------------- */
async function runBuild(id) {
  try {
    const d = await api('/game/' + encodeURIComponent(id) + '/build', { method: 'POST', body: {} });
    toast('Build de produção v' + d.build.number + ' gerado.', 'ok');
    await openDetail(id);
  } catch (e) { toast(e.message || 'Falha ao gerar o build.', 'err'); }
}

async function runPublish(id, isPublic) {
  try {
    const d = await api('/game/' + encodeURIComponent(id) + '/publish', { method: 'POST', body: { confirm: true, isPublic, rebuild: true } });
    toast('Publicado (v' + d.publication.version + ') como ' + (d.publication.public ? 'público' : 'privado') + '.', 'ok');
    await openDetail(id);
  } catch (e) { toast(e.message || 'Falha ao publicar.', 'err'); }
}

async function runUnpublish(id) {
  try {
    await api('/game/' + encodeURIComponent(id) + '/unpublish', { method: 'POST', body: {} });
    toast('Jogo retirado do ar.', 'ok');
    await openDetail(id);
  } catch (e) { toast(e.message || 'Falha ao retirar do ar.', 'err'); }
}

/* ---------------- bind (delegação) ---------------- */
function onClick(ev) {
  const t = ev.target.closest('[data-gs-act]');
  if (!t) return;
  const act = t.getAttribute('data-gs-act');
  const id = t.getAttribute('data-id');
  if (act === 'new') { STATE.view = 'new'; STATE.newDraft = { name: '', description: '' }; STATE.newGenre = ''; render(); }
  else if (act === 'cancel') { STATE.view = 'list'; STATE.newDraft = { name: '', description: '' }; STATE.newGenre = ''; render(); }
  else if (act === 'pick-genre') { captureDraft(); STATE.newGenre = t.getAttribute('data-genre'); render(); }
  else if (act === 'create') { createGame(); }
  else if (act === 'open' && id) { STATE.detailTab = 'jogar'; openDetail(id); }
  else if (act === 'back') { STATE.view = 'list'; loadList(); }
  else if (act === 'preview' && id) { STATE.detailTab = 'jogar'; openDetail(id); }
  else if (act === 'detail-tab') {
    const tb = t.getAttribute('data-tab');
    STATE.detailTab = DETAIL_TABS.some(x => x.key === tb) ? tb : 'jogar';
    if (STATE.detailTab === 'jogar' && STATE.detail && !STATE.previewUrl) startPreview(STATE.detail.game.id, false);
    render();
  }
  else if (act === 'reload-preview' && id) { startPreview(id, true); }
  else if (act === 'test' && id) { runTest(id); }
  else if (act === 'command' && id) { runCommand(id, ($('#gs-cmd') && $('#gs-cmd').value.trim()) || ''); }
  else if (act === 'quick' && id) { runCommand(id, t.getAttribute('data-cmd')); }
  else if (act === 'save-config' && id) { saveConfig(id); }
  else if (act === 'restore' && id) { restoreVersion(id, t.getAttribute('data-version')); }
  else if (act === 'build' && id) { runBuild(id); }
  else if (act === 'publish' && id) { STATE.confirmPublish = true; render(); }
  else if (act === 'publish-confirm' && id) {
    const chk = $('#gs-pub-public');
    runPublish(id, chk ? !!chk.checked : true);
  }
  else if (act === 'publish-cancel') { STATE.confirmPublish = false; render(); }
  else if (act === 'unpublish' && id) { runUnpublish(id); }
  else if (act === 'copy') { copyLink(t.getAttribute('data-url')); }
  else if (act === 'delete' && id) { removeGame(id); }
  else if (act === 'reload') { loadCatalog().then(loadList); }
}

document.addEventListener('click', onClick);
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target && ev.target.id === 'gs-cmd') {
    const id = STATE.detail && STATE.detail.game && STATE.detail.game.id;
    if (id) runCommand(id, ev.target.value.trim());
  }
});
document.addEventListener('input', (ev) => {
  if (ev.target && ev.target.id === 'gs-c-speed') { const s = $('#gs-v-speed'); if (s) s.textContent = ev.target.value; }
});

/* =========================================================
 * Hooks da aba (chamados por public/app.js)
 * =======================================================*/
window.__gamestudioOnTabOpen = function () {
  try {
    if (!STATE.inited) { STATE.inited = true; loadCatalog().then(loadList); }
    else { loadList(); }
  } catch (e) { console.error('[gamestudio] open erro:', e); }
};
window.__gamestudioOnTabClose = function () {};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { if ($('#gs-panel') && !$('#gs-panel').classList.contains('hidden')) window.__gamestudioOnTabOpen(); });
} else {
  if ($('#gs-panel') && !$('#gs-panel').classList.contains('hidden')) window.__gamestudioOnTabOpen();
}

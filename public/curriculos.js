/* =========================================================
 * public/curriculos.js — Aba "Currículos IA" (frontend do módulo)
 * ---------------------------------------------------------
 * Consome somente /api/curriculos/* (backend curriculos/service.js).
 * Reutiliza a IA já existente no backend (nada de segunda infraestrutura).
 * Escopo por proprietário: um id estável no localStorage define o dono.
 * =======================================================*/

const API = '/api/curriculos';

/* ---------------- estado ---------------- */
const S = {
  inited: false,
  status: null,
  areas: [],
  templates: [],
  view: 'home',          // home | start | list | doc
  listMode: 'normal',    // normal | adapt | analyze
  doc: null,
  docTab: 'conversa',    // conversa | campos | vaga | analise | previa | versoes
  chat: [],
  greeted: {},
  previewTemplate: null,
  busy: false,
};

/* ---------------- utilidades ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const lines = (v) => String(v || '').split('\n').map(x => x.trim()).filter(Boolean);
const fmtDate = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};

function getOwner() {
  if (S.owner) return S.owner;
  let o = '';
  try { o = localStorage.getItem('cv.owner.v1') || ''; } catch {}
  if (!o) {
    o = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem('cv.owner.v1', o); } catch {}
  }
  S.owner = o;
  return o;
}

async function api(path, { method = 'GET', body = null } = {}) {
  const url = new URL(API + path, location.origin);
  if (method === 'GET') url.searchParams.set('owner', getOwner());
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify({ ...body, owner: getOwner() });
  }
  const r = await fetch(url.toString(), opts);
  let data = null;
  try { data = await r.json(); } catch { data = { ok: false, error: 'Resposta inválida do servidor.' }; }
  if (!r.ok || data.ok === false) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
}

function toast(msg, kind = 'info') {
  const host = $('#cvd-toasts');
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

function busy(on, label = '') {
  S.busy = on;
  const b = $('#cvd-body');
  if (b) b.classList.toggle('opacity-60', on);
  if (on && label) toast(label, 'info');
}

/* ---------------- ícones ---------------- */
const ICO = {
  spark: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  target: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
  seed: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22V8M12 8a4 4 0 0 1 4-4h4v2a6 6 0 0 1-6 6zM12 12a4 4 0 0 0-4-4H4v2a6 6 0 0 0 6 6z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  gauge: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 14l4-4M20.5 15a9 9 0 1 0-17 0"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
  dl: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  wand: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 4V2M15 10V8M12.5 6h-2M19.5 6h-2M4 20l10-10 3 3L7 23z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/></svg>',
};

/* ---------------- classes utilitárias de UI ---------------- */
const BTN = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium transition border';
const BTN_P = `${BTN} bg-violet-600 hover:bg-violet-500 border-violet-500/40 text-white`;
const BTN_S = `${BTN} bg-white/[0.04] hover:bg-white/[0.09] border-white/10 text-slate-200`;
const BTN_G = `${BTN} bg-emerald-600/80 hover:bg-emerald-500 border-emerald-500/40 text-white`;
const CARD = 'rounded-2xl border border-white/10 bg-white/[0.03] shadow-lg shadow-black/20';
const INPUT = 'w-full rounded-lg bg-[#0b1024] border border-white/10 px-2.5 py-2 text-[12.5px] text-slate-100 placeholder:text-slate-600 focus:border-violet-400/60 outline-none';
const LBL = 'block text-[10.5px] uppercase tracking-wider text-slate-500 mb-1';

const STATUS_BADGE = {
  entrevista: ['Entrevista', 'bg-amber-500/15 text-amber-200 border-amber-400/30'],
  rascunho: ['Rascunho', 'bg-sky-500/15 text-sky-200 border-sky-400/30'],
  gerado: ['Gerado', 'bg-violet-500/15 text-violet-200 border-violet-400/30'],
  adaptado: ['Adaptado à vaga', 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30'],
};

/* =========================================================
 * Entrada da aba
 * =======================================================*/
export function init() {
  if (S.inited) return;
  const body = $('#cvd-body');
  if (!body) return;
  S.inited = true;
  getOwner();

  $('#cvd-home')?.addEventListener('click', () => { S.view = 'home'; S.doc = null; render(); });
  $('#cvd-list')?.addEventListener('click', () => openList('normal'));
  $('#cvd-reload')?.addEventListener('click', async () => { await loadMeta(true); render(); toast('Dados do módulo recarregados.', 'ok'); });

  body.addEventListener('click', onBodyClick);
  body.addEventListener('submit', (e) => e.preventDefault());

  loadMeta().then(() => render()).catch(() => render());
}

async function loadMeta(force = false) {
  if (S.status && !force) return;
  try {
    S.status = await api('/status');
    S.templates = S.status.templates || [];
    const chip = $('#cvd-ai-chip');
    if (chip) {
      const on = !!S.status.ai?.available;
      chip.textContent = on ? 'IA ativa' : 'IA indisponível';
      chip.className = on
        ? 'px-2 py-[3px] rounded-full border border-emerald-400/30 bg-emerald-500/15 text-emerald-200 font-mono hidden sm:inline'
        : 'px-2 py-[3px] rounded-full border border-amber-400/30 bg-amber-500/15 text-amber-200 font-mono hidden sm:inline';
      chip.title = on
        ? 'A IA está conectada pela configuração existente do TI Agente.'
        : 'Sem IA configurada: o módulo organiza os dados reais automaticamente (sem gerar texto novo).';
    }
  } catch (e) {
    toast('Não foi possível falar com o módulo de currículos.', 'err');
    throw e;
  }
  if (!S.areas.length) {
    try { const a = await api('/areas'); S.areas = a.areas || []; S.templates = a.templates || S.templates; } catch {}
  }
}

/* =========================================================
 * Roteamento de telas
 * =======================================================*/
function render() {
  const body = $('#cvd-body');
  if (!body) return;
  const html = S.view === 'doc' ? renderDoc()
    : S.view === 'list' ? renderList()
      : S.view === 'start' ? renderStart()
        : renderHome();
  body.innerHTML = html;
  if (S.view === 'doc') afterRenderDoc();
}

/* ---------------- HOME ---------------- */
function renderHome() {
  const cards = [
    { mode: 'criar', icon: ICO.spark, tone: 'violet', title: 'Criar currículo com IA', desc: 'A IA conversa com você, coleta suas informações e escreve o currículo.' },
    { mode: 'melhorar', icon: ICO.up, tone: 'sky', title: 'Melhorar currículo existente', desc: 'Envie um currículo antigo em PDF, DOCX ou TXT e a IA organiza e reescreve.' },
    { mode: 'vaga', icon: ICO.target, tone: 'emerald', title: 'Adaptar currículo para uma vaga', desc: 'Cole a descrição da vaga e receba uma versão direcionada, sem inventar nada.' },
    { mode: 'primeiro', icon: ICO.seed, tone: 'amber', title: 'Criar currículo para primeiro emprego', desc: 'Sem experiência? A IA valoriza formação, cursos, projetos e potencial.' },
  ];
  const tones = { violet: 'text-violet-300 bg-violet-500/15 border-violet-400/25', sky: 'text-sky-300 bg-sky-500/15 border-sky-400/25', emerald: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/25', amber: 'text-amber-300 bg-amber-500/15 border-amber-400/25' };
  const aiOn = !!S.status?.ai?.available;

  return `
  <div class="max-w-4xl mx-auto space-y-4">
    <div class="${CARD} p-4 md:p-5 bg-gradient-to-br from-violet-600/15 via-transparent to-sky-500/10">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-violet-500/20 border border-violet-400/30 grid place-items-center text-violet-200 shrink-0">${ICO.wand}</div>
        <div class="min-w-0">
          <h2 class="text-[15px] font-semibold text-white">Você não precisa montar o currículo sozinho</h2>
          <p class="text-[12px] text-slate-400 mt-1 leading-relaxed">
            Informe seus dados por conversa ou em campos guiados. A IA analisa, organiza, reescreve e gera o melhor currículo
            possível para o seu objetivo — sempre com dados verdadeiros, nunca inventando empresas, cursos ou resultados.
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
            <span class="px-2 py-0.5 rounded-full border ${aiOn ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/30 bg-amber-500/10 text-amber-200'}">${aiOn ? 'IA conectada' : 'IA indisponível'}</span>
            <span class="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-400">${S.areas.length || 13} áreas profissionais</span>
            <span class="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-400">PDF · DOCX</span>
            <span class="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-400">Análise ATS + nota 0–100</span>
          </div>
          ${aiOn ? '' : `<p class="mt-2 text-[11px] text-amber-200/90">A IA não está configurada agora. Você ainda pode preencher seus dados: o módulo organiza o currículo automaticamente, sem gerar texto novo.</p>`}
        </div>
      </div>
    </div>

    <div class="grid sm:grid-cols-2 gap-3">
      ${cards.map(c => `
        <button data-act="start" data-mode="${c.mode}" class="text-left ${CARD} p-3.5 hover:border-violet-400/40 hover:bg-white/[0.06] transition group">
          <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-lg border grid place-items-center ${tones[c.tone]}">${c.icon}</span>
            <span class="text-[13px] font-semibold text-slate-100">${esc(c.title)}</span>
          </div>
          <p class="text-[11.5px] text-slate-400 mt-2 leading-relaxed">${esc(c.desc)}</p>
        </button>`).join('')}
      <button data-act="list" data-mode="normal" class="${CARD} p-3.5 text-left hover:border-violet-400/40 hover:bg-white/[0.06] transition">
        <div class="flex items-center gap-2">
          <span class="w-7 h-7 rounded-lg border grid place-items-center text-slate-300 bg-white/10 border-white/15">${ICO.folder}</span>
          <span class="text-[13px] font-semibold text-slate-100">Meus currículos</span>
        </div>
        <p class="text-[11.5px] text-slate-400 mt-2 leading-relaxed">Veja, continue, exporte ou exclua os currículos que você já criou.</p>
      </button>
      <button data-act="list" data-mode="analyze" class="${CARD} p-3.5 text-left hover:border-violet-400/40 hover:bg-white/[0.06] transition">
        <div class="flex items-center gap-2">
          <span class="w-7 h-7 rounded-lg border grid place-items-center text-sky-300 bg-sky-500/15 border-sky-400/25">${ICO.gauge}</span>
          <span class="text-[13px] font-semibold text-slate-100">Análise de qualidade</span>
        </div>
        <p class="text-[11.5px] text-slate-400 mt-2 leading-relaxed">Nota de 0 a 100 por dimensão, leitura ATS e o que melhorar em cada ponto.</p>
      </button>
    </div>

    <p class="text-[10.5px] text-slate-500 leading-relaxed">
      A pontuação mede a qualidade documental do currículo — não é probabilidade de aprovação, contratação ou entrevista.
    </p>
  </div>`;
}

/* ---------------- START (formulário inicial) ---------------- */
function renderStart() {
  const mode = S.startMode || 'criar';
  const titles = {
    criar: 'Criar currículo com IA', melhorar: 'Melhorar currículo existente',
    vaga: 'Adaptar currículo para uma vaga', primeiro: 'Currículo para primeiro emprego',
  };
  const areaOpts = S.areas.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  return `
  <div class="max-w-2xl mx-auto space-y-3">
    <button data-act="home" class="${BTN_S}">← Início</button>
    <div class="${CARD} p-4 space-y-3">
      <h2 class="text-[14px] font-semibold text-white">${esc(titles[mode] || 'Novo currículo')}</h2>
      <p class="text-[11.5px] text-slate-400">Só o essencial agora — o resto a IA pergunta durante a conversa.</p>
      <label class="block"><span class="${LBL}">Seu nome completo (opcional)</span>
        <input id="cv-start-name" class="${INPUT}" placeholder="Ex.: Maria Souza Oliveira"></label>
      <label class="block"><span class="${LBL}">Profissão ou área de interesse</span>
        <input id="cv-start-area-txt" list="cv-areas-list" class="${INPUT}" placeholder="Ex.: Auxiliar Administrativo">
        <datalist id="cv-areas-list">${S.areas.map(a => `<option value="${esc(a.name)}"></option>`).join('')}</datalist>
      </label>
      <label class="block"><span class="${LBL}">Área mais próxima (opcional)</span>
        <select id="cv-start-area" class="${INPUT}"><option value="">Deixe a IA identificar</option>${areaOpts}</select></label>
      ${mode === 'vaga' ? `<label class="block"><span class="${LBL}">Descrição da vaga (opcional agora)</span>
        <textarea id="cv-start-job" rows="4" class="${INPUT}" placeholder="Cole aqui o texto da vaga"></textarea></label>` : ''}
      <div class="flex flex-wrap gap-2 pt-1">
        <button data-act="create" class="${BTN_P}">${ICO.spark} Começar</button>
        ${mode === 'melhorar' ? `<button data-act="create" data-goto="campos" class="${BTN_S}">Já tenho um arquivo para enviar</button>` : ''}
      </div>
    </div>
  </div>`;
}

/* ---------------- LISTA ---------------- */
function renderList() {
  const hints = {
    normal: 'Seus currículos ficam salvos neste navegador e só são acessíveis por você.',
    adapt: 'Escolha um currículo para adaptar a uma vaga específica.',
    analyze: 'Escolha um currículo para ver a nota de qualidade e a leitura ATS.',
  };
  return `
  <div class="max-w-3xl mx-auto space-y-3">
    <div class="flex items-center justify-between gap-2">
      <button data-act="home" class="${BTN_S}">← Início</button>
      <button data-act="start" data-mode="criar" class="${BTN_P}">${ICO.plus} Novo currículo</button>
    </div>
    <p class="text-[11.5px] text-slate-400">${esc(hints[S.listMode] || hints.normal)}</p>
    <div id="cv-list-host"><div class="text-[12px] text-slate-500 py-6 text-center">Carregando…</div></div>
  </div>`;
}

async function loadList() {
  const host = $('#cv-list-host');
  if (!host) return;
  try {
    const out = await api('/list');
    const items = out.items || [];
    if (!items.length) {
      host.innerHTML = `<div class="${CARD} p-6 text-center">
        <p class="text-[12.5px] text-slate-400">Você ainda não tem currículos salvos.</p>
        <button data-act="start" data-mode="criar" class="${BTN_P} mt-3">${ICO.spark} Criar o primeiro</button>
      </div>`;
      return;
    }
    host.innerHTML = items.map(it => {
      const [lbl, cls] = STATUS_BADGE[it.status] || ['—', 'bg-white/5 text-slate-400 border-white/10'];
      return `<div class="${CARD} p-3 mb-2.5">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-[13px] font-semibold text-slate-100 truncate">${esc(it.title || 'Currículo')}</div>
            <div class="text-[11px] text-slate-500 mt-0.5 truncate">
              ${esc(it.areaName || 'Área não definida')}
              ${it.targetJob?.title ? ` · vaga: ${esc(it.targetJob.title)}` : ''}
            </div>
          </div>
          <span class="shrink-0 px-2 py-0.5 rounded-full border text-[10px] ${cls}">${esc(lbl)}</span>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-slate-500">
          <span>Atualizado ${esc(fmtDate(it.updatedAt))}</span>
          <span>· ${it.versionsCount || 0} versão(ões)</span>
          ${typeof it.lastScore === 'number' ? `<span>· Nota ${it.lastScore}/100</span>` : ''}
        </div>
        <div class="mt-2.5 flex flex-wrap gap-1.5">
          <button data-act="open" data-id="${esc(it.id)}" class="${BTN_P} py-1.5">Abrir</button>
          <button data-act="open" data-id="${esc(it.id)}" data-tab="vaga" class="${BTN_S} py-1.5">${ICO.target} Adaptar</button>
          <button data-act="open" data-id="${esc(it.id)}" data-tab="analise" class="${BTN_S} py-1.5">${ICO.gauge} Analisar</button>
          <button data-act="quick-pdf" data-id="${esc(it.id)}" class="${BTN_S} py-1.5">${ICO.dl} PDF</button>
          <button data-act="del" data-id="${esc(it.id)}" class="${BTN_S} py-1.5 text-rose-300 hover:bg-rose-500/10">${ICO.trash} Excluir</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    host.innerHTML = `<div class="${CARD} p-6 text-center">
      <p class="text-[12.5px] text-rose-200">${esc(e.message)}</p>
      <button data-act="reload-list" class="${BTN_S} mt-3">Tentar novamente</button>
    </div>`;
  }
}

/* ---------------- DOC (currículo aberto) ---------------- */
const DOC_TABS = [
  ['conversa', 'Conversa', ICO.chat],
  ['campos', 'Campos guiados', ICO.up],
  ['vaga', 'Vaga', ICO.target],
  ['analise', 'Análise', ICO.gauge],
  ['previa', 'Currículo', ICO.eye],
  ['versoes', 'Versões', ICO.clock],
];

function renderDoc() {
  const d = S.doc;
  if (!d) return `<div class="text-center py-8 text-[12px] text-slate-400">Currículo não carregado. <button data-act="home" class="${BTN_S} ml-2">Voltar</button></div>`;
  const [lbl, cls] = STATUS_BADGE[d.status] || ['—', 'bg-white/5 text-slate-400 border-white/10'];
  const prog = completeness(d.profile);
  const tabs = DOC_TABS.map(([k, t, ic]) => `
    <button data-act="doctab" data-tab="${k}" class="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] border transition ${S.docTab === k ? 'bg-violet-600/25 border-violet-400/40 text-violet-100' : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-slate-200'}">
      ${ic}<span>${esc(t)}</span>
      ${k === 'versoes' && d.versions?.length ? `<span class="text-[9.5px] px-1 rounded bg-white/10">${d.versions.length}</span>` : ''}
    </button>`).join('');

  return `
  <div class="max-w-5xl mx-auto space-y-3">
    <div class="flex items-start justify-between gap-2 flex-wrap">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <button data-act="home" class="${BTN_S} py-1.5">←</button>
          <span class="text-[13.5px] font-semibold text-white truncate">${esc(d.title || 'Currículo')}</span>
          <span class="shrink-0 px-2 py-0.5 rounded-full border text-[10px] ${cls}">${esc(lbl)}</span>
        </div>
        <div class="text-[11px] text-slate-500 mt-1">${esc(d.areaName || 'Área não definida')}${d.targetJob?.title ? ` · vaga: ${esc(d.targetJob.title)}` : ''}</div>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button data-act="gen" class="${BTN_P} py-1.5">${ICO.spark} Gerar com IA</button>
        <button data-act="analyze" class="${BTN_S} py-1.5">${ICO.gauge} Analisar</button>
        <button data-act="download" data-fmt="pdf" class="${BTN_S} py-1.5">${ICO.dl} PDF</button>
        <button data-act="download" data-fmt="docx" class="${BTN_S} py-1.5">${ICO.dl} DOCX</button>
        <button data-act="del" data-id="${esc(d.id)}" class="${BTN_S} py-1.5 text-rose-300 hover:bg-rose-500/10">${ICO.trash} Excluir</button>
      </div>
    </div>

    <div class="${CARD} p-2.5">
      <div class="flex items-center gap-2">
        <span class="text-[10.5px] text-slate-500 shrink-0">Progresso</span>
        <div class="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden"><div class="cv-progress-fill h-full bg-gradient-to-r from-violet-500 to-sky-400 transition-all" style="width:${prog}%"></div></div>
        <span class="cv-progress-pct text-[10.5px] text-slate-400 font-mono shrink-0">${prog}%</span>
      </div>
      <div class="mt-1.5 text-[10.5px] text-slate-500">
        ${d.missingInfo?.length ? `Falta informar: ${esc(d.missingInfo.slice(0, 6).join(', '))}${d.missingInfo.length > 6 ? '…' : ''}` : 'Informações essenciais completas.'}
      </div>
    </div>

    <div class="flex gap-1.5 overflow-x-auto pb-0.5">${tabs}</div>

    <div id="cv-doc-host">${renderDocTab()}</div>
  </div>`;
}

function renderDocTab() {
  switch (S.docTab) {
    case 'campos': return renderCampos();
    case 'vaga': return renderVaga();
    case 'analise': return renderAnalise();
    case 'previa': return renderPrevia();
    case 'versoes': return renderVersoes();
    default: return renderConversa();
  }
}

function refreshDocTab() {
  const host = $('#cv-doc-host');
  if (host) host.innerHTML = renderDocTab();
  const tabs = $$('#cvd-body [data-act="doctab"]');
  tabs.forEach(b => {
    const on = b.dataset.tab === S.docTab;
    b.className = `shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] border transition ${on ? 'bg-violet-600/25 border-violet-400/40 text-violet-100' : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-slate-200'}`;
  });
  if (S.docTab === 'conversa') afterRenderConversa();
}

function completeness(p) {
  if (!p) return 0;
  const checks = [
    !!p.fullName, !!p.email, !!p.phone, !!(p.city || p.state), !!p.headline, !!p.objective,
    (p.experiences || []).length > 0, (p.education || []).length > 0,
    ((p.skills?.technical?.length || 0) + (p.skills?.behavioral?.length || 0)) > 0,
    (p.languages || []).length > 0, (p.courses || []).length > 0, !!p.summary,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

/* ---------------- CONVERSA (entrevista + edição) ---------------- */
function renderConversa() {
  const d = S.doc;
  const mode = d.status === 'entrevista' ? 'entrevista' : 'edicao';
  return `
  <div class="grid lg:grid-cols-[1.4fr_1fr] gap-3">
    <div class="${CARD} flex flex-col min-h-[420px] max-h-[62vh]">
      <div class="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-2">
        <span class="text-[11.5px] font-semibold text-slate-200">${mode === 'entrevista' ? 'Entrevistador IA' : 'Ajustes por conversa'}</span>
        <span class="text-[10px] text-slate-500">${mode === 'entrevista' ? 'Responda com o que for verdade — a IA pergunta o que falta.' : 'Peça alterações e a IA aplica no currículo.'}</span>
      </div>
      <div id="cv-chat" class="flex-1 min-h-0 overflow-auto p-3 space-y-2.5"></div>
      <div class="p-2.5 border-t border-white/10">
        <div class="flex gap-2 items-end">
          <textarea id="cv-msg" rows="2" class="${INPUT} resize-none" placeholder="${mode === 'entrevista' ? 'Ex.: Sou vendedora, trabalhei na Loja Beta de 2022 a 2024…' : 'Ex.: Deixe o resumo mais curto e destaque atendimento ao cliente.'}"></textarea>
          <button data-act="send" class="${BTN_P} py-2.5">Enviar</button>
        </div>
      </div>
    </div>
    <div class="space-y-3">
      <div class="${CARD} p-3">
        <div class="text-[11.5px] font-semibold text-slate-200 mb-2">O que a IA já entendeu</div>
        <div id="cv-summary-host">${renderProfileSummary(d.profile)}</div>
      </div>
      <div id="cv-q-host"></div>
    </div>
  </div>`;
}

function renderProfileSummary(p) {
  if (!p) return '<div class="text-[11.5px] text-slate-500">Nada coletado ainda.</div>';
  const rows = [];
  const row = (k, v) => { if (v) rows.push(`<div class="flex gap-2 text-[11.5px]"><span class="text-slate-500 shrink-0 w-[86px]">${k}</span><span class="text-slate-200 min-w-0 break-words">${esc(v)}</span></div>`); };
  row('Nome', p.fullName);
  row('Cargo', p.headline);
  row('Contato', [p.email, p.phone].filter(Boolean).join(' · '));
  row('Local', [p.city, p.state].filter(Boolean).join(', '));
  row('Objetivo', p.objective);
  row('Resumo', p.summary);
  if (p.experiences?.length) rows.push(`<div class="mt-1 text-[11px] text-slate-500">Experiências</div>` + p.experiences.map(e => `<div class="text-[11.5px] text-slate-200">• ${esc([e.role, e.company].filter(Boolean).join(' — '))}${e.start ? ` <span class="text-slate-500">(${esc(e.start)}${e.current ? '–atual' : (e.end ? '–' + esc(e.end) : '')})</span>` : ''}</div>`).join(''));
  if (p.education?.length) rows.push(`<div class="mt-1 text-[11px] text-slate-500">Formação</div>` + p.education.map(e => `<div class="text-[11.5px] text-slate-200">• ${esc([e.course, e.institution].filter(Boolean).join(' — '))}</div>`).join(''));
  if (p.skills?.technical?.length) row('Técnicas', p.skills.technical.join(', '));
  if (p.skills?.behavioral?.length) row('Comport.', p.skills.behavioral.join(', '));
  if (p.languages?.length) row('Idiomas', p.languages.map(l => l.name + (l.level ? ` (${l.level})` : '')).join(', '));
  if (p.courses?.length) row('Cursos', p.courses.map(c => c.name).join(', '));
  if (!rows.length) return '<div class="text-[11.5px] text-slate-500">Nada coletado ainda.</div>';
  return `<div class="space-y-1">${rows.join('')}</div>`;
}

function chatBubble(m) {
  const ia = m.role === 'ia';
  return `<div class="flex gap-2 ${ia ? '' : 'justify-end'}">
    <div class="max-w-[86%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed ${ia ? 'bg-white/[0.05] border border-white/10 text-slate-200' : 'bg-violet-600/30 border border-violet-400/30 text-violet-50'}">${esc(m.text).replace(/\n/g, '<br>')}</div>
  </div>`;
}

function questionsHtml(qs) {
  if (!qs?.length) return '';
  return `<div class="${CARD} p-3">
    <div class="text-[11.5px] font-semibold text-slate-200 mb-2">Perguntas sugeridas</div>
    <div class="space-y-2">
      ${qs.map(q => `<div class="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
        <div class="text-[12px] text-slate-100">${esc(q.label || q.field || 'Pergunta')}</div>
        ${q.example ? `<div class="text-[11px] text-violet-200/80 mt-1">${esc(q.example)}</div>` : ''}
        ${q.why ? `<div class="text-[10.5px] text-slate-500 mt-0.5">${esc(q.why)}</div>` : ''}
        <button data-act="use-q" data-q="${esc(q.label || '')}" class="mt-2 text-[10.5px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300">Responder esta</button>
      </div>`).join('')}
    </div>
  </div>`;
}

function pushChat(role, text) {
  S.chat.push({ role, text });
  const host = $('#cv-chat');
  if (host) {
    host.insertAdjacentHTML('beforeend', chatBubble({ role, text }));
    host.scrollTop = host.scrollHeight;
  }
}

function renderChatLog() {
  const host = $('#cv-chat');
  if (!host) return;
  host.innerHTML = S.chat.length ? S.chat.map(chatBubble).join('') : '<div class="text-[11.5px] text-slate-500">A conversa aparece aqui.</div>';
  host.scrollTop = host.scrollHeight;
}

async function afterRenderConversa() {
  renderChatLog();
  const d = S.doc;
  const qhost = $('#cv-q-host');
  if (d.status !== 'entrevista') {
    if (qhost) qhost.innerHTML = '';
    if (!S.chat.length) pushChat('ia', 'Seu currículo já está montado. Peça aqui qualquer ajuste — ex.: “destaque minha experiência em atendimento” — ou continue informando dados novos.');
    return;
  }
  if (S.greeted[d.id]) { if (qhost) qhost.innerHTML = questionsHtml(S.greeted[d.id].questions); return; }
  if (qhost) qhost.innerHTML = '<div class="text-[11.5px] text-slate-500">Carregando perguntas…</div>';
  try {
    const out = await api(`/${d.id}/interview`, { method: 'POST', body: { message: '' } });
    applyDoc(out.doc);
    S.greeted[d.id] = { questions: out.questions || [] };
    pushChat('ia', out.reply || 'Vamos começar.');
    if (qhost) qhost.innerHTML = questionsHtml(out.questions);
    if (out.aiUsed === false && out.aiError) toast(out.aiError, 'err');
  } catch (e) {
    if (qhost) qhost.innerHTML = '';
    pushChat('ia', e.message);
  }
}

/* ---------------- CAMPOS GUIADOS ---------------- */
function renderCampos() {
  const p = S.doc.profile || {};
  const inp = (f, label, ph, val) => `<label class="block"><span class="${LBL}">${esc(label)}</span>
    <input data-f="${f}" class="${INPUT}" value="${esc(val)}" placeholder="${esc(ph)}"></label>`;
  const ta = (f, label, ph, val, rows = 2) => `<label class="block"><span class="${LBL}">${esc(label)}</span>
    <textarea data-f="${f}" rows="${rows}" class="${INPUT}" placeholder="${esc(ph)}">${esc(val)}</textarea></label>`;
  const ta2 = (f, label, ph, val, rows) => `<label class="block"><span class="${LBL}">${esc(label)}</span>
    <textarea data-k="${f}" rows="${rows}" class="${INPUT}" placeholder="${esc(ph)}">${esc(val)}</textarea></label>`;

  const expRow = (e = {}) => `<div class="cv-row ${CARD} p-3 space-y-2" data-list="experiences">
    <div class="grid sm:grid-cols-2 gap-2">
      <label class="block"><span class="${LBL}">Empresa</span><input data-k="company" class="${INPUT}" value="${esc(e.company)}" placeholder="Ex.: Loja Beta"></label>
      <label class="block"><span class="${LBL}">Cargo</span><input data-k="role" class="${INPUT}" value="${esc(e.role)}" placeholder="Ex.: Vendedora"></label>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <label class="block"><span class="${LBL}">Início</span><input data-k="start" class="${INPUT}" value="${esc(e.start)}" placeholder="Ex.: 2022"></label>
      <label class="block"><span class="${LBL}">Término</span><input data-k="end" class="${INPUT}" value="${esc(e.end)}" placeholder="Ex.: 2024"></label>
      <label class="flex items-center gap-2 text-[11px] text-slate-400 pt-5"><input type="checkbox" data-k="current" ${e.current ? 'checked' : ''}> Emprego atual</label>
    </div>
    ${ta2('bullets', 'Atividades realizadas (uma por linha)', 'Ex.: Atendi cerca de 40 clientes por dia\nEx.: Organizei o estoque e o caixa', (e.bullets || []).join('\n'), 3)}
    ${ta2('results', 'Resultados (uma por linha)', 'Ex.: Atingi 120% da meta em 6 meses', (e.results || []).join('\n'), 2)}
    <button data-act="rm-row" class="${BTN_S} py-1 text-rose-300">${ICO.trash} Remover</button>
  </div>`;

  const edRow = (e = {}) => `<div class="cv-row ${CARD} p-3 space-y-2" data-list="education">
    <div class="grid sm:grid-cols-2 gap-2">
      <label class="block"><span class="${LBL}">Curso</span><input data-k="course" class="${INPUT}" value="${esc(e.course)}" placeholder="Ex.: Ensino Médio / Administração"></label>
      <label class="block"><span class="${LBL}">Instituição</span><input data-k="institution" class="${INPUT}" value="${esc(e.institution)}" placeholder="Ex.: EE São Paulo"></label>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <label class="block"><span class="${LBL}">Nível</span><input data-k="level" class="${INPUT}" value="${esc(e.level)}" placeholder="Ex.: Médio/Técnico/Superior"></label>
      <label class="block"><span class="${LBL}">Início</span><input data-k="start" class="${INPUT}" value="${esc(e.start)}" placeholder="Ex.: 2017"></label>
      <label class="block"><span class="${LBL}">Conclusão</span><input data-k="end" class="${INPUT}" value="${esc(e.end)}" placeholder="Ex.: 2019"></label>
    </div>
    <button data-act="rm-row" class="${BTN_S} py-1 text-rose-300">${ICO.trash} Remover</button>
  </div>`;

  const coRow = (c = {}) => `<div class="cv-row ${CARD} p-3 space-y-2" data-list="courses">
    <div class="grid sm:grid-cols-3 gap-2">
      <label class="block"><span class="${LBL}">Curso / certificação</span><input data-k="name" class="${INPUT}" value="${esc(c.name)}" placeholder="Ex.: Excel Avançado"></label>
      <label class="block"><span class="${LBL}">Instituição</span><input data-k="institution" class="${INPUT}" value="${esc(c.institution)}" placeholder="Ex.: Senai"></label>
      <label class="block"><span class="${LBL}">Ano / carga</span><input data-k="year" class="${INPUT}" value="${esc(c.year)}" placeholder="Ex.: 2023 · 40h"></label>
    </div>
    <button data-act="rm-row" class="${BTN_S} py-1 text-rose-300">${ICO.trash} Remover</button>
  </div>`;

  const laRow = (l = {}) => `<div class="cv-row ${CARD} p-3 space-y-2" data-list="languages">
    <div class="grid sm:grid-cols-2 gap-2">
      <label class="block"><span class="${LBL}">Idioma</span><input data-k="name" class="${INPUT}" value="${esc(l.name)}" placeholder="Ex.: Inglês"></label>
      <label class="block"><span class="${LBL}">Nível</span><input data-k="level" class="${INPUT}" value="${esc(l.level)}" placeholder="Ex.: Intermediário"></label>
    </div>
    <button data-act="rm-row" class="${BTN_S} py-1 text-rose-300">${ICO.trash} Remover</button>
  </div>`;

  const prRow = (pr = {}) => `<div class="cv-row ${CARD} p-3 space-y-2" data-list="projects">
    <label class="block"><span class="${LBL}">Projeto</span><input data-k="name" class="${INPUT}" value="${esc(pr.name)}" placeholder="Ex.: Sistema de controle de estoque"></label>
    <label class="block"><span class="${LBL}">Descrição</span><textarea data-k="description" rows="2" class="${INPUT}" placeholder="Ex.: Desenvolvi em planilha/JavaScript para…">${esc(pr.description)}</textarea></label>
    <button data-act="rm-row" class="${BTN_S} py-1 text-rose-300">${ICO.trash} Remover</button>
  </div>`;

  const block = (title, listName, rowsHtml, addLabel, examples) => `
    <div class="${CARD} p-3 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[12px] font-semibold text-slate-200">${esc(title)}</span>
        <button data-act="add-row" data-list="${listName}" data-tpl="${listName}" class="${BTN_S} py-1">${ICO.plus} ${esc(addLabel)}</button>
      </div>
      ${examples ? `<div class="text-[10.5px] text-slate-500">Exemplos: ${esc(examples)}</div>` : ''}
      <div class="space-y-2" data-host="${listName}">${rowsHtml || '<div class="text-[11px] text-slate-500">Nenhum item ainda.</div>'}</div>
    </div>`;

  return `
  <div class="max-w-3xl mx-auto space-y-3">
    <div class="${CARD} p-3 space-y-2">
      <div class="text-[12px] font-semibold text-slate-200">Enviar um currículo antigo (opcional)</div>
      <p class="text-[11px] text-slate-500">PDF, DOCX ou TXT (até 8 MB). A IA usa o conteúdo como fonte de dados reais — nunca inventa o que não estiver lá.</p>
      <div class="flex flex-wrap items-center gap-2">
        <input id="cv-file" type="file" accept=".pdf,.docx,.txt,application/pdf" class="text-[11.5px] text-slate-400">
        <button data-act="import" class="${BTN_S} py-1.5">Importar arquivo</button>
        ${S.doc.hasOriginal ? `<button data-act="gen" data-original="1" class="${BTN_S} py-1.5">${ICO.wand} Organizar com IA</button>` : ''}
      </div>
      ${S.doc.originalMeta ? `<div class="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-[11px] text-slate-400">
        <div>${esc(S.doc.originalMeta.filename || 'arquivo')} · confiança da extração: ${esc(S.doc.originalMeta.confidence || '—')}</div>
        ${S.doc.originalMeta.preview ? `<div class="mt-1 text-slate-500 line-clamp-3 whitespace-pre-wrap">${esc(S.doc.originalMeta.preview.slice(0, 300))}…</div>` : ''}
      </div>` : ''}
    </div>

    <div class="${CARD} p-3 grid sm:grid-cols-2 gap-2">
      ${inp('fullName', 'Nome completo', 'Ex.: Maria Souza Oliveira', p.fullName)}
      ${inp('headline', 'Profissão / cargo desejado', 'Ex.: Auxiliar Administrativo', p.headline)}
      ${inp('email', 'E-mail', 'Ex.: maria@email.com', p.email)}
      ${inp('phone', 'Telefone', 'Ex.: (11) 91234-5678', p.phone)}
      <label class="block"><span class="${LBL}">Cidade</span><input data-f="city" class="${INPUT}" value="${esc(p.city)}" placeholder="Ex.: São Paulo"></label>
      <label class="block"><span class="${LBL}">Estado</span><input data-f="state" class="${INPUT}" value="${esc(p.state)}" placeholder="Ex.: SP"></label>
      <div class="sm:col-span-2">${ta('objective', 'Objetivo profissional', 'Ex.: Atuar na área administrativa aplicando organização e atendimento ao cliente.', p.objective)}</div>
      <div class="sm:col-span-2">${ta('summary', 'Resumo profissional', 'Ex.: Profissional com 3 anos em atendimento e rotinas administrativas…', p.summary, 3)}</div>
      <label class="block sm:col-span-2"><span class="${LBL}">Conhecimentos técnicos (separe por vírgula)</span>
        <input data-tags="technical" class="${INPUT}" value="${esc((p.skills?.technical || []).join(', '))}" placeholder="Ex.: Excel intermediário, atendimento ao cliente, ERP"></label>
      <label class="block sm:col-span-2"><span class="${LBL}">Habilidades comportamentais (separe por vírgula)</span>
        <input data-tags="behavioral" class="${INPUT}" value="${esc((p.skills?.behavioral || []).join(', '))}" placeholder="Ex.: trabalho em equipe, comunicação, proatividade"></label>
      <label class="block sm:col-span-2"><span class="${LBL}">Ferramentas (separe por vírgula)</span>
        <input data-tags="tools" class="${INPUT}" value="${esc((p.skills?.tools || []).join(', '))}" placeholder="Ex.: Excel, CRM, Pacote Office"></label>
      <label class="block sm:col-span-2"><span class="${LBL}">Resultados e conquistas (uma por linha)</span>
        <textarea data-f="achievements" rows="2" class="${INPUT}" placeholder="Ex.: Recebi reconhecimento por redução de erros no caixa">${esc((p.achievements || []).join('\n'))}</textarea></label>
    </div>

    ${block('Experiência profissional', 'experiences', (p.experiences || []).map(expRow).join(''), 'Adicionar experiência', 'Vendedora na Loja Beta (2022–2024), Atendente na Padaria Central (2020–2021)')}
    ${block('Formação acadêmica', 'education', (p.education || []).map(edRow).join(''), 'Adicionar formação', 'Ensino Médio completo — EE São Paulo (2019)')}
    ${block('Cursos e certificações', 'courses', (p.courses || []).map(coRow).join(''), 'Adicionar curso', 'Excel Avançado (Senai, 2023), Atendimento ao Cliente (Sebrae)')}
    ${block('Idiomas', 'languages', (p.languages || []).map(laRow).join(''), 'Adicionar idioma', 'Inglês intermediário, Espanhol básico')}
    ${block('Projetos', 'projects', (p.projects || []).map(prRow).join(''), 'Adicionar projeto', 'Voluntariado na ONG, projeto pessoal de planilha de controle')}

    <div class="flex flex-wrap gap-2 sticky bottom-0 py-2 bg-gradient-to-t from-[#060918] to-transparent">
      <button data-act="save-fields" class="${BTN_P}">Salvar informações</button>
      <button data-act="gen" class="${BTN_G}">${ICO.spark} Gerar currículo com IA</button>
    </div>
  </div>`;
}

const ROW_TPL = {
  experiences: () => rowShell('experiences', `
    <div class="grid sm:grid-cols-2 gap-2">
      <label class="block"><span class="${LBL}">Empresa</span><input data-k="company" class="${INPUT}" placeholder="Ex.: Loja Beta"></label>
      <label class="block"><span class="${LBL}">Cargo</span><input data-k="role" class="${INPUT}" placeholder="Ex.: Vendedora"></label>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <label class="block"><span class="${LBL}">Início</span><input data-k="start" class="${INPUT}" placeholder="Ex.: 2022"></label>
      <label class="block"><span class="${LBL}">Término</span><input data-k="end" class="${INPUT}" placeholder="Ex.: 2024"></label>
      <label class="flex items-center gap-2 text-[11px] text-slate-400 pt-5"><input type="checkbox" data-k="current"> Emprego atual</label>
    </div>
    <label class="block"><span class="${LBL}">Atividades realizadas (uma por linha)</span><textarea data-k="bullets" rows="3" class="${INPUT}" placeholder="Ex.: Atendi cerca de 40 clientes por dia"></textarea></label>
    <label class="block"><span class="${LBL}">Resultados (uma por linha)</span><textarea data-k="results" rows="2" class="${INPUT}" placeholder="Ex.: Atingi 120% da meta em 6 meses"></textarea></label>`),
  education: () => rowShell('education', `
    <div class="grid sm:grid-cols-2 gap-2">
      <label class="block"><span class="${LBL}">Curso</span><input data-k="course" class="${INPUT}" placeholder="Ex.: Ensino Médio"></label>
      <label class="block"><span class="${LBL}">Instituição</span><input data-k="institution" class="${INPUT}" placeholder="Ex.: EE São Paulo"></label>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <label class="block"><span class="${LBL}">Nível</span><input data-k="level" class="${INPUT}" placeholder="Ex.: Médio"></label>
      <label class="block"><span class="${LBL}">Início</span><input data-k="start" class="${INPUT}" placeholder="Ex.: 2017"></label>
      <label class="block"><span class="${LBL}">Conclusão</span><input data-k="end" class="${INPUT}" placeholder="Ex.: 2019"></label>
    </div>`),
  courses: () => rowShell('courses', `
    <div class="grid sm:grid-cols-3 gap-2">
      <label class="block"><span class="${LBL}">Curso / certificação</span><input data-k="name" class="${INPUT}" placeholder="Ex.: Excel Avançado"></label>
      <label class="block"><span class="${LBL}">Instituição</span><input data-k="institution" class="${INPUT}" placeholder="Ex.: Senai"></label>
      <label class="block"><span class="${LBL}">Ano / carga</span><input data-k="year" class="${INPUT}" placeholder="Ex.: 2023"></label>
    </div>`),
  languages: () => rowShell('languages', `
    <div class="grid sm:grid-cols-2 gap-2">
      <label class="block"><span class="${LBL}">Idioma</span><input data-k="name" class="${INPUT}" placeholder="Ex.: Inglês"></label>
      <label class="block"><span class="${LBL}">Nível</span><input data-k="level" class="${INPUT}" placeholder="Ex.: Intermediário"></label>
    </div>`),
  projects: () => rowShell('projects', `
    <label class="block"><span class="${LBL}">Projeto</span><input data-k="name" class="${INPUT}" placeholder="Ex.: Controle de estoque em planilha"></label>
    <label class="block"><span class="${LBL}">Descrição</span><textarea data-k="description" rows="2" class="${INPUT}" placeholder="Ex.: Criei uma planilha para controlar entrada e saída de produtos"></textarea></label>`),
};

function rowShell(list, inner) {
  return `<div class="cv-row ${CARD} p-3 space-y-2" data-list="${list}">${inner}
    <button data-act="rm-row" class="${BTN_S} py-1 text-rose-300">${ICO.trash} Remover</button></div>`;
}

function collectProfile() {
  const root = $('#cvd-body');
  const val = (n) => { const e = root.querySelector(`[data-f="${n}"]`); return e ? e.value.trim() : ''; };
  const tag = (n) => { const e = root.querySelector(`[data-tags="${n}"]`); return e ? e.value.split(',').map(x => x.trim()).filter(Boolean) : []; };
  const rows = (list) => $$(`.cv-row[data-list="${list}"]`, root);
  const kv = (r, k) => { const e = r.querySelector(`[data-k="${k}"]`); return e ? e.value.trim() : ''; };
  const kc = (r, k) => { const e = r.querySelector(`[data-k="${k}"]`); return !!(e && e.checked); };

  const profile = {
    fullName: val('fullName'), headline: val('headline'), email: val('email'), phone: val('phone'),
    city: val('city'), state: val('state'), objective: val('objective'), summary: val('summary'),
    achievements: lines(val('achievements')),
    skills: { technical: tag('technical'), behavioral: tag('behavioral'), tools: tag('tools') },
    experiences: rows('experiences').map(r => ({
      company: kv(r, 'company'), role: kv(r, 'role'), start: kv(r, 'start'), end: kv(r, 'end'),
      current: kc(r, 'current'), bullets: lines(kv(r, 'bullets')), results: lines(kv(r, 'results')),
    })).filter(e => e.company || e.role || e.bullets.length),
    education: rows('education').map(r => ({
      course: kv(r, 'course'), institution: kv(r, 'institution'), level: kv(r, 'level'),
      start: kv(r, 'start'), end: kv(r, 'end'),
    })).filter(e => e.course || e.institution),
    courses: rows('courses').map(r => ({ name: kv(r, 'name'), institution: kv(r, 'institution'), year: kv(r, 'year') })).filter(c => c.name),
    languages: rows('languages').map(r => ({ name: kv(r, 'name'), level: kv(r, 'level') })).filter(l => l.name),
    projects: rows('projects').map(r => ({ name: kv(r, 'name'), description: kv(r, 'description') })).filter(p => p.name || p.description),
  };
  return profile;
}

/* ---------------- VAGA ---------------- */
function renderVaga() {
  const t = S.doc.targetJob || {};
  return `
  <div class="max-w-3xl mx-auto space-y-3">
    <div class="${CARD} p-3 space-y-2">
      <div class="text-[12px] font-semibold text-slate-200">Adaptar o currículo para uma vaga</div>
      <p class="text-[11px] text-slate-500">A IA compara a vaga com o seu perfil real, destaca o que você já tem e indica o que falta. Ela nunca adiciona qualificações que você não possui.</p>
      <div class="grid sm:grid-cols-2 gap-2">
        <label class="block"><span class="${LBL}">Título da vaga</span><input id="cv-job-title" class="${INPUT}" value="${esc(t.title)}" placeholder="Ex.: Assistente Administrativo"></label>
        <label class="block"><span class="${LBL}">Empresa (opcional)</span><input id="cv-job-company" class="${INPUT}" value="${esc(t.company)}" placeholder="Ex.: Empresa XYZ"></label>
      </div>
      <label class="block"><span class="${LBL}">Descrição da vaga</span>
        <textarea id="cv-job-desc" rows="8" class="${INPUT}" placeholder="Cole aqui a descrição completa da vaga">${esc(t.description)}</textarea></label>
      <button data-act="tailor" class="${BTN_P}">${ICO.target} Adaptar meu currículo</button>
    </div>
    ${S.doc.lastAnalysis?.forJob ? `<div class="${CARD} p-3">
      <div class="text-[11.5px] text-slate-400">Última adaptação: <span class="text-slate-200">${esc(S.doc.lastAnalysis.forJob)}</span> · nota ${esc(String(S.doc.lastAnalysis.total ?? '—'))}/100</div>
    </div>` : ''}
  </div>`;
}

/* ---------------- ANÁLISE ---------------- */
function renderAnalise() {
  const a = S.doc.lastAnalysis;
  if (!a) {
    return `<div class="${CARD} p-6 text-center max-w-2xl mx-auto">
      <p class="text-[12.5px] text-slate-400">Nenhuma análise feita ainda para este currículo.</p>
      <button data-act="analyze" class="${BTN_P} mt-3">${ICO.gauge} Analisar agora</button>
      <p class="text-[10.5px] text-slate-500 mt-3">Para medir aderência a uma vaga específica, cole a descrição na aba “Vaga”.</p>
    </div>`;
  }
  const dims = a.dimensions || [];
  const bar = (d) => {
    const tone = d.score >= 75 ? 'from-emerald-500 to-emerald-400' : d.score >= 50 ? 'from-amber-500 to-amber-400' : 'from-rose-500 to-rose-400';
    return `<div class="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[12px] text-slate-200">${esc(d.label)}</span>
        <span class="text-[12px] font-mono text-slate-300">${esc(String(d.score))}</span>
      </div>
      <div class="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden"><div class="h-full bg-gradient-to-r ${tone}" style="width:${Math.max(2, d.score)}%"></div></div>
      <div class="mt-1.5 text-[10.5px] text-slate-400">${esc(d.why || '')}</div>
      <div class="text-[10.5px] text-violet-200/80 mt-0.5">Como melhorar: ${esc(d.how || '')}</div>
    </div>`;
  };
  const list = (title, arr, tone) => arr?.length ? `<div class="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
    <div class="text-[11.5px] font-semibold ${tone} mb-1.5">${esc(title)}</div>
    <ul class="space-y-1">${arr.map(x => `<li class="text-[11.5px] text-slate-300">• ${esc(x)}</li>`).join('')}</ul>
  </div>` : '';
  const ats = a.ats || {};
  const q = a.qualitative;

  return `
  <div class="max-w-4xl mx-auto space-y-3">
    <div class="${CARD} p-4 flex items-center gap-4">
      <div class="w-20 h-20 rounded-2xl grid place-items-center bg-gradient-to-br from-violet-600/30 to-sky-500/20 border border-violet-400/30">
        <div class="text-center"><div class="text-[22px] font-bold text-white leading-none">${esc(String(a.total ?? '—'))}</div><div class="text-[9.5px] text-slate-400">/100</div></div>
      </div>
      <div class="min-w-0">
        <div class="text-[13px] font-semibold text-slate-100">Qualidade documental do currículo</div>
        <div class="text-[11px] text-slate-500 mt-0.5">${esc(a.disclaimer || 'A nota mede a qualidade do documento, não chance de contratação.')}</div>
        <div class="text-[10.5px] text-slate-500 mt-1">Análise em ${esc(fmtDate(a.at))} ${a.aiUsed ? '· complementada pela IA' : '· somente determinística'}</div>
      </div>
    </div>

    <div class="grid sm:grid-cols-2 gap-2">${dims.map(bar).join('')}</div>

    <div class="${CARD} p-3 space-y-2">
      <div class="text-[12px] font-semibold text-slate-200">Leitura ATS ${ats.baseLabel ? `<span class="text-slate-500 font-normal">· ${esc(ats.baseLabel)}</span>` : ''}</div>
      ${ats.cobertura != null ? `<div class="text-[11px] text-slate-400">Cobertura de termos: <span class="text-slate-200 font-mono">${esc(String(ats.cobertura))}%</span></div>` : ''}
      <div class="grid sm:grid-cols-3 gap-2">
        ${list('Requisitos atendidos', ats.atendidos, 'text-emerald-300')}
        ${list('Parcialmente atendidos', ats.parciais, 'text-amber-300')}
        ${list('Ausentes ou não informados', ats.ausentes, 'text-rose-300')}
      </div>
      ${ats.sugestoes?.length ? list('Sugestões de melhoria (ATS)', ats.sugestoes.slice(0, 8), 'text-violet-200') : ''}
    </div>

    ${q ? `<div class="${CARD} p-3 grid sm:grid-cols-2 gap-2">
      ${list('Pontos fortes', q.pontosFortes, 'text-emerald-300')}
      ${list('Lacunas', q.lacunas, 'text-amber-300')}
      ${list('Sugestões', q.sugestoes, 'text-violet-200')}
      ${q.leituraRecrutador ? `<div class="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 sm:col-span-2">
        <div class="text-[11.5px] font-semibold text-slate-200 mb-1">Como um recrutador lê este currículo</div>
        <div class="text-[11.5px] text-slate-300 leading-relaxed">${esc(q.leituraRecrutador)}</div></div>` : ''}
    </div>` : `<div class="${CARD} p-3 text-[11px] text-slate-500">A leitura qualitativa da IA não está disponível agora (IA desligada ou sem resposta). A análise determinística acima continua válida.</div>`}

    ${a.missing?.length ? `<div class="${CARD} p-3">
      <div class="text-[11.5px] font-semibold text-slate-200 mb-1">Informações que faltam</div>
      <div class="text-[11.5px] text-slate-400">${esc(a.missing.join(', '))}</div>
    </div>` : ''}

    ${S.doc.removedFabrication?.length ? `<div class="${CARD} p-3 border-amber-400/25">
      <div class="text-[11.5px] font-semibold text-amber-200 mb-1">Itens removidos por não existirem nos seus dados</div>
      <div class="text-[11.5px] text-slate-400">${esc(S.doc.removedFabrication.slice(-8).map(r => `${r.kind}: ${r.value}`).join(' · '))}</div>
    </div>` : ''}
  </div>`;
}

/* ---------------- PRÉVIA ---------------- */
function renderPrevia() {
  const tpl = S.previewTemplate || S.doc.templateId || 'moderno';
  const tplOpts = (S.templates.length ? S.templates : []).map(t => `<option value="${esc(t.id)}" ${t.id === tpl ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  return `
  <div class="max-w-4xl mx-auto space-y-2.5">
    <div class="${CARD} p-2.5 flex flex-wrap items-center gap-2">
      <span class="text-[11.5px] text-slate-400">Modelo:</span>
      <select id="cv-tpl" class="${INPUT} w-auto min-w-[190px] py-1.5">${tplOpts || '<option value="moderno">Profissional Moderno</option>'}</select>
      <button data-act="preview" class="${BTN_S} py-1.5">${ICO.eye} Atualizar prévia</button>
      <div class="flex-1"></div>
      <button data-act="download" data-fmt="pdf" class="${BTN_P} py-1.5">${ICO.dl} Baixar PDF</button>
      <button data-act="download" data-fmt="docx" class="${BTN_S} py-1.5">${ICO.dl} Baixar DOCX</button>
    </div>
    <div id="cv-preview-host" class="${CARD} p-2 min-h-[60vh] grid place-items-center">
      <div class="text-[12px] text-slate-500">Carregando pré-visualização…</div>
    </div>
  </div>`;
}

async function loadPreview() {
  const host = $('#cv-preview-host');
  if (!host) return;
  try {
    const tpl = $('#cv-tpl')?.value || S.previewTemplate || S.doc.templateId;
    S.previewTemplate = tpl;
    const out = await api(`/${S.doc.id}/preview`, { method: 'POST', body: { templateId: tpl } });
    host.className = `${CARD} p-2 min-h-[60vh]`;
    host.innerHTML = `<iframe class="w-full rounded-xl bg-white" style="height:72vh;border:0" sandbox srcdoc="${esc(out.html)}"></iframe>`;
  } catch (e) {
    host.className = `${CARD} p-6 min-h-[30vh] grid place-items-center`;
    host.innerHTML = `<div class="text-center"><p class="text-[12px] text-rose-200">${esc(e.message)}</p>
      <button data-act="preview" class="${BTN_S} mt-3">Tentar novamente</button></div>`;
  }
}

/* ---------------- VERSÕES ---------------- */
function renderVersoes() {
  const vs = (S.doc.versions || []).slice().reverse();
  if (!vs.length) {
    return `<div class="${CARD} p-6 text-center max-w-2xl mx-auto">
      <p class="text-[12.5px] text-slate-400">Nenhuma versão salva ainda. Cada geração, adaptação ou alteração cria uma versão.</p>
    </div>`;
  }
  const srcLabel = { ia: 'IA', deterministico: 'Automático', manual: 'Manual' };
  return `
  <div class="max-w-2xl mx-auto space-y-2">
    <p class="text-[11px] text-slate-500">Restaurar uma versão preserva o conteúdo atual como nova versão — nada é perdido.</p>
    ${vs.map(v => `<div class="${CARD} p-2.5 flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-[12px] text-slate-200">${esc(v.note || 'Versão')}</div>
        <div class="text-[10.5px] text-slate-500">${esc(fmtDate(v.createdAt))} · ${esc(srcLabel[v.source] || v.source)}</div>
      </div>
      <div class="flex gap-1.5 shrink-0">
        <button data-act="download" data-fmt="pdf" data-version="${esc(v.id)}" class="${BTN_S} py-1">PDF</button>
        <button data-act="restore" data-version="${esc(v.id)}" class="${BTN_S} py-1">Restaurar</button>
      </div>
    </div>`).join('')}
  </div>`;
}

/* =========================================================
 * Ações
 * =======================================================*/
function setDoc(doc, tab = null) {
  S.doc = doc;
  if (tab) S.docTab = tab;
  S.view = 'doc';
  render();
  if (S.docTab === 'previa') loadPreview();
}

function applyDoc(doc) {
  if (doc) S.doc = doc;
}

async function openDoc(id, tab = null) {
  try {
    busy(true);
    const out = await api(`/${id}`);
    S.chat = [];
    S.previewTemplate = out.doc.templateId || null;
    setDoc(out.doc, tab || 'conversa');
  } catch (e) { toast(e.message, 'err'); }
  finally { busy(false); }
}

function openList(mode) {
  S.view = 'list'; S.listMode = mode; S.doc = null;
  render();
  loadList();
}

async function createDoc(mode) {
  const name = $('#cv-start-name')?.value?.trim() || '';
  const goal = $('#cv-start-area-txt')?.value?.trim() || '';
  const areaId = $('#cv-start-area')?.value || '';
  const job = $('#cv-start-job')?.value?.trim() || '';
  try {
    busy(true, 'Preparando…');
    const out = await api('/create', { method: 'POST', body: { fullName: name, goal, areaId: areaId || null, templateId: mode === 'primeiro' ? 'primeiro-emprego' : null } });
    let doc = out.doc;
    if (job) {
      const up = await api(`/${doc.id}`, { method: 'PUT', body: { targetJob: { description: job } } });
      doc = up.doc;
    }
    S.chat = [];
    S.previewTemplate = doc.templateId;
    const tab = mode === 'vaga' ? 'vaga' : (mode === 'melhorar' ? 'campos' : 'conversa');
    setDoc(doc, tab);
    if (mode === 'vaga' && job) toast('Vaga registrada. Toque em “Adaptar meu currículo”.', 'ok');
  } catch (e) { toast(e.message, 'err'); }
  finally { busy(false); }
}

async function saveFields() {
  try {
    busy(true, 'Salvando…');
    const profile = collectProfile();
    const out = await api(`/${S.doc.id}`, { method: 'PUT', body: { profile } });
    S.doc = out.doc;
    toast('Informações salvas.', 'ok');
    render();
    if (S.docTab === 'previa') loadPreview();
  } catch (e) { toast(e.message, 'err'); }
  finally { busy(false); }
}

async function doGenerate(useOriginal = false) {
  const d = S.doc;
  try {
    busy(true, 'A IA está escrevendo seu currículo…');
    const out = await api(`/${d.id}/generate`, { method: 'POST', body: { templateId: S.previewTemplate || d.templateId, useOriginal } });
    S.doc = out.doc;
    const removed = out.doc.removedFabrication?.slice(-5) || [];
    if (!out.aiUsed && out.note) toast(out.note, 'info');
    else toast('Currículo gerado.', 'ok');
    if (removed.length) toast(`Removi ${removed.length} item(ns) que não constavam nos seus dados.`, 'info');
    S.docTab = 'previa';
    render();
    loadPreview();
  } catch (e) { toast(e.message, 'err'); }
  finally { busy(false); }
}

async function doAnalyze() {
  try {
    busy(true, 'Analisando…');
    const jobDesc = S.doc.targetJob?.description || null;
    const out = await api(`/${S.doc.id}/analyze`, { method: 'POST', body: { jobDescription: jobDesc, withAI: true } });
    S.doc = out.doc;
    S.docTab = 'analise';
    render();
    toast(`Nota: ${out.analysis.total}/100 (qualidade documental).`, 'ok');
    if (out.analysis.aiUsed === false && out.analysis.aiError) toast(out.analysis.aiError, 'err');
  } catch (e) { toast(e.message, 'err'); }
  finally { busy(false); }
}

async function doTailor() {
  const title = $('#cv-job-title')?.value?.trim() || '';
  const company = $('#cv-job-company')?.value?.trim() || '';
  const description = $('#cv-job-desc')?.value?.trim() || '';
  if (!description) { toast('Cole a descrição da vaga para adaptar.', 'err'); return; }
  try {
    busy(true, 'Adaptando o currículo à vaga…');
    const out = await api(`/${S.doc.id}/tailor`, { method: 'POST', body: { title, company, description } });
    S.doc = out.doc;
    S.docTab = 'analise';
    render();
    toast(out.aiUsed ? 'Currículo adaptado à vaga.' : 'Vaga registrada; IA indisponível para reescrever agora.', out.aiUsed ? 'ok' : 'info');
    if (out.doc.removedFabrication?.length) toast('Itens não comprovados foram removidos.', 'info');
  } catch (e) { toast(e.message, 'err'); }
  finally { busy(false); }
}

async function doImport() {
  const input = $('#cv-file');
  const file = input?.files?.[0];
  if (!file) { toast('Escolha um arquivo PDF, DOCX ou TXT.', 'err'); return; }
  if (file.size > 8 * 1024 * 1024) { toast('Arquivo maior que 8 MB não é aceito.', 'err'); return; }
  try {
    busy(true, 'Lendo o arquivo…');
    const b64 = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',').pop());
      fr.onerror = () => rej(new Error('Não foi possível ler o arquivo.'));
      fr.readAsDataURL(file);
    });
    const out = await api(`/${S.doc.id}/import`, { method: 'POST', body: { filename: file.name, mimeType: file.type || '', contentBase64: b64 } });
    S.doc = out.doc;
    render();
    toast(`Arquivo importado (confiança ${out.extracted?.confidence || '—'}). Confira os dados nas abas.`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
  finally { busy(false); }
}

async function doRestore(versionId) {
  try {
    busy(true, 'Restaurando versão…');
    const out = await api(`/${S.doc.id}/restore`, { method: 'POST', body: { versionId } });
    S.doc = out.doc;
    render();
    toast('Versão restaurada.', 'ok');
  } catch (e) { toast(e.message, 'err'); }
  finally { busy(false); }
}

async function doDelete(id) {
  if (!id) return;
  if (!confirm('Excluir este currículo? Esta ação não pode ser desfeita.')) return;
  try {
    busy(true);
    await api(`/${id}`, { method: 'DELETE', body: {} });
    toast('Currículo excluído.', 'ok');
    if (S.doc?.id === id) { S.doc = null; }
    openList(S.listMode);
  } catch (e) { toast(e.message, 'err'); }
  finally { busy(false); }
}

function doDownload(fmt, opts = {}) {
  const id = S.doc?.id;
  if (!id) return;
  const url = new URL(`${API}/${id}/download`, location.origin);
  url.searchParams.set('owner', getOwner());
  url.searchParams.set('format', fmt || 'pdf');
  const tpl = opts.templateId || (S.view === 'doc' && S.docTab === 'previa' ? ($('#cv-tpl')?.value || S.previewTemplate) : null);
  if (tpl) url.searchParams.set('templateId', tpl);
  if (opts.versionId) url.searchParams.set('versionId', opts.versionId);
  const a = document.createElement('a');
  a.href = url.toString();
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast(`Gerando ${String(fmt).toUpperCase()}…`, 'info');
}

async function quickPdf(id) {
  const url = new URL(`${API}/${id}/download`, location.origin);
  url.searchParams.set('owner', getOwner());
  url.searchParams.set('format', 'pdf');
  const a = document.createElement('a');
  a.href = url.toString(); a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  toast('Gerando PDF…', 'info');
}

async function sendMessage() {
  const ta = $('#cv-msg');
  const msg = ta?.value?.trim();
  if (!msg) return;
  const d = S.doc;
  const interview = d.status === 'entrevista';
  ta.value = '';
  pushChat('user', msg);
  try {
    busy(true);
    const out = await api(`/${d.id}/${interview ? 'interview' : 'chat'}`, { method: 'POST', body: { message: msg } });
    S.doc = out.doc;
    if (out.reply) pushChat('ia', out.reply);
    if (interview && out.questions?.length) S.greeted[d.id] = { questions: out.questions };
    const qhost = $('#cv-q-host');
    if (qhost) qhost.innerHTML = interview ? questionsHtml(out.questions || S.greeted[d.id]?.questions || []) : '';
    if (out.removed?.length) toast('Itens não comprovados foram ignorados.', 'info');
    if (out.aiUsed === false && out.aiError) toast(out.aiError, 'err');
    const sh = $('#cv-summary-host');
    if (sh) sh.innerHTML = renderProfileSummary(S.doc.profile);
    updateProgressBar();
  } catch (e) {
    pushChat('ia', e.message);
  } finally { busy(false); }
}

function updateProgressBar() {
  const host = $('#cvd-body [data-progress-bar]');
  const pct = completeness(S.doc?.profile);
  $$('#cvd-body .cv-progress-fill').forEach(e => e.style.width = pct + '%');
  $$('#cvd-body .cv-progress-pct').forEach(e => e.textContent = pct + '%');
}

/* =========================================================
 * Delegação de eventos
 * =======================================================*/
function onBodyClick(ev) {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  switch (act) {
    case 'home': S.view = 'home'; S.doc = null; render(); break;
    case 'list': openList(btn.dataset.mode || 'normal'); break;
    case 'reload-list': loadList(); break;
    case 'start':
      S.startMode = btn.dataset.mode || 'criar';
      S.view = 'start'; render(); break;
    case 'create':
      createDoc(S.startMode).then(() => { if (btn.dataset.goto === 'campos') { S.docTab = 'campos'; refreshDocTab(); } }); break;
    case 'open': openDoc(btn.dataset.id, btn.dataset.tab || 'conversa'); break;
    case 'del': doDelete(btn.dataset.id || S.doc?.id); break;
    case 'quick-pdf': quickPdf(btn.dataset.id); break;
    case 'doctab':
      S.docTab = btn.dataset.tab;
      refreshDocTab();
      if (S.docTab === 'previa') loadPreview();
      break;
    case 'add-row': {
      const list = btn.dataset.list;
      const host = $(`[data-host="${list}"]`);
      if (host && ROW_TPL[list]) {
        if (host.querySelector('.text-slate-500')) host.innerHTML = '';
        host.insertAdjacentHTML('beforeend', ROW_TPL[list]());
        host.lastElementChild?.querySelector('input')?.focus();
      }
      break;
    }
    case 'rm-row': btn.closest('.cv-row')?.remove(); break;
    case 'save-fields': saveFields(); break;
    case 'gen': doGenerate(btn.dataset.original === '1'); break;
    case 'analyze': doAnalyze(); break;
    case 'tailor': doTailor(); break;
    case 'import': doImport(); break;
    case 'restore': doRestore(btn.dataset.version); break;
    case 'download': doDownload(btn.dataset.fmt, { versionId: btn.dataset.version || null }); break;
    case 'preview': loadPreview(); break;
    case 'send': sendMessage(); break;
    case 'use-q': {
      const ta = $('#cv-msg');
      if (ta) { ta.value = ''; ta.focus(); }
      toast('Descreva sua resposta no campo de mensagem.', 'info');
      break;
    }
    default: break;
  }
}

/* =========================================================
 * Hooks da aba (chamados por public/app.js)
 * =======================================================*/
window.__curriculosOnTabOpen = function () {
  try {
    if (!S.inited) init();
    else if (!S.doc) render();
  } catch (e) { console.error('[curriculos] open erro:', e); }
};

window.__curriculosOnTabClose = function () {};

/* Ajustes pontuais: manter o botão "Gerar com IA" na prévia usando o modelo escolhido */
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t && t.id === 'cv-tpl') { S.previewTemplate = t.value; loadPreview(); }
});

/* Auto-init caso o script carregue depois do DOM e a aba já esteja ativa */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { if ($('#cv-panel') && !$('#cv-panel').classList.contains('hidden')) init(); });
} else {
  init();
}

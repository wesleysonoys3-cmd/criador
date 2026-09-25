/* ==========================================================
   TRAE Agent — Frontend
   ========================================================== */
marked?.setOptions({ breaks: true, gfm: true, mangle: false, headerIds: false });
try { if (window.hljs) {
  const langs = ['javascript','typescript','python','json','bash','css','xml','html'];
  for (const l of langs) {
    const key = l === 'html' ? 'Html' : l === 'javascript' ? 'Javascript' : l === 'typescript' ? 'Typescript' : l === 'python' ? 'Python' : l === 'json' ? 'Json' : l === 'bash' ? 'Bash' : l === 'css' ? 'Css' : l === 'xml' ? 'Xml' : l[0].toUpperCase()+l.slice(1);
    const mod = window['hljs'+key];
    if (mod) try { hljs.registerLanguage(l, mod); } catch(_){}
  }
}} catch(_) {}

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

/* ========== ELEMENTS ========== */
const els = {
  app: $('#app'),
  messages: $('#messages'),
  messagesList: $('#messages-list'),
  welcome: $('#welcome'),
  typing: $('#typing'),
  sendBtn: $('#send-btn'),
  form: $('#chat-form'),
  input: $('#message-input'),
  charCount: $('#char-count'),
  fileInput: $('#file-input'),
  attachments: $('#attachments'),
  statusDot: $('#status-dot'),
  statusText: $('#status-text'),
  statusSub: $('#status-sub'),
  statusRing: $('#status-ring'),
  stepInfo: $('#step-badge'),
  chatTitle: $('#chat-title'),
  newChatBtn: $('#new-chat'),
  clearBtn: $('#clear-chat'),
  stopBtn: $('#stop-btn'),
  pauseBtn: $('#pause-btn'),
  resumeBtn: $('#resume-btn'),
  history: $('#history'),
  toggleLeft: $('#toggle-left'),
  openLeft: $('#open-left'),
  leftPanel: $('#left-panel'),
  toggleRight: $('#toggle-right'),
  closeRight: $('#close-right'),
  rightPanel: $('#right-panel'),
  modelName: $('#model-name'),
  workdirName: $('#workdir-name'),
  statsLine: $('#stats-line'),
  fileTree: $('#file-tree'),
  refreshTreeBtn: $('#refresh-tree'),
  previewEmpty: $('#preview-empty'),
  previewIframe: $('#preview-iframe'),
  previewUrlBar: $('#preview-url-bar'),
  previewUrl: $('#preview-url'),
  previewRefresh: $('#preview-refresh'),
  previewOpen: $('#preview-open'),
  codeEmpty: $('#code-empty'),
  codeViewer: $('#code-viewer'),
  codeIcon: $('#code-icon'),
  codePath: $('#code-path'),
  codePre: $('#code-pre'),
  codeCode: $('#code-code'),
  codeCopy: $('#code-copy'),
  lightbox: $('#lightbox'),
  lightboxImg: $('#lightbox-img'),
  lightboxClose: $('#lightbox-close'),
  toast: $('#toast'),
  toastText: $('#toast-text'),
  toastIcon: $('#toast-icon'),

  // Solo Mode
  soloToggle: $('#solo-toggle'),
  soloKnob: $('#solo-knob'),
  modeLabel: $('#mode-label'),
  modelSelect: $('#model-select'),
  ensembleToggle: $('#ensemble-toggle'),
  ensembleKnob: $('#ensemble-knob'),
  ensembleBadge: $('#trae-ensemble-badge'),
  runmodeChip: $('#runmode-chip'),
  runmodeChipText: $('#runmode-chip-text'),
  progressTrack: $('#progress-track'),
  progressBar: $('#progress-bar'),
  progressText: $('#progress-text'),
  progressLabel: $('#progress-label'),
  planList: $('#plan-list'),

  // ===== RC27 · Orquestrador Autônomo UI =====
  rc27Stepper: $('#rc27-stepper'),
  rc27StepperGoal: $('#rc27-stepper-goal'),
  rc27StepAnalsis: $('#rc27-step-ANALYSIS'),
  rc27StepPlanning: $('#rc27-step-PLANNING'),
  rc27StepArch: $('#rc27-step-ARCHITECTURE'),
  rc27StepImpl: $('#rc27-step-IMPLEMENTATION'),
  rc27StepTests: $('#rc27-step-TESTING'),
  rc27StepFix: $('#rc27-step-CORRECTION'),
  rc27StepVal: $('#rc27-step-VALIDATION'),
  rc27StepDone: $('#rc27-step-COMPLETED'),
  rc27Summary: $('#rc27-stepper-summary'),
  rc27InternetModal: $('#rc27-internet-modal'),
  rc27InternetScope: $('#rc27-internet-scope'),
  rc27InternetReason: $('#rc27-internet-reason'),
  rc27InternetUrls: $('#rc27-internet-urls'),
  rc27InternetBtnYes: $('#rc27-internet-yes'),
  rc27InternetBtnNo: $('#rc27-internet-no'),
  rc27HumanModal: $('#rc27-human-modal'),
  rc27HumanReason: $('#rc27-human-reason'),
  rc27HumanDetails: $('#rc27-human-details'),
  rc27HumanBtnOk: $('#rc27-human-ok'),
  rc27AuthCurrentScopeId: null,

  // Project Mode (TRAE style seletor de pasta)
  projectBtn: $('#project-btn'),
  projectName: $('#project-name'),
  projectDropdown: $('#project-dropdown'),
  projectList: $('#project-list'),
  newProjectInput: $('#new-project-input'),
  newProjectCreate: $('#new-project-create'),
  mountFolderBtn: $('#mount-folder-btn'),
  expandTreeBtn: $('#expand-tree-btn'),

  // ============ 3-COLUMN CLEAN TRAE UI (NOVO RC9) ============
  // Editor panel (col2 central)
  editorPanels: $('#editor-panels'),
  editorTabs: $('#editor-tabs'),
  chatTitleTab: $('#chat-title-tab'),
  codeTabLabel: $('#code-tab-label'),
  consoleOut: $('#console-out'),
  consoleClear: $('#console-clear'),
  terminalOut: $('#terminal-out'),
  terminalClear: $('#terminal-clear'),

  // RC23 · IA Config (nova aba central)
  iacBody: $('#iac-body'),
  iacGrid: $('#iac-grid'),
  iacNote: $('#iac-note'),
  iacRefresh: $('#iac-refresh'),
  iacTestAll: $('#iac-test-all'),
  iacSaveAll: $('#iac-save-all'),

  // ₿ BTC Market Intelligence (aba nova central)
  btcPanel: document.getElementById('btc-panel'),
  btcBody: document.getElementById('btc-body'),
  btcDashboard: document.getElementById('btc-dashboard'),
  btcSpinner: document.getElementById('btc-spinner'),
  btcManualBtn: document.getElementById('btc-manual-btn'),
  btcBacktestBtn: document.getElementById('btc-backtest-btn'),
  btcHistoryBtn: document.getElementById('btc-history-btn'),
  btcBacktestPanel: document.getElementById('btc-backtest-panel'),
  btcHistoryPanel: document.getElementById('btc-history-panel'),

  // Preview service bar (acima das abas do editor central)
  previewServiceSelect: $('#preview-service-select'),
  previewBack: $('#preview-back'),
  previewForward: $('#preview-forward'),
  subTabsContainer: document.querySelector('[data-subtabs]'),

  // Botão config temporário do header do painel TRAE (col3)
  closeRightTmp: $('#close-right-tmp'),

  // TRAE Agent panel (col4)
  traeAgentPanel: $('#trae-agent-panel'),
  traeAgentMode: $('#trae-agent-mode'),
  openTraePanel: $('#open-trae-panel'),
  closeTraePanel: $('#close-trae-panel'),
  traeScroll: $('#trae-scroll'),
  // RC19 Mobile TabBar
  mobileTabbar: $('#mobile-tabbar'),
  mobileTabs: document.querySelectorAll('.mobile-tab'),
  // Thought block
  traeThoughtSection: $('#trae-thought-section'),
  traeThoughtToggle: $('#trae-thought-toggle'),
  traeThoughtChevron: $('#trae-thought-chevron'),
  traeThoughtContent: $('#trae-thought-content'),
  traeThoughtBody: $('#trae-thought-body'),
  traeThoughtSummary: $('#trae-thought-summary-trunc'),
  // Checklist TRAE style
  traeChecklist: $('#trae-checklist'),
  traeTasksLabel: $('#trae-tasks-label'),
  // Running tool mini box
  traeRunningTool: $('#trae-running-tool'),
  traeRunningToolName: $('#trae-running-tool-name'),
  traeRunningToolBody: $('#trae-running-tool-body'),
  // Progress TRAE footer bar
  traeProgressBar: $('#trae-progress-bar'),
  traeProgressCurrent: $('#trae-progress-current'),
  traeProgressTotal: $('#trae-progress-total'),
  traeProgressSubtitle: $('#trae-progress-subtitle'),
  // TRAE chat input
  traeChatForm: $('#trae-chat-form'),
  traeMessageInput: $('#trae-message-input'),
  traeAddBtn: $('#trae-add-btn'),
  traeAutoSelect: $('#trae-auto-select'),
  traePlayBtn: $('#trae-play-btn'),
  // Workdir short header
  workdirShort: $('#workdir-short'),
};

const LSTORAGE_KEY = 'trae_agent_state_v1';
const DEFAULT_PROJECT_NAME = 'default';

/* ========== STATE ========== */
const state = {
  ws: null,
  sessionId: null,
  pendingImages: [],
  connected: false,
  busy: false,
  currentAiMsgId: null,
  currentAiMsgEl: null,
  currentAiText: '',
  currentToolCards: new Map(),
  totalTokens: 0,
  chats: new Map(),      // id -> {id,title,ts}
  currentTree: [],
  activeTab: 'code',
  currentPreviewPath: null,
  leftCollapsed: false,
  // Solo mode
  mode: 'solo',
  model: 'gemini-3.5-flash-lite',
  // RC14 ENSEMBLE 2 cabeças
  ensemble: false,
  ensembleAvailable: false,
  ensembleMode: 'off',
  ensembleModelB: null,
  agentState: 'idle',     // idle | running | paused | stopped
  plan: [],               // [{index,title,desc,status}]  status: pending | active | done | failed
  planDone: 0,
  planTotal: 0,
  // Project Mode (seletor de pasta)
  project: 'default',
  projects: [],           // [{name, modifiedAt, createdAt}]

  // ₿ BTC Market Intelligence
  lastBtcReport: null,
  btcBacktest: null,
  btcHistory: null,
};

/* Load saved state */
try {
  const saved = JSON.parse(localStorage.getItem(LSTORAGE_KEY) || '{}');
  if (saved.chats && Array.isArray(saved.chats)) {
    state.chats = new Map(saved.chats.map(c => [c.id, c]));
  }
  // RC15: NÃO deixe Explorer colapsar por padrão (usuário relatou painel lateral sumindo)
  state.leftCollapsed = false;
  if (saved.mode === 'solo' || saved.mode === 'interactive') state.mode = saved.mode;
  if (saved.model && typeof saved.model === 'string') state.model = saved.model;
  if (saved.project && typeof saved.project === 'string') state.project = saved.project;
  if (typeof saved.ensemble === 'boolean') state.ensemble = saved.ensemble;
} catch (_) {}

function saveState() {
  try {
    localStorage.setItem(LSTORAGE_KEY, JSON.stringify({
      chats: [...state.chats.values()],
      leftCollapsed: state.leftCollapsed,
      mode: state.mode,
      model: state.model,
      project: state.project,
      ensemble: state.ensemble,
    }));
  } catch (_) {}
}

/* ========== TOAST ========== */
let toastT = null;
function toast(msg, kind = 'ok') {
  els.toastText.textContent = msg;
  if (kind === 'err') {
    els.toastIcon.textContent = '✕';
    els.toastIcon.className = 'text-rose-400';
    if (els.toast) els.toast.className = 'fixed bottom-4 right-4 z-50 px-3 py-2 rounded-lg shadow-lg border border-rose-500/30 bg-rose-950/90 backdrop-blur-sm text-rose-100 text-xs font-medium max-w-sm break-words';
  } else if (kind === 'warn') {
    els.toastIcon.textContent = '⚠️';
    els.toastIcon.className = 'text-amber-300 text-base leading-none';
    if (els.toast) els.toast.className = 'fixed bottom-4 right-4 z-50 px-3 py-2 rounded-lg shadow-lg border border-amber-500/40 bg-amber-950/92 backdrop-blur-sm text-amber-50 text-xs font-medium max-w-md break-words leading-relaxed';
  } else {
    els.toastIcon.textContent = '✓';
    els.toastIcon.className = 'text-emerald-400';
    if (els.toast) els.toast.className = 'fixed bottom-4 right-4 z-50 px-3 py-2 rounded-lg shadow-lg border border-emerald-500/30 bg-slate-900/95 backdrop-blur-sm text-emerald-100 text-xs font-medium max-w-sm break-words';
  }
  els.toast.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => els.toast.classList.add('hidden'), kind === 'warn' ? 6000 : 2800);
}

/* ========== STATUS + SOLO MODE UI ========== */
function setStatus(kind, text, sub) {
  const map = {
    ok:      { dot: 'bg-emerald-400',                   ring: 'border-emerald-400/30',  pulse: false },
    error:   { dot: 'bg-rose-400',                      ring: 'border-rose-400/30',     pulse: false },
    pending: { dot: 'bg-amber-400 animate-pulse-dot',   ring: 'border-amber-400/30',    pulse: true  },
    running: { dot: 'bg-brand-500 animate-pulse-dot',   ring: 'border-brand-500/30',    pulse: true  },
    paused:  { dot: 'bg-amber-500',                     ring: 'border-amber-500/30',    pulse: false },
    stopped: { dot: 'bg-rose-500',                      ring: 'border-rose-500/30',     pulse: false },
  };
  const s = map[kind] || map.ok;
  els.statusDot.className = 'w-2.5 h-2.5 rounded-full block ' + s.dot;
  if (els.statusRing) els.statusRing.className = `absolute inset-0 rounded-full border-2 ${s.ring} ${s.pulse ? 'scale-150 opacity-0 animate-ping' : 'scale-100 opacity-70'}`;
  els.statusText.textContent = text;
  if (els.statusSub && sub !== undefined) els.statusSub.textContent = sub;
}

function applyModeUI() {
  const solo = state.mode === 'solo';
  if (els.soloKnob) {
    els.soloKnob.style.left = solo ? '0.125rem' : 'calc(50% + 0.125rem - 1px)';
    els.soloKnob.innerHTML = `<span class="text-[10px] font-bold text-white">${solo ? 'SOLO' : 'INT'}</span>`;
    els.soloToggle.setAttribute('aria-pressed', String(solo));
  }
  if (els.modeLabel) {
    els.modeLabel.textContent = solo ? 'SOLO' : 'INTERATIVO';
    els.modeLabel.className = `text-[10px] font-semibold ${solo ? 'text-emerald-300' : 'text-amber-300'}`;
  }
  if (els.modelSelect) {
    if (!document.activeElement || document.activeElement !== els.modelSelect) {
      els.modelSelect.value = state.model;
    }
  }
  if (els.modelName) els.modelName.textContent = 'Modelo: ' + state.model;
  // RC14 ENSEMBLE GRATUITO (2x Gemini): toggle knob verde + badge esmeralda
  const ens = Boolean(state.ensemble);
  if (els.ensembleToggle) {
    const avail = Boolean(state.ensembleAvailable);
    els.ensembleToggle.classList.toggle('hidden', !avail);
    els.ensembleToggle.classList.toggle('flex', avail);
    if (avail) {
      const knobColor = ens
        ? 'bg-gradient-to-br from-emerald-500 to-teal-600 border-emerald-400/50 shadow'
        : 'bg-white/10 border-white/20';
      els.ensembleKnob.className = 'w-4 h-4 rounded-full grid place-items-center transition-colors border ' + knobColor;
      const svg = els.ensembleKnob.querySelector('svg');
      if (svg) svg.setAttribute('class', `transition w-[7px] h-[7px] ${ens ? 'text-white' : 'text-slate-500'}`);
      els.ensembleToggle.classList.toggle('border-emerald-400/40', ens);
      els.ensembleToggle.classList.toggle('bg-emerald-500/10', ens);
      const labelEl = els.ensembleToggle.querySelector('span:last-child');
      if (labelEl) labelEl.className = `text-[9.5px] font-bold uppercase tracking-wide pr-1.5 ${ens ? 'text-emerald-300' : 'text-slate-500'}`;
      els.ensembleToggle.title = ens
        ? `Ensemble ATIVO · Voto Majoritário Paralelo · 2x Gemini GRATUITO · ${state.ensembleModelA || 'Gemini A'} + ${state.ensembleModelB || 'Gemini B'}`
        : `Ensemble DESLIGADO. Clique para ativar 2 CABEÇAS GRATUITAS: ${state.ensembleModelA || 'Gemini Flash'} + ${state.ensembleModelB || 'Gemini 2.0'} (ambas camada grátis Google — sem gastar nada)`;
    }
  }
  if (els.ensembleBadge) {
    const show = ens && Boolean(state.ensembleAvailable);
    els.ensembleBadge.classList.toggle('hidden', !show);
    els.ensembleBadge.classList.toggle('inline-flex', show);
  }
  // TRAE painel direito sync
  if (els.traeAgentMode) {
    els.traeAgentMode.textContent = solo ? 'SOLO' : 'INTERATIVO';
    els.traeAgentMode.className =
      'ml-auto text-[8.5px] font-bold uppercase px-1.5 py-[2px] rounded border ' +
      (solo
        ? 'text-emerald-300 bg-emerald-600/20 border-emerald-500/30'
        : 'text-amber-300 bg-amber-600/20 border-amber-500/30');
  }
  if (els.traeAutoSelect && document.activeElement !== els.traeAutoSelect) {
    if (state.mode === 'solo') els.traeAutoSelect.value = 'solo';
    else if (state.mode === 'interactive') els.traeAutoSelect.value = 'interactive';
    else els.traeAutoSelect.value = 'auto';
  }
}
function applyProjectUI() {
  if (els.projectName) {
    const cur = state.project || 'default';
    const p = state.projects && state.projects.find(x => x.name === cur);
    const mounted = Boolean(p && p.mounted);
    const port = (p && typeof p.port === 'number') ? p.port : null;
    let label = cur;
    let badge = '';
    if (mounted) {
      badge = `<span class="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">🗂️ Montada${port ? ' · :'+port : ''}</span>`;
    } else if (port) {
      badge = `<span class="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-sky-500/15 text-sky-300 border border-sky-500/30">Workspace · :${port}</span>`;
    }
    const warned = (!mounted) && hasMountedProjects();
    els.projectName.innerHTML = `<span class="${warned ? 'text-amber-300' : ''}">${label}</span>${badge}${warned ? '<span title="Você tem projetos montados 🗂️ disponíveis. Clique aqui para trocar." class="ml-1.5 text-amber-400 text-[10px] font-bold animate-pulse">⚠️</span>' : ''}`;
    els.projectName.title = 'Projeto: ' + cur + (mounted ? ' (montado no Mac/Desktop)' : ' (workspace interno)') + (port ? ' — porta '+port : '');
  }
  if (els.workdirName) {
    els.workdirName.textContent = 'Projeto: ' + (state.project || 'default');
  }
  if (els.workdirShort) {
    els.workdirShort.textContent = state.project || 'criador';
    els.workdirShort.title = 'Projeto: ' + (state.project || 'default');
  }
}
function projectIsMounted(name) {
  const n = name || state.project || DEFAULT_PROJECT_NAME;
  const p = state.projects && state.projects.find(x => x.name === n);
  return Boolean(p && p.mounted);
}
function hasMountedProjects() {
  return Boolean(state.projects && state.projects.some(x => x.mounted));
}
function findFirstMountedProject() {
  if (!state.projects) return null;
  return state.projects.find(x => x.mounted) || null;
}

function sendConfig() {
  sendWS({ type: 'config:set', mode: state.mode, model: state.model, ensemble: Boolean(state.ensemble) });
}

/* ========== PROJECT MODE (TRAE-style seletor de pasta) ========== */
function toggleProjectDropdown(force) {
  if (!els.projectDropdown) return;
  const currentlyHidden =
    els.projectDropdown.classList.contains('hidden') ||
    els.projectDropdown.style.display === 'none';
  const open = force === undefined ? currentlyHidden : force;
  // Garantia dupla: classe + style.display (evita batalha de especificidade CSS)
  els.projectDropdown.classList.toggle('hidden', !open);
  els.projectDropdown.style.display = open ? '' : 'none';
  if (open) {
    window.__projectJustOpenedAt = Date.now();
    setTimeout(() => els.newProjectInput?.focus?.({ preventScroll: true }), 40);
  }
  if (els.projectBtn) els.projectBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function renderProjectList() {
  if (!els.projectList) return;
  const list = state.projects && state.projects.length ? state.projects : [{ name: state.project || 'default', modifiedAt: Date.now() }];
  els.projectList.innerHTML = '';
  for (const p of list) {
    const item = document.createElement('button');
    const active = p.name === state.project;
    const mounted = Boolean(p.mounted);
    const hasPort = typeof p.port === 'number' && p.port > 0;
    item.type = 'button';
    item.className = `project-item w-full flex flex-col items-start gap-1 px-2.5 py-2 rounded-lg text-left transition ${active ? 'project-item-active bg-brand-600/15 border border-brand-500/30 text-white' : 'text-slate-200 hover:bg-white/5 border border-transparent'}`;
    item.dataset.project = p.name;
    item.dataset.active = active ? 'true' : 'false';
    item.dataset.role = 'project-switch';
    const titleLines = [];
    titleLines.push('Trocar para projeto: ' + (p.displayName || p.name));
    if (p.path) titleLines.push('Pasta: ' + p.path);
    if (mounted) titleLines.push('🗂️ Projeto montado de pasta externa');
    if (hasPort) titleLines.push('Preview rodando em porta ' + p.port + ': ' + (p.previewUrl || ''));
    item.setAttribute('title', titleLines.join('\n'));
    if (active) item.setAttribute('aria-current', 'true');
    const folderIcon = mounted
      ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="${active ? 'text-cyan-200' : 'text-cyan-300'} shrink-0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
      : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="${active ? 'text-brand-300' : 'text-amber-300'} shrink-0"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
    item.innerHTML = `
      <div class="w-full flex items-center gap-2">
        ${folderIcon}
        <span class="text-xs md:text-sm font-semibold flex-1 truncate">${escapeHtml(p.displayName || p.name)}</span>
        ${mounted ? `<span class="shrink-0 text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ${active ? 'bg-cyan-500/30 text-cyan-100' : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20'}">🗂️ Montada</span>` : ''}
        ${active ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="text-brand-300 shrink-0"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
      </div>
      ${hasPort ? `<div class="w-full flex items-center gap-1.5 pl-[21px]">
        <span class="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot"></span>
        <span class="text-[10px] font-mono text-emerald-300/90 truncate">Porta ${p.port} · ${escapeHtml(p.previewUrl || '')}</span>
        ${p.previewUrl ? `<a href="${escapeAttr(p.previewUrl)}" target="_blank" rel="noopener noreferrer" class="shrink-0 ml-auto text-[10px] font-semibold text-slate-300 hover:text-white px-1.5 py-0.5 rounded hover:bg-white/10 transition" data-role="open-preview-ext" data-project="${escapeAttr(p.name)}" title="Abrir site em aba nova">Abrir ↗</a>` : ''}
      </div>` : (mounted ? `<div class="w-full pl-[21px]"><span class="text-[10px] text-slate-500 truncate">${escapeHtml(String(p.path || ''))}</span></div>` : '')}
    `;
    // Garantia DUPLA de clique: listener DIRETO no botão (caso delegation morra por algum z-index/css)
    item.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.target.closest('a[data-role="open-preview-ext"]')) return;
      const n = item.dataset.project;
      if (!n) return;
      if (n === state.project) { toggleProjectDropdown(false); return; }
      switchProject(n);
    });
    els.projectList.appendChild(item);
  }
}
/* Event delegation no pai (não importa quando items são recriados)
   Também ativa o click mesmo quando o innerHTML é trocado. */
if (els.projectList) {
  els.projectList.addEventListener('click', (e) => {
    if (e.target.closest('a[data-role="open-preview-ext"]')) return;
    const btn = e.target.closest('button[data-project][data-role="project-switch"]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const name = btn.dataset.project;
    if (!name) return;
    if (name === state.project) {
      // Mesmo projeto — só fecha dropdown
      toggleProjectDropdown(false);
      return;
    }
    switchProject(name);
  });
}
function loadProjects() {
  sendWS({ type: 'project:list' });
  // fallback via REST se WS ainda não conectou
  fetch('/api/projects').then(r => r.json()).then(d => {
    if (d && Array.isArray(d.projects)) {
      state.projects = d.projects;
      renderProjectList();
      populatePreviewServices();
      if (!state.projects.find(p => p.name === state.project)) {
        state.project = d.projects[0]?.name || 'default';
        saveState();
      }
      // Sempre atualiza UI após carregar projects (para badges mounted/porta)
      applyProjectUI();
    }
  }).catch(() => {});
}
function projectChatStorageKey(projectName) {
  return 'proj-chat-idx::' + String(projectName || 'default').toLowerCase();
}
function sessionForProject(projectName) {
  try {
    const k = projectChatStorageKey(projectName);
    const v = localStorage.getItem(k);
    return v && typeof v === 'string' ? v : null;
  } catch { return null; }
}
function setSessionForProject(projectName, sessionId) {
  try {
    if (!sessionId) return;
    localStorage.setItem(projectChatStorageKey(projectName), String(sessionId));
  } catch {}
}
function resetChatViewport() {
  els.messagesList.innerHTML = '';
  state.currentAiMsgId = null;
  state.currentAiMsgEl = null;
  state.currentAiMsgRef = null;
  state.currentAiText = '';
  state.currentPlanMsgId = null;
  state.plan = [];
  state.planDone = 0;
  state.planTotal = 0;
  setProgress(0, 0);
  els.progressTrack?.classList.add('hidden');
  setAgentState('idle');
  els.chatTitle.textContent = 'Nova conversa';
  if (els.chatTitleTab) els.chatTitleTab.textContent = 'Nova conversa';
  els.welcome.classList.remove('hidden');
  state.pendingImages = [];
  renderAttachments();
  // Reset TRAE painel direito (col4)
  if (els.traeThoughtBody) els.traeThoughtBody.textContent = 'Aguardando primeiro prompt…';
  if (els.traeThoughtSummary) els.traeThoughtSummary.textContent = '—';
  if (els.traeThoughtSection) els.traeThoughtSection.classList.remove('open');
  if (els.traeRunningTool) els.traeRunningTool.classList.add('hidden');
  // Editor panels: volta para Chat default
  switchEditorPanel('chat');
  // Limpa code viewer
  if (els.codeEmpty) els.codeEmpty.classList.remove('hidden');
  if (els.codeViewer) els.codeViewer.classList.add('hidden');
  if (els.codeCode) els.codeCode.textContent = '';
  if (els.codePath) els.codePath.textContent = '';
  populatePreviewServices();
}
function switchProject(name) {
  if (!name) return;
  if (name === state.project) {
    toggleProjectDropdown(false);
    return;
  }
  const prev = state.project || DEFAULT_PROJECT_NAME;
  const next = name;
  // 1) Salva sessao antiga associada ao projeto antigo (se tem)
  if (prev && state.sessionId) setSessionForProject(prev, state.sessionId);
  // 2) Atualiza estado
  state.project = next;
  state.currentPreviewPath = null;
  state.currentPreviewProject = null;
  state.busy = false;
  state.abortRequested = false;
  state.pauseRequested = false;
  state.pauseResolver = null;
  els.sendBtn.disabled = false;
  saveState();
  applyProjectUI();
  renderProjectList();
  toggleProjectDropdown(false);
  // 3) Zera UI do chat (igual TRAE: trocar projeto = contexto novo)
  resetChatViewport();
  // 4) Sincroniza com servidor: troca projeto + pede sessao nova/antiga COM PARAMETRO project (para server nao resetar para default!)
  sendWS({ type: 'project:switch', project: next });
  // Recupera sessao antiga desse projeto se existir, sempre passando `project` explicitamente
  const existingSid = sessionForProject(next);
  if (existingSid) {
    sendWS({ type: 'session:resume', sessionId: existingSid, project: next });
  } else {
    sendWS({ type: 'session:new', project: next });
  }
  // 5) Atualiza explorer e preview imediatamente
  state._justMounted = true;
  Promise.resolve().then(() => refreshFileTree().catch(() => {})).then(() => {
    // Depois que carregar a arvore, tenta abrir index.html automaticamente se existir
    const idx = findIndexHtml(state.currentTree);
    if (idx) {
      switchTab('preview');
      openPreview(joinPreviewKey(next, idx));
    } else {
      // Limpa preview se nao tem index
      const iframe = document.getElementById('preview-iframe');
      const urlBar = document.getElementById('preview-url-bar');
      const emptyPrev = document.getElementById('preview-empty');
      if (iframe) { iframe.src = 'about:blank'; iframe.classList.add('hidden'); }
      if (urlBar) urlBar.classList.add('hidden');
      if (emptyPrev) emptyPrev.classList.remove('hidden');
    }
  });
  toast('Projeto alterado: ' + next);
}
async function createProject(name) {
  const clean = String(name || '').trim();
  if (!clean) return;
  els.newProjectInput.value = '';
  try {
    const r = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: clean }),
    });
    const d = await r.json();
    if (d && d.ok) {
      state.projects = d.projects || state.projects;
      switchProject(d.project);
      toast('✅ Projeto criado: ' + d.project);
    } else {
      toast(d?.error || 'Erro ao criar projeto', 'err');
      toggleProjectDropdown(false);
    }
  } catch (e) {
    toast(e.message || 'Erro', 'err');
    toggleProjectDropdown(false);
  }
}

/* ================== TRAE CHECKLIST + PROGRESS (NOVO COL4) ================== */
function renderTraeChecklist() {
  if (!els.traeChecklist) return;
  const steps = state.plan || [];
  // Contador header X/Y
  if (els.traeTasksLabel) {
    els.traeTasksLabel.textContent = `${state.planDone || 0}/${state.planTotal || 0}`;
  }
  if (!steps.length) {
    els.traeChecklist.innerHTML = `
      <li class="flex items-start gap-1.5 px-1.5 py-1.5 rounded text-slate-500">
        <span class="mt-0.5 w-3.5 h-3.5 shrink-0 rounded-full border border-slate-700 grid place-items-center opacity-60"></span>
        <span class="text-[10px] leading-snug">Sem plano ativo. Envie uma tarefa no input abaixo.</span>
      </li>`;
    return;
  }
  // Determina qual índice está ACTIVE (primeiro active, ou o primeiro pending se houver active antes do total batendo)
  let activeIdx = -1;
  const firstActive = steps.findIndex(s => s.status === 'active');
  if (firstActive >= 0) {
    activeIdx = firstActive;
  } else if (state.planDone < state.planTotal && state.agentState === 'running') {
    activeIdx = Math.min(state.planDone, steps.length - 1);
  }
  const frag = document.createDocumentFragment();
  steps.forEach((step, i) => {
    let cls = 'future';
    let circleClass = '';
    let prefix = '';
    if (step.status === 'failed') {
      cls = 'failed';
      circleClass = 'failed';
    } else if (step.status === 'done' || i < state.planDone) {
      cls = 'done';
      circleClass = 'done';
    } else if (step.status === 'active' || i === activeIdx) {
      cls = 'current';
      prefix = `<span class="sparkle-star" aria-hidden="true">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l1.9 5.8L20 9.7l-4.7 4.1L16.8 20 12 16.9 7.2 20l1.5-6.2L4 9.7l6.1-1.9L12 2z"/></svg>
      </span>`;
    }
    const title = escapeHtml(step.title || ('Passo ' + (step.index || i + 1)));
    const desc = (step.desc && step.desc !== step.title)
      ? `<span class="trae-step-desc">${escapeHtml(step.desc)}</span>` : '';
    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = `
      ${prefix}
      <span class="trae-task-circle ${circleClass}" aria-hidden="true"></span>
      <span class="flex-1 min-w-0 leading-snug">
        <span class="trae-step-title">${title}</span>
        ${desc}
      </span>`;
    frag.appendChild(li);
  });
  els.traeChecklist.replaceChildren(frag);
}

function updateTraeProgress() {
  const curr = state.planDone || 0;
  const tot = state.planTotal || 0;
  if (els.traeProgressCurrent) els.traeProgressCurrent.textContent = String(curr);
  if (els.traeProgressTotal) els.traeProgressTotal.textContent = String(tot);
  if (els.traeProgressBar) {
    const pct = tot > 0 ? Math.min(100, Math.max(0, Math.round((curr / tot) * 100))) : 0;
    els.traeProgressBar.style.width = pct + '%';
  }
  if (els.traeProgressSubtitle) {
    if (tot === 0) {
      els.traeProgressSubtitle.textContent = 'Aguardando início';
    } else if (curr >= tot) {
      els.traeProgressSubtitle.textContent = `${tot} tarefa(s) concluída(s) · Sucesso`;
    } else if (state.agentState === 'paused') {
      els.traeProgressSubtitle.textContent = 'Pausado · aguardando ação';
    } else if (state.agentState === 'stopped') {
      els.traeProgressSubtitle.textContent = 'Execução interrompida';
    } else {
      els.traeProgressSubtitle.textContent = `Executando passo ${curr + 1} de ${tot}`;
    }
  }
}

function toggleTraeThought(force) {
  if (!els.traeThoughtSection) return;
  const isOpen = els.traeThoughtSection.classList.contains('open');
  const open = force === undefined ? !isOpen : Boolean(force);
  els.traeThoughtSection.classList.toggle('open', open);
}

function updateTraeThought(text, opts = {}) {
  if (!els.traeThoughtBody || !text) return;
  els.traeThoughtBody.textContent = text;
  if (els.traeThoughtSummary) {
    const firstLine = String(text).replace(/\s+/g, ' ').trim().slice(0, 140);
    els.traeThoughtSummary.textContent = firstLine || '—';
  }
  if (opts.autoOpen && els.traeThoughtSection && !els.traeThoughtSection.classList.contains('open')) {
    els.traeThoughtSection.classList.add('open');
  }
}

function populatePreviewServices() {
  if (!els.previewServiceSelect) return;
  const cur = els.previewServiceSelect.value;
  const projs = Array.isArray(state.projects) ? state.projects : [];
  const opts = [
    `<option value="">Enter URL or select a running service…</option>`
  ];
  for (const p of projs) {
    if (p && typeof p.port === 'number' && p.previewUrl) {
      const label = `${p.displayName || p.name} · Porta ${p.port}${p.mounted ? ' 🗂️' : ''}`;
      opts.push(`<option value="${escapeAttr(p.previewUrl)}" data-project="${escapeAttr(p.name || '')}">${escapeHtml(label)}</option>`);
    }
  }
  els.previewServiceSelect.innerHTML = opts.join('');
  if (cur) try { els.previewServiceSelect.value = cur; } catch (_) {}
}

function renderPlanList() {
  if (!els.planList) { /* pode não existir na UI nova 4 col */ }
  else {
    if (!state.plan || state.plan.length === 0) {
      els.planList.classList.add('hidden');
    } else {
      els.planList.classList.remove('hidden');
      const frag = document.createDocumentFragment();
      for (const step of state.plan) {
        const li = document.createElement('li');
        li.className = 'flex items-start gap-2 plan-step plan-step-' + step.status;
        const iconMap = {
          pending: `<svg class="shrink-0 mt-0.5 w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/></svg>`,
          active:  `<svg class="shrink-0 mt-0.5 w-3.5 h-3.5 text-brand-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
          done:    `<svg class="shrink-0 mt-0.5 w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`,
          failed:  `<svg class="shrink-0 mt-0.5 w-3.5 h-3.5 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
        };
        li.innerHTML = `${iconMap[step.status] || iconMap.pending}
          <div class="min-w-0 flex-1">
            <div class="text-slate-200 text-[12px] font-semibold leading-tight plan-title">${escapeHtml(step.title || ('Passo ' + step.index))}</div>
            ${step.desc && step.desc !== step.title ? `<div class="text-[11px] text-slate-500 leading-tight">${escapeHtml(step.desc)}</div>` : ''}
          </div>`;
        frag.appendChild(li);
      }
      els.planList.replaceChildren(frag);
    }
  }
  renderTraeChecklist();
}

function setProgress(current, total) {
  state.planDone = Math.max(0, Math.min(total || 0, current || 0));
  state.planTotal = total || 0;
  // UI antiga 3 col (fallback se ainda existir)
  if (els.progressTrack) {
    if (total > 0) {
      els.progressTrack.classList.remove('hidden');
      const pct = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
      if (els.progressBar) els.progressBar.style.width = pct + '%';
      if (els.progressText) els.progressText.textContent = `${Math.round(current)}/${total}`;
    } else {
      if (els.progressBar) els.progressBar.style.width = '0%';
      if (els.progressText) els.progressText.textContent = '0/0';
    }
  }
  updateTraeProgress();
  renderTraeChecklist();
}

function setAgentState(next, extra = {}) {
  state.agentState = next;
  // Header chip
  if (els.runmodeChip) {
    if (next === 'running' || next === 'paused') {
      els.runmodeChip.classList.remove('hidden');
      els.runmodeChip.classList.add('flex');
    } else {
      els.runmodeChip.classList.add('hidden');
      els.runmodeChip.classList.remove('flex');
    }
  }
  if (els.runmodeChipText) {
    const solo = state.mode === 'solo';
    if (next === 'running') els.runmodeChipText.textContent = solo ? 'Solo · Rodando' : 'Interativo';
    if (next === 'paused')  els.runmodeChipText.textContent = 'Pausado';
  }
  if (els.runmodeChip) {
    els.runmodeChip.className = els.runmodeChip.className
      .replace(/bg-\w+-600\/\d+|text-\w+-\d+|border-\w+-500\/\d+/g, '')
      .trim();
    if (next === 'running') {
      els.runmodeChip.classList.add('bg-brand-600/15', 'text-brand-300', 'border', 'border-brand-500/30');
    } else if (next === 'paused') {
      els.runmodeChip.classList.add('bg-amber-600/15', 'text-amber-300', 'border', 'border-amber-500/30');
    }
  }
  // Buttons visibility
  const anyActive = next === 'running' || next === 'paused';
  els.stopBtn.classList.toggle('hidden', !anyActive);
  els.pauseBtn.classList.toggle('hidden', next !== 'running');
  els.resumeBtn.classList.toggle('hidden', next !== 'paused');
  els.sendBtn.disabled = next === 'running';
  if (els.traePlayBtn) els.traePlayBtn.disabled = next === 'running';
  // Status chip
  if (next === 'running') {
    setStatus('running', 'Executando', 'Modo ' + (state.mode === 'solo' ? 'Solo' : 'Interativo'));
  } else if (next === 'paused') {
    setStatus('paused',  'Pausado', extra?.reason === 'awaiting_confirm' ? 'Aguardando sua confirmação' : 'Aperte continuar');
  } else if (next === 'stopped') {
    setStatus('stopped', 'Interrompido', 'Clique em novo para reiniciar');
    setProgress(0, 0);
  } else { // idle
    setStatus('ok', 'Conectado', 'Pronto para começar');
  }
}

function setPlanSteps(steps) {
  state.plan = steps.map(s => ({
    index: s.index,
    title: s.title,
    desc: s.desc || s.title,
    status: 'pending',
  }));
  state.planDone = 0;
  state.planTotal = steps.length;
  setProgress(0, steps.length);
  renderPlanList();
}

function advancePlanStatus(status) {
  // marca o primeiro pending como ativo, ou último ativo como done/failed
  const plan = state.plan;
  if (!plan.length) return;
  if (status === 'active') {
    const idx = plan.findIndex(s => s.status === 'pending');
    if (idx >= 0) plan[idx].status = 'active';
  } else if (status === 'done') {
    const idx = plan.findIndex(s => s.status === 'active');
    if (idx >= 0) {
      plan[idx].status = 'done';
      state.planDone = plan.filter(s => s.status === 'done').length;
      setProgress(state.planDone, state.planTotal);
    } else {
      const idx2 = plan.findIndex(s => s.status === 'pending');
      if (idx2 >= 0) { plan[idx2].status = 'done'; state.planDone++; setProgress(state.planDone, state.planTotal); }
    }
  } else if (status === 'failed') {
    const idx = plan.findIndex(s => s.status === 'active') ?? plan.findIndex(s => s.status === 'pending');
    if (idx >= 0) plan[idx].status = 'failed';
  }
  renderPlanList();
}

/* ========== META ========== */
async function loadMeta() {
  try {
    const r = await fetch('/api/status');
    const j = await r.json();
    if (!state.model || state.model === 'gemini-3.5-flash-lite' && j.model && j.model !== state.model) {
      // keep user selection over default
    }
    // RC14 ENSEMBLE GRATUITO (2x Gemini): bootstrap from server
    if (j && j.ensemble && typeof j.ensemble === 'object') {
      state.ensembleAvailable = Boolean(j.ensemble.available);
      if (typeof j.ensemble.mode === 'string') state.ensembleMode = j.ensemble.mode;
      if (typeof j.ensemble.modelA === 'string') state.ensembleModelA = j.ensemble.modelA;
      if (typeof j.ensemble.modelB === 'string') state.ensembleModelB = j.ensemble.modelB;
      // Segurança: se servidor diz que ensemble não está disponível, força desligado
      if (!state.ensembleAvailable && state.ensemble) {
        state.ensemble = false;
        saveState();
      }
    }
    els.modelName.textContent = 'Modelo: ' + state.model;
  } catch (_) {}
  applyModeUI();
  applyProjectUI();
  renderProjectList();
  loadProjects();
}
loadMeta();

/* ========== WEB SOCKET ========== */
let _kaTimer = null;
let _backoff = 2000;

function connectWS() {
  setStatus('pending', 'Conectando…', 'Abrindo conexão');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;

  ws.addEventListener('open', () => {
    setStatus('ok', 'Conectado', 'Pronto para começar');
    state.connected = true;
    _backoff = 2000;

    clearInterval(_kaTimer);

    _kaTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            type: 'keepalive',
            t: Date.now()
          }));
        } catch {}
      }
    }, 15000);

    // Ao abrir WS: cria sessao nova JÁ com projeto salvo (se nao usa default) — evita server resetar para default!
    const savedProject = state.project || DEFAULT_PROJECT_NAME;
    const existingSid = sessionForProject(savedProject);
    if (existingSid) {
      ws.send(JSON.stringify({ type: 'session:resume', sessionId: existingSid, project: savedProject }));
    } else {
      ws.send(JSON.stringify({ type: 'session:new', project: savedProject }));
    }
    refreshFileTree();
  });

  ws.addEventListener('close', () => {
    setStatus('error', 'Desconectado', 'Reconectando…');
    state.connected = false;

    clearInterval(_kaTimer);

    const delay = _backoff;
    _backoff = Math.min(_backoff * 2, 20000);

    setTimeout(connectWS, delay);
  });

  ws.addEventListener('error', () => {
    setStatus('error', 'Erro de conexão', 'Tentando novamente');
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    handleWS(msg);
  });
}
function sendWS(obj) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj));
}
connectWS();

/* ========== HANDLE WS MESSAGES ========== */
function handleWS(msg) {
  switch (msg.type) {
    case 'session:ready':
      state.sessionId = msg.data.id;
      if (msg.data.project && typeof msg.data.project === 'string') {
        if (msg.data.project !== state.project) {
          state.project = msg.data.project;
          saveState();
          applyProjectUI();
          renderProjectList();
        }
      }
      setSessionForProject(state.project || DEFAULT_PROJECT_NAME, state.sessionId);
      if (state.chats.has(state.sessionId)) {
        const c = state.chats.get(state.sessionId);
        els.chatTitle.textContent = c.title;
      }
      sendConfig();
      renderHistory();
      const projReady = state.project || DEFAULT_PROJECT_NAME;
      // UNIFY_CONV: após session:ready dispara carregamento do chat persistido (mesmo projeto não-agent__)
      Promise.resolve().then(() => restoreUIConversationFromDisk(projReady, false)).catch(()=>{});
      const hasPort0 = state.projects && state.projects.find(p => p.name === projReady && typeof p.port === 'number');
      Promise.resolve()
        .then(() => hasPort0 ? Promise.resolve() : fetch(`/api/projects/${encodeURIComponent(projReady)}/preview/start`, { method: 'POST' }).then(r => r.json()).then(d => {
          if (d && d.ok) {
            if (!state.projects) state.projects = [];
            const i = state.projects.findIndex(p => p.name === projReady);
            if (i >= 0) { state.projects[i].port = d.port; state.projects[i].previewUrl = d.url || state.projects[i].previewUrl; }
            renderProjectList();
          }
        }).catch(() => {}))
        .then(() => refreshFileTree().catch(() => {}))
        .then(() => {
          const idx = findIndexHtml(state.currentTree);
          if (idx) {
            switchTab('preview');
            openPreview(joinPreviewKey(projReady, idx));
          }
        });
      break;
    case 'session:cleared':
      els.messagesList.innerHTML = '';
      els.welcome.classList.remove('hidden');
      state.currentAiMsgId = null;
      state.currentAiMsgEl = null;
      state.currentAiText = '';
      state.currentToolCards.clear();
      state.plan = [];
      state.planDone = 0;
      state.planTotal = 0;
      setProgress(0, 0);
      renderPlanList();
      els.progressTrack?.classList.add('hidden');
      // RC27: sessão limpa → reset stepper e modais
      try { if (typeof window.__rc27ResetStepper === 'function') window.__rc27ResetStepper(); } catch(_) {}
      setAgentState('idle');
      renderHistory();
      break;
    case 'config:updated':
      if (msg.data.mode) state.mode = msg.data.mode;
      if (msg.data.model) state.model = msg.data.model;
      // RC14 ENSEMBLE GRATUITO: sync bidirecional
      if (typeof msg.data.ensemble === 'boolean') state.ensemble = msg.data.ensemble;
      if (msg.data.ensembleAvailable !== undefined) state.ensembleAvailable = Boolean(msg.data.ensembleAvailable);
      if (typeof msg.data.ensembleMode === 'string') state.ensembleMode = msg.data.ensembleMode;
      if (typeof msg.data.modelA === 'string') state.ensembleModelA = msg.data.modelA;
      if (typeof msg.data.modelB === 'string') state.ensembleModelB = msg.data.modelB;
      applyModeUI();
      saveState();
      break;
    case 'ensemble:toggled':
      // RC14 ENSEMBLE GRATUITO: confirmação servidor (source of truth)
      if (typeof msg.data.enabled === 'boolean') state.ensemble = msg.data.enabled;
      if (msg.data.available !== undefined) state.ensembleAvailable = Boolean(msg.data.available);
      if (typeof msg.data.modelA === 'string') state.ensembleModelA = msg.data.modelA;
      if (typeof msg.data.modelB === 'string') state.ensembleModelB = msg.data.modelB;
      applyModeUI();
      saveState();
      if (state.ensembleAvailable) {
        toast(
          state.ensemble
            ? `🆓 Ensemble LIGADO · 2x Gemini GRATUITO · ${state.ensembleModelA || 'Cabeça A'} + ${state.ensembleModelB || 'Cabeça B'}`
            : '🧠 Ensemble DESLIGADO · voltando a 1 cabeça só (poupa cota Google)',
          state.ensemble ? 'ok' : 'warn'
        );
      } else {
        toast('⚠️ Ensemble indisponível: verifique FREE_ENSEMBLE_MODE=parallel no arquivo .env', 'warn');
      }
      break;
    case 'project:list':
      if (msg.data.projects) {
        state.projects = msg.data.projects;
        renderProjectList();
        if (!state.projects.find(p => p.name === state.project)) {
          state.project = state.projects[0]?.name || 'default';
          saveState();
          applyProjectUI();
        }
      }
      break;
    case 'project:switched':
      if (msg.data.project) {
        const changed = state.project !== msg.data.project;
        state.project = msg.data.project;
        if (msg.data.projects && msg.data.projects.length) {
          state.projects = msg.data.projects;
        } else if (!state.projects) state.projects = [];
        if ((typeof msg.data.port === 'number' || msg.data.previewUrl) && state.projects.length) {
          const i = state.projects.findIndex(p => p.name === msg.data.project);
          if (i >= 0) {
            if (typeof msg.data.port === 'number') state.projects[i].port = msg.data.port;
            if (msg.data.previewUrl) state.projects[i].previewUrl = msg.data.previewUrl;
          }
        }
        saveState();
        applyProjectUI();
        renderProjectList();
        toggleProjectDropdown(false);
        if (msg.data.project && state.sessionId) setSessionForProject(msg.data.project, state.sessionId);
        sendConfig();
        debouncedRefreshTree();
        if (changed) {
          // UNIFY_CONV: ao trocar projeto, limpa UI chat e carrega mensagens do disco do projeto novo
          els.messagesList.innerHTML = '';
          els.welcome.classList.remove('hidden');
          state.currentAiMsgId = null;
          state.currentAiMsgEl = null;
          state.currentAiText = '';
          state.currentToolCards.clear();
          state.plan = [];
          state.planDone = 0;
          state.planTotal = 0;
          setProgress(0, 0);
          renderPlanList();
          try { if (typeof window.__rc27ResetStepper === 'function') window.__rc27ResetStepper(); } catch(_) {}
          setAgentState('idle');
          renderHistory();
          // carrega memória persistida do projeto novo em UI
          Promise.resolve().then(() => restoreUIConversationFromDisk(msg.data.project, true)).catch(()=>{});
          const idx = findIndexHtml(state.currentTree);
          if (idx) {
            switchTab('preview');
            openPreview(joinPreviewKey(state.project, idx));
          }
          toast('Projeto alterado: ' + state.project);
        }
      }
      break;
    case 'project:created':
      if (msg.data.project) state.project = msg.data.project;
      if (msg.data.projects) state.projects = msg.data.projects;
      else if (!state.projects) state.projects = [];
      if ((typeof msg.data.port === 'number' || msg.data.previewUrl) && state.projects.length) {
        const i = state.projects.findIndex(p => p.name === msg.data.project);
        if (i >= 0) {
          if (typeof msg.data.port === 'number') state.projects[i].port = msg.data.port;
          if (msg.data.previewUrl) state.projects[i].previewUrl = msg.data.previewUrl;
        }
      }
      saveState();
      applyProjectUI();
      renderProjectList();
      toggleProjectDropdown(false);
      if (state.project && state.sessionId) setSessionForProject(state.project, state.sessionId);
      sendConfig();
      debouncedRefreshTree();
      toast('✅ Projeto criado: ' + state.project);
      break;
    case 'agent:state':
      setAgentState(msg.data.state || 'idle', { reason: msg.data.reason });
      if (msg.data.mode) { state.mode = msg.data.mode; applyModeUI(); }
      if (msg.data.model) { state.model = msg.data.model; applyModeUI(); }
      if (msg.data.project) {
        state.project = msg.data.project;
        applyProjectUI();
        // RC24: trocou projeto → recarrega barra de contexto (se for agente):
        try {
          if (/^agent__/.test(String(state.project||''))) {
            Promise.all([
              fetch('/api/agent/'+encodeURIComponent(state.project)).then(x=>x.json()).catch(()=>({})),
              fetch('/api/agent/'+encodeURIComponent(state.project)+'/state').then(x=>x.json()).catch(()=>({}))
            ]).then(([spec,st])=>{
              window.__rc24UpdateBar && window.__rc24UpdateBar({ project: state.project, version: spec && spec.version, state: st && st.state && st.state.currentState, lastRc22Run: st && st.state && st.state.lastRc22Run });
            }).catch(()=>{});
          } else if (window.__rc24UpdateBar) {
            window.__rc24UpdateBar({ project: state.project });
          }
        } catch {}
      }
      break;
    case 'agent:plan':
      setPlanSteps(msg.data.steps || []);
      break;
    case 'agent:progress':
      setProgress(msg.data.current || 0, msg.data.total || state.planTotal);
      break;
    case 'agent:awaitConfirm': {
      // Shows confirm UI
      const calls = msg.data.calls || [];
      const el = ensureAwaitConfirm(msg.data.step, calls);
      els.messagesList.appendChild(el);
      scrollBottom();
      break;
    }
    case 'message:user':
      addUserMessage(msg.data);
      break;
    case 'message:ai':
      addAIMessage(msg.data, false);
      break;
    case 'message:ai:delta':
      updateAIMessageDelta(msg.data);
      break;
    case 'agent:step': {
      const s = msg.data;
      els.stepInfo.classList.remove('hidden');
      const planTotal = s.planTotal || state.planTotal || 0;
      const planDone  = s.planDone  || state.planDone || 0;
      els.stepInfo.textContent = planTotal
        ? `Passo ${s.step}/${s.max} · Plano ${planDone}/${planTotal}`
        : `Passo ${s.step}/${s.max}`;
      addStepBar(s.step, s.max);
      if (state.plan && state.plan.length) advancePlanStatus('active');
      break;
    }
    case 'agent:done': {
      const reason = msg.data?.reason || 'finished';
      // Atualiza TODOS os step-bars visíveis que ainda contêm "Agente executando…" (resíduo visual de steps concluídos)
      const allStepBars = els.messagesList?.querySelectorAll?.('.step-bar');
      if (allStepBars && allStepBars.length) {
        const newLabel = (
          reason === 'finished' ? '✅ Concluído com sucesso' :
          (reason === 'aborted' || reason === 'new_run_abort_old') ? '⏹️ Interrompido' :
          reason === 'max_steps' ? '⏸️ Limite de passos atingido' :
          '⚠️ Finalizado'
        );
        allStepBars.forEach(bar => {
          const spans = Array.from(bar.querySelectorAll('span'));
          const chip = bar.querySelector('.chip');
          let labelNode = null;
          if (chip && chip.nextSibling && chip.nextSibling.nodeType === Node.TEXT_NODE && /Agente executando/.test(chip.nextSibling.textContent || '')) {
            labelNode = chip.nextSibling;
          } else if (spans.length > 1) {
            labelNode = spans[spans.length - 1];
          } else if (spans.length === 1 && !chip) {
            labelNode = spans[0];
          }
          if (labelNode && /Agente executando/.test(labelNode.textContent || '')) {
            labelNode.textContent = newLabel;
          }
        });
      }
      els.stepInfo.classList.remove('hidden');
      if (state.planTotal && state.planDone >= state.planTotal && reason === 'finished') {
        els.stepInfo.textContent = `Passo ${state.planTotal}/${state.planTotal} · Plano ${state.planTotal}/${state.planTotal} · ✅ Concluído`;
      } else if (reason === 'finished') {
        els.stepInfo.textContent = '✅ Concluído';
      } else if (reason === 'aborted' || reason === 'new_run_abort_old') {
        els.stepInfo.textContent = '⏹️ Execução interrompida';
      } else if (reason === 'max_steps') {
        els.stepInfo.textContent = '⏸️ Limite de passos atingido';
      } else {
        els.stepInfo.classList.add('hidden');
      }
      stopThinking();
      state.busy = false;
      state.stepCurrent = 0;
      state.stepMax = 0;
      setAgentState(reason === 'finished' ? 'idle' : 'stopped', { reason });
      els.sendBtn.disabled = false;
      if (els.traePlayBtn) els.traePlayBtn.disabled = false;
      if (els.traeMessageInput) els.traeMessageInput.disabled = false;
      if (state.plan && state.plan.length) {
        for (const step of state.plan) if (step.status === 'active') step.status = reason === 'finished' ? 'done' : 'failed';
        if (reason === 'finished') state.planDone = state.plan.length;
        state.planDone = state.plan.filter(s => s.status === 'done').length;
        setProgress(state.planDone, state.planTotal);
        renderPlanList();
        renderTraeChecklist();
      } else {
        // Sem plano mas agente terminou → atualiza barra TRAE para 100% visual
        if (reason === 'finished') setProgress(1, 1);
        updateTraeProgress();
      }
      finalizeCurrentAIMessage();
      // RC22.4 Voice Conversation: informa o agente de voz que a resposta completa chegou + agent:done
      try {
        if (typeof window.__ti_voice_emitMessage === 'function') window.__ti_voice_emitMessage(state.currentAiText || '');
        if (typeof window.__ti_voice_emitDone === 'function') window.__ti_voice_emitDone(state.currentAiText || '', reason);
      } catch {}
      // Garante 100% painel TRAE sempre no concluded se finished
      if (els.traeProgressBar && reason === 'finished') {
        els.traeProgressBar.style.transition = 'width 280ms ease';
        els.traeProgressBar.style.width = '100%';
      }
      break;
    }
    case 'tool:call':
      addToolCard(msg.data);
      break;
    case 'tool:result':
      updateToolCard(msg.data);
      if (state.plan && state.plan.length) {
        advancePlanStatus(msg.data.ok ? 'done' : 'failed');
      }
      break;
    case 'file:changed':
      handleFileChanged(msg.data);
      break;
    case 'file:tree:refresh':
      debouncedRefreshTree();
      break;
    case 'agent:phase': {
      const d = msg.data || {};
      const phase = String(d.phase || '').toUpperCase();
      const status = String(d.status || 'start');
      const provLabel = d.provider ? `${d.provider}/${d.model || ''}` : '';
      const phaseName = phase === 'ARCH' ? '🏛️ Arquiteta' : phase === 'QA' ? '🔍 Analista QA' : `⚙️ Fase ${phase}`;
      const palette = phase === 'ARCH'
        ? ['#2563eb', '#1d4ed8', '🏛️', 'bg-sky-600/15 border-sky-500/30 text-sky-200']
        : phase === 'QA'
          ? ['#10b981', '#047857', '🔍', 'bg-emerald-600/15 border-emerald-500/30 text-emerald-200']
          : ['#f59e0b', '#b45309', '⚙️', 'bg-amber-600/15 border-amber-500/30 text-amber-200'];
      const statusTxt =
        status === 'start' ? `Iniciando ${phaseName}${provLabel ? ' · ' + provLabel : ''}…`
        : status === 'done'  ? `✅ ${phaseName} concluído${provLabel ? ' · ' + provLabel : ''}${d.tokensIn||d.tokensOut ? ` · ${(d.tokensIn||0)+(d.tokensOut||0)} tok` : ''}${d.counts ? ` · Críticos:${d.counts.critico||0} Avisos:${d.counts.aviso||0} OK:${d.counts.ok||0}` : ''}`
        : status === 'fallback' ? `⚠️ ${phaseName} fallback local ${d.text ? ' · ' + d.text : ''}`
        : `${phaseName} · status=${status}`;
      const msgId = 'phase_' + phase + '_' + status + '_' + Date.now();
      // Mensagem visual compacta no chat (sem quebrar estrutura)
      addAIMessage({
        id: msgId,
        text: `${palette[2]} **${phaseName}** · ${statusTxt}${d.text ? '\n> _' + d.text + '_' : ''}`,
        _phase: true, _phaseBadge: palette[3],
      }, false);
      // Toast (desktop) ou feedback visual
      try { toast(`${palette[2]} ${statusTxt}`, status === 'fallback' ? 'warn' : 'ok'); } catch {}
      // Atualiza step info bar superior (opcional, não destrói)
      if (els.stepInfo) {
        els.stepInfo.classList.remove('hidden');
        els.stepInfo.textContent = `${palette[2]} ${phaseName} · ${status === 'start' ? 'processando…' : (status === 'done' ? 'concluído ✓' : 'fallback ⚠️')}${provLabel ? ' · ' + provLabel : ''}`;
      }
      scrollBottom();
      break;
    }
    case 'agent:qa_report': {
      const d = msg.data || {};
      const issues = Array.isArray(d.issues) ? d.issues.slice(0, 30) : [];
      const score = typeof d.overallScore === 'number' ? d.overallScore : null;
      const counts = d.counts || { critico: 0, aviso: 0, ok: 0 };
      const scoreColor = score === null ? 'bg-slate-500'
        : score >= 85 ? 'bg-emerald-500'
        : score >= 65 ? 'bg-amber-500'
        : 'bg-rose-500';
      const reportId = 'qa_' + Date.now();
      // Header do relatório
      let html = `
<div class="my-2 rounded-2xl border border-slate-700/60 bg-slate-900/60 backdrop-blur-sm shadow-md overflow-hidden" data-qa-report="${reportId}">
  <div class="flex items-center gap-3 px-4 py-3 bg-slate-800/40 border-b border-slate-700/60 cursor-pointer select-none" data-qa-toggle="${reportId}">
    <div class="w-11 h-11 rounded-xl grid place-items-center bg-gradient-to-br from-emerald-600/40 to-sky-600/40 border border-emerald-500/30 text-xl">🔍</div>
    <div class="flex-1 min-w-0">
      <div class="text-[13px] font-bold text-white truncate">Relatório QA · ${escapeHtml(String(d.project || state.project || ''))}${d.provider ? `<span class="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-700/80 text-slate-200 uppercase tracking-wide">${escapeHtml(d.provider)}${d.model ? ' / '+escapeHtml(d.model):''}</span>` : ''}</div>
      <div class="mt-0.5 text-[11.5px] text-slate-300/80 line-clamp-1">${escapeHtml(String(d.summary || 'Revisão aplicada').slice(0, 180))}</div>
    </div>
    <div class="flex items-center gap-2">
      <div class="flex flex-col items-end">
        <div class="flex items-center gap-1.5">
          <span class="text-[9.5px] font-bold uppercase tracking-wide text-rose-300 bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 rounded">🔴 ${counts.critico||0}</span>
          <span class="text-[9.5px] font-bold uppercase tracking-wide text-amber-300 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded">🟡 ${counts.aviso||0}</span>
          <span class="text-[9.5px] font-bold uppercase tracking-wide text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded">🟢 ${counts.ok||0}</span>
        </div>
      </div>
      ${score !== null ? `
      <div class="flex flex-col items-end">
        <div class="w-14 h-14 rounded-full grid place-items-center border-4 border-slate-700/80 ${scoreColor} shadow-inner">
          <span class="text-[15px] font-extrabold text-white drop-shadow">${Math.round(score)}</span>
        </div>
        <span class="mt-1 text-[9px] text-slate-400 font-semibold tracking-wide">SCORE /100</span>
      </div>` : ''}
      <svg data-qa-chevron="${reportId}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-slate-300 transition-transform">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>
  </div>
  <div class="qa-body hidden px-4 py-3 space-y-2 bg-slate-950/40" data-qa-body="${reportId}">
`;
      // Issues
      for (let i = 0; i < issues.length; i++) {
        const it = issues[i];
        const sev = it.severity === 'critico' ? 'critico' : it.severity === 'ok' ? 'ok' : 'aviso';
        const [sevLabel, sevIcon, sevCls] = sev === 'critico'
          ? ['CRÍTICO', '🔴', 'border-rose-500/40 bg-rose-600/10 text-rose-100']
          : sev === 'ok'
            ? ['APROVADO', '🟢', 'border-emerald-500/40 bg-emerald-600/10 text-emerald-100']
            : ['AVISO', '🟡', 'border-amber-500/40 bg-amber-600/10 text-amber-100'];
        const catLabel = ({
          responsividade: '📱 Responsividade',
          javascript: '⚡ JavaScript',
          html_semantico: '🏷️ HTML',
          acessibilidade: '♿ A11y',
          seo: '🔎 SEO',
          paleta_tipografia: '🎨 Design',
          assets: '🖼️ Assets',
          performance: '🚀 Perf.',
          arquitetura_arquivos: '📂 Arq.',
          outro: '🧩 Outro',
        })[it.category] || String(it.category || 'outro').slice(0, 18);
        html += `
    <div class="rounded-xl border ${sevCls} overflow-hidden" data-qa-severity="${sev}">
      <div class="flex items-center gap-2 px-3 py-2.5 border-b border-inherit/60 bg-inherit/40 cursor-pointer select-none" data-qa-issue-toggle="${reportId}_${i}">
        <span class="text-[10px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border border-inherit bg-inherit/50">${sevIcon} ${sevLabel}</span>
        <span class="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-900/60 text-slate-200 border border-slate-700/60">${escapeHtml(catLabel)}</span>
        <span class="text-[11.5px] font-mono text-slate-200/90 truncate ml-1.5">📄 ${escapeHtml(String(it.file || 'N/A').slice(0, 60))}${typeof it.line === 'number' ? `:${it.line}` : ''}</span>
        <svg data-qa-issue-chevron="${reportId}_${i}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="ml-auto text-slate-300 shrink-0 transition-transform"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="px-3.5 py-2.5 space-y-1.5 text-[12.5px] leading-relaxed hidden" data-qa-issue-body="${reportId}_${i}">
        <div class="font-bold text-[13px] text-white">${escapeHtml(String(it.title || 'Problema detectado').slice(0, 200))}</div>
        <div class="text-slate-200/90 whitespace-pre-wrap">${escapeHtml(String(it.description || '').slice(0, 800))}</div>
        ${it.suggestedFix && String(it.suggestedFix).trim() ? `<div class="mt-1.5 p-2.5 rounded-lg bg-slate-900/70 border border-slate-700/60"><div class="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">💡 Sugestão de correção</div><div class="text-slate-100 whitespace-pre-wrap">${escapeHtml(String(it.suggestedFix).slice(0, 1000))}</div></div>` : ''}
        ${it.refArquiteto && String(it.refArquiteto).trim() !== 'N/A' ? `<div class="text-[10.5px] text-slate-400/90">Ref. Arquiteta: <span class="font-mono">${escapeHtml(String(it.refArquiteto).slice(0, 120))}</span></div>` : ''}
      </div>
    </div>`;
      }
      if (issues.length === 0) html += `<div class="text-center py-5 text-slate-400 text-xs">Nenhum item de QA reportado.</div>`;
      if (d.fallback) html += `<div class="mt-2 rounded-lg border border-amber-500/30 bg-amber-600/10 px-3 py-2 text-[11.5px] text-amber-100">⚠️ QA usou modo fallback local (provedor de IA externo indisponível ou timeout).</div>`;
      html += `
  </div>
</div>`;
      // Injetar como card no final do chat
      const wrap = document.createElement('div');
      wrap.className = 'px-2 my-1';
      wrap.innerHTML = html;
      els.messagesList.appendChild(wrap);
      // Toggle principal QA accordion
      const head = wrap.querySelector(`[data-qa-toggle="${reportId}"]`);
      const body = wrap.querySelector(`[data-qa-body="${reportId}"]`);
      const chev = wrap.querySelector(`[data-qa-chevron="${reportId}"]`);
      if (head && body) {
        // Começa FECHADO se score >=70, ABERTO se score baixo ou tem crítico
        const defaultOpen = (score === null || score < 70 || (counts.critico||0) > 0);
        if (defaultOpen) { body.classList.remove('hidden'); if (chev) chev.style.transform = 'rotate(180deg)'; }
        head.addEventListener('click', () => {
          const isOpen = !body.classList.contains('hidden');
          body.classList.toggle('hidden', isOpen);
          if (chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
        });
      }
      // Toggle issues individuais
      wrap.querySelectorAll('[data-qa-issue-toggle]').forEach(t => {
        const id = t.getAttribute('data-qa-issue-toggle');
        const issueBody = wrap.querySelector(`[data-qa-issue-body="${id}"]`);
        const issueChev = wrap.querySelector(`[data-qa-issue-chevron="${id}"]`);
        if (!t || !issueBody) return;
        t.addEventListener('click', () => {
          const op = !issueBody.classList.contains('hidden');
          issueBody.classList.toggle('hidden', op);
          if (issueChev) issueChev.style.transform = op ? '' : 'rotate(180deg)';
        });
      });
      scrollBottom();
      // Salva no estado para história (opcional)
      try { (state.qaReports = state.qaReports || []).push({ id: reportId, data: d, at: Date.now() }); saveState?.(); } catch {}
      try { toast(`🔍 QA · Score ${score ?? '?'} · ${counts.critico||0} críticos · ${counts.aviso||0} avisos`, (counts.critico||0) > 0 ? 'warn' : 'ok'); } catch {}
      break;
    }
    case 'error':
      addAIMessage({ id: 'err_' + Date.now(), text: '❌ ' + (msg.data.message || 'Erro') }, false);
      stopThinking();
      state.busy = false;
      state.plan = []; state.planDone = 0; state.planTotal = 0; state.stepCurrent = 0; state.stepMax = 0;
      setProgress(0, 0); renderPlanList(); renderTraeChecklist();
      setAgentState('stopped', { reason: 'error' });
      els.sendBtn.disabled = false;
      if (els.traePlayBtn) els.traePlayBtn.disabled = false;
      finalizeCurrentAIMessage();
      toast(msg.data.message || 'Erro', 'err');
      break;
    /* ===== RC24 AGENT ORCHESTRATOR CASES ===== */
    case 'agent:state:changed': {
      const d = msg.data || {};
      try {
        if (window.__rc24UpdateBar) window.__rc24UpdateBar({ state: d.currentState, project: d.projectSlug, history: d.history, lastRc22Run: d.lastRc22Run });
        toast(`🧭 Estado do agente: ${d.currentState}${d.reason ? ' · ' + d.reason : ''}`, 'ok');
      } catch {}
      addAIMessage({ id: 'agent_state_' + Date.now(), text: `🧭 **Estado agente RC24** alterado para **${d.currentState}**${d.reason ? ` · _${escapeHtml(String(d.reason).slice(0,120))}_` : ''}` }, false);
      scrollBottom();
      break;
    }
    case 'agent:spec:updated': {
      const d = msg.data || {};
      addAIMessage({ id: 'agent_spec_' + Date.now(), text: `📄 **Especificação RC24** atualizada · versão **v${d.previousVersion || '?'} → v${d.newVersion || '?'}**` }, false);
      try { if (window.__rc24UpdateBar) window.__rc24UpdateBar({ version: d.newVersion, project: d.projectSlug }); } catch {}
      scrollBottom();
      break;
    }
    /* ===== RC24.5 QA AUTOFIX CASES ===== */
    case 'qa:autofix:start': {
      const d = msg.data || {};
      toast(`🔍 QA Autofix: iniciando (máx ${d.maxIter || 3} iterações · backup seguro)`, 'ok');
      startThinking();
      state.busy = true; els.sendBtn.disabled = true;
      break;
    }
    case 'qa:autofix:iter': {
      const d = msg.data || {};
      let info = d.info || `Iteração ${d.iter||'?'}/${d.maxIter||'?'}`;
      let extra = '';
      if (typeof d.scoreAntes === 'number' && typeof d.scoreDepois === 'number') extra = ` · Score ${d.scoreAntes}→${d.scoreDepois}`;
      if (typeof d.criticosDepois === 'number') extra += ` · Críticos=${d.criticosDepois}`;
      toast(`🛠️ QA Autofix · ${info}${extra}`, 'ok');
      break;
    }
    case 'qa:autofix:end': {
      const d = msg.data || {};
      stopThinking(); state.busy = false; els.sendBtn.disabled = false;
      finalizeCurrentAIMessage(); setAgentState('idle',{reason:'qa_autofix_end'});
      if (d && d.resumo) addAIMessage({ id: 'qa_auto_end_' + Date.now(), text: d.resumo }, false);
      toast(d && d.ok ? '✅ QA Autofix concluído' : '⚠️ QA Autofix finalizado (ver detalhes)', d && d.ok ? 'ok' : 'warn');
      scrollBottom();
      break;
    }
    /* ===== END RC24.5 ===== */
    /* ===== RC27 · ORQUESTRADOR AUTÔNOMO CASES ===== */
    case 'orch:phase': {
      const d = msg.data || {};
      if (typeof window.__rc27SetPhase === 'function') {
        try { window.__rc27SetPhase(d); } catch(_) {}
      }
      try {
        if (d.goalText && els.rc27StepperGoal && (els.rc27StepperGoal.dataset.filledBy !== '1' || !els.rc27StepperGoal.dataset.filledBy)) {
          els.rc27StepperGoal.textContent = String(d.goalText);
          els.rc27StepperGoal.dataset.filledBy = '1';
        }
        if (d.goalText && d.forceGoalReplace === true) {
          els.rc27StepperGoal.textContent = String(d.goalText);
          els.rc27StepperGoal.dataset.filledBy = '2';
        }
        if (els.rc27Stepper && els.rc27Stepper.classList.contains('hidden')) els.rc27Stepper.classList.remove('hidden');
        // Atualiza step atual + status
        const curPhase = (d.phase || 'ANALYSIS');
        const status = d.status || 'active';
        const label = d.label || null;
        const summary = d.summary || null;
        if (typeof window.__rc27UpdateStepper === 'function') {
          try { window.__rc27UpdateStepper({ currentPhase: curPhase, status, label, summary, scopeId: d.scopeId }); } catch(_) {}
        }
        if (status === 'active') {
          const phaseName = typeof window.__rc27PhaseLabel === 'function' ? (window.__rc27PhaseLabel(curPhase) || curPhase) : curPhase;
          toast(`🧭 RC27 · ${phaseName} · ${label || 'Em execução…'}`, 'ok');
        }
      } catch(e) { console.debug('[RC27 UI] orch:phase error', e); }
      break;
    }
    case 'orch:plan': {
      const d = msg.data || {};
      try {
        if (els.rc27Stepper && els.rc27Stepper.classList.contains('hidden')) els.rc27Stepper.classList.remove('hidden');
        if (d.goalText && els.rc27StepperGoal) els.rc27StepperGoal.textContent = String(d.goalText);
        if (typeof window.__rc27UpdateStepper === 'function') {
          try { window.__rc27UpdateStepper({ plan: d, summary: `Plano: ${d.numTasks || 0} tarefas · ${d.numPhases || 8} fases` }); } catch(_) {}
        }
        if (d.numTasks) {
          toast(`📋 RC27 · Plano definido: ${d.numTasks} tarefa(s) · Topológica ${d.hasCycle === true ? '⚠️ com ciclos mantidos' : '✓ sem ciclos'}`, 'ok');
        }
      } catch(e) { console.debug('[RC27 UI] orch:plan error', e); }
      break;
    }
    case 'orch:internet_authorization_requested': {
      const d = msg.data || {};
      try {
        if (!d.scopeId) { console.warn('[RC27] internet_auth sem scopeId', d); break; }
        els.rc27AuthCurrentScopeId = String(d.scopeId);
        if (els.rc27InternetScope) els.rc27InternetScope.textContent = `escopo: ${d.scopeId.slice(0,14)}…`;
        if (els.rc27InternetReason) els.rc27InternetReason.textContent = String(d.reason || 'O orquestrador precisa consultar fontes externas para tomar decisões técnicas e continuar.');
        if (els.rc27InternetUrls) {
          const urls = Array.isArray(d.urls) && d.urls.length ? d.urls : [];
          const docs = Array.isArray(d.documents) && d.documents.length ? d.documents : [];
          const all = [...urls, ...docs].slice(0, 20);
          if (!all.length) {
            els.rc27InternetUrls.textContent = 'Serão definidas durante a pesquisa.';
          } else {
            els.rc27InternetUrls.innerHTML = all.map(u => {
              try { const uu = new URL(u); const host = uu.hostname; return `<div class="truncate">↳ <span class="text-amber-300">${host}</span>${uu.pathname.length>1 ? uu.pathname : ''}</div>`; }
              catch(_) { return `<div class="truncate">↳ ${String(u).slice(0,160)}</div>`; }
            }).join('\n');
          }
        }
        if (els.rc27InternetModal) {
          els.rc27InternetModal.classList.remove('hidden');
          els.rc27InternetModal.classList.add('flex');
        }
        if (typeof window.__rc27UpdateStepper === 'function') {
          try { window.__rc27UpdateStepper({ summary: '⏸ Aguardando autorização internet…', phase: d.phase || 'PLANNING', overrideCurrentStatus: 'awaiting_input' }); } catch(_) {}
        }
        toast('🌐 Orquestrador pediu acesso à internet', 'warn');
      } catch(e) { console.debug('[RC27 UI] internet_auth error', e); }
      break;
    }
    case 'orch:human_intervention_needed': {
      const d = msg.data || {};
      try {
        if (els.rc27HumanReason) els.rc27HumanReason.textContent = String(d.reason || 'Intervenção necessária.');
        if (els.rc27HumanDetails) {
          const detailLines = [];
          if (d.details) detailLines.push(String(d.details));
          if (d.lastError) detailLines.push('Último erro: ' + String(d.lastError).slice(0,500));
          if (d.blockedBecause) detailLines.push('Motivo do bloqueio: ' + String(d.blockedBecause));
          els.rc27HumanDetails.textContent = detailLines.join('\n\n') || 'Sem detalhes adicionais.';
        }
        if (els.rc27HumanModal) {
          els.rc27HumanModal.classList.remove('hidden');
          els.rc27HumanModal.classList.add('flex');
        }
        if (typeof window.__rc27UpdateStepper === 'function') {
          try { window.__rc27UpdateStepper({ summary: '⛔ Bloqueado · necessita ação humana', phase: d.phase || 'CORRECTION', overrideCurrentStatus: 'blocked' }); } catch(_) {}
        }
        toast('🛑 Intervenção humana necessária (RC27)', 'err');
      } catch(e) { console.debug('[RC27 UI] human error', e); }
      break;
    }
    /* ===== END RC27 ===== */
    /* ===== END RC24 ===== */
    /* ===== ₿ BTC MARKET INTELLIGENCE ===== */
    case 'btc:update': {
      try {
        state.lastBtcReport = (msg.data && typeof msg.data === 'object') ? msg.data : null;
        if (els.editorPanels && els.editorPanels.dataset.active === 'btc') renderBtcDashboard();
        toast('₿ BTC · análise atualizada (score ' + (state.lastBtcReport?.score?.toFixed?.(0) ?? '?') + '/100 · cenário ' + (state.lastBtcReport?.scenario ?? '?') + ')', 'ok');
      } catch (e) { console.debug('[BTC UI] update error', e); }
      break;
    }
    case 'btc:alert': {
      try {
        const data = msg.data || {};
        toast('🚨 ₿ BTC Alerta · ' + String(data.message || '').slice(0, 160), 'warn');
      } catch {}
      break;
    }
    /* ===== END BTC ===== */
  }
}

/* ========== FILE TREE ========== */
let treeRefreshDebounce = null;
function debouncedRefreshTree() {
  clearTimeout(treeRefreshDebounce);
  treeRefreshDebounce = setTimeout(refreshFileTree, 400);
}

async function refreshFileTree() {
  try {
    const r = await fetch('/api/files?depth=4&project=' + encodeURIComponent(state.project || 'default'));
    const data = await r.json();
    if (data.ok) {
      state.currentTree = data.tree || [];
      const justMounted = !!state._justMounted;
      const forceExpandAll = justMounted || !!state.treeAllExpanded;
      const stats = { files: 0, dirs: 0, recent: 0 };
      countTreeStats(state.currentTree, stats);
      state._justMounted = false;
      renderFileTree(data.tree, els.fileTree, 0, {
        expandAll: forceExpandAll,
        maxExpandLevel: 3,
        _stats: stats,
      });
      if (justMounted) {
        const total = stats.files + stats.dirs;
        toast('📂 Pasta aberta! ' + (total === 0 ? 'Pasta vazia.' : stats.files + ' arquivo(s) · ' + stats.dirs + ' pasta(s) visíveis na lateral Explorer.') + (stats.recent > 0 ? ' (' + stats.recent + ' recente(s))' : ''), 'ok');
      }
    }
  } catch (e) {
    els.fileTree.innerHTML = `<div class="px-2 py-6 text-center text-slate-500 text-xs">Erro ao carregar arquivos.</div>`;
  }
}

function countTreeStats(list, out) {
  if (!list) return;
  for (const n of list) {
    if (!out) return;
    if (n.type === 'dir') { out.dirs = (out.dirs || 0) + 1; countTreeStats(n.children, out); }
    else { out.files = (out.files || 0) + 1; if (typeof n.mtimeMs === 'number' && Date.now() - n.mtimeMs < 60_000) out.recent = (out.recent || 0) + 1; }
  }
}

function fileExtIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    html: { label: 'HTML', cls: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
    htm:  { label: 'HTML', cls: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
    css:  { label: 'CSS',  cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
    js:   { label: 'JS',   cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
    mjs:  { label: 'JS',   cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
    cjs:  { label: 'JS',   cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
    jsx:  { label: 'JSX',  cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
    ts:   { label: 'TS',   cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
    tsx:  { label: 'TSX',  cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
    json: { label: '{ }',  cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    py:   { label: 'PY',   cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
    md:   { label: 'MD',   cls: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
    txt:  { label: 'TXT',  cls: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
    sh:   { label: 'SH',   cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    svg:  { label: 'SVG',  cls: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
    png:  { label: 'PNG',  cls: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30' },
    jpg:  { label: 'JPG',  cls: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30' },
    jpeg: { label: 'JPG',  cls: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30' },
    gif:  { label: 'GIF',  cls: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30' },
    ico:  { label: 'ICO',  cls: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30' },
    sql:  { label: 'SQL',  cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  };
  if (map[ext]) return map[ext];
  return { label: (ext || '•').slice(0,4).toUpperCase(), cls: 'bg-slate-500/20 text-slate-300 border-slate-500/30' };
}

function formatSize(b) {
  if (b == null) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  return (b/(1024*1024)).toFixed(1) + ' MB';
}

function renderFileTree(nodes, parentEl = els.fileTree, level = 0, opts = {}) {
  if (level === 0) {
    if (!nodes || nodes.length === 0) {
      els.fileTree.innerHTML = `<div class="px-2 py-6 text-center text-slate-500 text-xs">Pasta vazia</div>`;
      return;
    }
    els.fileTree.innerHTML = '';
  }
  const expandAll = !!opts.expandAll;
  const maxExpandLevel = typeof opts.maxExpandLevel === 'number' ? opts.maxExpandLevel : 3;
  const now = Date.now();
  for (const node of nodes) {
    const nodeEl = document.createElement('div');
    nodeEl.className = 'tree-node';
    nodeEl.dataset.path = node.path || '';
    nodeEl.dataset.type = node.type || 'file';

    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.path = node.path || '';
    row.dataset.type = node.type || 'file';
    if (node.type === 'file' && typeof node.mtimeMs === 'number' && now - node.mtimeMs < 60_000) {
      row.classList.add('recent');
    }

    const chev = document.createElement('span');
    chev.className = 'tree-chev';
    const hasChildren = node.type === 'dir' && Array.isArray(node.children) && node.children.length > 0;
    if (hasChildren) {
      chev.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"/></svg>`;
    } else {
      chev.classList.add('empty');
    }
    row.appendChild(chev);

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    if (node.type === 'dir') {
      icon.classList.add('folder');
      icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" opacity="0.9"/></svg>`;
    } else {
      const info = fileExtIcon(node.name);
      icon.classList.add('file-default');
      icon.innerHTML = `<span class="text-[9px] font-mono font-bold px-[3px] py-[1px] rounded border ${info.cls}">${info.label}</span>`;
    }
    row.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.name;
    label.title = node.path || node.name;
    row.appendChild(label);

    if (node.size != null && node.type === 'file') {
      const sz = document.createElement('span');
      sz.className = 'tree-size';
      sz.textContent = formatSize(node.size);
      row.appendChild(sz);
    }

    nodeEl.appendChild(row);

    if (node.type === 'dir') {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'tree-children';
      const forceOpen = expandAll && level < maxExpandLevel;
      childrenEl.style.display = (level === 0 || forceOpen) ? '' : 'none';
      if (hasChildren) chev.classList.toggle('open', level === 0 || forceOpen);

      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (hasChildren) {
          const open = childrenEl.style.display !== 'none';
          childrenEl.style.display = open ? 'none' : '';
          chev.classList.toggle('open', !open);
        }
      });

      if (hasChildren) {
        renderFileTree(node.children, childrenEl, level + 1, opts);
      }
      nodeEl.appendChild(childrenEl);
    } else {
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        $$('.tree-row.active', els.fileTree).forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        viewFileInCodeTab(node.path);
      });
      row.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        const n = node.name.toLowerCase();
        if (n === 'index.html' || n.endsWith('.html') || n.endsWith('.htm')) {
          openPreview(node.path);
        }
      });
    }
    parentEl.appendChild(nodeEl);
  }
}

/* ===================== EDITOR COL2 ABAS (NOVO — 5 abas: Code / Chat / Preview / Console / Terminal) ===================== */
function switchEditorPanel(name) {
  const n = String(name);
  let activeKey = n;
  if (n.startsWith('code:')) activeKey = 'code';
  // RC15: Chat removido do centro → se alguém tentar abrir chat, vai direto pro painel direito TiAi (toast + focus)
  if (activeKey === 'chat') {
    activeKey = 'code';
    els.traeAgentPanel?.classList.add('open');
    els.app?.classList.add('right-open');
    try { els.agentInput?.focus(); } catch {}
  }
  const allowed = ['code','preview','console','terminal','ia-config','btc'];
  if (allowed.includes(activeKey) || n.startsWith('code:')) {
    if (els.editorPanels) els.editorPanels.dataset.active = activeKey;
    if (activeKey === 'btc') _btcLoadStatusIfMissing();
  }
  // Sync aba visual ativa
  $$('.editor-tab', els.editorTabs || document).forEach(t => {
    const tt = t.dataset.editorTab || '';
    const cf = t.dataset.codeFile || '';
    let isActive = false;
    if (n.startsWith('code:')) isActive = (cf === n.slice(5));
    else if (n === 'preview')  isActive = tt === 'preview';
    else if (n === 'console')  isActive = tt === 'console';
    else if (n === 'terminal') isActive = tt === 'terminal';
    else if (n === 'ia-config') isActive = tt === 'ia-config';
    else if (n === 'btc') isActive = tt === 'btc';
    else                       isActive = tt === activeKey;
    t.classList.toggle('active', !!isActive);
  });
  // Sync label Code tab quando temos um arquivo aberto
  if (n.startsWith('code:') && els.codeTabLabel) {
    const fileName = String(n.slice(5)).split('/').pop() || 'Code';
    els.codeTabLabel.textContent = fileName.length > 14 ? fileName.slice(0,12)+'…' : fileName;
  }
}

state.openCodeTabs = state.openCodeTabs || [];  // array de paths abertos

function openCodeTab(filePath, content) {
  if (!filePath) return;
  const fileName = String(filePath).split('/').pop() || filePath;
  const info = fileExtIcon(fileName);
  // Verifica se já existe aba
  let tab = els.editorTabs ? els.editorTabs.querySelector(`.editor-tab[data-code-file="${escapeAttr(filePath)}"]`) : null;
  if (!tab && els.editorTabs) {
    tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'editor-tab flex items-center gap-1 h-full px-2 max-w-[160px] min-w-[80px] rounded-t-md text-[10.5px]';
    tab.dataset.codeFile = filePath;
    tab.innerHTML = `
      <span class="shrink-0 w-3 h-3 shrink-0 rounded-[2px] grid place-items-center text-[7.5px] font-mono border ${info.cls || 'bg-white/5 text-slate-400 border-white/10'}">${info.label || '  '}</span>
      <span class="truncate font-medium tab-name">${escapeHtml(fileName)}</span>
      <button type="button" class="tab-close ml-0.5" aria-label="Fechar aba" title="Fechar">✕</button>`;
    els.editorTabs.appendChild(tab);
    if (!state.openCodeTabs.includes(filePath)) state.openCodeTabs.push(filePath);
  }
  // Exibe conteúdo
  if (typeof content === 'string') {
    showCode(filePath, content, { skipSwitch: true });
  }
  switchEditorPanel('code:' + filePath);
  // Listeners
  if (tab && !tab.__listenersAttached) {
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) return;
      switchEditorPanel('code:' + filePath);
      // Se usuário clicou e arquivo ainda não está carregado em viewer, carrega
      if (els.codePath && els.codePath.textContent !== filePath) {
        viewFileInCodeTab(filePath);
      }
    });
    const closeBtn = tab.querySelector('.tab-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        tab.remove();
        state.openCodeTabs = (state.openCodeTabs || []).filter(p => p !== filePath);
        // Volta para chat se não houver mais abas code ativas
        const remainingCode = els.editorTabs ? els.editorTabs.querySelectorAll('.editor-tab[data-code-file]') : [];
        if (!remainingCode.length) {
          switchEditorPanel('chat');
          if (els.codeViewer) els.codeViewer.classList.add('hidden');
          if (els.codeEmpty) els.codeEmpty.classList.remove('hidden');
        } else {
          const last = remainingCode[remainingCode.length - 1];
          if (last && last.dataset.codeFile) switchEditorPanel('code:' + last.dataset.codeFile);
        }
      });
    }
    tab.__listenersAttached = true;
  }
}

/* ========== CODE TAB ========== */
async function viewFileInCodeTab(relPath) {
  if (!relPath) return;
  try {
    const r = await fetch('/api/files/read?path=' + encodeURIComponent(relPath) + '&project=' + encodeURIComponent(state.project || 'default'));
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'Erro');
    openCodeTab(relPath, data.content || '');
  } catch (e) {
    openCodeTab(relPath, `// Erro ao ler: ${e.message}`);
  }
}

function detectLanguage(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    html:'xml', htm:'xml', svg:'xml', js:'javascript', mjs:'javascript', cjs:'javascript',
    ts:'typescript', jsx:'javascript', tsx:'typescript', md:'markdown', sh:'bash',
    json:'json', css:'css', py:'python', yml:'yaml', yaml:'yaml', sql:'sql',
  };
  return map[ext] || 'plaintext';
}

function showCode(relPath, content, opts = {}) {
  els.codeEmpty.classList.add('hidden');
  els.codeViewer.classList.remove('hidden');
  const info = fileExtIcon(relPath.split('/').pop());
  els.codeIcon.className = `shrink-0 w-5 h-5 rounded-md grid place-items-center text-[10px] font-mono border ${info.cls}`;
  els.codeIcon.textContent = info.label;
  els.codePath.textContent = relPath;
  els.codeCode.textContent = content;
  els.codeCode.className = 'font-mono text-slate-200 whitespace-pre language-' + detectLanguage(relPath);
  try { if (window.hljs) hljs.highlightElement(els.codeCode); } catch(_) {}
  els.codeCopy.dataset.content = content;
  if (!opts.skipSwitch) switchEditorPanel('code:' + relPath);
}

els.codeCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(els.codeCopy.dataset.content || '');
    toast('Copiado para a área de transferência');
  } catch (_) {
    toast('Não foi possível copiar', 'err');
  }
});

/* ========== PREVIEW TAB ========== */
function joinPreviewKey(project, relPath) {
  if (relPath && typeof relPath === 'string' && relPath.includes('::')) {
    // Já vem com prefixo projeto
    return relPath;
  }
  return `${project || state.project || 'default'}::${(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '')}`;
}
function splitPreviewKey(key) {
  if (!key) return { project: state.project || 'default', path: '' };
  if (typeof key === 'string' && key.includes('::')) {
    const [p, ...rest] = key.split('::');
    return { project: p || state.project || 'default', path: rest.join('::') || '' };
  }
  return { project: state.project || 'default', path: (key || '').replace(/\\/g, '/').replace(/^\/+/, '') };
}
function previewBaseUrlFor(projectName) {
  if (projectName && state.projects && state.projects.length) {
    const p = state.projects.find(x => x.name === projectName);
    if (p && p.previewUrl) {
      let base = p.previewUrl;
      if (!base.endsWith('/')) base += '/';
      const isLocalhost = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(base);
      const weAreRemote =
        location.hostname !== '127.0.0.1' &&
        location.hostname !== 'localhost';
      if (isLocalhost && weAreRemote) {
        base = `${location.origin}/preview/${encodeURIComponent(projectName || state.project || 'default')}/`;
      } else if (base.startsWith('/preview/')) {
        base = `${location.origin}${base}`;
      }
      return base;
    }
  }
  const weAreRemote =
    location.hostname !== '127.0.0.1' && location.hostname !== 'localhost';
  if (weAreRemote) {
    return `${location.origin}/preview/${encodeURIComponent(projectName || state.project || 'default')}/`;
  }
  return null;
}
function openPreview(relOrKey, opts) {
  const { project, path: relPath } = splitPreviewKey(relOrKey);
  if (!relPath) return;
  const safe = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const base = previewBaseUrlFor(project);
  let url, fullUrl;
  if (base) {
    url = base + safe;
    fullUrl = url;
  } else {
    url = `/workspace/${encodeURIComponent(project)}/${safe}`;
    fullUrl = location.origin + url;
  }
  if (!/^https?:\/\//i.test(url)) url = location.origin + url;
  if (!/^https?:\/\//i.test(fullUrl)) fullUrl = location.origin + fullUrl;
  els.previewEmpty.classList.add('hidden');
  els.previewIframe.classList.remove('hidden');
  els.previewUrlBar.classList.remove('hidden');
  els.previewUrl.textContent = fullUrl;
  els.previewOpen.href = fullUrl;
  state.currentPreviewPath = joinPreviewKey(project, relPath);
  state.currentPreviewProject = project;
  const sep = url.includes('?') ? '&' : '?';
  els.previewIframe.src = url + sep + 't=' + (opts?.t || Date.now());
}

els.previewRefresh.addEventListener('click', () => {
  if (state.currentPreviewPath) openPreview(state.currentPreviewPath, { t: Date.now() });
});

function findIndexHtml(tree, prefix = '') {
  if (!tree) return null;
  for (const n of tree) {
    const full = prefix ? `${prefix}/${n.name}` : n.name;
    if (n.type === 'file' && n.name.toLowerCase() === 'index.html') return full;
    if (n.type === 'dir' && n.children) {
      const f = findIndexHtml(n.children, full);
      if (f) return f;
    }
  }
  return null;
}

/* ========== TABS ========== */
function switchTab(name) {
  state.activeTab = name;
  $$('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  $$('.tab-panel').forEach(p => {
    p.classList.toggle('hidden', p.dataset.tabPanel !== name);
  });
}

$$('.tab-btn').forEach(b => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});

/* ========== HANDLE FILE CHANGES ========== */
function handleFileChanged(data) {
  if (data.action === 'created' || data.action === 'updated') {
    const dataProj = data.project || state.project || 'default';
    const name = (data.path.split('/').pop() || '').toLowerCase();
    const curPrev = splitPreviewKey(state.currentPreviewPath);
    if (name === 'index.html' && !state.currentPreviewPath && dataProj === state.project) {
      setTimeout(() => {
        const p = findIndexHtml(state.currentTree);
        if (p) openPreview(joinPreviewKey(state.project, p));
      }, 250);
    } else if (
      state.currentPreviewPath &&
      curPrev.project === dataProj &&
      curPrev.path === data.path
    ) {
      setTimeout(() => openPreview(joinPreviewKey(dataProj, data.path)), 250);
    }
  }
}

/* ========== AVA... render de msgs ========== */
function autoResize() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 180) + 'px';
  els.charCount.textContent = els.input.value.length.toLocaleString('pt-BR');
}
function autoResizeTrae() {
  els.traeMessageInput.style.height = 'auto';
  els.traeMessageInput.style.height = Math.min(els.traeMessageInput.scrollHeight, 160) + 'px';
  els.charCount.textContent = els.traeMessageInput.value.length.toLocaleString('pt-BR');
}
els.input.addEventListener('input', autoResize);
if (els.traeMessageInput) els.traeMessageInput.addEventListener('input', autoResizeTrae);

function addAvatar(role) {
  const wrap = document.createElement('div');
  wrap.className = 'w-8 h-8 shrink-0 rounded-xl grid place-items-center text-white';
  if (role === 'user') {
    wrap.classList.add('bg-slate-600');
    wrap.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>`;
  } else {
    wrap.classList.add('bg-gradient-to-br', 'from-brand-500', 'to-brand-700');
    wrap.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2"><path d="M12 2L15 8l6 .9-4.5 4.4 1 6.2L12 17l-5.5 2.5 1-6.2L3 8.9 9 8z"/></svg>`;
  }
  return wrap;
}

function ensureWelcomeHidden() {
  if (!els.welcome.classList.contains('hidden')) return;
  els.welcome.classList.add('hidden');
}
function hideWelcome() { els.welcome.classList.add('hidden'); }

/* UNIFY_CONV: carrega mensagens do conversation_memory.jsonl do backend e
   preenche UI via addUserMessage / addAIMessage. Só executa se a lista de
   mensagens estiver vazia (evita duplicar após refresh parcial da UI). */
async function restoreUIConversationFromDisk(projectSlug, force=false) {
  if (!projectSlug) return;
  if (!force && els.messagesList && els.messagesList.children.length > 0) return;
  try {
    const url = '/api/agent/'+encodeURIComponent(projectSlug)+'/conversation/resume?n=200';
    const r = await fetch(url, { method: 'POST' });
    const d = await r.json().catch(()=>({}));
    if (!d || !d.ok || !Array.isArray(d.lines) || d.lines.length === 0) return;
    // SÓ restaurar se UI realmente estiver vazia ou force=true
    if (!force && els.messagesList && els.messagesList.children.length > 0) return;
    let order = 0;
    for (const l of d.lines) {
      if (!l || typeof l !== 'object') continue;
      const role = String(l.role || '').toLowerCase();
      const text = typeof l.text === 'string' ? l.text : '';
      if (!text.trim()) continue;
      order++;
      const ts = typeof l.ts === 'number' ? l.ts : (Date.now() - (d.lines.length - order));
      if (role === 'user') {
        addUserMessage({ id: 'ru_' + ts + '_' + order, text, _restored: true });
      } else if (role === 'assistant' || role === 'model' || role === 'ai') {
        addAIMessage({ id: 'ra_' + ts + '_' + order, text, _restored: true }, false);
      }
    }
    finalizeCurrentAIMessage();
    scrollBottom();
    if (typeof console !== 'undefined') console.log('[UNIFY_CONV] UI restauradas', order, 'mensagens do projeto', projectSlug);
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[UNIFY_CONV] restore UI falhou (ignorado):', e);
  }
}

function startThinking() {
  els.typing.classList.remove('hidden');
  scrollBottom();
}
function stopThinking() {
  els.typing.classList.add('hidden');
  scrollBottom();
}

let scrollRaf = null;
function scrollBottom() {
  cancelAnimationFrame(scrollRaf);
  scrollRaf = requestAnimationFrame(() => {
    if (els.messages) els.messages.scrollTop = els.messages.scrollHeight;
    const trae = document.getElementById('trae-scroll');
    if (trae) trae.scrollTop = trae.scrollHeight;
  });
}

function renderMarkdown(raw, opts = {}) {
  const html = marked.parse(raw || '', opts);
  const tpl = document.createElement('template');
  tpl.innerHTML = `<div class="md-content">${html}</div>`;
  const root = tpl.content.firstElementChild;
  const pres = $$('pre', root);
  for (const pre of pres) {
    const code = pre.querySelector('code');
    if (code) {
      try { if (window.hljs) hljs.highlightElement(code); } catch (_) {}
    }
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copiar';
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent);
        const old = btn.textContent;
        btn.textContent = 'Copiado ✓';
        setTimeout(() => btn.textContent = old, 1400);
      } catch (_) {}
    });
    pre.appendChild(btn);
  }
  return root;
}

function addUserMessage(data) {
  hideWelcome();
  const wrap = document.createElement('div');
  wrap.className = 'msg-user flex gap-3 justify-end animate-slide-up';
  wrap.dataset.id = data.id;
  // UNIFY_CONV: mensagem restaurada do disco → classe leve para diferenciar visualmente
  if (data._restored) wrap.style.opacity = '0.92';

  const bubbleCol = document.createElement('div');
  bubbleCol.className = 'max-w-[85%] md:max-w-[80%]';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble px-3.5 py-2.5 text-sm';

  const images = (data.parts || []).filter(p => p.image);
  const texts = (data.parts || []).filter(p => typeof p.text === 'string' && !String(p.text).startsWith('[Imagem'));

  if (images.length) {
    const g = document.createElement('div');
    g.className = 'msg-images mb-2';
    for (const img of images) {
      const el = document.createElement('img');
      el.src = img.image.url;
      el.alt = img.image.filename;
      el.addEventListener('click', () => openLightbox(img.image.url));
      g.appendChild(el);
    }
    bubble.appendChild(g);
  }
  const textContent = texts.map(p => p.text).join('\n').trim();
  if (textContent) {
    const txt = document.createElement('div');
    txt.className = 'whitespace-pre-wrap leading-relaxed';
    txt.textContent = textContent;
    bubble.appendChild(txt);
  }
  bubbleCol.appendChild(bubble);

  wrap.appendChild(bubbleCol);
  wrap.appendChild(addAvatar('user'));
  els.messagesList.appendChild(wrap);
  scrollBottom();
  ensureChatTitleFromFirstMessage();
  renderHistory();
}

function ensureAIMessageWrap(msgId) {
  let wrap = els.messagesList.querySelector(`[data-id="${msgId}"]`);
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'msg-ai flex gap-3 animate-slide-up';
    wrap.dataset.id = msgId;
    const col = document.createElement('div');
    col.className = 'max-w-[90%] flex-1';
    col.dataset.role = 'col';
    wrap.appendChild(addAvatar('ai'));
    wrap.appendChild(col);
    els.messagesList.appendChild(wrap);
  }
  return wrap;
}

function addAIMessage(data, replace = false) {
  hideWelcome();
  finalizeCurrentAIMessage();
  state.currentAiMsgId = data.id;
  state.currentAiText = data.text || '';
  // UNIFY_CONV: flag restored = mensagem recuperada do conversation_memory (não atual streaming)
  const isRestored = !!data._restored;

  const wrap = ensureAIMessageWrap(data.id);
  wrap.dataset.restored = isRestored ? '1' : '0';
  if (isRestored) wrap.style.opacity = '0.92';
  const col = wrap.querySelector('[data-role="col"]');

  if (data.text && data.text.trim()) {
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble px-3.5 py-2.5 text-sm msg-bubble-final';
    bubble.appendChild(renderMarkdown(data.text));
    col.appendChild(bubble);
  }
  state.currentAiMsgEl = null;
  scrollBottom();
  ensureChatTitleFromFirstMessage();
  renderHistory();
}

function updateAIMessageDelta(data) {
  hideWelcome();
  const { id, text, done, usage } = data;

  if (usage) {
    const tt = (usage.totalTokenCount || 0);
    if (tt) {
      state.totalTokens = tt;
      els.statsLine.textContent = 'Tokens: ' + tt.toLocaleString('pt-BR');
    }
  }

  if (!text || !text.length) return;

  state.currentAiMsgId = id;
  state.currentAiText = text;

  // RC22.4 Voice Conversation: envia delta incremental para o agente de voz capturar parcial
  try { if (typeof window.__ti_voice_emitDelta === 'function') window.__ti_voice_emitDelta(text, !!done, usage); } catch {}

  let bubble = state.currentAiMsgEl;
  if (!bubble || bubble.closest('#messages-list') == null) {
    const wrap = ensureAIMessageWrap(id);
    const col = wrap.querySelector('[data-role="col"]');
    bubble = document.createElement('div');
    bubble.className = 'msg-bubble px-3.5 py-2.5 text-sm msg-stream';
    const md = document.createElement('div');
    md.className = 'md-content-render';
    bubble.appendChild(md);
    col.appendChild(bubble);
    state.currentAiMsgEl = bubble;
  }
  const md = bubble.querySelector('.md-content-render');
  if (md) {
    const rendered = renderMarkdown(text);
    md.replaceWith(rendered);
    rendered.classList.add('md-content-render');
    // Add caret
    if (!done) {
      const caret = document.createElement('span');
      caret.className = 'caret';
      rendered.appendChild(caret);
    }
  }
  scrollBottom();
}

function finalizeCurrentAIMessage() {
  const bubble = state.currentAiMsgEl;
  if (!bubble) { state.currentAiMsgEl = null; return; }
  bubble.classList.remove('msg-stream');
  bubble.classList.add('msg-bubble-final');
  const caret = bubble.querySelector('.caret');
  if (caret) caret.remove();
  state.currentAiMsgEl = null;
}

function addStepBar(step, max) {
  const bar = document.createElement('div');
  bar.className = 'step-bar mb-1 mt-1';
  bar.innerHTML = `<span class="chip">Passo ${step}/${max}</span><span>Agente executando…</span>`;
  els.messagesList.appendChild(bar);
  scrollBottom();
}

function ensureAwaitConfirm(step, calls) {
  let wrap = document.getElementById('await-confirm-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'await-confirm-wrap';
    wrap.className = 'my-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 animate-slide-up';
  }
  const callRows = calls.map(c => {
    const argStr = JSON.stringify(c.args || {}).replace(/[\n\r]/g, ' ').slice(0, 180);
    return `<li class="flex items-start gap-2 text-xs">
      <span class="mt-0.5 inline-flex w-5 h-5 shrink-0 items-center justify-center rounded-md bg-surface-soft border border-surface-border ${toolColor(c.name)}">${toolSVG(c.name)}</span>
      <div class="min-w-0 flex-1">
        <div class="text-white font-semibold leading-tight">${escapeHtml(c.name)}</div>
        <code class="text-slate-400 text-[11px] font-mono break-words leading-tight">${escapeHtml(argStr)}</code>
      </div>
    </li>`;
  }).join('');
  wrap.innerHTML = `
    <div class="flex items-center gap-2 mb-2">
      <div class="w-6 h-6 shrink-0 rounded-full bg-amber-500/20 text-amber-300 grid place-items-center border border-amber-500/30">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-white text-sm font-semibold">Confirmação necessária — Passo ${escapeHtml(String(step))}</div>
        <div class="text-amber-300/80 text-[11px]">Modo interativo: o agente está aguardando sua aprovação para executar a(s) ação(ões) abaixo.</div>
      </div>
    </div>
    <ol class="space-y-2 my-3 pl-1">${callRows}</ol>
    <div class="flex flex-wrap items-center gap-2 pt-1">
      <button type="button" id="confirm-run" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition active:scale-95 inline-flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        Executar
      </button>
      <button type="button" id="confirm-stop" class="px-3 py-1.5 rounded-lg bg-rose-600/15 hover:bg-rose-600/25 text-rose-300 border border-rose-500/25 text-xs font-semibold transition">
        Cancelar tarefa
      </button>
      <button type="button" id="confirm-solo" class="ml-auto px-3 py-1.5 rounded-lg bg-surface-soft hover:bg-white/5 text-slate-300 border border-surface-border text-xs font-semibold transition inline-flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg>
        Ativar modo SOLO (não pedir mais confirmação)
      </button>
    </div>
  `;
  const runBtn = wrap.querySelector('#confirm-run');
  const stopBtn = wrap.querySelector('#confirm-stop');
  const soloBtn = wrap.querySelector('#confirm-solo');
  runBtn.onclick = () => { wrap.remove(); sendWS({ type: 'agent:confirm' }); };
  stopBtn.onclick = () => { wrap.remove(); els.stopBtn.click(); };
  soloBtn.onclick = () => {
    state.mode = 'solo';
    applyModeUI();
    saveState();
    sendConfig();
    toast('Modo Solo ativado — aguardando confirmação atual para alternar');
    wrap.remove();
    sendWS({ type: 'agent:confirm' });
  };
  return wrap;
}

/* ========== TOOL CARDS (RC15 Accordion Profissional) ========== */
function toolCategory(name) {
  if (name === 'write_file') return 'write';
  if (name === 'read_file' || name === 'list_dir') return 'read';
  if (name === 'run_command') return 'run';
  if (name === 'delete_file') return 'del';
  return '';
}
function toolColor(name) {
  if (name === 'read_file') return 'text-sky-400';
  if (name === 'write_file') return 'text-indigo-400';
  if (name === 'delete_file') return 'text-rose-400';
  if (name === 'run_command') return 'text-emerald-400';
  if (name === 'list_dir') return 'text-indigo-400';
  return 'text-slate-400';
}

function toolSVG(name) {
  if (name === 'read_file') return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>';
  if (name === 'write_file') return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/></svg>';
  if (name === 'delete_file') return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M10 11v6M14 11v6M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
  if (name === 'run_command') return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l6-6-6-6M12 19h8"/></svg>';
  if (name === 'list_dir') return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg>';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
function escapeAttr(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function summarizeArgs(data) {
  const a = data.args || {};
  if (data.name === 'write_file') {
    const size = typeof a.content === 'string' ? a.content.length : 0;
    return `${a.path || ''} · ${size.toLocaleString('pt-BR')} chars`;
  }
  if (data.name === 'read_file') return a.path || '';
  if (data.name === 'delete_file') return a.path || '';
  if (data.name === 'run_command') return (a.command || '').slice(0, 160);
  if (data.name === 'list_dir') return (a.path || '.') + ` · depth ${a.depth || 2}`;
  try { return JSON.stringify(a).slice(0, 120); } catch { return ''; }
}

function toolSummary(name, args, result) {
  if (name === 'write_file') {
    if (result?.ok) {
      const link = result.url ? ` · <a href="${result.url}" target="_blank" rel="noopener" class="tool-link">abrir</a>` : '';
      return `✅ Arquivo <b>${escapeHtml(args.path || '-')}</b> ${result.action || 'salvo'} · ${(result.size||0).toLocaleString('pt-BR')} bytes${link}`;
    }
    return `❌ Falha ao salvar <b>${escapeHtml(args.path || '-')}</b>: ${escapeHtml(result?.error || '')}`;
  }
  if (name === 'read_file') {
    if (result?.ok) return `✅ Arquivo lido · <b>${escapeHtml(args.path)}</b> · ${(result.size||0).toLocaleString('pt-BR')} bytes`;
    return `❌ Falha ao ler <b>${escapeHtml(args.path || '-')}</b>: ${escapeHtml(result?.error || '')}`;
  }
  if (name === 'delete_file') {
    if (result?.ok) return `✅ Removido · <b>${escapeHtml(args.path)}</b>`;
    return `❌ Falha ao remover <b>${escapeHtml(args.path || '-')}</b>: ${escapeHtml(result?.error || '')}`;
  }
  if (name === 'list_dir') {
    if (result?.ok) {
      const items = (result.tree || []).length;
      return `✅ Listado · <b>${escapeHtml(result.root || '.')}</b> · ${items} itens`;
    }
    return `❌ Falha ao listar: ${escapeHtml(result?.error || '')}`;
  }
  if (name === 'run_command') {
    if (result?.ok) {
      const stdout = (result.stdout || '').trim();
      const stderr = (result.stderr || '').trim();
      return `✅ Comando executado · exit 0${stdout ? '<br><span class="opacity-80">stdout:</span> ' + escapeHtml(stdout.slice(0, 240)) : ''}${stderr ? '<br><span class="opacity-80">stderr:</span> ' + escapeHtml(stderr.slice(0, 160)) : ''}`;
    }
    return `❌ Falha no comando · ${escapeHtml(result?.error || '')}`;
  }
  try { return escapeHtml(JSON.stringify(result).slice(0, 200)); } catch { return ''; }
}

function formatDetails(data) {
  const r = data.result || {};
  if (data.name === 'write_file') {
    if (!r.ok) return r.error || JSON.stringify(r);
    return (r.content != null) ? '' : JSON.stringify(r, null, 2);
  }
  if (data.name === 'read_file') {
    if (!r.ok) return r.error || JSON.stringify(r);
    return (r.content || '').slice(0, 6000);
  }
  if (data.name === 'run_command') {
    if (!r.ok) {
      return [r.error && 'ERROR: ' + r.error, r.stdout && 'STDOUT:\n' + r.stdout, r.stderr && 'STDERR:\n' + r.stderr].filter(Boolean).join('\n\n');
    }
    return [r.stdout && 'STDOUT:\n' + r.stdout, r.stderr && 'STDERR:\n' + r.stderr].filter(Boolean).join('\n\n') || '(sem saída)';
  }
  if (data.name === 'list_dir') {
    try { return JSON.stringify(r.tree || [], null, 2); } catch { return ''; }
  }
  try { return JSON.stringify(r, null, 2); } catch { return ''; }
}

function lastAIMessageColumn() {
  const msgs = $$('.msg-ai', els.messagesList);
  if (!msgs.length) {
    const fakeId = 'ai_pre_' + Date.now();
    const wrap = ensureAIMessageWrap(fakeId);
    return wrap.querySelector('[data-role="col"]');
  }
  const last = msgs[msgs.length - 1];
  return last.querySelector('[data-role="col"]');
}

function addToolCard(data) {
  hideWelcome();
  finalizeCurrentAIMessage();
  state.currentToolCards.set(data.id, data);
  const col = lastAIMessageColumn();
  const card = document.createElement('div');
  // RC15: Accordion (aberto por padrão para ferramentas running, colapsado em done via updateToolCard)
  card.className = 'tool-card animate-fade-in';
  card.dataset.toolId = data.id;

  const cat = toolCategory(data.name);
  const header = document.createElement('div');
  header.className = 'tool-card-header';
  header.innerHTML = `
    <svg class="tool-accordion-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="9 18 15 12 9 6"/></svg>
    <span class="${toolColor(data.name)} flex items-center">${toolSVG(data.name)}</span>
    <span class="tool-name ${cat}">${escapeHtml(data.name)}</span>
    <span class="tool-args" title="${escapeHtml(JSON.stringify(data.args||{}))}">${escapeHtml(summarizeArgs(data))}</span>
    <span class="tool-status-pending"></span>
  `;
  // RC15: Clique no header → toggle colapsar
  header.addEventListener('click', (e) => {
    // Não colapsar se usuário clicar em link/saída do sumário
    if (e.target.closest('a, .tool-toggle')) return;
    card.classList.toggle('collapsed');
  });

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'tool-card-body-wrap';
  bodyWrap.innerHTML = `<div class="tool-summary">Executando…</div>`;

  card.appendChild(header);
  card.appendChild(bodyWrap);
  col.appendChild(card);
  scrollBottom();
}

function updateToolCard(data) {
  const card = els.messagesList.querySelector(`[data-tool-id="${data.id}"]`);
  if (!card) return;
  state.currentToolCards.set(data.id, data);

  const header = card.querySelector('.tool-card-header');
  const statusEl = header.querySelector('.tool-status-pending, .tool-status-ok, .tool-status-err');
  if (statusEl) {
    statusEl.outerHTML = data.ok
      ? `<span class="tool-status-ok"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span>`
      : `<span class="tool-status-err"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6L6 18M6 6l12 12"/></svg></span>`;
  }
  card.classList.toggle('has-ok', !!data.ok);
  card.classList.toggle('has-err', !data.ok);
  // RC15: Após finalizado (ok/err), padrão COLAPSADO para ficar organizado (usuário abre se quiser ver detalhe)
  if (data.ok === true) card.classList.add('collapsed');

  const bodyWrap = card.querySelector('.tool-card-body-wrap');
  if (!bodyWrap) return;
  const summary = toolSummary(data.name, data.args, data.result);
  const details = formatDetails(data);

  const toggleId = 'tog_' + (data.id || Math.random().toString(36).slice(2));
  bodyWrap.innerHTML = `
    <div class="tool-summary">${summary}</div>
    ${details ? `<span id="${toggleId}" class="tool-toggle">Mostrar detalhes <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></span>
    <div id="d_${toggleId}" class="tool-details mt-2" style="display:none">${escapeHtml(details)}</div>` : ''}
  `;
  const tog = document.getElementById(toggleId);
  if (tog) {
    tog.addEventListener('click', () => {
      const d = document.getElementById('d_' + toggleId);
      if (!d) return;
      if (d.style.display === 'none') {
        d.style.display = '';
        tog.innerHTML = 'Ocultar detalhes <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>';
      } else {
        d.style.display = 'none';
        tog.innerHTML = 'Mostrar detalhes <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';
      }
    });
  }
  // Auto-open preview-like notification for write_file
  if (data.ok && data.name === 'write_file' && /index\.html?$/i.test(data.args?.path)) {
    const proj = data.project || state.project || 'default';
    openPreview(joinPreviewKey(proj, data.args.path));
    if (proj === (state.project || 'default') && state.activeTab !== 'preview') {
      switchTab('preview');
    }
  }
  scrollBottom();
}

/* ========== ATTACHMENTS ========== */
els.fileInput.addEventListener('change', async (e) => {
  for (const file of Array.from(e.target.files || [])) {
    await addAttachment(file);
  }
  els.fileInput.value = '';
});

async function addAttachment(file) {
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'upload falhou');
    state.pendingImages.push({
      filename: j.filename,
      originalname: j.originalname,
      url: j.url,
      size: j.size,
    });
    renderAttachments();
  } catch (e) {
    toast('Erro no upload: ' + e.message, 'err');
  }
}

function renderAttachments() {
  if (!state.pendingImages.length) {
    els.attachments.classList.add('hidden');
    els.attachments.innerHTML = '';
    return;
  }
  els.attachments.classList.remove('hidden');
  els.attachments.innerHTML = state.pendingImages.map((img, i) => `
    <span class="attach-chip" data-i="${i}">
      <img src="${img.url}" alt="${escapeHtml(img.originalname)}">
      <span>${escapeHtml(img.originalname)}</span>
      <button type="button" data-remove="${i}" title="Remover">✕</button>
    </span>
  `).join('');
  $$('[data-remove]', els.attachments).forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.remove);
      state.pendingImages.splice(i, 1);
      renderAttachments();
    });
  });
}

/* ========== SUBMIT ========== */
els.form.addEventListener('submit', (e) => { e.preventDefault(); doSubmit({ source: 'chat' }); });
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    els.form.requestSubmit();
  }
});

async function doSubmit(opts = {}) {
  let text = '';
  let images = [];
  if (opts.source === 'trae' && els.traeMessageInput) {
    text = els.traeMessageInput.value.trim();
    images = state.pendingImages.slice();
  } else {
    text = els.input.value.trim();
    images = state.pendingImages.slice();
  }
  if (!text && !images.length) return;
  if (!state.connected) return;

  // === GUARDRAIL UX RC8: feedback CLARO do PROJETO ATUAL antes de enviar ===
  const curProj = state.project || DEFAULT_PROJECT_NAME;
  const curMounted = projectIsMounted(curProj);
  const existMounted = hasMountedProjects();
  const firstMounted = findFirstMountedProject();

  if (!curMounted && existMounted && firstMounted) {
    // Usuário está em projeto WORKSPACE/DEFAULT mas tem PROJETO MONTADO disponível!
    // Avisa fortemente (não bloqueia, só chama atenção)
    const previewText = text.length > 42 ? text.slice(0, 42) + '…' : text;
    toast(`⚠️ Enviando para projeto WORKSPACE "${curProj}" — você tem "${firstMounted.name}" 🗂️ montado! Clique no botão projeto ⚠️ acima para trocar antes de enviar, se quiser. Prompt: "${previewText}"`, 'warn');
  } else if (curMounted) {
    // Tudo ok: projeto montado. Aviso verde curto para confirmar
    const previewText = text.length > 36 ? text.slice(0, 36) + '…' : text;
    toast(`✅ Enviando p/ ${curProj} 🗂️ Montada: "${previewText}"`, 'ok');
  } else {
    // Default sem nenhum montado, aviso neutro
    const previewText = text.length > 36 ? text.slice(0, 36) + '…' : text;
    toast(`▶️ Enviando p/ ${curProj}: "${previewText}"`, 'ok');
  }

  // 1. SE já houver execução em andamento: ABORTA anterior primeiro
  if (state.busy || state.agentState === 'running' || state.agentState === 'paused') {
    sendWS({ type: 'agent:stop' });
    // Espera um tick para o backend processar agent:stop e resetar STATE_RUNNING
    state.busy = false;
    state.agentState = 'idle';
    setAgentState('idle', { reason: 'new_submit_abort_old' });
    finalizeCurrentAIMessage();
    await new Promise(r => setTimeout(r, 250));
  }

  // 2. Reseta ESTADO COMPLETO do plano / steps / TRAE painel — evita DUPLICADO e passos 1/50 antigos
  state.plan = [];
  state.planDone = 0;
  state.planTotal = 0;
  state.stepCurrent = 0;
  state.stepMax = 0;
  setProgress(0, 0);
  renderPlanList();
  renderTraeChecklist();
  if (els.traeThoughtBody) els.traeThoughtBody.textContent = 'Planejando próximos passos…';
  if (els.traeThoughtSummary) els.traeThoughtSummary.textContent = 'Planejando…';
  if (els.traeRunningTool) els.traeRunningTool.classList.add('hidden');

  state.busy = true;
  els.sendBtn.disabled = true;
  if (els.traePlayBtn) els.traePlayBtn.disabled = true;

  state.pendingImages = [];
  renderAttachments();

  if (els.input) { els.input.value = ''; autoResize(); }
  if (els.traeMessageInput) {
    els.traeMessageInput.value = '';
    els.traeMessageInput.style.height = 'auto';
  }

  els.stepInfo.classList.remove('hidden');
  els.stepInfo.textContent = 'Enviando…';
  startThinking();

  // ============================================================================
  // RC24 SLASH COMMANDS (client-side local, chama REST endpoints de agente)
  //   /build, /audit, /estado <rascunho|construindo|testando|pronto>, /empresa
  //   /memoria limpar, /resumo, /tools, /versao
  // Regra: se o projeto NÃO começar com agent__ → avisa e envia como chat normal.
  // ============================================================================
  const projSlash = state.project || DEFAULT_PROJECT_NAME;
  const isAgentProj = /^agent__/.test(String(projSlash || ''));
  if (text && text.startsWith('/') && text.length > 1) {
    const slashParts = text.trim().split(/\s+/);
    const cmd = (slashParts[0] || '').toLowerCase();
    const args = slashParts.slice(1).join(' ').trim();
    const slashHandled = await (async () => {
      if (!isAgentProj && !['/ajuda','/help','/?'].includes(cmd)) {
        toast('ℹ️ Slash commands RC24 só funcionam em projetos "agent__…" (crie agente via POST /api/agent/create). Enviando como mensagem normal…', 'warn');
        return false;
      }
      try {
        if (cmd === '/build') {
          toast('🧭 /build: acionando build via RC22…', 'ok');
          addUserMessage({ id: 'u_' + Date.now(), text: text });
          const r = await fetch('/api/agent/' + encodeURIComponent(projSlash) + '/build', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ reason: 'slash build ' + (args||'') }) });
          const d = await r.json().catch(()=>({ok:false}));
          addAIMessage({ id: 'slash_build_' + Date.now(), text: r.ok && d.ok ? `🧭 **Build** agendado via RC22.\n· Estado atual: **${d.currentState}**\n· Arquivos planejados: **${(d.forcedPlan?.files||[]).length}**\n· Seções: **${(d.forcedPlan?.sections||[]).length}**\n\n_Para executar o build RC22 real: envie uma mensagem qualquer no chat (ex: "próximo passo") — a pipeline 3-IA vai rodar com plano forçado do agent.json._` : `❌ Falhou: ${JSON.stringify(d)}` }, false);
          stopThinking(); state.busy=false; els.sendBtn.disabled=false;
          finalizeCurrentAIMessage(); setAgentState('idle',{reason:'slash_command_handled'}); sendWS({type:'agent:done',reason:'slash_handled'});
          scrollBottom();
          return true;
        }
        if (cmd === '/audit' || cmd === '/auditar') {
          toast('🧭 /audit: chamando Security :3400 + whitelist SEC-HC-*…', 'ok');
          addUserMessage({ id: 'u_' + Date.now(), text: text });
          const r = await fetch('/api/agent/' + encodeURIComponent(projSlash) + '/audit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({}) });
          const d = await r.json().catch(()=>({ok:false}));
          const sec = d.security || {};
          const ap = d.applyResult || { ok:false, toApply:[], toManual:[] };
          addAIMessage({ id: 'slash_audit_' + Date.now(), text: r.ok && d.ok
            ? `🧭 **Auditoria Security** concluída.\n` +
              `· Status: **${sec.ok ? 'conectou OK' : (sec.error || 'erro').slice(0,140)}**\n` +
              `· Findings: **${(sec.findings||[]).length || 0}** · Críticos=${sec.counts?.critico ?? 0} Altos=${sec.counts?.alto ?? 0} Médios=${sec.counts?.medio ?? 0}\n` +
              `· Whitelist apply: **${ap.toApply?.length||0} SEC-HC-* aplicáveis** · **${ap.toManual?.length||0} exigem aprovação manual**\n` +
              `· Backup pré-audit: ${d.backup ? '✅ gravado' : '—'}${ap.whitelistRule ? '\n> _' + ap.whitelistRule + '_' : ''}`
            : `❌ Falhou: ${JSON.stringify(d)}` }, false);
          stopThinking(); state.busy=false; els.sendBtn.disabled=false;
          finalizeCurrentAIMessage(); setAgentState('idle',{reason:'slash_command_handled'});
          scrollBottom();
          return true;
        }
        if (cmd === '/estado' || cmd === '/state') {
          const target = (args || '').toLowerCase().trim();
          if (!target) {
            addUserMessage({ id:'u_'+Date.now(), text });
            const s = await fetch('/api/agent/'+encodeURIComponent(projSlash)+'/state').then(x=>x.json()).catch(()=>({}));
            addAIMessage({ id:'slash_estado_get_'+Date.now(), text:`🧭 **Estado atual RC24**: **${s.state?.currentState || 'n/a'}**\n\n_Histórico (ultimas 8):_\n` + ((s.state?.stateHistory||[]).slice(-8).map(t=>`· ${new Date(t.ts).toLocaleString('pt-BR')} · ${t.from||'—'} → **${t.to||'—'}${t.reason?' · '+String(t.reason).slice(0,80):''}${t.by?' · by='+t.by:''}`).join('\n') || '_n/d_') }, false);
            stopThinking(); state.busy=false; els.sendBtn.disabled=false; finalizeCurrentAIMessage(); setAgentState('idle',{reason:'slash'}); scrollBottom();
            return true;
          }
          if (!['rascunho','construindo','testando','pronto'].includes(target)) {
            addAIMessage({id:'slash_err_'+Date.now(),text:'❌ /estado: valores válidos: `rascunho`, `construindo`, `testando`, `pronto`.'},false);
            stopThinking(); state.busy=false; els.sendBtn.disabled=false; finalizeCurrentAIMessage(); setAgentState('stopped',{reason:'slash_erro'}); scrollBottom();
            return true;
          }
          addUserMessage({id:'u_'+Date.now(),text});
          const r = await fetch('/api/agent/'+encodeURIComponent(projSlash)+'/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({estado:target,flags:'--i-know-risk'})});
          const d = await r.json().catch(()=>({}));
          addAIMessage({id:'slash_estado_'+Date.now(),text: r.ok && d.ok ? `🧭 Estado alterado para **${d.newState||target}**` : `❌ ${r.status} — ${d.error || JSON.stringify(d)}` }, false);
          stopThinking(); state.busy=false; els.sendBtn.disabled=false; finalizeCurrentAIMessage(); setAgentState('idle',{reason:'slash_estado'}); scrollBottom();
          return true;
        }
        if (cmd === '/empresa' || cmd === '/agente' || cmd === '/ag') {
          addUserMessage({id:'u_'+Date.now(),text});
          const [spec,state,vers,caps] = await Promise.all([
            fetch('/api/agent/'+encodeURIComponent(projSlash)).then(x=>x.json()).catch(()=>({})),
            fetch('/api/agent/'+encodeURIComponent(projSlash)+'/state').then(x=>x.json().catch(()=>({}))),
            fetch('/api/agent/'+encodeURIComponent(projSlash)+'/versions').then(x=>x.json().catch(()=>({}))),
            fetch('/api/agent/'+encodeURIComponent(projSlash)+'/capabilities').then(x=>x.json().catch(()=>({}))),
          ]);
          const em = (n)=> (spec.company && spec.company[n]) ? `· ${n==='name'?'Empresa':'Segmento'}: ${spec.company[n]}\n` : '';
          addAIMessage({id:'slash_ag_'+Date.now(),text:
            `🏢 **Agente RC24** · Projeto: \`${projSlash}\`\n`+
            em('name') +
            (spec.company?.segmento?`· Segmento: ${spec.company.segmento}\n`:'') +
            `· Nome agente: ${spec.metadata?.agentName||'n/a'} · Versão spec: v${spec.version||'?'}\n` +
            `· Estado atual: **${state.state?.currentState || 'n/d'}**\n` +
            `· Versões disponíveis: ${(vers.versions||[]).join(', ') || 'n/d'}\n` +
            `· Capacidades (${Object.keys(caps.capabilitiesAgent||{}).length}): ` +
            Object.values(caps.capabilitiesAgent||{}).map(c=>`${c.type}(${c.status})`).join(' · ') || 'n/d'
          },false);
          stopThinking(); state.busy=false; els.sendBtn.disabled=false; finalizeCurrentAIMessage(); setAgentState('idle',{reason:'slash_agente'}); scrollBottom();
          return true;
        }
        if (cmd === '/memoria') {
          const arg = (args||'').toLowerCase();
          addUserMessage({id:'u_'+Date.now(),text});
          if (arg === 'limpar' || arg === 'clear') {
            const r = await fetch('/api/agent/'+encodeURIComponent(projSlash)+'/conversation/clear',{method:'POST'});
            const d = await r.json().catch(()=>({}));
            addAIMessage({id:'sl_mem_'+Date.now(), text: r.ok && d.ok ? `🧹 **Memória de conversa limpa.** Backup salvo em: \`${d.backupFile||'(nenhum)'}\`\n\n⚠️ **Aviso**: memória de conversa (conversation_memory.jsonl) != estado do agente (agent_state.json). O estado do agente NÃO foi limpo — specs, versões e histórico de builds/QA/Security continuam preservados.` : `❌ ${JSON.stringify(d)}` }, false);
          } else {
            const r = await fetch('/api/agent/'+encodeURIComponent(projSlash)+'/conversation/resume?n=15');
            const d = await r.json().catch(()=>({}));
            addAIMessage({id:'sl_mem_'+Date.now(),text:`💾 **Memória de conversa** (últimas ${d.count||0} linhas)\n> _Memória ↔ Estado estão em arquivos separados: NÃO há mistura entre texto de chat e currentState._\n\n` + (d.lines||[]).map(l => `· [${(l.role||'?').toUpperCase()}] ${String(l.text||'').slice(0,140)}`).join('\n') || '_sem mensagens_' }, false);
          }
          stopThinking(); state.busy=false; els.sendBtn.disabled=false; finalizeCurrentAIMessage(); setAgentState('idle',{reason:'slash_mem'}); scrollBottom();
          return true;
        }
        if (cmd === '/resumo' || cmd === '/sumario') {
          addUserMessage({id:'u_'+Date.now(),text});
          const spec = await fetch('/api/agent/'+encodeURIComponent(projSlash)).then(x=>x.json()).catch(()=>({}));
          addAIMessage({id:'sl_res_'+Date.now(),text:
            `📋 **Resumo RC24 do Agente**\n` +
            `· **Problema**: ${(spec.requirements?.problem||'n/d').slice(0,240)}\n` +
            `· **Requisitos Funcionais** (${(spec.requirements?.functional||[]).length}):\n  - ` + (spec.requirements?.functional||['—']).slice(0,6).map(x=>String(x).slice(0,80)).join('\n  - ') + `\n` +
            `· **Regras de Negócio** (${(spec.requirements?.businessRules||[]).length}): ` + (spec.requirements?.businessRules||['—']).slice(0,3).map(x=>String(x).slice(0,70)).join(' · ') + `\n` +
            `· **Integrações**: ${(spec.integrations||[]).map(i => i.type).join(', ') || 'nenhuma'}\n` +
            `· **Tools** (${(spec.tools||[]).length}): ` + (spec.tools||[]).slice(0,8).map(t=>t.name).join(', ') || 'nenhuma'
          }, false);
          stopThinking(); state.busy=false; els.sendBtn.disabled=false; finalizeCurrentAIMessage(); setAgentState('idle',{reason:'slash_resumo'}); scrollBottom();
          return true;
        }
        if (cmd === '/tools' || cmd === '/ferramentas' || cmd === '/capabilities') {
          addUserMessage({id:'u_'+Date.now(),text});
          const d = await fetch('/api/agent/'+encodeURIComponent(projSlash)+'/capabilities').then(x=>x.json()).catch(()=>({}));
          const arr = Object.values(d.capabilitiesAgent||{});
          addAIMessage({id:'sl_tools_'+Date.now(),text:
            `🛠️ **Capacidades / Tools / Integrações RC24** (${arr.length})\n\n` +
            arr.map(c => `· **${c.type}** — status: \`${c.status}\`${c.description?` · ${c.description.slice(0,100)}`:''}${c.missingEnvVars&&c.missingEnvVars.length?`\n    ⚠️ missing env vars: \`${c.missingEnvVars.join(', ')}\``:''}${c.optionalEnvVars&&c.optionalEnvVars.length?`\n    (opcionais: ${c.optionalEnvVars.join(', ')})`:''}`).join('\n') || '_n/d_' +
            `\n\n> _Apenas ferramentas reais existentes no catálogo: WhatsApp Evolux, Google Calendar, SMTP E-mail, CRM REST genérico, Webhook custom (não inventamos integrações)._`
          }, false);
          stopThinking(); state.busy=false; els.sendBtn.disabled=false; finalizeCurrentAIMessage(); setAgentState('idle',{reason:'slash_tools'}); scrollBottom();
          return true;
        }
        if (cmd === '/versao' || cmd === '/version' || cmd === '/versões' || cmd === '/versions') {
          addUserMessage({id:'u_'+Date.now(),text});
          const [l,cmp] = await Promise.all([
            fetch('/api/agent/'+encodeURIComponent(projSlash)+'/versions').then(x=>x.json()).catch(()=>({})),
            (async()=>{ try { const list = await fetch('/api/agent/'+encodeURIComponent(projSlash)+'/versions').then(x=>x.json()); if ((list.versions||[]).length >= 2) { const a = list.versions[list.versions.length-2]; const b = list.versions[list.versions.length-1]; const r = await fetch('/api/agent/'+encodeURIComponent(projSlash)+'/versions/compare?a='+a+'&b='+b).then(x=>x.json()); return {a,b,changed:r.changed||[]}; } return null; } catch(_){ return null; } })()
          ]);
          addAIMessage({id:'sl_ver_'+Date.now(),text:
            `🧬 **Versões semânticas do agent.json** (${(l.versions||[]).length}): ` + (l.versions||[]).join(', ') +
            (cmp?`\n\n🔀 Diff **v${cmp.a} → v${cmp.b}** (${cmp.changed.length} campos):\n  - ` + cmp.changed.slice(0,20).map(x=>String(x).slice(0,80)).join('\n  - ') : '')
          }, false);
          stopThinking(); state.busy=false; els.sendBtn.disabled=false; finalizeCurrentAIMessage(); setAgentState('idle',{reason:'slash_version'}); scrollBottom();
          return true;
        }
        if (cmd === '/corrige' || cmd === '/corrigir' || cmd === '/arruma' || cmd === '/conserta' || cmd === '/autofix' || cmd === '/fix') {
          toast('🛠️ /corrige: disparando loop de correção QA real (até 3 iterações com backup)…', 'ok');
          addUserMessage({ id: 'u_' + Date.now(), text: text });
          startThinking();
          const r = await fetch('/api/agent/' + encodeURIComponent(projSlash) + '/qa/autofix', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ maxIter: 3 }) });
          const d = await r.json().catch(()=>({ok:false}));
          stopThinking();
          addAIMessage({ id: 'slash_corrige_' + Date.now(), text: r.ok && d.ok
            ? (d.resumo || '✅ Loop concluído.')
            : `❌ ${d.error || JSON.stringify(d)}` }, false);
          state.busy=false; els.sendBtn.disabled=false; finalizeCurrentAIMessage(); setAgentState('idle',{reason:'slash_corrige'}); sendWS({type:'agent:done',reason:'slash_corrige_handled'});
          scrollBottom();
          return true;
        }
        if (cmd === '/help' || cmd === '/ajuda' || cmd === '/?') {
          addAIMessage({id:'sl_help_'+Date.now(),text:
            `📘 **Slash Commands RC24 Agente Orquestrador**\n` +
            `  \`/build\`                 — agenda build via RC22 (plano forçado do agent.json)\n` +
            `  \`/corrige\`               — 🔥 loop de correção QA real (backup + dev fix + re-QA)\n` +
            `  \`/audit\`                 — auditar via Security :3400 + whitelist SEC-HC-* apenas\n` +
            `  \`/estado [v]\`            — ver estado OU transitar: rascunho / construindo / testando / pronto\n` +
            `  \`/agente\`                — info geral do agente (empresa, estado, versões, capabilities)\n` +
            `  \`/memoria [limpar]\`      — ver últimas 15 linhas OU limpar memória (NÃO toca estado)\n` +
            `  \`/resumo\`                — resumo estruturado da spec do agente\n` +
            `  \`/tools\`                 — lista capacidades/ferramentas + status e missing env vars\n` +
            `  \`/versao\`                — lista versões semânticas + diff últimas duas\n` +
            `  \`/help\`                  — esta ajuda\n\n` +
            `_💡 Dica: sem barra também funciona! Basta digitar **"corrige"** no chat._\n` +
            (isAgentProj ? `_ℹ️ Projeto atual **é agente RC24** (\`${projSlash}\`)._` : `_⚠️ Projeto atual **NÃO é agente RC24** (não prefixo agent__). Crie primeiro com POST /api/agent/create._`)
          },false);
          stopThinking(); state.busy=false; els.sendBtn.disabled=false; finalizeCurrentAIMessage(); setAgentState('idle',{reason:'slash_help'}); scrollBottom();
          return true;
        }
      } catch (e) {
        addAIMessage({id:'slash_err_'+Date.now(),text:'❌ Slash command erro: ' + (e && e.message || String(e))},false);
        stopThinking(); state.busy=false; els.sendBtn.disabled=false; finalizeCurrentAIMessage(); setAgentState('stopped',{reason:'slash_falhou'}); scrollBottom();
        return true;
      }
      // Unknown slash command em projeto agent__ → avisa:
      if (isAgentProj) {
        toast(`Slash command desconhecido "${cmd}" — use /help para listar os válidos.`, 'warn');
      }
      return false;  // cai no chat:send normal
    })();
    if (slashHandled) {
      // Limpa imagens pendentes e input (doSubmit já fez no começo) e NÃO envia WS:
      return;
    }
  }

  sendWS({ type: 'chat:send', text, images });
}

/* ========== SOLO MODE CONTROLS ========== */
if (els.soloToggle) {
  els.soloToggle.addEventListener('click', () => {
    state.mode = state.mode === 'solo' ? 'interactive' : 'solo';
    applyModeUI();
    saveState();
    sendConfig();
    toast('Modo ' + (state.mode === 'solo' ? 'Solo (autônomo)' : 'Interativo (confirme cada passo)'));
  });
}
if (els.modelSelect) {
  els.modelSelect.addEventListener('change', () => {
    state.model = els.modelSelect.value;
    els.modelName.textContent = 'Modelo: ' + state.model;
    saveState();
    sendConfig();
    toast('Modelo alterado para: ' + state.model);
  });
}
if (els.ensembleToggle) {
  els.ensembleToggle.addEventListener('click', () => {
    if (!state.ensembleAvailable) {
      toast('⚠️ Mude FREE_ENSEMBLE_MODE=parallel no .env para ativar o Ensemble 2x Gemini (GRATUITO)', 'warn');
      return;
    }
    sendWS({ type: 'ensemble:toggle' });
  });
}
if (els.pauseBtn) {
  els.pauseBtn.addEventListener('click', () => {
    sendWS({ type: 'agent:pause' });
    toast('Pausando…');
  });
}
if (els.resumeBtn) {
  els.resumeBtn.addEventListener('click', () => {
    sendWS({ type: 'agent:resume' });
    toast('Retomando…');
  });
}
els.stopBtn.addEventListener('click', () => {
  sendWS({ type: 'agent:stop' });
  addAIMessage({ id: 'stop_' + Date.now(), text: '⚠️ Execução interrompida pelo usuário.' }, false);
  state.busy = false;
  setAgentState('stopped', { reason: 'user_stop' });
  els.sendBtn.disabled = false;
  stopThinking();
  els.stepInfo.classList.add('hidden');
  finalizeCurrentAIMessage();
});

/* ========== PROJECT MODE CONTROLS (TRAE seletor de pasta) ========== */
if (els.projectBtn) {
  els.projectBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleProjectDropdown();
  });
}
// Click fora do dropdown fecha
document.addEventListener('click', (e) => {
  if (!els.projectDropdown || els.projectDropdown.classList.contains('hidden')) return;
  // Janela de 120ms após abrir via botão: evita fechar imediatamente por causa de race no click-outside
  if (window.__projectJustOpenedAt && (Date.now() - window.__projectJustOpenedAt) < 120) return;
  const insideDrop = els.projectDropdown.contains(e.target);
  const insideBtn = els.projectBtn?.contains(e.target);
  if (!insideDrop && !insideBtn) {
    toggleProjectDropdown(false);
  }
});
// Click dentro do dropdown: não fecha ao clicar em inputs / itens
if (els.projectDropdown) {
  els.projectDropdown.addEventListener('mousedown', (e) => e.stopPropagation());
}
if (els.newProjectCreate) {
  els.newProjectCreate.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    createProject(els.newProjectInput?.value || '');
  });
}
if (els.newProjectInput) {
  els.newProjectInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      createProject(els.newProjectInput.value || '');
    }
  });
  els.newProjectInput.addEventListener('mousedown', (e) => e.stopPropagation());
  els.newProjectInput.addEventListener('click', (e) => e.stopPropagation());
}

async function importFolderFromMac() {
  if (!confirm('Isso abrirá o Finder do macOS para você selecionar uma pasta (Desktop, Downloads, etc).\n\nOs arquivos do site serão criados diretamente dentro da pasta escolhida, e o preview vai rodar em uma porta HTTP separada.\n\nContinuar?')) return;
  toggleProjectDropdown(false);
  state._justMounted = true;
  toast('📂 Abrindo Finder… Selecione a pasta do projeto', 'ok');
  try {
    const r1 = await fetch('/api/picker/folder', { cache: 'no-store' });
    const d1 = await r1.json();
    if (!d1 || !d1.ok) {
      state._justMounted = false;
      if (d1 && d1.canceled) {
        toast('Seleção cancelada', 'ok');
        return;
      }
      throw new Error(d1?.error || 'Erro ao abrir selecionador');
    }
    const baseName = (p) => String(p || '').replace(/\/+$/, '').split('/').pop() || String(p || '');
    toast('✅ Pasta selecionada: ' + (d1.displayName || baseName(d1.folderPath)) + '\nMontando projeto e carregando arquivos…', 'ok');
    const r2 = await fetch('/api/projects/mount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: d1.folderPath, displayName: d1.displayName || null }),
    });
    const d2 = await r2.json();
    if (!d2 || !d2.ok) { state._justMounted = false; throw new Error(d2?.error || 'Erro ao montar projeto'); }
    if (d2.projects && Array.isArray(d2.projects)) state.projects = d2.projects;
    renderProjectList();
    const portMsg = d2.port ? '· Preview HTTP porta ' + d2.port : '';
    const fallbackWarn = d2.warn ? ' · ⚠️ ' + d2.warn : '';
    toast('✅ Projeto montado ' + portMsg + fallbackWarn, 'ok');
    switchProject(d2.project);
  } catch (e) {
    state._justMounted = false;
    toast(e.message || 'Erro', 'err');
  }
}
if (els.mountFolderBtn) {
  els.mountFolderBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  els.mountFolderBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    importFolderFromMac();
  });
}
if (els.expandTreeBtn) {
  els.expandTreeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  els.expandTreeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    state.treeAllExpanded = !state.treeAllExpanded;
    if (els.expandTreeBtn) {
      els.expandTreeBtn.title = state.treeAllExpanded ? 'Recolher toda a árvore (exceto raiz)' : 'Expandir toda a árvore (até 3 níveis)';
    }
    toast(state.treeAllExpanded ? '🌳 Árvore expandida (3 níveis)' : '📁 Árvore recolhida (só raiz)');
    renderFileTree(state.currentTree || [], els.fileTree, 0, {
      expandAll: state.treeAllExpanded,
      maxExpandLevel: 3,
    });
  });
}

/* ========== HISTORY ========== */
function currentChatSummary() {
  const first = $('.msg-user .msg-bubble', els.messagesList);
  if (!first) return null;
  const t = first.textContent.trim().slice(0, 42);
  return t || null;
}

function renderHistory() {
  // #history NÃO EXISTE no layout 3-colunas novo (foi removido da sidebar para ficar limpo igual TRAE foto)
  if (!els.history) return;
  const title = els.chatTitle?.textContent?.trim() || 'Nova conversa';
  if (state.sessionId && title !== 'Nova conversa' && !state.chats.has(state.sessionId)) {
    state.chats.set(state.sessionId, { id: state.sessionId, title, ts: Date.now() });
    saveState();
  } else if (state.sessionId && title !== 'Nova conversa') {
    const existing = state.chats.get(state.sessionId);
    if (existing && existing.title !== title) {
      existing.title = title;
      existing.ts = Date.now();
      saveState();
    }
  }
  if (state.chats.size === 0) {
    els.history.innerHTML = '<div class="text-slate-500 text-xs px-3 py-8 text-center">Nenhuma conversa ainda.</div>';
    return;
  }
  els.history.innerHTML = [...state.chats.values()]
    .sort((a,b) => b.ts - a.ts)
    .map(c => `
    <div class="history-item ${c.id === state.sessionId ? 'active' : ''}" data-sid="${c.id}">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span class="hi-title">${escapeHtml(c.title)}</span>
    </div>
  `).join('');
  $$('.history-item', els.history).forEach(el => {
    el.addEventListener('click', () => {
      const sid = el.dataset.sid;
      const c = state.chats.get(sid);
      if (c && els.chatTitle) els.chatTitle.textContent = c.title;
      if (els.messagesList) els.messagesList.innerHTML = '';
      els.welcome?.classList.remove('hidden');
      state.currentAiMsgId = null;
      state.currentAiMsgEl = null;
      state.currentToolCards.clear();
      sendWS({ type: 'session:resume', sessionId: sid, project: state.project || DEFAULT_PROJECT_NAME });
      if (window.innerWidth < 1024) closeLeftMobile?.();
    });
  });
}

if (els.newChatBtn) {
els.newChatBtn.addEventListener('click', () => {
  const t = currentChatSummary();
  if (t && state.sessionId) {
    state.chats.set(state.sessionId, { id: state.sessionId, title: t, ts: Date.now() });
    saveState();
  }
  state.pendingImages = [];
  renderAttachments();
  if (els.messagesList) els.messagesList.innerHTML = '';
  els.welcome?.classList.remove('hidden');
  state.currentAiMsgId = null;
  state.currentAiMsgEl = null;
  state.currentAiText = '';
  state.currentToolCards.clear();
  if (els.chatTitle) els.chatTitle.textContent = 'Nova conversa';
  els.stepInfo?.classList.add('hidden');
  sendWS({ type: 'session:new' });
  renderHistory();
  if (window.innerWidth < 1024) closeLeftMobile?.();
});
}

if (els.clearBtn) els.clearBtn.addEventListener('click', () => {
  if (!confirm('Limpar mensagens desta conversa?')) return;
  if (els.messagesList) els.messagesList.innerHTML = '';
  els.welcome?.classList.remove('hidden');
  sendWS({ type: 'session:clear' });
});

/* ========== TITLE FROM FIRST MSG ========== */
if (els.messagesList && els.chatTitle) {
  const titleObs = new MutationObserver(() => {
    if (els.chatTitle.textContent === 'Nova conversa') {
      const first = $('.msg-user .msg-bubble', els.messagesList);
      if (first) {
        const t = first.textContent.trim().slice(0, 42);
        if (t) {
          els.chatTitle.textContent = t;
          renderHistory();
        }
      }
    }
  });
  titleObs.observe(els.messagesList, { childList: true, subtree: true, characterData: true });
}

function ensureChatTitleFromFirstMessage() { /* handled by MutationObserver */ }

/* ========== EXAMPLE CARDS ========== */
$$('.example').forEach(el => {
  el.addEventListener('click', () => {
    const prompts = {
      '🚀': 'Crie uma landing page responsiva em HTML ÚNICO com Tailwind CSS (via CDN) para uma clínica odontológica "Sorriso Perfeito". Inclua header com navegação, hero com CTA, seção de serviços, depoimentos, formulário de contato, mapa, e footer. Salve como index.html. DEPOIS de criar, liste os arquivos com list_dir e abra o preview automaticamente.',
      '⚡': 'Crie uma API REST CRUD em Node.js + Express + SQLite para gerenciar usuários (nome, email, senha). Crie package.json, server.js com todas as rotas, middleware de erros e README. Instale as dependências e teste com curl (criar, listar, ler por id, atualizar, deletar).',
      '🎮': 'Crie um jogo da velha em Python com interface no terminal. Dois jogadores, validação de jogadas inválidas, detecção de vitória/empate. Salve como jogo_da_velha.py e depois execute para testar (você pode usar entrada simulada via echo "1\n2\n..." ).',
      '📱': 'Crie um app Todo List com React + Vite em uma pasta "todo-app": adicionar tarefa, marcar como feita, remover, filtro "todas/ativas/concluídas", persistência localStorage, estilo moderno com Tailwind. Instale dependências e RODE O BUILD para validar.',
    };
    const key = el.textContent.trim().charAt(0);
    const text = prompts[key];
    if (!text) return;
    if (els.input) els.input.value = text;
    autoResize?.();
    setTimeout(() => els.form?.requestSubmit(), 0);
  });
});

/* ========== PANELS / RESPONSIVE RC15 — Explorer SEMPRE VISÍVEL default ========== */
// Forçar remover classes de collapse/ocultar left-panel que venham de CSS antigo / cache
if (els.leftPanel) {
  els.leftPanel.classList.remove('collapsed', 'hidden');
  state.leftCollapsed = false;
}
if (els.toggleLeft && els.leftPanel) {
  els.toggleLeft.addEventListener('click', () => {
    // RC15: Telas >= 820px → toggle só .collapsed (width 0); telas <820px → toggle .open mobile
    const w = window.innerWidth;
    if (w < 820) {
      const isOpen = els.leftPanel.classList.contains('open');
      els.leftPanel.classList.toggle('open', !isOpen);
      els.app?.classList.toggle('left-open', !isOpen);
      state.leftCollapsed = isOpen;
    } else {
      state.leftCollapsed = !state.leftCollapsed;
      els.leftPanel.classList.toggle('collapsed', state.leftCollapsed);
    }
    saveState();
  });
}
if (els.openLeft && els.leftPanel) {
  els.openLeft.addEventListener('click', () => {
    els.leftPanel.classList.add('open', 'mobile-open');
    els.app?.classList.add('left-open');
  });
}
function closeLeftMobile() {
  els.leftPanel?.classList.remove('open', 'mobile-open');
  els.app?.classList.remove('left-open');
}
if (els.app) {
  els.app.addEventListener('click', (ev) => {
    if (ev.target === els.app) {
      closeLeftMobile();
      // Layout 3-colunas NOVO não usa mais #right-panel visibilidade manual → safe skip
      if (els.rightPanel) els.rightPanel.classList.remove('visible');
      els.app.classList.remove('right-open');
    }
  });
}
// Os listeners abaixo são do layout 4-colunas ANTIGO (usavam #right-panel que não existe mais).
// Layout NOVO já tem handlers próprios em hookNewLayoutButtons() acima.
if (els.toggleRight && els.rightPanel) {
  els.toggleRight.addEventListener('click', () => {
    els.rightPanel.classList.add('visible');
    els.app.classList.add('right-open');
  });
}
if (els.closeRight && els.rightPanel) {
  els.closeRight.addEventListener('click', () => {
    els.rightPanel.classList.remove('visible');
    els.app.classList.remove('right-open');
  });
}

/* ========== RC17 ↔️ PANEL RESIZERS — arrastar barras ajusta largura painéis (tipo VSCode) ========== */
function initPanelResizers() {
  const LEFT_DEFAULT = 280;
  const RIGHT_DEFAULT = 360;
  const STORAGE_KEY = 'tia.panelWidths.v1';

  const leftPanel = els.leftPanel;
  const rightPanel = els.traeAgentPanel;
  const leftResizer = document.getElementById('left-resizer');
  const rightResizer = document.getElementById('right-resizer');

  // 1) Aplicar larguras salvas ou default (só para desktop, não fixed mobile)
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (typeof saved.left === 'number' && saved.left >= 200 && saved.left <= 480 && leftPanel && window.innerWidth >= 820) {
      leftPanel.style.flexBasis = saved.left + 'px';
      leftPanel.style.width = saved.left + 'px';
    }
    if (typeof saved.right === 'number' && saved.right >= 280 && saved.right <= 560 && rightPanel && window.innerWidth >= 1080) {
      rightPanel.style.flexBasis = saved.right + 'px';
      rightPanel.style.width = saved.right + 'px';
    }
  } catch (_) {}

  function saveWidths() {
    try {
      const lp = leftPanel?.getBoundingClientRect?.()?.width;
      const rp = rightPanel?.getBoundingClientRect?.()?.width;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        left: lp ? Math.round(lp) : null,
        right: rp ? Math.round(rp) : null
      }));
    } catch (_) {}
  }

  // Resizer ESQUERDO (aumenta/diminui Explorer)
  if (leftResizer && leftPanel) {
    let dragging = false;
    let startX = 0;
    let startW = 0;
    const onMove = (e) => {
      if (!dragging) return;
      const dx = (e.clientX || e.touches?.[0]?.clientX || 0) - startX;
      let newW = Math.min(480, Math.max(200, startW + dx));
      if (window.innerWidth >= 1536 && newW < 260) newW = 260; // 2xl não deixa menor
      leftPanel.style.flexBasis = newW + 'px';
      leftPanel.style.width = newW + 'px';
      // Se left-panel tiver collapsed (RC15), desliga.
      leftPanel.classList.remove('collapsed');
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      leftResizer.classList.remove('panel-dragging');
      document.body.classList.remove('panel-resize-active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove, { passive:false });
      document.removeEventListener('touchend', onUp);
      saveWidths();
    };
    leftResizer.addEventListener('mousedown', (e) => {
      if (window.innerWidth < 820) return; // mobile não usa resizer
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startW = leftPanel.getBoundingClientRect().width;
      leftResizer.classList.add('panel-dragging');
      document.body.classList.add('panel-resize-active');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    leftResizer.addEventListener('touchstart', (e) => {
      if (window.innerWidth < 820) return;
      const t = e.touches[0]; if (!t) return;
      dragging = true; startX = t.clientX;
      startW = leftPanel.getBoundingClientRect().width;
      leftResizer.classList.add('panel-dragging');
      document.body.classList.add('panel-resize-active');
    }, { passive:true });
    leftResizer.addEventListener('dblclick', () => {
      // Double click = RESET (largura padrão)
      leftPanel.style.flexBasis = (window.innerWidth >= 1536 ? 300 : LEFT_DEFAULT) + 'px';
      leftPanel.style.width = (window.innerWidth >= 1536 ? 300 : LEFT_DEFAULT) + 'px';
      leftPanel.classList.remove('collapsed');
      saveWidths();
      toast('↔️ Explorer resetado para ' + (window.innerWidth >= 1536 ? 300 : LEFT_DEFAULT) + 'px', 'ok');
    });
  }

  // Resizer DIREITO (aumenta/diminui TiAi Agente)
  if (rightResizer && rightPanel) {
    let dragging = false;
    let startX = 0;
    let startW = 0;
    const onMove = (e) => {
      if (!dragging) return;
      const dx = startX - (e.clientX || e.touches?.[0]?.clientX || 0);
      let newW = Math.min(560, Math.max(280, startW + dx));
      if (window.innerWidth >= 1536 && newW < 340) newW = 340;
      rightPanel.style.flexBasis = newW + 'px';
      rightPanel.style.width = newW + 'px';
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      rightResizer.classList.remove('panel-dragging');
      document.body.classList.remove('panel-resize-active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove, { passive:false });
      document.removeEventListener('touchend', onUp);
      saveWidths();
    };
    rightResizer.addEventListener('mousedown', (e) => {
      if (window.innerWidth < 1080) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startW = rightPanel.getBoundingClientRect().width;
      rightResizer.classList.add('panel-dragging');
      document.body.classList.add('panel-resize-active');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    rightResizer.addEventListener('touchstart', (e) => {
      if (window.innerWidth < 1080) return;
      const t = e.touches[0]; if (!t) return;
      dragging = true; startX = t.clientX;
      startW = rightPanel.getBoundingClientRect().width;
      rightResizer.classList.add('panel-dragging');
      document.body.classList.add('panel-resize-active');
    }, { passive:true });
    rightResizer.addEventListener('dblclick', () => {
      rightPanel.style.flexBasis = (window.innerWidth >= 1536 ? 380 : RIGHT_DEFAULT) + 'px';
      rightPanel.style.width = (window.innerWidth >= 1536 ? 380 : RIGHT_DEFAULT) + 'px';
      saveWidths();
      toast('↔️ TiAi resetado para ' + (window.innerWidth >= 1536 ? 380 : RIGHT_DEFAULT) + 'px', 'ok');
    });
  }

  // Window resize: garante mínimos (evita "tela esmagada" em proporções inválidas)
  window.addEventListener('resize', () => {
    const minCenter = 260;
    const total = window.innerWidth;
    const lw = leftPanel?.getBoundingClientRect?.()?.width || 0;
    const rw = rightPanel?.getBoundingClientRect?.()?.width || 0;
    // Se centro ficou menor que mínimo, encolhe os painéis extremos
    if (lw && rw && total && (total - lw - rw) < minCenter) {
      const extra = minCenter - (total - lw - rw);
      if (lw > 220 && extra > 0) {
        const redL = Math.min(lw - 220, Math.ceil(extra/2));
        leftPanel.style.width = (lw - redL) + 'px';
        leftPanel.style.flexBasis = (lw - redL) + 'px';
      }
    }
    saveWidths();
  }, { passive:true });
}

/* ========== REFRESH TREE BTN ========== */
if (els.refreshTreeBtn) {
els.refreshTreeBtn.addEventListener('click', () => {
  refreshFileTree();
  toast('Explorer atualizado');
});
}

/* ========== LIGHTBOX ========== */
if (els.lightboxClose) {
els.lightboxClose.addEventListener('click', () => {
  els.lightbox?.classList.remove('open');
  if (els.lightbox) els.lightbox.style.display = 'none';
});
}
if (els.lightbox) {
els.lightbox.addEventListener('click', (e) => { if (e.target === els.lightbox) { els.lightbox.classList.remove('open'); els.lightbox.style.display = 'none'; } });
els.lightbox.style.display = 'none';
}
function openLightbox(src) {
  if (!els.lightbox || !els.lightboxImg) return;
  els.lightboxImg.src = src;
  els.lightbox.classList.add('open');
  els.lightbox.style.display = 'flex';
  requestAnimationFrame(() => { if (!els.lightbox.classList.contains('open')) els.lightbox.classList.add('open'); });
}
if (els.lightboxClose && !els.lightboxClose.__lb2att) {
  els.lightboxClose.addEventListener('click', () => { if (els.lightbox) els.lightbox.style.display = 'none'; });
  els.lightboxClose.__lb2att = true;
}

/* ============================
   NEW 4-COL UI LISTENERS & HOOKS
   ============================ */

/* Sync chat title <-> tab title */
(function hookChatTitleSync(){
  const syncBoth = () => {
    const t = els.chatTitle?.textContent?.trim() || 'Nova conversa';
    if (els.chatTitleTab) els.chatTitleTab.textContent = t;
  };
  try {
    const obs = new MutationObserver(syncBoth);
    if (els.chatTitle) obs.observe(els.chatTitle, { childList: true, characterData: true, subtree: true });
  } catch(_) {}
  syncBoth();
})();

/* Editor default panels (NOVO RC15: 4 ABAS SÓ — Chat removido do centro. Interação IA no painel direito) */
(function initEditorPanels(){
  // Aba inicial padrão = 'code' (se não tiver nenhum definido). Se o HTML veio com data-active, respeita.
  if (els.editorPanels && !els.editorPanels.dataset.active) {
    els.editorPanels.dataset.active = 'code';
  }
  // RC15: Se ainda veio dataset.active="chat" (migração) → força code
  if (els.editorPanels && els.editorPanels.dataset.active === 'chat') {
    els.editorPanels.dataset.active = 'code';
  }
  // Garante que a aba visual correta esteja .active na inicialização
  const initKey = els.editorPanels?.dataset.active || 'code';
  $$('.editor-tab', els.editorTabs || document).forEach(t => {
    const tt = t.dataset.editorTab || '';
    if (initKey === tt) t.classList.add('active');
    else if (!t.dataset.codeFile) t.classList.remove('active');
  });
  // Listeners das 4 abas fixas (Chat removido do centro — foi pro painel direito TiAi)
  const specials = ['preview','console','terminal','code','ia-config','btc'];
  specials.forEach(key => {
    const tab = els.editorTabs?.querySelector(`[data-editor-tab="${key}"]`);
    if (tab && !tab.__attSp) {
      tab.addEventListener('click', () => switchEditorPanel(key));
      tab.__attSp = true;
    }
  });
  // RC15: Garante Code como aba inicial (se não tiver nenhum arquivo aberto ainda)
  switchEditorPanel('code');
})();

/* switchTab LEGADA (rotas antigas chamam switchTab('preview')) — redireciona para switchEditorPanel moderno */
const _origSwitchTab = switchTab;
switchTab = function(name) {
  if (['preview','console','terminal','chat','code','ia-config','btc'].includes(String(name))) {
    switchEditorPanel(String(name));
  } else if (_origSwitchTab) {
    return _origSwitchTab(name);
  }
};

/* Sub-tabs (obsoletas no layout novo — eram do preview-panel antigo. Manter hook vazio safe) */
(function hookSubTabs(){
  $$('.sub-tab').forEach(t => {
    if (t.__attSub) return;
    t.addEventListener('click', () => {
      $$('.sub-tab').forEach(x => {
        x.classList.remove('active');
        x.classList.add('text-slate-500');
      });
      t.classList.add('active');
      t.classList.remove('text-slate-500');
    });
    t.__attSub = true;
  });
})();

/* Novos botões do layout 3-colunas: Console/Terminal clear, toggle left/right paineis */
(function hookNewLayoutButtons(){
  // Console clear
  if (els.consoleClear && !els.consoleClear.__att) {
    els.consoleClear.addEventListener('click', () => {
      if (els.consoleOut) els.consoleOut.innerHTML = '<div class="text-slate-600">Console limpo.</div>';
    });
    els.consoleClear.__att = true;
  }
  // Terminal clear
  if (els.terminalClear && !els.terminalClear.__att) {
    els.terminalClear.addEventListener('click', () => {
      if (els.terminalOut) els.terminalOut.innerHTML = '<div class="text-emerald-500/80">$ zsh -i</div><div class="text-slate-600">Terminal limpo.</div>';
    });
    els.terminalClear.__att = true;
  }
  // Toggle-right (minimizar painel TRAE — no mobile é fechar)
  if (els.toggleRight && !els.toggleRight.__att) {
    els.toggleRight.addEventListener('click', () => {
      if (window.innerWidth <= 1280) {
        els.traeAgentPanel?.classList.remove('open');
        els.app?.classList.remove('right-open');
      } else {
        els.traeAgentPanel?.classList.toggle('w-0');
        els.traeAgentPanel?.classList.toggle('!w-0');
        els.traeAgentPanel?.classList.toggle('opacity-0');
        els.traeAgentPanel?.classList.toggle('border-0');
        els.traeAgentPanel?.classList.toggle('overflow-hidden');
      }
    });
    els.toggleRight.__att = true;
  }
  // Close-right-tmp (botão config — placeholder)
  if (els.closeRightTmp && !els.closeRightTmp.__att) {
    els.closeRightTmp.addEventListener('click', () => {
      toast('⚙️  Configurações do TiAi em breve', { type: 'warn' });
    });
    els.closeRightTmp.__att = true;
  }
  // Toggle-left (recolher explorer) — RC15: UNIFICADO no bloco PANELS RESPONSIVE acima → safe skip aqui
  if (els.toggleLeft && !els.toggleLeft.__att) {
    els.toggleLeft.__att = true;
  }
  // Open-left (mobile)
  if (els.openLeft && !els.openLeft.__att) {
    els.openLeft.addEventListener('click', () => {
      els.leftPanel?.classList.add('open');
    });
    els.openLeft.__att = true;
  }
})();

/* TRAE Thought toggle */
if (els.traeThoughtToggle && !els.traeThoughtToggle.__att) {
  els.traeThoughtToggle.addEventListener('click', () => toggleTraeThought());
  els.traeThoughtToggle.__att = true;
}

/* TRAE Close / Open panel mobile */
if (els.closeTraePanel && !els.closeTraePanel.__att) {
  els.closeTraePanel.addEventListener('click', () => {
    if (window.innerWidth <= 1100) {
      els.traeAgentPanel?.classList.remove('open');
      els.app?.classList.remove('right-open');
    }
  });
  els.closeTraePanel.__att = true;
}
if (els.openTraePanel && !els.openTraePanel.__att) {
  els.openTraePanel.addEventListener('click', () => {
    els.traeAgentPanel?.classList.add('open');
    els.app?.classList.add('right-open');
  });
  els.openTraePanel.__att = true;
}

/* TRAE Chat Form submit + input keys */
if (els.traeChatForm && !els.traeChatForm.__att) {
  els.traeChatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    doSubmit({ source: 'trae' });
  });
  els.traeChatForm.__att = true;
}
if (els.traeMessageInput && !els.traeMessageInput.__att) {
  els.traeMessageInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 140) + 'px';
  });
  els.traeMessageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      els.traeChatForm?.requestSubmit();
    }
  });
  els.traeMessageInput.__att = true;
}
/* TRAE Add button -> abre file picker igual chat */
if (els.traeAddBtn && !els.traeAddBtn.__att) {
  els.traeAddBtn.addEventListener('click', () => els.fileInput?.click());
  els.traeAddBtn.__att = true;
}
/* TRAE Auto/Solo/Interactive sync com o toggle da esquerda */
if (els.traeAutoSelect && !els.traeAutoSelect.__att) {
  els.traeAutoSelect.addEventListener('change', () => {
    const v = els.traeAutoSelect.value;
    let newMode = state.mode;
    if (v === 'solo') newMode = 'solo';
    else if (v === 'interactive') newMode = 'interactive';
    else newMode = state.mode === 'interactive' ? 'interactive' : 'solo';
    if (newMode !== state.mode) {
      state.mode = newMode;
      applyModeUI();
      saveState();
      sendConfig();
    }
  });
  els.traeAutoSelect.__att = true;
}

/* Preview nav buttons */
if (els.previewBack && !els.previewBack.__att) {
  els.previewBack.addEventListener('click', () => {
    try { els.previewIframe?.contentWindow?.history?.back?.(); } catch(_) {}
  });
  els.previewBack.__att = true;
}
if (els.previewForward && !els.previewForward.__att) {
  els.previewForward.addEventListener('click', () => {
    try { els.previewIframe?.contentWindow?.history?.forward?.(); } catch(_) {}
  });
  els.previewForward.__att = true;
}
/* Preview service select: trocar iframe ao selecionar um projeto/porta */
if (els.previewServiceSelect && !els.previewServiceSelect.__att) {
  els.previewServiceSelect.addEventListener('change', () => {
    const v = els.previewServiceSelect.value;
    if (!v) return;
    const sel = els.previewServiceSelect.selectedOptions?.[0];
    const proj = sel?.dataset?.project || (state.projects.find(p => p.previewUrl === v)?.name) || state.project;
    let base = v;
    if (!base.endsWith('/')) base += '/';
    // Se tem index.html conhecido, abre ele, senão só raiz
    const url = base + '?t=' + Date.now();
    els.previewEmpty?.classList.add('hidden');
    els.previewIframe?.classList.remove('hidden');
    els.previewUrlBar?.classList.remove('hidden');
    els.previewIframe.src = url;
    if (els.previewUrl) els.previewUrl.textContent = base;
    if (els.previewOpen) els.previewOpen.href = base;
    state.currentPreviewProject = proj;
    state.currentPreviewPath = `${proj}::`;
  });
  els.previewServiceSelect.__att = true;
}
/* openPreview: sync select service */
(function hookOpenPreviewSync(){
  const origOpenPreview = openPreview;
  window.openPreview = function(relOrKey, opts){
    const r = origOpenPreview.call(null, relOrKey, opts);
    // Tenta sincronizar o select se o projeto tem previewUrl
    try {
      const { project } = splitPreviewKey(relOrKey);
      const p = (state.projects || []).find(x => x.name === project);
      if (p && p.previewUrl && els.previewServiceSelect) {
        els.previewServiceSelect.value = p.previewUrl;
      }
    } catch(_) {}
    return r;
  };
})();

/* Hook: atualiza thought/running-tool a partir de msgs recebidas do agente */
(function hookAgentEventsToTraePanel(){
  // Hook updateAIMessageDelta: exibe resumo de texto em Thought quando tem conteúdo
  const origUpdateDelta = updateAIMessageDelta;
  window.updateAIMessageDelta = function(data){
    const r = origUpdateDelta(data);
    if (data?.text && typeof data.text === 'string') {
      // Só alimenta Thought se não for tool output puro
      const t = String(data.text);
      if (t.length > 20 && els.traeThoughtBody) {
        // Não sobrescreve thought se usuário já estiver olhando conteúdo diferente maior? por enquanto sempre atualiza
        if (els.traeThoughtBody.textContent === 'Planejando próximos passos…' ||
            els.traeThoughtBody.textContent === 'Aguardando primeiro prompt…' ||
            state.agentState === 'running') {
          const snippet = t.replace(/\s+/g, ' ').trim();
          if (snippet.length >= 5) {
            updateTraeThought(snippet, {});
          }
        }
      }
    }
    return r;
  };

  // Hook addToolCard -> running tool mini box
  const origAddTool = addToolCard;
  window.addToolCard = function(data){
    const r = origAddTool(data);
    if (els.traeRunningTool && data?.name) {
      els.traeRunningTool.classList.remove('hidden');
      if (els.traeRunningToolName) els.traeRunningToolName.textContent = data.name;
      if (els.traeRunningToolBody) {
        const args = data.args ? JSON.stringify(data.args, null, 1).slice(0, 1200) : '';
        els.traeRunningToolBody.textContent = args;
      }
    }
    return r;
  };
  // Hook updateToolCard: some tool cards result we can put snippet
  const origUpdateTool = updateToolCard;
  window.updateToolCard = function(data){
    const r = origUpdateTool(data);
    if (els.traeRunningTool && data?.ok && els.traeRunningToolName &&
        els.traeRunningToolName.textContent === data.name) {
      // Manter visível por 600ms depois esconder
      setTimeout(() => {
        if (els.traeRunningTool) els.traeRunningTool.classList.add('hidden');
      }, 700);
    }
    return r;
  };

  // Hook project events: preview services refresh
  const origRenderProjectList = renderProjectList;
  window.renderProjectList = function(){
    const r = origRenderProjectList.apply(null, arguments);
    populatePreviewServices();
    return r;
  };
})();

/* ========== KEYBOARD SHORTCUTS ========== */
document.addEventListener('keydown', (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    els.input.focus();
  }
  if (meta && e.key === 'Enter') {
    e.preventDefault();
    // Submete TRAE form se foco estiver nele, senão chat form
    if (document.activeElement === els.traeMessageInput) {
      els.traeChatForm?.requestSubmit();
    } else {
      els.form.requestSubmit();
    }
  }
  if (meta && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    els.newChatBtn.click();
  }
  if (e.key === 'Escape') {
    closeLeftMobile();
    els.rightPanel.classList.remove('visible');
    els.app.classList.remove('right-open');
    els.traeAgentPanel?.classList.remove('open');
    if (els.lightbox.classList.contains('open')) {
      els.lightbox.classList.remove('open');
      els.lightbox.style.display = 'none';
    }
  }
});

/* ========== RC19 📱 MOBILE FIRST: TabBar inferior + switch paineis fullscreen ========== */
const RC19_MOBILE_BP = 1080;
let rc19CurrentPanel = 'right';
let rc19IsMobile = false;
function applyMobilePanel(panelName) {
  if (!rc19IsMobile) return;
  const panels = document.querySelectorAll('[data-mobile-panel]');
  panels.forEach(p => {
    const isActive = p.dataset.mobilePanel === panelName;
    p.classList.toggle('mobile-panel-active', isActive);
  });
  const tabs = document.querySelectorAll('.mobile-tab');
  tabs.forEach(btn => {
    const isActive = btn.dataset.mobileTarget === panelName;
    btn.classList.toggle('mobile-tab-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  rc19CurrentPanel = panelName;
  try { localStorage.setItem('tia.mobilePanel.v1', panelName); } catch (_) {}
  scrollBottom?.();
}
function applyIsMobileState() {
  const wasMobile = rc19IsMobile;
  rc19IsMobile = window.innerWidth <= RC19_MOBILE_BP;
  document.body.classList.toggle('is-mobile', rc19IsMobile);
  if (rc19IsMobile) {
    if (!wasMobile) {
      const saved = localStorage.getItem('tia.mobilePanel.v1');
      const defaultPanel = (saved === 'left' || saved === 'center' || saved === 'right') ? saved : 'right';
      applyMobilePanel(defaultPanel);
    } else {
      applyMobilePanel(rc19CurrentPanel || 'right');
    }
  } else {
    // Desktop: remover classes mobile que estavam bloqueando flex 3-colunas
    document.querySelectorAll('[data-mobile-panel]').forEach(p => p.classList.remove('mobile-panel-active'));
  }
}
function initRC19Mobile() {
  // TabBar click
  document.querySelectorAll('.mobile-tab').forEach(btn => {
    if (btn.__rc19Bound) return;
    btn.__rc19Bound = true;
    btn.addEventListener('click', () => {
      const target = btn.dataset.mobileTarget;
      if (!target) return;
      applyMobilePanel(target);
    });
  });
  // Keypress Enter no input mobile: submit direto (sem shift newline opcional — default newline é opcional, Enter = submit)
  const tmi = els.traeMessageInput || els.input;
  if (tmi && !tmi.__rc19KeyBound) {
    tmi.__rc19KeyBound = true;
    tmi.addEventListener('keydown', (ev) => {
      if (!rc19IsMobile) return;
      // Enter (sem shift) = submit. Shift+Enter = newline (comportamento padrão textarea)
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        const frm = els.traeChatForm || els.form;
        frm?.requestSubmit?.();
        if (!frm) doSubmit({ source: 'trae' });
      }
    });
  }
  // Keyboard aware iOS: quando input ganha foco, scrollar pro final e adicionar classe
  const handleKBUp = () => {
    document.body.classList.add('ti-keyboard-up');
    setTimeout(() => { scrollBottom?.(); els.traeScroll?.scrollTo?.({ top: 999999, behavior: 'smooth' }); }, 250);
    setTimeout(() => { scrollBottom?.(); els.traeScroll?.scrollTo?.({ top: 999999 }); }, 900);
  };
  const handleKBDown = () => {
    document.body.classList.remove('ti-keyboard-up');
  };
  [els.traeMessageInput, els.input, document.querySelector('.trae-input')].forEach(inp => {
    if (!inp || inp.__rc19KBBound) return;
    inp.__rc19KBBound = true;
    inp.addEventListener('focus', handleKBUp);
    inp.addEventListener('blur', handleKBDown);
  });
  // Detecta teclado via visualViewport resize (funciona em iOS Safari 13+)
  if (window.visualViewport && !window.__rc19VV) {
    window.__rc19VV = true;
    let lastH = window.visualViewport.height;
    window.visualViewport.addEventListener('resize', () => {
      if (!rc19IsMobile) return;
      const h = window.visualViewport.height;
      if (h < lastH - 120) handleKBUp();
      if (h > lastH + 80) handleKBDown();
      lastH = h;
    });
  }
  // resize inicial + listener
  applyIsMobileState();
  let rszTimer;
  window.addEventListener('resize', () => {
    clearTimeout(rszTimer);
    rszTimer = setTimeout(applyIsMobileState, 120);
  });
}

/* ========== INIT ========== */
/* RC23 · Tela Configuração das Chaves das IAs (aba IA Config nova no centro) */
(function initRC23IAConfig(){
  if (!els.iacGrid) return;

  // ================= Providers (4 telinhas Gemini, Cerebras, Mistral, DeepSeek Free/OpenRouter)
  const PROVIDERS = [
    {
      id: 'gemini',
      name: 'Google Gemini',
      tag: 'Motor principal',
      icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-brand-300"><path d="M12 2l3 5 5 .6-3.8 3.4 1.3 5.5L12 13.8 6.5 16.5 7.8 11 4 7.6 9 7z"/></svg>`,
      color: 'brand',
      link: 'https://aistudio.google.com',
      env: 'GOOGLE_API_KEY',
      desc: 'Motor padrão da Desenvolvedora (preservado). Teste rápido antes de criar qualquer site.',
      placeholder: 'AIza… ou AQ.Ab… (prefixos de chave Google válidas)',
    },
    {
      id: 'cerebras',
      name: 'Cerebras Cloud',
      tag: 'IA Arquiteta · Default',
      icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-cyan-300"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 7h4v4H7zM13 7h4v4h-4zM7 13h4v4H7zM13 13h4v4h-4z"/></svg>`,
      color: 'cyan',
      link: 'https://cloud.cerebras.ai',
      env: 'CEREBRAS_API_KEY',
      desc: 'Arquiteta rápida (llama3.1-70b). Se vazia cai no Gemini sem erro.',
      placeholder: 'sk-cerebras-…',
    },
    {
      id: 'mistral',
      name: 'Mistral API',
      tag: 'QA · Alternativo',
      icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-orange-300"><path d="M2 18l5-12 5 10 5-8 5 10"/></svg>`,
      color: 'orange',
      link: 'https://console.mistral.ai',
      env: 'MISTRAL_API_KEY',
      desc: 'Analista QA leve e rápido. Alternativa ao Gemini para revisão final.',
      placeholder: 'sk-mistral-…',
    },
    {
      id: 'openrouter',
      name: 'OpenRouter · DeepSeek Free',
      tag: 'DeepSeek GRATUITO · Sem cobrança',
      icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-fuchsia-300"><path d="M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>`,
      color: 'fuchsia',
      link: 'https://openrouter.ai',
      env: 'OPENROUTER_API_KEY',
      desc: 'DeepSeek via OpenRouter (tem free tier diário). Cuidado com cota; chave vazia cai no Gemini.',
      placeholder: 'sk-or-v1-…',
    },
  ];

  const COLOR_MAP = {
    brand:   { badge: 'from-brand-600/20 to-fuchsia-600/10 border-brand-400/30 text-brand-300', dot: 'bg-brand-400', btn: 'from-brand-600 to-fuchsia-600 hover:from-brand-500 hover:to-fuchsia-500 border-brand-400/40' },
    cyan:    { badge: 'from-cyan-500/15 to-sky-500/5 border-cyan-400/30 text-cyan-300',       dot: 'bg-cyan-400',   btn: 'from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 border-cyan-400/40' },
    orange:  { badge: 'from-orange-500/15 to-amber-500/5 border-orange-400/30 text-orange-300',   dot: 'bg-orange-400', btn: 'from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 border-orange-400/40' },
    fuchsia: { badge: 'from-fuchsia-500/15 to-pink-500/5 border-fuchsia-400/30 text-fuchsia-300', dot: 'bg-fuchsia-400', btn: 'from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 border-fuchsia-400/40' },
  };

  // ========== Estado local (NÃO expõe as chaves no state global só aqui por closure)
  const LOCAL = {};
  PROVIDERS.forEach(p => { LOCAL[p.id] = { key: '', status: 'idle', error: '', latencyMs: 0, keyPrefix: null, configured: false }; });

  // ========== Render
  function render() {
    const parts = [];
    for (const p of PROVIDERS) {
      const st = LOCAL[p.id];
      const c = COLOR_MAP[p.color] || COLOR_MAP.brand;
      const statusMap = {
        idle:         { cls: 'bg-white/5 border-white/10 text-slate-500', label: (st.configured ? 'Configurada · não testada' : 'Não configurada'), icon: '◯' },
        testing:      { cls: 'bg-amber-500/10 border-amber-400/30 text-amber-300', label: 'Testando conexão…', icon: '⏳' },
        connected:    { cls: 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300', label: `Conectada · ${st.latencyMs ? st.latencyMs + 'ms' : 'ping ok'}`, icon: '✓' },
        invalid_key:  { cls: 'bg-red-500/10 border-red-400/30 text-red-300', label: 'Chave inválida (401/403)', icon: '✕' },
        rate_limit:   { cls: 'bg-amber-500/10 border-amber-400/30 text-amber-300', label: 'Cota atingida / rate limit (429)', icon: '⚠' },
        empty:        { cls: 'bg-white/5 border-white/10 text-slate-500', label: 'Campo vazio', icon: '◯' },
        network_error:{ cls: 'bg-red-500/5 border-red-400/20 text-red-400/80', label: 'Erro de rede / timeout', icon: '↯' },
        http_other:   { cls: 'bg-amber-500/10 border-amber-400/30 text-amber-300', label: 'Erro HTTP', icon: '↯' },
        saved:        { cls: 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300', label: 'Salva no .env · reinicie para aplicar', icon: '💾' },
      };
      const status = statusMap[st.status] || statusMap.idle;

      parts.push(`
      <div class="group rounded-2xl border border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.04] p-4 md:p-5 transition shadow-sm" data-iac-card="${p.id}">
        <div class="flex items-start justify-between gap-3 mb-3.5">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br ${c.badge} border grid place-items-center">${p.icon}</div>
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <div class="text-white font-semibold text-[12.5px] leading-tight">${p.name}</div>
                <span class="text-[9.5px] px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-400 uppercase tracking-wide">${p.tag}</span>
              </div>
              <div class="text-[10.5px] text-slate-500 font-mono mt-0.5">${p.env}</div>
            </div>
          </div>
          <div class="shrink-0 flex items-center gap-1.5 px-2 h-6 rounded-full border ${status.cls} text-[10.5px] font-semibold">
            <span class="w-1.5 h-1.5 rounded-full ${st.status==='testing' ? (c.dot+' animate-pulse') : (st.status==='connected'||st.status==='saved' ? 'bg-emerald-400' : (st.status==='invalid_key'||st.status==='network_error' ? 'bg-red-400' : 'bg-slate-500'))}"></span>
            <span title="${escapeAttr(status.label)}">${status.label}</span>
          </div>
        </div>

        <div class="text-[11px] text-slate-400 leading-relaxed mb-3">
          ${p.desc}
          · <a class="underline decoration-dotted underline-offset-2 text-slate-400 hover:text-white" href="${p.link}" target="_blank" rel="noopener noreferrer">Obter chave ↗</a>
        </div>

        <label class="block text-[10.5px] font-semibold text-slate-300 uppercase tracking-wide mb-1.5">API Key ${st.keyPrefix ? `<span class="ml-1 normal-case text-[10px] text-slate-500 font-mono">(${escapeHtml(st.keyPrefix)})</span>` : ''}</label>
        <div class="flex items-stretch gap-2">
          <div class="relative flex-1 min-w-0">
            <input
              type="password"
              class="iac-input w-full h-10 rounded-lg bg-[#080c1d] border border-white/10 focus:border-white/30 outline-none text-[12px] text-slate-200 font-mono px-3 pr-10 placeholder:text-slate-600 transition"
              data-iac-input="${p.id}"
              autocomplete="off"
              spellcheck="false"
              placeholder="${escapeAttr(p.placeholder)}"
              value="${escapeAttr(st.key)}"
            />
            <button type="button" class="iac-toggle-pw absolute right-0 top-0 bottom-0 w-10 grid place-items-center text-slate-500 hover:text-white transition rounded-r-lg" data-iac-toggle="${p.id}" title="Mostrar / ocultar chave" aria-label="Mostrar ou ocultar chave">
              <svg data-icon="eye" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <button type="button"
            data-iac-test="${p.id}"
            class="iac-test h-10 px-3.5 rounded-lg text-white text-[11.5px] font-bold grid place-items-center border shadow transition bg-gradient-to-br ${c.btn} disabled:opacity-50 disabled:cursor-not-allowed"
            ${st.status === 'testing' ? 'disabled' : ''}>
            <span class="flex items-center gap-1.5">
              <svg width="10.5" height="10.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              Conectar
            </span>
          </button>
        </div>

        ${(st.status === 'invalid_key' || st.status === 'network_error' || st.status === 'rate_limit' || (st.status && st.status.startsWith('http_'))) && st.error ? `
          <div class="mt-2 rounded-lg bg-red-500/10 border border-red-400/20 px-3 py-2 text-[10.5px] text-red-300 font-mono whitespace-pre-wrap break-words">
            ${escapeHtml(String(st.error || '').slice(0, 220))}
          </div>
        ` : ''}
      </div>`);
    }
    els.iacGrid.innerHTML = parts.join('');
    attachLocalListeners();
  }

  // ========== Attach listeners
  function attachLocalListeners() {
    $$('[data-iac-input]', els.iacGrid).forEach(inp => {
      const id = inp.dataset.iacInput;
      inp.addEventListener('input', () => {
        LOCAL[id].key = String(inp.value || '');
        // Reset para idle quando usuário edita (se estava inválido/conectado)
        if (['connected','invalid_key','rate_limit','network_error','saved'].includes(LOCAL[id].status)) LOCAL[id].status = 'idle';
        const badge = inp.closest('[data-iac-card]')?.querySelector('.rounded-full.border');
        if (badge) {
          // Re-render rápido só do badge? Por simplicidade, re-render completo é ok pois é curto (4 cards).
        }
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); testProvider(inp.dataset.iacInput); }});
    });
    $$('[data-iac-toggle]', els.iacGrid).forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = document.querySelector(`[data-iac-input="${btn.dataset.iacToggle}"]`);
        if (!inp) return;
        inp.type = inp.type === 'password' ? 'text' : 'password';
      });
    });
    $$('[data-iac-test]', els.iacGrid).forEach(btn => {
      btn.addEventListener('click', () => testProvider(btn.dataset.iacTest));
    });
  }

  // ========== Chamadas para API backend
  async function testProvider(id) {
    if (!LOCAL[id]) return;
    LOCAL[id].status = 'testing'; LOCAL[id].error = ''; LOCAL[id].latencyMs = 0;
    render();
    try {
      const res = await fetch('/api/config/test-key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: id, key: LOCAL[id].key })
      });
      const out = await res.json().catch(() => ({}));
      LOCAL[id].status = out.status || (out.ok ? 'connected' : 'idle');
      LOCAL[id].latencyMs = out.latencyMs || 0;
      LOCAL[id].keyPrefix = out.keyPrefix || null;
      if (!out.ok) LOCAL[id].error = out.error || 'Erro desconhecido';
    } catch (e) {
      LOCAL[id].status = 'network_error';
      LOCAL[id].error = String(e.message || e).slice(0, 180);
    }
    render();
    const msg = LOCAL[id].status === 'connected' ? `${PROVIDERS.find(p=>p.id===id)?.name || id} · Conectada ✓` : `${PROVIDERS.find(p=>p.id===id)?.name || id} · ${LOCAL[id].error || 'falhou'}`;
    try { toast(msg, LOCAL[id].status === 'connected' ? 'ok' : 'warn'); } catch {}
  }

  async function refreshFromServer() {
    if (els.iacNote) els.iacNote.textContent = 'Carregando status das chaves do servidor…';
    try {
      const res = await fetch('/api/config/status');
      const out = await res.json().catch(() => ({}));
      if (out && out.providers) {
        for (const [id, info] of Object.entries(out.providers)) {
          if (!LOCAL[id]) continue;
          LOCAL[id].configured = !!info.configured;
          LOCAL[id].keyPrefix = info.keyPrefix || null;
          if (LOCAL[id].status === 'idle' && info.configured) LOCAL[id].status = 'idle'; // mantém idle mas mostra prefixo
        }
        if (els.iacNote) els.iacNote.textContent = `Última atualização: ${new Date().toLocaleTimeString()} · .env em ${out.envFile || '.env'}`;
      }
    } catch (e) {
      if (els.iacNote) els.iacNote.textContent = `Erro ao carregar: ${String(e.message||e).slice(0,120)}`;
    }
    render();
  }

  async function testAll() {
    els.iacTestAll && els.iacTestAll.setAttribute('disabled', 'true');
    try { for (const p of PROVIDERS) { if (LOCAL[p.id].key && LOCAL[p.id].key.length >= 10) await testProvider(p.id); } } finally {
      els.iacTestAll && els.iacTestAll.removeAttribute('disabled');
    }
  }

  async function saveAll() {
    els.iacSaveAll && els.iacSaveAll.setAttribute('disabled', 'true');
    const keys = {}; PROVIDERS.forEach(p => { keys[p.id] = String(LOCAL[p.id].key || ''); });
    try {
      const res = await fetch('/api/config/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys })
      });
      const out = await res.json().catch(() => ({}));
      if (out.ok) {
        for (const p of PROVIDERS) {
          const fin = (out.perProvider||{})[p.id];
          if (fin?.finalStatus === 'saved_pending_reboot') LOCAL[p.id].status = 'saved';
          else if (fin?.finalStatus === 'not_configured' && !LOCAL[p.id].key) LOCAL[p.id].status = 'idle';
        }
        try { toast(`💾 Salvo no .env · ${out.replacedCount||0} atualizada(s) · ${out.addedCount||0} nova(s). Reinicie o servidor para aplicar.`, 'ok'); } catch {}
        await refreshFromServer();
      } else {
        try { toast(`Erro ao salvar: ${out.error || 'desconhecido'}`, 'err'); } catch {}
      }
    } catch (e) {
      try { toast(`Erro ao salvar: ${String(e.message||e).slice(0,160)}`, 'err'); } catch {}
    } finally {
      els.iacSaveAll && els.iacSaveAll.removeAttribute('disabled');
    }
    render();
  }

  // ========== Attach globais (refresh / test-all / save-all)
  els.iacRefresh?.addEventListener('click', refreshFromServer);
  els.iacTestAll?.addEventListener('click', testAll);
  els.iacSaveAll?.addEventListener('click', saveAll);

  // Botão Config do header painel TiAi (direito) → agora abre diretamente a aba IA Config
  els.closeRightTmp?.addEventListener('click', () => { switchEditorPanel('ia-config'); });

  // ========== Boot (render inicial + buscar status servidor)
  render();
  refreshFromServer();
})();

(function finalInit(){
  // RC19 Mobile: rodar ANTES de focar input para não dar zoom iOS
  try { initRC19Mobile(); } catch(err) { console.warn('rc19 init:', err); }
  autoResize();
  renderHistory();
  // RC17 ↔️ Painéis redimensionáveis: aplicar larguras salvas + drag mousedown/doubleclick reset
  try { initPanelResizers(); } catch(err) { console.warn('resizer init:', err); }
  // RC15: Inicializa editor painel no Code (Chat foi removido do centro → está no painel direito TiAi)
  if (els.editorPanels && !els.editorPanels.dataset.active) els.editorPanels.dataset.active = 'code';
  if (els.editorPanels && els.editorPanels.dataset.active === 'chat') els.editorPanels.dataset.active = 'code';
  if (state.plan && state.plan.length) renderTraeChecklist();
  updateTraeProgress();
  // Default TRAE panel aberto ou fechado? para mobile fechado, desktop aberto ok
  // Atualiza UI modo
  applyModeUI();
  // Sync select serviços (virá via loadProjects)
  populatePreviewServices();
  // RC19: em mobile NÃO focar o input — evita zoom forçado e abre teclado sem querer no carregamento
  if (!rc19IsMobile) els.input.focus();

  /* ============================================================
   *  RC24 AGENT ORCHESTRATOR: agent context bar + update bar
   *  - Apenas se projeto começar com agent__; senão hidden.
   * ============================================================ */
  try {
    if (els.traeMessageInput && !document.getElementById('rc24-agent-bar')) {
      const bar = document.createElement('div');
      bar.id = 'rc24-agent-bar';
      bar.className = 'hidden mb-3 px-3 py-2 rounded-xl border text-[12px]';
      bar.innerHTML = `
        <div class="flex flex-wrap items-center gap-2 justify-between">
          <div class="flex flex-wrap items-center gap-2">
            <span id="rc24-emoji" class="text-lg">🧭</span>
            <div class="flex flex-col">
              <div class="font-bold text-white"><span id="rc24-title">RC24 Agente</span> <span id="rc24-ver" class="ml-1 text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-200 align-middle"></span></div>
              <div class="text-[10.5px] text-slate-300/85"><span id="rc24-projeto"></span></div>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <span id="rc24-state-chip" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-slate-700/80 border border-slate-600 text-slate-200 uppercase tracking-wide">
              <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> <span id="rc24-state">—</span>
            </span>
            <span id="rc24-build-chip" class="hidden px-2 py-0.5 rounded-full text-[10px] bg-sky-700/30 border border-sky-500/40 text-sky-200">build RC22</span>
            <span id="rc24-qa-chip" class="hidden px-2 py-0.5 rounded-full text-[10px] bg-emerald-700/30 border border-emerald-500/40 text-emerald-200">QA</span>
            <span id="rc24-sec-chip" class="hidden px-2 py-0.5 rounded-full text-[10px] bg-rose-700/30 border border-rose-500/40 text-rose-200">Security</span>
            <a id="rc24-help-btn" class="ml-1 cursor-pointer px-2 py-0.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-[10px] text-slate-200 font-semibold" title="Lista de slash commands RC24">/help</a>
          </div>
        </div>
      `;
      // Cola acima do textarea chat (TRAE):
      if (els.traeMessageInput && els.traeMessageInput.parentNode) {
        els.traeMessageInput.parentNode.insertBefore(bar, els.traeMessageInput);
      } else if (els.input && els.input.parentNode) {
        els.input.parentNode.insertBefore(bar, els.input);
      }
      // Help link → simula slash /help no submit:
      const helpBtn = bar.querySelector('#rc24-help-btn');
      helpBtn && helpBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (els.traeMessageInput) { els.traeMessageInput.value = '/help'; els.traeChatForm?.requestSubmit(); }
        else if (els.form) { els.input.value = '/help'; els.form.requestSubmit(); }
      });

      window.__rc24UpdateBar = function (partial = {}) {
        try {
          const proj = partial.project || state.project || DEFAULT_PROJECT_NAME;
          const isAg = /^agent__/.test(String(proj||''));
          bar.classList.toggle('hidden', !isAg);
          if (!isAg) return;
          const isRasc  = (partial.state||'rascunho') === 'rascunho';
          const isConst = (partial.state||'') === 'construindo';
          const isTest  = (partial.state||'') === 'testando';
          const isPronto= (partial.state||'') === 'pronto';
          const stateColor = isPronto ? ['bg-emerald-700/40 border-emerald-500/40 text-emerald-100','bg-emerald-400']
                             : isTest ? ['bg-violet-700/40 border-violet-500/40 text-violet-100','bg-violet-400']
                             : isConst ? ['bg-sky-700/40 border-sky-500/40 text-sky-100','bg-sky-400']
                             : ['bg-slate-700/80 border-slate-600 text-slate-200','bg-slate-400'];
          const sc = bar.querySelector('#rc24-state-chip');
          if (sc) { sc.className = `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold border uppercase tracking-wide ${stateColor[0]}`;
            const dot = sc.querySelector('span'); if (dot) dot.className = `w-1.5 h-1.5 rounded-full ${stateColor[1]}`; }
          bar.querySelector('#rc24-state').textContent = partial.state || '—';
          bar.querySelector('#rc24-projeto').textContent = `Projeto: ${proj}`;
          bar.querySelector('#rc24-ver').textContent = partial.version ? ('v'+partial.version) : '';
          bar.classList.add('bg-slate-900/60','border-slate-700/70','backdrop-blur-sm','shadow-md');

          // Build chip:
          const rc22 = partial.lastRc22Run || null;
          if (rc22) {
            const el = bar.querySelector('#rc24-build-chip');
            el.classList.remove('hidden');
            el.textContent = rc22.status === 'queued' ? 'Build: fila' : rc22.status === 'running' ? 'Build: rodando…' : rc22.status === 'done' ? `Build: OK (QA ${rc22.qa?.overallScore ?? '?'})` : `Build: ${rc22.status}`;
          }
        } catch {}
      };

      // Atualiza barra com base no projeto atual (carregamento inicial):
      const initProject = state.project || DEFAULT_PROJECT_NAME;
      if (/^agent__/.test(String(initProject||''))) {
        // Carrega spec + state via REST para preencher barra:
        Promise.all([
          fetch('/api/agent/'+encodeURIComponent(initProject)).then(x=>x.json()).catch(()=>({})),
          fetch('/api/agent/'+encodeURIComponent(initProject)+'/state').then(x=>x.json()).catch(()=>({}))
        ]).then(([spec,st])=>{
          window.__rc24UpdateBar && window.__rc24UpdateBar({ project: initProject, version: spec && spec.version, state: st && st.state && st.state.currentState, lastRc22Run: st && st.state && st.state.lastRc22Run });
        }).catch(()=>{});
      }
    }
  } catch (errRc24) { console.warn('[RC24 bar init WARN]', errRc24); }

  // RC22.4 Voice Conversation: hooks públicos de integração com o agente de voz (precisa vir DEPOIS
  // que doSubmit e connectWS estarem declarados).
  window.__ti_voice_ws = (typeof state !== 'undefined' && state.ws) ? state.ws : null;
  window._ti_getWs = function () { return (typeof state !== 'undefined' && state.ws) ? state.ws : null; };
  window.__ti_voice_send = function (obj) {
    if (!obj) return;
    if (obj.type === 'chat:send' && typeof obj.text === 'string' && typeof doSubmit === 'function') {
      const tInput = document.getElementById('trae-message-input');
      if (tInput) {
        const prev = (tInput.value || '').trim();
        tInput.value = prev ? (prev + '\n' + obj.text) : obj.text;
        tInput.style.height = 'auto';
        try { tInput.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
      }
      doSubmit({ source: 'trae' });
      return;
    }
    if (typeof sendWS === 'function') sendWS(obj);
  };

  /* =========================================================================
     RC27 · Orquestrador Autônomo UI — funções globais e binds
     ========================================================================= */
  try {
    state.rc27 = { currentPhase: null, currentStatus: null, history: [] };

    const RC27_PHASES = [
      ['ANALYSIS',        'Análise'],
      ['PLANNING',        'Planejamento'],
      ['ARCHITECTURE',    'Arquitetura'],
      ['IMPLEMENTATION',  'Implementação'],
      ['TESTING',         'Testes'],
      ['CORRECTION',      'Correções'],
      ['VALIDATION',      'Validação'],
      ['COMPLETED',       'Concluído']
    ];
    const PHASE_MAP = Object.fromEntries(RC27_PHASES);
    window.__rc27PhaseLabel = (phaseKey) => PHASE_MAP[phaseKey] || phaseKey || '—';

    window.__rc27GetStepEl = function (phaseKey) {
      if (!phaseKey) return null;
      // Usa as refs definidas no objeto els (camelCase)
      const key = 'rc27Step' + phaseKey.charAt(0) + phaseKey.slice(1).toLowerCase().replace(/_(.)/g, (_,c)=>c.toUpperCase());
      if (els && els[key]) return els[key];
      return document.getElementById('rc27-step-' + phaseKey);
    };

    window.__rc27ResetStepper = function () {
      try {
        state.rc27.currentPhase = null;
        state.rc27.currentStatus = null;
        state.rc27.history = [];
        for (const [key] of RC27_PHASES) {
          const el = window.__rc27GetStepEl(key);
          if (el) {
            el.removeAttribute('data-status');
            el.setAttribute('data-status', 'pending');
            const labelEl = el.querySelector('.rc27-step-label');
            if (labelEl) { labelEl.textContent = window.__rc27PhaseLabel(key); labelEl.title = ''; }
          }
        }
        if (els.rc27Stepper && els.rc27Stepper.classList && !els.rc27Stepper.classList.contains('hidden')) els.rc27Stepper.classList.add('hidden');
        if (els.rc27StepperGoal) { els.rc27StepperGoal.textContent = 'Aguardando envio da tarefa…'; els.rc27StepperGoal.dataset.filledBy = ''; }
        if (els.rc27Summary) els.rc27Summary.textContent = 'Inativo';
        window.__rc27HideInternetAuthModal();
        window.__rc27HideHumanModal();
      } catch(e) { console.debug('[RC27 UI] reset error', e); }
    };

    function rc27MarkDoneUntil_ (phaseKeyInclusive) {
      // Marca como DONE todas as fases ANTERIORES (inclusive) se ainda não tiver status.
      if (!phaseKeyInclusive) return;
      const idx = RC27_PHASES.findIndex(([k]) => k === phaseKeyInclusive);
      if (idx < 0) return;
      for (let i = 0; i < idx; i++) {
        const [key] = RC27_PHASES[i];
        const el = window.__rc27GetStepEl(key);
        if (el) {
          const cur = el.getAttribute('data-status');
          if (!cur || cur === 'pending') el.setAttribute('data-status', 'done');
        }
      }
    }

    window.__rc27UpdateStepper = function (opts) {
      opts = opts || {};
      try {
        if (els.rc27Stepper && els.rc27Stepper.classList.contains('hidden')) els.rc27Stepper.classList.remove('hidden');

        // Histórico de fases para progresso
        const summary = opts.summary || opts.label || null;
        if (summary && els.rc27Summary) els.rc27Summary.textContent = String(summary).slice(0, 100);

        let phaseKey = opts.currentPhase || opts.phase;
        let status = opts.status || 'active';
        if (opts.overrideCurrentStatus) status = opts.overrideCurrentStatus;

        if (phaseKey) {
          rc27MarkDoneUntil_(phaseKey);
          state.rc27.currentPhase = phaseKey;
          state.rc27.currentStatus = status;
          state.rc27.history.push({ phase: phaseKey, status, t: Date.now(), label: opts.label || null });
          if (state.rc27.history.length > 120) state.rc27.history.shift();
          const el = window.__rc27GetStepEl(phaseKey);
          if (el) {
            el.setAttribute('data-status', status);
            if (opts.label) {
              const labelEl = el.querySelector('.rc27-step-label');
              if (labelEl) { labelEl.title = String(opts.label); }
            }
          }
          // Se COMPLETED/VALIDATION atingida → marca último step done também
          if (phaseKey === 'COMPLETED' && (status === 'done' || status === 'active')) {
            for (const [k] of RC27_PHASES) {
              const e = window.__rc27GetStepEl(k);
              if (e && !e.getAttribute('data-status') || e.getAttribute('data-status') === 'pending') e.setAttribute('data-status','done');
            }
            const e = window.__rc27GetStepEl('COMPLETED');
            if (e) e.setAttribute('data-status', 'done');
          }
        }
      } catch (e) { console.debug('[RC27 UI] updateStepper error', e); }
    };

    window.__rc27SetPhase = function (d) {
      if (!d) return;
      window.__rc27UpdateStepper({
        currentPhase: d.phase,
        status: d.status || 'active',
        label: d.label || null,
        summary: d.summary || null,
        scopeId: d.scopeId || null
      });
    };

    window.__rc27HideInternetAuthModal = function () {
      if (els.rc27InternetModal) {
        els.rc27InternetModal.classList.add('hidden');
        els.rc27InternetModal.classList.remove('flex');
      }
    };
    window.__rc27HideHumanModal = function () {
      if (els.rc27HumanModal) {
        els.rc27HumanModal.classList.add('hidden');
        els.rc27HumanModal.classList.remove('flex');
      }
    };
    window.__rc27SendInternetAuth = function (authorized) {
      const scopeId = (els && els.rc27AuthCurrentScopeId) || null;
      if (!scopeId) { console.warn('[RC27] send auth sem scopeId'); }
      const cmd = authorized ? 'RC27_INTERNET_AUTHORIZED' : 'RC27_INTERNET_DENIED';
      const text = cmd + ' ' + JSON.stringify({ scopeId: scopeId || null, authorized: Boolean(authorized) });
      window.__rc27HideInternetAuthModal();
      if (typeof doSubmit === 'function') {
        const tInput = document.getElementById('trae-message-input') || document.getElementById('message-input');
        if (tInput) {
          const prev = (tInput.value || '').trim();
          tInput.value = prev ? (prev + '\n\n' + text) : text;
          tInput.style.height = 'auto';
          try { tInput.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
        }
        try { doSubmit({ source: 'rc27' }); } catch {}
        return;
      }
      if (typeof sendWS === 'function') sendWS({ type: 'chat:send', text });
    };

    // Bind botões dos modais
    try {
      if (els.rc27InternetBtnYes) els.rc27InternetBtnYes.addEventListener('click', (e) => { e.preventDefault(); window.__rc27SendInternetAuth(true); });
      if (els.rc27InternetBtnNo)  els.rc27InternetBtnNo.addEventListener('click',  (e) => { e.preventDefault(); window.__rc27SendInternetAuth(false); });
      if (els.rc27HumanBtnOk)     els.rc27HumanBtnOk.addEventListener('click',     (e) => { e.preventDefault(); window.__rc27HideHumanModal(); });
    } catch(_) {}

    // === FALLBACK GARANTIDO · Força abrir modal autorização internet ===
    // Detecta 3 gatilhos (um deles já basta para abrir):
    //   (A) texto renderizado no chat contém frase característica do sistema de autorizações;
    //   (B) mensagem WS chat:message tem campo internetAuthorizationPending;
    //   (C) polling 2s no localStorage / cookie com scopeId pendente.
    // Motivo: evento WS `orch:internet_authorization_requested` pode se perder se
    //         o usuário estiver no chat do agente criado e não no TiAgente central.
    try {
      window.__rc27ForceOpenInternetAuth = function (payload) {
        try {
          const d = payload || {};
          const scopeId = String(d.scopeId || els.rc27AuthCurrentScopeId || '');
          if (!scopeId || scopeId === 'null' || scopeId === 'undefined') return false;
          els.rc27AuthCurrentScopeId = scopeId;
          if (els.rc27InternetScope) els.rc27InternetScope.textContent = 'escopo: ' + scopeId.slice(0,14) + (scopeId.length>14?'…':'');
          if (els.rc27InternetReason) els.rc27InternetReason.textContent = String(d.reason || 'O agente precisa consultar fontes externas para continuar. Verifique abaixo os sites que ele pretende abrir e clique em SIM para permitir.');
          if (els.rc27InternetUrls) {
            const urls = Array.isArray(d.urls) && d.urls.length ? d.urls : [];
            if (!urls.length) els.rc27InternetUrls.textContent = 'Serão definidos durante a pesquisa.';
            else els.rc27InternetUrls.innerHTML = urls.slice(0,20).map(u=>{try{const uu=new URL(u);return `<div class="truncate">↳ <span class="text-amber-300">${uu.hostname}</span>${uu.pathname.length>1?uu.pathname:''}</div>`;}catch(_){return `<div class="truncate">↳ ${String(u).slice(0,160)}</div>`;}}).join('\n');
          }
          if (els.rc27InternetModal) {
            els.rc27InternetModal.classList.remove('hidden');
            els.rc27InternetModal.classList.add('flex');
          }
          try { window.__rc27UpdateStepper && window.__rc27UpdateStepper({ summary: '⏸ Aguardando autorização internet…', phase: d.phase || 'PLANNING', overrideCurrentStatus: 'awaiting_input' }); } catch(_) {}
          try { toast && toast('🌐 Autorização necessária · clique em SIM ou NÃO abaixo', 'warn'); } catch(_) {}
          return true;
        } catch (e) { console.debug('[RC27 fallback] erro force-open', e); return false; }
      };
      // (A) MutationObserver no chat: detecta a frase de autorização escrita como texto e força abrir
      const _rc27InternetAuthRegex = /(acessei o sistema de autorizações|clique no bot.o sim no modal|aguardando autorização internet|aguardando clique sim.n.o do usu.rio via modal ui|web_request_ask_authorization.*awaitinguser)/i;
      let _rc27ChatContainer = document.getElementById('trae-messages') || document.getElementById('chat-messages') || document.querySelector('[data-area="messages"]') || document.querySelector('.chat-messages') || document.body;
      new MutationObserver((mutations) => {
        const modalAberto = els.rc27InternetModal && !els.rc27InternetModal.classList.contains('hidden');
        if (modalAberto) return;
        for (const m of mutations) {
          if (!m || !m.addedNodes) continue;
          for (const node of Array.from(m.addedNodes)) {
            if (!node || node.nodeType !== 1) continue;
            const txt = (node.textContent || '').slice(0, 8000);
            if (_rc27InternetAuthRegex.test(txt)) {
              // Tenta extrair scopeId do texto
              const mScope = txt.match(/(inet_[a-z0-9_]{4,})/) || txt.match(/scopeId["'`\s:]*([a-z0-9_\-]{6,})/i);
              const mUrls = Array.from(txt.matchAll(/https?:\/\/[^\s"'<>)]+/gi) || []).map(x => x[0]).slice(0, 10);
              const scopeId = mScope ? mScope[1] : (els.rc27AuthCurrentScopeId || ('inet_fallback_' + Date.now().toString(36)));
              els.rc27AuthCurrentScopeId = scopeId;
              window.__rc27ForceOpenInternetAuth({ scopeId, urls: mUrls });
              return;
            }
          }
        }
      }).observe(_rc27ChatContainer, { childList: true, subtree: true, characterData: true });

      // (C) Polling leve a cada 2s: procura pending no estado global / window.state
      setInterval(() => {
        try {
          const modalAberto = els.rc27InternetModal && !els.rc27InternetModal.classList.contains('hidden');
          if (modalAberto) return;
          const st = (typeof window.state === 'object' && window.state) ? window.state : {};
          const pending = st.internetAuthorizationPending || (st.rc27 && st.rc27.internetAuthorizationPending) || null;
          if (pending && typeof pending === 'object' && pending.scopeId) {
            window.__rc27ForceOpenInternetAuth(pending);
          }
        } catch(_) {}
      }, 2000);
    } catch(_) {}

    // Hook: ao enviar mensagem (usuário iniciou tarefa nova), reset suave do stepper
    try {
      const origDoSubmit = (typeof doSubmit === 'function') ? doSubmit : null;
      if (origDoSubmit) {
        window.doSubmit = function (...args) {
          try {
            const text = (() => {
              const input = document.getElementById('trae-message-input') || document.getElementById('message-input');
              return input ? (input.value || '').trim() : '';
            })();
            if (text && text.length) {
              // Não reseta se for comandos de autorização/negação (já tratado acima)
              if (!text.startsWith('RC27_INTERNET_AUTHORIZED') && !text.startsWith('RC27_INTERNET_DENIED')) {
                if (state.rc27 && !state.rc27.currentPhase) {
                  // Nada rodando, OK manter default hidden
                } else {
                  window.__rc27ResetStepper();
                }
                // Atualiza o goal no stepper logo no envio
                if (els.rc27StepperGoal) {
                  els.rc27StepperGoal.textContent = text.length > 220 ? text.slice(0,218)+'…' : text;
                  els.rc27StepperGoal.dataset.filledBy = '0';
                }
                if (els.rc27Stepper && els.rc27Stepper.classList.contains('hidden')) els.rc27Stepper.classList.remove('hidden');
                window.__rc27UpdateStepper({ currentPhase: 'ANALYSIS', status: 'active', summary: 'Análise do objetivo…', label: text.length > 40 ? text.slice(0,38)+'…' : text });
              }
            }
          } catch(_) {}
          return origDoSubmit.apply(this, args);
        };
      }
    } catch(_) {}

    // Hook: session cleared → reseta RC27 também
    try {
      const origSessionClearedHandler = null; // (já inserimos inline abaixo)
    } catch(_) {}

    console.debug('[RC27 UI] módulo carregado. Stepper refs ok?', Boolean(els && els.rc27Stepper), '; internet modal?', Boolean(els && els.rc27InternetModal), '; human modal?', Boolean(els && els.rc27HumanModal));
  } catch (rc27InitErr) { console.warn('[RC27 UI] init WARN', rc27InitErr); }

  /* =========================================================
   * ₿ BTC MARKET INTELLIGENCE UI MODULE
   * NÃO é recomendação financeira. Não executa compra/venda.
   * Dados públicos + cálculos locais. IA só quando opcional.
   * =======================================================*/
  (function initBtcMi() {
    try {
      // -------- Helpers de formatação segura ----------
      function fmtUsd(v) {
        if (!Number.isFinite(v)) return '—';
        return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits: 2 }).format(v);
      }
      function fmtUsdShort(v) {
        if (!Number.isFinite(v)) return '—';
        const abs = Math.abs(v);
        if (abs >= 1e9) return (v/1e9).toFixed(2) + 'B';
        if (abs >= 1e6) return (v/1e6).toFixed(2) + 'M';
        if (abs >= 1e3) return (v/1e3).toFixed(2) + 'K';
        return v.toFixed(2);
      }
      function fmtPct(v, digits=2) {
        if (!Number.isFinite(v)) return '—';
        return (v >= 0 ? '+' : '') + v.toFixed(digits) + '%';
      }
      function fmtDate(ts) {
        const d = new Date(Number(ts) || Date.now());
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleString('pt-BR', { hour12: false });
      }
      function clsBadgePct(v) {
        if (!Number.isFinite(v)) return 'bg-white/5 text-slate-300';
        return v > 0 ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30'
                     : v < 0 ? 'bg-rose-500/15 text-rose-300 border border-rose-400/30'
                     : 'bg-white/5 text-slate-300';
      }
      function clsScenario(sc) {
        if (sc === 'ALTA') return 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30';
        if (sc === 'BAIXA') return 'bg-rose-500/15 text-rose-300 border border-rose-400/30';
        return 'bg-white/5 text-slate-300 border border-slate-500/20';
      }
      function clsScoreColor(sc) {
        if (!Number.isFinite(sc)) return 'text-slate-400';
        if (sc >= 70) return 'text-emerald-400';
        if (sc >= 55) return 'text-emerald-300';
        if (sc <= 30) return 'text-rose-400';
        if (sc <= 45) return 'text-rose-300';
        return 'text-sky-300';
      }
      function clsRiskLabel(rk) {
        if (rk === 'ALTO') return 'bg-rose-500/15 text-rose-300 border border-rose-400/30';
        if (rk === 'MÉDIO' || rk === 'MEDIO') return 'bg-amber-500/15 text-amber-300 border border-amber-400/30';
        return 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30';
      }
      function newsClsColor(c) {
        if (c === 'FATO') return 'bg-blue-500/15 text-blue-300 border border-blue-400/30';
        if (c === 'RUMOR') return 'bg-amber-500/15 text-amber-300 border border-amber-400/30';
        if (c === 'OPINIÃO') return 'bg-purple-500/15 text-purple-300 border border-purple-400/30';
        if (c === 'ANÁLISE' || c === 'ANALISE') return 'bg-sky-500/15 text-sky-300 border border-sky-400/30';
        if (c === 'FONTE_NÃO_CONFIRMADA' || c === 'FONTE_NAO_CONFIRMADA' || c === 'NAO_CONFIRMADO' || c === 'UNCONFIRMED')
          return 'bg-slate-500/10 text-slate-300 border border-slate-500/20';
        return 'bg-white/5 text-slate-300';
      }

      // -------- Carregamento inicial status (se ainda não tem) ----------
      window._btcLoadStatusIfMissing = _btcLoadStatusIfMissing;
      function _btcLoadStatusIfMissing() {
        if (state.lastBtcReport) { renderBtcDashboard(); return true; }
        if (els.btcSpinner) els.btcSpinner.classList.remove('hidden');
        if (els.btcDashboard) els.btcDashboard.classList.add('hidden');
        fetch('/api/btc/status').then(r=>r.json()).then(d=>{
          if (d && d.latestReport && typeof d.latestReport === 'object') {
            state.lastBtcReport = d.latestReport;
            if (els.editorPanels && els.editorPanels.dataset.active === 'btc') renderBtcDashboard();
          } else {
            // Sem último report ainda — avisa usuário e deixa botão manual disponível
            if (els.btcSpinner && els.btcDashboard) {
              els.btcSpinner.classList.add('hidden');
              els.btcDashboard.classList.remove('hidden');
              els.btcDashboard.innerHTML = `<div class="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4 text-[11.5px] text-amber-300 leading-relaxed">
                <div class="font-bold mb-1.5">ℹ️  Primeira análise ainda não coletada.</div>
                Clique em <b>Coletar agora</b> no cabeçalho para obter dados reais de BTC. As próximas coletas são automáticas (configurável via variável BTC_MI_INTERVAL_MS, padrão 1 minuto).
              </div>`;
            }
          }
        }).catch(err=>{
          console.warn('[BTC UI] status init erro', err);
          if (els.btcSpinner) els.btcSpinner.innerHTML = `<div class="text-rose-400">⚠️ Erro ao consultar status BTC: ${escapeHtml(String(err?.message || err))}</div>`;
        });
        return false;
      }

      // -------- Render Dashboard ----------
      window.renderBtcDashboard = renderBtcDashboard;
      function renderBtcDashboard() {
        const r = state.lastBtcReport;
        if (!r || typeof r !== 'object') { _btcLoadStatusIfMissing(); return; }
        if (els.btcSpinner) els.btcSpinner.classList.add('hidden');
        if (els.btcDashboard) els.btcDashboard.classList.remove('hidden');

        const ind1d = r.indicators && r.indicators['1d'] ? r.indicators['1d'] : {};
        const ind1h = r.indicators && r.indicators['1h'] ? r.indicators['1h'] : {};
        const price = Number(r.price) || 0;
        const change24h = Number(r.ticker?.change24hPct);
        const volume = Number(r.ticker?.volumeUsd);
        const volumeBase = Number(r.ticker?.volumeBase);
        const score = Number(r.score) || 0;
        const mtfAlign = r.multiTimeframeAlign?.alignment || 'CONFLICTANTES';
        const mtfAlignCls = mtfAlign === 'ALINHADOS_ALTA' || mtfAlign === 'BULL' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30'
                           : (mtfAlign === 'ALINHADOS_BAIXA' || mtfAlign === 'BEAR' ? 'bg-rose-500/15 text-rose-300 border border-rose-400/30'
                                                                             : 'bg-amber-500/15 text-amber-300 border border-amber-400/30');
        const rsi = Number(ind1d.rsi);
        const macdHist = Number(ind1d.macd?.histogram);
        const atr = Number(ind1d.atr);
        const atrPct = Number(ind1d.volatility?.atrPct);
        const volLevel = ind1d.volatility?.level || 'NÃO OBSERVADO';
        const boll = ind1d.bollinger || {};
        const trend1d = ind1d.trend || {};
        const sr = r.supportResistance1d || {};
        const support = Number(sr.support);
        const resistance = Number(sr.resistance);
        const sources = (r.sourcesUsed && Array.isArray(r.sourcesUsed)) ? r.sourcesUsed.join(', ') : '—';
        const duration = Number(r.durationMs);
        const news = Array.isArray(r.news) ? r.news : [];
        const positives = Array.isArray(r.positives) ? r.positives : [];
        const negatives = Array.isArray(r.negatives) ? r.negatives : [];
        const counts = r.ticker;

        const card = (label, val, extraCls='', hint='') => `
          <div class="rounded-lg border border-surface-border bg-surface-card/60 p-3 min-w-0 flex flex-col gap-1 ${extraCls}">
            <div class="text-[9.5px] uppercase tracking-wider text-slate-500 font-semibold">${escapeHtml(label)}</div>
            <div class="text-[13px] font-bold text-white min-w-0 truncate">${val}</div>
            ${hint ? `<div class="text-[10.5px] text-slate-500 leading-snug">${hint}</div>` : ''}
          </div>`;

        // Barra de score estilo gauge
        const pct = Math.max(0, Math.min(100, Number(score) || 0));
        const barColor = pct >= 70 ? 'bg-emerald-500' : pct >= 55 ? 'bg-emerald-400' : pct <= 30 ? 'bg-rose-500' : pct <= 45 ? 'bg-rose-400' : 'bg-sky-400';
        const scenarioTxt = (r.scenarioLabel && typeof r.scenarioLabel === 'string') ? escapeHtml(r.scenarioLabel) : '';
        const disclaimer = (r.disclaimer && typeof r.disclaimer === 'string') ? escapeHtml(r.disclaimer) : '';

        els.btcDashboard.innerHTML = `
          <!-- 1. Header Preço / Variação / Cenário -->
          <div class="rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-500/10 via-transparent to-orange-500/5 p-4 md:p-5">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1.5">
                  <div class="w-9 h-9 shrink-0 rounded-xl grid place-items-center bg-amber-500/20 border border-amber-400/30">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="text-amber-400"><path d="M17.078 9.817c.325-2.156-1.32-3.31-3.57-4.09l.73-2.932-1.778-.441-.71 2.852c-.466-.116-.94-.225-1.414-.332l.712-2.857L8.57 1.664l-.73 2.933c-3.863.905-6.53 2.886-4.89 6.149.975 1.932 3.04 3.073 5.185 4.075-.06.25-.113.5-.166.744-1.69-.202-4.255-.664-4.484 2.47-.04.557.14 1.071.494 1.506.062.075.128.147.198.217a1 1 0 00.15.143l1.62-.609c1.127 1.193 2.56 1.87 4.196 2.302l-.726 2.915 1.778.441.73-2.932c.481.12.955.23 1.422.339l-.728 2.92 1.779.441.73-2.93c3.908-.916 6.6-2.865 4.956-6.19-.95-1.97-2.998-3.118-5.166-4.145.23-.67.418-1.35.553-2.042zm-3.291 4.684c-.52 2.088-4.059.975-5.192.687l.922-3.704c1.133.289 4.801.848 4.27 3.017zm.525-4.693c-.475 1.902-3.393.922-4.35.675l.83-3.33c.956.248 4.006.701 3.52 2.655z"/></svg>
                  </div>
                  <div class="min-w-0">
                    <div class="text-[11.5px] text-slate-400 font-semibold">${escapeHtml(String(r.symbol || 'BTC/USD'))}</div>
                    <div class="text-[28px] leading-none font-black tracking-[-0.02em] text-white mt-0.5">${fmtUsd(price)}</div>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2 mt-3">
                  <span class="inline-flex items-center gap-1 rounded-md px-2 py-1 border text-[11px] font-semibold ${clsBadgePct(change24h)}">
                    ${change24h >= 0 ? '▲' : '▼'} Variação 24h: ${fmtPct(change24h)}
                  </span>
                  <span class="inline-flex items-center gap-1 rounded-md px-2 py-1 border bg-white/5 text-slate-300 border-slate-500/20 text-[11px] font-semibold">
                    Volume 24h: $${fmtUsdShort(volume)} (${fmtUsdShort(volumeBase)} BTC)
                  </span>
                  <span class="inline-flex items-center gap-1 rounded-md px-2 py-1 border text-[11px] font-semibold ${clsScenario(r.scenario)}">
                    Cenário: ${escapeHtml(r.scenario || 'NEUTRO')}
                  </span>
                  <span class="inline-flex items-center gap-1 rounded-md px-2 py-1 border text-[11px] font-semibold ${mtfAlignCls}">
                    MTF: ${escapeHtml(mtfAlign)}
                  </span>
                  <span class="inline-flex items-center gap-1 rounded-md px-2 py-1 border text-[11px] font-semibold ${clsRiskLabel(r.riskLevel)}">
                    Risco: ${escapeHtml(r.riskLevel || '—')}
                  </span>
                </div>
              </div>
              <div class="w-full sm:w-[230px] shrink-0 rounded-xl border border-surface-border bg-surface-soft/60 p-3.5 flex flex-col items-center gap-2">
                <div class="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Score 0-100</div>
                <div class="text-[40px] leading-none font-black ${clsScoreColor(pct)}">${pct.toFixed(0)}<span class="text-[18px] font-bold text-slate-500">/100</span></div>
                <div class="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                  <div class="h-full ${barColor} transition-all" style="width:${pct.toFixed(1)}%"></div>
                </div>
                <div class="text-[10.5px] text-slate-500 leading-snug text-center">
                  Força do sinal: <b class="text-slate-300">${escapeHtml(r.scenarioStrength || '—')}</b>
                </div>
              </div>
            </div>
            <!-- Cenário label + disclaimer obrigatório -->
            ${scenarioTxt ? `
              <div class="mt-4 rounded-lg border border-slate-500/20 bg-white/[0.02] p-3 text-[11.5px] text-slate-300 leading-relaxed">
                <div class="mb-1"><span class="text-amber-300 font-bold">Interpretação:</span> ${scenarioTxt}</div>
                <div class="text-slate-500 text-[10.5px]">${disclaimer}</div>
              </div>` : ''}
          </div>

          <!-- 2. Grid Indicadores Principais -->
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
            ${card('RSI 14 (1D)', Number.isFinite(rsi) ? rsi.toFixed(1) : '—', '',
              Number.isFinite(rsi) ? (rsi>=70 ? 'Sobrecomprado' : rsi<=30 ? 'Sobrevendido' : 'Neutro') : 'Sem dados')}
            ${card('MACD Hist (1D)', Number.isFinite(macdHist) ? (macdHist>=0?'+':'') + (atrPct && price ? ((macdHist/price*100).toFixed(3)) : macdHist.toFixed(2)) : '—', '',
              Number.isFinite(macdHist) ? (macdHist>0 ? 'Histograma positivo' : macdHist<0 ? 'Histograma negativo' : 'Cruzamento neutro') : 'Sem dados')}
            ${card('ATR (1D)', Number.isFinite(atr) ? fmtUsd(atr) : '—', '',
              Number.isFinite(atrPct) ? `Volatilidade: ${atrPct.toFixed(2)}% do preço` : '')}
            ${card('Bollinger %B (1D)', Number.isFinite(boll.pctB) ? (boll.pctB*100).toFixed(1)+'%' : '—', '',
              Number.isFinite(boll.pctB)
                ? (boll.pctB<=0 ? 'Fora banda inferior (suporte?)'
                  : boll.pctB>=1 ? 'Fora banda superior (resistência?)'
                  : `Posição: banda ${Math.round(boll.pctB*100)}%`)
                : 'Sem dados')}
            ${card('Suporte (1D)', Number.isFinite(support) ? fmtUsd(support) : '—', '',
              Number.isFinite(support) && price ? `Dist: ${((price-support)/price*100).toFixed(2)}% abaixo` : '')}
            ${card('Resistência (1D)', Number.isFinite(resistance) ? fmtUsd(resistance) : '—', '',
              Number.isFinite(resistance) && price ? `Dist: ${((resistance-price)/price*100).toFixed(2)}% acima` : '')}
            ${card('Tendência (1D)', escapeHtml(trend1d.trend || '—'), '',
              `Força: ${escapeHtml(trend1d.strength || '—')}`)}
            ${card('Volatilidade', escapeHtml(volLevel), '',
              Number.isFinite(atrPct) ? `ATR% ${atrPct.toFixed(2)}% · quanto maior, maior incerteza` : '')}
            ${card('Volume Médio 20', Number.isFinite(ind1d.volume?.avgVol) ? fmtUsdShort(ind1d.volume.avgVol) : '—', '',
              ind1d.volume?.status ? `Status: ${escapeHtml(ind1d.volume.status)}` : '')}
            ${card('Volume Relativo', Number.isFinite(ind1d.volume?.relative) ? ind1d.volume.relative.toFixed(2)+'x' : '—', '',
              Number.isFinite(ind1d.volume?.relative) ? (ind1d.volume.relative>=2.5 ? 'Aumento anormal' : ind1d.volume.relative>=1.2 ? 'Acima da média' : ind1d.volume.relative<=0.5 ? 'Em queda' : 'Normal') : '')}
            ${card('Momentum ROC (1D,10)', Number.isFinite(ind1d.momentum) ? (ind1d.momentum>=0?'+':'') + ind1d.momentum.toFixed(2)+'%' : '—', '',
              Number.isFinite(ind1d.momentum) ? (ind1d.momentum>0 ? 'Momentum positivo' : ind1d.momentum<0 ? 'Momentum negativo' : 'Neutro') : '')}
            ${card('Últ. Candle 1D', escapeHtml(ind1d.lastCandle?.pattern || '—'), '',
              (counts && Number.isFinite(counts.high24h) && Number.isFinite(counts.low24h)) ? `24h H/L: ${fmtUsd(counts.high24h)} / ${fmtUsd(counts.low24h)}` : '')}
          </div>

          <!-- 3. Multi-Timeframe table -->
          <div class="rounded-xl border border-surface-border bg-surface-card/60 p-4 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div class="text-[11.5px] font-bold text-white uppercase tracking-wider">Análise Multi-Timeframe</div>
              <div class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 border text-[10.5px] font-semibold ${mtfAlignCls}">
                Alinhamento geral: ${escapeHtml(mtfAlign)}
              </div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-[11px]">
                <thead>
                  <tr class="text-slate-500 uppercase tracking-wider text-[9.5px]">
                    <th class="text-left py-1.5 pr-3">TF</th>
                    <th class="text-left py-1.5 pr-3">Preço</th>
                    <th class="text-left py-1.5 pr-3">Tendência</th>
                    <th class="text-left py-1.5 pr-3">RSI</th>
                    <th class="text-left py-1.5 pr-3">MACD</th>
                    <th class="text-left py-1.5 pr-3">Volatilidade</th>
                    <th class="text-left py-1.5 pr-3">Volume Relativo</th>
                    <th class="text-left py-1.5 pr-3">Velas</th>
                  </tr>
                </thead>
                <tbody>
                ${['1m','5m','15m','1h','4h','1d'].map(tf => {
                  const i = r.indicators && r.indicators[tf] ? r.indicators[tf] : {};
                  const p = Number(i.priceNow);
                  const t = i.trend || {};
                  const rs = Number(i.rsi);
                  const mh = Number(i.macd?.histogram);
                  const vol = i.volatility?.level || '—';
                  const vr = Number(i.volume?.relative);
                  const n = Number(i.count);
                  return `<tr class="border-t border-white/5">
                    <td class="py-1.5 pr-3 font-bold text-slate-300">${tf.toUpperCase()}</td>
                    <td class="py-1.5 pr-3 text-slate-300 font-mono">${p ? fmtUsd(p) : '—'}</td>
                    <td class="py-1.5 pr-3">${t.trend ? `<span class="inline-flex rounded px-1.5 py-0.5 border text-[10px] font-semibold ${clsScenario(t.trend)}">${escapeHtml(t.trend)}</span>` : '—'}</td>
                    <td class="py-1.5 pr-3 text-slate-300 font-mono">${Number.isFinite(rs)?rs.toFixed(1):'—'}</td>
                    <td class="py-1.5 pr-3 text-slate-300 font-mono">${Number.isFinite(mh)?(mh>=0?'+':'') + mh.toFixed(2):'—'}</td>
                    <td class="py-1.5 pr-3 text-slate-300">${escapeHtml(vol)}</td>
                    <td class="py-1.5 pr-3 text-slate-300 font-mono">${Number.isFinite(vr)?vr.toFixed(2)+'x':'—'}</td>
                    <td class="py-1.5 pr-3 text-slate-400">${n || '—'}</td>
                  </tr>`;
                }).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- 4. Fatores Positivos / Negativos -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-4 space-y-2">
              <div class="text-[11.5px] font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Fatores positivos (${positives.length})
              </div>
              ${positives.length ? `<ul class="space-y-1.5 text-[11px] text-emerald-200/90 leading-relaxed list-disc list-inside marker:text-emerald-400/70">${positives.slice(0,8).map(p=>`<li>${escapeHtml(p)}</li>`).join('')}</ul>`
                                 : `<div class="text-[10.5px] text-emerald-200/50">Nenhum fator positivo destacado nesta coleta.</div>`}
            </div>
            <div class="rounded-xl border border-rose-400/20 bg-rose-500/5 p-4 space-y-2">
              <div class="text-[11.5px] font-bold text-rose-300 uppercase tracking-wider flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
                Fatores negativos / cautelas (${negatives.length})
              </div>
              ${negatives.length ? `<ul class="space-y-1.5 text-[11px] text-rose-200/90 leading-relaxed list-disc list-inside marker:text-rose-400/70">${negatives.slice(0,8).map(p=>`<li>${escapeHtml(p)}</li>`).join('')}</ul>`
                                 : `<div class="text-[10.5px] text-rose-200/50">Nenhum fator de risco destacado nesta coleta.</div>`}
            </div>
          </div>

          <!-- 5. Notícias / Eventos consideradas -->
          <div class="rounded-xl border border-surface-border bg-surface-card/60 p-4 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div class="text-[11.5px] font-bold text-white uppercase tracking-wider">Notícias / Eventos considerados (${news.length})</div>
              <div class="text-[10px] text-slate-500">Conteúdo externo é DADO, não COMANDO.</div>
            </div>
            ${news.length === 0
              ? `<div class="text-[11px] text-slate-500">Nenhuma notícia coletada nesta rodada.</div>`
              : `<div class="space-y-2">${news.slice(0, 10).map(n => {
                const impact = Number(n.impactScore);
                const impCls = impact >= 0.4 ? 'text-emerald-400' : impact <= -0.4 ? 'text-rose-400' : 'text-slate-400';
                return `<div class="rounded-lg border border-white/5 bg-white/[0.02] p-2.5 text-[11px] space-y-1">
                  <div class="flex items-start gap-2 min-w-0">
                    <span class="inline-flex shrink-0 rounded px-1.5 py-0.5 border text-[9.5px] font-bold ${newsClsColor(n.classification)}">${escapeHtml(n.classification || 'NÃO CLASSIFICADO')}</span>
                    <span class="inline-flex shrink-0 rounded px-1.5 py-0.5 border bg-white/5 text-[9.5px] border-slate-500/20 ${impCls} font-bold">
                      Impacto ${impact>=0?'+':''}${impact.toFixed(2)}
                    </span>
                    <span class="text-[10px] text-slate-500 shrink-0 font-mono">${fmtDate(n.publishedAtMs)}</span>
                    <span class="text-[10px] text-slate-500 shrink-0 ml-auto truncate max-w-[200px]">${escapeHtml(String(n.source || ''))}</span>
                  </div>
                  <div class="text-slate-200 leading-snug">${escapeHtml(String(n.title || ''))}</div>
                  ${n.url ? `<a href="${escapeHtml(String(n.url))}" target="_blank" rel="noopener noreferrer nofollow" class="text-[10px] text-sky-300 hover:text-sky-200 underline break-all">Fonte</a>` : ''}
                  <div class="text-[9.5px] text-slate-500">Confiança nesta notícia: ${Math.round((Number(n.trustLevel)||0)*100)}%</div>
                </div>`;
              }).join('')}</div>`
            }
          </div>

          <!-- 6. Footer: Atualização / Fontes / Debug leve -->
          <div class="rounded-xl border border-slate-500/20 bg-white/[0.015] p-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] text-slate-500">
            <div>Atualizado: <span class="text-slate-300 font-semibold">${fmtDate(r.finishedAtMs || r._ts || r.startedAtMs)}</span></div>
            <div>Duração coleta: <span class="text-slate-300">${Number.isFinite(duration) ? duration + 'ms' : '—'}</span></div>
            <div>Fontes: <span class="text-slate-300">${escapeHtml(sources)}</span></div>
            <div>Timeframes OK: <span class="text-slate-300">${(r.timeframeSummary?.available||[]).join(', ') || '0'}</span></div>
            <div>TFs sem dados: <span class="text-slate-300">${(['1m','5m','15m','1h','4h','1d'].filter(k=>!(r.timeframeSummary?.available||[]).includes(k)).join(', ') || '0')}</span></div>
            <div>Versão schema: <span class="text-slate-300">${escapeHtml(String(r.version || '?'))}</span></div>
          </div>
        `;
      }

      // -------- Histórico ----------
      async function _btcOpenHistory() {
        if (!els.btcHistoryPanel) return;
        try {
          const r = await fetch('/api/btc/history?limit=100').then(r=>r.json());
          state.btcHistory = r && r.items ? r.items : [];
          els.btcHistoryPanel.classList.remove('hidden');
          const items = state.btcHistory;
          els.btcHistoryPanel.innerHTML = `
            <div class="flex items-center justify-between gap-2 mb-2">
              <div class="text-[11.5px] font-bold text-emerald-300 uppercase tracking-wider">Histórico (${items.length})</div>
              <button id="btc-history-close" class="text-[10.5px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/5 text-slate-300 transition">Fechar</button>
            </div>
            ${items.length === 0
              ? `<div class="text-[11px] text-slate-500">Sem histórico ainda. Realize uma coleta para começar a salvar.</div>`
              : `<div class="overflow-x-auto">
                <table class="w-full text-[11px]">
                  <thead><tr class="text-slate-500 uppercase tracking-wider text-[9.5px]">
                    <th class="text-left py-1 pr-3">Horário</th>
                    <th class="text-left py-1 pr-3">Preço</th>
                    <th class="text-left py-1 pr-3">Score</th>
                    <th class="text-left py-1 pr-3">Cenário</th>
                    <th class="text-left py-1 pr-3">TF Alinhamento</th>
                    <th class="text-left py-1 pr-3">Risco</th>
                  </tr></thead>
                  <tbody>
                  ${items.map(x => `<tr class="border-t border-white/5">
                    <td class="py-1 pr-3 text-slate-300 font-mono whitespace-nowrap">${fmtDate(x.ts)}</td>
                    <td class="py-1 pr-3 text-slate-300 font-mono">${fmtUsd(Number(x.price))}</td>
                    <td class="py-1 pr-3 font-bold ${clsScoreColor(Number(x.score))}">${Number(x.score).toFixed(0)}/100</td>
                    <td class="py-1 pr-3"><span class="inline-flex rounded px-1.5 py-0.5 border text-[10px] font-semibold ${clsScenario(x.scenario)}">${escapeHtml(x.scenario || '—')}</span></td>
                    <td class="py-1 pr-3 text-slate-300">${escapeHtml(x.mtfAlign || '—')}</td>
                    <td class="py-1 pr-3"><span class="inline-flex rounded px-1.5 py-0.5 border text-[10px] font-semibold ${clsRiskLabel(x.riskLevel)}">${escapeHtml(x.riskLevel || '—')}</span></td>
                  </tr>`).join('')}
                  </tbody>
                </table></div>`
            }
          `;
          document.getElementById('btc-history-close')?.addEventListener('click', () => els.btcHistoryPanel?.classList.add('hidden'));
        } catch (e) {
          toast('Erro ao carregar histórico: ' + (e?.message || e), 'err');
        }
      }

      // -------- Backtest ----------
      async function _btcOpenBacktest() {
        if (!els.btcBacktestPanel) return;
        els.btcBacktestPanel.classList.remove('hidden');
        els.btcBacktestPanel.innerHTML = `<div class="text-[11px] text-sky-300 inline-flex items-center gap-2"><svg width="14" height="14" class="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Rodando backtest (coleta dados históricos 1d de Binance/CoinGecko + simulação)… Pode levar ~10s.</div>`;
        try {
          const r = await fetch('/api/btc/backtest').then(r=>r.json());
          state.btcBacktest = r;
          const s = r && r.summary ? r.summary : {};
          els.btcBacktestPanel.innerHTML = `
            <div class="flex items-center justify-between gap-2 mb-2">
              <div class="text-[11.5px] font-bold text-sky-300 uppercase tracking-wider">Backtest · ${escapeHtml(r.label || '')}</div>
              <button id="btc-backtest-close" class="text-[10.5px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/5 text-slate-300 transition">Fechar</button>
            </div>
            ${r && r.ok === false
              ? `<div class="text-[11px] text-rose-300">Erro: ${escapeHtml(String(r.error || ''))}</div>`
              : `<div class="space-y-2">
                <div class="text-[11px] text-slate-400 leading-relaxed">${escapeHtml(String(s.note || r.note || ''))}${s.warning ? ` ⚠️ ${escapeHtml(String(s.warning))}` : ''}</div>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  ${card('Velas Input', String(s.candlesInput || 0))}
                  ${card('Sinais Avaliados', String(s.signalsEvaluated || 0))}
                  ${card('Acurácia (sinais não-neutros)', Number.isFinite(s.accuracyPct) ? s.accuracyPct.toFixed(1)+'%' : '—')}
                  ${card('Total não-neutros', String(s.counts?.totalNaoNeutro || 0))}
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  ${card('Alta confirmada (HIT)', String(s.counts?.altaConfirm || 0), 'border-emerald-400/20 bg-emerald-500/5')}
                  ${card('Alta falhou (MISS)', String(s.counts?.altaFalha || 0), 'border-rose-400/20 bg-rose-500/5')}
                  ${card('Baixa confirmada (HIT)', String(s.counts?.baixaConfirm || 0), 'border-emerald-400/20 bg-emerald-500/5')}
                  ${card('Baixa falhou (MISS)', String(s.counts?.baixaFalha || 0), 'border-rose-400/20 bg-rose-500/5')}
                  ${card('Neutros (ignorados)', String(s.counts?.neutro || 0))}
                </div>
                ${r.sample && Array.isArray(r.sample) && r.sample.length ? `
                <div class="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
                  <div class="text-[10.5px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">Últimos ${r.sample.length} sinais do backtest</div>
                  <div class="overflow-x-auto">
                  <table class="w-full text-[10.5px]">
                    <thead><tr class="text-slate-500 uppercase tracking-wider text-[9px]">
                      <th class="text-left py-1 pr-2">Data</th>
                      <th class="text-left py-1 pr-2">Preço</th>
                      <th class="text-left py-1 pr-2">Score</th>
                      <th class="text-left py-1 pr-2">Cenário</th>
                      <th class="text-left py-1 pr-2">TF Alinh.</th>
                      <th class="text-left py-1 pr-2">Δ1</th>
                      <th class="text-left py-1 pr-2">Δ5</th>
                      <th class="text-left py-1 pr-2">Δ20</th>
                      <th class="text-left py-1 pr-2">Resultado</th>
                    </tr></thead>
                    <tbody>
                    ${r.sample.map(x => `<tr class="border-t border-white/5">
                      <td class="py-1 pr-2 text-slate-300 font-mono whitespace-nowrap">${escapeHtml(String(x.dateISO).slice(0,10))}</td>
                      <td class="py-1 pr-2 text-slate-300 font-mono">${fmtUsd(Number(x.priceNow))}</td>
                      <td class="py-1 pr-2 font-bold ${clsScoreColor(Number(x.score))}">${Number(x.score).toFixed(0)}</td>
                      <td class="py-1 pr-2"><span class="inline-flex rounded px-1 py-0.5 border text-[9.5px] font-semibold ${clsScenario(x.scenario)}">${escapeHtml(x.scenario||'')}</span></td>
                      <td class="py-1 pr-2 text-slate-300">${escapeHtml(x.mtfAlign||'')}</td>
                      <td class="py-1 pr-2 text-slate-300 font-mono">${fmtPct(Number(x.delta1Pct),1)}</td>
                      <td class="py-1 pr-2 text-slate-300 font-mono">${fmtPct(Number(x.delta5Pct),1)}</td>
                      <td class="py-1 pr-2 text-slate-300 font-mono">${fmtPct(Number(x.delta20Pct),1)}</td>
                      <td class="py-1 pr-2"><span class="inline-flex rounded px-1 py-0.5 border text-[9.5px] font-semibold ${String(x.resultHIT_MISS||'').startsWith('HIT') ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' : String(x.resultHIT_MISS||'').startsWith('MISS') ? 'bg-rose-500/15 text-rose-300 border-rose-400/30' : 'bg-white/5 text-slate-300'}">${escapeHtml(x.resultHIT_MISS||'—')}</span></td>
                    </tr>`).join('')}
                    </tbody>
                  </table></div>
                </div>` : ''}
              </div>`
            }
          `;
          document.getElementById('btc-backtest-close')?.addEventListener('click', () => els.btcBacktestPanel?.classList.add('hidden'));
        } catch (e) {
          els.btcBacktestPanel.innerHTML = `<div class="text-[11px] text-rose-300">Erro no backtest: ${escapeHtml(String(e?.message || e))}</div>`;
          toast('Erro backtest: ' + (e?.message || e), 'err');
        }
      }

      // -------- Coleta manual ----------
      async function _btcManualCollect() {
        const btn = els.btcManualBtn;
        if (!btn) return;
        const origHTML = btn.innerHTML;
        try {
          btn.disabled = true;
          btn.classList.add('opacity-60', 'cursor-wait');
          btn.innerHTML = `<svg width="10" height="10" class="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><span>Coletando…</span>`;
          if (els.btcSpinner) { els.btcSpinner.classList.remove('hidden'); els.btcDashboard?.classList.add('hidden'); }
          const r = await fetch('/api/btc/manual', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }).then(r=>r.json());
          if (r && r.report && typeof r.report === 'object') {
            state.lastBtcReport = r.report;
            renderBtcDashboard();
            toast(`₿ Coleta manual OK · score ${r.report.score?.toFixed?.(0)??'?'} · ${r.report.scenario ?? '?'} · ${r.alertsFired||0} alertas novos`, 'ok');
          } else {
            throw new Error(r && r.error ? String(r.error) : 'Resposta inválida.');
          }
        } catch (e) {
          toast('Erro coleta BTC: ' + (e?.message || e), 'err');
        } finally {
          btn.disabled = false;
          btn.classList.remove('opacity-60','cursor-wait');
          btn.innerHTML = origHTML;
        }
      }

      // -------- Anexar listeners dos 3 botões ----------
      if (els.btcManualBtn && !els.btcManualBtn.__btcAtt) {
        els.btcManualBtn.addEventListener('click', () => _btcManualCollect());
        els.btcManualBtn.__btcAtt = true;
      }
      if (els.btcBacktestBtn && !els.btcBacktestBtn.__btcAtt) {
        els.btcBacktestBtn.addEventListener('click', () => _btcOpenBacktest());
        els.btcBacktestBtn.__btcAtt = true;
      }
      if (els.btcHistoryBtn && !els.btcHistoryBtn.__btcAtt) {
        els.btcHistoryBtn.addEventListener('click', () => _btcOpenHistory());
        els.btcHistoryBtn.__btcAtt = true;
      }
      console.debug('[BTC UI] módulo carregado. refs: btcPanel=', Boolean(els.btcPanel), ', btcDashboard=', Boolean(els.btcDashboard), ', btcManualBtn=', Boolean(els.btcManualBtn));
    } catch (btcInitErr) { console.warn('[BTC UI] init WARN', btcInitErr); }
  })();

})();

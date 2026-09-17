/* ==========================================================
   TRAE Agent — Frontend
   ========================================================== */
marked?.setOptions({ breaks: true, gfm: true, mangle: false, headerIds: false });
try { if (window.hljs) {
  const langs = ['javascript','typescript','python','json','bash','css','xml','html'];
  for (const l of langs) {
    const key = l === 'html' ? 'Html' : l === 'javascript' ? 'Javascript' : l === 'typescript' ? 'Typescript' : l === 'python' ? 'Python' : l === 'json' ? 'Json' : l === 'bash' ? 'Bash' : l === 'css' ? 'Css' : l === 'xml' ? 'Xml' : l[0].toUpperCase()+l.slice(1);
    const mod = window['hljs'+key];
    if (mod) try { hljs.registerLanguage(l, mod); } catch{}
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
function connectWS() {
  setStatus('pending', 'Conectando…', 'Abrindo conexão');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;

  ws.addEventListener('open', () => {
    setStatus('ok', 'Conectado', 'Pronto para começar');
    state.connected = true;
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
    setTimeout(connectWS, 2000);
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
      if (msg.data.project) { state.project = msg.data.project; applyProjectUI(); }
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
  const allowed = ['code','preview','console','terminal'];
  if (allowed.includes(activeKey) || n.startsWith('code:')) {
    if (els.editorPanels) els.editorPanels.dataset.active = activeKey;
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

  const wrap = ensureAIMessageWrap(data.id);
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
  const specials = ['preview','console','terminal','code'];
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
  if (['preview','console','terminal','chat','code'].includes(String(name))) {
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
})();

/* =========================================================
 * TiAgente Security · app.js (UI própria, independente do criador)
 * ========================================================= */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&'+{ '&':'amp','<':'lt','>':'gt','"':'quot',"'":'#39' }[c]+';');
const escapeAttr = escapeHtml;

const els = {
  statusChip: $('#sec-status-chip'),
  statusDot:  $('#sec-status-dot'),
  statusText: $('#sec-status-text'),
  reload: $('#sec-reload'),
  goCriador: $('#sec-goto-criador'),
  search: $('#sec-projects-search'),
  count:  $('#sec-projects-count'),
  list:   $('#sec-project-list'),
  rightEmpty: $('#sec-right-empty'),
  rightProj:  $('#sec-right-project'),
  title: $('#sec-project-title'),
  source: $('#sec-project-source'),
  port: $('#sec-project-port'),
  pathBox: $('#sec-project-path'),
  btnAudit: $('#sec-audit-start'),
  btnAi: $('#sec-ai-explain'),
  btnBackupModal: $('#sec-backup-restore-open'),
  scorecard: $('#sec-scorecard-container'),
  tabs: $('#sec-tabs'),
  tabPanels: $$('[data-sec-tab-panel]'),
  backupModal: $('#sec-modal-backup'),
  backupClose: $('#sec-modal-backup-close'),
  backupList: $('#sec-modal-backup-list'),
  urlAuditPanel: document.querySelector('[data-sec-tab-panel="urlaudit"]'),
  urlModal: $('#sec-modal-url-confirm'),
  urlModalClose: $('#sec-url-confirm-close'),
  urlModalCancelBtn: $('#sec-url-cancel-btn'),
  urlModalConfirmBtn: $('#sec-url-confirm-btn'),
  urlModalSubtitle: $('#sec-url-confirm-subtitle'),
  urlModalUrlBox: $('#sec-url-confirm-url'),
  urlModalPlan: $('#sec-url-confirm-plan'),
  urlModalWarn: $('#sec-url-confirm-warn'),
  urlModalTtl: $('#sec-url-confirm-ttl'),
  urlOwnCheck: $('#sec-url-own-check'),
  urlWafCheck: $('#sec-url-waf-check'),
  toast: $('#sec-toast'),
};

const state = {
  projects: [],
  currentProject: null,
  audit: null,
  lastAuditId: null,
  lastDiff: null,    // diff after apply
  lastApplied: null, // applied fixes
  approvedSeverity: new Set(['baixo']),
  approvedFindingIds: new Set(),
  lastUrlReport: null,
  _urlConfirm: { token: null, ttl: null, ttlTimer: null },
};

/* ================= Helpers UI ================= */
function toast(msg, kind='ok') {
  const t = els.toast;
  t.textContent = msg;
  if (kind === 'err')     t.className = 'fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-lg border text-[12px] font-bold backdrop-blur-md max-w-sm break-words bg-red-950/95 border-red-500/30 text-red-200';
  else if (kind === 'warn') t.className = 'fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-lg border text-[12px] font-bold backdrop-blur-md max-w-sm break-words bg-amber-950/95 border-amber-500/40 text-amber-100';
  else                    t.className = 'fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-lg border text-[12px] font-bold backdrop-blur-md max-w-sm break-words bg-emerald-950/95 border-emerald-500/30 text-emerald-100';
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), kind === 'warn' || kind === 'err' ? 6000 : 3200);
}
function sevBadge(s) {
  switch (s) {
    case 'critico': return `<span class="px-2 py-0.5 text-[9.5px] rounded-md font-bold uppercase tracking-wide bg-red-500/10 text-red-300 border border-red-400/30">Crítico</span>`;
    case 'alto':    return `<span class="px-2 py-0.5 text-[9.5px] rounded-md font-bold uppercase tracking-wide bg-orange-500/10 text-orange-300 border border-orange-400/30">Alto</span>`;
    case 'medio':   return `<span class="px-2 py-0.5 text-[9.5px] rounded-md font-bold uppercase tracking-wide bg-amber-500/10 text-amber-300 border border-amber-400/30">Médio</span>`;
    case 'baixo':   return `<span class="px-2 py-0.5 text-[9.5px] rounded-md font-bold uppercase tracking-wide bg-cyan-500/10 text-cyan-300 border border-cyan-400/30">Baixo</span>`;
    case 'seguro':  return `<span class="px-2 py-0.5 text-[9.5px] rounded-md font-bold uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-400/30">Seguro</span>`;
    default:        return `<span class="px-2 py-0.5 text-[9.5px] rounded-md font-bold uppercase tracking-wide bg-white/5 text-slate-400 border border-white/10">?</span>`;
  }
}
function gradeBadge(g, score) {
  const palette = {
    'A+': ['from-emerald-500 to-teal-500', 'text-white', 'Nenhum ou quase nenhum risco. Parabéns!'],
    'A':  ['from-emerald-500 to-cyan-500', 'text-white', 'Risco baixo. Pequenos ajustes.' ],
    'B':  ['from-cyan-500 to-blue-500', 'text-white', 'Risco moderado. Ajustes recomendados.' ],
    'C':  ['from-amber-500 to-orange-500', 'text-white', 'Risco alto. Corrija o mais rápido possível.' ],
    'D':  ['from-orange-500 to-red-500', 'text-white', 'Risco crítico. Não coloque este projeto em produção sem corrigir.' ],
    'F':  ['from-red-500 to-pink-600', 'text-white', 'Risco extremo. UAU. Pare tudo e corrija AGORA.' ],
  };
  const [grad, tc, desc] = palette[g] || palette['C'];
  return `
    <div class="flex items-center gap-4 p-4 rounded-2xl border border-white/[0.06] bg-gradient-to-br ${grad} shadow-lg">
      <div class="flex flex-col items-center justify-center w-20 h-20 shrink-0 rounded-2xl bg-black/25 border border-white/10">
        <div class="${tc} font-black leading-none text-[36px]">${g}</div>
        <div class="${tc} text-[9.5px] font-bold mt-0.5 opacity-80">SCORE ${score}</div>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-white font-extrabold text-[15px] leading-tight mb-1">Segurança geral do projeto</div>
        <div class="text-white/90 text-[12px] leading-relaxed opacity-95">${desc}</div>
      </div>
    </div>`;
}
function fmtDate(ts) { try { return new Date(ts).toLocaleString('pt-BR'); } catch { return ''; } }

/* ================= INIT ================= */
(async function init() {
  // carrega status
  let status;
  try {
    const r = await fetch('/api/status').then(r => r.json());
    status = r;
  } catch { status = { ok: false }; }
  if (status && status.ok) {
    els.statusDot.className = 'w-1.5 h-1.5 rounded-full ' + (status.googleKeyOk ? 'bg-emerald-400' : 'bg-amber-400');
    els.statusText.textContent = (status.googleKeyOk ? `On · chave Gemini ${status.googleKeyPrefix || ''}` : 'On · heurística apenas (sem IA)');
    if (els.goCriador) els.goCriador.href = 'http://localhost:3000/';
  } else {
    els.statusDot.className = 'w-1.5 h-1.5 rounded-full bg-red-400 dot-pulse';
    els.statusText.textContent = 'Off · servidor indisponível';
  }

  await loadProjects();

  els.reload.addEventListener('click', loadProjects);
  els.search.addEventListener('input', renderProjectList);

  $$('.sec-tab', els.tabs).forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.secTab));
  });

  els.btnAudit.addEventListener('click', runAudit);
  els.btnAi.addEventListener('click', aiExplain);
  els.btnBackupModal.addEventListener('click', openBackupsModal);
  els.backupClose.addEventListener('click', () => els.backupModal.classList.add('hidden'));
  els.backupModal.addEventListener('click', (e) => { if (e.target === els.backupModal) els.backupModal.classList.add('hidden'); });

  // URL Audit listeners
  els.urlModalClose?.addEventListener('click', closeUrlConfirmModal);
  els.urlModalCancelBtn?.addEventListener('click', closeUrlConfirmModal);
  els.urlModal?.addEventListener('click', (e) => { if (e.target === els.urlModal) closeUrlConfirmModal(); });
  els.urlOwnCheck?.addEventListener('change', updateUrlConfirmBtnState);
  els.urlWafCheck?.addEventListener('change', updateUrlConfirmBtnState);
  els.urlModalConfirmBtn?.addEventListener('click', runUrlAuditStep2);
})();

async function loadProjects() {
  try {
    const { projects } = await fetch('/api/projects').then(r => r.json());
    state.projects = projects || [];
    els.count.textContent = `${state.projects.length} projeto${state.projects.length===1?'':'s'} · workspace + mounted (TiAgente Criador)`;
    renderProjectList();
  } catch (e) {
    toast('Erro ao carregar projetos: ' + String(e.message||e), 'err');
  }
}
function renderProjectList() {
  const q = (els.search.value || '').toLowerCase().trim();
  const items = state.projects.filter(p => !q || p.displayName.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q));
  const html = items.map(p => `
    <li>
      <button class="project-item w-full text-left px-3 py-2.5 m-1.5 rounded-lg border transition" data-project-slug="${escapeAttr(p.slug)}" data-active="${state.currentProject && state.currentProject.slug===p.slug?1:0}">
        <div class="flex items-center gap-2 min-w-0">
          <div class="w-8 h-8 shrink-0 rounded-lg grid place-items-center border ${p.source==='mounted'?'bg-cyan-500/10 border-cyan-400/30 text-cyan-300':'bg-emerald-500/10 border-emerald-400/30 text-emerald-300'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[12.5px] font-bold truncate text-white/95">${escapeHtml(p.displayName)}</div>
            <div class="text-[10px] text-slate-500 font-mono truncate leading-tight mt-0.5">${escapeHtml((p.slug || '') + (p.port ? ' · :'+p.port : ''))}</div>
          </div>
        </div>
      </button>
    </li>
  `).join('');
  els.list.innerHTML = items.length ? `<ul class="space-y-0.5">${html}</ul>` : `<div class="px-4 py-8 text-center text-[12px] text-slate-500">Nenhum projeto encontrado.</div>`;
  $$('.project-item', els.list).forEach(btn => btn.addEventListener('click', () => selectProject(btn.dataset.projectSlug)));
}
function selectProject(slug) {
  const p = state.projects.find(x => x.slug === slug);
  if (!p) return;
  state.currentProject = p;
  state.audit = null; state.lastAuditId = null; state.lastDiff = null; state.lastApplied = null;
  state.approvedFindingIds.clear();

  els.rightEmpty.classList.add('hidden');
  els.rightProj.classList.remove('hidden');
  els.title.textContent = p.displayName;
  els.source.textContent = p.source === 'mounted' ? 'mounted · pasta externa' : 'workspace interno';
  els.pathBox.textContent = p.path;
  els.pathBox.title = p.path;
  if (p.port) { els.port.classList.remove('hidden'); els.port.textContent = ':' + p.port; } else { els.port.classList.add('hidden'); }

  els.btnAudit.disabled = false;
  els.btnAi.disabled = true;

  els.scorecard.innerHTML = `
    <div class="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-5 text-center text-[12px] text-slate-400">
      🛡️ Auditoria ainda não executada para este projeto.<br>Clique em <strong class="text-white">▶️ Iniciar Auditoria</strong> no canto superior direito.
    </div>`;
  $$('[data-sec-tab-panel]').forEach(p => p.innerHTML = '');
  switchTab('vulns');
  renderProjectList();
}

function switchTab(tab) {
  $$('.sec-tab', els.tabs).forEach(b => b.dataset.active = b.dataset.secTab === tab ? '1' : '0');
  els.tabPanels.forEach(p => p.classList.toggle('hidden', p.dataset.secTabPanel !== tab));
  if (tab === 'urlaudit') renderUrlAuditTab();
}

/* ================= AUDIT ================= */
async function runAudit() {
  if (!state.currentProject) return;
  const slug = state.currentProject.slug;
  els.btnAudit.disabled = true;
  const orig = els.btnAudit.innerHTML;
  els.btnAudit.innerHTML = `<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-white dot-pulse"></span>Escaneando arquivos…</span>`;
  try {
    const r = await fetch('/api/audit/start_with_ids', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ slug }) }).then(r => r.json());
    if (!r.ok) throw new Error(r.error || 'Falha na auditoria');
    state.audit = r.report;
    state.lastAuditId = r.auditId;
    state.lastDiff = null; state.lastApplied = null;
    state.approvedFindingIds.clear();
    applyApprovedBySeverityDefaults();
    renderScorecard();
    renderVulnsTab();
    renderApproveTab();
    renderDiffTab();
    els.btnAi.disabled = false;
    switchTab('vulns');
    toast(`Auditoria OK · ${state.audit.files} arquivos · Score ${state.audit.score} · Nota ${state.audit.grade}`, 'ok');
  } catch (e) {
    toast('Erro auditoria: ' + String(e.message||e), 'err');
  } finally {
    els.btnAudit.disabled = false;
    els.btnAudit.innerHTML = orig;
  }
}

function applyApprovedBySeverityDefaults() {
  if (!state.audit) return;
  for (const f of state.audit.findings) {
    if (state.approvedSeverity.has(f.severity)) state.approvedFindingIds.add(f.findingId);
  }
}

function renderScorecard() {
  if (!state.audit) { els.scorecard.innerHTML = ''; return; }
  const a = state.audit;
  const bars = [
    ['critico','Crítico', a.counts.critico || 0, 'bg-red-500/80'],
    ['alto','Alto',    a.counts.alto    || 0, 'bg-orange-500/80'],
    ['medio','Médio',   a.counts.medio   || 0, 'bg-amber-500/80'],
    ['baixo','Baixo',   a.counts.baixo   || 0, 'bg-cyan-500/80'],
  ];
  const total = a.files || 1;
  els.scorecard.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div class="md:col-span-1">${gradeBadge(a.grade, a.score)}</div>
      <div class="md:col-span-2 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 space-y-2.5">
        <div class="flex items-center justify-between">
          <div class="text-white font-bold text-[12.5px]">Resumo de severidades</div>
          <div class="text-[10.5px] text-slate-500 font-mono">${a.files} arquivos · ${(a.bytes/1024).toFixed(0)} KB escaneados</div>
        </div>
        ${bars.map(([k,label,n,bg]) => `
          <div>
            <div class="flex items-center justify-between mb-1 text-[11px]">
              <div class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full ${bg}"></span><span class="text-slate-300 font-bold">${label}</span></div>
              <div class="text-slate-300 font-mono">${n}</div>
            </div>
            <div class="h-1.5 rounded-full bg-black/30 overflow-hidden">
              <div class="${bg} h-full transition-all duration-300" style="width:${Math.min(100, n === 0 ? 0 : 8 + Math.min(92, (n / Math.max(1, bars.reduce((m,b)=>Math.max(m,b[2]),0))*100)))}%"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderVulnsTab() {
  const panel = document.querySelector('[data-sec-tab-panel="vulns"]');
  if (!state.audit) { panel.innerHTML = `<div class="text-[12px] text-slate-500">Auditoria ainda não executada.</div>`; return; }
  const a = state.audit;
  const bySeverity = { critico: [], alto: [], medio: [], baixo: [], seguro: [] };
  for (const f of a.findings) (bySeverity[f.severity] || bySeverity.baixo).push(f);

  const sections = [];
  for (const sev of ['critico','alto','medio','baixo','seguro']) {
    const list = bySeverity[sev];
    if (!list || !list.length) continue;
    const rows = list.map((f, idx) => {
      const canAuto = /SEC-HC-|SEC-.*KEY|SEC-HC-ANYKEY/.test(f.ruleId);
      return `
      <div class="group rounded-xl border border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.04] transition">
        <div class="flex items-start gap-3 p-3.5">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap mb-1.5">
              ${sevBadge(sev)}
              <div class="text-white font-bold text-[12px] leading-tight">${escapeHtml(f.title)}</div>
              <div class="text-[9.5px] text-slate-500 font-mono">${escapeHtml(f.ruleId)}${f.findingId?' · id '+f.findingId.slice(0,8):''}</div>
            </div>
            <div class="text-[11.5px] text-slate-300 leading-relaxed mb-2">${escapeHtml(f.description)}</div>
            <div class="flex items-center gap-2 flex-wrap">
              <div class="text-[10.5px] font-mono px-2 py-1 rounded-md bg-black/25 border border-white/5 text-slate-300 max-w-full truncate">
                📄 ${escapeHtml(f.file || '—')}${f.line ? ':' + f.line : ''}
              </div>
              ${canAuto ? `<button type="button" data-autofix-finding-id="${escapeAttr(f.findingId)}" class="text-[9.5px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-400/20 font-bold uppercase tracking-wider hover:bg-emerald-500/20 active:bg-emerald-500/30 transition cursor-pointer">🔧 Corrigir</button>`
                      : `<span class="text-[9.5px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-400/20 font-bold uppercase tracking-wider">Correção manual recomendada</span>`}
            </div>
            ${f.context ? `<div class="mt-2.5 rounded-lg bg-black/35 border border-white/5 px-3 py-2 text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-words"><div class="text-slate-500 text-[9.5px] font-bold uppercase tracking-wider mb-0.5">Contexto / linha</div>${escapeHtml(f.context)}</div>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
    sections.push(`
      <div class="mb-4">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">${sevBadge(sev)} <div class="text-[12px] font-bold text-slate-200">${list.length} ${list.length===1?'ocorrência':'ocorrências'}</div></div>
        </div>
        <div class="space-y-2">${rows}</div>
      </div>
    `);
  }
  panel.innerHTML = a.findings.length
    ? sections.join('')
    : `<div class="rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-6 text-[12.5px] text-emerald-300">🎉 Nenhuma vulnerabilidade encontrada no scan heurístico. Ainda assim recomendamos revisão manual periódica.</div>`;

  $$('button[data-autofix-finding-id]', panel).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.autofixFindingId;
      if (!id || !state.audit || !state.currentProject) return;
      const f = state.audit.findings.find(x => x.findingId === id);
      if (!f) return;
      (async () => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm grid place-items-center p-4 animate-in fade-in duration-200';
        modal.innerHTML = `
          <div class="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl overflow-hidden">
            <div class="px-5 py-4 border-b border-white/5 flex items-start gap-3">
              <div class="w-10 h-10 shrink-0 rounded-xl bg-amber-500/20 border border-amber-400/30 grid place-items-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="text-amber-300"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-white font-extrabold text-[14px] mb-0.5">Confirmação de segurança obrigatória</div>
                <div class="text-slate-400 text-[11.5px]">
                  Aplicar correção individual em <span class="font-mono text-amber-200">${escapeHtml(f.file||'?')}${f.line?':'+f.line:''}</span><br>
                  Regra: <span class="font-mono text-amber-200">${escapeHtml(f.ruleId)}</span>
                </div>
              </div>
              <button type="button" data-close class="text-slate-400 hover:text-white w-7 h-7 grid place-items-center rounded-lg hover:bg-white/5 transition shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="px-5 py-4 space-y-3 bg-zinc-900/40">
              <ul class="space-y-1.5 text-[11.5px] text-slate-300 leading-relaxed">
                <li class="flex items-start gap-2"><span class="text-emerald-300 mt-0.5">✅</span><span>Backup <strong>automático completo</strong> do projeto criado em <span class="font-mono">./backups/${escapeHtml(state.currentProject?.slug||'')}/</span> antes de qualquer alteração.</span></li>
                <li class="flex items-start gap-2"><span class="text-emerald-300 mt-0.5">✅</span><span>Correção automática <strong>COMENTA</strong> a linha suspeita e adiciona um <span class="font-mono">FIXME</span> para revisão manual posterior (não apaga código).</span></li>
                <li class="flex items-start gap-2"><span class="text-emerald-300 mt-0.5">✅</span><span>Se algo quebrar, restaure o backup pelo botão <strong>Backups / Restaurar</strong> no cabeçalho do projeto.</span></li>
                <li class="flex items-start gap-2"><span class="text-emerald-300 mt-0.5">✅</span><span>TiAgente Security <strong>não mexe</strong> no TiAgente Criador (<code>server.js</code>, <code>public/</code>, etc).</span></li>
              </ul>
              <label class="flex items-start gap-2 cursor-pointer rounded-xl p-3 bg-white/[0.025] border border-white/5 hover:bg-white/[0.04] transition">
                <input data-c type="checkbox" class="mt-0.5 w-4 h-4 shrink-0 accent-emerald-500">
                <div class="flex-1 min-w-0 text-[11.5px] leading-relaxed">
                  <span class="font-bold text-amber-200 block mb-0.5">Li e concordo com os 4 itens acima.</span>
                  <span class="text-amber-100/80">Entendo que o backup é automático e quero aplicar <strong>1 correção individual</strong> agora.</span>
                </div>
              </label>
            </div>
            <div class="px-5 py-3.5 flex items-center justify-end gap-2 border-t border-white/5 bg-zinc-900/50">
              <button type="button" data-close class="h-9 px-3.5 rounded-lg text-slate-200 font-bold text-[11.5px] bg-white/5 border border-white/10 hover:bg-white/10 transition">Cancelar</button>
              <button type="button" data-run disabled class="h-9 px-4 rounded-lg text-white font-bold text-[11.5px] bg-gradient-to-br from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 border border-emerald-400/30 shadow-lg shadow-emerald-500/10 transition disabled:opacity-40 disabled:cursor-not-allowed">
                🛠 Aplicar correção agora
              </button>
            </div>
          </div>`;
        const close = () => { try { document.body.removeChild(modal); } catch {} };
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
        const cb = modal.querySelector('[data-c]');
        const run = modal.querySelector('[data-run]');
        cb.addEventListener('change', () => { run.disabled = !cb.checked; });
        run.addEventListener('click', async () => {
          if (!cb.checked) return;
          run.disabled = true; run.textContent = 'Aplicando… backup + correção + re-auditoria';
          try {
            const r = await fetch('/api/fixes/apply', {
              method: 'POST',
              headers: { 'Content-Type':'application/json' },
              body: JSON.stringify({ slug: state.currentProject.slug, findingIds: [f.findingId], confirmAutoApplySafetyChecked: true, allowExtendedSafe: true })
            }).then(r => r.json());
            if (!r.ok) throw new Error(r.error || 'aplicar falhou');
            state.lastApplied = { applied: r.applied, skipped: r.skipped, preBackupFile: r.preBackupFile, appliedCount: r.appliedCount, skippedCount: r.skippedCount };
            state.lastDiff = r.diff;
            state.audit = r.afterReport;
            state.lastAuditId = r.afterReport.id;
            state.approvedFindingIds.clear();
            applyApprovedBySeverityDefaults();
            renderScorecard();
            renderVulnsTab();
            renderApproveTab();
            renderDiffTab();
            switchTab('diff');
            toast(`Aplicada 1 correção individual · ${r.appliedCount} aplicada(s) · ${r.skippedCount} pulada(s). Backup pré-correção salvo. Ver aba Antes × Depois.`, 'ok');
          } catch (e) {
            toast('Erro ao aplicar: ' + String(e.message||e), 'err');
            run.disabled = false; run.textContent = 'Tentar novamente';
            return;
          }
          close();
        });
        document.body.appendChild(modal);
        setTimeout(() => { try { cb.focus(); } catch {} }, 120);
      })();
    });
  });
}

function renderApproveTab() {
  const panel = document.querySelector('[data-sec-tab-panel="approve"]');
  if (!state.audit) { panel.innerHTML = `<div class="text-[12px] text-slate-500">Auditoria ainda não executada.</div>`; return; }
  const a = state.audit;
  const sevs = [
    ['critico','Crítico','red'],
    ['alto','Alto','orange'],
    ['medio','Médio','amber'],
    ['baixo','Baixo','cyan'],
  ];
  const totalApproved = state.approvedFindingIds.size;

  const rows = a.findings.map((f, i) => {
    const checked = state.approvedFindingIds.has(f.findingId) ? 'checked' : '';
    const canAuto = /SEC-HC-|SEC-HC-ANYKEY/.test(f.ruleId);
    return `
    <label class="flex items-start gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition cursor-pointer">
      <input type="checkbox" data-sec-approve-id="${escapeAttr(f.findingId||String(i))}" ${checked} class="mt-0.5 w-4 h-4 accent-emerald-500 shrink-0">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap mb-1">
          ${sevBadge(f.severity)}
          <div class="text-white font-bold text-[12px] leading-tight truncate">${escapeHtml(f.title)}</div>
          <div class="text-[9.5px] text-slate-500 font-mono">${escapeHtml(f.file || '?')}${f.line?':'+f.line:''}</div>
        </div>
        <div class="text-[11px] text-slate-400 leading-snug">${escapeHtml(f.description).slice(0, 180)}${f.description.length>180?'…':''}</div>
        <div class="mt-1">
          ${canAuto
            ? `<span class="text-[9.5px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-400/20 text-emerald-300 font-bold uppercase tracking-wide">Ação: comentar linha + FIXME</span>`
            : `<span class="text-[9.5px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400 font-bold uppercase tracking-wide">Ação: recomendada no relatório</span>`}
        </div>
      </div>
    </label>`;
  }).join('');

  panel.innerHTML = `
    <div class="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 mb-4 space-y-3">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div class="text-white font-extrabold text-[13px] mb-0.5">Aprovação em lote por severidade</div>
          <div class="text-[11.5px] text-slate-400 leading-relaxed">Marque automaticamente todos itens de uma severidade (ex: aprova tudo "Baixo" ou "Médio"). Depois desmarque itens individualmente se não quiser corrigir um específico.</div>
        </div>
        <div class="text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-400/30 text-emerald-300 font-bold">${totalApproved} selecionado(s)</div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        ${sevs.map(([k,label,color]) => {
          const count = a.counts[k] || 0;
          const on = state.approvedSeverity.has(k) ? 'checked' : '';
          const cls = on === 'checked' ? `bg-${color}-500/15 border-${color}-400/30 text-${color}-300` : 'bg-white/[0.025] border-white/10 text-slate-400';
          return `
            <label class="relative flex items-center justify-between gap-2 p-3 rounded-xl border transition cursor-pointer ${cls}">
              <div class="flex items-center gap-2 min-w-0">
                <input type="checkbox" data-sec-severity="${k}" ${on} class="w-4 h-4 shrink-0 accent-emerald-500">
                <div class="min-w-0">
                  <div class="font-bold text-[11.5px] truncate">${label}</div>
                  <div class="text-[9.5px] opacity-70 font-mono">${count} itens</div>
                </div>
              </div>
            </label>`;
        }).join('')}
      </div>
    </div>

    <div class="flex items-center justify-between mb-3">
      <div class="text-white font-bold text-[12.5px]">Correções individuais</div>
      <div class="text-[11px] text-slate-500">Total: ${a.findings.length} · ${totalApproved} serão aplicadas</div>
    </div>
    <div class="space-y-2 mb-6">${rows || '<div class="text-[12px] text-slate-500 p-6 text-center border-dashed border border-white/10 rounded-xl">Nenhuma vulnerabilidade. Pula essa etapa.</div>'}</div>

    <div id="sec-apply-section" class="sticky bottom-0 pt-4">
      <div class="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-orange-500/5 p-4 flex items-start gap-3">
        <div class="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-400/30 grid place-items-center shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="text-amber-300"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div class="flex-1 min-w-0">
          <label class="flex items-start gap-2 cursor-pointer">
            <input id="sec-confirm-safety" type="checkbox" class="mt-1 w-4 h-4 accent-emerald-500 shrink-0">
            <div class="text-[11.5px] leading-relaxed">
              <div class="font-bold text-amber-200 mb-0.5">Confirmação de segurança OBRIGATÓRIA</div>
              <div class="text-amber-100/80">
                Li e entendi que: (1) um backup completo do projeto é criado AUTOMATICAMENTE em <span class="font-mono">./backups/${escapeHtml(state.currentProject?.slug||'')}/</span> antes de qualquer alteração,
                (2) correções automáticas COMENTAM as linhas suspeitas e adicionam um FIXME para eu revisar manualmente depois,
                (3) se algo quebrar eu consigo restaurar o backup no botão <strong>Backups / Restaurar</strong> acima,
                (4) o TiAgente Security NÃO mexe no TiAgente Criador (server.js, public/ etc).
              </div>
            </div>
          </label>
        </div>
        <button id="sec-apply-btn" disabled class="h-10 px-4 rounded-lg text-white font-bold text-[11.5px] bg-gradient-to-br from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 border border-emerald-400/30 shadow-lg shadow-emerald-500/10 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0">
          🛠 Aplicar ${totalApproved} correção(ões)
        </button>
      </div>
    </div>
  `;

  // attach listeners
  $$('input[data-sec-severity]', panel).forEach(cb => {
    cb.addEventListener('change', () => {
      const sev = cb.dataset.secSeverity;
      if (cb.checked) state.approvedSeverity.add(sev); else state.approvedSeverity.delete(sev);
      if (!state.audit) return;
      for (const f of state.audit.findings) {
        if (f.severity === sev) {
          if (cb.checked) state.approvedFindingIds.add(f.findingId);
          else state.approvedFindingIds.delete(f.findingId);
        }
      }
      renderApproveTab();
    });
  });
  $$('input[data-sec-approve-id]', panel).forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.secApproveId;
      // encontrar finding com esse id
      const f = state.audit?.findings.find(x => x.findingId === id);
      if (!f) return;
      if (cb.checked) state.approvedFindingIds.add(id); else state.approvedFindingIds.delete(id);
      // refletir no severity se tudo estiver on/off
      const allSev = state.audit.findings.filter(x => x.severity === f.severity).every(x => state.approvedFindingIds.has(x.findingId));
      if (allSev) state.approvedSeverity.add(f.severity); else state.approvedSeverity.delete(f.severity);
      renderApproveTab();
    });
  });
  const confirm = $('#sec-confirm-safety', panel);
  const applyBtn = $('#sec-apply-btn', panel);
  function updateApplyBtn() {
    if (!applyBtn) return;
    const n = state.approvedFindingIds.size;
    applyBtn.textContent = n ? `🛠 Aplicar ${n} correção(ões)` : 'Selecione pelo menos 1 correção';
    applyBtn.disabled = !(n > 0 && confirm && confirm.checked);
  }
  confirm && confirm.addEventListener('change', updateApplyBtn);
  updateApplyBtn();
  applyBtn && applyBtn.addEventListener('click', applyApproved);
}

async function applyApproved() {
  if (!state.currentProject || !state.audit) return;
  const confirm = document.querySelector('#sec-confirm-safety');
  if (!confirm || !confirm.checked) return;
  const ids = Array.from(state.approvedFindingIds);
  if (!ids.length) { toast('Nenhuma correção selecionada.', 'warn'); return; }

  const btn = document.querySelector('#sec-apply-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Aplicando… backup + correções + re-auditando'; }
  try {
    const r = await fetch('/api/fixes/apply', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ slug: state.currentProject.slug, findingIds: ids, confirmAutoApplySafetyChecked: true })
    }).then(r => r.json());
    if (!r.ok) throw new Error(r.error || 'aplicar falhou');

    state.lastApplied = { applied: r.applied, skipped: r.skipped, preBackupFile: r.preBackupFile, appliedCount: r.appliedCount, skippedCount: r.skippedCount };
    state.lastDiff = r.diff;
    state.audit = r.afterReport;
    state.lastAuditId = r.afterReport.id;
    state.approvedFindingIds.clear();
    applyApprovedBySeverityDefaults();
    renderScorecard();
    renderVulnsTab();
    renderApproveTab();
    renderDiffTab();
    switchTab('diff');
    toast(`Aplicadas ${r.appliedCount} correções · ${r.skippedCount} puladas. Backup pré-correção salvo. Ver aba Antes × Depois.`, 'ok');
  } catch (e) {
    toast('Erro ao aplicar: ' + String(e.message||e), 'err');
    if (btn) { btn.disabled = false; btn.textContent = 'Tentar novamente'; }
  }
}

function renderDiffTab() {
  const panel = document.querySelector('[data-sec-tab-panel="diff"]');
  if (!state.audit) { panel.innerHTML = `<div class="text-[12px] text-slate-500">Auditoria ainda não executada.</div>`; return; }
  if (!state.lastDiff) {
    panel.innerHTML = `
      <div class="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-6 text-[12px] text-slate-400 space-y-3">
        <div class="text-white font-bold text-[13px]">Relatório de auditoria única.</div>
        <div>Para ver a comparação <strong>Antes × Depois</strong>, siga os passos: (1) vá na aba Aprovar & Aplicar, (2) marque as correções que quer e (3) clique em Aplicar. Uma nova auditoria roda automaticamente e a tabela abaixo preenche.</div>
      </div>`;
    return;
  }
  const sevCols = ['critico','alto','medio','baixo'];
  const rows = sevCols.map(k => {
    const d = state.lastDiff[k];
    const delta = d.delta;
    const cls = delta < 0 ? 'text-emerald-300 font-bold' : delta > 0 ? 'text-red-300 font-bold' : 'text-slate-400';
    return `<tr class="border-b border-white/5">
      <td class="py-2.5 pr-3 text-[12px]">${sevBadge(k)}</td>
      <td class="py-2.5 px-3 text-slate-300 font-mono text-center text-[12px]">${d.before}</td>
      <td class="py-2.5 px-3 text-slate-300 font-mono text-center text-[12px]">${d.after}</td>
      <td class="py-2.5 pl-3 text-center text-[12px] ${cls}">${delta === 0 ? '0' : (delta < 0 ? '−' : '+') + Math.abs(delta)}</td>
    </tr>`;
  }).join('');

  const sa = state.lastApplied || {};
  const appliedList = sa.applied && sa.applied.length ? `
    <div class="mt-6">
      <div class="text-white font-bold text-[12.5px] mb-2">Correções aplicadas (${sa.appliedCount || 0})</div>
      <div class="rounded-xl border border-white/[0.06] bg-black/20 max-h-64 overflow-auto">
        <table class="w-full text-left text-[11.5px]">
          <thead class="sticky top-0 bg-black/50 backdrop-blur text-[10px] uppercase text-slate-500 tracking-wider">
            <tr>
              <th class="px-3 py-2 font-bold">Severidade</th>
              <th class="px-3 py-2 font-bold">Arquivo</th>
              <th class="px-3 py-2 font-bold">Regra</th>
              <th class="px-3 py-2 font-bold">Linha</th>
            </tr>
          </thead>
          <tbody>
            ${sa.applied.map(x => `<tr class="border-t border-white/5">
              <td class="px-3 py-2">${sevBadge(x.severity)}</td>
              <td class="px-3 py-2 font-mono text-slate-300">${escapeHtml(x.file)}${x.line?':'+x.line:''}</td>
              <td class="px-3 py-2 text-slate-300">${escapeHtml(x.ruleId)} · ${escapeHtml(x.title).slice(0,40)}</td>
              <td class="px-3 py-2 text-slate-500 text-[10.5px]">${escapeHtml((x.before||'').slice(0,50))}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  ` : '';

  panel.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-5 gap-3 mb-5">
      <div class="md:col-span-2 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
        <div class="text-[10.5px] uppercase font-bold tracking-wider text-slate-500 mb-1">Nota · Antes</div>
        <div class="flex items-baseline gap-2">
          <div class="text-3xl font-black text-white">${escapeHtml(state.lastDiff.grade.before)}</div>
          <div class="text-slate-500 font-mono">Score ${state.lastDiff.score.before}</div>
        </div>
      </div>
      <div class="grid place-items-center">
        <div class="w-14 h-14 rounded-full grid place-items-center bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-lg">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/></svg>
        </div>
      </div>
      <div class="md:col-span-2 rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 p-4">
        <div class="text-[10.5px] uppercase font-bold tracking-wider text-emerald-300 mb-1">Nota · Depois</div>
        <div class="flex items-baseline gap-2">
          <div class="text-3xl font-black text-white">${escapeHtml(state.lastDiff.grade.after)}</div>
          <div class="text-slate-500 font-mono">Score ${state.lastDiff.score.after}</div>
        </div>
        <div class="mt-2 text-[11.5px] ${state.lastDiff.score.delta<=0?'text-emerald-300':'text-red-300'} font-bold">
          ${state.lastDiff.score.delta < 0 ? '−' + Math.abs(state.lastDiff.score.delta) + ' pontos · melhorou!' :
            state.lastDiff.score.delta > 0 ? '+' + state.lastDiff.score.delta + ' pontos · piorou (corrija manualmente)' :
            '0 · sem alteração no score'}
        </div>
      </div>
    </div>

    <div class="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="text-white font-bold text-[12.5px]">Comparativo por severidade</div>
        <div class="text-[10.5px] text-slate-500">Pré-aplicação → Pós-aplicação + re-auditoria</div>
      </div>
      <table class="w-full text-left text-[12px]">
        <thead class="text-[10.5px] uppercase text-slate-500 tracking-wider">
          <tr class="border-b border-white/10">
            <th class="py-2 pr-3 font-bold">Severidade</th>
            <th class="py-2 px-3 text-center font-bold">Antes</th>
            <th class="py-2 px-3 text-center font-bold">Depois</th>
            <th class="py-2 pl-3 text-center font-bold">Δ</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${sa.preBackupFile ? `<div class="mt-4 rounded-lg bg-amber-500/10 border border-amber-400/30 px-3 py-2 text-[11px] text-amber-200">
        💾 Backup pré-correção salvo em: <span class="font-mono">${escapeHtml(sa.preBackupFile)}</span> · use "Backups / Restaurar" se precisar voltar.
      </div>` : ''}
    </div>
    ${appliedList}
  `;
}

/* ================= AI RESUMO ================= */
async function aiExplain() {
  if (!state.lastAuditId) return toast('Rode a auditoria primeiro.', 'warn');
  const btn = els.btnAi;
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-white dot-pulse"></span>Resumindo…</span>`;
  try {
    const r = await fetch('/api/ai/explain', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ auditId: state.lastAuditId, tone: 'curto' })
    }).then(r => r.json());
    if (!r.ok) throw new Error(r.error || 'resumo IA falhou');
    const panel = document.querySelector('[data-sec-tab-panel="vulns"]');
    const box = document.createElement('div');
    box.className = 'mb-4 rounded-2xl border border-purple-400/30 bg-gradient-to-br from-purple-500/10 to-pink-500/5 p-4';
    box.innerHTML = `
      <div class="flex items-center gap-2 mb-2">
        <div class="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-400/30 grid place-items-center shrink-0">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="text-purple-300"><path d="M12 2a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z"/><path d="M5 21a7 7 0 0 1 14 0"/></svg>
        </div>
        <div class="text-white font-bold text-[12.5px]">Resumo executivo · IA (Gemini)</div>
      </div>
      <div class="text-[12px] text-slate-300 leading-relaxed whitespace-pre-wrap">${escapeHtml(r.text || 'Sem resposta.')}</div>
    `;
    panel.prepend(box);
    switchTab('vulns');
    toast('Resumo IA gerado.', 'ok');
  } catch (e) {
    toast('IA: ' + String(e.message||e), 'warn');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

/* ================= BACKUP MODAL ================= */
async function openBackupsModal() {
  if (!state.currentProject) return toast('Selecione um projeto primeiro.', 'warn');
  els.backupModal.classList.remove('hidden');
  els.backupList.innerHTML = `<div class="text-[11px] text-slate-500 py-6 text-center">Carregando backups…</div>`;
  try {
    const { backups } = await fetch(`/api/backup/list/${encodeURIComponent(state.currentProject.slug)}`).then(r => r.json());
    if (!backups || !backups.length) {
      els.backupList.innerHTML = `<div class="text-[11.5px] text-slate-500 py-6 text-center">Sem backups. Rode uma auditoria e/ou aplique correções — um backup pré é criado automaticamente. Também pode criar agora: <button id="sec-make-backup" class="text-emerald-300 underline underline-offset-2 hover:text-white">Criar backup manual</button></div>`;
      $('#sec-make-backup', els.backupList)?.addEventListener('click', async () => {
        const r = await fetch('/api/backup/create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ slug: state.currentProject.slug }) }).then(r => r.json());
        if (r.ok) { toast('Backup criado manualmente OK.', 'ok'); openBackupsModal(); }
        else toast('Erro: ' + (r.error||''), 'err');
      });
      return;
    }
    els.backupList.innerHTML = `
      <div class="rounded-xl border border-white/[0.06] bg-black/20">
        ${backups.map(b => `
          <div class="flex items-center justify-between p-3 border-b last:border-b-0 border-white/5">
            <div class="min-w-0 flex-1 pr-3">
              <div class="text-white font-bold text-[12px]">${fmtDate(b.ts)}</div>
              <div class="text-[10.5px] text-slate-500 font-mono truncate">${escapeHtml(b.file)} · ${(b.size/1024).toFixed(1)} KB</div>
            </div>
            <button data-sec-restore-file="${escapeAttr(b.file)}" class="h-8 px-3 rounded-md text-[11px] font-bold bg-amber-500/10 border border-amber-400/30 text-amber-200 hover:bg-amber-500/20 transition">
              ⟲ Restaurar este ponto
            </button>
          </div>`).join('')}
      </div>
    `;
    $$('button[data-sec-restore-file]', els.backupList).forEach(b => b.addEventListener('click', async () => {
      const file = b.dataset.secRestoreFile;
      const txt1 = confirm('⚠️ ATENÇÃO: Restaurar apaga TODO o conteúdo ATUAL do projeto e substitui pelo backup.\n\nContinuar? (um safety backup do estado atual será criado ANTES de restaurar, então você pode voltar atrás.)');
      if (!txt1) return;
      const txt2 = confirm('⚠️ Confirmação FINAL. Você tem certeza que quer restaurar o backup '+file+'?\nArquivos criados depois do backup serão PERDIDOS (mas gravados no safety backup).\n\nDigite SIM para continuar. Apenas clique OK se digitou e confirmou.');
      if (!txt2) return;
      b.disabled = true; b.textContent = 'Restaurando (backup+restore)…';
      try {
        const r = await fetch('/api/backup/restore', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ slug: state.currentProject.slug, backupFile: file, confirmPermanentlyDeleteNewFiles: true })
        }).then(r => r.json());
        if (r.ok) {
          toast(`Restaurado OK. Safety backup pré-restauração salvo. Rodando auditoria pós-restauração…`, 'ok');
          els.backupModal.classList.add('hidden');
          await runAudit();
        } else {
          toast('Erro restaurar: ' + (r.error||''), 'err');
        }
      } catch (e) {
        toast('Erro: ' + String(e.message||e), 'err');
      } finally { b.disabled = false; b.textContent = '⟲ Restaurar este ponto'; }
    }));
  } catch (e) {
    els.backupList.textContent = 'Erro: ' + String(e.message||e);
  }
}

/* ================= URL AUDIT ================= */
function renderUrlAuditTab() {
  const panel = els.urlAuditPanel;
  if (!panel) return;
  if (!state.lastUrlReport) {
    panel.innerHTML = `
      <div class="max-w-3xl mx-auto space-y-5">
        <div class="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-cyan-500/5 to-blue-500/5 p-5 space-y-3">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 shrink-0 rounded-xl bg-cyan-500/15 border border-cyan-400/30 grid place-items-center text-cyan-300">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-white font-extrabold text-[14px] mb-0.5">🌐 Auditoria de URL externa</div>
              <div class="text-slate-400 text-[12px] leading-relaxed">
                Informe uma URL pública HTTP/HTTPS (ex: <span class="font-mono text-cyan-300">https://meu-site.com</span>). Será feita uma <strong class="text-white">auditoria autorizada, não-destrutiva e 100% determinística</strong>, <strong>sem uso de IA</strong>.
                Apenas <span class="font-mono">1 GET / + 3 HEAD</span> de recursos públicos conhecidos.
              </div>
            </div>
          </div>
          <div class="space-y-2">
            <label for="sec-url-input" class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">URL do site alvo</label>
            <div class="flex gap-2 flex-wrap">
              <input id="sec-url-input" type="text" inputmode="url" placeholder="https://meu-site.com" spellcheck="false"
                class="flex-1 min-w-[260px] h-11 px-3.5 rounded-xl bg-black/25 border border-white/[0.08] text-[13px] text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/15 transition font-mono">
              <button id="sec-url-start" class="h-11 px-5 rounded-xl text-white text-[12.5px] font-bold bg-gradient-to-br from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 border border-emerald-400/30 shadow-lg shadow-emerald-500/10 transition flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Iniciar Auditoria
              </button>
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
            <div class="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
              <div class="text-emerald-300 text-[11px] font-bold uppercase tracking-wider mb-1">O que é analisado</div>
              <ul class="text-[11.5px] text-slate-400 leading-relaxed space-y-0.5 list-disc pl-4">
                <li>HTTPS / TLS · Redirect chain HTTP→HTTPS</li>
                <li>Status HTTP 2xx/3xx/4xx/5xx</li>
                <li>6 OWASP Secure Headers + CSP</li>
                <li>CORS · Cookies Secure/HttpOnly/SameSite</li>
                <li>Info leak Server/X-Powered-By</li>
                <li>robots.txt · sitemap.xml · wlwmanifest.xml</li>
              </ul>
            </div>
            <div class="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
              <div class="text-red-300 text-[11px] font-bold uppercase tracking-wider mb-1">Restrições (sempre ativas)</div>
              <ul class="text-[11.5px] text-slate-400 leading-relaxed space-y-0.5 list-disc pl-4">
                <li>Não escaneia localhost / LAN (anti-SSRF)</li>
                <li>Não faz brute force, login, paths adivinhados</li>
                <li>Não envia POST/PUT/DELETE (1 GET + 3 HEAD)</li>
                <li>Não usa IA em verificações determinísticas</li>
                <li>Exige sua confirmação dupla (proprietário + WAF)</li>
                <li>Token de 1 uso · TTL 20s · não repete</li>
              </ul>
            </div>
          </div>
        </div>
      </div>`;
    const btn = panel.querySelector('#sec-url-start');
    const input = panel.querySelector('#sec-url-input');
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runUrlAuditStep1(); });
    btn?.addEventListener('click', runUrlAuditStep1);
    return;
  }
  renderUrlAuditReport(state.lastUrlReport);
}

function closeUrlConfirmModal() {
  if (state._urlConfirm.ttlTimer) { clearInterval(state._urlConfirm.ttlTimer); state._urlConfirm.ttlTimer = null; }
  state._urlConfirm.token = null; state._urlConfirm.ttl = null;
  if (els.urlOwnCheck) els.urlOwnCheck.checked = false;
  if (els.urlWafCheck) els.urlWafCheck.checked = false;
  if (els.urlModal) els.urlModal.classList.add('hidden');
  updateUrlConfirmBtnState();
}

function updateUrlConfirmBtnState() {
  if (!els.urlModalConfirmBtn) return;
  const ok = !!(els.urlOwnCheck?.checked && els.urlWafCheck?.checked && state._urlConfirm.token);
  els.urlModalConfirmBtn.disabled = !ok;
}

async function runUrlAuditStep1() {
  const panel = els.urlAuditPanel;
  const input = panel?.querySelector('#sec-url-input');
  const url = (input?.value || '').trim();
  if (!url) return toast('Informe uma URL (ex: https://meu-site.com).', 'warn');
  const btn = panel?.querySelector('#sec-url-start');
  const origBtn = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-white dot-pulse"></span>Validando…</span>`; }
  try {
    const r = await fetch('/api/url-audit/request-confirmation', {
      method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ url, clientId: 'browser-' + Math.random().toString(36).slice(2, 10) })
    }).then(r => r.json());
    if (!r.ok) throw new Error(r.error || 'Etapa 1 falhou');
    state._urlConfirm.token = r.confirmationToken;
    state._urlConfirm.ttl = r.ttlSeconds || 20;
    els.urlModalSubtitle.textContent = `Validação OK · token ${r.confirmationToken.slice(0,8)}…${r.confirmationToken.slice(-4)}`;
    els.urlModalUrlBox.textContent = r.urlNormalized;
    els.urlModalPlan.innerHTML = (r.plan || []).map(p => `<li>${escapeHtml(p)}</li>`).join('');
    if (r.warnings && r.warnings.length) {
      els.urlModalWarn.classList.remove('hidden');
      els.urlModalWarn.innerHTML = r.warnings.map(w => `<div>⚠️ ${escapeHtml(w)}</div>`).join('');
    } else {
      els.urlModalWarn.classList.add('hidden');
      els.urlModalWarn.textContent = '';
    }
    els.urlModalTtl.textContent = String(state._urlConfirm.ttl);
    els.urlOwnCheck.checked = false;
    els.urlWafCheck.checked = false;
    updateUrlConfirmBtnState();
    els.urlModal.classList.remove('hidden');
    if (state._urlConfirm.ttlTimer) clearInterval(state._urlConfirm.ttlTimer);
    state._urlConfirm.ttlTimer = setInterval(() => {
      state._urlConfirm.ttl -= 1;
      if (els.urlModalTtl) els.urlModalTtl.textContent = String(Math.max(0, state._urlConfirm.ttl));
      if (state._urlConfirm.ttl <= 0) {
        toast('Janela de confirmação expirou. Solicite novamente.', 'warn');
        closeUrlConfirmModal();
      }
    }, 1000);
  } catch (e) {
    toast('URL: ' + String(e.message||e), 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origBtn; }
  }
}

async function runUrlAuditStep2() {
  if (!state._urlConfirm.token) return;
  if (!(els.urlOwnCheck?.checked && els.urlWafCheck?.checked)) return;
  const btn = els.urlModalConfirmBtn;
  const origBtn = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-white dot-pulse"></span>Escaneando…</span>`; }
  try {
    const r = await fetch('/api/url-audit/run', {
      method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ confirmationToken: state._urlConfirm.token, clientId: 'browser' })
    }).then(r => r.json());
    if (!r.ok) throw new Error(r.error || 'Etapa 2 falhou');
    state.lastUrlReport = r.report;
    closeUrlConfirmModal();
    renderUrlAuditTab();
    toast(`Auditoria URL OK · ${r.report.findings?.length||0} findings · Score ${r.report.score} · Nota ${r.report.grade}`, 'ok');
  } catch (e) {
    toast('Run: ' + String(e.message||e), 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origBtn; }
  }
}

function renderUrlAuditReport(report) {
  const panel = els.urlAuditPanel;
  if (!panel || !report) return;
  const a = report;
  const counts = a.counts || { critico:0, alto:0, medio:0, baixo:0, seguro:0, nao_observavel:0, suspeito:0 };
  const bars = [
    ['critico','Crítico', counts.critico || 0, 'bg-red-500/80'],
    ['alto','Alto',    counts.alto    || 0, 'bg-orange-500/80'],
    ['medio','Médio',   counts.medio   || 0, 'bg-amber-500/80'],
    ['baixo','Baixo',   counts.baixo   || 0, 'bg-cyan-500/80'],
  ];
  const cats = {};
  for (const f of a.findings || []) cats[f.category] = (cats[f.category] || 0) + 1;

  const redirectHtml = (a.metadata?.redirectChain && a.metadata.redirectChain.length) ? `
    <div class="rounded-xl border border-white/[0.06] bg-black/20 px-3.5 py-2.5">
      <div class="text-[9.5px] uppercase font-bold tracking-wider text-slate-500 mb-1">Redirect chain (${a.metadata.redirectChain.length})</div>
      <div class="text-[11px] font-mono space-y-1 break-all">
        ${a.metadata.redirectChain.map(r => `<div>HTTP ${r.status} · <span class="text-cyan-300">${escapeHtml(r.from)}</span> <span class="text-slate-500">→</span> <span class="text-amber-300">${escapeHtml(r.to)}</span></div>`).join('')}
      </div>
    </div>` : '';

  const metaHtml = a.metadata ? `
    <div class="rounded-xl border border-white/[0.06] bg-black/20 px-3.5 py-2.5 space-y-1">
      <div class="text-[9.5px] uppercase font-bold tracking-wider text-slate-500 mb-1">Metadados</div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] font-mono">
        <div><span class="text-slate-500">URL entrada:</span> <span class="text-white">${escapeHtml(a.metadata.urlNormalized || a.metadata.urlInput || '')}</span></div>
        <div><span class="text-slate-500">URL final:</span> <span class="text-white">${escapeHtml(a.metadata.finalUrl || '—')}</span></div>
        <div><span class="text-slate-500">Status:</span> <span class="${a.metadata.finalStatus>=200&&a.metadata.finalStatus<400?'text-emerald-300':a.metadata.finalStatus>=500?'text-red-300':'text-amber-300'}">${a.metadata.finalStatus ?? '—'}</span></div>
        <div><span class="text-slate-500">Cookies:</span> <span class="text-white">${a.metadata.finalCookieCount ?? 0}</span></div>
        <div><span class="text-slate-500">Início:</span> <span class="text-slate-300">${escapeHtml(fmtDate(a.metadata.startedAt))}</span></div>
        <div><span class="text-slate-500">Término:</span> <span class="text-slate-300">${escapeHtml(fmtDate(a.metadata.finishedAt))}</span></div>
      </div>
    </div>` : '';

  const findingsHtml = (a.findings && a.findings.length) ? a.findings.map(f => {
    const catBadge = `<span class="px-2 py-0.5 rounded-md text-[9.5px] font-mono bg-white/[0.04] border border-white/10 text-slate-300">${escapeHtml(f.category || 'Outros')}</span>`;
    const stBadge = (() => {
      switch (f.status) {
        case 'confirmado': return `<span class="px-2 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-wide bg-red-500/10 text-red-300 border border-red-400/20">Confirmado</span>`;
        case 'suspeito':   return `<span class="px-2 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-wide bg-amber-500/10 text-amber-300 border border-amber-400/30">Suspeito</span>`;
        case 'nao_observavel': return `<span class="px-2 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-wide bg-slate-500/10 text-slate-300 border border-slate-400/20">Não observável</span>`;
        case 'seguro':     return `<span class="px-2 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-400/20">Seguro</span>`;
        default: return `<span class="px-2 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-wide bg-white/5 text-slate-400 border border-white/10">?</span>`;
      }
    })();
    return `
      <div class="rounded-xl border border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.04] transition overflow-hidden">
        <div class="p-3.5 space-y-2">
          <div class="flex items-start gap-2 flex-wrap">
            ${sevBadge(f.severity)}
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap mb-0.5">
                <div class="text-white font-bold text-[12.5px] leading-tight">${escapeHtml(f.title)}</div>
                ${stBadge}
                ${catBadge}
                <div class="text-[9.5px] text-slate-500 font-mono">id ${escapeHtml(String(f.id||'').slice(0,12))}</div>
              </div>
            </div>
          </div>
          <div class="rounded-lg bg-black/30 border border-white/5 px-3 py-2 text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-words">
            <div class="text-slate-500 text-[9.5px] font-bold uppercase tracking-wider mb-0.5">Evidência</div>${escapeHtml(f.evidence || '—')}
          </div>
          ${f.recommendation ? `
            <div class="rounded-lg border border-emerald-400/15 bg-emerald-500/5 px-3 py-2 text-[11.5px] text-emerald-200 leading-relaxed">
              <div class="text-emerald-400 text-[9.5px] font-bold uppercase tracking-wider mb-0.5">Recomendação</div>${escapeHtml(f.recommendation)}
            </div>` : ''}
        </div>
      </div>`;
  }).join('') : `<div class="rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-6 text-[12.5px] text-emerald-300">🎉 Nenhum finding. Resultado vazio.</div>`;

  panel.innerHTML = `
    <div class="space-y-4 max-w-5xl mx-auto">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="text-white font-extrabold text-[15px]">🛡️ Resultado · Auditoria URL</div>
        <button id="sec-url-audit-reset" class="h-8 px-3 rounded-lg text-[11.5px] font-bold text-slate-300 bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.07] hover:text-white transition flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 12a9 9 0 0 1 9-9"/><path d="M3 4v8h8"/></svg>
          Nova auditoria (limpar)
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="md:col-span-1">${gradeBadge(a.grade || 'C', a.score ?? 0)}</div>
        <div class="md:col-span-2 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 space-y-2.5">
          <div class="flex items-center justify-between">
            <div class="text-white font-bold text-[12.5px]">Resumo por severidade</div>
            <div class="text-[10.5px] text-slate-500 font-mono">${a.findings?.length||0} finding(s) · ${Object.keys(cats).length} categoria(s)</div>
          </div>
          ${bars.map(([k,label,n,bg]) => `
            <div>
              <div class="flex items-center justify-between mb-1 text-[11px]">
                <div class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full ${bg}"></span><span class="text-slate-300 font-bold">${label}</span></div>
                <div class="text-slate-300 font-mono">${n}</div>
              </div>
              <div class="h-1.5 rounded-full bg-black/30 overflow-hidden">
                <div class="${bg} h-full transition-all duration-300" style="width:${Math.min(100, n === 0 ? 0 : 8 + Math.min(92, (n / Math.max(1, bars.reduce((m,b)=>Math.max(m,b[2]),0))*100)))}%"></div>
              </div>
            </div>`).join('')}
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        ${metaHtml}
        ${redirectHtml || `<div class="rounded-xl border border-white/[0.06] bg-black/20 px-3.5 py-2.5"><div class="text-[9.5px] uppercase font-bold tracking-wider text-slate-500 mb-1">Redirect chain</div><div class="text-[11.5px] text-slate-400">Sem redirecionamentos (ou nenhum hop detectado).</div></div>`}
      </div>

      <div class="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3.5">
        <div class="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div class="text-white font-bold text-[12.5px]">Findings (${a.findings?.length||0})</div>
          <div class="flex items-center gap-1.5 flex-wrap">
            ${Object.keys(cats).sort().map(c => `<span class="px-2 py-0.5 rounded-md text-[10px] font-mono bg-white/[0.04] border border-white/10 text-slate-300">${escapeHtml(c)} · ${cats[c]}</span>`).join('')}
          </div>
        </div>
        <div class="space-y-2">${findingsHtml}</div>
      </div>
    </div>
  `;
  panel.querySelector('#sec-url-audit-reset')?.addEventListener('click', () => {
    state.lastUrlReport = null;
    renderUrlAuditTab();
    toast('Limpo. Pronto para nova auditoria.', 'ok');
  });
}

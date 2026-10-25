/* =========================================================
 * public/jogos.js — UI do módulo "Jogos" (TI Agente)
 * Consome /api/jogos/* (motor matemático roda no servidor).
 * Somente ANÁLISE: não prevê resultados, não contorna proteções,
 * não executa apostas com dinheiro real.
 * =======================================================*/
const $ = (id) => document.getElementById(id);

const state = {
  sessionId: null,
  sessions: [],
  reference: null,
  risk: null,
  status: null,
  expanded: false,
  autoOn: false,
  lastReport: null,
};

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function n2(v, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function pct(v, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  return n2(Number(v) * 100, digits) + '%';
}
function show(el, html, kind) {
  if (!el) return;
  el.classList.remove('hidden');
  el.className = el.className.replace(/\b(border|bg|text)-\S+/g, '').trim();
  const tone = kind === 'error'
    ? 'border-rose-400/30 bg-rose-500/[0.07] text-rose-200'
    : kind === 'ok'
      ? 'border-emerald-400/30 bg-emerald-500/[0.07] text-emerald-200'
      : 'border-violet-400/25 bg-violet-500/[0.06] text-violet-100';
  el.classList.add(...tone.split(' '));
  el.innerHTML = html;
}
function hide(el) { if (el) el.classList.add('hidden'); }

async function api(path, opts = {}) {
  const r = await fetch('/api/jogos' + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  if (!data) return { ok: false, reason: 'Não foi possível carregar os dados agora.' };
  return data;
}

/* ---------------- Status / backend ---------------- */
async function loadStatus() {
  const r = await api('/status');
  state.status = r;
  const dot = $('jg-backend-dot'), label = $('jg-backend-label');
  if (!r.ok) { if (label) label.textContent = 'indisponível'; return; }
  const b = r.browser || {};
  if (dot) dot.textContent = b.liveReadAvailable ? '🟢' : '🟡';
  if (label) label.textContent = b.liveReadAvailable ? 'navegador real' : 'sem navegador real';
  const notice = $('jg-browser-notice');
  if (notice && !b.liveReadAvailable) {
    notice.classList.remove('hidden');
    notice.innerHTML = esc(b.note || '');
  }
}

/* ---------------- Sessões ---------------- */
async function loadSessions(selectId) {
  const r = await api('/sessions');
  state.sessions = r.ok ? (r.items || []) : [];
  const sel = $('jg-session-select');
  if (sel) {
    sel.innerHTML = state.sessions.length
      ? state.sessions.map(s => `<option value="${esc(s.id)}">${esc(`${s.gameName} · ${s.siteHost} · ${s.recordsCount} registro(s) · ${s.status}`)}</option>`).join('')
      : '<option value="">nenhuma sessão</option>';
  }
  renderSessionsReport();
  const target = selectId || state.sessionId || (state.sessions[0] && state.sessions[0].id);
  if (target) await selectSession(target);
}

async function selectSession(id) {
  if (!id) return;
  const r = await api('/session/' + encodeURIComponent(id));
  if (!r.ok) { show($('jg-msg'), esc(r.reason || 'Sessão indisponível.'), 'error'); return; }
  state.sessionId = id;
  const s = r.session;
  state.reference = r.reference || null;
  state.risk = r.risk || null;
  state.autoOn = !!(r.autoMode && r.autoMode.enabled);
  if ($('jg-session-select')) $('jg-session-select').value = id;
  if ($('jg-site-url')) $('jg-site-url').value = s.siteUrl || '';
  if ($('jg-game-name')) $('jg-game-name').value = s.gameName || '';
  if ($('jg-game-version')) $('jg-game-version').value = s.gameVersion || '';
  if ($('jg-mode-select')) $('jg-mode-select').value = s.mode || '';
  if ($('jg-browser-host')) $('jg-browser-host').textContent = s.siteHost || '—';
  if (r.reference && $('jg-ref-content')) $('jg-ref-content').value = JSON.stringify({ probabilities: r.reference.probabilities, payouts: r.reference.payouts, source: r.reference.source }, null, 0);
  applyRiskToForm(r.risk);
  updateSessionButtons(s);
  renderHistory(r.records || []);
  renderAutoLog((r.autoMode && r.autoMode.log) || []);
  if (r.reference) await analyze(false);
  else renderNoAnalysis();
}

function updateSessionButtons(s) {
  const started = s && s.status === 'observando';
  const ended = s && s.status === 'encerrada';
  if ($('jg-start-btn')) $('jg-start-btn').disabled = !s || started || ended;
  if ($('jg-pause-btn')) $('jg-pause-btn').disabled = !s || !started || ended;
  if ($('jg-end-btn')) $('jg-end-btn').disabled = !s || ended;
}

function renderSessionsReport() {
  const box = $('jg-sessions-report');
  if (!box) return;
  if (!state.sessions.length) { box.textContent = 'Nenhuma sessão registrada.'; return; }
  box.innerHTML = state.sessions.slice(0, 40).map(s => {
    const ref = s.hasReference ? 'referência ✓' : 'sem referência';
    return `<div class="mb-1.5 pb-1.5 border-b border-white/5 last:border-0">
      <div class="text-slate-200 font-semibold">${esc(s.gameName)}${s.gameVersion ? ' · v' + esc(s.gameVersion) : ''}</div>
      <div class="text-slate-500">${esc(s.siteHost)} · ${esc(s.status)} · ${s.recordsCount} registro(s) · ${esc(ref)}</div>
    </div>`;
  }).join('');
}

function renderHistory(records) {
  const box = $('jg-history');
  if (!box) return;
  if (!records.length) { box.textContent = 'Nenhum registro na sessão.'; return; }
  const tail = records.slice(-25).reverse();
  box.innerHTML = tail.map(r => {
    const when = r.ts ? new Date(r.ts).toLocaleString('pt-BR') : 'sem data';
    const mult = r.multiplier === null ? '?' : `×${n2(r.multiplier, 2)}`;
    const money = (r.bet === null ? '' : ` · aposta ${n2(r.bet)}`) + (r.payout === null ? '' : ` → retorno ${n2(r.payout)}`);
    const kindTag = r.kind === 'simulation' ? ' [SIMULAÇÃO]' : (r.kind === 'official' ? ' [oficial]' : '');
    return `<div class="mb-1 pb-1 border-b border-white/5 last:border-0">
      <span class="text-slate-300">${esc(r.outcome === null ? '(sem resultado)' : r.outcome)}</span>
      <span class="text-violet-300"> ${esc(mult)}</span>${esc(kindTag)}
      <span class="text-slate-500">${esc(money)}</span>
      <div class="text-slate-600">${esc(when)}${r.mode ? ' · ' + esc(r.mode) : ''}</div>
    </div>`;
  }).join('');
}

/* ---------------- Navegador ---------------- */
async function openBrowser() {
  const url = ($('jg-site-url') || {}).value || '';
  if (!url.trim()) { show($('jg-msg'), 'Informe a URL do site.', 'error'); return; }
  show($('jg-msg'), 'Abrindo e validando o endereço…', 'info');
  const r = await api('/browser/open', { method: 'POST', body: JSON.stringify({ url }) });
  if (!r.ok) {
    hide($('jg-browser-frame'));
    const empty = $('jg-browser-empty'); if (empty) empty.classList.remove('hidden');
    show($('jg-msg'), esc(r.reason || 'Não foi possível abrir a página.'), 'error');
    const notice = $('jg-browser-notice');
    if (notice) { notice.classList.remove('hidden'); notice.textContent = 'A leitura ao vivo está indisponível para este endereço. Use a importação autorizada de dados.'; }
    return;
  }
  state.lastReport = state.lastReport;
  if ($('jg-browser-host')) $('jg-browser-host').textContent = r.host;
  if ($('jg-browser-external')) { $('jg-browser-external').href = r.finalUrl || url; }
  const frame = $('jg-browser-frame');
  if (frame) { frame.src = r.finalUrl || url; frame.classList.remove('hidden'); }
  const empty = $('jg-browser-empty'); if (empty) empty.classList.add('hidden');
  const notice = $('jg-browser-notice');
  if (notice) {
    notice.classList.remove('hidden');
    notice.innerHTML = `Título identificado: <strong class="text-slate-300">${esc(r.title || 'não informado')}</strong> · HTTP ${esc(r.status || '?')} · ${esc(r.note || '')}`;
  }
  show($('jg-msg'), 'Página aberta. Se a área acima aparecer vazia, o site recusou exibição em frame — use "Nova aba" (nenhuma proteção é contornada).', 'ok');
}

/* ---------------- Análise ---------------- */
function kpi(label, value, hint) {
  return `<div class="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5">
    <div class="text-[9px] uppercase tracking-wider text-slate-500 font-bold truncate">${esc(label)}</div>
    <div class="text-[12.5px] font-bold text-slate-100">${esc(value)}</div>
    ${hint ? `<div class="text-[9px] text-slate-600">${esc(hint)}</div>` : ''}
  </div>`;
}

function stateTone(stateName) {
  if (stateName === 'VALIDADA EM DADOS INDEPENDENTES') return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200';
  if (stateName === 'POSSÍVEL ANOMALIA') return 'border-amber-400/30 bg-amber-500/10 text-amber-200';
  if (stateName === 'NÃO VALIDADA') return 'border-rose-400/30 bg-rose-500/10 text-rose-200';
  if (stateName === 'HIPÓTESE EM INVESTIGAÇÃO') return 'border-violet-400/30 bg-violet-500/10 text-violet-200';
  return 'border-slate-500/30 bg-white/5 text-slate-300';
}

function renderNoAnalysis() {
  if ($('jg-kpis')) $('jg-kpis').innerHTML = '';
  if ($('jg-state-badge')) { $('jg-state-badge').textContent = 'COLETANDO DADOS'; $('jg-state-badge').className = 'inline-flex items-center rounded-md px-2 py-0.5 border text-[10.5px] font-bold ' + stateTone('COLETANDO DADOS'); }
  if ($('jg-decision-badge')) $('jg-decision-badge').textContent = 'CONTINUAR OBSERVAÇÃO';
  if ($('jg-decision-reason')) $('jg-decision-reason').textContent = state.reference ? 'Execute a análise para ver os resultados.' : 'Sem tabela de referência: o EV teórico não é calculável. Importe dados e informe a referência quando disponível.';
  if ($('jg-hypotheses')) $('jg-hypotheses').innerHTML = '<div class="text-[10.5px] text-slate-600">Nenhuma análise executada.</div>';
  if ($('jg-data-version')) $('jg-data-version').textContent = '';
}

async function analyze(notify = true) {
  if (!state.sessionId) { if (notify) show($('jg-msg'), 'Crie ou selecione uma sessão primeiro.', 'error'); return; }
  const risk = readRiskForm();
  const r = await api('/session/' + encodeURIComponent(state.sessionId) + '/analyze', { method: 'POST', body: JSON.stringify({ risk }) });
  if (!r.ok) { if (notify) show($('jg-msg'), esc(r.reason || 'Análise indisponível.'), 'error'); renderNoAnalysis(); return; }
  renderReport(r.report);
  if (notify) show($('jg-msg'), 'Análise atualizada.', 'ok');
}

function renderReport(rep) {
  if (!rep) return;
  state.lastReport = rep;
  const o = rep.observed;
  const k = $('jg-kpis');
  if (k) {
    k.innerHTML = [
      kpi('Registros', String(o.nObserved), o.nSimulation ? `${o.nSimulation} simulado(s) separado(s)` : 'nenhum simulado'),
      kpi('RTP observado', pct(o.rtpObserved), 'da amostra, não teórico'),
      kpi('Resultado líquido', o.netResult === null ? '—' : n2(o.netResult), 'retorno − apostado'),
      kpi('EV observado/un.', o.evObservedPerUnit === null ? '—' : pct(o.evObservedPerUnit), 'por unidade apostada'),
      kpi('Acerto (r≥1)', pct(o.winRate), 'multiplicador ≥ 1'),
      kpi('Mediana ×', o.multiplier ? n2(o.multiplier.median) : '—', o.multiplier ? `máx ${n2(o.multiplier.max)}` : 'sem multiplicadores'),
    ].join('');
  }
  const sb = $('jg-state-badge');
  if (sb) { sb.textContent = `${rep.state.state}`; sb.className = 'inline-flex items-center rounded-md px-2 py-0.5 border text-[10.5px] font-bold ' + stateTone(rep.state.state); }
  if ($('jg-decision-badge')) $('jg-decision-badge').textContent = rep.decision.decision;
  if ($('jg-decision-reason')) $('jg-decision-reason').textContent = rep.decision.reason;
  if ($('jg-data-version')) $('jg-data-version').textContent = `Dados: ${rep.dataVersion} · gerado em ${new Date(rep.generatedAt).toLocaleString('pt-BR')}`;

  const hy = $('jg-hypotheses');
  if (hy) {
    const items = (rep.hypotheses || []).map(h => {
      const unc = h.uncertainty
        ? (h.uncertainty.pValue !== undefined ? `p = ${n2(h.uncertainty.pValue, 4)}` : '') +
          (h.uncertainty.cramersV !== undefined ? ` · V de Cramér = ${n2(h.uncertainty.cramersV, 3)}` : '') +
          (h.uncertainty.diff !== undefined ? ` · diferença = ${n2(h.uncertainty.diff, 4)}` : '')
        : 'não calculada';
      return `<div class="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 space-y-0.5">
        <div class="text-[11px] font-bold text-violet-200">${esc(h.title)}</div>
        <div class="text-[10px] text-slate-400"><span class="text-slate-500">Observado:</span> ${esc(h.observed)}</div>
        <div class="text-[10px] text-slate-400"><span class="text-slate-500">Referência:</span> ${esc(h.reference)}</div>
        <div class="text-[10px] text-slate-400"><span class="text-slate-500">Teste:</span> ${esc(h.testApplied)} · n=${esc(h.sampleSize)}</div>
        <div class="text-[10px] text-slate-400"><span class="text-slate-500">Incerteza:</span> ${esc(unc)}</div>
        ${h.inconclusiveReason ? `<div class="text-[10px] text-amber-300/80">Inconclusiva: ${esc(h.inconclusiveReason)}</div>` : ''}
        <div class="text-[10px] text-slate-500">Reproduzir: ${esc(h.reproducible)}</div>
        <div class="text-[10px] text-slate-600">Alternativas: ${esc((h.alternativeExplanations || []).join('; '))}</div>
      </div>`;
    });
    const mt = rep.multipleTesting;
    if (mt && mt.ok) items.unshift(`<div class="text-[10px] text-slate-500">Múltiplos testes: ${mt.m} hipótese(s), q=${mt.q}, limiar BH = ${mt.threshold === null ? 'nenhum' : n2(mt.threshold, 4)}</div>`);
    hy.innerHTML = items.join('') || '<div class="text-[10.5px] text-slate-600">Nenhuma hipótese formulada.</div>';
  }

  if (rep.risk) renderRisk(rep.risk);
  const g = rep.integrity || {};
  const warnings = []
    .concat((g.scope && g.scope.violations) || [])
    .concat(g.gaps ? g.gaps.issues : []);
  if (g.duplicatesRemoved) warnings.unshift(`${g.duplicatesRemoved} duplicata(s) removida(s)`);
  if (warnings.length) show($('jg-msg'), warnings.map(esc).join(' · '), 'info');
}

/* ---------------- Risco ---------------- */
function readRiskForm() {
  return {
    budget: Number(($('jg-risk-budget') || {}).value || 0) || undefined,
    maxLoss: Number(($('jg-risk-maxloss') || {}).value || 0) || undefined,
    maxMinutes: Number(($('jg-risk-maxmin') || {}).value || 0) || undefined,
    baseBet: Number(($('jg-risk-bet') || {}).value || 0) || undefined,
  };
}
function applyRiskToForm(risk) {
  if (!risk) return;
  if ($('jg-risk-budget')) $('jg-risk-budget').value = risk.budget ?? '';
  if ($('jg-risk-maxloss')) $('jg-risk-maxloss').value = risk.maxLoss ?? '';
  if ($('jg-risk-maxmin')) $('jg-risk-maxmin').value = risk.maxMinutes ?? '';
  if ($('jg-risk-bet')) $('jg-risk-bet').value = risk.baseBet ?? '';
  renderRisk(risk);
}
function renderRisk(risk) {
  const box = $('jg-risk-out');
  if (!box) return;
  if (!risk || risk.ok === false) { box.classList.remove('hidden'); box.textContent = (risk && risk.reason) || 'Informe orçamento e aposta base para calcular o risco.'; return; }
  const lines = [];
  lines.push(`Orçamento ${n2(risk.budget)} · perda máxima ${n2(risk.maxLoss)}${risk.maxMinutes ? ` · tempo máximo ${risk.maxMinutes} min` : ''}`);
  lines.push('Interromper quando: ' + risk.stopConditions.join(' · '));
  lines.push('');
  for (const l of risk.ladder) {
    lines.push(`${l.fator}: aposta ${n2(l.bet)} → perde o limite em ~${l.roundsUntilMaxLoss} rodada(s) · exposição em 100 rodadas ${n2(l.exposurePer100)}${l.expectedLossPer100 === null ? '' : ` · perda esperada ~${n2(l.expectedLossPer100)}`}`);
  }
  lines.push('');
  for (const w of risk.warnings) lines.push('• ' + w);
  box.classList.remove('hidden');
  box.textContent = lines.join('\n');
}

async function saveRisk() {
  if (!state.sessionId) { show($('jg-msg'), 'Crie ou selecione uma sessão primeiro.', 'error'); return; }
  const risk = readRiskForm();
  if (!risk.budget || !risk.baseBet) { show($('jg-risk-out'), 'Informe orçamento e aposta base (>0).', 'error'); return; }
  await analyze(false);
  updateRiskTab(risk);
}

/* Cálculo local de retorno imediato (mesma matemática do servidor, apenas exibição) */
function updateRiskTab(risk) {
  const ev = state.lastReport && state.lastReport.observed ? state.lastReport.observed.evObservedPerUnit : null;
  const baseBet = risk.baseBet, maxLoss = risk.maxLoss || risk.budget;
  const ladder = [0.5, 1, 2, 5].map(f => {
    const bet = baseBet * f;
    return { fator: `${f}× a aposta base`, bet, roundsUntilMaxLoss: Math.floor(maxLoss / bet), exposurePer100: bet * 100 };
  });
  renderRisk({
    ok: true, budget: risk.budget, maxLoss, maxMinutes: risk.maxMinutes, baseBet,
    stopConditions: [`perda acumulada ≥ ${maxLoss}`, `orçamento da sessão (${risk.budget}) consumido`, risk.maxMinutes ? `tempo de sessão ≥ ${risk.maxMinutes} min` : 'sem limite de tempo configurado'],
    ladder,
    warnings: [
      'Aumentar a aposta aumenta a EXPOSIÇÃO FINANCEIRA de forma linear — não aumenta a probabilidade de ganhar.',
      'Progressão tipo martingale é proibida neste módulo: recuperar prejuízo não é objetivo válido.',
      'Turbo, horário ou sequências recentes não alteram a probabilidade do próximo resultado.',
      'Aposta maior nunca é recomendada com base em resultados recentes.',
    ],
  });
  if (ev !== null && ev !== undefined) show($('jg-msg'), `Aposta base aplicada. EV observado da amostra: ${pct(ev)} por unidade.`, 'info');
}

/* ---------------- Importação / referência ---------------- */
async function doImport() {
  if (!state.sessionId) { show($('jg-msg'), 'Crie ou selecione uma sessão primeiro.', 'error'); return; }
  const content = ($('jg-import-content') || {}).value || '';
  if (!content.trim()) { show($('jg-import-msg'), 'Cole os dados autorizados antes de importar.', 'error'); return; }
  const r = await api('/session/' + encodeURIComponent(state.sessionId) + '/import', {
    method: 'POST',
    body: JSON.stringify({
      format: ($('jg-import-format') || {}).value || 'auto',
      dataset: ($('jg-import-dataset') || {}).value || 'discovery',
      content,
    }),
  });
  if (!r.ok) { show($('jg-import-msg'), esc(r.reason || 'Importação recusada.'), 'error'); return; }
  show($('jg-import-msg'), `Importado: ${r.added} registro(s) em "${r.dataset === 'validation' ? 'amostra independente' : 'amostra de descoberta'}"${r.duplicatesRemoved ? ` · ${r.duplicatesRemoved} duplicata(s) ignorada(s)` : ''}.`, 'ok');
  if (r.scopeWarnings && r.scopeWarnings.length) show($('jg-msg'), r.scopeWarnings.map(esc).join(' · '), 'info');
  await refreshSession();
}

async function saveReference() {
  if (!state.sessionId) { show($('jg-msg'), 'Crie ou selecione uma sessão primeiro.', 'error'); return; }
  const raw = ($('jg-ref-content') || {}).value || '';
  if (!raw.trim()) { show($('jg-ref-msg'), 'Cole a tabela de referência (probabilidades e pagamentos).', 'error'); return; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { show($('jg-ref-msg'), 'JSON inválido na tabela de referência.', 'error'); return; }
  const r = await api('/session/' + encodeURIComponent(state.sessionId) + '/reference', { method: 'POST', body: JSON.stringify(parsed) });
  if (!r.ok) { show($('jg-ref-msg'), esc(r.reason || 'Referência recusada.'), 'error'); return; }
  state.reference = r.reference;
  show($('jg-ref-msg'), `Referência salva (${r.reference.categories} categorias). Fonte: ${esc(r.reference.source)}.`, 'ok');
  await analyze(false);
}

async function runMonteCarlo() {
  if (!state.reference) { show($('jg-ref-msg'), 'Salve a tabela de referência antes da simulação.', 'error'); return; }
  const risk = readRiskForm();
  const r = await api('/montecarlo', {
    method: 'POST',
    body: JSON.stringify({
      probabilities: state.reference.probabilities, payouts: state.reference.payouts,
      n: 20000, seed: 12345, bet: risk.baseBet || 1, bankroll: risk.budget || null,
    }),
  });
  const out = $('jg-mc-out');
  if (!out) return;
  if (!r.ok) { out.classList.remove('hidden'); out.textContent = r.reason || 'Simulação indisponível.'; return; }
  const s = r.simulation;
  out.classList.remove('hidden');
  out.textContent = [
    `⚠ ${s.label}`,
    `rodadas simuladas: ${s.rounds} · seed ${s.seed} (reprodutível)`,
    `RTP simulado: ${pct(s.meanRtp)} (IC95% ${pct(s.ci95Rtp[0])} … ${pct(s.ci95Rtp[1])})`,
    `retorno líquido por unidade: ${pct(s.netPerUnit)}`,
    `taxa de retorno ≥ aposta: ${pct(s.winRate)}`,
    s.ruinProbability === null ? 'ruína: não calculada (informe orçamento)' : `probabilidade de ruína: ${pct(s.ruinProbability)}`,
    s.note,
  ].join('\n');
}

/* ---------------- Modo automático ---------------- */
function renderAutoLog(log) {
  const box = $('jg-auto-log');
  if (!box) return;
  if (!log.length) { box.textContent = '—'; return; }
  box.innerHTML = log.slice(-30).reverse().map(e => `<div class="mb-1 pb-1 border-b border-white/5 last:border-0">
    <span class="text-slate-300">${esc(e.decision)}</span>
    <span class="text-slate-500"> → ${esc(e.action)}</span>
    <div class="text-slate-600">${esc(new Date(e.at).toLocaleString('pt-BR'))} · ${esc(e.reason)}</div>
  </div>`).join('');
}

async function toggleAuto() {
  if (!state.sessionId) { show($('jg-msg'), 'Crie ou selecione uma sessão primeiro.', 'error'); return; }
  const environment = ($('jg-auto-env') || {}).value || 'demo';
  const next = !state.autoOn;
  const r = await api('/session/' + encodeURIComponent(state.sessionId) + '/auto', { method: 'POST', body: JSON.stringify({ enabled: next, environment, realMoney: environment === 'real_money' }) });
  if (!r.ok) {
    show($('jg-msg'), esc(r.reason || 'Modo automático indisponível.') + (r.allowedInstead ? ` Permitido: ${esc(r.allowedInstead.join(', '))}.` : ''), 'error');
    state.autoOn = false;
  } else {
    state.autoOn = r.autoMode.enabled;
    show($('jg-msg'), state.autoOn ? 'Modo automático (demonstração) ligado. Cada passo consulta o motor de decisão e registra o motivo.' : 'Modo automático desligado.', 'ok');
  }
  if ($('jg-auto-toggle')) $('jg-auto-toggle').textContent = state.autoOn ? 'Desligar modo automático' : 'Ligar modo automático';
  if ($('jg-auto-step')) $('jg-auto-step').disabled = !state.autoOn;
}

async function autoStep() {
  if (!state.sessionId) return;
  const r = await api('/session/' + encodeURIComponent(state.sessionId) + '/auto/step', { method: 'POST', body: JSON.stringify({ simulateRound: true }) });
  if (!r.ok) { show($('jg-msg'), esc(r.reason || 'Passo indisponível.'), 'error'); return; }
  show($('jg-msg'), `Decisão: ${esc(r.step.decision)} → ação: ${esc(r.step.action)}${r.step.pausedBecause ? ` (pausado: ${esc(r.step.pausedBecause)})` : ''}`, 'info');
  await refreshSession();
}

/* ---------------- Ações de sessão ---------------- */
async function newSession() {
  const siteUrl = ($('jg-site-url') || {}).value || '';
  const gameName = ($('jg-game-name') || {}).value || '';
  const r = await api('/session', {
    method: 'POST',
    body: JSON.stringify({
      siteUrl, gameName,
      gameVersion: ($('jg-game-version') || {}).value || '',
      mode: ($('jg-mode-select') || {}).value || '',
    }),
  });
  if (!r.ok) { show($('jg-msg'), esc(r.reason || 'Não foi possível criar a sessão.'), 'error'); return; }
  show($('jg-msg'), 'Sessão criada.', 'ok');
  await loadSessions(r.session.id);
}

async function setSessionStatus(status) {
  if (!state.sessionId) return;
  const r = await api('/session/' + encodeURIComponent(state.sessionId) + '/state', { method: 'POST', body: JSON.stringify({ status }) });
  if (!r.ok) { show($('jg-msg'), esc(r.reason || 'Não foi possível alterar o estado.'), 'error'); return; }
  updateSessionButtons(r.session);
  show($('jg-msg'), status === 'observando' ? 'Observação iniciada. A coleta depende do navegador integrado ou da importação autorizada.' : 'Observação pausada.', 'ok');
  await loadSessions(state.sessionId);
}

async function endSession() {
  if (!state.sessionId) return;
  const r = await api('/session/' + encodeURIComponent(state.sessionId) + '/end', { method: 'POST', body: '{}' });
  if (!r.ok) { show($('jg-msg'), esc(r.reason || 'Não foi possível encerrar.'), 'error'); return; }
  show($('jg-msg'), 'Sessão encerrada. O histórico permanece separado por site, jogo e sessão.', 'ok');
  await loadSessions(state.sessionId);
}

async function refreshSession() {
  if (!state.sessionId) return;
  await selectSession(state.sessionId);
  await loadSessions(state.sessionId);
}

function report() {
  const rep = state.lastReport;
  const box = $('jg-history');
  if (!rep) { show($('jg-msg'), 'Execute a análise antes de gerar o relatório.', 'error'); return; }
  const lines = [
    `Sessão · ${rep.scope.gameName || '—'} ${rep.scope.gameVersion ? 'v' + rep.scope.gameVersion : ''} · ${rep.scope.siteHost || '—'}`,
    `Versão dos dados: ${rep.dataVersion} · ${new Date(rep.generatedAt).toLocaleString('pt-BR')}`,
    `Registros analisados: ${rep.observed.nObserved} (simulados separados: ${rep.observed.nSimulation})`,
    `RTP observado: ${pct(rep.observed.rtpObserved)} · líquido: ${rep.observed.netResult === null ? '—' : n2(rep.observed.netResult)}`,
    `EV teórico: ${rep.theoreticalEV.ok ? pct(rep.theoreticalEV.ev) + ` (fonte: ${rep.theoreticalEV.source})` : 'não calculável — ' + rep.theoreticalEV.reason}`,
    `Estado: ${rep.state.state} — ${rep.state.reason}`,
    `Decisão: ${rep.decision.decision} — ${rep.decision.reason}`,
    '',
    'Limitações: ' + rep.disclaimers.join(' '),
  ];
  if (box) { box.textContent = lines.join('\n'); box.scrollTop = 0; }
  show($('jg-msg'), 'Relatório da sessão gerado no painel de histórico.', 'ok');
}

/* ---------------- Bootstrap ---------------- */
function wire() {
  $('jg-open-btn')?.addEventListener('click', openBrowser);
  $('jg-new-session-btn')?.addEventListener('click', newSession);
  $('jg-start-btn')?.addEventListener('click', () => setSessionStatus('observando'));
  $('jg-pause-btn')?.addEventListener('click', () => setSessionStatus('pausada'));
  $('jg-end-btn')?.addEventListener('click', endSession);
  $('jg-refresh-btn')?.addEventListener('click', refreshSession);
  $('jg-session-select')?.addEventListener('change', (e) => selectSession(e.target.value));
  $('jg-import-btn')?.addEventListener('click', doImport);
  $('jg-csv-help-btn')?.addEventListener('click', () => {
    show($('jg-import-msg'), 'Cabeçalhos aceitos (qualquer ordem): roundId/rodada, outcome/resultado, multiplier/multiplicador, bet/aposta, payout/pagamento, ts/data, mode/modo, balanceBefore/saldoAnterior, balanceAfter/saldoPosterior. Separador "," ou ";".', 'info');
  });
  $('jg-ref-btn')?.addEventListener('click', saveReference);
  $('jg-analysis-btn')?.addEventListener('click', () => analyze(true));
  $('jg-mc-btn')?.addEventListener('click', runMonteCarlo);
  $('jg-risk-save')?.addEventListener('click', saveRisk);
  $('jg-auto-toggle')?.addEventListener('click', toggleAuto);
  $('jg-auto-step')?.addEventListener('click', autoStep);
  $('jg-report-btn')?.addEventListener('click', report);
  $('jg-expand-btn')?.addEventListener('click', () => {
    const panel = document.querySelector('[data-editor-panel="jogos"]');
    const frame = $('jg-browser-frame');
    state.expanded = !state.expanded;
    if (panel) {
      panel.querySelectorAll(':scope > #jg-body > div').forEach(d => { d.classList.toggle('hidden', state.expanded); });
      if (!state.expanded) panel.querySelectorAll(':scope > #jg-body > div').forEach(d => d.classList.remove('hidden'));
      $('jg-expand-btn').textContent = state.expanded ? 'Reduzir' : 'Ampliar';
    }
    if (frame) frame.classList.toggle('bg-black', false);
    if (state.expanded) {
      const wrap = frame?.closest('.rounded-xl');
      if (wrap) { wrap.classList.remove('hidden'); wrap.classList.add('fixed', 'inset-4', 'z-[60]', 'bg-[#04060f]'); }
    }
  });
}

async function boot() {
  if (!document.getElementById('jogos-panel')) return;
  wire();
  renderNoAnalysis();
  await loadStatus();
  await loadSessions();
}

window.__jogosOnTabOpen = () => { loadStatus().catch(() => {}); };
// Abrir a aba pelo painel: expõe função global (app.js já registra a aba em switchEditorPanel)
window.__jogosOpen = () => { try { (window.switchEditorPanel || (() => {}))('jogos'); } catch {} };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();

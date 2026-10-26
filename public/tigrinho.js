/* =========================================================
 * public/tigrinho.js — UI da aba "IA Análise do Tigrinho" (TI Agente)
 * Reutiliza a infraestrutura existente do módulo Jogos (/api/jogos/*).
 * Somente OBSERVAÇÃO e ANÁLISE: não prevê resultados aleatórios,
 * não contorna proteções de sites, não executa apostas com dinheiro real
 * e não dispara giros sem confirmação do usuário.
 * =======================================================*/
const $ = (id) => document.getElementById(id);

const S = {
  sessionId: null,
  url: '',
  host: '',
  gameName: '',
  status: null,          // 'observando' | 'pausada' | 'encerrada' | null
  identification: null,
  liveRead: null,        // { available, accessible, note }
  sessions: [],
  records: [],
  lastReport: null,
  timer: null,
  lastAlertKey: '',
  expanded: false,
  bound: false,
};

/* ---------------- utilitários ---------------- */
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function n2(v, d = 2) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function pct(v, d = 2) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  return n2(Number(v) * 100, d) + '%';
}
function shortTime(ts) {
  if (!ts) return '—';
  const n = Number(ts);
  const d = Number.isFinite(n) && String(n).length >= 10 ? new Date(n < 1e12 ? n * 1000 : n) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('pt-BR');
}

/** Mensagem fixa na barra de abertura. kind: 'ok' | 'warn' | 'err' */
function flash(id, msg, kind) {
  const el = $(id);
  if (!el) return;
  el.classList.remove('hidden');
  el.className = el.className.replace(/\b(border|bg|text)-\S+/g, '').trim();
  const tone = kind === 'err'
    ? 'border-rose-400/30 bg-rose-500/[0.07] text-rose-200'
    : kind === 'warn'
      ? 'border-amber-400/25 bg-amber-500/[0.07] text-amber-200'
      : 'border-emerald-400/30 bg-emerald-500/[0.07] text-emerald-200';
  el.className = `${tone} rounded-md border px-2.5 py-1.5 text-[10.5px] leading-relaxed`;
  el.textContent = msg;
}

/** Notificação temporária no canto do painel (não cobre o jogo). */
function notify(msg, kind = 'info', ms = 6000) {
  const box = $('tg-notifs');
  if (!box) return;
  const card = document.createElement('div');
  card.className = 'pointer-events-auto rounded-lg border px-2.5 py-2 text-[10.5px] leading-relaxed shadow-lg backdrop-blur-sm '
    + (kind === 'alert'
      ? 'border-amber-400/40 bg-amber-950/90 text-amber-50'
      : kind === 'err'
        ? 'border-rose-500/30 bg-rose-950/90 text-rose-100'
        : kind === 'ok'
          ? 'border-emerald-500/30 bg-slate-900/95 text-emerald-100'
          : 'border-violet-400/30 bg-slate-900/95 text-violet-100');
  card.textContent = msg;
  box.appendChild(card);
  setTimeout(() => { try { card.remove(); } catch (_) {} }, ms);
}

/** Chamada à API do módulo Jogos (infraestrutura já existente). */
async function api(path, method = 'GET', body = null) {
  try {
    const res = await fetch('/api/jogos' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({ ok: false, reason: 'Resposta inválida do servidor.' }));
    return data || { ok: false, reason: 'Sem resposta do servidor.' };
  } catch (e) {
    return { ok: false, reason: 'Falha de rede: ' + String(e && e.message ? e.message : e) };
  }
}

/* ---------------- status / sessões ---------------- */
async function loadStatus() {
  const r = await api('/status');
  const dot = $('tg-backend-dot'), label = $('tg-backend-label');
  if (!dot || !label) return;
  if (!r || r.ok === false) { dot.textContent = '🔴'; label.textContent = 'indisponível'; return; }
  const real = !!r.realBrowser;
  const live = !!r.liveReadAvailable;
  dot.textContent = real ? '🟢' : '🟡';
  label.textContent = real ? (live ? 'navegador real' : 'abre página (sem leitura contínua)') : 'fetch (sem navegador real)';
  label.title = r.note || '';
}

async function refreshSessions(keepSelection = true) {
  const r = await api('/sessions');
  const items = (r && r.ok && Array.isArray(r.items)) ? r.items : [];
  S.sessions = items;
  const sel = $('tg-session-select');
  if (!sel) return;
  const current = S.sessionId || sel.value || '';
  sel.innerHTML = '<option value="">— nova sessão —</option>' + items.map(s =>
    `<option value="${esc(s.id)}">${esc(s.gameName || 'sem nome')} · ${esc(s.status || '')} · ${esc(s.recordsCount || 0)} reg.</option>`
  ).join('');
  if (keepSelection && current && items.some(s => s.id === current)) sel.value = current;
  else if (current && !items.some(s => s.id === current)) { /* sessão não existe mais */ }
}

/* ---------------- abertura do jogo ---------------- */
async function openGame() {
  const url = String($('tg-url')?.value || '').trim();
  const hint = String($('tg-game')?.value || '').trim();
  if (!url) { flash('tg-msg', 'Informe a URL completa da plataforma.', 'err'); return; }

  const btn = $('tg-open-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Abrindo…'; }
  try {
    const r = await api('/browser/open', 'POST', { url, hint: hint || undefined });
    if (!r || r.ok === false) {
      const reason = (r && r.reason) || 'Não foi possível abrir a página.';
      flash('tg-msg', reason + (r && r.code ? ` (${r.code})` : ''), 'err');
      notify('Falha ao abrir: ' + reason, 'err');
      showNotice(reason);
      return;
    }
    S.url = r.finalUrl || url;
    S.host = r.host || '';
    S.identification = r.identification || null;
    S.liveRead = {
      available: !!r.liveReadAvailable,
      accessible: !!(r.identification && r.identification.resultsAccessible),
      note: r.note || '',
    };
    if (r.session && r.session.id) { S.sessionId = r.session.id; S.status = r.session.status || null; }
    if (r.identification && r.identification.gameName) S.gameName = r.identification.gameName;

    const hostEl = $('tg-browser-host');
    if (hostEl) hostEl.textContent = r.host || '—';
    const ext = $('tg-browser-external');
    if (ext) ext.href = r.finalUrl || url;
    const gameInput = $('tg-game');
    if (gameInput && r.identification && r.identification.gameName) gameInput.value = r.identification.gameName;

    renderIdentification(r.identification || null);
    showNotice(r.note || '');

    // Só exibe no frame quando o próprio site permite (nada é contornado).
    if (!r.frameBlocked) {
      const frame = $('tg-browser-frame'), empty = $('tg-browser-empty');
      if (frame) { frame.src = r.finalUrl || url; frame.classList.remove('hidden'); }
      if (empty) empty.classList.add('hidden');
    } else {
      const frame = $('tg-browser-frame'), empty = $('tg-browser-empty');
      if (frame) { frame.removeAttribute('src'); frame.classList.add('hidden'); }
      if (empty) empty.classList.remove('hidden');
      notify('Site recusa exibição em frame — use "Nova aba" para jogar.', 'err', 9000);
    }

    if (r.gameChanged) notify(`Jogo diferente do anterior nesta plataforma (antes: ${r.previousGameName || '—'}).`, 'alert');

    // Limitação real de leitura: informada claramente, nunca simulada.
    const limits = [];
    if (r.frameBlocked) limits.push(r.frameReason || 'O site impede exibição em iframe.');
    if (!S.liveRead.available) limits.push('Sem navegador real neste ambiente: a página não é renderizada, então não há leitura ao vivo de rodadas.');
    else if (!S.liveRead.accessible) limits.push('A página não expõe os resultados de forma acessível.');
    if (limits.length) {
      limits.push('Registre rodadas manualmente (marcadas como manuais) ou importe dados autorizados — nada é preenchido por suposição.');
      flash('tg-msg', limits.join(' '), 'warn');
    } else {
      flash('tg-msg', 'Jogo aberto e resultados acessíveis. Clique em "Iniciar observação" quando estiver pronto.', 'ok');
    }

    await refreshSessions();
    updateControls();
    if (S.sessionId) await loadSession(S.sessionId, { silent: true });
    await runAnalysis();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Abrir jogo'; }
  }
}

function showNotice(text) {
  const el = $('tg-browser-notice');
  if (!el) return;
  if (!text) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.classList.remove('hidden');
  el.textContent = text;
}

function renderIdentification(id) {
  const el = $('tg-identification');
  if (!el) return;
  if (!id) { el.innerHTML = 'Nenhum jogo aberto ainda.'; return; }
  const conf = { alta: 'confiança alta', media: 'confiança média', baixa: 'confiança baixa' }[id.confidence] || 'confiança não informada';
  const origin = id.origin === 'pagina' ? 'detectado na página' : id.origin === 'usuario' ? 'informado por você (pista, não verificado)' : 'origem não determinada';
  el.innerHTML = [
    `<div><strong class="text-slate-200">${esc(id.gameName || 'não identificado')}</strong>`
      + (id.gameVersion ? ` <span class="text-slate-400">v${esc(id.gameVersion)}</span>` : '')
      + `</div>`,
    `<div class="text-[10px] text-slate-400 mt-1">${esc(conf)} · ${esc(origin)}</div>`,
    id.provider ? `<div class="text-[10px] text-slate-400">Provedor reconhecido: ${esc(id.provider)}</div>` : '',
    `<div class="text-[10px] text-slate-400">Resultados acessíveis na página: <strong>${id.resultsAccessible ? 'sim' : 'não'}</strong></div>`,
    id.status === 'INCONCLUSIVO'
      ? '<div class="text-[10px] text-amber-300 mt-1">Identificação inconclusiva — confirme o nome do jogo no campo acima e clique em "Salvar".</div>'
      : '',
  ].filter(Boolean).join('');
}

/* ---------------- controles de observação ---------------- */
async function ensureSession() {
  if (S.sessionId) return true;
  const url = S.url || String($('tg-url')?.value || '').trim();
  const gameName = String($('tg-game')?.value || '').trim() || S.gameName;
  if (!url) { flash('tg-msg', 'Abra o jogo (ou informe a URL) antes de iniciar a observação.', 'err'); return false; }
  if (!gameName) { flash('tg-msg', 'Confirme o nome do jogo antes de iniciar a observação.', 'err'); return false; }
  const r = await api('/session', 'POST', { siteUrl: url, gameName, ownership: 'autorizado' });
  if (!r || r.ok === false) { flash('tg-msg', (r && r.reason) || 'Não foi possível criar a sessão.', 'err'); return false; }
  S.sessionId = r.session.id;
  S.gameName = gameName;
  S.status = r.session.status || 'observando';
  await refreshSessions();
  return true;
}

async function startObservation() {
  if (!(await ensureSession())) return;
  const r = await api(`/session/${encodeURIComponent(S.sessionId)}/state`, 'POST', { status: 'observando' });
  if (!r || r.ok === false) { flash('tg-msg', (r && r.reason) || 'Não foi possível iniciar a observação.', 'err'); return; }
  S.status = 'observando';
  flash('tg-msg', 'Observação em andamento.', 'ok');
  notify('Observação iniciada.', 'ok', 4000);

  if (!S.liveRead || !S.liveRead.available || !S.liveRead.accessible) {
    notify('Leitura automática indisponível: registre rodadas manualmente (origem manual) ou importe dados autorizados.', 'err', 9000);
  }
  startTimer();
  updateControls();
  await refreshSessionData();
  await runAnalysis();
}

async function togglePause() {
  if (!S.sessionId) return;
  const next = S.status === 'observando' ? 'pausada' : 'observando';
  const r = await api(`/session/${encodeURIComponent(S.sessionId)}/state`, 'POST', { status: next });
  if (!r || r.ok === false) { flash('tg-msg', (r && r.reason) || 'Não foi possível alterar o estado.', 'err'); return; }
  S.status = next;
  if (next === 'pausada') { stopTimer(); notify('Observação pausada.', 'info', 4000); }
  else { startTimer(); notify('Observação retomada.', 'ok', 4000); }
  updateControls();
}

async function endObservation() {
  if (!S.sessionId) return;
  const r = await api(`/session/${encodeURIComponent(S.sessionId)}/end`, 'POST', {});
  if (!r || r.ok === false) { flash('tg-msg', (r && r.reason) || 'Não foi possível encerrar a sessão.', 'err'); return; }
  S.status = 'encerrada';
  stopTimer();
  notify('Sessão encerrada. Resumo final abaixo.', 'ok', 8000);
  flash('tg-msg', 'Sessão encerrada: os dados disponíveis foram salvos.', 'ok');
  updateControls();
  await refreshSessionData();
  await runAnalysis({ forceReport: true });
  await refreshSessions(false);
}

function startTimer() {
  stopTimer();
  S.timer = setInterval(async () => {
    if (S.status !== 'observando' || !S.sessionId) return;
    await refreshSessionData();
    await runAnalysis();
  }, 10000);
}
function stopTimer() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }

function updateControls() {
  const has = !!S.sessionId;
  const running = S.status === 'observando';
  const ended = S.status === 'encerrada';
  const start = $('tg-start-btn'), pause = $('tg-pause-btn'), end = $('tg-end-btn');
  if (start) start.disabled = ended || running;
  if (pause) { pause.disabled = !has || ended; pause.textContent = running ? 'Pausar' : 'Continuar'; }
  if (end) end.disabled = !has || ended;
}

/* ---------------- registro manual ---------------- */
async function registerRound() {
  if (!S.sessionId) { flash('tg-round-msg', 'Inicie/abra uma sessão antes de registrar rodadas.', 'err'); return; }
  if (S.status === 'encerrada') { flash('tg-round-msg', 'Sessão encerrada: não recebe novos registros.', 'err'); return; }
  const outcome = String($('tg-round-outcome')?.value || '').trim();
  const multRaw = $('tg-round-mult')?.value;
  const betRaw = $('tg-round-bet')?.value;
  const roundId = String($('tg-round-id')?.value || '').trim();
  if (!outcome && (multRaw === '' || multRaw === undefined)) {
    flash('tg-round-msg', 'Informe ao menos o resultado/símbolo ou o multiplicador.', 'err'); return;
  }
  const rec = {};
  if (roundId) rec.roundId = roundId;
  if (outcome) rec.outcome = outcome;
  if (multRaw !== '' && multRaw !== undefined) rec.multiplier = Number(multRaw);
  if (betRaw !== '' && betRaw !== undefined) rec.bet = Number(betRaw);
  rec.ts = Date.now();

  const r = await api(`/session/${encodeURIComponent(S.sessionId)}/records`, 'POST', {
    records: [rec],
    kind: 'observed',
    method: 'registro manual do usuário',
    source: S.host || 'manual',
    dataset: 'discovery',
  });
  if (!r || r.ok === false) { flash('tg-round-msg', (r && r.reason) || 'Não foi possível registrar.', 'err'); return; }
  const msg = r.added > 0
    ? `Registrado (origem manual). Total: ${r.totals.records} rodada(s) observada(s).`
    : `Nada adicionado: registro idêntico/duplicado (${r.duplicatesRemoved} duplicado(s)).`;
  flash('tg-round-msg', msg, r.added > 0 ? 'ok' : 'warn');
  if ($('tg-round-id')) $('tg-round-id').value = '';
  if ($('tg-round-outcome')) $('tg-round-outcome').value = '';
  if ($('tg-round-mult')) $('tg-round-mult').value = '';
  await refreshSessionData();
  await runAnalysis();
}

/* ---------------- sessão: dados / histórico ---------------- */
async function loadSession(id, { silent = false } = {}) {
  if (!id) return;
  S.sessionId = id;
  const r = await api(`/session/${encodeURIComponent(id)}?records=1`);
  if (!r || r.ok === false) { if (!silent) flash('tg-msg', (r && r.reason) || 'Sessão não encontrada.', 'err'); S.sessionId = null; return; }
  S.status = r.session.status || null;
  S.gameName = r.session.gameName || '';
  S.host = r.session.siteHost || S.host;
  S.url = r.session.siteUrl || S.url;
  if ($('tg-url') && S.url) $('tg-url').value = S.url;
  if ($('tg-game') && S.gameName) $('tg-game').value = S.gameName;
  const hostEl = $('tg-browser-host');
  if (hostEl) hostEl.textContent = S.host || '—';
  const ext = $('tg-browser-external');
  if (ext && S.url) ext.href = S.url;
  renderHistory(r.records || []);
  updateControls();
  await runAnalysis();
}

async function refreshSessionData() {
  if (!S.sessionId) return;
  const r = await api(`/session/${encodeURIComponent(S.sessionId)}?records=1`);
  if (!r || r.ok === false) return;
  S.status = r.session.status || S.status;
  S.gameName = r.session.gameName || S.gameName;
  renderHistory(r.records || []);
  updateControls();
}

function renderHistory(records) {
  S.records = records || [];
  const el = $('tg-history');
  if (!el) return;
  if (!records.length) { el.textContent = 'Sem rodadas registradas nesta sessão.'; return; }
  const lines = records.slice(-120).map(r => {
    const parts = [];
    if (r.roundId !== null && r.roundId !== undefined) parts.push('#' + r.roundId);
    parts.push(r.outcome !== null && r.outcome !== undefined ? r.outcome : '(sem resultado)');
    if (r.multiplier !== null && r.multiplier !== undefined) parts.push('×' + r.multiplier);
    if (r.bet !== null && r.bet !== undefined) parts.push('aposta ' + r.bet);
    parts.push('[' + (r.kind || 'observed') + (r.method ? ' · ' + r.method : '') + ']');
    parts.push(shortTime(r.ts));
    return parts.join(' ');
  });
  el.textContent = lines.join('\n');
}

/* ---------------- análise, KPIs e alertas ---------------- */
async function runAnalysis({ forceReport = false } = {}) {
  if (!S.sessionId) { renderEmptyAnalysis(); return; }
  const r = await api(`/session/${encodeURIComponent(S.sessionId)}/analyze`, 'POST', {});
  if (!r || r.ok === false) {
    renderEmptyAnalysis(r && r.reason ? r.reason : null);
    return;
  }
  const rep = r.report;
  S.lastReport = rep;
  renderKpis(rep);
  renderState(rep);
  renderAlerts(rep);
  if (forceReport) renderReport(rep);
}

function renderEmptyAnalysis(reason) {
  const badge = $('tg-state-badge');
  if (badge) { badge.textContent = 'SEM DADOS'; badge.className = 'inline-flex items-center rounded-md px-2 py-0.5 border text-[10.5px] font-bold border-slate-500/30 bg-white/5 text-slate-300'; }
  const kpis = $('tg-kpis');
  if (kpis) kpis.innerHTML = '';
  const dv = $('tg-data-version');
  if (dv) dv.textContent = reason ? String(reason) : 'Aguardando dados: nada é exibido como resultado real sem amostra.';
  const alerts = $('tg-alerts');
  if (alerts) alerts.innerHTML = '<div class="text-[10.5px] text-slate-600">Nenhum alerta. A análise só emite alerta com dados que o sustentem.</div>';
}

function kpi(label, value, hint) {
  return `<div class="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5">
    <div class="text-[9px] uppercase tracking-wider text-slate-500 font-bold">${esc(label)}</div>
    <div class="text-[13px] font-bold text-slate-100 mt-0.5">${esc(value)}</div>
    ${hint ? `<div class="text-[9px] text-slate-500 leading-tight mt-0.5">${esc(hint)}</div>` : ''}
  </div>`;
}

function renderKpis(rep) {
  const kpis = $('tg-kpis');
  if (!kpis || !rep) return;
  const o = rep.observed || {};
  const cards = [
    kpi('Rodadas observadas', String(o.nObserved ?? '—'), 'dados observados (não inclui simulados/estimados)'),
    kpi('RTP observado', pct(o.rtpObserved), 'estatística da amostra'),
    kpi('Vitórias (×≥1)', pct(o.winRate), 'fração de multiplicadores ≥ 1'),
    kpi('Resultado líquido', o.netResult === null || o.netResult === undefined ? '—' : n2(o.netResult), 'retorno − aposta, na amostra'),
    kpi('Categorias distintas', String(o.distinctOutcomes ?? '—'), 'símbolos/resultados diferentes'),
    kpi('Mult. médio', o.multiplier ? '×' + n2(o.multiplier.mean) : '—', o.multiplier ? `min ×${n2(o.multiplier.min)} · máx ×${n2(o.multiplier.max)}` : 'sem multiplicadores'),
  ];
  kpis.innerHTML = cards.join('');

  const src = $('tg-sources');
  if (src) {
    const byKind = {}; const byMethod = {};
    for (const r of S.records) {
      const k = r.kind || 'observed';
      byKind[k] = (byKind[k] || 0) + 1;
      const m = r.method || 'não informado';
      byMethod[m] = (byMethod[m] || 0) + 1;
    }
    const kindTxt = Object.entries(byKind).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—';
    const methodTxt = Object.entries(byMethod).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—';
    const ev = rep.theoreticalEV;
    const evTxt = (ev && ev.ok)
      ? `EV teórico por unidade: ${(Number(ev.ev) * 100).toFixed(2)}% (fonte: ${esc(ev.source || 'tabela informada')})`
      : 'EV teórico: indisponível (sem tabela de referência verificável).';
    src.innerHTML = `<div>Origem dos registros — tipo: ${esc(kindTxt)}</div>`
      + `<div>Método: ${esc(methodTxt)}</div>`
      + `<div class="mt-1">${evTxt}</div>`
      + `<div class="mt-1">Probabilidades teóricas são da fonte de referência; aqui (RTP/×) é a amostra observada — nunca somadas.</div>`;
  }
  const dv = $('tg-data-version');
  if (dv) dv.textContent = `${rep.motorVersion || ''} · ${rep.dataVersion || ''}` + (rep.integrity ? ` · duplicados removidos: ${rep.integrity.duplicatesRemoved || 0}` : '');
}

function renderState(rep) {
  const badge = $('tg-state-badge');
  if (!badge || !rep || !rep.state) return;
  const st = rep.state.state || '—';
  badge.textContent = st;
  const alertish = st === 'POSSÍVEL ANOMALIA' || st === 'VALIDADA EM DADOS INDEPENDENTES';
  const investigate = st === 'HIPÓTESE EM INVESTIGAÇÃO' || st === 'INCONCLUSIVA' || st === 'NÃO VALIDADA';
  badge.className = 'inline-flex items-center rounded-md px-2 py-0.5 border text-[10.5px] font-bold '
    + (alertish
      ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
      : investigate
        ? 'border-violet-400/30 bg-violet-500/10 text-violet-200'
        : 'border-slate-500/30 bg-white/5 text-slate-300');
  badge.title = rep.state.reason || '';
}

/** Alertas: apenas desvios estatísticos sustentados, com amostra e incerteza. */
function computeAlerts(rep) {
  const out = [];
  if (!rep) return out;
  const st = rep.state && rep.state.state;
  const hyp = Array.isArray(rep.hypotheses) ? rep.hypotheses : [];
  const sig = hyp.filter(h => h.uncertainty && Number.isFinite(Number(h.uncertainty.pValue)) && h.uncertainty.pValue <= 0.05);
  if (st === 'POSSÍVEL ANOMALIA' || st === 'VALIDADA EM DADOS INDEPENDENTES') {
    out.push({
      level: 'alert',
      title: 'Possível alteração estatística detectada',
      detail: `${rep.state.reason || ''} Amostra: n=${rep.observed?.nObserved ?? '—'}. Isto NÃO significa que o jogo está pagando mais nem garante ganho.`,
    });
  }
  for (const h of sig) {
    out.push({
      level: st === 'POSSÍVEL ANOMALIA' ? 'alert' : 'info',
      title: h.title || 'Desvio estatístico',
      detail: `${h.observed || ''} · ${h.testApplied || ''} · p=${Number(h.uncertainty.pValue).toFixed(4)} · n=${h.sampleSize ?? '—'}. Alternativas: ${(h.alternativeExplanations || []).join('; ')}.`,
    });
  }
  if (!out.length && rep.observed && rep.observed.nObserved > 0) {
    out.push({
      level: 'info',
      title: 'Sem desvio sustentado até agora',
      detail: `${rep.decision ? rep.decision.reason : ''} n=${rep.observed.nObserved}. Amostras pequenas geram falsos positivos.`,
    });
  }
  return out;
}

function renderAlerts(rep) {
  const el = $('tg-alerts');
  if (!el) return;
  const alerts = computeAlerts(rep);
  if (!alerts.length) {
    el.innerHTML = '<div class="text-[10.5px] text-slate-600">Nenhum alerta. A análise só emite alerta com dados que o sustentem.</div>';
    return;
  }
  el.innerHTML = alerts.map(a => `<div class="rounded-lg border px-2.5 py-2 ${a.level === 'alert' ? 'border-amber-400/40 bg-amber-500/[0.08]' : 'border-white/10 bg-black/25'}">
    <div class="text-[10.5px] font-bold ${a.level === 'alert' ? 'text-amber-200' : 'text-slate-200'}">${esc(a.title)}</div>
    <div class="text-[10px] text-slate-400 leading-relaxed mt-0.5">${esc(a.detail)}</div>
  </div>`).join('');

  // Notificação temporária somente quando o conjunto de alertas muda (evita spam).
  const key = alerts.map(a => a.level + '|' + a.title).join(';');
  if (key !== S.lastAlertKey) {
    S.lastAlertKey = key;
    const first = alerts.find(a => a.level === 'alert');
    if (first) notify('⚠️ ' + first.title + ' — ' + first.detail, 'alert', 9000);
  }
}

function renderReport(rep) {
  const el = $('tg-report-out');
  if (!el) return;
  if (!rep) { el.textContent = 'Sem dados para relatório.'; return; }
  const o = rep.observed || {};
  const lines = [];
  lines.push(`Relatório da sessão · ${rep.generatedAt || ''}`);
  lines.push(`Motor: ${rep.motorVersion || '—'} · ${rep.dataVersion || ''}`);
  lines.push(`Jogo: ${S.gameName || '—'} · site: ${S.host || '—'}`);
  lines.push('');
  lines.push(`Rodadas observadas: ${o.nObserved ?? '—'} (registros totais: ${o.nRecords ?? '—'})`);
  lines.push(`RTP observado: ${pct(o.rtpObserved)} · Resultado líquido: ${o.netResult === null || o.netResult === undefined ? '—' : n2(o.netResult)}`);
  lines.push(`Estado: ${rep.state?.state || '—'} — ${rep.state?.reason || ''}`);
  lines.push(`Decisão: ${rep.decision?.decision || '—'} — ${rep.decision?.reason || ''}`);
  lines.push('');
  lines.push('Hipóteses:');
  for (const h of (rep.hypotheses || [])) {
    lines.push(`• ${h.title} — ${h.observed || ''} ${h.uncertainty ? `| p=${Number(h.uncertainty.pValue).toFixed(4)}` : '| não testável'} (n=${h.sampleSize ?? '—'})`);
  }
  lines.push('');
  lines.push('Ressalvas:');
  for (const d of (rep.disclaimers || [])) lines.push('• ' + d);
  el.classList.remove('hidden');
  el.textContent = lines.join('\n');
}

/* ---------------- correção manual do nome do jogo ---------------- */
async function saveGameName() {
  const name = String($('tg-game')?.value || '').trim();
  const url = S.url || String($('tg-url')?.value || '').trim();
  if (!name) { flash('tg-msg', 'Informe o nome do jogo.', 'err'); return; }
  if (!url) { flash('tg-msg', 'Informe a URL da plataforma antes de salvar o nome.', 'err'); return; }
  if (S.sessionId && S.gameName === name) { flash('tg-msg', 'Nome já aplicado à sessão atual.', 'ok'); return; }

  const r = await api('/session', 'POST', { siteUrl: url, gameName: name, ownership: 'autorizado' });
  if (!r || r.ok === false) { flash('tg-msg', (r && r.reason) || 'Não foi possível criar a sessão.', 'err'); return; }
  const had = !!S.sessionId;
  S.sessionId = r.session.id;
  S.gameName = name;
  S.status = r.session.status || 'observando';
  flash('tg-msg', had
    ? `Nome corrigido: "${name}". O histórico fica separado por jogo (nova sessão).`
    : `Sessão criada para "${name}".`, 'ok');
  await refreshSessions();
  await loadSession(S.sessionId, { silent: true });
}

/* ---------------- wiring ---------------- */
function bind() {
  if (S.bound) return;
  S.bound = true;
  $('tg-open-btn')?.addEventListener('click', openGame);
  $('tg-game-save')?.addEventListener('click', saveGameName);
  $('tg-start-btn')?.addEventListener('click', startObservation);
  $('tg-pause-btn')?.addEventListener('click', togglePause);
  $('tg-end-btn')?.addEventListener('click', endObservation);
  $('tg-round-btn')?.addEventListener('click', registerRound);
  $('tg-refresh-btn')?.addEventListener('click', async () => { await refreshSessions(); await refreshSessionData(); await runAnalysis(); });
  $('tg-report-btn')?.addEventListener('click', async () => { await runAnalysis({ forceReport: true }); });
  $('tg-url')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openGame(); } });
  $('tg-session-select')?.addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!id) { S.sessionId = null; S.status = null; renderHistory([]); renderEmptyAnalysis(); updateControls(); return; }
    await loadSession(id);
  });
  $('tg-expand-btn')?.addEventListener('click', () => {
    const gameCol = $('tg-game-col'), sideCol = $('tg-side-col'), btn = $('tg-expand-btn');
    S.expanded = !S.expanded;
    if (gameCol) gameCol.style.gridColumn = S.expanded ? 'span 12 / span 12' : '';
    if (sideCol) sideCol.style.gridColumn = S.expanded ? 'span 12 / span 12' : '';
    if (btn) btn.textContent = S.expanded ? 'Reduzir' : 'Ampliar';
  });
}

async function onTabOpen() {
  bind();
  await loadStatus();
  await refreshSessions();
  updateControls();
  if (S.sessionId) { await refreshSessionData(); await runAnalysis(); }
}

async function boot() {
  // Observa quando a aba fica ativa (o clique na aba é tratado pelo app.js).
  window.__tigrinhoOnTabOpen = () => { onTabOpen().catch(() => {}); };
  window.__tigrinhoOnTabClose = () => { stopTimer(); };
  // Se a aba já estiver ativa no carregamento, inicializa.
  const panels = document.getElementById('editor-panels');
  if (panels && panels.dataset.active === 'tigrinho') { bind(); await onTabOpen(); }
}

boot().catch(() => {});

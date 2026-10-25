/* =========================================================
 * jogos/service.js — Orquestração do módulo "Jogos"
 * Sessões de observação, importação autorizada, análise e navegador integrado.
 * Toda a matemática vem de jogos/motor.js (funções puras).
 * =======================================================*/
import path from 'node:path';
import state, { newSessionId } from './state.js';
import {
  buildAnalysis, normalizeRecord, dedupe, checkSessionScope,
  computeObserved, guardAutoMode, pValueChi2, MOTOR_VERSION, MIN_SAMPLE_INFERENCE,
} from './motor.js';

const _log = (...a) => console.log('[JOGOS][service]', ...a);

let _allowFn = () => ({ ok: true });
let _browserAgent = null;
let _initialized = false;

export function init({ dataDir = null, allowFn = null, browserAgent = null } = {}) {
  state.setDataDir(dataDir || path.resolve(process.cwd(), 'jogos/data'));
  if (typeof allowFn === 'function') _allowFn = allowFn;
  if (browserAgent) _browserAgent = browserAgent;
  if (!_initialized) {
    _initialized = true;
    state.loadAll().catch(e => _log('loadAll erro:', String(e?.message || e)));
  }
  return { ok: true, dataDir: state.dataDir, sessions: state.sessions.size };
}

/** Status do módulo + capacidades reais (sem inventar recurso indisponível). */
export function status() {
  const backend = _browserAgent ? _browserAgent.backend : null;
  return {
    ok: true,
    motorVersion: MOTOR_VERSION,
    dataDir: state.dataDir,
    sessions: state.sessions.size,
    browser: {
      available: !!_browserAgent,
      backend,
      liveReadAvailable: backend === 'MCP_INTEGRATED_BROWSER',
      note: backend === 'MCP_INTEGRATED_BROWSER'
        ? 'Navegador real disponível (MCP integrated_browser). A leitura de resultados depende de os elementos da página estarem acessíveis e não bloqueados.'
        : 'Sem navegador real neste ambiente: a abertura retorna apenas título/links/prévia de texto (fetch). A leitura contínua de resultados de rodadas NÃO é possível — use a importação autorizada de dados.',
    },
    minSampleInference: MIN_SAMPLE_INFERENCE,
    disclaimer: 'Módulo de ANÁLISE. Não prevê resultados aleatórios e não executa apostas com dinheiro real.',
  };
}

function nowIso() { return new Date().toISOString(); }

/** Extrai host de uma URL, bloqueando endereços locais/internos. */
function validateUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return { ok: false, reason: 'URL vazia.' };
  let u;
  try { u = new URL(s); } catch { return { ok: false, reason: 'URL malformada.' }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, reason: `Protocolo não permitido: ${u.protocol} (apenas http/https).` };
  const allow = _allowFn(u.href);
  if (allow && allow.ok === false) return { ok: false, reason: allow.reason };
  return { ok: true, url: u.href, host: u.hostname.toLowerCase() };
}

/* ---------------- Sessões ---------------- */
export function createSession(input = {}) {
  const { siteUrl = '', gameName = '', gameVersion = '', mode = '', notes = '', reference = null, ownership = 'autorizado' } = input;
  if (!siteUrl) return { ok: false, reason: 'Informe a URL do site.' };
  if (!gameName) return { ok: false, reason: 'Informe o nome do jogo.' };
  const v = validateUrl(siteUrl);
  if (!v.ok) return { ok: false, reason: v.reason };
  const refErr = reference ? validateReference(reference) : null;
  if (refErr && refErr.ok === false) return refErr;

  const session = {
    id: newSessionId(),
    siteUrl: v.url,
    siteHost: v.host,
    gameName: String(gameName).slice(0, 120),
    gameVersion: gameVersion ? String(gameVersion).slice(0, 60) : null,
    mode: mode ? String(mode).slice(0, 40) : null,
    notes: notes ? String(notes).slice(0, 2000) : '',
    ownership: String(ownership).slice(0, 40),
    status: 'observando',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    endedAt: null,
    reference: reference || null,
    records: [],           // amostra de DESCOBERTA
    validationRecords: [], // amostra INDEPENDENTE (validação fora da amostra)
    risk: null,
    autoMode: { enabled: false, environment: 'demo', log: [] },
    motorVersion: MOTOR_VERSION,
  };
  state.sessions.set(session.id, session);
  state.save(session).catch(e => _log('save erro:', String(e?.message || e)));
  return { ok: true, session: sessionSummary(session) };
}

function validateReference(reference = {}) {
  const { probabilities, payouts } = reference;
  if (!probabilities || !payouts) return { ok: false, reason: 'Referência precisa de "probabilities" e "payouts".' };
  const pk = Object.keys(probabilities), rk = Object.keys(payouts);
  if (!pk.length) return { ok: false, reason: 'Tabela de probabilidades vazia.' };
  const missing = pk.filter(k => !rk.includes(k));
  if (missing.length) return { ok: false, reason: `Sem pagamento (r) para: ${missing.join(', ')}.` };
  const sum = pk.reduce((s, k) => s + Number(probabilities[k] || 0), 0);
  if (Math.abs(sum - 1) > 1e-6) return { ok: false, reason: `Σp = ${sum} ≠ 1 — a tabela de referência não fecha.` };
  if (pk.some(k => !Number.isFinite(Number(probabilities[k])) || Number(probabilities[k]) < 0)) return { ok: false, reason: 'Probabilidade inválida na referência.' };
  if (rk.some(k => !Number.isFinite(Number(payouts[k])) || Number(payouts[k]) < 0)) return { ok: false, reason: 'Pagamento inválido na referência (deve ser retorno TOTAL por unidade, ≥0).' };
  return { ok: true };
}

export function setReference(id, reference = {}) {
  const s = state.get(id);
  if (!s) return { ok: false, reason: 'Sessão não encontrada.' };
  const v = validateReference(reference);
  if (v.ok === false) return v;
  s.reference = { probabilities: reference.probabilities, payouts: reference.payouts, source: String(reference.source || 'informada pelo usuário'), providedAt: nowIso() };
  s.updatedAt = nowIso();
  state.save(s).catch(() => {});
  return { ok: true, reference: { source: s.reference.source, categories: Object.keys(s.reference.probabilities).length } };
}

function sessionSummary(s) {
  return {
    id: s.id, siteUrl: s.siteUrl, siteHost: s.siteHost,
    gameName: s.gameName, gameVersion: s.gameVersion, mode: s.mode,
    status: s.status, createdAt: s.createdAt, updatedAt: s.updatedAt, endedAt: s.endedAt,
    recordsCount: s.records.length, validationRecordsCount: (s.validationRecords || []).length,
    hasReference: !!s.reference,
    autoMode: { enabled: !!s.autoMode?.enabled, environment: s.autoMode?.environment || 'demo' },
  };
}

export function listSessions() { return { ok: true, items: state.list() }; }

export function getSession(id, { includeRecords = true } = {}) {
  const s = state.get(id);
  if (!s) return { ok: false, reason: 'Sessão não encontrada.' };
  return {
    ok: true,
    session: sessionSummary(s),
    reference: s.reference,
    risk: s.risk,
    records: includeRecords ? s.records.slice(-500) : [],
    validationRecords: includeRecords ? (s.validationRecords || []).slice(-500) : [],
    autoMode: s.autoMode,
  };
}

export function endSession(id) {
  const s = state.get(id);
  if (!s) return { ok: false, reason: 'Sessão não encontrada.' };
  s.status = 'encerrada'; s.endedAt = nowIso(); s.updatedAt = nowIso();
  state.save(s).catch(() => {});
  return { ok: true, session: sessionSummary(s) };
}

/** Iniciar/pausar a observação. Não coleta nada sozinho: controla o estado da sessão. */
export function setSessionState(id, status) {
  const s = state.get(id);
  if (!s) return { ok: false, reason: 'Sessão não encontrada.' };
  if (s.status === 'encerrada') return { ok: false, reason: 'Sessão encerrada.' };
  const allowedStatus = ['observando', 'pausada'];
  const next = String(status || '');
  if (!allowedStatus.includes(next)) return { ok: false, reason: `Estado inválido: use ${allowedStatus.join(' ou ')}.` };
  s.status = next; s.updatedAt = nowIso();
  state.save(s).catch(() => {});
  return { ok: true, session: sessionSummary(s) };
}

export async function deleteSession(id) {
  const ok = await state.remove(id);
  return ok ? { ok: true } : { ok: false, reason: 'Sessão não encontrada.' };
}

/* ---------------- Coleta / Importação ---------------- */
/**
 * Acrescenta registros. Nunca inventa valores; aplica dedupe e recusa mistura de sessão.
 * dataset: 'discovery' (padrão) | 'validation'.
 */
export function appendRecords(id, records = [], opts = {}) {
  const s = state.get(id);
  if (!s) return { ok: false, reason: 'Sessão não encontrada.' };
  if (s.status === 'encerrada') return { ok: false, reason: 'Sessão encerrada: não recebe novos registros.' };
  if (!Array.isArray(records) || !records.length) return { ok: false, reason: 'Nenhum registro informado.' };

  const dataset = opts.dataset === 'validation' ? 'validation' : 'discovery';
  const target = dataset === 'validation' ? (s.validationRecords = s.validationRecords || []) : s.records;

  const defaults = {
    kind: opts.kind || 'observed',
    source: opts.source || s.siteHost,
    method: opts.method || 'não informado',
    mode: opts.mode || s.mode || null,
  };
  const normalized = records.map(r => normalizeRecord(r, defaults));
  const tagged = normalized.map(r => ({ ...r, host: s.siteHost, sessionId: s.id }));

  const scopeCheck = checkSessionScope(tagged, { siteHost: s.siteHost });
  const merged = dedupe([...target, ...tagged]);
  const added = merged.records.length - target.length;
  if (dataset === 'validation') s.validationRecords = merged.records; else s.records = merged.records;

  s.updatedAt = nowIso();
  state.save(s).catch(() => {});
  return {
    ok: true,
    dataset,
    received: records.length,
    added,
    duplicatesRemoved: merged.duplicatesRemoved,
    scopeWarnings: scopeCheck.violations,
    totals: { records: s.records.length, validationRecords: (s.validationRecords || []).length },
  };
}

const CSV_ALIASES = {
  roundid: 'roundId', rodada: 'roundId', id: 'roundId', round: 'roundId',
  outcome: 'outcome', resultado: 'outcome', result: 'outcome',
  multiplier: 'multiplier', multiplicador: 'multiplier', mult: 'multiplier',
  bet: 'bet', aposta: 'bet', stake: 'bet', valor: 'bet',
  payout: 'payout', pagamento: 'payout', retorno: 'payout', prize: 'payout',
  ts: 'ts', data: 'ts', datetime: 'ts', timestamp: 'ts', hora: 'ts',
  mode: 'mode', modo: 'mode',
  balancebefore: 'balanceBefore', saldoantes: 'balanceBefore', saldoanterior: 'balanceBefore',
  balanceafter: 'balanceAfter', saldoapos: 'balanceAfter', saldoposterior: 'balanceAfter',
};

function parseCsv(content) {
  const lines = String(content || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { ok: false, reason: 'CSV precisa de cabeçalho + ao menos 1 linha.' };
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const header = lines[0].split(delim).map(h => String(h).trim().toLowerCase().replace(/[\s_-]/g, ''));
  const cols = header.map(h => CSV_ALIASES[h] || null);
  if (!cols.includes('outcome') && !cols.includes('multiplier')) {
    return { ok: false, reason: 'Cabeçalho não reconhecido: inclua ao menos "resultado/outcome" ou "multiplicador/multiplier".' };
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(delim);
    const obj = {};
    let filled = false;
    cols.forEach((c, idx) => {
      if (!c) return;
      let v = cells[idx] === undefined ? null : String(cells[idx]).trim();
      if (v === '' || v === null) return;
      if (c === 'ts') {
        const n = Number(v);
        obj.ts = Number.isFinite(n) && String(n).length >= 10 ? (n < 1e12 ? n * 1000 : n) : Date.parse(v);
        filled = true; return;
      }
      if (['multiplier', 'bet', 'payout', 'balanceBefore', 'balanceAfter'].includes(c)) {
        const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
        if (Number.isFinite(n)) { obj[c] = n; filled = true; }
        return;
      }
      obj[c] = v; filled = true;
    });
    if (filled) rows.push(obj);
  }
  return { ok: true, rows };
}

/** Importação autorizada de dados (JSON de registros ou CSV). */
export function importData(id, input = {}) {
  const s = state.get(id);
  if (!s) return { ok: false, reason: 'Sessão não encontrada.' };
  const format = String(input.format || '').toLowerCase();
  const content = input.content;
  if (!content || typeof content !== 'string') return { ok: false, reason: 'Conteúdo vazio. Cole os dados exportados/autorizados.' };

  let records;
  if (format === 'csv' || (format !== 'json' && /[;\n]/.test(content) && !content.trim().startsWith('[') && !content.trim().startsWith('{'))) {
    const p = parseCsv(content);
    if (!p.ok) return p;
    records = p.rows;
  } else {
    try {
      const parsed = JSON.parse(content);
      records = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.records) ? parsed.records : null);
      if (!records) return { ok: false, reason: 'JSON deve ser um array de registros (ou { records: [...] }).' };
    } catch (e) {
      return { ok: false, reason: `JSON inválido: ${String(e.message || e)}` };
    }
  }
  if (!records.length) return { ok: false, reason: 'Nenhum registro válido encontrado no conteúdo informado.' };

  return appendRecords(id, records, {
    dataset: input.dataset === 'validation' ? 'validation' : 'discovery',
    kind: input.kind || 'observed',
    source: input.source || `importado (${s.siteHost})`,
    method: input.method || 'importação autorizada do usuário',
    mode: input.mode || s.mode || null,
  });
}

/* ---------------- Análise ---------------- */
export function analyze(id, input = {}) {
  const s = state.get(id);
  if (!s) return { ok: false, reason: 'Sessão não encontrada.' };
  if (!s.records.length) return { ok: false, reason: 'Sem registros: inicie a observação ou importe dados autorizados.' };

  if (input.reference) {
    const v = setReference(id, input.reference);
    if (v.ok === false) return v;
  }

  const modesSeries = buildModeSeries(s.records);
  const independentValidation = buildIndependentValidation(s, input.independentValidation);

  const report = buildAnalysis({
    records: s.records,
    scope: { siteHost: s.siteHost, siteUrl: s.siteUrl, gameName: s.gameName, gameVersion: s.gameVersion, mode: s.mode },
    reference: s.reference,
    theoretical: input.theoretical || (s.reference ? { probabilities: s.reference.probabilities, payouts: s.reference.payouts, source: s.reference.source } : null),
    risk: input.risk || s.risk,
    modeSeries: modesSeries,
    independentValidation,
    riskLimitHit: checkRiskLimit(s, input.risk || s.risk),
  });

  if (input.risk) s.risk = input.risk;
  s.lastAnalysis = { at: report.generatedAt, state: report.state.state, decision: report.decision.decision };
  s.updatedAt = nowIso();
  state.save(s).catch(() => {});

  return { ok: true, report };
}

function buildModeSeries(records) {
  const out = {};
  for (const r of records) {
    const key = String(r.mode || '').toLowerCase();
    if (!key) continue;
    if (!out[key]) out[key] = [];
    if (r.bet !== null && r.bet > 0 && r.payout !== null) out[key].push(r.payout / r.bet);
  }
  const keys = Object.keys(out);
  if (keys.length < 2) return null;
  return { a: out[keys[0]], b: out[keys[1]], labels: keys.slice(0, 2) };
}

function buildIndependentValidation(s, provided) {
  const vr = s.validationRecords || [];
  if (provided && Number.isFinite(Number(provided.n)) && Number.isFinite(Number(provided.pValue))) {
    return { n: Number(provided.n), pValue: Number(provided.pValue), origin: provided.origin || 'informada' };
  }
  if (!s.reference || vr.length < MIN_SAMPLE_INFERENCE) return null;
  const order = Object.keys(s.reference.probabilities);
  const counts = order.map(k => vr.filter(r => r.outcome === k).length);
  const n = counts.reduce((a, b) => a + b, 0);
  if (n < MIN_SAMPLE_INFERENCE) return null;
  const expected = order.map(k => n * Number(s.reference.probabilities[k]));
  if (expected.some(e => e < 5)) return null;
  let chi2 = 0;
  for (let i = 0; i < counts.length; i++) { const d = counts[i] - expected[i]; chi2 += (d * d) / expected[i]; }
  return { n, pValue: pValueChi2(chi2, order.length - 1), origin: 'amostra independente registrada na mesma sessão' };
}

function checkRiskLimit(s, risk) {
  if (!risk || !Number.isFinite(Number(risk.maxLoss))) return false;
  const obs = computeObserved(s.records);
  if (obs.netResult === null) return false;
  return obs.netResult <= -Math.abs(Number(risk.maxLoss));
}

/* ---------------- Navegador integrado ---------------- */
export async function openBrowser(url) {
  const v = validateUrl(url);
  if (!v.ok) return { ok: false, reason: v.reason };
  if (!_browserAgent) return { ok: false, reason: 'Navegador integrado indisponível neste ambiente.' };
  const r = await _browserAgent.open(v.url, { timeoutMs: 60000 });
  if (!r.ok) {
    return { ok: false, reason: r.error || 'Falha ao abrir a página.', code: r.code || 'OPEN_FAILED', host: v.host };
  }
  const info = _browserAgent.getInfo(r.contextId);
  return {
    ok: true,
    host: v.host,
    contextId: r.contextId,
    backend: r.backend,
    status: r.status,
    title: r.title,
    finalUrl: r.finalUrl,
    liveReadAvailable: r.backend === 'MCP_INTEGRATED_BROWSER',
    preview: info.ok ? String(info.textPreview || '').slice(0, 4000) : '',
    linksCount: info.ok ? info.linksCount : 0,
    note: r.backend === 'MCP_INTEGRATED_BROWSER'
      ? 'Página aberta. A leitura de resultados depende da estrutura do site e de as informações estarem acessíveis.'
      : 'Aberto em modo fetch (sem navegador real): título/links/prévia apenas. Leitura contínua de rodadas indisponível — use importação autorizada.',
  };
}

/* ---------------- Modo automático (somente demo/simulação) ---------------- */
export function setAutoMode(id, cfg = {}) {
  const s = state.get(id);
  if (!s) return { ok: false, reason: 'Sessão não encontrada.' };
  const guard = guardAutoMode({ environment: cfg.environment, realMoney: cfg.realMoney });
  if (!guard.allowed) {
    s.autoMode = { enabled: false, environment: cfg.environment || 'demo', log: s.autoMode?.log || [], blockedReason: guard.reason };
    state.save(s).catch(() => {});
    return { ok: false, reason: guard.reason, allowedInstead: guard.allowedInstead };
  }
  s.autoMode = { enabled: !!cfg.enabled, environment: 'demo', log: s.autoMode?.log || [], rules: guard.rules };
  state.save(s).catch(() => {});
  return { ok: true, autoMode: { enabled: s.autoMode.enabled, environment: 'demo', rules: guard.rules } };
}

/**
 * Uma iteração do modo automático em DEMO: consulta o motor de decisão ANTES
 * de qualquer ação de teste e registra decisão + justificativa + resultado.
 */
export function autoStep(id, input = {}) {
  const s = state.get(id);
  if (!s) return { ok: false, reason: 'Sessão não encontrada.' };
  if (!s.autoMode?.enabled) return { ok: false, reason: 'Modo automático desligado.' };
  const guard = guardAutoMode({ environment: 'demo', realMoney: false });
  if (!guard.allowed) return { ok: false, reason: guard.reason };

  const report = analyze(id, input).report;
  if (!report) return { ok: false, reason: 'Análise indisponível.' };
  const decision = report.decision;
  const canTest = ['ANOMALIA A INVESTIGAR', 'NÃO HÁ VANTAGEM DEMONSTRADA'].includes(decision.decision) && !decision.stop;

  const entry = {
    at: nowIso(),
    environment: 'demo',
    decision: decision.decision,
    reason: decision.reason,
    action: canTest ? 'executar_giro_de_teste_em_demo' : 'pausar_sem_acao',
    pausedBecause: canTest ? null : decision.reason,
    dataVersion: report.dataVersion,
  };

  if (canTest && input.simulateRound) {
    const rng = () => Math.random();
    entry.simulatedResult = { kind: 'simulation', note: 'resultado SIMULADO em demo — não é resultado real', draw: rng() };
  }
  s.autoMode.log = [...(s.autoMode.log || []), entry].slice(-200);
  s.updatedAt = nowIso();
  state.save(s).catch(() => {});
  return { ok: true, step: entry, logSize: s.autoMode.log.length };
}

/* Reexport para as rotas do servidor */
export { computeObserved, MOTOR_VERSION };

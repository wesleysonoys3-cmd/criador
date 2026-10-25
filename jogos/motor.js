/* =========================================================
 * jogos/motor.js — Motor matemático do módulo "Jogos" (TI Agente)
 * ---------------------------------------------------------
 * Funções PURAS: sem I/O, sem DOM, sem rede. Testável isoladamente.
 *
 * DEFINIÇÕES (obrigatórias para reproduzir os cálculos):
 *  • multiplicador (r) = RETORNO TOTAL por unidade apostada, JÁ INCLUINDO a aposta original.
 *      r = 0    → perdeu a aposta
 *      r = 1    → devolveu exatamente a aposta (empate)
 *      r = 2.5  → devolveu 2,5× a aposta
 *  • payout (moeda) = bet × r  (quando informado diretamente, prevalece)
 *  • RTP OBSERVADO = Σ payout / Σ bet  — é uma ESTATÍSTICA DA AMOSTRA, NÃO o RTP teórico.
 *  • EV por unidade = Σ p_i·r_i − 1  (só calculado com p_i VERIFICÁVEIS fornecidas).
 *  • "validada" significa APENAS: o teste especificado foi reproduzido em dados
 *    independentes sob as condições documentadas. NÃO significa que o próximo giro vencerá.
 * =======================================================*/
export const MOTOR_VERSION = 'jogos_motor_v1';

/** Amostra mínima para qualquer Inferência. Abaixo disso: AMOSTRA INSUFICIENTE. */
export const MIN_SAMPLE_INFERENCE = 30;
/** Amostra mínima para tratar um desvio como hipótese investigável. */
export const MIN_SAMPLE_HYPOTHESIS = 200;
/** Contagens esperadas mínimas para o teste χ² ser válido. */
export const MIN_EXPECTED_COUNT = 5;

export const STATES = Object.freeze({
  COLETANDO: 'COLETANDO DADOS',
  AMOSTRA_INSUFICIENTE: 'AMOSTRA INSUFICIENTE',
  HIPOTESE_INVESTIGACAO: 'HIPÓTESE EM INVESTIGAÇÃO',
  POSSIVEL_ANOMALIA: 'POSSÍVEL ANOMALIA',
  NAO_VALIDADA: 'NÃO VALIDADA',
  VALIDADA_INDEPENDENTE: 'VALIDADA EM DADOS INDEPENDENTES',
  INCONCLUSIVA: 'INCONCLUSIVA',
});

export const DECISIONS = Object.freeze({
  CONTINUAR: 'CONTINUAR OBSERVAÇÃO',
  HIPOTESE_NAO_COMPROVADA: 'HIPÓTESE NÃO COMPROVADA',
  SEM_VANTAGEM: 'NÃO HÁ VANTAGEM DEMONSTRADA',
  EV_DESFAVORAVEL: 'EXPECTATIVA MATEMÁTICA DESFAVORÁVEL',
  ANOMALIA_INVESTIGAR: 'ANOMALIA A INVESTIGAR',
  EVIDENCIA_INSUFICIENTE: 'EVIDÊNCIA INDEPENDENTE INSUFICIENTE',
});

/* =========================================================
 * 1) ESTATÍSTICA BÁSICA (funções de precisão documentadas)
 * =======================================================*/
export function normalCdf(z) {
  // Abramowitz–Stegun 7.1.26 (|erro| < 1.5e-7)
  const x = Number(z);
  if (!Number.isFinite(x)) return NaN;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

function lnGamma(x) {
  // Lanczos g=7, n=9 (~1e-15)
  const g = 7;
  const C = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = C[0];
  const t = x + g + 0.5;
  for (let i = 1; i <= g + 1; i++) a += C[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** P(a,x) — gama incompleta regularizada inferior (série + fração continuada). */
export function lowerRegGamma(a, x) {
  if (!(a > 0) || x < 0) return NaN;
  if (x === 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a, del = sum;
    let ap = a;
    for (let n = 1; n <= 400; n++) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // fração continuada (Lentz) para Q(a,x)
  const tiny = 1e-300;
  let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i <= 400; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** CDF da distribuição χ² com k graus de liberdade. */
export function chi2Cdf(x, k) {
  const xx = Number(x), kk = Number(k);
  if (!(kk > 0) || !Number.isFinite(xx)) return NaN;
  if (xx <= 0) return 0;
  return lowerRegGamma(kk / 2, xx / 2);
}

export function pValueChi2(x, k) {
  const c = chi2Cdf(x, k);
  return Number.isFinite(c) ? Math.max(0, Math.min(1, 1 - c)) : NaN;
}

/** p-valor bicaudal para estatística t com df (aproximação normal, documentada). */
export function tTwoSidedP(t, df) {
  const tt = Number(t), d = Number(df);
  if (!Number.isFinite(tt)) return NaN;
  if (!Number.isFinite(d) || d <= 0) return 2 * (1 - normalCdf(Math.abs(tt)));
  // Correção de Edgeworth de 1ª ordem para amostras moderadas.
  const z = Math.abs(tt);
  const p = 2 * (1 - normalCdf(z)) + 2 * (1 - normalCdf(z)) * 0; // base normal
  const corr = (z * (z * z + 3)) / (12 * d) * 2 * Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  return Math.max(0, Math.min(1, p + corr));
}

export function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN; }
export function variance(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1);
}
export function stddev(a) { const v = variance(a); return Number.isFinite(v) ? Math.sqrt(v) : NaN; }
export function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return NaN;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

/** PRNG determinístico (mulberry32) — garante Monte Carlo REPRODUZÍVEL. */
export function makeRng(seed) {
  let s = (Number(seed) >>> 0) || 0x9e3779b9;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickWeighted(probs, rng) {
  let acc = 0; const u = rng();
  for (let i = 0; i < probs.length; i++) { acc += probs[i].p; if (u <= acc) return probs[i]; }
  return probs[probs.length - 1];
}

/* =========================================================
 * 2) INTEGRIDADE DOS DADOS
 * =======================================================*/
const KINDS = ['observed', 'official', 'simulation'];

/** Normaliza e classifica um registro. Nunca inventa campos ausentes. */
export function normalizeRecord(raw = {}, defaults = {}) {
  const src = KINDS.includes(raw.kind) ? raw.kind : (KINDS.includes(defaults.kind) ? defaults.kind : 'observed');
  const num = v => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const bet = num(raw.bet);
  let multiplier = num(raw.multiplier);
  let payout = num(raw.payout);
  // Derivação explícita (documentada): só deriva se UM dos dois estiver ausente e o outro existir.
  if (payout === null && multiplier !== null && bet !== null) payout = bet * multiplier;
  if (multiplier === null && payout !== null && bet !== null && bet > 0) multiplier = payout / bet;
  return {
    ts: num(raw.ts) ?? Date.now(),
    roundId: raw.roundId === undefined || raw.roundId === null ? null : String(raw.roundId),
    outcome: raw.outcome === undefined || raw.outcome === null ? null : String(raw.outcome),
    multiplier, bet, payout,
    balanceBefore: num(raw.balanceBefore), balanceAfter: num(raw.balanceAfter),
    mode: raw.mode ? String(raw.mode) : (defaults.mode ? String(defaults.mode) : null),
    kind: src,
    source: raw.source ? String(raw.source) : (defaults.source ? String(defaults.source) : 'desconhecida'),
    method: raw.method ? String(raw.method) : (defaults.method ? String(defaults.method) : 'desconhecido'),
  };
}

/** Remove duplicatas por roundId (quando existir) ou pela assinatura ts+outcome+multiplier. */
export function dedupe(records) {
  const seen = new Set(); const kept = []; let removed = 0;
  for (const r of records) {
    const key = r.roundId ? `id:${r.roundId}` : `sig:${r.ts}|${r.outcome}|${r.multiplier}`;
    if (seen.has(key)) { removed++; continue; }
    seen.add(key); kept.push(r);
  }
  return { records: kept, duplicatesRemoved: removed };
}

/** Detecta lacunas/ordenação. Não preenche nada — apenas informa. */
export function detectGaps(records) {
  const numericIds = records.map(r => r.roundId).filter(v => v !== null && /^-?\d+$/.test(v)).map(Number);
  const issues = [];
  let missingCount = 0; const missingSamples = [];
  if (numericIds.length >= 2) {
    const sorted = [...numericIds].sort((a, b) => a - b);
    let cursor = sorted[0];
    for (const id of sorted) {
      if (id > cursor) {
        missingCount += id - cursor;
        if (missingSamples.length < 20) for (let g = cursor; g < id && missingSamples.length < 20; g++) missingSamples.push(g);
      }
      cursor = Math.max(cursor, id + 1);
    }
    if (missingCount > 0) issues.push(`lacunas na sequência de roundId: ${missingCount} id(s) ausente(s)`);
  } else if (records.length && records.some(r => r.roundId === null)) {
    issues.push('registros sem roundId (deduplicação/sequência ficam limitadas à assinatura ts+resultado+multiplicador)');
  }
  let outOfOrder = 0;
  for (let i = 1; i < records.length; i++) if (records[i].ts < records[i - 1].ts) outOfOrder++;
  if (outOfOrder) issues.push(`${outOfOrder} registro(s) fora de ordem temporal`);
  const noOutcome = records.filter(r => r.outcome === null).length;
  if (noOutcome) issues.push(`${noOutcome} registro(s) sem resultado (outcome) — excluídos das distribuições`);
  return { missingCount, missingSamples, outOfOrder, withoutOutcome: noOutcome, issues };
}

/** Garante que NÃO há mistura de sessão/site/jogo/modo. */
export function checkSessionScope(records, scope = {}) {
  const violations = [];
  const sites = new Set(records.map(r => r.source).filter(Boolean));
  const kinds = new Set(records.map(r => r.kind));
  if (scope.siteHost && records.some(r => r.host && String(r.host).toLowerCase() !== String(scope.siteHost).toLowerCase())) {
    violations.push('registros de hosts diferentes na mesma sessão');
  }
  if (kinds.has('observed') && (kinds.has('official') || kinds.has('simulation'))) {
    // Permitido coexistir, mas NUNCA somados: sinaliza para a UI separar as séries.
    violations.push('sessão contém dados reais e simulados/oficiais — as séries são mantidas SEPARADAS nos cálculos');
  }
  const invalid = records.filter(r => (r.bet !== null && r.bet < 0) || (r.multiplier !== null && r.multiplier < 0));
  if (invalid.length) violations.push(`${invalid.length} registro(s) com valor negativo`);
  return { ok: violations.length === 0, violations, sources: [...sites], kinds: [...kinds] };
}

/* =========================================================
 * 3) MÉTRICAS OBSERVADAS
 * =======================================================*/
function withMoney(records) { return records.filter(r => r.bet !== null && r.payout !== null); }

export function computeObserved(records = []) {
  const base = records.filter(r => r.kind !== 'simulation');
  const sim = records.filter(r => r.kind === 'simulation');
  const m = withMoney(base);
  const totalBet = m.reduce((s, r) => s + r.bet, 0);
  const totalPayout = m.reduce((s, r) => s + r.payout, 0);
  const rtpObserved = totalBet > 0 ? totalPayout / totalBet : null;

  const outcomes = base.filter(r => r.outcome !== null).map(r => r.outcome);
  const freq = new Map();
  for (const o of outcomes) freq.set(o, (freq.get(o) || 0) + 1);
  const distribution = [...freq.entries()]
    .map(([outcome, count]) => ({ outcome, count, freq: outcomes.length ? count / outcomes.length : null }))
    .sort((a, b) => b.count - a.count);

  const mults = base.filter(r => r.multiplier !== null).map(r => r.multiplier).sort((a, b) => a - b);
  const winRate = mults.length ? mults.filter(v => v >= 1).length / mults.length : null;
  const buckets = [[0, 1], [1, 1.5], [1.5, 2], [2, 5], [5, 10], [10, 50], [50, Infinity]];
  const multHistogram = buckets.map(([lo, hi]) => ({
    range: hi === Infinity ? `≥${lo}×` : `${lo}×–${hi}×`,
    count: mults.filter(v => v >= lo && v < hi).length,
  }));

  const modes = {};
  for (const r of base) {
    const key = r.mode || 'não informado';
    const mm = withMoney([r]);
    modes[key] = modes[key] || { n: 0, totalBet: 0, totalPayout: 0 };
    modes[key].n++;
    if (mm.length) { modes[key].totalBet += r.bet; modes[key].totalPayout += r.payout; }
  }
  for (const k of Object.keys(modes)) {
    const md = modes[k];
    md.rtpObserved = md.totalBet > 0 ? md.totalPayout / md.totalBet : null;
    md.netResult = md.totalBet > 0 ? md.totalPayout - md.totalBet : null;
  }

  const withBalances = base.filter(r => r.balanceBefore !== null && r.balanceAfter !== null);
  let balanceCheck = { available: false, note: 'saldo anterior/posterior não informado em todos os registros' };
  if (withBalances.length && withBalances.length === base.length) {
    const delta = withBalances.reduce((s, r) => s + (r.balanceAfter - r.balanceBefore), 0);
    balanceCheck = {
      available: true,
      deltaObserved: delta,
      deltaComputed: totalPayout - totalBet,
      consistent: Math.abs(delta - (totalPayout - totalBet)) < 0.01,
    };
  }

  return {
    motorVersion: MOTOR_VERSION,
    nRecords: records.length,
    nObserved: base.length,
    nSimulation: sim.length,
    nWithMoney: m.length,
    totalBet, totalPayout,
    netResult: totalBet > 0 ? totalPayout - totalBet : null,
    rtpObserved,
    evObservedPerUnit: rtpObserved === null ? null : rtpObserved - 1,
    winRate,
    multiplier: mults.length ? {
      min: mults[0], max: mults[mults.length - 1],
      mean: mean(mults), median: quantile(mults, 0.5), p95: quantile(mults, 0.95),
      stddev: stddev(mults),
    } : null,
    multiplierHistogram: multHistogram,
    distribution, distinctOutcomes: distribution.length,
    byMode: modes,
    balanceCheck,
    note: 'rtpObserved é estatística da AMOSTRA e não substitui o RTP teórico do jogo.',
  };
}

/** Estatísticas da série de retornos por unidade (x = payout/bet) + IC 95%. */
export function returnSeriesStats(records = []) {
  const series = records
    .filter(r => r.kind !== 'simulation' && r.bet !== null && r.bet > 0 && r.payout !== null)
    .map(r => r.payout / r.bet);
  const n = series.length;
  if (n < 2) return { ok: false, reason: 'série insuficiente (n<2).', n };
  const m = mean(series), v = variance(series), sd = Math.sqrt(v), se = sd / Math.sqrt(n);
  const z = 1.959964;
  return {
    ok: true, n, mean: m, variance: v, stddev: sd, stdError: se,
    ci95: [m - z * se, m + z * se],
    note: 'IC 95% normal (n grande). Interpreta-se como incerteza sobre a MÉDIA da amostra, não sobre o próximo resultado.',
  };
}

/* =========================================================
 * 4) VALOR ESPERADO TEÓRICO (exige p_i verificáveis)
 * =======================================================*/
export function theoreticalEV(input = {}) {
  const { probabilities, payouts } = input;
  if (!probabilities || !payouts) {
    return { ok: false, reason: 'Probabilidades e/ou pagamentos não fornecidos: EV teórico NÃO é calculável. Mostrando apenas dados observados.' };
  }
  const keys = Object.keys(probabilities);
  if (!keys.length) return { ok: false, reason: 'Tabela de probabilidades vazia.' };
  const sumP = keys.reduce((s, k) => s + Number(probabilities[k] || 0), 0);
  if (Math.abs(sumP - 1) > 1e-6) return { ok: false, reason: `Σp = ${sumP} ≠ 1 — probabilidades inválidas ou incompletas.` };
  const rows = [];
  for (const k of keys) {
    const p = Number(probabilities[k]); const r = Number(payouts[k]);
    if (!Number.isFinite(p) || p < 0) return { ok: false, reason: `p inválido para "${k}".` };
    if (!Number.isFinite(r) || r < 0) return { ok: false, reason: `pagamento r inválido para "${k}" (deve ser retorno TOTAL por unidade, ≥0).` };
    rows.push({ outcome: k, p, r, contribution: p * r });
  }
  const ev = rows.reduce((s, x) => s + x.contribution, 0) - 1;
  return {
    ok: true,
    ev,
    evPct: ev * 100,
    houseEdge: -ev,
    rows,
    definitions: 'r = retorno TOTAL por unidade apostada (inclui a aposta original). EV = Σ p_i·r_i − 1.',
    source: input.source || 'não informado',
  };
}

/* =========================================================
 * 5) TESTES ESTATÍSTICOS
 * =======================================================*/
export function chiSquareGOF(counts = [], probs = []) {
  const k = counts.length;
  if (k < 2) return { ok: false, reason: 'precisa de ≥2 categorias.' };
  if (probs.length !== k) return { ok: false, reason: 'counts e probs com tamanhos diferentes.' };
  const sumP = probs.reduce((s, p) => s + Number(p || 0), 0);
  if (Math.abs(sumP - 1) > 1e-6) return { ok: false, reason: `Σp = ${sumP} ≠ 1.` };
  const n = counts.reduce((s, c) => s + c, 0);
  if (n <= 0) return { ok: false, reason: 'sem observações.' };
  const expected = probs.map(p => n * p);
  const bad = expected.filter(e => e < MIN_EXPECTED_COUNT).length;
  if (bad) {
    return { ok: false, reason: `amostra insuficiente: ${bad} categoria(s) com contagem esperada < ${MIN_EXPECTED_COUNT}.`, n, expected };
  }
  let chi2 = 0;
  for (let i = 0; i < k; i++) { const d = counts[i] - expected[i]; chi2 += (d * d) / expected[i]; }
  const df = k - 1;
  const p = pValueChi2(chi2, df);
  return {
    ok: true, n, chi2, df, pValue: p,
    expected, observed: counts,
    cramersV: Math.sqrt(chi2 / (n * df)),
    valid: true,
    note: 'χ² de aderência. p pequeno ⇒ desvio improvável sob a distribuição de referência — NÃO prova vantagem.',
  };
}

/** Compara duas amostras independentes (ex.: modo normal × turbo). */
export function twoSampleCompare(a = [], b = []) {
  const A = a.filter(Number.isFinite), B = b.filter(Number.isFinite);
  if (A.length < 2 || B.length < 2) return { ok: false, reason: 'ambas as amostras precisam de n≥2.' };
  const n1 = A.length, n2 = B.length;
  const m1 = mean(A), m2 = mean(B);
  const v1 = variance(A), v2 = variance(B);
  const se2 = v1 / n1 + v2 / n2;
  if (!(se2 > 0)) return { ok: false, reason: 'variância nula — sem variabilidade para comparar.' };
  const se = Math.sqrt(se2);
  const t = (m1 - m2) / se;
  const df = (se2 * se2) / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
  const p = tTwoSidedP(t, df);
  const pooledSd = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
  return {
    ok: true, n1, n2, mean1: m1, mean2: m2, diff: m1 - m2,
    t, df, pValue: p,
    cohensD: pooledSd > 0 ? (m1 - m2) / pooledSd : null,
    ci95Diff: [m1 - m2 - 1.959964 * se, m1 - m2 + 1.959964 * se],
    note: 't de Welch (aproximação normal + correção de Edgeworth documentada). "normal" e "turbo" só são comparáveis se as demais condições forem idênticas.',
  };
}

/** Homogeneidade da distribuição ao longo do tempo (detecção de mudança). */
export function stabilityOverTime(records = [], bins = 6) {
  const rows = records.filter(r => r.outcome !== null && r.kind !== 'simulation');
  if (rows.length < bins * 10) return { ok: false, reason: `amostra insuficiente para ${bins} janelas temporais.` };
  const ordered = [...rows].sort((x, y) => x.ts - y.ts);
  const size = Math.floor(ordered.length / bins);
  const outcomeKeys = [...new Set(ordered.map(r => r.outcome))];
  if (outcomeKeys.length < 2) return { ok: false, reason: 'resultado único: nenhuma distribuição a comparar.' };
  const table = outcomeKeys.map(() => new Array(bins).fill(0));
  for (let b = 0; b < bins; b++) {
    const slice = ordered.slice(b * size, b === bins - 1 ? ordered.length : (b + 1) * size);
    for (const r of slice) table[outcomeKeys.indexOf(r.outcome)][b]++;
  }
  const colSum = table[0].map((_, j) => table.reduce((s, row) => s + row[j], 0));
  const rowSum = table.map(row => row.reduce((s, v) => s + v, 0));
  const n = colSum.reduce((s, v) => s + v, 0);
  const expected = table.map((_, i) => colSum.map(c => (rowSum[i] * c) / n));
  const minExpected = Math.min(...expected.flat());
  if (minExpected < MIN_EXPECTED_COUNT) {
    return { ok: false, reason: `amostra insuficiente: contagem esperada mínima ${minExpected.toFixed(2)} < ${MIN_EXPECTED_COUNT}.`, minExpected };
  }
  let chi2 = 0;
  for (let i = 0; i < table.length; i++) for (let j = 0; j < bins; j++) {
    const d = table[i][j] - expected[i][j]; chi2 += (d * d) / expected[i][j];
  }
  const df = (table.length - 1) * (bins - 1);
  return {
    ok: true, n, bins, chi2, df, pValue: pValueChi2(chi2, df), table, outcomes: outcomeKeys, minExpected,
    note: 'Teste de homogeneidade k×b. p pequeno ⇒ a distribuição observada mudou entre as janelas.',
  };
}

/** Controle de falsos positivos quando muitas hipóteses são testadas (Benjamini–Hochberg). */
export function benjaminiHochberg(pValues = [], q = 0.05) {
  const items = pValues.map((p, i) => ({ i, p: Number(p) })).filter(x => Number.isFinite(x.p)).sort((a, b) => a.p - b.p);
  const m = items.length;
  const rejected = new Array(pValues.length).fill(false);
  const adjusted = new Array(pValues.length).fill(NaN);
  if (!m) return { ok: false, reason: 'nenhum p-valor válido.', m: 0, rejected, adjusted, threshold: null };
  let kMax = -1;
  items.forEach((it, idx) => {
    const crit = ((idx + 1) / m) * q;
    it.crit = crit;
    if (it.p <= crit) kMax = idx;
  });
  const cut = kMax >= 0 ? items[kMax].p : null;
  for (let idx = 0; idx <= kMax; idx++) rejected[items[idx].i] = true;
  // p-valores ajustados (monotonicidade a partir do maior)
  let running = 1;
  for (let idx = m - 1; idx >= 0; idx--) {
    const val = Math.min(running, (items[idx].p * m) / (idx + 1));
    adjusted[items[idx].i] = val;
    running = val;
  }
  return { ok: true, m, q, threshold: cut, rejected, adjusted, note: 'BH controla a taxa de falsas descobertas em múltiplos testes simultâneos.' };
}

/* =========================================================
 * 6) SIMULAÇÃO DE MONTE CARLO (sempre identificada como SIMULAÇÃO)
 * =======================================================*/
export function monteCarlo(input = {}) {
  const { probabilities, payouts, n = 5000, seed = 12345, bet = 1, bankroll = null } = input;
  if (!probabilities || !payouts) return { ok: false, reason: 'Monte Carlo exige a TABELA de referência (probabilidades + pagamentos). Sem isso seria apenas ruído disfarçado de resultado.' };
  const keys = Object.keys(probabilities);
  const p = keys.map(k => Number(probabilities[k]));
  const r = keys.map(k => Number(payouts[k]));
  if (p.some(v => !Number.isFinite(v) || v < 0) || r.some(v => !Number.isFinite(v) || v < 0)) return { ok: false, reason: 'tabela de referência inválida.' };
  const s = p.reduce((a, b) => a + b, 0);
  if (Math.abs(s - 1) > 1e-6) return { ok: false, reason: `Σp = ${s} ≠ 1.` };
  const rounds = Math.max(100, Math.min(200000, Math.floor(n)));
  const rng = makeRng(seed);
  const table = keys.map((k, i) => ({ k, p: p[i] / s, r: r[i] }));
  let bank = Number.isFinite(bankroll) ? bankroll : null;
  let ruined = 0, sum = 0, sumSq = 0, wins = 0;
  const bankrollPath = [];
  for (let i = 0; i < rounds; i++) {
    const draw = pickWeighted(table, rng);
    const ret = draw.r; sum += ret; sumSq += ret * ret; if (ret >= 1) wins++;
    if (bank !== null) {
      bank += bet * (ret - 1);
      if (bank <= 0) { ruined++; bank = Number.isFinite(bankroll) ? bankroll : 0; }
      if (i % Math.max(1, Math.floor(rounds / 50)) === 0) bankrollPath.push(Number(bank.toFixed(4)));
    }
  }
  const meanRtp = sum / rounds;
  const varRtp = rounds > 1 ? (sumSq - rounds * meanRtp * meanRtp) / (rounds - 1) : NaN;
  return {
    ok: true, kind: 'simulation', label: 'SIMULAÇÃO — NÃO É RESULTADO REAL',
    rounds, seed, meanRtp, netPerUnit: meanRtp - 1, stddev: Math.sqrt(varRtp),
    seRtp: Math.sqrt(varRtp / rounds),
    ci95Rtp: [meanRtp - 1.959964 * Math.sqrt(varRtp / rounds), meanRtp + 1.959964 * Math.sqrt(varRtp / rounds)],
    winRate: wins / rounds,
    ruinProbability: bank !== null ? ruined / rounds : null,
    bankrollPath,
    note: 'Reprodutível com o mesmo seed. Serve para dimensionar RISCO, não para prever o próximo giro.',
  };
}

/* =========================================================
 * 7) HIPÓTESES · ANOMALIAS · DECISÃO
 * =======================================================*/
/**
 * Constrói hipóteses a partir dos dados + referência. Cada hipótese traz os 7 campos
 * exigidos: observação, referência, teste aplicado, tamanho da amostra, incerteza,
 * explicações alternativas e como reproduzir.
 */
export function buildHypotheses(ctx = {}) {
  const { records = [], reference = null, modes = null } = ctx;
  const observed = records.filter(r => r.kind !== 'simulation' && r.outcome !== null);
  const list = [];
  const base = {
    n: observed.length,
    independentValidation: false,
    alternativeExplanations: [
      'flutuação aleatória dentro do intervalo de confiança',
      'viés de coleta/registro (resultados ausentes, duplicados ou de janelas diferentes)',
      'diferença real de regras entre versões/modos do jogo',
    ],
  };

  if (reference && reference.probabilities && observed.length) {
    const order = Object.keys(reference.probabilities);
    const counts = order.map(k => observed.filter(r => r.outcome === k).length);
    const total = counts.reduce((s, c) => s + c, 0);
    const test = chiSquareGOF(counts, order.map(k => Number(reference.probabilities[k])));
    list.push({
      id: 'H1-distribuicao',
      title: 'Desvio da distribuição teórica documentada',
      ...base,
      observed: `${total} resultado(s) classificados em ${order.length} categoria(s); n=${total}`,
      reference: reference.source || 'distribuição de referência informada pelo usuário',
      testApplied: 'χ² de aderência (goodness-of-fit)',
      sampleSize: total,
      uncertainty: test.ok ? { chi2: test.chi2, df: test.df, pValue: test.pValue, cramersV: test.cramersV } : null,
      reproducible: 'chiSquareGOF(counts, probs) — registre contagens por categoria e a tabela de referência',
      inconclusiveReason: test.ok ? null : test.reason,
    });
  } else {
    list.push({
      id: 'H1-distribuicao', title: 'Desvio da distribuição teórica documentada', ...base,
      observed: 'não avaliável sem tabela de referência',
      reference: 'ausente', testApplied: 'χ² de aderência (não executado)', sampleSize: observed.length,
      uncertainty: null,
      reproducible: 'Forneça p_i e r_i verificáveis para habilitar o teste.',
      inconclusiveReason: 'sem tabela de referência confiável — hipótese não testável',
    });
  }

  const stab = stabilityOverTime(observed, 6);
  list.push({
    id: 'H2-estabilidade', title: 'Mudança estatística ao longo do tempo', ...base,
    observed: stab.ok ? `distribuição comparada em 6 janelas (n=${stab.n})` : 'amostra insuficiente para janelamento',
    reference: 'a própria amostra dividida em janelas temporais iguais',
    testApplied: 'χ² de homogeneidade k×b',
    sampleSize: stab.n || observed.length,
    uncertainty: stab.ok ? { chi2: stab.chi2, df: stab.df, pValue: stab.pValue, minExpected: Number(stab.minExpected.toFixed(2)) } : null,
    reproducible: 'stabilityOverTime(records, 6)',
    inconclusiveReason: stab.ok ? null : stab.reason,
  });

  if (modes && modes.a && modes.b && modes.a.length >= 2 && modes.b.length >= 2) {
    const cmp = twoSampleCompare(modes.a, modes.b);
    list.push({
      id: 'H3-modos', title: 'Diferença entre modos de jogo (normal × turbo)', ...base,
      observed: `normal n=${modes.a.length} · turbo n=${modes.b.length}`,
      reference: 'comparação direta entre as duas condições observadas',
      testApplied: 't de Welch para amostras independentes',
      sampleSize: modes.a.length + modes.b.length,
      uncertainty: cmp.ok ? { diff: cmp.diff, t: cmp.t, df: cmp.df, pValue: cmp.pValue, cohensD: cmp.cohensD } : null,
      reproducible: 'twoSampleCompare(seriesNormal, seriesTurbo)',
      inconclusiveReason: cmp.ok ? null : cmp.reason,
    });
  }

  return list;
}

/**
 * Estado do detector de anomalias. Somente "POSSÍVEL ANOMALIA" e
 * "VALIDADA EM DADOS INDEPENDENTES" exigem significância SOBREVIVENTE ao BH.
 */
export function anomalyState(ctx = {}) {
  const {
    n = 0,
    hasReference = false,
    hypothesis = null,
    discoverySignificant = false,
    independentValidation = null, // { n, pValue } quando existir
  } = ctx;

  if (n === 0) return { state: STATES.COLETANDO, reason: 'nenhum registro de resultado coletado ainda.' };
  if (!hasReference) return { state: STATES.COLETANDO, reason: 'coletando: ainda sem tabela de referência confiável para comparar.' };
  if (n < MIN_SAMPLE_INFERENCE) return { state: STATES.AMOSTRA_INSUFICIENTE, reason: `n=${n} < ${MIN_SAMPLE_INFERENCE} (mínimo para qualquer inferência).` };
  if (!hypothesis) return { state: STATES.COLETANDO, reason: 'coletando: nenhuma hipótese formulada ainda.' };
  if (!discoverySignificant) return { state: STATES.HIPOTESE_INVESTIGACAO, reason: 'hipótese formulada, mas o teste NÃO rejeitou a distribuição de referência.' };
  if (!independentValidation) return { state: STATES.POSSIVEL_ANOMALIA, reason: 'desvio significativo na amostra de descoberta — aguardando validação fora da amostra.' };
  if ((independentValidation.n || 0) < MIN_SAMPLE_INFERENCE) return { state: STATES.INCONCLUSIVA, reason: `houve tentativa de validação, mas com n=${independentValidation.n} (< ${MIN_SAMPLE_INFERENCE}): inconclusiva.` };
  if (!(independentValidation.pValue <= 0.05)) return { state: STATES.NAO_VALIDADA, reason: 'a hipótese NÃO se reproduziu em dados independentes.' };
  return { state: STATES.VALIDADA_INDEPENDENTE, reason: 'teste reproduzido em dados independentes sob as condições documentadas. Isto NÃO implica vantagem no próximo giro.' };
}

/** Decisão final explicável. */
export function decide(ctx = {}) {
  const {
    n = 0, rtpObserved = null, evTheoretical = null, hypothesis = null,
    pValue = null, bhRejected = null, independentValidation = null, riskLimitHit = false,
  } = ctx;

  if (riskLimitHit) {
    return { decision: DECISIONS.CONTINUAR, reason: 'Limite de risco configurado foi atingido: a sessão de análise deve ser interrompida.', stop: true, dataVersion: MOTOR_VERSION };
  }
  if (n === 0) return { decision: DECISIONS.CONTINUAR, reason: 'Sem dados: continuar observação.', stop: false, dataVersion: MOTOR_VERSION };
  if (n < MIN_SAMPLE_INFERENCE) return { decision: DECISIONS.CONTINUAR, reason: `n=${n} < ${MIN_SAMPLE_INFERENCE}: continuar observação antes de qualquer conclusão.`, stop: false, dataVersion: MOTOR_VERSION };

  if (evTheoretical !== null && Number.isFinite(evTheoretical) && evTheoretical < 0 && independentValidation === null) {
    return {
      decision: DECISIONS.EV_DESFAVORAVEL,
      reason: `EV teórico por unidade = ${(evTheoretical * 100).toFixed(2)}% (negativo). Nenhuma evidência independente de vantagem foi apresentada.`,
      stop: false, dataVersion: MOTOR_VERSION,
    };
  }

  const validated = independentValidation && (independentValidation.n || 0) >= MIN_SAMPLE_INFERENCE && independentValidation.pValue <= 0.05;
  if (validated && bhRejected !== false) {
    return {
      decision: DECISIONS.ANOMALIA_INVESTIGAR,
      reason: 'Hipótese sobreviveu ao controle de múltiplos testes e reproduziu-se em dados independentes. Trata-se de ANOMALIA ESTATÍSTICA a investigar — não de garantia de ganho.',
      stop: false, dataVersion: MOTOR_VERSION,
    };
  }
  if (hypothesis && pValue !== null && pValue <= 0.05 && !independentValidation) {
    return { decision: DECISIONS.ANOMALIA_INVESTIGAR, reason: 'Desvio significativo encontrado na amostra de descoberta. Falta validação em dados independentes.', stop: false, dataVersion: MOTOR_VERSION };
  }
  if (hypothesis && independentValidation && (independentValidation.n || 0) < MIN_SAMPLE_INFERENCE) {
    return { decision: DECISIONS.EVIDENCIA_INSUFICIENTE, reason: 'Existe tentativa de validação, mas com amostra independente insuficiente.', stop: false, dataVersion: MOTOR_VERSION };
  }
  if (hypothesis && independentValidation && independentValidation.pValue > 0.05) {
    return { decision: DECISIONS.HIPOTESE_NAO_COMPROVADA, reason: 'A hipótese não se reproduziu fora da amostra de descoberta.', stop: false, dataVersion: MOTOR_VERSION };
  }
  const rtpTxt = rtpObserved === null ? 'RTP observado não calculável' : `RTP observado ${(rtpObserved * 100).toFixed(2)}%`;
  return { decision: DECISIONS.SEM_VANTAGEM, reason: `Nenhum desvio significativo após correção de múltiplos testes (n=${n}; ${rtpTxt}).`, stop: false, dataVersion: MOTOR_VERSION };
}

/* =========================================================
 * 8) GESTÃO DE RISCO
 * =======================================================*/
export function riskScenarios(cfg = {}) {
  const budget = Number(cfg.budget);
  const maxLoss = Number.isFinite(Number(cfg.maxLoss)) ? Number(cfg.maxLoss) : budget;
  const maxMinutes = Number(cfg.maxMinutes) || 0;
  const baseBet = Number(cfg.baseBet);
  const ev = Number.isFinite(Number(cfg.evPerUnit)) ? Number(cfg.evPerUnit) : null;
  if (!Number.isFinite(budget) || budget <= 0) return { ok: false, reason: 'Informe um orçamento de sessão (>0).' };
  if (!Number.isFinite(baseBet) || baseBet <= 0) return { ok: false, reason: 'Informe um valor de aposta base (>0).' };

  const ladder = [0.5, 1, 2, 5].map(f => {
    const bet = baseBet * f;
    return {
      fator: `${f}× a aposta base`,
      bet,
      roundsUntilMaxLoss: Math.floor(maxLoss / bet),
      worstCaseLoss: Math.min(maxLoss, bet * Math.floor(maxLoss / bet)),
      exposurePer100: bet * 100,
      expectedLossPer100: ev === null ? null : bet * 100 * Math.abs(Math.min(ev, 0)),
    };
  });

  return {
    ok: true,
    budget, maxLoss, maxMinutes, baseBet,
    stopConditions: [
      `perda acumulada ≥ ${maxLoss}`,
      `orçamento da sessão (${budget}) consumido`,
      maxMinutes > 0 ? `tempo de sessão ≥ ${maxMinutes} min` : 'sem limite de tempo configurado',
    ],
    ladder,
    warnings: [
      'Aumentar a aposta aumenta a EXPOSIÇÃO FINANCEIRA de forma linear — não aumenta a probabilidade de ganhar.',
      'Progressão tipo martingale é PROIBIDA neste módulo: recuperar prejuízo não é objetivo válido.',
      'Turbo, horário ou sequências recentes não alteram a probabilidade do próximo resultado.',
      'Aposta maior nunca é recomendada com base em resultados recentes.',
    ],
    unit: cfg.unit || 'unidade da sessão',
    note: 'Valores derivados apenas do que foi configurado. Nenhum número é preenchido quando o dado não existe.',
  };
}

/** Consistência do modo automático: só permite SIMULAÇÃO/DEMO. */
export function guardAutoMode(cfg = {}) {
  const environment = String(cfg.environment || '').toLowerCase();
  const realMoney = !!cfg.realMoney;
  if (realMoney || !['demo', 'demonstracao', 'demonstração', 'simulation', 'simulacao', 'simulação', 'treino'].includes(environment)) {
    return {
      allowed: false,
      reason: 'Modo automático bloqueado: execução autônoma só é permitida em ambiente de DEMONSTRAÇÃO/simulação sem dinheiro real.',
      allowedInstead: ['análise', 'recomendações', 'simulações', 'acompanhamento de risco'],
    };
  }
  return { allowed: true, environment, rules: ['consultar o motor de decisão antes de cada ação de teste', 'registrar decisão, justificativa e resultado posterior', 'pausar em erro de coleta ou dados insuficientes', 'respeitar os limites configurados', 'permitir interrupção imediata pelo usuário'] };
}

/** Relatório consolidado de uma sessão (usado pela API e pelo painel). */
export function buildAnalysis(input = {}) {
  const {
    records = [],
    scope = {},
    reference = null,
    theoretical = null,
    risk = null,
    modeSeries = null,
  } = input;

  const raw = records.map(r => normalizeRecord(r, scope));
  const { records: clean, duplicatesRemoved } = dedupe(raw);
  const gaps = detectGaps(clean);
  const integrity = checkSessionScope(clean, scope);
  const observed = computeObserved(clean);
  const series = returnSeriesStats(clean);
  const ev = theoreticalEV(theoretical || {}) ;
  const hypotheses = buildHypotheses({ records: clean, reference, modes: modeSeries });

  const h1 = hypotheses.find(h => h.id === 'H1-distribuicao');
  const hypothesis = reference ? h1 : null;
  const pValue = hypothesis && hypothesis.uncertainty ? hypothesis.uncertainty.pValue : null;
  const bh = pValue !== null ? benjaminiHochberg([pValue], 0.05) : null;
  const stateInfo = anomalyState({
    n: observed.nObserved,
    hasReference: !!reference,
    hypothesis,
    discoverySignificant: pValue !== null && pValue <= 0.05,
    independentValidation: input.independentValidation || null,
  });
  const decision = decide({
    n: observed.nObserved,
    rtpObserved: observed.rtpObserved,
    evTheoretical: ev.ok ? ev.ev : null,
    hypothesis: !!hypothesis,
    pValue,
    bhRejected: bh && bh.ok ? bh.rejected[0] : null,
    independentValidation: input.independentValidation || null,
    riskLimitHit: !!input.riskLimitHit,
  });

  return {
    ok: true,
    motorVersion: MOTOR_VERSION,
    generatedAt: new Date().toISOString(),
    dataVersion: `${MOTOR_VERSION}·${clean.length}registros`,
    scope,
    integrity: { duplicatesRemoved, gaps, scope: integrity },
    observed,
    returnStats: series,
    theoreticalEV: ev,
    hypotheses,
    multipleTesting: bh,
    state: stateInfo,
    decision,
    risk: risk ? riskScenarios(risk) : null,
    disclaimers: [
      'Nenhuma previsão de resultado é feita. Jogos aleatórios não são previsíveis por este módulo.',
      'RTP observado é característica da amostra, não do jogo.',
      'Vantagem matemática só seria indicada com modelo adequado + validação fora da amostra.',
      'Sequências de vitórias/derrotas NÃO indicam que um prêmio está próximo.',
    ],
  };
}

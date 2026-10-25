/* =========================================================
 * btc_market/indicators.js
 * Cálculos locais 100% determinísticos.
 * FUNÇÕES PURAS — sem side effects, sem fetch, sem fs, sem IA.
 * Valores de entrada: numbers[] ou Candle[].
 * =======================================================*/
import { VOLATILITY_LEVEL } from './constants.js';

/* ---------- Helpers simples ---------- */
export function nanCheck(x, fallback = null) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return fallback;
  return x;
}

/* ---------- 1. SMA ---------- */
export function calcSMA(values, period) {
  const v = Array.isArray(values) ? values : [];
  const p = Math.max(1, Math.min(200, period || 14));
  if (v.length < p) return null;
  let s = 0;
  for (let i = v.length - p; i < v.length; i++) s += Number(v[i]) || 0;
  return nanCheck(s / p);
}

/* ---------- 2. EMA ---------- */
export function calcEMA(values, period) {
  const v = Array.isArray(values) ? values : [];
  const p = Math.max(1, Math.min(200, period || 14));
  if (v.length < p) return null;
  const k = 2 / (p + 1);
  let ema = 0;
  // seed com SMA primeiro período
  for (let i = 0; i < p; i++) ema += (Number(v[i]) || 0);
  ema /= p;
  for (let i = p; i < v.length; i++) {
    ema = (Number(v[i]) || 0) * k + ema * (1 - k);
  }
  return nanCheck(ema);
}

/* ---------- 3. RSI ---------- */
export function calcRSI(values, period) {
  const v = Array.isArray(values) ? values : [];
  const p = Math.max(2, Math.min(200, period || 14));
  if (v.length < p + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) {
    const diff = (Number(v[i]) || 0) - (Number(v[i-1]) || 0);
    if (diff >= 0) g += diff; else l += -diff;
  }
  let avgG = g / p;
  let avgL = l / p;
  for (let i = p + 1; i < v.length; i++) {
    const diff = (Number(v[i]) || 0) - (Number(v[i-1]) || 0);
    const gi = diff > 0 ? diff : 0;
    const li = diff < 0 ? -diff : 0;
    avgG = (avgG * (p - 1) + gi) / p;
    avgL = (avgL * (p - 1) + li) / p;
  }
  if (avgL === 0) return avgG === 0 ? nanCheck(50) : nanCheck(100);
  const rs = avgG / avgL;
  return nanCheck(100 - (100 / (1 + rs)));
}

/* ---------- 4. MACD ---------- */
export function calcMACD(values, fast = 12, slow = 26, signal = 9) {
  const v = Array.isArray(values) ? values : [];
  const minLen = Math.max(fast, slow) + signal + 2;
  if (v.length < minLen) return { macd: null, signal: null, histogram: null };
  const emaFast = calcEMA(v, fast) ?? 0;
  const emaSlow = calcEMA(v, slow) ?? 0;
  // calcula macd series para pegar signal
  const macdSeries = [];
  // faz ema progressiva:
  let eFast = 0, eSlow = 0;
  const kF = 2 / (fast + 1);
  const kS = 2 / (slow + 1);
  for (let i = 0; i < fast; i++) eFast += Number(v[i]) || 0;
  eFast /= fast;
  for (let i = 0; i < slow; i++) eSlow += Number(v[i]) || 0;
  eSlow /= slow;
  for (let i = Math.max(fast, slow); i < v.length; i++) {
    if (i >= fast) eFast = (Number(v[i]) || 0) * kF + eFast * (1 - kF);
    if (i >= slow) eSlow = (Number(v[i]) || 0) * kS + eSlow * (1 - kS);
    macdSeries.push(eFast - eSlow);
  }
  const sig = calcEMA(macdSeries, signal) ?? 0;
  const macd = macdSeries.length ? macdSeries[macdSeries.length - 1] : (emaFast - emaSlow);
  return {
    macd: nanCheck(macd),
    signal: nanCheck(sig),
    histogram: nanCheck(macd - sig),
  };
}

/* ---------- 5. ATR ---------- */
export function calcATR(candles, period) {
  const c = Array.isArray(candles) ? candles : [];
  const p = Math.max(1, Math.min(50, period || 14));
  if (c.length < p) return null;
  const trs = [];
  for (let i = 0; i < c.length; i++) {
    const h = Number(c[i]?.h) || 0;
    const l = Number(c[i]?.l) || 0;
    const pc = i > 0 ? (Number(c[i-1]?.c) || 0) : (Number(c[i]?.c) || 0);
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  let atr = 0;
  for (let i = 0; i < p; i++) atr += trs[i];
  atr /= p;
  for (let i = p; i < trs.length; i++) atr = (atr * (p - 1) + trs[i]) / p;
  return nanCheck(atr);
}

/* ---------- 6. Bollinger Bands ---------- */
export function calcBollinger(values, period = 20, mult = 2) {
  const v = Array.isArray(values) ? values : [];
  const p = Math.max(2, Math.min(200, period));
  if (v.length < p) return { upper: null, middle: null, lower: null, bandwidth: null, pctB: null };
  const tail = v.slice(-p);
  let sum = 0;
  for (const x of tail) sum += Number(x) || 0;
  const mid = sum / p;
  let var2 = 0;
  for (const x of tail) var2 += (Number(x) - mid) ** 2;
  var2 /= p;
  const sd = Math.sqrt(Math.max(0, var2));
  const upper = mid + mult * sd;
  const lower = mid - mult * sd;
  const bw = (upper - lower) / (mid || 1);
  const last = Number(v[v.length - 1]) || 0;
  const pctB = (upper - lower === 0) ? 0.5 : (last - lower) / (upper - lower);
  return {
    upper: nanCheck(upper),
    middle: nanCheck(mid),
    lower: nanCheck(lower),
    bandwidth: nanCheck(bw),
    pctB: nanCheck(pctB),
  };
}

/* ---------- 7. Aggregate Candles (menor → maior timeframe) ---------- */
export function aggregateCandles(candles, tfInputSeconds, tfTargetSeconds) {
  const inS = Number(tfInputSeconds) || 0;
  const outS = Number(tfTargetSeconds) || 0;
  if (!inS || !outS || outS <= inS || outS % inS !== 0) return null;
  const ratio = Math.round(outS / inS);
  if (!ratio) return null;
  const cs = Array.isArray(candles) ? candles.slice() : [];
  if (!cs.length) return [];
  // Normaliza timestamps para SEGUNDOS (aceita ms ou s, auto-detecta >=1e12 → ms)
  const toSec = (ts) => {
    const n = Number(ts) || 0;
    if (!n) return 0;
    return n >= 1e12 ? Math.round(n / 1000) : n;
  };
  // Ordena por timestamp em segundos
  cs.sort((a, b) => toSec(a?.t) - toSec(b?.t));
  const out = [];
  let i = 0;
  while (i < cs.length) {
    const firstTsec = toSec(cs[i]?.t);
    if (!firstTsec) { i++; continue; }
    const bucketStart = Math.floor(firstTsec / outS) * outS;
    const bucketEndNext = bucketStart + outS;
    let o = null, h = -Infinity, l = Infinity, c = null, v = 0, count = 0;
    while (i < cs.length) {
      const tSec = toSec(cs[i]?.t);
      if (!tSec) { i++; continue; }
      const aligned = Math.floor(tSec / outS) * outS;
      if (aligned !== bucketStart || tSec >= bucketEndNext) break;
      if (o === null) o = Number(cs[i].o);
      const ch = Number(cs[i].h), cl = Number(cs[i].l);
      if (Number.isFinite(ch) && ch > h) h = ch;
      if (Number.isFinite(cl) && cl < l) l = cl;
      c = Number(cs[i].c);
      v += Number(cs[i]?.v) || 0;
      count++;
      i++;
    }
    if (count) {
      out.push({
        t: bucketStart * 1000, // retorna ms para manter compat com o resto do módulo
        o: nanCheck(o, 0),
        h: nanCheck(h === -Infinity ? o : h, 0),
        l: nanCheck(l === Infinity ? o : l, 0),
        c: nanCheck(c, 0),
        v: nanCheck(v, 0),
      });
    }
  }
  return out;
}

/* ---------- 8. Volume Analysis ---------- */
export function volumeAnalysis(candles, period = 20) {
  const c = Array.isArray(candles) ? candles : [];
  if (!c.length) return { avg: null, relative: null, changePct: null, status: 'nao_observavel' };
  const vols = c.map(x => Number(x?.v) || 0);
  const avgTail = vols.slice(-period);
  const avg = avgTail.reduce((a,b)=>a+b, 0) / Math.max(1, avgTail.length);
  const last = vols[vols.length - 1] || 0;
  const prev = vols.length >= 2 ? vols[vols.length - 2] || 0 : 0;
  const rel = avg ? last / avg : 0;
  const changePct = prev ? ((last - prev) / prev) * 100 : 0;
  let status = 'normal';
  if (rel >= 2.5) status = 'aumento_anormal';
  else if (rel >= 1.4) status = 'acima_media';
  else if (rel <= 0.5) status = 'queda_volume';
  return { avg: nanCheck(avg), relative: nanCheck(rel), changePct: nanCheck(changePct), status };
}

/* ---------- 9. Volatility Classification ---------- */
export function volatilityClassification(candles, period = 14, price = null) {
  const c = Array.isArray(candles) ? candles : [];
  if (c.length < period) return { atrPct: null, level: VOLATILITY_LEVEL.NORMAL, status: 'nao_observavel' };
  const atr = calcATR(c, period);
  const last = price ?? (Number(c[c.length-1]?.c) || 0);
  const atrPct = last ? (atr / last) * 100 : 0;
  let level = VOLATILITY_LEVEL.NORMAL;
  if (atrPct >= 5) level = VOLATILITY_LEVEL.EXTREME;
  else if (atrPct >= 2) level = VOLATILITY_LEVEL.HIGH;
  return { atrPct: nanCheck(atrPct), level, status: level };
}

/* ---------- 10. Momentum (ROC) ---------- */
export function calcMomentum(values, period = 10) {
  const v = Array.isArray(values) ? values : [];
  if (v.length < period + 1) return null;
  const now = Number(v[v.length-1]) || 0;
  const prev = Number(v[v.length - 1 - period]) || 0;
  if (!prev) return nanCheck(0);
  return nanCheck(((now - prev) / prev) * 100);
}

/* ---------- 11. Trend Classification (EMA 20 x EMA 50 + última candle) ---------- */
export function trendClassification(candles) {
  const c = Array.isArray(candles) ? candles : [];
  const closes = c.map(x => Number(x?.c) || 0).filter(Number.isFinite);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const price = closes[closes.length - 1] || null;
  let force = 0;
  if (price != null && ema20 != null && ema50 != null) {
    if (price > ema20) force += 1;
    if (ema20 > ema50) force += 2;
    if (price > ema50) force += 1;
    if (price < ema20) force -= 1;
    if (ema20 < ema50) force -= 2;
    if (price < ema50) force -= 1;
  }
  let trend = 'NEUTRO';
  let strength = 0;
  if (force >= 3) { trend = 'ALTA'; strength = 'ALTA'; }
  else if (force >= 1) { trend = 'ALTA'; strength = 'MODERADA'; }
  else if (force <= -3) { trend = 'BAIXA'; strength = 'ALTA'; }
  else if (force <= -1) { trend = 'BAIXA'; strength = 'MODERADA'; }
  else { trend = 'NEUTRO'; strength = 'BAIXA'; }
  return { trend, strength, ema20, ema50, price, score: force };
}

/* ---------- 12. Approx Support / Resistance ---------- */
export function estimateSupportResistance(candles, swingWindow = 5, clusters = 2) {
  const c = Array.isArray(candles) ? candles : [];
  if (c.length < swingWindow * 3) return { support: null, resistance: null, levels: [] };
  // swings highs/lows
  const highs = [];
  const lows  = [];
  for (let i = swingWindow; i < c.length - swingWindow; i++) {
    const ch = Number(c[i]?.h) || 0;
    const cl = Number(c[i]?.l) || 0;
    let isHigh = true, isLow = true;
    for (let j = 1; j <= swingWindow; j++) {
      if ((Number(c[i-j]?.h) || 0) >= ch) isHigh = false;
      if ((Number(c[i+j]?.h) || 0) >= ch) isHigh = false;
      if ((Number(c[i-j]?.l) || 0) <= cl) isLow = false;
      if ((Number(c[i+j]?.l) || 0) <= cl) isLow = false;
    }
    if (isHigh) highs.push(ch);
    if (isLow) lows.push(cl);
  }
  const clusterize = (arr) => {
    if (!arr.length) return null;
    arr.sort((a,b)=>a-b);
    const price = Number(c[c.length-1]?.c) || 1;
    const tol = price * 0.01; // 1%
    const groups = [];
    for (const x of arr) {
      let added = false;
      for (const g of groups) {
        if (Math.abs(g.avg - x) <= tol) { g.sum += x; g.count++; g.avg = g.sum/g.count; g.vals.push(x); added = true; break; }
      }
      if (!added) groups.push({ sum: x, count: 1, avg: x, vals: [x] });
    }
    groups.sort((a,b)=>b.count-a.count);
    return groups.slice(0, clusters).map(g => nanCheck(g.avg)).filter(v => v != null);
  };
  const lHighs = clusterize(highs);
  const lLows  = clusterize(lows);
  const price = Number(c[c.length-1]?.c) || 0;
  const resistances = (lHighs || []).filter(v => v >= price).sort((a,b)=>a-b);
  const supports     = (lLows  || []).filter(v => v <= price).sort((a,b)=>b-a);
  return {
    resistance: resistances[0] ?? null,
    support:    supports[0] ?? null,
    levels: [...(lLows||[]), ...(lHighs||[])].sort((a,b)=>a-b),
  };
}

/* ---------- 13. Classify Candle Pattern (última vela) ---------- */
export function classifyCandle(candle) {
  if (!candle) return { pattern: 'desconhecido', bodySizePct: null };
  const o = Number(candle.o) || 0;
  const h = Number(candle.h) || 0;
  const l = Number(candle.l) || 0;
  const c = Number(candle.c) || 0;
  const amp = h - l;
  if (!amp || !Number.isFinite(amp)) return { pattern: 'desconhecido', bodySizePct: 0 };
  const body = Math.abs(c - o);
  const bodySizePct = body / amp;
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  let pattern = 'neutra';
  if (bodySizePct < 0.1) pattern = 'doji';
  else if (lowerWick >= body * 2 && upperWick <= body * 0.5) pattern = 'martelo';
  else if (upperWick >= body * 2 && lowerWick <= body * 0.5) pattern = 'estrela_cadente';
  else if (bodySizePct > 0.7 && c > o) pattern = 'marubozu_alta';
  else if (bodySizePct > 0.7 && c < o) pattern = 'marubozu_baixa';
  else if (c > o) pattern = 'alta';
  else pattern = 'baixa';
  return { pattern, bodySizePct: nanCheck(bodySizePct), upperWick: nanCheck(upperWick), lowerWick: nanCheck(lowerWick) };
}

/* ---------- Extra: candle stats (body, pavilhos, amplitude, retorno) ---------- */
export function candleStats(candle) {
  if (!candle) return null;
  const o = Number(candle.o) || 0;
  const h = Number(candle.h) || 0;
  const l = Number(candle.l) || 0;
  const c = Number(candle.c) || 0;
  const body = c - o;
  const amplitude = h - l;
  const retPct = o ? ((c - o) / o) * 100 : 0;
  return {
    abertura: o,
    maxima: h,
    minima: l,
    fechamento: c,
    corpo: body,
    pavio_superior: h - Math.max(o, c),
    pavio_inferior: Math.min(o, c) - l,
    amplitude,
    retorno_pct: nanCheck(retPct),
    variacao_pct: nanCheck(retPct),
  };
}

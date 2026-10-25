/* =========================================================
 * btc_market/backtest.js
 * VALIDAÇÃO RETROATIVA — separada de runtime real.
 * Rotula claramente "BACKTEST", NÃO garante desempenho futuro.
 * =======================================================*/
import {
  multiTimeframeAlign, computeMarketScore, scenarioFromScore, computeIndicatorsForAllTf,
} from './analysis.js';
import { aggregateCandles } from './indicators.js';
import { SCENARIO, TF_SECONDS } from './constants.js';

const _log = (...a) => console.log('[BTC_MI][backtest]', ...a);

/* ---------------------------------------------------------------------
 * runBacktest(historicalDailyCandles, minSignals=30)
 * - historicalDailyCandles: Candle[] (≥150 velas para ter histórico confiável)
 *   em ordem cronológica (t crescente).
 * - A cada ponto no tempo T, simula situação que agente tinha APENAS dados até T.
 * - 4 timeframes sintéticos (do 1d agregamos → 4h não é possível de 1d)
 *   → usamos só 1d + janela deslizante de 4 velas = '4d' (aprox) como longo
 * - Salva preço T+1, T+5, T+20 (próximas velas).
 * - HIT_MISS: alta score alta e preço sobe; baixa score baixa e preço cai; neutro não conta.
 * ---------------------------------------------------------------------*/
export function runBacktest(dailyCandles, opts = {}) {
  const cs = (Array.isArray(dailyCandles) ? dailyCandles.slice() : []).sort((a,b)=>(Number(a?.t)||0)-(Number(b?.t)||0));
  const minLen = Math.max(100, opts.minCandles || 120);
  if (cs.length < minLen) {
    return {
      label: 'BACKTEST',
      warning: `Dados históricos insuficientes para backtest confiável (recebidas ${cs.length}, mínimo ${minLen}).`,
      signals: [],
      counts: { total: 0, altaConfirm: 0, altaFalha: 0, baixaConfirm: 0, baixaFalha: 0, neutro: 0, acertos: 0, totalNaoNeutro: 0 },
      accuracy: null,
      note: 'Resultado BACKTEST, não é garantia de desempenho futuro.',
    };
  }

  const signals = [];
  const winStart = 80; // primeiras 80 velas usadas p/ calcular EMA 50
  for (let t = winStart; t < cs.length; t++) {
    const histT = cs.slice(0, t + 1);
    // Monta frames multi-tf sintéticos (a partir de 1d):
    const frame1d = histT.slice(-140);
    // '4d' = agregamos 1d -> 4d, como proxy pra longo prazo
    const frame4d = aggregateCandles(frame1d, TF_SECONDS['1d'], TF_SECONDS['1d'] * 4) || frame1d.slice(0, Math.ceil(frame1d.length / 4)).map((_, i) => {
      const from = i * 4, to = Math.min(frame1d.length, from + 4);
      if (from >= to) return null;
      let o = Number(frame1d[from].o), h = -Infinity, l = Infinity, c = Number(frame1d[to-1].c), v = 0;
      for (let k = from; k < to; k++) { h = Math.max(h, Number(frame1d[k].h)); l = Math.min(l, Number(frame1d[k].l)); v += Number(frame1d[k].v)||0; }
      return { t: Number(frame1d[from].t), o, h, l, c, v };
    }).filter(Boolean);
    // '1h' não temos a partir de 1d; marcamos vazio para não crashar
    const frames = { '1d': frame1d, '4d': frame4d, '1h': [], '15m': [], '5m': [], '1m': [] };
    const mtf = multiTimeframeAlign(frames);
    // ticker sintético:
    const priceNow = Number(frame1d[frame1d.length-1]?.c) || 0;
    const pricePrev7 = Number(frame1d[frame1d.length-8]?.c) || priceNow;
    const ticker = {
      price: priceNow,
      change24hPct: pricePrev7 ? ((priceNow - pricePrev7)/pricePrev7)*100 : 0,
      volumeUsd: frame1d.slice(-7).reduce((s, k)=>s+(Number(k?.v)||0), 0),
    };
    const scoreObj = computeMarketScore({
      price: priceNow, ticker, frames, multiTimeframeAlign: mtf, news: [],
    });
    const scenario = scenarioFromScore(scoreObj.score, mtf.alignment);
    // Preços depois:
    const plus1  = cs[t + 1]  ? Number(cs[t+1].c) : null;
    const plus5  = cs[t + 5]  ? Number(cs[t+5].c) : null;
    const plus20 = cs[t + 20] ? Number(cs[t+20].c) : null;
    const delta1  = plus1  ? (plus1  - priceNow)/Math.max(1,priceNow)*100 : null;
    const delta5  = plus5  ? (plus5  - priceNow)/Math.max(1,priceNow)*100 : null;
    const delta20 = plus20 ? (plus20 - priceNow)/Math.max(1,priceNow)*100 : null;
    // Critério acerto: direção do sinal bateu com delta20 (sinal de longo prazo)
    const targetDelta = delta20 ?? delta5 ?? delta1;
    let result = null;
    if (scenario.scenario === SCENARIO.HIGH && targetDelta != null) {
      result = targetDelta > 0 ? 'HIT_ALTA' : 'MISS_ALTA';
    } else if (scenario.scenario === SCENARIO.LOW && targetDelta != null) {
      result = targetDelta < 0 ? 'HIT_BAIXA' : 'MISS_BAIXA';
    } else {
      result = 'NEUTRO';
    }
    signals.push({
      t: Number(cs[t].t),
      dateISO: new Date(Number(cs[t].t)).toISOString(),
      priceNow,
      score: scoreObj.score,
      scenario: scenario.scenario,
      scenarioStrength: scenario.strength,
      mtfAlign: mtf.alignment,
      pricePlus1: plus1, pricePlus5: plus5, pricePlus20: plus20,
      delta1Pct: delta1, delta5Pct: delta5, delta20Pct: delta20,
      resultHIT_MISS: result,
    });
  }

  const counts = { total: 0, altaConfirm: 0, altaFalha: 0, baixaConfirm: 0, baixaFalha: 0, neutro: 0 };
  for (const s of signals) {
    counts.total++;
    if (s.resultHIT_MISS === 'HIT_ALTA') counts.altaConfirm++;
    else if (s.resultHIT_MISS === 'MISS_ALTA') counts.altaFalha++;
    else if (s.resultHIT_MISS === 'HIT_BAIXA') counts.baixaConfirm++;
    else if (s.resultHIT_MISS === 'MISS_BAIXA') counts.baixaFalha++;
    else counts.neutro++;
  }
  counts.acertos = counts.altaConfirm + counts.baixaConfirm;
  counts.totalNaoNeutro = counts.total - counts.neutro;
  const accuracy = counts.totalNaoNeutro > 0 ? counts.acertos / counts.totalNaoNeutro : null;
  return {
    label: 'BACKTEST',
    candlesInput: cs.length,
    signalsEvaluated: signals.length,
    signals,
    counts,
    accuracy,
    accuracyPct: accuracy ? Math.round(accuracy * 1000) / 10 : null,
    note: 'Resultado BACKTEST com dados históricos sintéticos (só timeframe 1d + 4d agregado). Não é garantia de desempenho futuro. Velas 1h/15m/5m/1m indisponíveis neste backtest.',
  };
}

export default { runBacktest };

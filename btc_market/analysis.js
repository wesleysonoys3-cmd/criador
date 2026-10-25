/* =========================================================
 * btc_market/analysis.js
 * Pipeline análise: MTF, score, cenário, classificação news.
 * Sem IA — tudo determinístico.
 * =======================================================*/
import {
  DEFAULT_WEIGHTS, SCENARIO, ALIGNMENT, NEWS_CLASS,
  TF_GROUP_SHORT, TF_GROUP_MID, TF_GROUP_LONG, SAFE_LABEL, safeScenarioLabel,
} from './constants.js';
import {
  calcSMA, calcEMA, calcRSI, calcMACD, calcATR, calcBollinger,
  volumeAnalysis, volatilityClassification, calcMomentum,
  trendClassification, estimateSupportResistance, classifyCandle,
  candleStats, aggregateCandles,
} from './indicators.js';

const _log = (...a) => console.log('[BTC_MI][analysis]', ...a);

/* =========================================================
 * 1. Multi-Timeframe Alignment
 * =======================================================*/
export function multiTimeframeAlign(frames) {
  // frames: { '1m': candles, '5m': candles, '15m': candles, '1h': candles, '4h': candles, '1d': candles }
  const trends = {};
  for (const [tf, cs] of Object.entries(frames || {})) {
    if (!cs || !cs.length) { trends[tf] = 'NAO_OBSERVAVEL'; continue; }
    const t = trendClassification(cs);
    trends[tf] = t.trend;
  }
  function groupTrend(group) {
    const vals = group.map(tf => trends[tf]).filter(v => v !== 'NAO_OBSERVAVEL');
    if (!vals.length) return null;
    const high = vals.filter(v => v === 'ALTA').length;
    const low  = vals.filter(v => v === 'BAIXA').length;
    if (high === vals.length) return 'ALTA';
    if (low  === vals.length) return 'BAIXA';
    return high > low ? 'LEVE_ALTA' : (low > high ? 'LEVE_BAIXA' : 'MISTO');
  }
  const s = groupTrend(TF_GROUP_SHORT);
  const m = groupTrend(TF_GROUP_MID);
  const l = groupTrend(TF_GROUP_LONG);
  let alignment = ALIGNMENT.CONFLICT;
  const bull = (s==='ALTA') + (m==='ALTA') + (l==='ALTA') + (s==='LEVE_ALTA')*0.5 + (m==='LEVE_ALTA')*0.5 + (l==='LEVE_ALTA')*0.5;
  const bear = (s==='BAIXA') + (m==='BAIXA') + (l==='BAIXA') + (s==='LEVE_BAIXA')*0.5 + (m==='LEVE_BAIXA')*0.5 + (l==='LEVE_BAIXA')*0.5;
  if (bull >= 2.5 && bear <= 0.5) alignment = ALIGNMENT.BULL;
  else if (bear >= 2.5 && bull <= 0.5) alignment = ALIGNMENT.BEAR;
  else alignment = ALIGNMENT.CONFLICT;
  return {
    byTf: trends,
    short: s, mid: m, long: l,
    alignment,
    bullPoints: bull, bearPoints: bear,
  };
}

/* =========================================================
 * 2. News Classify — FATO / RUMOR / OPINIÃO / ANÁLISE / NÃO CONFIRMADA
 * =======================================================*/
export function newsClassify(articles) {
  if (!Array.isArray(articles)) return [];
  // Domínios/hosts considerados baixa confiança / suspeitos
  const LOW_TRUST_HOST = /4chan|reddit|telegram|t\.me|x\.com|twitter|forum|anon|pastebin|tiktok|instagram|facebook|medium\.com\/@|substack|blogspot|wordpress|\.top$|\.xyz$|\.cf$|\.ga$|\.gq$|\.ml|\.tk/i;
  // Palavras que sinalizam material NÃO-FATO por padrão (checar ANTES de FATO)
  const RUMOR_WORDS = /(^|\s|\W)(rumor|boato|anonymous|anon|people\s+familiar|citar\s+pessoa|n[ãa]o\s+confirmad|unconfirm|rumore|alegadament|diz\s+que|suger|speculat|especul|leaked|vazou|vazamento|source\s+close|according\s+to\s+sources|fontes?\s+diz)(\s|\W|$)/i;
  const OPINION_WORDS = /(^|\s|\W)(opini[ãa]o|opinion|coluna|editorial|eu\s+acho|acredito|recomendo|vou\s+comprar|vou\s+vender|na\s+minha\s+vis[ãa]o|meu\s+palpite|predict|prediction|meu\s+veredito)(\s|\W|$)/i;
  const ANALYSIS_WORDS = /(^|\s|\W)(analista|an[áa]lise|previs[ãa]o|target|price\s+target|rating|upgrade|downgrade|pesquisa|research|report|technical\s+analysis|an[áa]lise\s+t[ée]cnica)(\s|\W|$)/i;
  // Palavras de FATO (fontes oficiais / macro)
  const FACT_WORDS = /(^|\s|\W)(\bfed\b|federal\s+reserve|fomc|banco\s+central|bcb|banco\s+central\s+do\s+brasil|\bsec\b|comiss[ãa]o\s+de\s+valores|cvm|etf|aprovad[oa]|rejeitad[oa]|decis[ãa]o\s+de\s+juros|taxa\s+selic|infla[çc][ãa]o|oficial|cpi|ipca|pim|non\s+farm|payroll|employment|nfp|ata\s+fomc|minutes|press\s+release|release\s+oficial|comunicado|an[úu]ncio\s+oficial|8-k|10-q|10-k|filing|registro\s+oficial|declara[çc][ãa]o\s+conjunta|hack\s+confirmado|exchange\s+list|exchange\s+delist|liquidity\s+crisis|default\s+declarado)(\s|\W|$)/i;

  return articles.map(a => {
    const title = String(a?.title || '');
    const body  = String(a?.summary || a?.body || a?.description || '');
    const src   = String(a?.source || a?.domain || '');
    const url   = String(a?.url || '');
    const combined = (title + ' ' + body + ' ' + src + ' ' + url);
    const lowerCombined = combined.toLowerCase();
    const lowTrustSource = LOW_TRUST_HOST.test(src + ' ' + url);
    // 1) Detecção prévia de RUMOR / OPINIÃO / ANÁLISE (antes de FATO, para evitar over-classificar como FATO)
    let cls = NEWS_CLASS.UNCONFIRMED;
    let trust = 0.1;
    let matched = false;
    if (RUMOR_WORDS.test(lowerCombined)) {
      cls = NEWS_CLASS.RUMOR; trust = 0.15; matched = true;
    } else if (OPINION_WORDS.test(lowerCombined)) {
      cls = NEWS_CLASS.OPINION; trust = 0.25; matched = true;
    } else if (ANALYSIS_WORDS.test(lowerCombined)) {
      cls = NEWS_CLASS.ANALYSIS; trust = 0.5; matched = true;
    }
    // 2) Se ainda não classificado, ou FATO parecer mais forte, aplicar FATO (SOMENTE se source não for low-trust!)
    if (!matched && FACT_WORDS.test(lowerCombined)) {
      if (lowTrustSource) {
        // mesmo com palavras de fato, se fonte é anônima/twitter → RUMOR
        cls = NEWS_CLASS.RUMOR; trust = 0.2;
      } else {
        cls = NEWS_CLASS.FACT; trust = 0.75;
      }
    }
    // 3) Domínios oficiais conhecidos AUMENTAM trust se FACT; NUNCA aumentam se RUMOR
    if (cls === NEWS_CLASS.FACT) {
      if (/binance\.|coinbase\.|kraken\.|sec\.gov|gov\.|federalreserve\.gov|bcb\.gov\.br|cvm\.gov\.br|coingecko\.com|bloomberg|reuters\.com|apnews\.com|cn\.bc3|bbc\.com|wsj\.com|ft\.com/i.test(src+' '+url)) {
        trust = Math.min(1, trust + 0.15);
      }
    }
    // 4) Domínios/hosts baixa confiança SEMPRE diminuem trust e potencialmente rebaixam classe
    if (lowTrustSource) {
      trust = Math.max(0, trust - 0.2);
      if (cls === NEWS_CLASS.FACT) {
        cls = NEWS_CLASS.RUMOR; trust = Math.min(trust, 0.3);
      }
    }
    // 5) Garantir limites
    trust = Math.max(0, Math.min(1, trust));
    return {
      id: a?.id || hash6(String(a?.title||'')+String(a?.url||'')),
      title: a?.title || '',
      source: a?.source || a?.domain || 'desconhecido',
      url: a?.url || '',
      publishedAtMs: Number(a?.publishedAtMs || a?.ts || 0) || Date.now(),
      classification: cls,
      trustLevel: trust,
      impactScore: computeNewsImpact(cls, trust, title, body),
    };
  });
}

function hash6(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
  return Math.abs(h).toString(36).slice(0, 6);
}

function computeNewsImpact(cls, trust, title, body) {
  let score = 0;
  const txt = (title + ' ' + body).toLowerCase();
  const posScore = /subir|alta|aprova|aprovado|positive|bullish|record|novo.maximo|breakout|surge|rally|adotar|adoção|institucional|upgrade|buy/i;
  const negScore = /cair|queda|baixa|rejeita|rejeitado|negativ|bearish|hack|ataque|fraude|ban|proibido|regulamenta..o.restritiva|delist|sell|warning|risco/i;
  if (posScore.test(txt)) score += 0.5;
  if (negScore.test(txt)) score -= 0.5;
  // Fato com trust alto pesa mais
  const mult = (cls === NEWS_CLASS.FACT ? 1.0 : cls === NEWS_CLASS.ANALYSIS ? 0.5 : cls === NEWS_CLASS.RUMOR ? 0.2 : cls === NEWS_CLASS.OPINION ? 0.25 : 0.15);
  return Math.max(-1, Math.min(1, score * trust * mult));
}

/* =========================================================
 * 3. Compute Market Score 0–100
 * =======================================================*/
export function computeMarketScore(input) {
  /**
   * input: { price, ticker,
   *   frames: {'1m':candles, '5m':..., '15m':..., '1h':..., '4h':..., '1d':...},
   *   multiTimeframeAlign { alignment, bullPoints, bearPoints },
   *   news:[{impactScore, classification}] }
   */
  const factors = [];
  const contributions = [];

  /* Factor: trend (EMA 1d) */
  const daily = input?.frames?.['1d'] || [];
  let trendScore = 50, trendEvidence = 'não observável';
  if (daily && daily.length >= 60) {
    const t = trendClassification(daily);
    if (t.trend === 'ALTA') { trendScore = t.score === 0 ? 55 : (t.strength === 'ALTA' ? 78 : 65); trendEvidence = 'Tendência 1d ' + t.trend + ' força ' + t.strength; }
    else if (t.trend === 'BAIXA') { trendScore = t.score === 0 ? 45 : (t.strength === 'ALTA' ? 22 : 35); trendEvidence = 'Tendência 1d ' + t.trend + ' força ' + t.strength; }
    else { trendScore = 50; trendEvidence = 'Tendência 1d neutra'; }
  }
  factors.push({ name: 'Tendência 1D', weight: DEFAULT_WEIGHTS.trend, score: trendScore, evidence: trendEvidence });

  /* Factor: MTF alignment */
  const mtfA = input?.multiTimeframeAlign || {};
  let mtfScore = 50, mtfEvidence = 'timeframes insuficientes';
  if (mtfA.alignment === ALIGNMENT.BULL) { mtfScore = Math.min(95, 50 + (mtfA.bullPoints||0) * 8); mtfEvidence = 'Timeframes alinhados para alta (' + mtfA.bullPoints.toFixed(1) + ' pontos)'; }
  else if (mtfA.alignment === ALIGNMENT.BEAR) { mtfScore = Math.max(5, 50 - (mtfA.bearPoints||0) * 8); mtfEvidence = 'Timeframes alinhados para baixa (' + mtfA.bearPoints.toFixed(1) + ' pontos)'; }
  else if (mtfA.short && mtfA.mid) {
    const delta = ((mtfA.short==='ALTA'?1:mtfA.short==='BAIXA'?-1:0)*0.5 + (mtfA.mid==='ALTA'?1:mtfA.mid==='BAIXA'?-1:0)*1 + (mtfA.long==='ALTA'?1:mtfA.long==='BAIXA'?-1:0)*1.5);
    mtfScore = Math.max(5, Math.min(95, 50 + delta*12));
    mtfEvidence = 'Timeframes conflitantes (sinal combinado ' + delta.toFixed(2) + ')';
  }
  factors.push({ name: 'Multi-Timeframe', weight: DEFAULT_WEIGHTS.multiTimeframe, score: mtfScore, evidence: mtfEvidence });

  /* Factor: Volume (1d) */
  let volScore = 50, volEvidence = 'não observável';
  if (daily.length >= 20) {
    const va = volumeAnalysis(daily, 20);
    const price = daily[daily.length-1]?.c || 0;
    const prevC = daily.length>=2 ? daily[daily.length-2]?.c || 0 : price;
    const priceUp = price >= prevC;
    if (va.status === 'aumento_anormal') { volScore = priceUp ? 82 : 18; volEvidence = 'Volume aumento anormal, ' + (priceUp?'confirma alta':'confirma pressão vendedora'); }
    else if (va.status === 'acima_media') { volScore = priceUp ? 68 : 32; volEvidence = 'Volume acima da média, ' + (priceUp?'movimento com confirmação':'pressão vendedora presente'); }
    else if (va.status === 'queda_volume') { volScore = priceUp ? 38 : 62; volEvidence = 'Volume em queda: ' + (priceUp?'cuidado alta sem confirmação':'queda sem convicção'); }
    else { volScore = 50; volEvidence = 'Volume normal (rel=' + (va.relative||0).toFixed(2) + ')'; }
  }
  factors.push({ name: 'Volume', weight: DEFAULT_WEIGHTS.volume, score: volScore, evidence: volEvidence });

  /* Factor: Momentum ROC (1d period=10) */
  let momScore = 50, momEvidence = 'não observável';
  const closes1d = daily.map(c => Number(c?.c)||0);
  const mom = calcMomentum(closes1d, 10);
  if (Number.isFinite(mom)) {
    momScore = Math.max(5, Math.min(95, 50 + mom * 4));
    momEvidence = 'Momentum ROC(10d) = ' + mom.toFixed(2) + '%';
  }
  factors.push({ name: 'Momentum', weight: DEFAULT_WEIGHTS.momentum, score: momScore, evidence: momEvidence });

  /* Factor: RSI 14 (1d) */
  let rsiScore = 50, rsiEvidence = 'não observável';
  const rsi = calcRSI(closes1d, 14);
  if (Number.isFinite(rsi)) {
    if (rsi <= 25) { rsiScore = 78; rsiEvidence = `RSI ${rsi.toFixed(1)}: sobrevendido (clássico → possível reversão alta)`; }
    else if (rsi >= 75) { rsiScore = 22; rsiEvidence = `RSI ${rsi.toFixed(1)}: sobrecomprado (clássico → possível reversão baixa)`; }
    else if (rsi >= 55) { rsiScore = 65; rsiEvidence = `RSI ${rsi.toFixed(1)}: momentum positivo`; }
    else if (rsi <= 45) { rsiScore = 35; rsiEvidence = `RSI ${rsi.toFixed(1)}: momentum negativo`; }
    else { rsiScore = 50; rsiEvidence = `RSI ${rsi.toFixed(1)}: neutro`; }
  }
  factors.push({ name: 'RSI', weight: DEFAULT_WEIGHTS.rsi, score: rsiScore, evidence: rsiEvidence });

  /* Factor: MACD 1d */
  let macdScore = 50, macdEvidence = 'não observável';
  const macd = calcMACD(closes1d, 12, 26, 9);
  if (Number.isFinite(macd?.histogram) && Number.isFinite(macd?.macd)) {
    if (macd.histogram > 0 && macd.macd > macd.signal) { macdScore = 72; macdEvidence = 'MACD bullish: histograma positivo + MACD acima sinal'; }
    else if (macd.histogram < 0 && macd.macd < macd.signal) { macdScore = 28; macdEvidence = 'MACD bearish: histograma negativo + MACD abaixo sinal'; }
    else if (macd.histogram > 0) { macdScore = 60; macdEvidence = 'MACD sinal misto (histograma positivo, mas cruzamento fraco)'; }
    else if (macd.histogram < 0) { macdScore = 40; macdEvidence = 'MACD sinal misto (histograma negativo, cruzamento fraco)'; }
  }
  factors.push({ name: 'MACD', weight: DEFAULT_WEIGHTS.macd, score: macdScore, evidence: macdEvidence });

  /* Factor: Volatilidade (ATR% 1d) — penaliza score em vol extrema */
  let volScore2 = 50, volEvidence2 = 'não observável';
  if (daily.length >= 14) {
    const vc = volatilityClassification(daily, 14, closes1d[closes1d.length-1]||0);
    if (vc.level === 'VOLATILIDADE NORMAL') { volScore2 = 60; volEvidence2 = vc.level + ' (ATR%=' + (vc.atrPct||0).toFixed(2) + ')'; }
    else if (vc.level === 'VOLATILIDADE ELEVADA') { volScore2 = 40; volEvidence2 = vc.level + ' — reduzir força do sinal (ATR%=' + (vc.atrPct||0).toFixed(2) + ')'; }
    else if (vc.level === 'VOLATILIDADE EXTREMA') { volScore2 = 25; volEvidence2 = vc.level + ' — risco elevado, sinal deve ser enfraquecido (ATR%=' + (vc.atrPct||0).toFixed(2) + ')'; }
  }
  factors.push({ name: 'Volatilidade', weight: DEFAULT_WEIGHTS.volatility, score: volScore2, evidence: volEvidence2 });

  /* Factor: Bollinger (1d, 20, 2) — posição preço na banda (%B) */
  let bolScore = 50, bolEvidence = 'não observável';
  const bol = calcBollinger(closes1d, 20, 2);
  if (Number.isFinite(bol?.pctB)) {
    if (bol.pctB <= 0.05) { bolScore = 80; bolEvidence = `Preço fora banda inferior (%B=${bol.pctB.toFixed(2)}) — possível suporte`; }
    else if (bol.pctB >= 0.95) { bolScore = 20; bolEvidence = `Preço fora banda superior (%B=${bol.pctB.toFixed(2)}) — possível resistência`; }
    else if (bol.pctB >= 0.7) { bolScore = 62; bolEvidence = `Preço zona alta banda (%B=${bol.pctB.toFixed(2)})`; }
    else if (bol.pctB <= 0.3) { bolScore = 38; bolEvidence = `Preço zona baixa banda (%B=${bol.pctB.toFixed(2)})`; }
    else { bolScore = 50; bolEvidence = `Preço no meio da banda (%B=${bol.pctB.toFixed(2)})`; }
  }
  factors.push({ name: 'Bollinger', weight: DEFAULT_WEIGHTS.bollinger, score: bolScore, evidence: bolEvidence });

  /* Factor: Support/Resistance proximidade */
  let srScore = 50, srEvidence = 'não observável';
  if (daily.length >= 30) {
    const sr = estimateSupportResistance(daily, 5, 2);
    const price = closes1d[closes1d.length-1] || 0;
    if (price && sr.support && sr.resistance) {
      const range = Math.max(0.01 * price, Math.abs(sr.resistance - sr.support) || 0.02 * price);
      if (Math.abs(price - sr.support) <= 0.01 * price) { srScore = 75; srEvidence = `Preço próximo suporte ${sr.support.toFixed(2)}`; }
      else if (Math.abs(price - sr.resistance) <= 0.01 * price) { srScore = 25; srEvidence = `Preço próximo resistência ${sr.resistance.toFixed(2)}`; }
      else {
        const pct = (price - sr.support) / Math.max(1, range);
        srScore = 30 + Math.max(0, Math.min(1, pct)) * 40;
        srEvidence = `Distribuição suporte→resistência: ${(pct*100).toFixed(0)}%`;
      }
    }
  }
  factors.push({ name: 'Suporte/Resistência', weight: DEFAULT_WEIGHTS.supportResistance, score: srScore, evidence: srEvidence });

  /* Factor: News impact */
  let newsScore = 50, newsEvidence = 'sem notícias ou não observável';
  if (Array.isArray(input?.news) && input.news.length) {
    const impact = input.news.reduce((s, n) => s + (Number(n?.impactScore)||0), 0);
    const norm = Math.max(-1, Math.min(1, impact / Math.max(1, Math.min(5, input.news.length))));
    newsScore = 50 + norm * 25;
    newsEvidence = `Notícias: ${input.news.length} item(ns). Impacto ponderado=${norm.toFixed(2)}.`;
    const clsCounts = {};
    for (const n of input.news) clsCounts[n.classification] = (clsCounts[n.classification] || 0) + 1;
    newsEvidence += ' Distribuição: ' + Object.entries(clsCounts).map(([k,v])=>k+'='+v).join(', ');
  }
  factors.push({ name: 'Notícias/Eventos', weight: DEFAULT_WEIGHTS.news, score: newsScore, evidence: newsEvidence });

  /* Cálculo final score ponderado */
  let wSum = 0, sSum = 0;
  const positives = [];
  const negatives = [];
  for (const f of factors) {
    if (!Number.isFinite(f.weight) || f.weight <= 0) continue;
    if (!Number.isFinite(f.score)) continue;
    wSum += f.weight;
    sSum += f.score * f.weight;
    if (f.score >= 55) positives.push(f.name + ': ' + f.evidence);
    else if (f.score <= 45) negatives.push(f.name + ': ' + f.evidence);
  }
  const score = wSum > 0 ? sSum / wSum : 50;
  const risk = (() => {
    const vc = daily.length >= 14 ? volatilityClassification(daily, 14, closes1d[closes1d.length-1]||0)?.level : '';
    if (vc === 'VOLATILIDADE EXTREMA') return 'ALTO';
    if (vc === 'VOLATILIDADE ELEVADA') return 'MÉDIO';
    return 'BAIXO';
  })();

  return {
    score: Math.max(0, Math.min(100, Math.round(score * 10) / 10)),
    factors,
    positives,
    negatives,
    risk,
  };
}

/* =========================================================
 * 4. Scenario from Score
 * =======================================================*/
export function scenarioFromScore(score, mtfAlign = null) {
  let scenario = SCENARIO.NEUTRAL;
  let strength = 'Fraca';
  if (score >= 68) { scenario = SCENARIO.HIGH; strength = score >= 82 ? 'Muito Alta' : score >= 75 ? 'Alta' : 'Moderada'; }
  else if (score <= 32) { scenario = SCENARIO.LOW; strength = score <= 18 ? 'Muito Alta' : score <= 25 ? 'Alta' : 'Moderada'; }
  else { scenario = SCENARIO.NEUTRAL; strength = score >= 40 && score <= 60 ? 'Fraca' : 'Moderada'; }
  if (mtfAlign) {
    if (mtfAlign === ALIGNMENT.BULL && scenario !== SCENARIO.HIGH) { scenario = score > 48 ? SCENARIO.HIGH : SCENARIO.NEUTRAL; strength = 'Moderada'; }
    else if (mtfAlign === ALIGNMENT.BEAR && scenario !== SCENARIO.LOW)  { scenario = score < 52 ? SCENARIO.LOW  : SCENARIO.NEUTRAL; strength = 'Moderada'; }
  }
  return {
    scenario,
    strength,
    label: safeScenarioLabel(scenario),
    disclaimer: SAFE_LABEL.disclaimer,
    signalDirection: scenario === SCENARIO.HIGH ? 1 : scenario === SCENARIO.LOW ? -1 : 0,
  };
}

/* =========================================================
 * 5. Indicadores estruturados de TODOS timeframes (para UI mostrar)
 * =======================================================*/
export function computeIndicatorsForAllTf(frames, ticker) {
  const out = {};
  const allKeys = Object.keys(frames || {});
  for (const tf of allKeys) {
    const cs = frames[tf] || [];
    const closes = cs.map(c => Number(c?.c)||0);
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    const rsi = calcRSI(closes, 14);
    const macd = calcMACD(closes, 12, 26, 9);
    const atr = calcATR(cs, 14);
    const boll = calcBollinger(closes, 20, 2);
    const va = volumeAnalysis(cs, 20);
    const tr = trendClassification(cs);
    const priceNow = closes[closes.length-1] || (ticker?.price || 0);
    const vc = volatilityClassification(cs, 14, priceNow);
    const mom = calcMomentum(closes, 10);
    const sr = estimateSupportResistance(cs, 5, 2);
    const last = cs.length ? cs[cs.length-1] : null;
    const candle = classifyCandle(last);
    const stats = candleStats(last);
    out[tf] = {
      count: cs.length,
      ema20, ema50,
      rsi, macd, atr, bollinger: boll, volume: va,
      trend: tr, volatility: vc, momentum: mom, supportResistance: sr,
      lastCandle: candle, stats,
      priceNow,
    };
  }
  return out;
}

export default {
  multiTimeframeAlign, newsClassify, computeMarketScore, scenarioFromScore, computeIndicatorsForAllTf,
};

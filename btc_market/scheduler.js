/* =========================================================
 * btc_market/scheduler.js
 * Ciclo periódico + integração (REST exports + WS broadcast).
 * NÃO altera RC27/RC28/RC29/Security/Voice/Remote.
 * =======================================================*/
import path from 'node:path';
import { TIMEFRAMES, ALERT_TYPES, ALERT_PER_CAT_COOLDOWN_MS, ALIGNMENT, SAFE_LABEL, safeScenarioLabel, SCENARIO } from './constants.js';
import state from './state.js';
import { fetchTicker, fetchKlines, fetchNewsBasic } from './providers.js';
import { multiTimeframeAlign, newsClassify, computeMarketScore, scenarioFromScore, computeIndicatorsForAllTf } from './analysis.js';
import { runBacktest } from './backtest.js';

const _log = (...a) => console.log('[BTC_MI]', ...a);

let _wss = null;
let _intervalRef = null;
let _intervalMs = 60000;
let _running = false;
let _runPromise = null; // evita sobreposição se o ciclo demorar mais que intervalo.

/* ---------- WS broadcast ---------- */
function broadcast(type, data) {
  if (!_wss) return false;
  let count = 0;
  for (const client of _wss.clients) {
    if (client && client.readyState === 1) {
      try {
        client.send(JSON.stringify({ type, data: (data && typeof data === 'object') ? __sanitize(data) : data, ts: Date.now() }));
        count++;
      } catch {}
    }
  }
  return count;
}

const __DROP_KEYS_BTC_SANITIZE = new Set(['token','secret','password','cookie','jwt','authorization','apikey','api_key','privatekey','private_key','access_token','refresh_token','gateway_token','agent_token']);
function __sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(__sanitize);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (__DROP_KEYS_BTC_SANITIZE.has(String(k).toLowerCase())) { out[k] = '***'; continue; }
    out[k] = (v && typeof v === 'object') ? __sanitize(v) : v;
  }
  return out;
}

/* ---------- Core: collect + compute ---------- */
export async function runFullAnalysis(opts = {}) {
  const symbolBinance = typeof opts.symbol === 'string' && opts.symbol.trim() ? opts.symbol.trim().toUpperCase() : null;
  const startedAtMs = Date.now();
  const providersFails = [];

  let ticker = null;
  try {
    ticker = await fetchTicker(symbolBinance || undefined);
  } catch (e) {
    state.providersPushFailure(e);
    if (Array.isArray(e?.failures)) providersFails.push(...e.failures);
  }

  const frames = {};
  const providersUsedTf = {};
  for (const tf of TIMEFRAMES) {
    try {
      const klines = await fetchKlines(symbolBinance || undefined, tf, tf === '1d' ? 200 : (tf === '4h' ? 180 : 150));
      frames[tf] = klines;
      providersUsedTf[tf] = Array.isArray(klines) && klines.length ? klines.length : 0;
    } catch (e) {
      state.providersPushFailure(e);
      frames[tf] = [];
      if (Array.isArray(e?.failures)) providersFails.push(...e.failures);
    }
  }

  const priceNow = Number(ticker?.price) || (frames['1d']?.length ? Number(frames['1d'][frames['1d'].length-1]?.c) : 0) || 0;

  let newsBasic = [];
  try { if (opts.includeNews !== false) newsBasic = await fetchNewsBasic(5) || []; }
  catch (e) { state.providersPushFailure(e); providersFails.push({ provider: 'news', error: String(e?.message||e).slice(0,200) }); }
  const newsClassified = newsClassify(newsBasic);
  const newsHash = newsClassified.map(n => n.id + '|' + (n.classification||'')).sort().join('::');

  const mtf = multiTimeframeAlign(frames);
  const indicators = computeIndicatorsForAllTf(frames, ticker);
  const volClass1d = indicators['1d']?.volatility?.level;

  const marketScore = computeMarketScore({
    price: priceNow, ticker, frames, multiTimeframeAlign: mtf, news: newsClassified,
  });
  let { score, factors, positives, negatives, risk } = marketScore;

  // Ajuste de volatilidade extrema (enfraquecer força do score)
  if (volClass1d === 'VOLATILIDADE EXTREMA') {
    score = score >= 50 ? Math.max(50, 50 + (score - 50) * 0.5) : Math.min(50, 50 - (50 - score) * 0.5);
    positives.push('Ajuste volatilidade extrema: força do sinal reduzida em ~50% (maior incerteza)');
  }
  const scenario = scenarioFromScore(score, mtf.alignment);

  const report = {
    version: 'btc_mi_v1',
    symbol: ticker?.symbol || 'BTC/USD',
    price: priceNow,
    ticker: ticker ? {
      change24hPct: ticker.change24hPct,
      high24h: ticker.high24h,
      low24h: ticker.low24h,
      volumeUsd: ticker.volumeUsd,
      volumeBase: ticker.volumeBase,
      providerName: ticker.provider,
    } : null,
    timeframeSummary: {
      available: Object.keys(providersUsedTf).filter(k => providersUsedTf[k] > 0),
      klinesCounts: providersUsedTf,
    },
    multiTimeframeAlign: mtf,
    indicators,
    supportResistance1d: indicators['1d']?.supportResistance || { support: null, resistance: null },
    news: newsClassified.map(n => ({
      id: n.id, title: n.title, source: n.source, url: n.url,
      publishedAtMs: n.publishedAtMs, classification: n.classification,
      trustLevel: n.trustLevel, impactScore: n.impactScore,
    })),
    score: Math.round(score * 10) / 10,
    factors: factors.map(f => ({ name: f.name, weight: f.weight, score: Math.round(f.score*10)/10, evidence: f.evidence })),
    positives: positives.slice(0, 8),
    negatives: negatives.slice(0, 8),
    scenario: scenario.scenario,
    scenarioStrength: scenario.strength,
    scenarioLabel: scenario.label,
    disclaimer: scenario.disclaimer,
    riskLevel: risk,
    sourcesUsed: Array.from(new Set([
      ...(ticker?.provider ? [ticker.provider] : []),
      'coingecko_trending',
    ])).filter(Boolean),
    providersFailures: providersFails.slice(0, 8),
    alertCooldownsNow: state.alertCooldowns.size,
    memoryAnalysesCount: state.analyses.length,
    startedAtMs,
    finishedAtMs: Date.now(),
    durationMs: Date.now() - startedAtMs,
    _aiNewsCallToday: state.newsSummaryAiCallsToday,
    _aiNewsSummary: null,
    _lastNewsHash: newsHash,
  };

  const r = state.pushAnalysis(report);
  const prev = state.analyses[1] || null;

  // Detectar mudanças para emitir alertas (cooldown)
  const alertsFired = [];
  const alert = (cat, msg, payload) => {
    if (!state.alertCanFire(cat, ALERT_PER_CAT_COOLDOWN_MS)) return;
    const alertObj = { category: cat, message: msg, payload: payload || {} };
    alertsFired.push(alertObj);
    state.pushAlert(alertObj);
    broadcast('btc:alert', alertObj);
  };
  if (prev) {
    if (prev.scenario !== report.scenario) {
      alert(ALERT_TYPES.SIGNAL_CHANGE,
        `Sinal BTC mudou de ${prev.scenario} para ${report.scenario} (score ${prev.score.toFixed(1)} → ${report.score.toFixed(1)}). ${safeScenarioLabel(report.scenario)} ${SAFE_LABEL.disclaimer}`,
        { from: prev.scenario, to: report.scenario, prevScore: prev.score, score: report.score });
    }
    if (report.multiTimeframeAlign.alignment !== prev.multiTimeframeAlign.alignment) {
      if (report.multiTimeframeAlign.alignment === ALIGNMENT.CONFLICT) {
        alert(ALERT_TYPES.TF_CONFLICT,
          `Timeframes de BTC entraram em conflito. ${SAFE_LABEL.disclaimer}`,
          { alignment: report.multiTimeframeAlign.alignment });
      }
    }
    const v1 = prev.indicators['1d']?.volume?.relative || 0;
    const v2 = report.indicators['1d']?.volume?.relative || 0;
    if (v2 >= 2.5 && v1 < 2.5) {
      alert(ALERT_TYPES.VOL_SPIKE,
        `Volume BTC acima da média detectado (rel ${v2.toFixed(2)}x). ${SAFE_LABEL.disclaimer}`,
        { relative: v2 });
    }
    const vc1 = prev.indicators['1d']?.volatility?.level;
    const vc2 = report.indicators['1d']?.volatility?.level;
    if (vc2 === 'VOLATILIDADE EXTREMA' && vc1 !== vc2) {
      alert(ALERT_TYPES.VOL_EXTREME,
        `Volatilidade BTC entrou em nível EXTREMO (ATR% ${report.indicators['1d']?.volatility?.atrPct?.toFixed?.(2) || '?'}). ${SAFE_LABEL.disclaimer}`,
        { level: vc2, atrPct: report.indicators['1d']?.volatility?.atrPct });
    }
  }
  // News event: se classificou FATO trust >=0.85 com impacto !=0
  for (const n of report.news) {
    if (n.classification === 'FATO' && n.trustLevel >= 0.85 && Math.abs(n.impactScore) >= 0.35) {
      const key = ALERT_TYPES.NEWS_EVENT + ':' + String(n.id);
      if (state.alertCanFire(key, 24 * 3600 * 1000)) {
        state.pushAlert({ category: ALERT_TYPES.NEWS_EVENT, message: `Evento relevante: ${n.title} (fonte ${n.source}).`, payload: n });
        broadcast('btc:alert', { category: ALERT_TYPES.NEWS_EVENT, message: `Evento relevante: ${n.title} (fonte ${n.source}).`, payload: n });
        alertsFired.push({ category: ALERT_TYPES.NEWS_EVENT, payload: n });
      }
    }
  }

  // Persistir
  state.persistLatest().catch(e => _log('persist erro:', String(e?.message || e)));

  // Broadcast do último report (independente de alertas)
  broadcast('btc:update', report);
  _log(`Análise OK: ${report.scenario} score=${report.score.toFixed(1)} price=$${report.price.toFixed(0)} velas=${report.timeframeSummary.available.join(',') || '0'} dur=${report.durationMs}ms alerts=${alertsFired.length}`);

  return { ok: true, report, alertsFired };
}

/* ---------- Ciclo ---------- */
async function _schedulerTick() {
  if (_runPromise) return; // evita sobreposição se a anterior ainda está rodando.
  _runPromise = (async () => {
    try {
      await runFullAnalysis({ includeNews: true });
    } catch (e) {
      _log('schedulerTick erro:', String(e?.message || e));
      state.providersPushFailure(e);
    } finally {
      _runPromise = null;
    }
  })();
}

/* ---------- Init / Boot ---------- */
export function startScheduler(config = {}) {
  if (_running) {
    _log('já iniciado; reconfigurando parâmetros.');
    if (_intervalRef) clearInterval(_intervalRef);
  }
  const {
    wss = null,
    dataDir = null,
    intervalMs = 60000,
  } = config;
  _wss = wss || null;
  _intervalMs = Math.max(15000, Math.min(3600000, Number(intervalMs) || 60000));
  state.setDataDir(dataDir || path.resolve(process.cwd(), 'btc_market/data'));
  state.loadLatest().catch(e => _log('loadLatest erro:', String(e?.message || e)));
  _running = true;
  _intervalRef = setInterval(_schedulerTick, _intervalMs);
  if (typeof _intervalRef.unref === 'function') _intervalRef.unref();
  _log(`Scheduler BTC iniciado. intervalo=${Math.round(_intervalMs/1000)}s dataDir=${state.dataDir}`);
  // 1ª coleta logo no boot, sem esperar o primeiro intervalo.
  setTimeout(() => _schedulerTick(), 2500).unref?.();
  return { ok: true, intervalMs: _intervalMs };
}

/* ---------- REST handlers (explicit, não usa app do criador) ---------- */

export function apiGetStatus() {
  return {
    ok: true,
    running: _running,
    intervalSec: Math.round(_intervalMs / 1000),
    latestReport: state.latestReport
      ? Object.assign({}, state.latestReport, { _ts: state.latestReport?._ts || Date.now() })
      : null,
    latestAlerts: state.alerts.slice(0, 20),
    analysesCount: state.analyses.length,
    providersErrors: state.providersLastErrors.slice(0, 5),
    dataDir: state.dataDir,
    note: 'Resultado em tempo real. NÃO é recomendação. ' + SAFE_LABEL.disclaimer,
  };
}

export function apiGetHistory(limit) {
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  return {
    ok: true,
    count: Math.min(n, state.analyses.length),
    items: state.analyses.slice(0, n).map(r => ({
      ts: r._ts, price: r.price, score: r.score, scenario: r.scenario, riskLevel: r.riskLevel,
      mtfAlign: r.multiTimeframeAlign?.alignment, sources: r.sourcesUsed,
    })),
  };
}

export async function apiRunManual() {
  const result = await runFullAnalysis({ includeNews: true });
  return { ok: true, report: result.report, alertsFired: result.alertsFired.length };
}

export async function apiRunBacktest(query = {}) {
  try {
    let candles = null;
    // Tenta carregar 1d de provider (preferência Binance → CoinGecko):
    try {
      candles = await fetchKlines(null, '1d', Math.max(180, Number(query?.days || 0) ? Math.min(3650, 30 + Number(query.days)) : 365));
    } catch (e) {
      return { ok: false, error: 'Não foi possível obter dados históricos 1d para backtest: ' + String(e?.message || e) };
    }
    const result = runBacktest(candles, query || {});
    return { ok: true, label: result.label, note: result.note, summary: {
      candlesInput: result.candlesInput, signalsEvaluated: result.signalsEvaluated, counts: result.counts,
      accuracy: result.accuracy, accuracyPct: result.accuracyPct, warning: result.warning || null,
    }, sample: result.signals.slice(-20) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/* ---------- Exports ---------- */
export default {
  startScheduler,
  runFullAnalysis,
  apiGetStatus,
  apiGetHistory,
  apiRunManual,
  apiRunBacktest,
  state,
};

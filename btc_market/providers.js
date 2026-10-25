/* =========================================================
 * btc_market/providers.js
 * Camada providers substituíveis.
 *  - Prioridade 1: Binance Public API (gratuita, ~1200 req/min)
 *  - Prioridade 2: CoinGecko Public API (fallback)
 * NENHUMA chave API obrigatória.
 * Respeita robots.txt + rate limits.
 * =======================================================*/
import {
  PROVIDERS, BTC_SYMBOL_BINANCE, BTC_ID_COINGECKO,
  NETWORK_TIMEOUT_MS, PROVIDER_RETRY, PROVIDER_RETRY_BASE_S, TF_TO_BINANCE, TF_SECONDS,
  TIMEFRAMES
} from './constants.js';

const _log = (...a) => console.log('[BTC_MI][providers]', ...a);

const PROVIDER_WHITELIST = new Set([
  'api.binance.com', 'data.binance.com', 'api1.binance.com', 'api2.binance.com',
  'api.coingecko.com', 'api.pro.coingecko.com',
  'www.binance.com', 'www.coingecko.com'
]);

function _urlAllowed(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return PROVIDER_WHITELIST.has(h);
  } catch { return false; }
}

async function _fetchJson(url, opts = {}) {
  if (!_urlAllowed(url)) throw new Error('SSRF: URL não está na whitelist BTC providers: ' + String(url).slice(0,80));
  let lastErr = null;
  const maxRetries = Number.isFinite(opts?.retries) ? opts.retries : PROVIDER_RETRY;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(opts?.timeoutMs || NETWORK_TIMEOUT_MS),
        redirect: 'follow',
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && i < maxRetries) {
          await new Promise(r => setTimeout(r, (PROVIDER_RETRY_BASE_S * (i + 1) * 1000)));
          continue;
        }
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300) || res.statusText}`);
      }
      const j = await res.json();
      return j;
    } catch (err) {
      lastErr = err;
      if (i < maxRetries) await new Promise(r => setTimeout(r, (PROVIDER_RETRY_BASE_S * (i+1) * 800)));
    }
  }
  throw lastErr || new Error('_fetchJson falhou');
}

/* ---------- Robots check (cacheado 1x por provider + 24h) ---------- */
const _robotsCache = new Map();
async function robotsTxtOk(providerBase) {
  const now = Date.now();
  const cached = _robotsCache.get(providerBase);
  if (cached && now - cached.ts < 24 * 3600 * 1000) return cached.ok;
  let ok = true;
  try {
    const u = new URL('/robots.txt', providerBase).toString();
    const res = await fetch(u, {
      signal: AbortSignal.timeout(5000), redirect: 'follow', method: 'HEAD',
    }).catch(() => null);
    if (res && res.ok) {
      const txt = await res.text().catch(() => '');
      const lines = txt.split('\n');
      let applies = false;
      for (const lnRaw of lines) {
        const ln = lnRaw.trim();
        if (/^User-Agent:\s*\*/i.test(ln)) applies = true;
        else if (/^User-Agent:/i.test(ln)) applies = false;
        if (applies && /^Disallow:\s*\/(api|api\/)/i.test(ln)) ok = false;
      }
    }
  } catch { ok = true; }
  _robotsCache.set(providerBase, { ok, ts: now });
  return ok;
}

/* ---------- 1. BINANCE ---------- */
export const providerBinance = {
  id: 'binance',
  name: 'Binance Public API',
  async getTicker(symbol = BTC_SYMBOL_BINANCE) {
    const sym = (typeof symbol === 'string' && symbol.trim()) ? symbol.trim().toUpperCase() : BTC_SYMBOL_BINANCE;
    const base = PROVIDERS[0].base;
    if (!(await robotsTxtOk(base))) throw new Error('Binance robots.txt bloqueia /api');
    const ticker24 = await _fetchJson(`${base}/ticker/24hr?symbol=${encodeURIComponent(sym)}`);
    return {
      provider: 'binance',
      symbol: sym,
      price: Number(ticker24?.lastPrice) || 0,
      change24hPct: Number(ticker24?.priceChangePercent) || 0,
      high24h: Number(ticker24?.highPrice) || 0,
      low24h:  Number(ticker24?.lowPrice)  || 0,
      volumeBase: Number(ticker24?.volume) || 0,
      volumeUsd:  Number(ticker24?.quoteVolume) || 0,
      open24h: Number(ticker24?.openPrice) || 0,
      tsMs: Date.now(),
    };
  },
  async getKlines(symbol = BTC_SYMBOL_BINANCE, interval = '1h', limit = 100) {
    if (!TF_TO_BINANCE[interval]) throw new Error('timeframe não suportado Binance: ' + interval);
    const sym = (typeof symbol === 'string' && symbol.trim()) ? symbol.trim().toUpperCase() : BTC_SYMBOL_BINANCE;
    const base = PROVIDERS[0].base;
    if (!(await robotsTxtOk(base))) throw new Error('Binance robots.txt bloqueia /api');
    const safeLimit = Math.max(10, Math.min(1000, Number(limit) || 100));
    const raw = await _fetchJson(`${base}/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(TF_TO_BINANCE[interval])}&limit=${safeLimit}`);
    if (!Array.isArray(raw)) throw new Error('Binance klines: formato inesperado');
    return raw.map(r => ({
      t: Number(r[0]) || 0,
      o: Number(r[1]) || 0,
      h: Number(r[2]) || 0,
      l: Number(r[3]) || 0,
      c: Number(r[4]) || 0,
      v: Number(r[5]) || 0,
      closeT: Number(r[6]) || 0,
      quoteVol: Number(r[7]) || 0,
      trades: Number(r[8]) || 0,
    }));
  },
  async availableTfs() { return TIMEFRAMES.slice(); },
};

/* ---------- 2. COINGECKO ---------- */
export const providerCoinGecko = {
  id: 'coingecko',
  name: 'CoinGecko Public API',
  async getTicker(id = BTC_ID_COINGECKO) {
    const clean = (typeof id === 'string' && id.trim()) ? id.trim().toLowerCase() : BTC_ID_COINGECKO;
    const base = PROVIDERS[1].base;
    if (!(await robotsTxtOk(base))) throw new Error('CoinGecko robots.txt bloqueia /api');
    const data = await _fetchJson(`${base}/coins/${encodeURIComponent(clean)}?localization=false&tickers=false&community_data=false&developer_data=false`, { retries: 1, timeoutMs: NETWORK_TIMEOUT_MS });
    const md = data?.market_data || {};
    return {
      provider: 'coingecko',
      symbol: (data?.symbol || 'btc').toUpperCase(),
      price: Number(md?.current_price?.usd) || 0,
      change24hPct: Number(md?.price_change_percentage_24h) || 0,
      high24h: Number(md?.high_24h?.usd) || 0,
      low24h:  Number(md?.low_24h?.usd) || 0,
      volumeBase: Number(md?.total_volume?.usd) ? (Number(md?.total_volume?.usd) / (Number(md?.current_price?.usd) || 1)) : 0,
      volumeUsd:  Number(md?.total_volume?.usd) || 0,
      open24h: (Number(md?.current_price?.usd) || 0) / (1 + ((Number(md?.price_change_percentage_24h) || 0)/100)),
      tsMs: Date.now(),
    };
  },
  async getKlines(id = BTC_ID_COINGECKO, interval = '1d', days = 14) {
    const clean = (typeof id === 'string' && id.trim()) ? id.trim().toLowerCase() : BTC_ID_COINGECKO;
    // CoinGecko market_chart. O (OHLC): 1 dia tem 30m (24h), 2-90d 1h, >90d 1d.
    const base = PROVIDERS[1].base;
    if (!(await robotsTxtOk(base))) throw new Error('CoinGecko robots.txt bloqueia /api');
    const map = { '1d': '14', '4h': '14', '1h': '14', '15m': '1', '5m': '1', '1m': '1' };
    const raw = await _fetchJson(`${base}/coins/${encodeURIComponent(clean)}/ohlc?vs_currency=usd&days=${encodeURIComponent(map[interval]||days)}`, { retries: 1, timeoutMs: NETWORK_TIMEOUT_MS });
    if (!Array.isArray(raw)) throw new Error('CoinGecko OHLC: formato inesperado');
    // Converter para formato padrão: t,o,h,l,c,v=0
    const candles = raw.map(r => ({
      t: Number(r[0]) || 0,
      o: Number(r[1]) || 0,
      h: Number(r[2]) || 0,
      l: Number(r[3]) || 0,
      c: Number(r[4]) || 0,
      v: 0,
    }));
    // Agregar se necessário:
    const needSec = TF_SECONDS[interval] || 0;
    if (needSec && candles.length > 2) {
      const candleMs = (candles[1]?.t - candles[0]?.t) || 0;
      const gotSec = candleMs / 1000;
      if (gotSec && gotSec < needSec) {
        const aggregated = (await import('./indicators.js')).aggregateCandles(candles, gotSec, needSec);
        if (aggregated) return aggregated;
      }
    }
    return candles;
  },
  async availableTfs() { return ['1h','4h','1d']; },
};

/* ---------- Camada orquestrador: tenta provider1, se falhar tenta provider2 ---------- */
export async function fetchTicker(symbol) {
  const errs = [];
  for (const p of [providerBinance, providerCoinGecko]) {
    try {
      if (p.id === 'binance') return await p.getTicker(symbol);
      // CoinGecko sempre usa id default bitcoin, ignora symbol de Binance (BTCUSDT não é id CG)
      return await p.getTicker();
    } catch (e) {
      errs.push({ provider: p.id, error: String(e?.message || e).slice(0, 200) });
    }
  }
  const error = new Error('Ambos providers falharam fetch ticker: ' + errs.map(e => e.provider+'='+e.error).join('; '));
  error.failures = errs;
  throw error;
}

export async function fetchKlines(symbol, interval, limit = 140) {
  const errs = [];
  for (const p of [providerBinance, providerCoinGecko]) {
    try {
      if (p.id === 'binance') return await p.getKlines(symbol, interval, limit);
      return await p.getKlines(undefined, interval, limit);
    } catch (e) {
      errs.push({ provider: p.id, error: String(e?.message || e).slice(0, 200) });
    }
  }
  const error = new Error('Ambos providers falharam fetch klines ' + interval + ': ' + errs.map(e => e.provider+'='+e.error).join('; '));
  error.failures = errs;
  throw error;
}

/* ---------- News: usa CoinGecko /status_updates (se disponível) ou trending. Sem IA aqui. ---------- */
export async function fetchNewsBasic(count = 5) {
  const items = [];
  try {
    const base = PROVIDERS[1].base;
    if (await robotsTxtOk(base)) {
      const data = await _fetchJson(`${base}/search/trending`, { retries: 1, timeoutMs: NETWORK_TIMEOUT_MS }).catch(() => null);
      if (data && Array.isArray(data.coins)) {
        for (const c of data.coins.slice(0, Math.max(1, count >> 1))) {
          const n = c?.item || {};
          if (!n?.name) continue;
          items.push({
            id: 'trend_' + String(n.id || '').slice(0, 20),
            title: `Trending em Coingecko: ${n.name || ''} ${n.symbol || ''} rank ${n.market_cap_rank || '?'}`,
            source: 'coingecko.com',
            url: `https://www.coingecko.com/en/coins/${encodeURIComponent(n.id || '')}`,
            publishedAtMs: Date.now(),
            kind: 'TRENDING',
            trustLevel: 'ANALISE',
          });
        }
      }
    }
  } catch {}
  return items;
}

export default {
  binance: providerBinance,
  coingecko: providerCoinGecko,
  fetchTicker,
  fetchKlines,
  fetchNewsBasic,
};

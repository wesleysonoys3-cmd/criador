/* =========================================================
 * btc_market/constants.js
 * Constantes públicas do módulo.
 * NENHUM side effect; puro.
 * =======================================================*/
export const TIMEFRAMES = Object.freeze(['1m', '5m', '15m', '1h', '4h', '1d']);
export const TF_ALIAS = Object.freeze({ '1m':'1m','5m':'5m','15m':'15m','1h':'1h','4h':'4h','1d':'1d' });
export const TF_SECONDS = Object.freeze({ '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 });
export const TF_GROUP_SHORT = Object.freeze(['1m','5m','15m']);
export const TF_GROUP_MID   = Object.freeze(['15m','1h','4h']);
export const TF_GROUP_LONG  = Object.freeze(['4h','1d']);
export const TF_TO_BINANCE  = Object.freeze({ '1m':'1m','5m':'5m','15m':'15m','1h':'1h','4h':'4h','1d':'1d' });

export const PROVIDERS = Object.freeze([
  { id: 'binance', name: 'Binance Public API', base: 'https://api.binance.com/api/v3', priority: 1 },
  { id: 'coingecko', name: 'CoinGecko Public API', base: 'https://api.coingecko.com/api/v3', priority: 2 },
]);
export const BTC_SYMBOL_BINANCE = 'BTCUSDT';
export const BTC_ID_COINGECKO  = 'bitcoin';

export const NETWORK_TIMEOUT_MS = 10000;
export const PROVIDER_RETRY = 2;
export const PROVIDER_RETRY_BASE_S = 1;

export const DEFAULT_WEIGHTS = Object.freeze({
  trend:           18,
  multiTimeframe:  15,
  volume:          14,
  momentum:        12,
  rsi:             11,
  macd:            10,
  volatility:       8,
  bollinger:        6,
  supportResistance: 3,
  news:             3,
});

export const SCENARIO = Object.freeze({
  HIGH:  'ALTA',
  LOW:   'BAIXA',
  NEUTRAL: 'NEUTRO',
});

export const SIGNALS_STRENGTH = Object.freeze({
  WEAK: 'Fraca',
  MODERATE: 'Moderada',
  HIGH: 'Alta',
  STRONG: 'Muito Alta',
});

export const VOLATILITY_LEVEL = Object.freeze({
  NORMAL: 'VOLATILIDADE NORMAL',
  HIGH:   'VOLATILIDADE ELEVADA',
  EXTREME:'VOLATILIDADE EXTREMA',
});

export const ALIGNMENT = Object.freeze({
  BULL: 'ALINHADO PARA ALTA',
  BEAR: 'ALINHADO PARA BAIXA',
  CONFLICT: 'CONFLITANTES',
});

export const NEWS_CLASS = Object.freeze({
  FACT:     'FATO',
  RUMOR:    'RUMOR',
  OPINION:  'OPINIÃO',
  ANALYSIS: 'ANÁLISE',
  UNCONFIRMED: 'FONTE NÃO CONFIRMADA',
});

export const ALERT_TYPES = Object.freeze({
  SIGNAL_CHANGE:    'SIGNAL_CHANGE',
  VOL_SPIKE:        'VOL_SPIKE',
  VOL_EXTREME:      'VOLATILITY_EXTREME',
  TF_CONFLICT:      'TF_CONFLICT_NEW',
  NEWS_EVENT:       'NEWS_EVENT_MAJOR',
});
export const ALERT_GLOBAL_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2h
export const ALERT_PER_CAT_COOLDOWN_MS = 1 * 60 * 60 * 1000; // 1h
export const MAX_HISTORY_FILES = 1000;
export const MAX_HISTORY_MEMORY = 50;

export const SAFE_LABEL = Object.freeze({
  disclaimer: 'Os dados atuais apresentam sinais compatíveis com possível movimento, mas não há garantia de movimento futuro. Não é recomendação de compra ou venda.',
});

export function safeScenarioLabel(raw) {
  switch (String(raw || '').toUpperCase()) {
    case 'ALTA':   return 'Possível continuação de tendência de alta.';
    case 'BAIXA':  return 'Possível continuação de tendência de baixa.';
    default:       return 'Sinal neutro no momento.';
  }
}

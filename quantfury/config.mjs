export const QUANTFURY_CFG = Object.freeze({
  MCP_URL: process.env.QUANTFURY_MCP_URL || 'https://ai.quantfury.com/mcp',
  PROTOCOL_VERSION: '2024-11-05',
  CLIENT_NAME: 'TiAgente',
  CLIENT_VERSION: '1.0.0',
  READ_ONLY: true,
  REQUEST_TIMEOUT_MS: Number(process.env.QUANTFURY_TIMEOUT_MS || 15000) || 15000,
  MONITOR_INTERVAL_MS: Number(process.env.QUANTFURY_MONITOR_INTERVAL_MS || 30000) || 30000,
  MAX_RECONNECT_ATTEMPTS: Number(process.env.QUANTFURY_MAX_RECONNECT || 3) || 3,
  USER_AGENT:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 TiAgente/1.0',
});

export const QUANTFURY_READ_ONLY_BLOCKLIST_PATTERNS = [
  /open|buy|sell|close|place|cancel|order|trade|execute|withdraw|transfer|deposit|leverage|modify|position.*set/i,
];

export const QUANTFURY_READ_TOOL_HINTS = [
  'get', 'list', 'fetch', 'read', 'query', 'balance', 'account', 'position',
  'history', 'pnl', 'profit', 'loss', 'price', 'quote', 'status', 'overview',
  'summary', 'equity', 'margin', 'exposure', 'risk', 'performance',
];

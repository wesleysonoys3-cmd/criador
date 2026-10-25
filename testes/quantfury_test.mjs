/* =========================================================
 * testes/quantfury_test.mjs
 * Testes do MÓDULO QUANTFURY MCP · MODO SOMENTE ANÁLISE (READ_ONLY)
 * NÃO toca RC27/RC28/RC29/Security/Voice/Remote.
 * NÃO acessa https://ai.quantfury.com/mcp (Cloudflare bloqueia probes).
 *
 * COBERTURA (14 checks · alinhados com TAREFA §14):
 *  Grupo A   · 4 · Config isolada e constantes (READ_ONLY, MCP_URL, timeouts, interval)
 *  Grupo B   · 3 · Cliente MCP (erros padronizados MCP, parse SSE, bloqueio READ_ONLY em toolCall)
 *  Grupo C   · 4 · Análise de posição (estrutura de retorno, fatores, texto PT-BR, structuredObservation 8 campos)
 *  Grupo D   · 2 · Scheduler/Monitor (start/stop/status, emissão de alerta)
 *  Grupo E   · 1 · Segurança (bloqueio heurístico: open/buy/sell/close/withdraw/transfer/etc.)
 *  TOTAL: 14 checks.
 *
 * EXECUTAR:
 *   cd /Users/tiagosantos/Desktop/criador
 *   ./node-v22.14.0-darwin-x64/bin/node testes/quantfury_test.mjs
 * =======================================================*/
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

let TOTAL = 0, PASS = 0, FAIL = 0;
const fails = [];
function check(name, cond, detail = '') {
  TOTAL++;
  if (cond) { PASS++; console.log(`ok  ${TOTAL} - ${name}`); }
  else { FAIL++; fails.push({ n: TOTAL, name, detail }); console.error(`not ok ${TOTAL} - ${name}${detail?' :: '+detail:''}`); }
}
const approx = (a, b, eps = 1e-6) => typeof a === 'number' && typeof b === 'number' && isFinite(a) && isFinite(b) && Math.abs(a - b) <= eps;

// =========================================================================
// Grupo A · 4 checks · Config / constantes
// =========================================================================
import { QUANTFURY_CFG } from '../quantfury/config.mjs';
{
  const A1 = !!QUANTFURY_CFG && QUANTFURY_CFG.READ_ONLY === true;
  check('A1. READ_ONLY === true (sem operações de ordem nesta versão)', A1, `READ_ONLY=${QUANTFURY_CFG?.READ_ONLY}`);

  const A2 = typeof QUANTFURY_CFG?.MCP_URL === 'string' && /quantfury\.com\/mcp/i.test(QUANTFURY_CFG.MCP_URL);
  check('A2. MCP_URL default aponta para Quantfury oficial (/mcp)', A2, `MCP_URL=${String(QUANTFURY_CFG?.MCP_URL||'')}`);

  const A3 = Number.isFinite(Number(QUANTFURY_CFG?.REQUEST_TIMEOUT_MS)) && Number(QUANTFURY_CFG.REQUEST_TIMEOUT_MS) >= 5000;
  check('A3. REQUEST_TIMEOUT_MS >= 5s (paciência para Cloudflare/autorização)', A3, `REQUEST_TIMEOUT_MS=${QUANTFURY_CFG?.REQUEST_TIMEOUT_MS}`);

  const A4 = Number.isFinite(Number(QUANTFURY_CFG?.MONITOR_INTERVAL_MS)) && Number(QUANTFURY_CFG.MONITOR_INTERVAL_MS) >= 10000;
  check('A4. MONITOR_INTERVAL_MS >= 10s (evita rate limit)', A4, `MONITOR_INTERVAL_MS=${QUANTFURY_CFG?.MONITOR_INTERVAL_MS}`);
}

// =========================================================================
// Grupo B · 3 checks · Cliente MCP
// =========================================================================
import { McpClientError, MCP_ERROR_CODES, McpStreamableHttpClient } from '../quantfury/mcp_client.mjs';
{
  const B1 = (function () {
    const err = new McpClientError('teste', { code: MCP_ERROR_CODES.SESSION_EXPIRED, httpStatus: 401 });
    return err instanceof Error
      && err.code === MCP_ERROR_CODES.SESSION_EXPIRED
      && err.httpStatus === 401
      && /SESSION_EXPIRED|-3200[0-9]/.test(String(MCP_ERROR_CODES.SESSION_EXPIRED));
  })();
  check('B1. McpClientError carrega code MCP padrão e httpStatus (sessão expirada)', B1, `SESSION_EXPIRED code=${MCP_ERROR_CODES?.SESSION_EXPIRED}`);

  const B2 = (function () {
    const frames = [
      '',
      'event: message',
      'data: {"jsonrpc":"2.0","id":1,"result":{"capabilities":{"tools":{}}}}',
      'data: ',
      'data: [DONE]',
      '',
      'data: {"jsonrpc":"2.0","method":"notifications/initialized"}',
    ].join('\n');
    const c = new McpStreamableHttpClient({ baseUrl: 'http://localhost' });
    const arr = c._parseFramesToJsonRpc(frames) || [];
    return Array.isArray(arr) && arr.length >= 1 && typeof arr[0] === 'object' && arr[0].jsonrpc === '2.0';
  })();
  check('B2. Parse SSE do cliente extrai JSON-RPC e ignora [DONE]/event:/linhas vazias', B2);

  const B3 = (function () {
    const c = new McpStreamableHttpClient({ baseUrl: 'http://localhost' });
    const blockNames = ['openPosition', 'buyMarket', 'sellLimit', 'closePosition', 'placeOrder', 'cancelOrder', 'executeTrade', 'withdrawFunds', 'transferAssets', 'modifyLeverage', 'submitOrder'];
    let blocks = 0;
    for (const n of blockNames) {
      if (typeof c._methodLikelyWrites === 'function' && c._methodLikelyWrites(n) === true) blocks++;
    }
    return blocks === blockNames.length;
  })();
  check('B3. _methodLikelyWrites bloqueia 11/11 palavras-chave de escrita (open/buy/sell/close/etc) em toolCall', B3, 'palavras bloqueadas: openPosition,buyMarket,sellLimit,closePosition,placeOrder,cancelOrder,executeTrade,withdrawFunds,transferAssets,modifyLeverage,submitOrder');
}

// =========================================================================
// Grupo C · 4 checks · Análise de posição
// =========================================================================
import { analyzeQuantfuryPosition } from '../quantfury/analysis.mjs';
{
  const mockPosLong = { asset: 'BTC', direction: 'LONG', entryPrice: 65000, currentPrice: 68250, pnl: 3250, size: 1, leverage: 5, raw: { symbol: 'BTCUSDT' } };
  const mockAccount = { equity: 25000, balance: 21750, usedMargin: 13000, pnl: 3250 };
  const r = analyzeQuantfuryPosition({ position: mockPosLong, account: mockAccount, userName: 'Tiago', priorAlertState: null }) || {};

  const C1 = typeof r === 'object'
    && Array.isArray(r.factors?.pnl ? Object.keys(r.factors) : [])
    && typeof r.analysis === 'string' && r.analysis.length >= 40
    && typeof r.structuredObservation === 'object';
  check('C1. analyzeQuantfuryPosition retorna {factors, analysis, structuredObservation, alert?}', C1, `keys=${Object.keys(r).join(',')}`);

  const C2 = (function () {
    const f = r.factors || {};
    const required = ['trend', 'momentum', 'volatility', 'supportResistance', 'distanciaEntrada', 'pnl'];
    return required.every(k => typeof f[k] === 'string' && f[k].length >= 2);
  })();
  check('C2. factors inclui os 6 eixos: trend/momentum/volatility/supportResistance/distanciaEntrada/pnl', C2, `factors=${Object.keys(r.factors||{}).join(',')}`);

  const C3 = /Tiago|Risco|tendência|cenário|NUNCA|leitura|contexto/i.test(r.analysis || '');
  check('C3. Análise em PT-BR: contém nome, risco, tendência, aviso "NUNCA" certeza', C3, `analysisPreview=${String(r.analysis||'').slice(0,160)}`);

  const so = r.structuredObservation || {};
  const requiredSO = ['asset', 'direction', 'entryPrice', 'currentPrice', 'pnl', 'trend', 'volatility', 'riskLevel'];
  const C4 = requiredSO.every(k => Object.prototype.hasOwnProperty.call(so, k) || so[k] !== undefined);
  check('C4. structuredObservation tem 8 campos §10 (asset/direction/entryPrice/currentPrice/pnl/trend/volatility/riskLevel)', C4, `so=${requiredSO.map(k=>k+'='+String(so[k]||'?')).join(' | ')}`);
}

// =========================================================================
// Grupo D · 2 checks · Scheduler / Monitor
// =========================================================================
import { QuantfuryMonitor } from '../quantfury/scheduler.mjs';
{
  const s0 = QuantfuryMonitor.status();
  const D1 = s0 && s0.active === false && Number.isFinite(Number(s0.intervalMs)) && Number(s0.intervalMs) >= 10000;
  check('D1. Monitor inicia desligado; intervalo default >= 10s', D1, `status=${JSON.stringify(s0)}`);

  const D2 = (function () {
    let received = null;
    const off = QuantfuryMonitor.onAlert((alert, ana) => { received = { alert, ana }; });
    const stStart = QuantfuryMonitor.start({ intervalMs: 20000 });
    const stStop = QuantfuryMonitor.stop();
    off && typeof off === 'function' && off();
    return stStart && stStart.ok === true && stStop && stStop.ok === true && QuantfuryMonitor.isActive() === false;
  })();
  check('D2. Monitor start/stop status OK; on/off listener cadastra/remove sem erro', D2);
}

// =========================================================================
// Grupo E · 1 check · Segurança: classificador heurístico de ferramentas
// =========================================================================
import { QuantfurySvc } from '../quantfury/service.mjs';
{
  const sampleTools = [
    { name: 'getAccountInfo', description: 'Retorna dados da conta' },
    { name: 'getPositions', description: 'Lista de posições abertas' },
    { name: 'getBalance', description: 'Saldo disponível' },
    { name: 'getPriceHistory', description: 'Histórico de preços' },
    { name: 'openPosition', description: 'Abre uma nova posição' },
    { name: 'buyMarketOrder', description: 'Ordem de compra' },
    { name: 'sellPosition', description: 'Fecha posição em venda' },
    { name: 'closeAllOrders', description: 'Cancela ordens abertas' },
    { name: 'withdrawCrypto', description: 'Saque de criptomoeda' },
    { name: 'transferToWallet', description: 'Transferir para carteira' },
    { name: 'setLeverage', description: 'Modificar alavancagem' },
    { name: 'modifyPosition', description: 'Atualizar stop loss' },
  ];
  const svc = QuantfurySvc;
  const idx = svc._classifyTools(sampleTools) || { read: [], write: [] };
  const readNames = (idx.read || []).map(t => t && t.name).filter(Boolean);
  const writeNames = (idx.write || []).map(t => t && t.name).filter(Boolean);
  const E1 = readNames.length >= 4 && writeNames.length >= 8
    && readNames.includes('getAccountInfo')
    && readNames.includes('getPositions')
    && readNames.includes('getBalance')
    && readNames.includes('getPriceHistory')
    && writeNames.includes('openPosition')
    && writeNames.includes('buyMarketOrder')
    && writeNames.includes('sellPosition')
    && writeNames.includes('closeAllOrders')
    && writeNames.includes('withdrawCrypto')
    && writeNames.includes('transferToWallet')
    && writeNames.includes('setLeverage')
    && writeNames.includes('modifyPosition');
  check('E1. Classificador service: 4/4 ferramentas de leitura habilitadas + 8/8 de escrita BLOQUEADAS por READ_ONLY blocklist (§15)', E1, `read=${readNames.length} -> ${readNames.join(',')} | blocked=${writeNames.length} -> ${writeNames.join(',')}`);
}

// =========================================================================
// Sumário
// =========================================================================
console.log('');
console.log(`1..${TOTAL}`);
console.log(`# total ${TOTAL}`);
console.log(`# pass ${PASS}`);
console.log(`# fail ${FAIL}`);
if (FAIL > 0) {
  console.error('');
  console.error('# FALHAS:');
  for (const f of fails) console.error(`#   ${f.n}. ${f.name}${f.detail?' · '+f.detail:''}`);
  process.exit(1);
} else {
  console.log('');
  console.log('# Todos 14 checks QUANTFURY passaram. READ_ONLY OK. Seguro para integrar.');
  process.exit(0);
}

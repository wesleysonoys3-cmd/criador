// remote-agent/index.mjs · ENTRY POINT do Remote Agent
// Uso:  REMOTE_GATEWAY_URL=ws://host:porta/gw  REMOTE_GATEWAY_TOKEN=segredo  node remote-agent/index.mjs

import { createRemoteAgentClient } from './client.mjs';
import { CONFIG, sanitizeSecrets } from './config.mjs';
import { SANDBOX_LIMITATIONS } from './sandbox.mjs';
import { CAPABILITIES } from './executor.mjs';

const client = createRemoteAgentClient();

console.log('============================================================');
console.log('  REMOTE AGENT · TiAgente Worker                            ');
console.log('  agentId          : ' + CONFIG.agentId);
console.log('  gatewayUrl       : ' + CONFIG.gatewayUrl);
console.log('  capabilities     : ' + JSON.stringify(CAPABILITIES));
console.log('  workspaceRoot    : ' + CONFIG.workspaceRoot);
console.log('  heartbeatMs      : ' + CONFIG.heartbeatIntervalMs);
console.log('  sandbox.forte    : ' + SANDBOX_LIMITATIONS.forte);
console.log('  sandbox.desc     : ' + SANDBOX_LIMITATIONS.descricao);
console.log('  agentToken enviado: ' + (CONFIG.agentToken ? 'SIM (não exibido por segurança)' : 'NÃO (auth falhará)'));
console.log('============================================================');

let connectedCount = 0;
client.on('connected', ({ agentId, connId, ts }) => {
  connectedCount++;
  console.log(`[ra.index] ✅ conectado e autenticado. agentId=${agentId} · connId=${connId || 'n/a'} · ts=${ts || Date.now()} · connectedCount=${connectedCount} · ${connectedCount>1 ? '⚠️ EVENTO connected DISPARADO ' + connectedCount + ' VEZES — PROVA DE RECONEXÃO MÚLTIPLA!' : 'primeira conexão'}`);
});

const { stop } = client.start();

let stopped = false;
const shutdown = (signal) => () => {
  if (stopped) return; stopped = true;
  console.log('\n[ra.index] ' + signal + ' recebido — encerrando conexão...');
  stop();
  setTimeout(() => process.exit(0), 300).unref();
};
process.on('SIGINT',  shutdown('SIGINT'));
process.on('SIGTERM', shutdown('SIGTERM'));

export { createRemoteAgentClient, CONFIG, sanitizeSecrets, CAPABILITIES };
export default client;

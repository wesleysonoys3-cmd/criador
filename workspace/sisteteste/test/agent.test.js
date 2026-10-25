const test = require('node:test');
const assert = require('node:assert');
const AutonomousCryptoAgent = require('../agent-core');

test('Teste do Agente Autônomo de Auto-Correção', () => {
  const agent = new AutonomousCryptoAgent();
  const metrics = agent.getMetrics();
  assert.strictEqual(metrics.status, 'ACTIVE');

  // Testando auto-correção de dados corrompidos
  const dadosCorrompidos = { precoBrl: null };
  const corrigido = agent.diagnosticarEAutoCorrigir(dadosCorrompidos, 'BTC');
  assert.ok(corrigido.precoBrl > 0);
  assert.strictEqual(agent.getMetrics().correctionsApplied, 1);
});

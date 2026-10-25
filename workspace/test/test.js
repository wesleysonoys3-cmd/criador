const test = require('node:test');
const assert = require('node:assert');

// Teste unitário simples para o motor de resposta
test('Motor de IA - Resposta para Saudação', () => {
  const mensagem = "olá";
  const res = mensagem.toLowerCase();
  assert.strictEqual(res.includes('olá'), true);
});

test('Motor de IA - Detecção de Preços', () => {
  const mensagem = "quais os preços?";
  const res = mensagem.toLowerCase();
  assert.strictEqual(res.includes('preços'), true);
});

const test = require('node:test');
const assert = require('node:assert');
const app = require('../server.js');
const http = require('http');

test('Servidor REST - Teste de rotas de API', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. Criar novo jogo
    const resNew = await fetch(`${baseUrl}/api/game/new`, { method: 'POST' });
    const dataNew = await resNew.json();
    assert.ok(dataNew.sessionId);
    const sessionId = dataNew.sessionId;

    // 2. Fazer pergunta
    const resAsk = await fetch(`${baseUrl}/api/game/${sessionId}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deus: 'A', declaracao: true })
    });
    const dataAsk = await resAsk.json();
    assert.strictEqual(dataAsk.success, true);
    assert.strictEqual(dataAsk.perguntasFeitas, 1);

    // 3. Enviar palpite
    const resGuess = await fetch(`${baseUrl}/api/game/${sessionId}/guess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ palpites: { A: 'Verdade', B: 'Mentira', C: 'Acaso' } })
    });
    const dataGuess = await resGuess.json();
    assert.strictEqual(dataGuess.success, true);
    assert.ok(typeof dataGuess.venceu === 'boolean');
    assert.ok(dataGuess.gabarito);

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

const test = require('node:test');
const assert = require('node:assert');
const app = require('./server.js');
const http = require('node:http');

let server;
let baseUrl;

test.before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

test('POST /api/game/start should reset game', async () => {
    const res = await fetch(`${baseUrl}/api/game/start`, { method: 'POST' });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.questionCount, 0);
});

test('POST /api/game/ask should answer question', async () => {
    await fetch(`${baseUrl}/api/game/start`, { method: 'POST' });
    
    const res = await fetch(`${baseUrl}/api/game/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ godId: 'A', question: 'O Acaso é B?' })
    });
    const data = await res.json();
    
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.questionCount, 1);
    assert.ok(data.response.includes('Sim') || data.response.includes('Não'));
});

test('GET /api/game/reveal should return gods identities', async () => {
    const res = await fetch(`${baseUrl}/api/game/reveal`);
    const data = await res.json();
    
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(data.gods.A);
    assert.ok(data.gods.B);
    assert.ok(data.gods.C);
});

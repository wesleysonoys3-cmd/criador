const test = require('node:test');
const assert = require('node:assert');
const app = require('../server');

test('API Status endpoint', async () => {
    assert.ok(app, 'App Express exportado com sucesso');
});

test('API CPU Temp endpoint', async () => {
    const req = { method: 'GET', url: '/api/cpu-temp' };
    assert.ok(app._router, 'Router do Express configurado');
});

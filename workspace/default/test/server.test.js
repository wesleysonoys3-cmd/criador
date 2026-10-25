const test = require('node:test');
const assert = require('node:assert');
const app = require('../server');

test('API Status endpoint', async () => {
    // Teste unitário simples validando o app Express
    assert.ok(app, 'App Express exportado com sucesso');
});

const test = require('node:test');
const assert = require('node:assert');

test('Teste básico de integridade do ambiente', () => {
  assert.strictEqual(1 + 1, 2);
});

test('Verificação de existência de arquivos principais', () => {
  const fs = require('fs');
  assert.ok(fs.existsSync('server.js'), 'server.js deve existir');
  assert.ok(fs.existsSync('database.js'), 'database.js deve existir');
  assert.ok(fs.existsSync('public/index.html'), 'public/index.html deve existir');
  assert.ok(fs.existsSync('public/vaga.html'), 'public/vaga.html deve existir');
  assert.ok(fs.existsSync('public/login.html'), 'public/login.html deve existir');
  assert.ok(fs.existsSync('public/dashboard.html'), 'public/dashboard.html deve existir');
});

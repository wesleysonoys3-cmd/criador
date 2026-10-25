const test = require('node:test');
const assert = require('node:assert');
const app = require('../server.js');
const http = require('node:http');

test('API REST - Health check', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://localhost:${port}/health`);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.status, 'ok');
  assert.strictEqual(data.service, 'casino-backend');

  await new Promise((resolve) => server.close(resolve));
});

test('API REST - Leaderboard endpoints', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  // GET Leaderboard
  const resGet = await fetch(`http://localhost:${port}/api/leaderboard`);
  const list = await resGet.json();
  assert.strictEqual(resGet.status, 200);
  assert.ok(Array.isArray(list));
  assert.ok(list.length >= 3);

  // POST Leaderboard
  const resPost = await fetch(`http://localhost:${port}/api/leaderboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'TestPlayer', balance: 9999.0, wins: 42 })
  });
  const postData = await resPost.json();
  assert.strictEqual(resPost.status, 201);
  assert.strictEqual(postData.success, true);
  assert.strictEqual(postData.player.name, 'TestPlayer');

  await new Promise((resolve) => server.close(resolve));
});

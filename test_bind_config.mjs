import * as http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

const NODE_BIN = process.argv0;
const TEST_PORT = 39999;
const LOCAL_IP = Object.values(os.networkInterfaces())
  .flat()
  .filter(n => n && n.family === 'IPv4' && !n.internal)
  .map(n => n.address)[0] || null;
const passed = [];
const failed = [];
let child = null;
let childLog = '';
const tests = [
  { name: 'TC1 · NENHUMA env → LISTEN_HOST default 127.0.0.1 (localhost só)', envs: {}, expect: '127.0.0.1' },
  { name: 'TC2 · IS_RENDER_OR_HEADLESS_LINUX=1 → bind 0.0.0.0', envs: { IS_RENDER_OR_HEADLESS_LINUX: '1' }, expect: '0.0.0.0' },
  { name: 'TC3 · LISTEN_HOST=0.0.0.0 explícito → bind 0.0.0.0 (prioridade > IS_RENDER)', envs: { LISTEN_HOST: '0.0.0.0', IS_RENDER_OR_HEADLESS_LINUX: '' }, expect: '0.0.0.0' },
  { name: 'TC4 · LISTEN_HOST=127.0.0.1 + IS_RENDER_OR_HEADLESS_LINUX=1 → LISTEN_HOST tem prioridade (fica 127.0.0.1)', envs: { LISTEN_HOST: '127.0.0.1', IS_RENDER_OR_HEADLESS_LINUX: '1' }, expect: '127.0.0.1' },
];

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const req = http.request(
        { hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', timeout: 4000 },
        res => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
        }
      );
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', reject);
      req.end();
    } catch (e) { reject(e); }
  });
}

function wsConnect(url, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws connect timeout ' + url)), timeoutMs);
    let ws;
    try { ws = new WebSocket(url); } catch (e) { clearTimeout(t); return reject(e); }
    ws.once('open', () => { clearTimeout(t); ws.close(1000); resolve(true); });
    ws.once('error', err => { clearTimeout(t); try { ws.terminate(); } catch {} reject(err); });
    ws.once('close', code => { clearTimeout(t); reject(new Error('ws fechou c/ code=' + code + ' antes open')); });
  });
}

async function runTestCase(tc) {
  const env = { ...process.env, ...tc.envs, PORT: String(TEST_PORT), GOOGLE_API_KEY: 'test-dummy-key', RC27_AUTONOMOUS_MODE: 'off', PIPELINE_3IA: 'off', GOOGLE_MODEL: 'gemini-3.5-flash-lite' };
  env.TRAE_LOCAL = '1';
  child = spawn(NODE_BIN, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let banner = '';
  const onStdout = d => { banner += d.toString(); childLog += d.toString(); };
  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStdout);
  await wait(5500);
  let resultListen = null;
  try {
    const lsofRes = spawnSync('lsof', ['-nP', `-iTCP:${TEST_PORT}`, '-sTCP:LISTEN'], { encoding: 'utf-8' });
    resultListen = lsofRes.stdout + '\n' + lsofRes.stderr;
  } catch (e) {}

  let actualHost = null;
  const bannerMatch = banner.match(/Host\s*:\s*(\S+?):\d+/);
  if (bannerMatch) actualHost = bannerMatch[1];

  let httpLocalOk = false, httpLanOk = false, wsLocalOk = false, wsGwLocalOk = false, remoteStatusOk = false;

  try {
    const r = await httpGet(`http://127.0.0.1:${TEST_PORT}/api/status`);
    httpLocalOk = r.statusCode === 200 || r.statusCode === 404;
  } catch {}
  if (LOCAL_IP && tc.expect !== '127.0.0.1') {
    try {
      const r = await httpGet(`http://${LOCAL_IP}:${TEST_PORT}/api/status`);
      httpLanOk = r.statusCode === 200 || r.statusCode === 404;
    } catch {}
  } else {
    httpLanOk = true; // skip
  }
  try {
    await wsConnect(`ws://127.0.0.1:${TEST_PORT}/ws`, 5000);
    wsLocalOk = true;
  } catch {}
  try {
    await wsConnect(`ws://127.0.0.1:${TEST_PORT}/gw`, 5000);
    wsGwLocalOk = true;
  } catch {}
  try {
    const r = await httpGet(`http://127.0.0.1:${TEST_PORT}/api/remote/status`);
    remoteStatusOk = r.statusCode === 200;
  } catch {}

  const allOk = actualHost === tc.expect && httpLocalOk && httpLanOk && wsLocalOk && wsGwLocalOk && remoteStatusOk;

  console.log(`\n${allOk ? '✅' : '❌'} ${tc.name}`);
  console.log(`   envs: ${JSON.stringify(tc.envs).replace(/"/g,'')}`);
  console.log(`   expect listen host: ${tc.expect}   atual (banner): ${actualHost ?? 'n/a'}`);
  console.log(`   HTTP 127.0.0.1 /api/status: ${httpLocalOk ? '200/404 OK' : '❌ falhou'}   HTTP LAN ${LOCAL_IP ?? '(n/a)'}: ${httpLanOk ? 'OK/skip' : '❌ falhou'}`);
  console.log(`   WS /ws 127.0.0.1 handshake: ${wsLocalOk ? 'OK' : '❌'}   WS /gw 127.0.0.1 handshake: ${wsGwLocalOk ? 'OK' : '❌'}   /api/remote/status: ${remoteStatusOk ? 'OK' : '❌'}`);
  if (resultListen) console.log('   lsof snippet:\n' + resultListen.split('\n').filter(l=>l.includes(String(TEST_PORT)) || l.includes('PID')).map(l => '     '+l).join('\n'));
  try { if (child) { child.kill('SIGKILL'); await wait(700); } } catch {}
  child = null;

  if (allOk) passed.push(tc.name);
  else {
    failed.push(tc.name);
    if (banner) console.log(`   banner tail: ${banner.slice(-1600).split('\n').slice(-14).map(l=>'     '+l).join('\n')}`);
  }
}

(async function main() {
  console.log('================================================================');
  console.log('TESTE AUTOMATIZADO · LAN BIND CONFIG (sem 2ª máquina)');
  console.log('================================================================');
  console.log('NODE_BIN:', NODE_BIN);
  console.log('LOCAL_IP (IPv4 não-interno detectado):', LOCAL_IP ?? '(nenhum, testes via LAN IP serão skipados)');
  console.log('PORT teste isolado:', TEST_PORT);
  for (const tc of tests) {
    try { await runTestCase(tc); }
    catch (e) { console.error('ERRO TC:', e && e.stack || e); failed.push(tc.name + ' (exception: ' + e.message + ')'); try { if (child) child.kill('SIGKILL'); } catch {} await wait(1200); }
  }
  console.log('\n================================================================');
  console.log(`RESULTADO FINAL: ${passed.length}/${tests.length} passaram   ` + (failed.length === 0 ? '🎉 TUDO OK' : '❌ FALHAS: ' + failed.join(', ')));
  process.exit(failed.length === 0 ? 0 : 1);
})();

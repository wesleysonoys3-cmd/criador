import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const MCP_URL = process.env.QUANTFURY_MCP_URL || 'https://ai.quantfury.com/mcp';

function postJson(urlStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const opts = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
      timeout: 15000,
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      let rawChunks = [];
      const ct = String(res.headers['content-type'] || '');
      res.on('data', (c) => { rawChunks.push(c); data += c.toString('utf8'); });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data, chunks: rawChunks, contentType: ct });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

let msgId = 0;
const nextId = () => ++msgId;

async function tryInitialize(baseUrl) {
  const body = {
    jsonrpc: '2.0',
    id: nextId(),
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'tiagente-test', version: '0.1.0' },
    },
  };
  console.log('=== POST initialize ===');
  console.log('URL:', baseUrl);
  console.log('Request body (JSON-RPC):', JSON.stringify(body, null, 2));
  const r = await postJson(baseUrl, body);
  console.log('\n=== Response initialize ===');
  console.log('Status:', r.status);
  console.log('Content-Type:', r.contentType);
  console.log('Headers (relevantes):');
  for (const [k, v] of Object.entries(r.headers)) {
    if (/content|location|auth|session|set-cookie/i.test(k)) console.log('  ', k, '=', typeof v === 'string' ? (v.length > 300 ? v.slice(0, 300) + '…' : v) : v);
  }
  console.log('\nBody length:', r.body.length);
  console.log('Body preview (first 4000 chars):');
  console.log(r.body.slice(0, 4000));
  return { response: r, request: body };
}

async function tryToolsList(baseUrl, sessionHeaders = {}) {
  const body = {
    jsonrpc: '2.0',
    id: nextId(),
    method: 'tools/list',
    params: {},
  };
  console.log('\n=== POST tools/list ===');
  console.log('Request body:', JSON.stringify(body, null, 2));
  const r = await postJson(baseUrl, body, sessionHeaders);
  console.log('\n=== Response tools/list ===');
  console.log('Status:', r.status);
  console.log('Content-Type:', r.contentType);
  console.log('Body preview (first 8000 chars):');
  console.log(r.body.slice(0, 8000));
  return { response: r, request: body };
}

async function tryResourcesList(baseUrl, sessionHeaders = {}) {
  const body = {
    jsonrpc: '2.0',
    id: nextId(),
    method: 'resources/list',
    params: {},
  };
  console.log('\n=== POST resources/list ===');
  console.log('Request body:', JSON.stringify(body, null, 2));
  const r = await postJson(baseUrl, body, sessionHeaders);
  console.log('\n=== Response resources/list ===');
  console.log('Status:', r.status);
  console.log('Body preview (first 8000 chars):');
  console.log(r.body.slice(0, 8000));
  return { response: r, request: body };
}

(async () => {
  try {
    console.log('───────────────────────────────────────────────────');
    console.log('TESTE MCP Quantfury · Streamable HTTP Probe');
    console.log('URL alvo:', MCP_URL);
    console.log('───────────────────────────────────────────────────\n');

    const init = await tryInitialize(MCP_URL);
    let sessionHeaders = {};

    if (init.response.headers && init.response.headers['set-cookie']) {
      const cookies = Array.isArray(init.response.headers['set-cookie'])
        ? init.response.headers['set-cookie'].map(c => c.split(';')[0]).join('; ')
        : String(init.response.headers['set-cookie']).split(';')[0];
      if (cookies) {
        sessionHeaders['Cookie'] = cookies;
        console.log('\n[SESSION] Cookie detectado (primeiros 80 chars):', cookies.slice(0, 80) + (cookies.length > 80 ? '…' : ''));
      }
    }

    let parsedInit = null;
    try {
      const firstJson = extractFirstJson(init.response.body);
      if (firstJson) {
        parsedInit = JSON.parse(firstJson);
        console.log('\n[PARSED] initialize JSON-RPC parsed (first object):');
        console.log(JSON.stringify(parsedInit, null, 2).slice(0, 3000));
      }
    } catch (e) {
      console.log('[PARSE WARN] initialize não parseou como JSON único:', e.message);
    }

    const auth = parsedInit?.result?.capabilities?.auth || parsedInit?.result?.capabilities?.authorization || null;
    if (auth) {
      console.log('\n[AUTH] servidor anunciou capability de auth:', JSON.stringify(auth));
    }
    const serverInfo = parsedInit?.result?.serverInfo || null;
    if (serverInfo) {
      console.log('[SERVER] serverInfo:', JSON.stringify(serverInfo));
    }

    await tryToolsList(MCP_URL, sessionHeaders);
    await tryResourcesList(MCP_URL, sessionHeaders);

    console.log('\n\n═══════════════════════════════════════════════════');
    console.log('FIM DO PROBE.');
    console.log('Se houve resposta 200 e tools/list retornou JSON,');
    console.log('podemos seguir com a integração.');
    console.log('Se houve 401 / redirect / HTML de login, o MCP');
    console.log('requer fluxo de autorização OAuth/Device.');
    console.log('═══════════════════════════════════════════════════');
  } catch (err) {
    console.error('\n❌ ERRO FATAL no probe:', err);
  }
})();

function extractFirstJson(text) {
  if (!text) return null;
  const t = text.trim();
  if (t.startsWith('{')) return t;
  const idx = t.indexOf('{');
  if (idx === -1) return null;
  let depth = 0;
  for (let i = idx; i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}') { depth--; if (depth === 0) return t.slice(idx, i + 1); }
  }
  return null;
}

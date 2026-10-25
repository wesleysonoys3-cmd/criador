import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const MCP_URL = process.env.QUANTFURY_MCP_URL || 'https://ai.quantfury.com/mcp';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function request(method, urlStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const defaultHeaders = {
      'User-Agent': UA,
      'Accept': 'application/json, text/event-stream, */*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': url.origin,
      'Referer': url.origin + '/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    };
    if (payload) {
      defaultHeaders['Content-Type'] = 'application/json';
      defaultHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      headers: { ...defaultHeaders, ...headers },
      timeout: 20000,
      followRedirect: false,
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c.toString('utf8'); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

let msgId = 0;
const nextId = () => ++msgId;

(async () => {
  try {
    console.log('───────────────────────────────────────────────────');
    console.log('PROBE V2 · Headers de navegador real');
    console.log('URL alvo:', MCP_URL);
    console.log('───────────────────────────────────────────────────\n');

    // 1) GET primeiro — alguns MCPs usam GET /mcp para info ou redirect auth
    console.log('[1] GET ' + MCP_URL);
    let r = await request('GET', MCP_URL, null);
    console.log('  Status:', r.status);
    console.log('  CT:', r.headers['content-type']);
    if (r.headers.location) console.log('  Location:', r.headers.location);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      console.log('  REDIRECT detectado — seguindo manualmente...');
    }
    console.log('  Body preview (1500):', r.body.slice(0, 1500));

    let cookieJar = '';
    const cookie = r.headers['set-cookie'];
    if (cookie) {
      cookieJar = (Array.isArray(cookie) ? cookie : [cookie]).map(c => c.split(';')[0]).join('; ');
      console.log('\n[COOKIE JAR] extraído:', cookieJar.slice(0, 200) + (cookieJar.length > 200 ? '…' : ''));
    }

    // 2) OPTIONS (preflight CORS)
    console.log('\n[2] OPTIONS ' + MCP_URL);
    r = await request('OPTIONS', MCP_URL, null, {
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    });
    console.log('  Status:', r.status);
    console.log('  Headers CORS relevantes:');
    for (const k of Object.keys(r.headers).filter(h => /cors|access-control|allow/i.test(h))) {
      console.log('   ', k, '=', r.headers[k]);
    }
    if (r.headers['set-cookie']) {
      const more = (Array.isArray(r.headers['set-cookie']) ? r.headers['set-cookie'] : [r.headers['set-cookie']]).map(c => c.split(';')[0]).join('; ');
      if (more) cookieJar = cookieJar ? cookieJar + '; ' + more : more;
    }

    // 3) POST initialize com cookie e headers reais
    console.log('\n[3] POST initialize');
    const initBody = {
      jsonrpc: '2.0',
      id: nextId(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'TiAgente', version: '1.0.0' },
      },
    };
    r = await request('POST', MCP_URL, initBody, cookieJar ? { Cookie: cookieJar } : {});
    console.log('  Status:', r.status);
    console.log('  CT:', r.headers['content-type']);
    if (r.headers.location) console.log('  Location:', r.headers.location);
    const isHtml = /text\/html/i.test(r.headers['content-type'] || '');
    const isJson = /json/i.test(r.headers['content-type'] || '');
    const isSse = /event-stream/i.test(r.headers['content-type'] || '');
    console.log('  Tipo detectado:', isHtml ? 'HTML (provavelmente bloqueio/login)' : isJson ? 'JSON' : isSse ? 'SSE Stream' : 'OUTRO');
    console.log('  Body preview (3000):\n', r.body.slice(0, 3000));

    if (r.headers['set-cookie']) {
      const more = (Array.isArray(r.headers['set-cookie']) ? r.headers['set-cookie'] : [r.headers['set-cookie']]).map(c => c.split(';')[0]).join('; ');
      if (more) cookieJar = cookieJar ? cookieJar + '; ' + more : more;
    }

    // 4) POST tools/list
    if (r.status < 400 || isJson || isSse) {
      console.log('\n[4] POST tools/list');
      const tl = { jsonrpc: '2.0', id: nextId(), method: 'tools/list', params: {} };
      r = await request('POST', MCP_URL, tl, cookieJar ? { Cookie: cookieJar } : {});
      console.log('  Status:', r.status);
      console.log('  CT:', r.headers['content-type']);
      console.log('  Body preview (5000):\n', r.body.slice(0, 5000));
    }

    console.log('\n\n═══════════════════════════════════════════════════');
    console.log('RESULTADO DO PROBE V2:');
    if (isHtml && /cloudflare|attention|blocked|captcha/i.test(r.body)) {
      console.log('⚠️  CLOUDFLARE DETECTADO · Bloqueio anti-bot ativo.');
      console.log('   → Alternativa: usar MCP integrado do browser do TRAE');
      console.log('   → Ou adicionar headers de sessão autenticada');
    } else if (r.status === 401 || r.status === 403) {
      console.log('🔐 AUTORIZAÇÃO NECESSÁRIA');
      console.log('   → Verificar se existe OAuth2 flow / device code / token');
    } else if (isJson || isSse) {
      console.log('✅ CONEXÃO MCP funcionando! Prosseguir com integração.');
    } else {
      console.log('❓ Resposta inesperada. Status final =', r.status);
    }
    console.log('═══════════════════════════════════════════════════');
  } catch (err) {
    console.error('\n❌ ERRO:', err?.message || err);
  }
})();

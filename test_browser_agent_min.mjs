// test_browser_agent_min.mjs · Browser Agent v1 teste MÍNIMO (2 ferramentas)
// Objetivo: 1) abrir youtube.com e confirmar título/preview/links; 2) validar proteções.
// Backend: FETCH_PARSE (sem MCP) é usado, pois standalone não tem MCP bridge.
//
// Como rodar:
//   ./node-v22.14.0-darwin-x64/bin/node test_browser_agent_min.mjs > /tmp/ba.log 2>&1; echo EXIT=$?; cat /tmp/ba.log

import { createBrowserAgent } from './browser_agent.mjs';

const TESTS = [];
function T(name, fn) { TESTS.push({ name, fn }); }
let pass = 0, fail = 0;

function _stripTags(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
const SANITIZE = (s) => String(s || '').replace(/[A-Za-z0-9_\-]{20,}/g, (m) => /^(sk-|gsk_|AIza|AKIA|pk_live|pk_test|xoxb-|Bearer |eyJ)/i.test(m) || m.length >= 39 ? ('[REDACTED_KEY_' + m.length + 'chars]') : m);

// allowFn compatível com NETWORK_OUTBOUND: whitelist * para teste, mas BLOQUEIA IP privado.
function _ipv4ToUint32(ip){
  const parts = String(ip).split('.').map(x => parseInt(x,10));
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ( ( (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3] ) >>> 0 );
}
function _isPrivateOrReservedHost(h){
  if (!h) return true;
  const s = String(h).toLowerCase();
  if (/^(localhost|127(\.0+){0,2}\.1|::1|0\.0\.0\.0)$/i.test(s)) return true;
  if (/\.(local|corp|internal|lan|home|priv|intranet)$/i.test(s)) return true;
  const ipv4 = _ipv4ToUint32(s.replace(/^\[|\]$/g, ''));
  if (ipv4 !== null) {
    const inRange = (a,b)=> ipv4 >= a && ipv4 <= b;
    if (inRange(0x0A000000,0x0AFFFFFF)) return true; // 10.0.0.0/8
    if (inRange(0x64400000,0x647FFFFF)) return true; // 100.64.0.0/10
    if (inRange(0x7F000000,0x7FFFFFFF)) return true; // 127.0.0.0/8
    if (inRange(0xA9FE0000,0xA9FEFFFF)) return true; // 169.254.0.0/16
    if (inRange(0xAC100000,0xAC1FFFFF)) return true; // 172.16.0.0/12
    if (inRange(0xC0A80000,0xC0A8FFFF)) return true; // 192.168.0.0/16
    if (inRange(0xE0000000,0xEFFFFFFF)) return true; // 224.0.0.0/4
    if (ipv4 === 0xFFFFFFFF) return true;               // 255.255.255.255
  }
  if (/^fe80:/i.test(s) || /^fc[0-9a-f]{2}:/i.test(s)) return true;
  return false;
}
function allowFn(urlOrHost){
  let u; try { u = new URL(urlOrHost); } catch { return { ok:false, reason:'URL inválida (whitelist allowFn parser)' }; }
  const host = u.hostname.toLowerCase();
  if (_isPrivateOrReservedHost(host)) return { ok:false, reason:'Host privado/reservado bloqueado §11: ' + host };
  return { ok: true, host };
}

const ag = createBrowserAgent({ allowFn, sanitizeFn: SANITIZE, netEnabled: true, webFetchToolEnabled: true });
console.log(`[T-INFO] backend escolhido = ${ag.backend} (FETCH_PARSE = standalone fallback)`);

T('T1 · browser_open("https://www.youtube.com") carrega e retorna {ok,contextId}', async () => {
  const r = await ag.open('https://www.youtube.com', { timeoutMs: 60000 });
  if (!r || r.ok !== true) throw new Error('open youtube ok=false: ' + JSON.stringify(r));
  if (!r.contextId) throw new Error('contextId não retornado');
  return r;
});

T('T2 · Título contém "YouTube" (case-insensitive)', async () => {
  const open = await ag.open('https://www.youtube.com', { timeoutMs: 60000 });
  if (!open.ok) throw new Error('abertura falhou: '+JSON.stringify(open));
  const info = ag.getInfo(open.contextId);
  if (!info.ok) throw new Error('getInfo falhou: '+JSON.stringify(info));
  const t = String(info.title || '').toLowerCase();
  if (!t.includes('youtube')) throw new Error('título não contém YouTube: "'+info.title+'"');
  return info;
});

T('T3 · getInfo: preview de texto >= 200 chars e links >= 1', async () => {
  const open = await ag.open('https://www.youtube.com', { timeoutMs: 60000 });
  if (!open.ok) throw new Error('abertura falhou: '+JSON.stringify(open));
  const info = ag.getInfo(open.contextId);
  if (!info.ok) throw new Error('getInfo falhou: '+JSON.stringify(info));
  const prevLen = String(info.textPreview || '').length;
  const lc = info.linksCount || 0;
  if (prevLen < 200) throw new Error('preview curto: '+prevLen+' chars');
  if (lc < 1) throw new Error('nenhum link encontrado (count='+lc+')');
  return { prevLen, lc };
});

T('T4 · Proteção: IP privado 192.168.1.1 → HOST_DENIED', async () => {
  const r = await ag.open('https://192.168.1.1');
  if (r && r.ok === true) throw new Error('IP privado NÃO bloqueou: '+JSON.stringify(r));
  const code = r && r.code;
  if (code !== 'HOST_DENIED') throw new Error('código errado, esperava HOST_DENIED: ' + code + ' · ' + (r && r.error));
  return r;
});

T('T5 · Proteção: protocolo ftp:// → PROTOCOL_DENIED', async () => {
  const r = await ag.open('ftp://x.com/pub/file.bin');
  if (r && r.ok === true) throw new Error('ftp NÃO bloqueou: '+JSON.stringify(r));
  const code = r && r.code;
  if (code !== 'PROTOCOL_DENIED') throw new Error('código errado, esperava PROTOCOL_DENIED: ' + code);
  return r;
});

T('T6 · getInfo(contextId inválido) → CONTEXT_NOT_FOUND', async () => {
  const r = ag.getInfo('br_id_inexistente_' + Date.now());
  if (r && r.ok === true) throw new Error('contexto inválido NÃO bloqueou: '+JSON.stringify(r));
  const code = r && r.code;
  if (code !== 'CONTEXT_NOT_FOUND') throw new Error('código errado, esperava CONTEXT_NOT_FOUND: ' + code);
  return r;
});

async function runAll() {
  for (const t of TESTS) {
    try {
      const got = await t.fn();
      console.log(`✅ PASS ${t.name}`);
      pass++;
    } catch (err) {
      console.log(`❌ FAIL ${t.name} · ${err.message || String(err)}`);
      fail++;
    }
  }
  console.log(`\nResumo BrowserAgent v1: ${pass}/${pass+fail} PASS, ${fail} FAIL · backend=${ag.backend}`);
  process.exit(fail === 0 ? 0 : 1);
}

runAll().catch(e => { console.error('[FATAL]', e); process.exit(1); });

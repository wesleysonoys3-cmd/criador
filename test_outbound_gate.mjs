// Teste específico: GATE OUTBOUND · NETWORK_OUTBOUND + safeFetchInternet + isAllowedOutboundDomain
// Objetivo: validar 9 cenários sem tocar no server real (sandbox standalone).
// Ver também: sanitizeForInternet §11 + gates NET_OUT_TOOL_* + NET_OUT_AUTH_MODE.
const assert = (cond, msg) => { if (!cond) { console.error('\n❌ FAIL T%d · %s', testNum, msg); process.exit(1); } console.log('  ✅ T%d · %s', testNum, msg); };
console.log('\n=== TESTE OUTBOUND GATE (9 cenários) ===\n');
let testNum = 0;

// ---------- Copiados MIRROR do server.js (sandbox) ----------
function _ipv4ToUint32(ip) {
  const m = String(ip||'').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null; const o = m.slice(1,5).map(Number); if (o.some(x => x < 0 || x > 255)) return null;
  return (o[0]>>>0) * 0x1000000 + (o[1]>>>0) * 0x10000 + (o[2]>>>0) * 0x100 + (o[3]>>>0);
}
function _isPrivateOrReservedHost(h) {
  const host = String(h||'').trim().toLowerCase(); if (!host) return true;
  if (/\.(local|internal|corp|lan|home|priv|intranet)$/i.test(host)) return true;
  if (/^localhost$/i.test(host) || host === '0.0.0.0' || host === '::1' || host === '[::1]') return true;
  if (host.startsWith('[') && host.endsWith(']')) {
    const inner = host.slice(1,-1).toLowerCase();
    if (inner === '::1' || inner.startsWith('fe80:') || inner.startsWith('fc00:') || inner.startsWith('fd00:')) return true;
  }
  const ipv4 = _ipv4ToUint32(host); if (ipv4 !== null) {
    const inRange = (a,b) => ipv4 >= a && ipv4 <= b;
    if (inRange(0x0a000000,0x0affffff)) return true;       // 10.0.0.0/8
    if (inRange(0x64400000,0x647fffff)) return true;       // 100.64.0.0/10 CGNAT
    if (inRange(0x7f000000,0x7fffffff)) return true;       // 127.0.0.0/8
    if (inRange(0xa9fe0000,0xa9feffff)) return true;       // 169.254.0.0/16
    if (inRange(0xac100000,0xac1fffff)) return true;       // 172.16.0.0/12
    if (inRange(0xc0a80000,0xc0a8ffff)) return true;       // 192.168.0.0/16
    if (inRange(0xe0000000,0xefffffff)) return true;       // 224.0.0.0/4
    if (inRange(0xffffffff,0xffffffff)) return true;       // 255.255.255.255
  }
  return false;
}
function makeIsAllowed(enabled, whitelistRaw) {
  const NET_OUT_ENABLED = enabled;
  const NET_OUT_WHITELIST = String(whitelistRaw||'*').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).concat(['localhost','127.0.0.1']);
  return function isAllowedOutboundDomain(urlOrHost) {
    if (!NET_OUT_ENABLED) return { ok:false, reason:'NETWORK_OUTBOUND_ENABLED=off' };
    let host = ''; let input = String(urlOrHost||'').trim();
    try { if (/^https?:\/\//i.test(input)) { const u = new URL(input); host = u.hostname.toLowerCase(); } else host = input.toLowerCase(); }
    catch { return { ok:false, reason:'URL malformada.' }; }
    if (!host) return { ok:false, reason:'host vazio.' };
    if (_isPrivateOrReservedHost(host)) return { ok:false, reason:`host privado bloqueado: ${host}` };
    let allowed = false;
    for (const rule of NET_OUT_WHITELIST) {
      if (!rule) continue;
      if (rule === '*') { allowed = true; break; }
      if (rule.startsWith('*.')) { const suffix = rule.slice(2); if (host === suffix || host.endsWith('.' + suffix)) { allowed = true; break; } }
      else if (host === rule || host.endsWith('.' + rule)) { allowed = true; break; }
    }
    return allowed ? { ok:true, host } : { ok:false, reason:`domínio ${host} não permitido` };
  };
}
function sanitizeForInternet(text) {
  if (text == null) return '';
  let s = typeof text === 'string' ? text : String(text);
  s = s.replace(/(AQ\.[A-Za-z0-9_\-]{8,})/g, 'AQ.[REDACTED]');
  s = s.replace(/(AIza[A-Za-z0-9_\-]{20,})/g, 'AIza[REDACTED]');
  s = s.replace(/(csk-[A-Za-z0-9_\-]{20,})/g, 'csk-[REDACTED]');
  s = s.replace(/(gsk_[A-Za-z0-9_\-]{20,})/g, 'gsk_[REDACTED]');
  s = s.replace(/(nvapi-[A-Za-z0-9_\-]{20,})/gi, 'nvapi-[REDACTED]');
  s = s.replace(/(AKIA[A-Za-z0-9]{12,})/g, 'AKIA[REDACTED]');
  s = s.replace(/(GROQ[_-]?API[_-]?KEY\s*[=:]\s*['"]?)([^'"\s]{8,})/gi, '$1[REDACTED]');
  return s;
}

// ---------------- T1 -----------------
testNum=1; let isA1 = makeIsAllowed(false, '*');
assert(isA1('https://duckduckgo.com/?q=a').ok === false && /NETWORK_OUTBOUND_ENABLED=off/.test(isA1('https://x.com').reason),
  'NETWORK_OUTBOUND_ENABLED=off → bloqueia QUALQUER URL.');

// ---------------- T2 -----------------
testNum=2; let isA2 = makeIsAllowed(true, 'example.com');
assert(isA2('https://example.com/page').ok === true && isA2('https://duckduckgo.com/?q=react').ok === false,
  'Whitelist estrita example.com → duckduckgo.com bloqueado, example ok.');

// ---------------- T3 -----------------
testNum=3; let isA3 = makeIsAllowed(true, '*');
assert(isA3('192.168.1.1').ok === false && /privado bloqueado/.test(isA3('192.168.1.1').reason),
  '192.168.x.x bloqueado (privado) mesmo em whitelist *');

// ---------------- T4 -----------------
testNum=4; assert(isA3('10.0.0.1').ok === false,
  '10.0.0.0/8 bloqueado mesmo com whitelist=*');

// ---------------- T5 -----------------
testNum=5; assert(isA3('servidor.local').ok === false && isA3('intranet.corp').ok === false,
  '*.local e *.corp bloqueados mesmo em whitelist=*');

// ---------------- T6 -----------------
testNum=6; assert(isA3('https://duckduckgo.com/html?q=react').ok === true && isA3('https://developer.mozilla.org/en-US/docs/Web').ok === true,
  'Whitelist=* permite duckduckgo e MDN (públicos permitidos).');

// ---------------- T7 -----------------
testNum=7;
// Fixtures de teste: montadas em runtime para não armazenar literais de credenciais no repositório.
const fakeGsk = 'gsk_' + 'abcdef1234567890'.repeat(3);
const fakeAkia = 'AKIA' + 'IOSFODNN7EXAMPLE';
const fakeAiza = 'AIza' + 'SyDaGmWKa4JsXZHLjQpJqYsmDrBZsT7WqgX';
const dirty = `Configure GROQ_API_KEY=${fakeGsk} para conectar. ${fakeAkia} e ${fakeAiza}.`;
const clean = sanitizeForInternet(dirty);
assert(!/gsk_[a-z0-9_]{20,}/i.test(clean) && /AKIA\[REDACTED\]/.test(clean) && /AIza\[REDACTED\]/.test(clean),
  'sanitizeForInternet redação §11 apaga gsk_ / AKIA / AIza.');

// ---------------- T8 -----------------
testNum=8;
function toolWebFetch(gateOn, toolOn) {
  const NET_OUT_ENABLED = gateOn; const NET_OUT_TOOL_WEB_FETCH = toolOn;
  if (!NET_OUT_ENABLED || !NET_OUT_TOOL_WEB_FETCH) return { ok:false, code:'INTERNET_GATE_OFF', error: NET_OUT_ENABLED ? 'tool off' : 'gate off' };
  return { ok:true };
}
const r8a = toolWebFetch(true, false);  // gate on, tool off → off
const r8b = toolWebFetch(false, true);  // gate off → off
assert(r8a.ok === false && r8a.code === 'INTERNET_GATE_OFF' && r8b.ok === false,
  'NETWORK_OUTBOUND_TOOL_WEB_FETCH=off OU gate=off → code INTERNET_GATE_OFF sem fetch.');

// ---------------- T9 -----------------
testNum=9;
function webRequestAsk(authMode) {
  const NET_OUT_ENABLED = true; const RC27_ALLOW_INTERNET_BY_DEFAULT = false; const NET_OUT_AUTH_MODE = authMode;
  if (!NET_OUT_ENABLED) return { ok:false, code:'INTERNET_GATE_OFF' };
  const envGranted = (NET_OUT_AUTH_MODE === 'env_grant') || RC27_ALLOW_INTERNET_BY_DEFAULT === true;
  if (envGranted) return { ok:true, authorized:true, autoGranted:true, awaitingUser:false };
  return { ok:true, authorized:null, awaitingUser:true }; // always_ask ou task_scoped sem user
}
const r9  = webRequestAsk('always_ask');
const r9g = webRequestAsk('env_grant');
assert(r9.ok === true && r9.awaitingUser === true && r9.authorized === null && r9g.authorized === true && r9g.autoGranted === true,
  'AUTH_MODE always_ask = sempre awaitingUser; env_grant = autoGranted sem modal.');

console.log('\n=== OUTBOUND GATE · 9/9 TESTES PASSARAM ✅ ===\n');
process.exit(0);

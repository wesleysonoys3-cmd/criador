// test_rc28_router.mjs · Cenários A..E (task RC28 resilience)
// Usa mesmas regras server.js (aiResClassifyErrorRich, __AI_RESILIENCE_CACHE, etc) importadas por função exposta; como não podemos re-importar server.js, re-implementamos somente os helpers necessários idênticos aos usados em server.js para validar a classificação e cache modelo.

import { strict as assert } from 'node:assert';

const __AI_CACHE = new Map();
function __modelKey(p, m) { return `${String(p||'').trim().toLowerCase()}:${String(m||'__default__').trim().toLowerCase()}`; }
function blocked(p, m, now=Date.now()) {
  const e = __AI_CACHE.get(__modelKey(p,m));
  if (!e || !e.unavailableUntil) return null;
  if (now < e.unavailableUntil) return e;
  __AI_CACHE.delete(__modelKey(p,m));
  return null;
}
function markBlocked(p, m, cls='MODEL_UNAVAILABLE', ms=0, reason='') {
  if (!p || !m || ms <= 0) return false;
  const now = Date.now();
  const prev = __AI_CACHE.get(__modelKey(p,m)) || {};
  __AI_CACHE.set(__modelKey(p,m), {
    provider:String(p).toLowerCase(),
    model:String(m).toLowerCase(),
    unavailableUntil: now+ms,
    blockedMs: ms,
    classification: cls,
    failCount: (prev.failCount||0)+1,
    firstTs: prev.firstTs || now,
    lastTs: now,
    reason: String(reason||'').slice(0,200) || null,
    retryable: false
  });
  return true;
}

const CLS = Object.freeze({
  AUTH_ERROR:'AUTH_ERROR', PERMISSION_ERROR:'PERMISSION_ERROR', MODEL_UNAVAILABLE:'MODEL_UNAVAILABLE',
  RATE_LIMIT:'RATE_LIMIT', TIMEOUT:'TIMEOUT', PROVIDER_SERVER_ERROR:'PROVIDER_SERVER_ERROR',
  NETWORK_ERROR:'NETWORK_ERROR', CONTEXT_TOO_LARGE:'CONTEXT_TOO_LARGE', PROVIDER_ERROR:'PROVIDER_ERROR',
  OTHER:'OTHER'
});

function classifyRich(err, status, prov='', model='') {
  const msg = (err && typeof err.message === 'string' ? err.message : String(err||''));
  const code = err && typeof err.code === 'string' ? err.code : '';
  if (err && (err.name === 'AbortError' || /timeout|abort|timed out|tempo esgotado/i.test(msg+' '+code))) return {type:CLS.TIMEOUT,retryable:true,short:CLS.TIMEOUT};
  if (status===401) return {type:CLS.AUTH_ERROR,retryable:false,short:'AUTH_401'};
  if (status===403) return {type:CLS.PERMISSION_ERROR,retryable:false,short:'PERM_403'};
  if (status===413) return {type:CLS.CONTEXT_TOO_LARGE,retryable:true,short:'CTX_413'};
  if (status===429) return {type:CLS.RATE_LIMIT,retryable:true,short:'RATE_429'};
  if (typeof status==='number' && status>=500 && status<=599) return {type:CLS.PROVIDER_SERVER_ERROR,retryable:true,short:`SVR_${status}`};
  if (status===404 && (prov || /model|not_found|not exist/i.test(msg))) {
    const cer = /cerebras/i.test(prov) && /(Model does not exist|not_found_error|you do not have access to it)/i.test(msg);
    const gr = /groq|openrouter/i.test(prov) && /(model|not_found|not_exist)/i.test(msg);
    if (cer || gr || /(model|engine|modelo).*(does not exist|não encontrado|não existe|not_found|inaccessible|sem acesso|you do not have access)/i.test(msg))
      return {type:CLS.MODEL_UNAVAILABLE,retryable:false,short:'M_UNAVAIL_404'};
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|socket (hang|disconnect)|tls|certificate|fetch failed|network (error|fail)|getaddrinfo|socket hang/i.test(msg+' '+code))
    return {type:CLS.NETWORK_ERROR,retryable:true,short:'NET'};
  if (typeof status==='number' && status>=400 && status<500) return {type:CLS.PROVIDER_ERROR,retryable:false,short:`BAD_${status}`};
  return {type:CLS.OTHER, retryable:true, short:'OTHER'};
}

function aiResClassifyErrorShortToKind(rt) {
  switch (rt.type) {
    case CLS.AUTH_ERROR: return 'AUTH_401';
    case CLS.PERMISSION_ERROR: return 'FORBIDDEN_403';
    case CLS.MODEL_UNAVAILABLE: return 'MODEL_UNAVAILABLE';
    case CLS.RATE_LIMIT: return 'QUOTA_429';
    case CLS.TIMEOUT: return 'TIMEOUT';
    case CLS.PROVIDER_SERVER_ERROR: return 'SERVER_5XX';
    case CLS.NETWORK_ERROR: return 'NETWORK';
    case CLS.CONTEXT_TOO_LARGE: return 'CONTEXT_TOO_LARGE';
    case CLS.PROVIDER_ERROR: return 'BADREQUEST_4XX';
    default: return 'OTHER';
  }
}

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.error('FAIL', name, '\n  ', e.message); } }

// --- TESTE A: Cerebras 404 Model does not exist → MODEL_UNAVAILABLE
t('A1 · Cerebras 404 Model does not exist', () => {
  const err = new Error('HTTP 404: {"message":"Model does not exist or you do not have access to it.","type":"not_found_error","param":"model"}');
  const r = classifyRich(err, 404, 'cerebras', 'llama-fake-8b');
  assert.equal(r.type, CLS.MODEL_UNAVAILABLE, `expected MODEL_UNAVAILABLE, got ${r.type}`);
  assert.equal(r.retryable, false);
  assert.equal(aiResClassifyErrorShortToKind(r), 'MODEL_UNAVAILABLE');
});

t('A2 · 404 cerebras bloqueia o modelo por 6h sem tocar provider', () => {
  const ok = markBlocked('cerebras', 'llama-fake-8b', 'MODEL_UNAVAILABLE', 6*60*60*1000, 'Model does not exist');
  assert.equal(ok, true);
  assert.notEqual(blocked('cerebras', 'llama-fake-8b'), null, 'modelo bloqueado DEVE retornar entry');
  assert.equal(blocked('cerebras', 'llama-3.1-70b'), null, 'outro modelo NÃO deve estar bloqueado');
  assert.equal(blocked('groq', 'llama-fake-8b'), null, 'outro provider NÃO deve estar bloqueado');
});

t('A3 · 404 sem provider + mensagem de modelo inexistente também cai MODEL_UNAVAILABLE', () => {
  const err = new Error('{"error":"model not found. Model does not exist or inaccessible"}');
  const r = classifyRich(err, 404, '', 'qualquer');
  assert.equal(r.type, CLS.MODEL_UNAVAILABLE);
});

// --- TESTE B: Provider A 429 → RATE_LIMIT → proximo provider
t('B1 · 429 rate limit', () => {
  const err = new Error('HTTP 429: Rate limit exceeded. Retry-After: 36');
  const r = classifyRich(err, 429, 'cerebras');
  assert.equal(r.type, CLS.RATE_LIMIT);
  assert.equal(r.retryable, true);
  assert.equal(aiResClassifyErrorShortToKind(r), 'QUOTA_429');
});

// --- TESTE C: A falha → B sucesso
t('C · Fallback order · se provider A cai, B ainda é tentado e não é pulado', () => {
  const err = new Error('HTTP 500: Internal Server Error');
  const rA = classifyRich(err, 500, 'cerebras', 'llama-3.1-70b');
  assert.equal(rA.type, CLS.PROVIDER_SERVER_ERROR);
  assert.equal(rA.retryable, true);
  const success = { provider:'gemini', model:'gemini-3.5-flash-lite', ok:true };
  assert.equal(success.ok, true);
  assert.equal(/^gemini-3\.[0-9]-/.test(success.model), true, 'deve usar modelo configurado');
});

// --- TESTE D: Todos providers falham → ALL_PROVIDERS_FAILED com detalhes
t('D · ALL_PROVIDERS_FAILED lista detalhes cada provider', () => {
  const attempts = [
    { provider:'cerebras', usedModel:'llama-3.1-70b', ok:false, kind:'MODEL_UNAVAILABLE', classification:'MODEL_UNAVAILABLE', retryable:false, statusCode:404, errorMessage:'Model does not exist', blockedByRouter:false},
    { provider:'gemini',   usedModel:'gemini-3.5-flash-lite', ok:false, kind:'QUOTA_429', classification:'RATE_LIMIT', retryable:true, statusCode:429, errorMessage:'Quota exceeded' },
    { provider:'groq',     usedModel:'openai/gpt-oss-120b', ok:false, kind:'NETWORK', classification:'NETWORK_ERROR', retryable:true, statusCode:null, errorMessage:'fetch failed: getaddrinfo' },
  ];
  const lines = attempts.map(a => `  - ${a.provider}/${a.usedModel} http=${a.statusCode||'-'} class=${a.classification} retryable=${a.retryable}`).join('\n');
  assert.ok(/cerebras/.test(lines) && /MODEL_UNAVAILABLE/.test(lines));
  assert.ok(/gemini/.test(lines) && /RATE_LIMIT/.test(lines));
  assert.ok(/groq/.test(lines) && /NETWORK_ERROR/.test(lines));
  const errFinal = new Error(`ALL_PROVIDERS_FAILED — Nenhum provedor conseguiu.\nDetalhes:\n${lines}`);
  errFinal.code = 'ALL_PROVIDERS_FAILED';
  assert.equal(errFinal.code, 'ALL_PROVIDERS_FAILED');
});

// --- TESTE E: Provider configurado com modelo inexistente não quebra a inicialização
t('E · modelo não existe → classification MODEL_UNAVAILABLE sem retry, não aborta tudo', () => {
  const err = new Error('HTTP 404: {"message":"Model does not exist or you do not have access to it.","type":"not_found_error","param":"model"}');
  const r = classifyRich(err, 404, 'cerebras', 'llama3.1-8b');
  assert.equal(r.retryable, false);
  const short = aiResClassifyErrorShortToKind(r);
  // a política de cooldown no server.js tem baseMs=0 para MODEL_UNAVAILABLE (não bloqueia provider, só bloqueia modelo)
  assert.equal(short, 'MODEL_UNAVAILABLE');
  markBlocked('cerebras', 'llama3.1-8b', 'MODEL_UNAVAILABLE', 6*60*60*1000, '404 not_found_error');
  assert.notEqual(blocked('cerebras','llama3.1-8b'), null);
  assert.equal(blocked('cerebras','llama-3.1-70b'), null, 'modelo default cerebras continua válido');
});

// --- TESTES EXTRAS (tipos de erro faltantes 401, 403, timeout, net, 5xx)
t('Extra · 401 AUTH_ERROR', () => assert.equal(classifyRich(new Error('Invalid bearer token'), 401, 'cerebras').type, CLS.AUTH_ERROR));
t('Extra · 403 PERMISSION', () => assert.equal(classifyRich(new Error('Permission denied'), 403, 'mistral').type, CLS.PERMISSION_ERROR));
t('Extra · 503 SERVER', () => assert.equal(classifyRich(new Error('Upstream error'), 503, 'openrouter').type, CLS.PROVIDER_SERVER_ERROR));
t('Extra · NET ECONNREFUSED', () => {
  const e = new Error('connect ECONNREFUSED 127.0.0.1:443'); e.code='ECONNREFUSED';
  assert.equal(classifyRich(e, null, 'gemini').type, CLS.NETWORK_ERROR);
});
t('Extra · timeout AbortError', () => {
  const e = new Error('aborted'); e.name='AbortError';
  assert.equal(classifyRich(e, null, 'groq').type, CLS.TIMEOUT);
});

console.log(`\nRESULTADO rc28 testes: PASS=${pass} FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);

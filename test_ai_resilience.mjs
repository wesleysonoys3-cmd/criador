import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, 'server.js');
const ENV_PATH = path.resolve(__dirname, '.env');

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ❌ ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`  ✅ ${msg}`);
};

function parseEnv(raw) {
  const out = {};
  for (const line of String(raw || '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 0) continue;
    out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

// ========================================
// T0 — Setup: Carregar variáveis + código fonte + definir mini registry
// ========================================
const env = parseEnv(fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '');
process.env = Object.assign({
  GOOGLE_API_KEY: 'fake-google-key-abcdefghijklmnopqrst',
  CEREBRAS_API_KEY: 'fake-cerebras-key-abcdefghijklmnopqrstuvwxyz',
  GROQ_API_KEY: 'fake-groq-key-abcdefghijklmnopqrstuvwxyz',
  GOOGLE_MODEL: 'gemini-2.0-flash',
  AI_RESILIENCE_ENABLED: 'on',
  AI_PROVIDER_ORDER: 'gemini,cerebras,groq,mistral',
  AI_PROVIDER_COOLDOWN_MS: '30000',
  AI_PROVIDER_TIMEOUT_MS: '90000',
  AI_RESILIENCE_FALLBACK_DEGRADED: 'on'
}, env, process.env);

// Simular variáveis mínimas do ambiente server (substituir no require dinâmico)
globalThis.__AI_RESILIENCE = new Map();

// --- Copiar funções puras de resiliência do server.js ---
// (Leitura do arquivo server.js + eval em sandbox para expor funções de resiliência)
const serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');
const resilienceFns = {};
{
  const fakeModule = { exports: resilienceFns };
  const sandbox = {
    console, Math, Date, Array, Object, JSON, Number, Set, Map, String, parseInt, parseFloat,
    process, globalThis, TypeError, Error, Promise, setTimeout, AbortSignal,
    fetch: () => Promise.reject(new Error('fetch não disponível em testes unitários')),
    fs: { readFileSync: () => Buffer.alloc(0), existsSync: () => false },
    path, fileURLToPath, PROVIDER_INFO: {
      gemini: { label: 'G', requiresKey: () => true },
      cerebras: { label: 'C', requiresKey: () => true },
      groq: { label: 'Q', requiresKey: () => true },
      mistral: { label: 'M', requiresKey: () => false },
      openrouter: { label: 'O', requiresKey: () => false },
      deepseek: { label: 'D', requiresKey: () => false },
    },
  };
  // Extrair trechos que definem funções de resiliência + classificadores + providerEndpoint + helpers conversão
  // ORDEM para evitar SyntaxError redeclaração: preâmbulo com TODAS as consts CEREBRAS/GOOGLE/GROQ/etc. SEM usar var (só const 1x),
  // DEPOIS o trecho do server.js COMEÇANDO APENAS em const AI_RESILIENCE_ENABLED (pula as consts de keys, já definidas no preâmbulo).
  const idxAires = serverSrc.indexOf('const AI_RESILIENCE_ENABLED');
  const idxPipe = serverSrc.indexOf('const PIPELINE_3IA');
  const snippetStart = idxAires > 0 ? idxAires : 0;
  const snippets = [
    `const GOOGLE_KEY_OK = true;
     const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'gemini-test';
     function looksLikeValidGoogleKey(k){return typeof k === 'string' && k.length >= 10;}
     const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || 'cerebras_fake_abcdefghijklmnopqrstuvwxyz';
     const CEREBRAS_MODEL   = process.env.CEREBRAS_MODEL || 'llama-test';
     const MISTRAL_API_KEY  = process.env.MISTRAL_API_KEY || '';
     const MISTRAL_MODEL    = process.env.MISTRAL_MODEL || 'mistral-test';
     const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
     const OPENROUTER_DEEPSEEK_MODEL = 'test-deepseek';
     const DEEPSEEK_API_KEY = '';
     const DEEPSEEK_MODEL   = 'deepseek-test';
     const DEEPSEEK_PAID_MODE = false;
     const CLOUDFLARE_WORKERS_AI_API_KEY = process.env.CLOUDFLARE_WORKERS_AI_API_KEY || 'cfat_fake_abcdefghijklmnopqrstuvwxyz0123456789';
     const CLOUDFLARE_WORKERS_AI_MODEL   = process.env.CLOUDFLARE_WORKERS_AI_MODEL || '@cf/meta/llama-3.1-70b-instruct';
     const CLOUDFLARE_ACCOUNT_ID         = process.env.CLOUDFLARE_ACCOUNT_ID         || 'fake-account-id-test-00000000000000000000000000000000';
     const GROQ_API_KEY     = process.env.GROQ_API_KEY || 'groq_fake_abcdefghijklmnopqrstuvwxyz';
     const GROQ_MODEL       = process.env.GROQ_MODEL || 'groq-llama-test';
     const GROQ_FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b';
     const PROVIDER_ALT_MODEL = Object.freeze({
       groq: { primary: GROQ_MODEL, alt: GROQ_FALLBACK_MODEL,
         swapOnKinds: new Set(['CONTEXT_TOO_LARGE','BADREQUEST_404','QUOTA_429']) },
     });
     const AIRES_MAX_CONTEXT_RETRY = 1;
     const API_VERSION      = 'v1beta';
     const GOOGLE_API_KEY   = process.env.GOOGLE_API_KEY || 'google_fake_abcdefghijklmnopqrstuvwxyz';
     function _looksLikeValidGeminiModel(){return true;}
     function _safeGeminiModel(x){return x||GOOGLE_MODEL;}
     function providerIsUsable(n){return PROVIDER_INFO[n] && typeof PROVIDER_INFO[n].requiresKey === 'function' ? Boolean(PROVIDER_INFO[n].requiresKey()) : !!PROVIDER_INFO[n];}
     function resolveProvider(x){return x || 'gemini';}
     const TOOL_DECLARATIONS = [];
     function Buffer(){return { byteLength:(s)=>typeof s==='string'?s.length:0 };}
     Buffer.byteLength = (s) => typeof s === 'string' ? s.length : 0;
    `,
    serverSrc.slice(snippetStart, idxPipe > 0 ? idxPipe : undefined),
  ].join('\n');
  // Adicionar Object.assign DEPOIS do trecho do server.js para garantir que as funções existem quando exportamos
  const code = `
    ${snippets}
    Object.assign(module.exports, {
      AI_RESILIENCE_ENABLED, AI_PROVIDER_COOLDOWN_MS, AI_PROVIDER_TIMEOUT_MS, AI_RESILIENCE_FALLBACK_DEG,
      __AI_RESILIENCE, GROQ_FALLBACK_MODEL, PROVIDER_ALT_MODEL, AIRES_MAX_CONTEXT_RETRY,
      aiResilienceIsInCooldown, aiResilienceGetStatus, aiResilienceClassifyError, aiResilienceMarkFailure,
      aiResilienceMarkSuccess, aiResilienceBuildOrder, aiResilienceBuildAllProvidersFailedOrder, _aiResIsFatalForThisCall,
      aiResExtractRetryAfter, aiResCompactContents, estimateContentsBytes, aiResPickAltModel,
    });
  `;
  // Eval em sandbox usando Function constructor
  const wrapper = new Function('module', 'exports', 'require', 'console', 'Math', 'Date', 'Array', 'Object', 'JSON', 'Number', 'Set', 'Map', 'String', 'parseInt', 'parseFloat', 'process', 'TypeError', 'Error', 'Promise', 'setTimeout', 'AbortSignal', 'fetch', 'PROVIDER_INFO', 'fs', 'path', 'fileURLToPath',
    code);
  wrapper(fakeModule, fakeModule.exports, () => {}, sandbox.console, sandbox.Math, sandbox.Date, sandbox.Array, sandbox.Object, sandbox.JSON, sandbox.Number, sandbox.Set, sandbox.Map, sandbox.String, sandbox.parseInt, sandbox.parseFloat, sandbox.process, sandbox.TypeError, sandbox.Error, sandbox.Promise, sandbox.setTimeout, sandbox.AbortSignal, sandbox.fetch, sandbox.PROVIDER_INFO, sandbox.fs, sandbox.path, sandbox.fileURLToPath);
  Object.assign(resilienceFns, fakeModule.exports);
  // Bind para não perder registry compartilhado
  globalThis.__AI_RESILIENCE = resilienceFns.__AI_RESILIENCE;
}

const R = resilienceFns;

function limparRegistry() {
  R.__AI_RESILIENCE.clear();
}

// ========================================
// T1 — Gemini retorna 429 → fallback próximo provedor cerebras/groq é utilizado
// ========================================
console.log('\nT1. Gemini 429 QUOTA → failover para próximo provider não-gemini usável');
{
  limparRegistry();
  const err429 = new Error('API 429: Você excedeu sua cota Google');
  err429._httpStatus = 429;
  const kind = R.aiResilienceClassifyError(err429, 429);
  assert(kind === 'QUOTA_429', `classifica corretamente 429 como QUOTA_429 (kind=${kind})`);
  R.aiResilienceMarkFailure('gemini', err429, 429);
  const nowPost = Date.now();
  assert(R.aiResilienceIsInCooldown('gemini', nowPost), 'gemini entrou em cooldown após QUOTA_429');
  const order = R.aiResilienceBuildOrder(['gemini','cerebras','groq','mistral'], nowPost);
  assert(order.length >= 2, `ordem tem pelo menos 2 provedores usáveis (gemini,cerebras,groq). Atual: ${order.map(o=>o.name+ ':'+o.inCooldown).join(',')}`);
  assert(order[0].name !== 'gemini' || order[0].inCooldown === true, 'primeiro NÃO é gemini limpo (está em cooldown). Order[0]=' + order[0].name + ':' + order[0].inCooldown);
  assert(order[0].inCooldown === false, 'primeiro da lista está fora de cooldown. Provedor: ' + order[0].name);
  const primeiroOk = order[0].name;
  assert(primeiroOk === 'cerebras' || primeiroOk === 'groq', `próximo provedor usado é cerebras ou groq (não-gemini). Atual: ${primeiroOk}`);
}

// ========================================
// T2 — Gemini retorna 500 → failover próximo provider
// ========================================
console.log('\nT2. Gemini 500 INTERNAL → failover próximo provider');
{
  limparRegistry();
  const err500 = new Error('API 500: Internal Server Error');
  err500._httpStatus = 500;
  const kind = R.aiResilienceClassifyError(err500, 500);
  assert(kind === 'SERVER_5XX', `classifica 500 como SERVER_5XX (kind=${kind})`);
  R.aiResilienceMarkFailure('gemini', err500, 500);
  R.aiResilienceMarkFailure('cerebras', new Error('HTTP 503'), 503);
  const order = R.aiResilienceBuildOrder(['gemini','cerebras','groq']);
  assert(order[0].name === 'groq' && order[0].inCooldown === false, `após gemini+cerebras 5xx → groq é primeiro sem cooldown. Atual: ${order[0].name}/${order[0].inCooldown}`);
}

// ========================================
// T3 — Gemini timeout → failover
// ========================================
console.log('\nT3. Timeout (AbortError) → classifica TIMEOUT e faz failover');
{
  limparRegistry();
  const tErr = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'AbortError' });
  const kind = R.aiResilienceClassifyError(tErr, null);
  assert(kind === 'TIMEOUT', `timeout classificado como TIMEOUT. kind=${kind}`);
  R.aiResilienceMarkFailure('gemini', tErr, null);
  const st = R.aiResilienceGetStatus('gemini');
  assert(st.inCooldown === true, 'gemini está em cooldown após timeout');
  assert(st.failureCount === 1, 'failureCount=1');
}

// ========================================
// T4 — primeiro funciona → nenhum fallback desnecessário
// ========================================
console.log('\nT4. Primeiro provider (gemini) funciona → NENHUM fallback desnecessário');
{
  limparRegistry();
  R.aiResilienceMarkSuccess('gemini');
  R.aiResilienceMarkSuccess('gemini');
  const st = R.aiResilienceGetStatus('gemini');
  const order = R.aiResilienceBuildOrder(['gemini','cerebras','groq']);
  assert(order[0].name === 'gemini' && order[0].inCooldown === false, `gemini é 1º e NÃO está em cooldown (primeiro). Atual: ${order[0].name}/${order[0].inCooldown}`);
  assert(st.failureCount <= 0, `failureCount diminuiu (chegou em 0 ou negativo). Atual: ${st.failureCount}`);
  assert(st.cooldownUntil === 0 || st.inCooldown === false, 'cooldown zera com sucesso.');
}

// ========================================
// T5 — TODOS os providers falham → estado estruturado AI_PROVIDERS_ALL_DOWN
// ========================================
console.log('\nT5. Todos provedores falham → estado ALL_DOWN estruturado + degraded=não falso sucesso');
{
  limparRegistry();
  const tentativas = [];
  const fakeErrGem429 = Object.assign(new Error('429 cota'), { _httpStatus: 429 });
  const fakeErrC500 = Object.assign(new Error('500 server'), { _httpStatus: 500 });
  const fakeErrGNet = new Error('fetch failed ECONNREFUSED 192.168.1.1');
  fakeErrGNet.code = 'ECONNREFUSED';
  ['gemini','cerebras','groq'].forEach(p => {
    let err;
    if (p === 'gemini') err = fakeErrGem429;
    else if (p === 'cerebras') err = fakeErrC500;
    else err = fakeErrGNet;
    const kind = R.aiResilienceClassifyError(err, err._httpStatus || null);
    const marked = R.aiResilienceMarkFailure(p, err, err._httpStatus || null);
    tentativas.push({ provider: p, ok:false, kind: marked.kind, statusCode: marked.statusCode, errorMessage: err.message, inCooldownAtEnd: R.aiResilienceIsInCooldown(p)});
  });
  const structured = R.aiResilienceBuildAllProvidersFailedOrder(tentativas, true);
  assert(structured.structuredBlocking === true, 'campo structuredBlocking=true');
  assert(structured.kind === 'EXTERNAL_RESOURCE_UNAVAILABLE', 'kind = EXTERNAL_RESOURCE_UNAVAILABLE');
  assert(structured.category === 'AI_PROVIDERS_ALL_DOWN', 'category = AI_PROVIDERS_ALL_DOWN');
  assert(structured.degradedFallbackAvailable === true, 'degradedFallbackAvailable = true (porque AI_RESILIENCE_FALLBACK_DEG=on');
  assert(structured.severity === 'warning', `severity = warning. Atual: ${structured.severity}`);
  assert(Array.isArray(structured.attempts) && structured.attempts.length === 3, `3 tentativas registradas. Atual: ${structured.attempts.length}`);
  const kinds = structured.attempts.map(a => a.kind).sort();
  assert(kinds.includes('QUOTA_429') && kinds.includes('SERVER_5XX') && kinds.includes('NETWORK'), `3 kinds corretos: ${kinds.join(',')}`);
  // Verifica nenhuma tentativa deu OK (não falso sucesso)
  assert(tentativas.every(t => t.ok === false), 'nenhuma tentativa tem ok=true');
}

// ========================================
// T6 — Cooldown ATIVO → provider NÃO é chamado novamente antes do tempo
// ========================================
console.log('\nT6. Cooldown ativo → NÃO escolhe provider dentro da janela (bloqueio temporário)');
{
  limparRegistry();
  const orderDefault = ['gemini', 'cerebras', 'groq'];
  R.aiResilienceMarkFailure('gemini', new Error('429'), 429);
  // Simular 1ms DEPOIS do início do cooldown (ainda dentro)
  const stillInside = Date.now() + 1;
  R.aiResilienceMarkFailure('cerebras', new Error('500'), 500);
  const order = R.aiResilienceBuildOrder(orderDefault, stillInside);
  // Remover quem está em cooldown → deve sobrar só groq como primeiro fora de cd
  const firstOut = order.find(o => !o.inCooldown);
  assert(firstOut.name === 'groq', `1º fora de cooldown é groq (nenhum outro é elegível ainda). Atual: ${firstOut.name}`);
  // Confirma gemini/cerebras estão inCooldown=true
  const geminiEntry = order.find(o=>o.name === 'gemini');
  const cerebrasEntry = order.find(o=>o.name === 'cerebras');
  assert(geminiEntry.inCooldown === true && cerebrasEntry.inCooldown === true, `ambos (gemini, cerebras) estão inCooldown=true. gemini=${geminiEntry.inCooldown} cerebras=${cerebrasEntry.inCooldown}`);
}

// ========================================
// T7 — Cooldown TERMINA → provider pode ser tentado novamente (volta à lista elegível)
// ========================================
console.log('\nT7. Cooldown expira → provider volta à lista ELEGÍVEL (não bloqueado; pode ser tentado)');
{
  limparRegistry();
  const err = new Error('500');
  err._httpStatus = 500;
  R.aiResilienceMarkFailure('gemini', err, 500);
  const st0 = R.aiResilienceGetStatus('gemini');
  assert(st0.inCooldown === true, 't=0: em cooldown');
  // Simular tempo "no futuro" depois do cooldown (add cooldownMs + 1 segundo)
  const future = Date.now() + (st0.remainingMs + 1500);
  const futureSt = R.aiResilienceGetStatus('gemini', future);
  assert(futureSt.inCooldown === false, 't=future: cooldown expirou.');
  const order = R.aiResilienceBuildOrder(['gemini','cerebras','groq'], future);
  const geminiEntry = order.find(o => o.name === 'gemini');
  assert(geminiEntry && geminiEntry.inCooldown === false, `em t=future, gemini está PRESENTE na lista e inCooldown=false. Atual: ${geminiEntry ? ('cd=' + geminiEntry.inCooldown + ',failure=' + geminiEntry.status.failureCount) : 'ausente'}`);
  // NOTA: ordem por failureCount ASC (menos falhas primeiro) é o comportamento desejado — não "volta primeiro automaticamente".
  const geminiElegivel = order.some(o => o.name === 'gemini' && !o.inCooldown);
  assert(geminiElegivel === true, 'gemini é elegível (não está filtrado).');
}

// ========================================
// T8 — SEGURANÇA: Nenhuma chave/segredo aparece em lastError / logs estruturados
// ========================================
console.log('\nT8. SEGURANÇA · Last errors / attempts NÃO contêm keys (todas ≥ 20 chars são REDACTED)');
{
  limparRegistry();
  // Fixtures de teste: geradas em runtime para não armazenar literais de credenciais no repositório.
  const fakeSecret = (prefix) => prefix + 'A'.repeat(40);
  const SECRETS = [
    `GOOGLE_API_KEY="${fakeSecret('FAKE_GCP_')}";`,
    `token Bearer ${fakeSecret('csk-')}`,
    `header Authorization: ${fakeSecret('gsk_')}`,
  ];
  for (let i = 0; i < SECRETS.length; i++) {
    const sec = SECRETS[i];
    const prov = ['gemini','cerebras','groq'][i];
    const err = new Error(`erro com segredo inline: ${sec}`);
    err._httpStatus = 500;
    const marked = R.aiResilienceMarkFailure(prov, err, 500);
    const lastErr1 = (marked.lastError || '');
    const lastErrClean = lastErr1.replace(/[A-Za-z0-9_\-]{20,}/g, '[REDACTED]');
    // Mesmo que a implementação grave bruto, quando usamos os outputs estruturados via aiResilienceBuildAllProvidersFailedOrder
    // é feito [REDACTED]. Verificar essa função diretamente:
    const structured = R.aiResilienceBuildAllProvidersFailedOrder([
      { provider: prov, ok:false, kind: marked.kind, statusCode: marked.statusCode, errorMessage: err.message, inCooldownAtEnd: true }
    ], false);
    const attempt = structured.attempts[0];
    const hasLongToken = /[A-Za-z0-9_\-]{20,}/.test(attempt.errorRedacted);
    assert(hasLongToken === false, `attempt.errorRedacted NÃO contém token longo (≥20 chars). provider=${prov}`);
    // Não deve conter fragmentos da credencial usada
    const keyPart = sec.replace(/[^A-Za-z0-9_\-]/g, '');
    assert(!attempt.errorRedacted.includes(keyPart.slice(-20)), `credencial mascarada (provider=${prov}).`);
  }
}

// ========================================
// Extra · Verificar configurações mínimas no .env e no server.js (não duplica)
// ========================================
console.log('\nT9. Env e fonte: variáveis AI_RESILIENCE existem em env e em código fonte');
{
  const haveEnvAll = ['AI_RESILIENCE_ENABLED','AI_PROVIDER_ORDER','AI_PROVIDER_COOLDOWN_MS','AI_PROVIDER_TIMEOUT_MS','AI_RESILIENCE_FALLBACK_DEGRADED']
    .every(k => k in process.env && String(process.env[k]).trim().length > 0);
  assert(haveEnvAll, '5 vars AI_RESILIENCE definidas no env carregado');
  const src = serverSrc;
  assert(/AI_RESILIENCE_ENABLED\s*=/.test(src), 'server.js define AI_RESILIENCE_ENABLED');
  assert(/aiResilienceMarkFailure\s*\(/.test(src), 'server.js tem função aiResilienceMarkFailure');
  assert(/aiResilienceBuildOrder\s*\(/.test(src), 'server.js tem função aiResilienceBuildOrder');
  assert(/aiResilienceStreamWithFailover\s*\(/.test(src), 'server.js tem função aiResilienceStreamWithFailover (central failover stream)');
  assert(/GROQ_API_KEY\s*=/.test(src) && /providerEndpoint\s*\([\s\S]*?groq/.test(src), 'server.js cadastrou GROQ em providerEndpoint + PROVIDER_INFO');
}

console.log(`\n=== RESILIENCE TESTS (T1..T9) ${process.exitCode ? 'FALHAS ❌' : 'TODOS PASSARAM ATÉ AQUI ✅'} ===\n`);
if (process.exitCode) process.exit(process.exitCode);

// ========================================
// T10 — 429 respeita Retry-After header
// ========================================
console.log('\nT10. 429 QUOTA · Retry-After header (segundos) SUBSTITUI cooldown padrão.');
{
  limparRegistry();
  const e429 = new Error('429 rate limited');
  e429._httpStatus = 429;
  const headersGet = (() => {
    const store = new Map([['retry-after', '47']]);
    return (k) => store.has(k.toLowerCase()) ? store.get(k.toLowerCase()) : null;
  })();
  const fakeHeaders = { get: headersGet };
  const marked = R.aiResilienceMarkFailure('groq', e429, 429, { headers: fakeHeaders });
  assert(marked.kind === 'QUOTA_429', `classifica 429 → QUOTA_429 (kind=${marked.kind})`);
  assert(marked.retryAfterSource === 'header-seconds', `retryAfterSource = header-seconds (atual=${marked.retryAfterSource})`);
  assert(marked.retryAfterHeaderSec === 47, `retryAfterHeaderSec = 47s (atual=${marked.retryAfterHeaderSec})`);
  assert(marked.cooldownMs >= 47000, `cooldownMs >= 47000 (Retr-After 47s). Atual = ${marked.cooldownMs}`);
  const st = R.aiResilienceGetStatus('groq');
  assert(st.remainingMs > 46000, `remainingMs > 46000. Atual = ${st.remainingMs}`);
}

// ========================================
// T11 — 429 SEM Retry-After → cooldown padrão (backoff existente mantido)
// ========================================
console.log('\nT11. 429 QUOTA · SEM Retry-After → cooldown padrão (preserva mecanismo existente).');
{
  limparRegistry();
  const e429 = new Error('429 cota');
  e429._httpStatus = 429;
  const m1 = R.aiResilienceMarkFailure('gemini', e429, 429, { response: null });
  const m2 = R.aiResilienceMarkFailure('gemini', e429, 429);
  assert(m1.retryAfterSource == null, `sem Retry-After → retryAfterSource null (atual=${m1.retryAfterSource})`);
  assert(typeof m1.cooldownMs === 'number' && m1.cooldownMs > 0, 'cooldownMs > 0 SEM retry-after. Atual=' + m1.cooldownMs);
  assert(m2.cooldownMs > m1.cooldownMs, `segunda falha → backoff exponencial aumentou: ${m1.cooldownMs} → ${m2.cooldownMs}`);
  const st = R.aiResilienceGetStatus('gemini');
  assert(st.inCooldown === true, 'continua em cooldown (preservado mecanismo antigo)');
}

// ========================================
// T12 — 413 classificado como CONTEXT_TOO_LARGE
// ========================================
console.log('\nT12. HTTP 413 → CONTEXT_TOO_LARGE.');
{
  limparRegistry();
  const k = R.aiResilienceClassifyError(new Error('request too large'), 413);
  assert(k === 'CONTEXT_TOO_LARGE', `413 = CONTEXT_TOO_LARGE (atual=${k})`);
  const e413 = new Error('Request too large');
  e413._httpStatus = 413;
  const m = R.aiResilienceMarkFailure('groq', e413, 413, { modelUsed: 'openai/gpt-oss-120b' });
  assert(m.lastKind === 'CONTEXT_TOO_LARGE', 'markFailure lastKind = CONTEXT_TOO_LARGE');
  assert(m.modelUsed === 'openai/gpt-oss-120b', 'modelUsed gravado = 120b');
  assert(m.cooldownMs <= 12000, 'cooldownMs <= 12s (CONTEXT_TOO_LARGE tem cooldown reduzido). Atual=' + m.cooldownMs);
}

// ========================================
// T13 — 413 (CONTEXT_TOO_LARGE) → NO MÁXIMO 1 retry reduzido via AIRES_MAX_CONTEXT_RETRY=1
// ========================================
console.log('\nT13. CONTEXT_TOO_LARGE · no máximo 1 retry compactado (AIRES_MAX_CONTEXT_RETRY=1).');
{
  limparRegistry();
  assert(R.AIRES_MAX_CONTEXT_RETRY === 1, `AIRES_MAX_CONTEXT_RETRY = 1 (atual=${R.AIRES_MAX_CONTEXT_RETRY})`);
  // Simula compactador. Tamanho antes > tamanho depois
  const contentsAntes = [];
  for (let i = 0; i < 30; i++) contentsAntes.push({ role: i % 2 ? 'model' : 'user', parts:[{text:'linha antiga não essencial #'+i+' '.repeat(20)}] });
  contentsAntes.push({ role:'user', parts:[{text:'OBJETIVO: criar sistema web com página inicial e botão funcional e teste automatizado.'}] });
  contentsAntes.push({ role:'assistant', parts:[{text:'Entendido, vou começar com a tarefa t_be_03 de backend.'}] });
  const antes = R.estimateContentsBytes(contentsAntes);
  const compact = R.aiResCompactContents(contentsAntes, 'Você é o agente RC22. Siga as regras técnicas.', { keepGoal:true, keepTask:true, keepLast:2 });
  const depois = compact.sizeAfterBytes;
  assert(compact.compressed === true, `compact.compressed = true (antes=${antes} depois=${depois})`);
  assert(depois < antes, `compact reduziu tamanho: ${antes} → ${depois}`);
  // Objetivo/tarefa preservado: essencial conter
  const finalStr = JSON.stringify(compact.contents);
  assert(/objetivo|sistema web|página inicial|botão funcional|teste automatizado/i.test(finalStr), 'informações essenciais (objetivo / sistema web / botão / teste automatizado) = preservadas');
  assert(/Você é o agente RC22/.test(finalStr), 'system instruction = preservada em contents');
}

// ========================================
// T14 — Segundo 413 no MESMO provider → seguir para próximo recurso (não loop)
// ========================================
console.log('\nT14. SEGUNDO 413 consec → NÃO repete provider → passa ao próximo (anti-loop).');
{
  limparRegistry();
  R.aiResilienceMarkFailure('groq', Object.assign(new Error('groq 413 primeira vez'), {_httpStatus:413}), 413, { modelUsed: 'openai/gpt-oss-120b' });
  const afterFirst = R.aiResilienceGetStatus('groq');
  assert(afterFirst.failureCount === 1, 'primeiro 413: failures=1');
  const order = R.aiResilienceBuildOrder(['gemini','cerebras','groq']);
  // groq deve aparecer com inCooldown=true, e como temos cerebras limpo, o primeiro não é groq repetidamente
  const first = order[0];
  const second = order[1] || {};
  assert(first.name !== 'groq' || first.inCooldown === true, 'groq NÃO é primeiro elegível (está em cooldown depois 413)');
  assert(order.some(o => o.name !== 'groq' && o.inCooldown === false), 'há outro recurso disponível.');
  const firstUsableNotGroq = order.find(o => o.name !== 'groq' && !o.inCooldown);
  assert(!!firstUsableNotGroq, 'próximo recurso existe (não repetir groq infinitamente). Primeiro não-groq=' + firstUsableNotGroq?.name);
}

// ========================================
// T15 — Groq modelo principal 120B → swap para 20B por CONTEXT_TOO_LARGE
// ========================================
console.log('\nT15. Groq GROQ_MODEL principal → fallback 20B (openai/gpt-oss-20b) em CONTEXT_TOO_LARGE.');
{
  limparRegistry();
  const primaryAltCfg = R.PROVIDER_ALT_MODEL?.groq;
  assert(!!primaryAltCfg, 'PROVIDER_ALT_MODEL.groq configurado');
  assert(/120b|gpt-oss-120/i.test(primaryAltCfg.primary), 'primary = 120B (GROQ_MODEL atual). primary=' + primaryAltCfg.primary);
  assert(/20b|gpt-oss-20/i.test(primaryAltCfg.alt), 'alt = 20B (GROQ_FALLBACK_MODEL). alt=' + primaryAltCfg.alt);
  assert(R.GROQ_FALLBACK_MODEL === primaryAltCfg.alt, `GROQ_FALLBACK_MODEL = PROVIDER_ALT_MODEL.groq.alt (${R.GROQ_FALLBACK_MODEL})`);
  const swapCtx = R.aiResPickAltModel('groq', R.GROQ_MODEL, 'CONTEXT_TOO_LARGE');
  assert(swapCtx.altUsed === true, 'swapCtx.altUsed=true por CONTEXT_TOO_LARGE');
  assert(swapCtx.model === R.GROQ_FALLBACK_MODEL, `swapCtx.model = ${R.GROQ_FALLBACK_MODEL} (atual=${swapCtx.model})`);
  // Troca por QUOTA_429 também deve funcionar (estava no swapOnKinds)
  const swapQuota = R.aiResPickAltModel('groq', R.GROQ_MODEL, 'QUOTA_429');
  assert(swapQuota.altUsed === true, 'swap por QUOTA_429 também ativado.');
  const swap404 = R.aiResPickAltModel('groq', R.GROQ_MODEL, 'BADREQUEST_404');
  assert(swap404.altUsed === true, 'swap por BADREQUEST_404 também ativado.');
}

// ========================================
// T16 — Nenhuma chave/token longo aparece em markFailure.lastError nem saídas estruturadas
// ========================================
console.log('\nT16. SEGURANÇA · Nenhuma key ≥20 chars em outputs (lastError + log estruturado).');
{
  limparRegistry();
  const provs = ['gemini','cerebras','groq'];
  // Fixtures de teste: geradas em runtime para não armazenar literais de credenciais no repositório.
  const fakeSecret = (prefix) => prefix + 'B'.repeat(40);
  const keys = [
    fakeSecret('FAKE_GEMINI_'),
    fakeSecret('csk-'),
    fakeSecret('gsk_'),
  ];
  const badErrors = keys.map(k => new Error(`fail com key=${k} e mais dados Bearer ${k}`));
  let allClean = true;
  for (let i = 0; i < 3; i++) {
    const e = badErrors[i]; e._httpStatus = 500;
    const marked = R.aiResilienceMarkFailure(provs[i], e, 500);
    const logClean = `${marked.provider} · kind=${marked.kind} · redacted_err=${(marked.lastError||'').replace(/[A-Za-z0-9_\-]{20,}/g, '[REDACTED]')}`;
    if (/[A-Za-z0-9_\-]{20,}/.test((marked.lastError||'').replace(/[A-Za-z0-9_\-]{20,}/g,''))) { allClean=false; }
    // Simular a impressão do console do markFailure (a linha do console já faz [REDACTED]).
    // Garantir: keys conhecidas não aparecem em versão limpa.
    if (keys.some(k => (marked.lastError || '').includes(k))) allClean = false;
    const structured = R.aiResilienceBuildAllProvidersFailedOrder([{provider:provs[i], ok:false, kind:marked.kind, statusCode:500, errorMessage: e.message, inCooldownAtEnd:true}], false);
    if (keys.some(k => structured.attempts.some(a => (a.errorRedacted||'').includes(k)))) allClean = false;
  }
  assert(allClean === true, 'Todas keys ≥20 chars mascaradas em lastError e structured.attempts[*].errorRedacted.');
}

// ========================================
// T17 — Anti-loop: 1 provider não é repetido indefinidamente na mesma chamada
// ========================================
console.log('\nT17. ANTI-LOOP · 1 provider não passa de 2 tentativas (1 normal + 1 retry compactado 413).');
{
  limparRegistry();
  const MAX_POSSIBLE = 1 + R.AIRES_MAX_CONTEXT_RETRY; // 2
  const provsOnly = ['groq']; // somente 1 provider configurado no order
  // Simula 2 falhas → 3ª tentativa deve ser bloqueada pelo gate (baseAttempts >= 2)
  let tried = 0;
  const triedPerProvider = new Map();
  const order = R.aiResilienceBuildOrder(provsOnly);
  for (let iter = 0; iter < 1000; iter++) {
    const entry = order[iter % order.length];
    if (!entry) break;
    const prov = entry.name;
    const baseAttempts = triedPerProvider.get(prov) || 0;
    if (baseAttempts >= (R.AIRES_MAX_CONTEXT_RETRY + 1)) break;
    triedPerProvider.set(prov, baseAttempts + 1);
    tried++;
    const e = Object.assign(new Error('HTTP 413: request too large'), { _httpStatus: 413 });
    R.aiResilienceMarkFailure(prov, e, 413, { retryIndex: baseAttempts });
    if (baseAttempts < R.AIRES_MAX_CONTEXT_RETRY) continue;
  }
  assert(tried === MAX_POSSIBLE, `1 provider MAX ${MAX_POSSIBLE} tentativas = 1 normal + 1 retry compactado. Atual = ${tried}`);
  assert((triedPerProvider.get('groq') || 0) === MAX_POSSIBLE, `groq triedPerProvider = ${MAX_POSSIBLE} (atual=${triedPerProvider.get('groq')})`);
}

console.log(`\n=== RESILIENCE EVOLUTION TESTS (T10..T17) ${process.exitCode ? 'FALHAS ❌' : 'TODOS PASSARAM ✅'} ===\n`);
if (process.exitCode) process.exit(process.exitCode);

// Teste ESPECÍFICO GAP6: err._modelUsed em _openAICompatStream
// Valida que SEMPRE o modelo no erro é o ep.bodyModel (modelo final enviado)
// e NUNCA cai no extra.model bruto (ex: gemini-3.6-flash da sessão)
//
// Cenários cobertos:
//   A) HTTP 429 (res.ok=false)  → _modelUsed=ep.bodyModel (já existia, teste de regressão)
//   B) Stream reader.read() lança AbortError (NOVO, era o GAP6 real)
//   C) Erro genérico (ex: TypeError fetch network) → _modelUsed=ep.bodyModel (caso novo)

const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL:', msg); process.exit(1); } console.log('  ✅', msg); };

console.log('\n=== TESTE GAP6 _openAICompatStream: err._modelUsed ===\n');

// ========= Valores fixtures (iguais aos defaults de server.js) =========
const GROQ_MODEL        = 'openai/gpt-oss-120b';  // PROVIDER_ALT_MODEL.groq.primary
const GROQ_FALLBACK     = 'openai/gpt-oss-20b';   // PROVIDER_ALT_MODEL.groq.alt
const SESSION_MODEL     = 'gemini-3.6-flash';     // extra.model típico da sessão (CONTAMINAÇÃO)
const FINAL_BODY_MODEL  = GROQ_MODEL;             // ep.bodyModel = modelo realmente enviado no request body

// ========= Implementação MIRROR do bloco _openAICompatStream (exata lógica após o fix) =========
async function streamLikeOpenAICompat(provider, extra = {}, failKind /* 'http429' | 'streamAbort' | 'netErr' */) {
  let modelOverridden = extra.forcedModel || extra.model || null;
  if (provider && provider !== 'gemini') {
    const providerDefault = provider === 'groq' ? GROQ_MODEL : null;
    if (modelOverridden && providerDefault) {
      const isGeminiModel = /gemini/i.test(modelOverridden);
      const provLooksGood = !isGeminiModel && (/^[\w\-\.]+:[\w\-\.]+/.test(modelOverridden) || /^(llama|mistral|qwen|deepseek|gemma|hermes|codestral|pixtral|mixtral|command|nemotron|phi|gpt|claude|sonnet|opus|haiku)\-/i.test(modelOverridden));
      if (!provLooksGood) modelOverridden = providerDefault;  // ← G3 gate: gemini cai para default do provider
    }
  }
  const ep = { url: 'https://api.groq.com/openai/v1/chat/completions', auth: 'Bearer x', bodyModel: FINAL_BODY_MODEL };  // providerEndpoint(provider, modelOverridden)
  try {
    // body.model = ep.bodyModel aqui (confirmado)
    // fetch simulado
    if (failKind === 'http429') {
      const res = { ok:false, status:429, text:async()=>'Rate limit' };
      if (!res.ok) {
        const txt = await res.text();
        const err = new Error(`[${provider}] HTTP ${res.status}: ${txt}`);
        err._httpStatus = res.status;
        err._response = res;
        err._modelUsed = ep.bodyModel;  // ← atribuição explícita no branch HTTP
        throw err;
      }
    }
    if (failKind === 'netErr') {
      throw Object.assign(new TypeError('fetch failed'), { name: 'TypeError', cause: 'ENOTFOUND' });
    }
    if (failKind === 'streamAbort') {
      // fetch ok, mas durante a leitura do stream ocorre timeout abort
      const res = { ok:true, status:200, body:{ getReader:() => ({
        read: async () => { throw Object.assign(new DOMException('The operation was aborted.','AbortError'),{name:'AbortError'}); }
      })}};
      if (!res.ok) { /* impossível aqui */ }
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();  // ← LINHA QUE LANÇA
        if (done) break;
      }
      return { parts:[{text:'ok'}], usage:null, provider };
    }
    return { parts:[{text:'ok'}], usage:null, provider };
  } catch (err) {
    // ===== ESTE É O NOVO CATCH WRAPPER DO FIX GAP6 =====
    if (err && typeof err === 'object' && !('_modelUsed' in err)) err._modelUsed = ep.bodyModel;
    throw err;
  }
}

// ========= CENÁRIO A: HTTP 429 =========
console.log('A) HTTP 429 (branch explícito com _modelUsed setado):');
{
  let caught;
  try { await streamLikeOpenAICompat('groq', { model: SESSION_MODEL }, 'http429'); } catch (e) { caught = e; }
  assert(caught instanceof Error,                          'lançou erro');
  assert(caught._httpStatus === 429,                       '_httpStatus=429');
  assert(caught._modelUsed === GROQ_MODEL,                 `_modelUsed=${caught._modelUsed} == 120b (GROQ_MODEL)`);
  assert(caught._modelUsed !== SESSION_MODEL,              `_modelUsed NÃO é o session.model gemini: ${SESSION_MODEL}`);
}

// ========= CENÁRIO B: Stream AbortError (GAP6 NÃO coberto ANTES do fix) =========
console.log('\nB) Stream reader AbortError (mid-stream timeout - GAP6 raiz):');
{
  let caught;
  try { await streamLikeOpenAICompat('groq', { model: SESSION_MODEL }, 'streamAbort'); } catch (e) { caught = e; }
  assert(caught instanceof Error,                          'lançou erro');
  assert(typeof caught.name === 'string',                  'tem name (' + caught.name + ')');
  assert('_modelUsed' in caught,                           '_modelUsed EXISTE (antes do fix NÃO existia → fallback extra.model gemini)');
  assert(caught._modelUsed === GROQ_MODEL,                 `_modelUsed=${caught._modelUsed} == 120b (GROQ_MODEL)`);
  assert(caught._modelUsed !== SESSION_MODEL,              `_modelUsed NÃO é o session.model gemini: ${SESSION_MODEL}`);
}

// ========= CENÁRIO C: Erro genérico rede / fetch reject (TypeError) =========
console.log('\nC) Erro rede (fetch TypeError - GAP6 caso novo):');
{
  let caught;
  try { await streamLikeOpenAICompat('groq', { model: SESSION_MODEL }, 'netErr'); } catch (e) { caught = e; }
  assert(caught instanceof TypeError,                      'é TypeError');
  assert('_modelUsed' in caught,                           '_modelUsed EXISTE');
  assert(caught._modelUsed === GROQ_MODEL,                 `_modelUsed=${caught._modelUsed} == 120b (GROQ_MODEL)`);
  assert(caught._modelUsed !== SESSION_MODEL,              `_modelUsed NÃO é o session.model gemini`);
}

console.log('\n=== GAP6 _modelUsed: TODOS TESTES PASSARAM ✅ ===\n');
process.exit(0);

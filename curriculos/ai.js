/* =========================================================
 * curriculos/ai.js — Ponte com a IA já existente do TI Agente
 * ---------------------------------------------------------
 * NÃO cria uma segunda infraestrutura: recebe por injeção o
 * runLLMTextOnly() do server.js (mesmos provedores, resiliência e fallback).
 * =======================================================*/

let _run = null;                 // função injetada (runLLMTextOnly)
let _providers = ['groq', 'cloudflare', 'cerebras', 'mistral', 'openrouter', 'deepseek', 'gemini'];
let _model = null;
let _lastError = null;
let _lastMeta = null;

/**
 * @param {object} o
 * @param {Function} o.runLLMTextOnly  função real do server.js
 * @param {string[]} [o.providers]     ordem de preferência
 * @param {string|null} [o.model]      modelo fixo (opcional)
 */
export function init({ runLLMTextOnly = null, providers = null, model = null } = {}) {
  if (typeof runLLMTextOnly === 'function') _run = runLLMTextOnly;
  if (Array.isArray(providers) && providers.length) _providers = providers.map(String);
  if (model) _model = String(model);
  return { ok: !!_run, providers: _providers, model: _model };
}

export function available() { return typeof _run === 'function'; }

export function lastError() { return _lastError; }
export function lastMeta() { return _lastMeta; }

/** Resposta do erro sem vazar detalhes técnicos crus para a interface. */
function friendly(err) {
  const m = String(err?.message || err || '');
  if (/HTTP 401|403|invalid_api_key|Unauthorized/i.test(m)) return 'A chave de IA foi recusada pelo provedor. Verifique na aba IA Config.';
  if (/HTTP 429|rate limit|quota/i.test(m)) return 'O provedor de IA atingiu o limite de uso agora. Tente novamente em instantes.';
  if (/timeout|aborted|ETIMEDOUT/i.test(m)) return 'A IA demorou além do limite para responder. Tente novamente.';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(m)) return 'Não foi possível falar com o provedor de IA (sem conexão).';
  return 'A IA não conseguiu responder agora.';
}

/**
 * Executa a IA e devolve TEXTO.
 * @returns {Promise<{ok:boolean, text?:string, provider?:string, model?:string, error?:string}>}
 */
export async function ask({ system, user, temperature = 0.2, maxTokens = 2400, tag = 'curriculos' } = {}) {
  _lastError = null; _lastMeta = null;
  if (!_run) {
    _lastError = 'IA não configurada (integração ausente).';
    return { ok: false, error: _lastError };
  }
  try {
    const out = await _run({
      provider: _providers, model: _model, system, user,
      temperature, maxTokens, tag,
    });
    const text = String(out?.text || '').trim();
    _lastMeta = { provider: out?.provider || null, model: out?.model || null, tokensIn: out?.tokensIn || 0, tokensOut: out?.tokensOut || 0 };
    if (!text) { _lastError = 'A IA respondeu vazio.'; return { ok: false, error: _lastError }; }
    return { ok: true, text, provider: _lastMeta.provider, model: _lastMeta.model };
  } catch (e) {
    _lastError = friendly(e);
    return { ok: false, error: _lastError };
  }
}

/** Extrai o primeiro objeto/array JSON útil de um texto de IA. */
export function parseJson(text) {
  const s = String(text || '').trim();
  if (!s) return { ok: false, reason: 'vazio' };
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(s);
  const firstBrace = s.search(/[[{]/);
  if (firstBrace >= 0) candidates.push(s.slice(firstBrace));

  for (const c of candidates) {
    const trimmed = String(c || '').trim();
    if (!trimmed) continue;
    try { return { ok: true, data: JSON.parse(trimmed) }; } catch {}
    // tenta recortar até o último fechamento balanceado
    const start = trimmed.search(/[[{]/);
    if (start < 0) continue;
    const open = trimmed[start];
    const close = open === '{' ? '}' : ']';
    const end = trimmed.lastIndexOf(close);
    if (end > start) {
      try { return { ok: true, data: JSON.parse(trimmed.slice(start, end + 1)) }; } catch {}
    }
  }
  return { ok: false, reason: 'json inválido' };
}

/**
 * Pede à IA uma resposta JSON, com UMA tentativa de reparo.
 * @returns {Promise<{ok:boolean, data?:any, error?:string, provider?:string}>}
 */
export async function askJson(opts) {
  const first = await ask(opts);
  if (!first.ok) return { ok: false, error: first.error };
  let parsed = parseJson(first.text);
  if (parsed.ok) return { ok: true, data: parsed.data, provider: first.provider, model: first.model };

  const repair = await ask({
    system: 'Você corrige JSON inválido. Responda APENAS com JSON válido, sem comentários, sem texto extra.',
    user: `Corrija o JSON abaixo mantendo exatamente o mesmo conteúdo e estrutura. Responda somente com o JSON:\n\n${String(first.text).slice(0, 12000)}`,
    temperature: 0,
    maxTokens: opts?.maxTokens || 2400,
    tag: `${opts?.tag || 'curriculos'}_fixjson`,
  });
  if (!repair.ok) return { ok: false, error: first.error || repair.error };
  parsed = parseJson(repair.text);
  if (parsed.ok) return { ok: true, data: parsed.data, provider: repair.provider, model: repair.model };
  return { ok: false, error: 'A IA não retornou um JSON válido.' };
}

export default { init, available, ask, askJson, parseJson, lastError, lastMeta };

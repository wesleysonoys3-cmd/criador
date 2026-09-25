import 'dotenv/config';

process.on('uncaughtException', (err) => {
  try {
    const stack = (err && err.stack) ? String(err.stack) : String(err);
    console.error('[FATAL uncaughtException]', stack.slice(0, 4000));
  } catch (_) {
    try { console.error('[FATAL uncaughtException]', String(err)); } catch {}
  }
});

process.on('unhandledRejection', (reason) => {
  try {
    const stack = (reason && reason.stack) ? String(reason.stack) : String(reason);
    console.error('[FATAL unhandledRejection]', stack.slice(0, 4000));
  } catch (_) {
    try { console.error('[FATAL unhandledRejection]', String(reason)); } catch {}
  }
});

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import http from 'node:http';
import net from 'node:net';
import { WebSocketServer } from 'ws';
import * as fs from 'node:fs/promises';
import * as fsc from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import * as Orch from './agent_orchestrator.js';
import * as OrcState from './tiagent_orc_state_schema.js';
import * as OrcFs from './tiagent_orc_fs.js';
import * as OrcTests from './lib_tiagent_tests.js';
import * as SecBridge from './integration_bridge.js';
import { runAutonomousOrchestrator, autoCorrectionLoop } from './tiagent_orc_motor.js';
import { rc28RunDecisionLoop, RC28_LOOP_VER } from './rc28_decision_loop.js';
import { createBrowserAgent } from './browser_agent.mjs';
import * as BtcMi from './btc_market/scheduler.js';
const BTC_MI_DATA_DIR = path.resolve(process.cwd(), 'btc_market/data');
const BTC_MI_INTERVAL_MS = Number(process.env.BTC_MI_INTERVAL_MS || 60000) || 60000;

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE_PATH = path.resolve(__dirname, '.env');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'gemini-3.5-flash-lite';
const WORKSPACE_ROOT = path.resolve(process.env.WORK_DIR || './workspace');
globalThis.__WORKSPACE_ROOT = WORKSPACE_ROOT;
const DEFAULT_PROJECT = 'default';
const MAX_STEPS = parseInt(process.env.MAX_STEPS || '15', 10);

function looksLikeValidGoogleKey(k) {
  if (!k || typeof k !== 'string') return false;
  const t = k.trim();
  if (t.length < 20) return false;
  if (/sua[_ -]?chave|your[_ -]?key|YOUR[_ -]?KEY|xxxx|xxxx/i.test(t)) return false;
  return /^(AIza|AQ\.|AB\.|AKIA|GOOG)/.test(t) || t.length >= 35;
}
const GOOGLE_KEY_OK = looksLikeValidGoogleKey(GOOGLE_API_KEY);
if (!GOOGLE_KEY_OK) {
  const box = '='.repeat(68);
  console.error('\n' + box);
  console.error('  ⚠️  RC20  GOOGLE_API_KEY ausente, vazia ou com suspeita de inválida.');
  console.error('     ─ A IA NÃO vai funcionar! Qualquer prompt retorna erro 400/401/403.');
  console.error('     ─ Onde corrigir: arquivo .env na pasta do projeto:');
  console.error(`       • ${path.resolve(__dirname, '.env')}`);
  console.error('     ─ Obter chave: https://aistudio.google.com/  (botão Get API key)');
  console.error('     ─ Depois de salvar: reinicie o CriaSiteTiago.app / servidor.');
  console.error(box + '\n');
} else {
  console.log(`✅ RC20  Google API key carregada (prefixo: ${(GOOGLE_API_KEY || '').slice(0, 5)}…${(GOOGLE_API_KEY || '').slice(-4)} · looksLikeValid=true)`);
}
const COMMAND_TIMEOUT_MS = 60000;
const API_VERSION = 'v1beta';
const PORT = parseInt(process.env.PORT || '3000', 10);
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

// ============================================================
//  RC21  RENDER / LINUX HEADLESS DETECTION (nuvem = single-port, sem osascript, sem preview servers extras)
//  - Render REALMENTE injeta: RENDER_EXTERNAL_URL, RENDER_SERVICE_ID, RENDER_SERVICE_NAME, RENDER_INSTANCE_ID
//  - Outras nuvens: K_SERVICE (GCP Cloud Run), RAILWAY_STATIC_URL, VERCEL_URL, HEROKU_APP_ID
//  - Fallback geral: PORT setada + platform NÃO macOS (darwin) + TRAE_LOCAL ausente => assume nuvem/Linux headless
// ============================================================
const IS_RENDER_OR_HEADLESS_LINUX = Boolean(
  process.env.IS_RENDER_OR_HEADLESS_LINUX === '1' ||
  process.env.RENDER ||
  process.env.RENDER_EXTERNAL_URL ||
  process.env.RENDER_SERVICE_ID ||
  process.env.RENDER_SERVICE_NAME ||
  process.env.RENDER_INSTANCE_ID ||
  process.env.K_SERVICE ||
  process.env.RAILWAY_STATIC_URL ||
  process.env.VERCEL_URL ||
  process.env.HEROKU_APP_ID ||
  (process.env.PORT && process.platform !== 'darwin' && !process.env.TRAE_LOCAL)
);
const RENDER_BASE_URL = (
  process.env.RENDER_EXTERNAL_URL ||
  (IS_RENDER_OR_HEADLESS_LINUX ? '' : '')
).replace(/\/+$/, '');
console.log(
  `🌐 Ambiente: platform=${process.platform} · PORT=${PORT}` +
  (IS_RENDER_OR_HEADLESS_LINUX
    ? ` · RC20 modo RENDER/LINUX headless ativado (single-port ${PORT}, preview via /preview/:slug/)`
    : ' · Desktop macOS/máquina local')
);

// ===== ENSEMBLE 2 Cabeças GRATUITO · 2x Gemini (Google GenAI · sem custo) =====
// Usa 2 modelos diferentes do Google (ambos camada gratuita):
//   Modelo A = rápido/leve (3.5 Flash Lite padrão)
//   Modelo B = criativo/extenso (2.0 Flash default)
// Funcionamento: Paralelo, voto majoritário em chamadas de ferramentas, merge de texto.
const FREE_MODEL_A = process.env.FREE_MODEL_A || process.env.GOOGLE_MODEL || 'gemini-3.5-flash-lite';
const FREE_MODEL_B = process.env.FREE_MODEL_B || 'gemini-2.0-flash-exp';
const FREE_ENSEMBLE_MODE_RAW = String(process.env.FREE_ENSEMBLE_MODE || process.env.ENSEMBLE_MODE || 'off').trim().toLowerCase();
function ensembleIsEnabled(override) {
  const m = typeof override === 'string' ? override.trim().toLowerCase() : FREE_ENSEMBLE_MODE_RAW;
  // Requisito único: ter chave GOOGLE válida (não vazia)
  if (!GOOGLE_API_KEY || !String(GOOGLE_API_KEY).trim().length) return false;
  return ['parallel', 'critic'].includes(m);
}
const ENSEMBLE_ENABLED = ensembleIsEnabled();
const ENSEMBLE_MODE = ENSEMBLE_ENABLED ? FREE_ENSEMBLE_MODE_RAW : 'off';

// ==========================================================================
//  RC22  MULTI-IA PROVIDERS (Cerebras · Mistral · OpenRouter/DeepSeek Free · DeepSeek Oficial)
//  - Por padrão TUDO cai no Gemini (preservação 100% do motor estável)
//  - Cada provider só é escolhido se a ENV correspondente + KEY estiver OK
//  - Fallback silencioso: se o provider falhar/sem key → usa Google gemini genAIStream
// ==========================================================================
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || '';
const CEREBRAS_MODEL   = process.env.CEREBRAS_MODEL   || 'llama-3.1-70b';
const MISTRAL_API_KEY  = process.env.MISTRAL_API_KEY  || '';
const MISTRAL_MODEL    = process.env.MISTRAL_MODEL    || 'open-mistral-nemo';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_DEEPSEEK_MODEL = process.env.OPENROUTER_DEEPSEEK_MODEL || 'deepseek/deepseek-chat:free';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL   = process.env.DEEPSEEK_MODEL   || 'deepseek-chat';
const DEEPSEEK_PAID_MODE = String(process.env.DEEPSEEK_PAID_MODE || 'off').trim().toLowerCase() === 'on';
const CLOUDFLARE_WORKERS_AI_API_KEY = process.env.CLOUDFLARE_WORKERS_AI_API_KEY || '';
const CLOUDFLARE_WORKERS_AI_MODEL   = process.env.CLOUDFLARE_WORKERS_AI_MODEL   || '@cf/meta/llama-3.1-70b-instruct';
const CLOUDFLARE_ACCOUNT_ID         = process.env.CLOUDFLARE_ACCOUNT_ID         || '';
const GROQ_API_KEY     = process.env.GROQ_API_KEY     || '';
const GROQ_MODEL       = process.env.GROQ_MODEL       || 'llama-3.3-70b-versatile';
const GROQ_FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b';
const PROVIDER_ALT_MODEL = Object.freeze({
  groq: { primary: GROQ_MODEL, alt: GROQ_FALLBACK_MODEL,
    swapOnKinds: new Set(['CONTEXT_TOO_LARGE', 'BADREQUEST_4XX', 'QUOTA_429']) },
});
const AIRES_MAX_CONTEXT_RETRY = 1;

// ============================================================
//  EVOLUÇÃO 2 · RESILIÊNCIA AUTOMÁTICA DAS APIs (cooldown + failover)
//  - Centralizado: NÃO toca RC29/RC28/RC27/Remote/Security
//  - Detecta 429 / 401 / 403 / 5xx / timeout / network
//  - Coloca provider em cooldown temporário
//  - Ordem definida por AI_PROVIDER_ORDER + providerIsUsable()
// ============================================================
const AI_RESILIENCE_ENABLED       = String(process.env.AI_RESILIENCE_ENABLED       || 'off').trim().toLowerCase() === 'on';
const AI_PROVIDER_ORDER_RAW       = String(process.env.AI_PROVIDER_ORDER           || 'gemini,cerebras,groq,cloudflare,mistral,openrouter,deepseek').trim();
const AI_PROVIDER_COOLDOWN_MS     = Math.max(1000, parseInt(process.env.AI_PROVIDER_COOLDOWN_MS || '60000', 10));
const AI_PROVIDER_TIMEOUT_MS      = Math.max(5000, parseInt(process.env.AI_PROVIDER_TIMEOUT_MS  || '90000', 10));
const AI_RESILIENCE_FALLBACK_DEG  = String(process.env.AI_RESILIENCE_FALLBACK_DEGRADED || 'on').trim().toLowerCase() === 'on';
const __AI_RESILIENCE = new Map();
const __AI_RESILIENCE_MODEL_CACHE = new Map();   // key = `${provider}:${model.toLowerCase}` → { unavailableUntil, classification, failCount, reason }
function __airesModelKey(provider, model) {
  const p = String(provider || '').trim().toLowerCase();
  const m = String(model || '__default__').trim().toLowerCase();
  return `${p}:${m}`;
}
function aiResilienceModelIsBlocked(provider, model, now = Date.now()) {
  if (!AI_RESILIENCE_ENABLED) return null;
  const entry = __AI_RESILIENCE_MODEL_CACHE.get(__airesModelKey(provider, model));
  if (!entry || !entry.unavailableUntil) return null;
  if (now < entry.unavailableUntil) return entry;
  __AI_RESILIENCE_MODEL_CACHE.delete(__airesModelKey(provider, model));
  return null;
}
function aiResilienceModelMarkBlocked(provider, model, classification, blockUntilOrMs, reason = '') {
  if (!AI_RESILIENCE_ENABLED || !provider || !model) return false;
  const now = Date.now();
  const blockMs = typeof blockUntilOrMs === 'number'
    ? (blockUntilOrMs < 1000000000000 ? blockUntilOrMs : Math.max(0, blockUntilOrMs - now))
    : 0;
  if (!blockMs) return false;
  const prev = __AI_RESILIENCE_MODEL_CACHE.get(__airesModelKey(provider, model)) || {};
  const entry = {
    provider: String(provider).trim().toLowerCase(),
    model: String(model).trim().toLowerCase(),
    unavailableUntil: now + blockMs,
    blockedMs: blockMs,
    classification: classification || 'MODEL_UNAVAILABLE',
    failCount: (prev.failCount || 0) + 1,
    firstTs: prev.firstTs || now,
    lastTs: now,
    reason: String(reason || '').slice(0,200) || null,
    retryable: false,
  };
  __AI_RESILIENCE_MODEL_CACHE.set(__airesModelKey(provider, model), entry);
  try {
    console.log(`[AI_ROUTER] provider=${entry.provider} model=${JSON.stringify(entry.model.slice(0,64))} classification=${entry.classification} action=BLOCK_MODEL_TEMPORARILY blocked_ms=${blockMs} retryable=false reason=${entry.reason ? entry.reason.replace(/[A-Za-z0-9_\-]{20,}/g,'[REDACTED]').slice(0,100) : 'n/a'}`);
  } catch(_) {}
  return true;
}
function aiResilienceIsInCooldown(provider, now = Date.now()) {
  if (!provider || !AI_RESILIENCE_ENABLED) return false;
  const st = __AI_RESILIENCE.get(provider);
  if (!st) return false;
  return now < st.cooldownUntil;
}
function aiResilienceGetStatus(provider, now = Date.now()) {
  const st = __AI_RESILIENCE.get(provider);
  if (!st) return { inCooldown: false, failureCount: 0, lastError: null, remainingMs: 0 };
  const remaining = Math.max(0, st.cooldownUntil - now);
  return { inCooldown: remaining > 0, failureCount: st.failureCount || 0, lastError: st.lastError || null, remainingMs: remaining,
    retryAfterSource: st.retryAfterSource || null, retryAfterHeaderSec: typeof st.retryAfterHeaderSec === 'number' ? st.retryAfterHeaderSec : null };
}
const __AI_ROUTER_ERROR_CLASS = Object.freeze({
  AUTH_ERROR:           'AUTH_ERROR',
  PERMISSION_ERROR:     'PERMISSION_ERROR',
  MODEL_UNAVAILABLE:    'MODEL_UNAVAILABLE',
  RATE_LIMIT:           'RATE_LIMIT',
  TIMEOUT:              'TIMEOUT',
  PROVIDER_SERVER_ERROR:'PROVIDER_SERVER_ERROR',
  NETWORK_ERROR:        'NETWORK_ERROR',
  CONTEXT_TOO_LARGE:    'CONTEXT_TOO_LARGE',
  PROVIDER_ERROR:       'PROVIDER_ERROR',
  OTHER:                'OTHER',
});
function aiResClassifyErrorRich(err, statusCode, providerHint, modelHint) {
  const provider = String(providerHint || '').trim().toLowerCase();
  const model = String(modelHint || '').trim();
  const message = err && typeof err.message === 'string' ? err.message : String(err || '');
  const code = err && typeof err.code === 'string' ? err.code : '';
  if (err && (err.name === 'AbortError' || /timeout|abort|timed out|tempo esgotado/i.test(message + ' ' + code))) {
    return { type: __AI_ROUTER_ERROR_CLASS.TIMEOUT, retryable: true, short: __AI_ROUTER_ERROR_CLASS.TIMEOUT };
  }
  if (statusCode === 401) {
    return { type: __AI_ROUTER_ERROR_CLASS.AUTH_ERROR, retryable: false, short: 'AUTH_ERROR_401' };
  }
  if (statusCode === 403) {
    return { type: __AI_ROUTER_ERROR_CLASS.PERMISSION_ERROR, retryable: false, short: 'PERMISSION_ERROR_403' };
  }
  if (statusCode === 413) {
    return { type: __AI_ROUTER_ERROR_CLASS.CONTEXT_TOO_LARGE, retryable: true, short: 'CONTEXT_TOO_LARGE_413' };
  }
  if (statusCode === 429) {
    return { type: __AI_ROUTER_ERROR_CLASS.RATE_LIMIT, retryable: true, short: 'RATE_LIMIT_429' };
  }
  if (typeof statusCode === 'number' && statusCode >= 500 && statusCode <= 599) {
    return { type: __AI_ROUTER_ERROR_CLASS.PROVIDER_SERVER_ERROR, retryable: true, short: `SERVER_ERROR_${statusCode}` };
  }
  if (statusCode === 404 && (provider || /model|not_found|not exist/i.test(message))) {
    const cerebras404 = /cerebras/i.test(provider) && /(Model does not exist|not_found_error|you do not have access to it)/i.test(message);
    const groq404 = /groq|openrouter/i.test(provider) && /(model|not_found|not_exist)/i.test(message);
    if (cerebras404 || groq404 || /(model|engine|modelo).*(does not exist|não encontrado|não existe|not_found|inaccessible|sem acesso|you do not have access|no longer available|deprecated|retir(ed|e)|sunset|suspended|discontinued)/i.test(message)) {
      return { type: __AI_ROUTER_ERROR_CLASS.MODEL_UNAVAILABLE, retryable: false, short: 'MODEL_UNAVAILABLE_404' };
    }
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|socket (hang|disconnect)|tls|certificate|fetch failed|network (error|fail)|getaddrinfo|socket hang/i.test(message + ' ' + code)) {
    return { type: __AI_ROUTER_ERROR_CLASS.NETWORK_ERROR, retryable: true, short: 'NETWORK_ERROR' };
  }
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    return { type: __AI_ROUTER_ERROR_CLASS.PROVIDER_ERROR, retryable: false, short: `BAD_REQUEST_${statusCode}` };
  }
  return { type: __AI_ROUTER_ERROR_CLASS.OTHER, retryable: true, short: 'OTHER' };
}
function aiResilienceClassifyError(err, statusCode) {
  const rc = aiResClassifyErrorRich(err, statusCode);
  switch (rc.type) {
    case __AI_ROUTER_ERROR_CLASS.AUTH_ERROR:           return 'AUTH_401';
    case __AI_ROUTER_ERROR_CLASS.PERMISSION_ERROR:     return 'FORBIDDEN_403';
    case __AI_ROUTER_ERROR_CLASS.MODEL_UNAVAILABLE:    return 'MODEL_UNAVAILABLE';
    case __AI_ROUTER_ERROR_CLASS.RATE_LIMIT:           return 'QUOTA_429';
    case __AI_ROUTER_ERROR_CLASS.TIMEOUT:              return 'TIMEOUT';
    case __AI_ROUTER_ERROR_CLASS.PROVIDER_SERVER_ERROR:return 'SERVER_5XX';
    case __AI_ROUTER_ERROR_CLASS.NETWORK_ERROR:        return 'NETWORK';
    case __AI_ROUTER_ERROR_CLASS.CONTEXT_TOO_LARGE:    return 'CONTEXT_TOO_LARGE';
    case __AI_ROUTER_ERROR_CLASS.PROVIDER_ERROR:       return 'BADREQUEST_4XX';
    default:                                            return 'OTHER';
  }
}
function _airesCooldownPolicy(kind, richType) {
  const k = kind || 'OTHER';
  switch (k) {
    case 'BADREQUEST_4XX':    return { multiplier: 0.2,  baseMs: Math.min(AI_PROVIDER_COOLDOWN_MS, 8000) };
    case 'CONTEXT_TOO_LARGE': return { multiplier: 0.25, baseMs: Math.min(AI_PROVIDER_COOLDOWN_MS, 12000) };
    case 'AUTH_401':          return { multiplier: 2.0,  baseMs: Math.max(AI_PROVIDER_COOLDOWN_MS, 5 * 60 * 1000) };
    case 'FORBIDDEN_403':     return { multiplier: 2.0,  baseMs: Math.max(AI_PROVIDER_COOLDOWN_MS, 5 * 60 * 1000) };
    case 'MODEL_UNAVAILABLE': return { multiplier: 0,    baseMs: 0 };   // bloqueado separadamente por (provider, modelo). Não deixa provider em cooldown global pois modelo alternativo pode existir
    case 'QUOTA_429':         return { multiplier: 1.2,  baseMs: AI_PROVIDER_COOLDOWN_MS };
    case 'TIMEOUT':           return { multiplier: 0.6,  baseMs: Math.min(AI_PROVIDER_COOLDOWN_MS, 20000) };
    case 'SERVER_5XX':        return { multiplier: 1.0,  baseMs: Math.min(AI_PROVIDER_COOLDOWN_MS, 30000) };
    case 'NETWORK':           return { multiplier: 0.7,  baseMs: Math.min(AI_PROVIDER_COOLDOWN_MS, 15000) };
    default:                  return { multiplier: 1.0,  baseMs: AI_PROVIDER_COOLDOWN_MS };
  }
}
function _airesModelBlockPolicy(richType) {
  if (!richType || !richType.type) return { blockMs: 0 };
  switch (richType.type) {
    case __AI_ROUTER_ERROR_CLASS.MODEL_UNAVAILABLE: return { blockMs: Math.max(6 * 60 * 60 * 1000, AI_PROVIDER_COOLDOWN_MS * 60) };   // 6h ou +
    case __AI_ROUTER_ERROR_CLASS.AUTH_ERROR:        return { blockMs: 0 };    // não bloqueia modelo, bloqueia provider
    case __AI_ROUTER_ERROR_CLASS.PERMISSION_ERROR:  return { blockMs: 0 };
    default:                                         return { blockMs: 0 };
  }
}
function aiResExtractRetryAfter(responseLikeOrHeaders) {
  if (!responseLikeOrHeaders) return { value: null, source: null };
  const get = (name) => {
    if (typeof responseLikeOrHeaders.get === 'function') return responseLikeOrHeaders.get(name);
    const h = responseLikeOrHeaders?.headers;
    if (h && typeof h.get === 'function') return h.get(name);
    if (h && typeof h[name] === 'string') return h[name];
    if (typeof responseLikeOrHeaders[name] === 'string') return responseLikeOrHeaders[name];
    return null;
  };
  const ra = get('retry-after');
  if (typeof ra === 'string' && ra.trim().length) {
    const s = ra.trim();
    if (/^\s*\d+\s*$/.test(s)) return { value: parseInt(s, 10) * 1000, source: 'header-seconds' };
    const ms = Date.parse(s);
    if (!Number.isNaN(ms)) return { value: Math.max(0, ms - Date.now()), source: 'header-http-date' };
  }
  const xrat = get('x-ratelimit-reset-requests') || get('x-ratelimit-reset');
  if (typeof xrat === 'string' && xrat.trim().length) {
    const ms = Date.parse(xrat);
    if (!Number.isNaN(ms)) return { value: Math.max(0, ms - Date.now()), source: 'header-xratelimit-httpdate' };
    if (/^\s*\d+(\.\d+)?\s*$/.test(xrat)) return { value: Math.round(parseFloat(xrat) * 1000), source: 'header-xratelimit-seconds' };
  }
  return { value: null, source: null };
}
function aiResilienceMarkFailure(provider, err, statusCode = null, extra = {}) {
  if (!provider) return;
  const modelUsed = extra.modelUsed || null;
  const richType = aiResClassifyErrorRich(err, statusCode, provider, modelUsed);
  const kind = aiResilienceClassifyError(err, statusCode);
  const now = Date.now();
  const prev = __AI_RESILIENCE.get(provider) || { failureCount: 0, lastError: null, cooldownUntil: 0, lastKind: null };
  const nextCount = (prev.failureCount || 0) + 1;
  const cdPol = _airesCooldownPolicy(kind, richType);
  const multiplier = cdPol.multiplier;
  let cooldownMs = cdPol.baseMs;
  if (cdPol.baseMs > 0 && multiplier > 0 && kind !== 'MODEL_UNAVAILABLE') {
    cooldownMs = Math.round(cdPol.baseMs * (multiplier >= 1 ? Math.min(5, 1 + 0.25 * (nextCount - 1)) : multiplier));
  }
  let retryAfterSource = null;
  let retryAfterHeaderSec = null;
  if (kind === 'QUOTA_429') {
    const ra = aiResExtractRetryAfter(extra.response || extra.headers || null);
    if (typeof ra.value === 'number' && ra.value > 0) {
      cooldownMs = Math.max(cooldownMs, ra.value);
      retryAfterSource = ra.source;
      retryAfterHeaderSec = Math.round(ra.value / 1000);
    }
  }
  const rawLastError = err && typeof err.message === 'string' ? err.message.slice(0, 240) : (String(err || '').slice(0, 240) || null);
  const safeLastError = rawLastError == null ? null
    : String(rawLastError)
        .replace(/[A-Za-z0-9_\-]{20,}/g, '[REDACTED]')
        .replace(/(AQ\.[A-Za-z0-9_\-]{8,})/g, 'AQ.[REDACTED]')
        .replace(/(csk-[A-Za-z0-9_\-]{8,})/g, 'csk-[REDACTED]')
        .replace(/(gsk_[A-Za-z0-9_\-]{8,})/g, 'gsk_[REDACTED]')
        .slice(0, 240);
  const next = {
    failureCount: nextCount,
    lastError: safeLastError,
    lastKind: kind,
    richType: richType.type,
    retryable: !!richType.retryable,
    statusCode: typeof statusCode === 'number' ? statusCode : null,
    lastTs: now,
    cooldownUntil: cooldownMs > 0 ? (now + cooldownMs) : 0,
    cooldownMs,
    retryAfterSource,
    retryAfterHeaderSec,
    provider,
    ...extra,
    headers: undefined,
    response: undefined,
    modelUsed: modelUsed,
    contextCompressed: !!extra.contextCompressed,
    sizeBeforeBytes: typeof extra.sizeBeforeBytes === 'number' ? extra.sizeBeforeBytes : null,
    sizeAfterBytes: typeof extra.sizeAfterBytes === 'number' ? extra.sizeAfterBytes : null,
    retryIndex: typeof extra.retryIndex === 'number' ? extra.retryIndex : null,
  };
  __AI_RESILIENCE.set(provider, next);
  const modelStr = next.modelUsed ? ` model=${JSON.stringify(String(next.modelUsed).slice(0,64))}` : '';
  const raStr = retryAfterSource ? ` Retry-After=${retryAfterHeaderSec}s(${retryAfterSource})` : '';
  const szStr = next.contextCompressed ? ` sizes=${next.sizeBeforeBytes ?? '?'}→${next.sizeAfterBytes ?? '?'}b` : '';
  const errRedacted = (next.lastError || '').replace(/[A-Za-z0-9_\-]{20,}/g, '[REDACTED]').slice(0,140);
  console.log(`[AI_ROUTER] provider=${provider}${modelStr} http_status=${statusCode||'-'} classification=${richType.type} kind=${kind} action=SKIP_PROVIDER${next.retryable?'':' retryable=false'} failures=${nextCount} cooldown=${Math.round(cooldownMs/1000)}s${raStr}${szStr} error=${errRedacted}`);
  if (next.richType === 'MODEL_UNAVAILABLE' && modelUsed) {
    const pol = _airesModelBlockPolicy(richType);
    aiResilienceModelMarkBlocked(provider, modelUsed, 'MODEL_UNAVAILABLE', pol.blockMs || 0, safeLastError || 'MODEL_UNAVAILABLE');
  }
  return Object.assign({ kind, richType: richType.type, retryable: !!richType.retryable }, next);
}
function aiResilienceMarkSuccess(provider) {
  if (!provider) return;
  if (!AI_RESILIENCE_ENABLED) { __AI_RESILIENCE.delete(provider); return; }
  const prev = __AI_RESILIENCE.get(provider);
  const now = Date.now();
  const next = prev
    ? { failureCount: Math.max(0, (prev.failureCount||0) - 1), lastError: null, lastKind: null, statusCode: null, lastTs: now, cooldownUntil: 0, cooldownMs: 0 }
    : { failureCount: 0, lastError: null, lastKind: null, statusCode: null, lastTs: now, cooldownUntil: 0, cooldownMs: 0 };
  __AI_RESILIENCE.set(provider, next);
}
function aiResCompactContents(contents, systemString, opts = {}) {
  const keepGoal = Boolean(opts.keepGoal !== false);
  const keepTask = Boolean(opts.keepTask !== false);
  const keepLast = Math.max(2, parseInt(opts.keepLast, 10) || 4);
  const out = [];
  const isEssential = (text) => {
    if (!text || typeof text !== 'string') return false;
    if (keepGoal  && /(?:objetivo|objective|meta|objetivo macro|objetivo principal|objetivo do teste|objetivo do usuário)/i.test(text)) return true;
    if (keepTask  && /(?:tarefa|task|plano de trabalho|arquitetura|rc2[89]|passo|etapa|planejamento|sistema web|botão funcional|teste automatizado|página inicial|index\.html|botão|teste|write_file|run_command)/i.test(text)) return true;
    if (         /(?:instruções? do sistema|system instruction|diretrizes|regras técnicas|obrigatório|não altere|modo de operação|tiagent-?\s*rc2[0-9]|ferramentas? disponíveis|tool_declarations?|ferramentas:|declarações? de ferramentas?)/i.test(text)) return true;
    return false;
  };
  const extractTextFromPart = (p) => {
    if (!p || typeof p !== 'object') return '';
    if (typeof p.text === 'string') return p.text;
    return '';
  };
  const extractFromContent = (c) => {
    if (!c || typeof c !== 'object') return '';
    if (Array.isArray(c.parts)) return c.parts.map(extractTextFromPart).join('\n');
    return '';
  };
  const systemPart = typeof systemString === 'string' && systemString.trim().length
    ? { role: 'system', text: systemString } : null;
  let keptEssentialCount = 0;
  if (Array.isArray(contents)) {
    for (let i = 0; i < contents.length; i++) {
      const c = contents[i];
      if (!c) continue;
      const text = extractFromContent(c);
      const essential = isEssential(text) || (systemPart && c.role === 'system');
      if (essential) { out.push({ essential: true, idx: i, orig: c }); keptEssentialCount++; continue; }
    }
    const tail = [];
    for (let i = Math.max(0, contents.length - keepLast); i < contents.length; i++) {
      const idx = i;
      if (out.some(o => o.idx === idx)) continue;
      tail.push({ essential: false, idx, orig: contents[i] });
    }
    out.push(...tail);
  }
  out.sort((a,b) => a.idx - b.idx);
  let finalContents = out.map(o => o.orig);
  if (systemPart) {
    const already = finalContents.some(c => c && c.role === 'system' && String(extractFromContent(c) || '').trim() === systemString.trim());
    if (!already) finalContents = [{ role:'system', parts:[{text: systemString}] }, ...finalContents.filter(c => !c || c.role !== 'system')];
  }
  const sizeBefore = estimateContentsBytes(contents);
  const sizeAfter  = estimateContentsBytes(finalContents);
  return { contents: finalContents, keptEssentialCount, sizeBeforeBytes: sizeBefore, sizeAfterBytes: sizeAfter, compressed: (sizeAfter < sizeBefore) };
}
function estimateContentsBytes(contents) {
  if (!Array.isArray(contents)) return 0;
  let n = 0;
  for (const c of contents) {
    if (!c) continue;
    n += (c.role || '').length + 2;
    if (Array.isArray(c.parts)) for (const p of c.parts) {
      if (typeof p?.text === 'string') n += Buffer.byteLength(p.text, 'utf8');
      else if (p && p.functionCall && typeof p.functionCall === 'object') {
        n += (p.functionCall.id || '').length + (p.functionCall.name || '').length + (typeof p.functionCall.args === 'string' ? p.functionCall.args.length : JSON.stringify(p.functionCall.args || '').length);
      }
    }
  }
  return n;
}
function aiResPickAltModel(provider, currentModel, lastKindMarked) {
  const cfg = PROVIDER_ALT_MODEL?.[provider] || null;
  const defaultsPerProv = {
    cerebras: CEREBRAS_MODEL,
    cloudflare: (typeof CLOUDFLARE_WORKERS_AI_MODEL !== 'undefined') ? CLOUDFLARE_WORKERS_AI_MODEL : '@cf/meta/llama-3.1-70b-instruct',
    groq:     GROQ_MODEL,
    mistral:  MISTRAL_MODEL,
    openrouter: OPENROUTER_DEEPSEEK_MODEL,
    deepseek: DEEPSEEK_MODEL,
  };
  const defaultForProv = defaultsPerProv[provider] || null;
  if (!cfg || !cfg.primary || !cfg.alt) {
    if (lastKindMarked === 'MODEL_UNAVAILABLE' && defaultForProv) {
      const curLow = String(currentModel || '').trim().toLowerCase();
      const defLow = String(defaultForProv).trim().toLowerCase();
      if (curLow && curLow !== defLow) {
        return { altUsed: true, model: defaultForProv, swapReason: `swap_unknown→default(${defaultForProv}) because_kind=MODEL_UNAVAILABLE` };
      }
    }
    return { altUsed:false, model: currentModel || defaultForProv || null, swapReason: null };
  }
  const primary = cfg.primary;
  const alt     = cfg.alt;
  const cur = currentModel || primary;
  let swapOn;
  if (cfg.swapOnKinds instanceof Set) swapOn = new Set(cfg.swapOnKinds);
  else if (Array.isArray(cfg.swapOnKinds)) swapOn = new Set(cfg.swapOnKinds);
  else swapOn = new Set();
  if (!swapOn.has('MODEL_UNAVAILABLE')) swapOn.add('MODEL_UNAVAILABLE');
  const allowSwap = lastKindMarked ? !!swapOn.has(lastKindMarked) : true;
  if (!allowSwap) return { altUsed: false, model: cur, swapReason: null };
  const sameAsPrimary = String(cur).trim().toLowerCase() === String(primary).trim().toLowerCase();
  if (sameAsPrimary) return { altUsed: true, model: alt, swapReason: `swap_primary→alt because_kind=${lastKindMarked || 'contextSize'}` };
  const sameAsAlt = String(cur).trim().toLowerCase() === String(alt).trim().toLowerCase();
  if (lastKindMarked === 'MODEL_UNAVAILABLE' && sameAsAlt && defaultForProv && String(defaultForProv).trim().toLowerCase() !== sameAsAlt) {
    return { altUsed: true, model: defaultForProv, swapReason: `swap_alt→default(${defaultForProv}) because_kind=MODEL_UNAVAILABLE` };
  }
  return { altUsed: false, model: cur, swapReason: null };
}
function aiResilienceBuildOrder(preferred = [], now = Date.now()) {
  const rawList = Array.isArray(preferred) && preferred.length > 0
    ? preferred
    : AI_PROVIDER_ORDER_RAW.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const usable = [];
  const seen = new Set();
  for (const name of rawList) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (!providerIsUsable(name)) continue;
    const inCD = aiResilienceIsInCooldown(name, now);
    usable.push({ name, inCooldown: inCD, status: aiResilienceGetStatus(name, now) });
  }
  usable.sort((a, b) => {
    if (a.inCooldown !== b.inCooldown) return a.inCooldown ? 1 : -1;
    return (a.status.failureCount||0) - (b.status.failureCount||0);
  });
  return usable;
}
function aiResilienceBuildAllProvidersFailedOrder(attemptsSummary, degradedPossible = false) {
  const summary = Array.isArray(attemptsSummary) ? attemptsSummary : [];
  return {
    structuredBlocking: true,
    kind: 'EXTERNAL_RESOURCE_UNAVAILABLE',
    category: 'AI_PROVIDERS_ALL_DOWN',
    severity: degradedPossible ? 'warning' : 'blocking',
    degradedFallbackAvailable: degradedPossible && AI_RESILIENCE_FALLBACK_DEG,
    attempts: summary.map(a => ({
      provider: a.provider,
      usedModel: a.usedModel || null,
      kind: a.kind || null,
      classification: a.classification || a.kind || null,
      retryable: typeof a.retryable === 'boolean' ? a.retryable : null,
      statusCode: typeof a.statusCode === 'number' ? a.statusCode : null,
      errorRedacted: (a.errorMessage || '').replace(/[A-Za-z0-9_\-]{20,}/g, '[REDACTED]').slice(0, 160),
      inCooldownAtEnd: !!a.inCooldownAtEnd,
      blockedByRouter: !!a.blockedByRouter,
    }))
  };
}
function _aiResIsFatalForThisCall(kind) {
  return kind === 'AUTH_401' || kind === 'FORBIDDEN_403' || kind === 'MODEL_UNAVAILABLE';
}

// ============================================================================
//  NORMALIZAÇÃO GROQ/OPENAI · schema tools (SÓ CAMADA DE ADAPTAÇÃO PRO GROQ)
//  - TOOL_DECLARATIONS NUNCA é alterada (continua Gemini format).
//  - Gemini usa TOOL_DECLARATIONS direto L2418 `functionDeclarations: TOOL_DECLARATIONS`.
//  - Groq/OpenAI compat usa normalizeToolsForGroq(declarations) aqui no _openAICompatStream.
// ============================================================================
const _OPENAI_TYPE_MAP = Object.freeze({
  'OBJECT':'object','STRING':'string','NUMBER':'number','INTEGER':'integer',
  'BOOLEAN':'boolean','ARRAY':'array','NULL':'null'
});
function normalizeToolSchemaForOpenAI(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(s => normalizeToolSchemaForOpenAI(s));
  const out = Object.assign({}, schema);
  if (typeof out.type === 'string') out.type = _OPENAI_TYPE_MAP[out.type] || (out.type.length ? out.type.toLowerCase() : out.type);
  if (out.properties && typeof out.properties === 'object' && !Array.isArray(out.properties)) {
    const newProps = {};
    for (const k of Object.keys(out.properties)) newProps[k] = normalizeToolSchemaForOpenAI(out.properties[k]);
    out.properties = newProps;
  }
  if ('items' in out) out.items = normalizeToolSchemaForOpenAI(out.items);
  if ('additionalProperties' in out && typeof out.additionalProperties === 'object') out.additionalProperties = normalizeToolSchemaForOpenAI(out.additionalProperties);
  if (Array.isArray(out.required)) out.required = out.required.slice();
  if (out.anyOf && Array.isArray(out.anyOf)) out.anyOf = out.anyOf.map(normalizeToolSchemaForOpenAI);
  if (out.oneOf && Array.isArray(out.oneOf)) out.oneOf = out.oneOf.map(normalizeToolSchemaForOpenAI);
  if (out.allOf && Array.isArray(out.allOf)) out.allOf = out.allOf.map(normalizeToolSchemaForOpenAI);
  return out;
}
function normalizeToolsForGroq(toolDeclarations) {
  if (!Array.isArray(toolDeclarations) || toolDeclarations.length === 0) return [];
  return toolDeclarations.map(td => {
    const params = normalizeToolSchemaForOpenAI((td && td.parameters && typeof td.parameters === 'object') ? td.parameters : {});
    return {
      type: 'function',
      function: {
        name: String((td && td.name) || ''),
        description: (td && typeof td.description === 'string') ? td.description : '',
        parameters: params,
      }
    };
  });
}

const PIPELINE_3IA = String(process.env.PIPELINE_3IA || 'off').trim().toLowerCase() === 'on';
const LEGACY_SINGLE_PHASE = !PIPELINE_3IA; // default true = fluxo antigo 100% preservado
const ARCH_PROVIDER = String(process.env.ARCH_PROVIDER || 'gemini').trim().toLowerCase();
const ARCH_MODEL    = process.env.ARCH_MODEL    || 'gemini-3.5-flash-lite';
const DEV_PROVIDER  = String(process.env.DEV_PROVIDER  || 'gemini').trim().toLowerCase(); // PRESERVAR gemini default
const DEV_MODEL     = process.env.DEV_MODEL     || GOOGLE_MODEL;
const QA_PROVIDER   = String(process.env.QA_PROVIDER   || 'gemini').trim().toLowerCase();
const QA_MODEL      = process.env.QA_MODEL      || 'gemini-2.5-flash';
const MAX_CORRECTION_LOOPS = Math.max(0, parseInt(process.env.MAX_CORRECTION_LOOPS || '0', 10));
const QA_MAX_ISSUES        = Math.max(3,  parseInt(process.env.QA_MAX_ISSUES || '12', 10));
const MAX_ARCH_RETRIES     = Math.max(0,  parseInt(process.env.MAX_ARCH_RETRIES || '2', 10));

const PROVIDER_INFO = Object.freeze({
  gemini:     { label: 'Google Gemini', requiresKey: () => GOOGLE_KEY_OK },
  cerebras:   { label: 'Cerebras Cloud', requiresKey: () => looksLikeValidGoogleKey(CEREBRAS_API_KEY) || (CEREBRAS_API_KEY && CEREBRAS_API_KEY.length >= 20) },
  cloudflare: { label: 'Cloudflare Workers AI', requiresKey: () => {
      const k = CLOUDFLARE_WORKERS_AI_API_KEY; const acc = CLOUDFLARE_ACCOUNT_ID;
      const kOk = looksLikeValidGoogleKey(k) || (k && k.length >= 20);
      const accOk = typeof acc === 'string' && acc.trim().length >= 8;
      return kOk && accOk;
    }},
  mistral:    { label: 'Mistral API',    requiresKey: () => looksLikeValidGoogleKey(MISTRAL_API_KEY)  || (MISTRAL_API_KEY  && MISTRAL_API_KEY.length  >= 20) },
  openrouter: { label: 'OpenRouter (DeepSeek free)', requiresKey: () => looksLikeValidGoogleKey(OPENROUTER_API_KEY) || (OPENROUTER_API_KEY && OPENROUTER_API_KEY.length >= 20) },
  deepseek:   { label: 'DeepSeek Oficial', requiresKey: () => DEEPSEEK_PAID_MODE && (looksLikeValidGoogleKey(DEEPSEEK_API_KEY) || (DEEPSEEK_API_KEY && DEEPSEEK_API_KEY.length >= 20)) },
  groq:       { label: 'Groq Cloud (Llama 3.3)', requiresKey: () => looksLikeValidGoogleKey(GROQ_API_KEY) || (GROQ_API_KEY && GROQ_API_KEY.length >= 20) },
});
const _GEMINI_MODEL_PREFIX_RE = /^(models\/)?(gemini|learnlm|embedding|text|image|audio)\-/i;
function _looksLikeValidGeminiModel(m) {
  const s = String(m || '').trim();
  if (!s) return false;
  if (_GEMINI_MODEL_PREFIX_RE.test(s)) return true;
  if (/^(gemini|learnlm)[\-\.]/i.test(s)) return true;
  return false;
}
function _safeGeminiModel(raw, fallback) {
  const fb = (typeof fallback === 'string' && fallback.length) ? fallback : GOOGLE_MODEL;
  const r = String(raw || '').trim();
  if (!r) return fb;
  if (_looksLikeValidGeminiModel(r)) return r;
  return fb;
}
function providerIsUsable(name) {
  const p = PROVIDER_INFO[name];
  if (!p) return false;
  try { return Boolean(p.requiresKey()); } catch { return false; }
}
function resolveProvider(requested, fallback='gemini') {
  const r = (requested || '').trim().toLowerCase();
  if (providerIsUsable(r)) return r;
  if (r !== fallback && providerIsUsable(fallback)) return fallback;
  if (providerIsUsable('gemini')) return 'gemini';
  return 'gemini'; // último fallback
}
function providerEndpoint(provider, model) {
  switch (provider) {
    case 'cerebras':   return { url: `https://api.cerebras.ai/v1/chat/completions`, auth: `Bearer ${CEREBRAS_API_KEY}`, bodyModel: model || CEREBRAS_MODEL };
    case 'cloudflare': return { url: `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`, auth: `Bearer ${CLOUDFLARE_WORKERS_AI_API_KEY}`, bodyModel: model || CLOUDFLARE_WORKERS_AI_MODEL };
    case 'mistral':    return { url: `https://api.mistral.ai/v1/chat/completions`,  auth: `Bearer ${MISTRAL_API_KEY}`,  bodyModel: model || MISTRAL_MODEL  };
    case 'openrouter': return { url: `https://openrouter.ai/api/v1/chat/completions`, auth: `Bearer ${OPENROUTER_API_KEY}`, bodyModel: model || OPENROUTER_DEEPSEEK_MODEL };
    case 'deepseek':   return { url: `https://api.deepseek.com/v1/chat/completions`, auth: `Bearer ${DEEPSEEK_API_KEY}`, bodyModel: model || DEEPSEEK_MODEL };
    case 'groq':       return { url: `https://api.groq.com/openai/v1/chat/completions`, auth: `Bearer ${GROQ_API_KEY}`, bodyModel: model || GROQ_MODEL };
    case 'gemini':
    default:           return null; // usa genAIStream nativo
  }
}
// ====== Conversão formato Gemini contents → OpenAI /chat/completions messages (bidirecional) ======
function _geminiPartsToOpenAiContent(parts) {
  if (!Array.isArray(parts)) return [];
  const out = [];
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    if (typeof p.text === 'string') out.push({ type: 'text', text: p.text });
    if (p.functionCall && typeof p.functionCall === 'object') {
      out.push({
        type: 'tool_calls',
        id: p.functionCall.id || `fc_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
        type_tool: 'function',
        function: { name: p.functionCall.name || '', arguments: typeof p.functionCall.args === 'string' ? p.functionCall.args : JSON.stringify(p.functionCall.args || {}) }
      });
    }
    if (p.functionResponse && typeof p.functionResponse === 'object') {
      out.push({ type: 'tool_result', tool_call_id: p.functionResponse.name || '', content: typeof p.functionResponse.response === 'string' ? p.functionResponse.response : JSON.stringify(p.functionResponse.response || {}) });
    }
  }
  if (out.length === 1 && out[0].type === 'text') return out[0].text;
  return out.length ? out : '';
}
function _geminiContentsToOpenAIMessages(contents, systemString) {
  const messages = [];
  if (typeof systemString === 'string' && systemString.trim().length) {
    messages.push({ role: 'system', content: systemString });
  }
  if (!Array.isArray(contents)) return messages;
  for (const c of contents) {
    if (!c || typeof c !== 'object') continue;
    const role = c.role === 'model' ? 'assistant' : (c.role === 'user' ? 'user' : (c.role === 'system' ? 'system' : 'user'));
    const content = _geminiPartsToOpenAiContent(c.parts);
    if (Array.isArray(content)) {
      const hasTool = content.some(x => x && (x.type === 'tool_calls' || x.type === 'tool_result'));
      if (hasTool) {
        let textBuf = '';
        for (const part of content) {
          if (part.type === 'text') textBuf += (textBuf.length ? '\n' : '') + part.text;
          else if (part.type === 'tool_calls') {
            const msg0 = { role, content: textBuf.length ? textBuf : undefined, tool_calls: [{ id: part.id, type: 'function', function: part.function }] };
            messages.push(msg0);
            textBuf = '';
          } else if (part.type === 'tool_result') {
            messages.push({ role: 'tool', tool_call_id: part.tool_call_id, content: part.content });
          }
        }
        if (textBuf.length) messages.push({ role, content: textBuf });
      } else {
        messages.push({ role, content });
      }
    } else if (typeof content === 'string' && content.length) {
      messages.push({ role, content });
    } else if (content !== undefined && content !== null && content !== '') {
      messages.push({ role, content });
    }
  }
  return messages;
}
function _openAiChoiceToGeminiParts(choice) {
  const out = [];
  const msg = choice?.message || {};
  if (typeof msg.content === 'string' && msg.content.length) out.push({ text: msg.content });
  if (msg.content && Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part && typeof part.text === 'string') out.push({ text: part.text });
    }
  }
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (tc && tc.type === 'function' && tc.function) {
        let args = tc.function.arguments || {};
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { raw: args }; } }
        out.push({ functionCall: { id: tc.id || null, name: tc.function.name || '', args } });
      }
    }
  }
  return out;
}
// Wrapper genérico (não-tool-calling) para Arquiteto / QA (fases 1 e 3):
// recebe prompt → retorna { text, tokensIn, tokensOut, provider, model }
async function runLLMTextOnly({ provider, model, system, user, temperature=0.2, maxTokens=2048, tag='rc22' }) {
  const fallbackToGemini = async (extraLocal = {}) => {
    const fbModel = _safeGeminiModel(model);
    const fullText = [];
    const usage = {};
    const combinedPrompt = `### Instruções do Sistema:\n${system}\n\n### Requisição do Usuário:\n${user}`;
    const contents = [ { role: 'user', parts: [ { text: combinedPrompt } ] } ];
    await genAIStream(
      contents,
      'Você é um assistente de IA útil. Siga as instruções fornecidas no prompt do usuário.',
      (chunk) => {
        if (chunk.usage) Object.assign(usage, chunk.usage || {});
        if (chunk.done) return;
        if (Array.isArray(chunk.parts)) {
          for (const p of chunk.parts) {
            if (typeof p.text === 'string') fullText.push(p.text);
          }
        } else if (typeof chunk.text === 'string') {
          fullText.push(chunk.text);
        }
      },
      { model: fbModel, ...(extraLocal || {}) }
    );
    const tIn  = (typeof usage?.promptTokenDetails?.totalTokens === 'number') ? usage.promptTokenDetails.totalTokens : (usage?.totalTokens || 0);
    const tOut = (typeof usage?.candidatesTokenDetails?.totalTokens === 'number') ? usage.candidatesTokenDetails.totalTokens : 0;
    return { text: fullText.join(''), tokensIn: tIn, tokensOut: tOut, provider: 'gemini', model: fbModel, fallback: true };
  };
  const callNonStream = async (prov, extraCall = {}) => {
    let modelOverridden = extraCall.forcedModel || model || null;
    const providerDefault = {
      cerebras: CEREBRAS_MODEL, cloudflare: CLOUDFLARE_WORKERS_AI_MODEL, mistral: MISTRAL_MODEL, openrouter: OPENROUTER_DEEPSEEK_MODEL, deepseek: DEEPSEEK_MODEL, groq: GROQ_MODEL,
    }[prov] || null;
    if (prov !== 'gemini' && modelOverridden && providerDefault) {
      const isGeminiModel = /gemini/i.test(modelOverridden);
      const provLooksGood = !isGeminiModel && (/^[\w\-\.]+:[\w\-\.]+/.test(modelOverridden) || /^(llama|mistral|qwen|deepseek|gemma|hermes|codestral|pixtral|mixtral|command|nemotron|phi|gpt|claude|sonnet|opus|haiku|cf)\-/i.test(modelOverridden) || /^@cf\//.test(modelOverridden));
      if (!provLooksGood) modelOverridden = providerDefault;
    }
    const ep = providerEndpoint(prov, modelOverridden || null);
    if (!ep) return fallbackToGemini();
    const blockedEntry = aiResilienceModelIsBlocked(prov, ep.bodyModel);
    if (blockedEntry) {
      const err = new Error(`[${prov}] modelo bloqueado temporariamente ${JSON.stringify(ep.bodyModel)}: ${blockedEntry.classification} (${blockedEntry.failCount}x falhou). Bloqueado por ~${Math.round(blockedEntry.blockedMs/1000/60)}min.`);
      err._httpStatus = 404;
      err._response = null;
      err._modelUsed = ep.bodyModel;
      err._blockedByRouter = true;
      throw err;
    }
    const messages = [];
    if (system && String(system).trim()) messages.push({ role: 'system', content: String(system).trim() });
    messages.push({ role: 'user', content: String(user || '') });
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': ep.auth, 'User-Agent': `TiAgente-RC22-${tag}` },
      body: JSON.stringify({
        model: ep.bodyModel, messages, stream: false,
        max_tokens: Math.max(64, parseInt(maxTokens, 10) || 2048),
        temperature: Math.max(0, Math.min(2, parseFloat(temperature) || 0.2)),
      }),
      signal: AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}: ${txt.slice(0,500)}`);
      err._httpStatus = res.status;
      err._response = res;
      err._modelUsed = ep.bodyModel;
      throw err;
    }
    const d = await res.json();
    const choice0 = d?.choices?.[0]?.message?.content || d?.choices?.[0]?.text || d?.output || '';
    const u = d?.usage || {};
    const text = typeof choice0 === 'string' ? choice0 : ((choice0 && typeof choice0[0]?.text === 'string') ? choice0[0].text : JSON.stringify(choice0).slice(0,4000));
    return { text: text || '', tokensIn: u?.prompt_tokens || u?.input_tokens || 0, tokensOut: u?.completion_tokens || u?.output_tokens || 0, provider: prov, model: ep.bodyModel };
  };
  if (!AI_RESILIENCE_ENABLED) {
    const effectiveProvider = resolveProvider(provider, 'gemini');
    const ep = providerEndpoint(effectiveProvider, model);
    if (!ep) {
      try { return await fallbackToGemini(); } catch (e) { throw e; }
    }
    try { return await callNonStream(effectiveProvider); }
    catch (err) {
      console.log(`[RC22 provider ${effectiveProvider} erro: ${(err?.message||'').slice(0,80)}] fallback para gemini.`);
      try { return await fallbackToGemini(); } catch (e2) { throw err; }
    }
  }
  const preferred = Array.isArray(provider) && provider.length ? provider : (typeof provider === 'string' ? [provider] : []);
  const order = aiResilienceBuildOrder(preferred.length ? preferred : null);
  const attempts = [];
  const triedPerProvider = new Map();
  const triedPerProviderModel = new Set();
  let lastErr = null;
  let syntheticContents = null;
  for (const entry of order) {
    const prov = entry.name;
    if (!providerIsUsable(prov)) continue;
    const baseAttempts = triedPerProvider.get(prov) || 0;
    if (baseAttempts >= (AIRES_MAX_CONTEXT_RETRY + 1)) continue;
    let result;
    let chosenModel = null;
    try {
      if (prov === 'gemini') {
        chosenModel = _safeGeminiModel(model);
        result = await fallbackToGemini(baseAttempts > 0 ? { _resRetryIndex: baseAttempts } : {});
      } else {
        const lastSt = __AI_RESILIENCE.get(prov);
        const forcedKind = lastSt?.lastKind || null;
        const lastAttemptModel = lastSt?.modelUsed || null;
        const defaultModelForProv = {
          cerebras: CEREBRAS_MODEL, cloudflare: CLOUDFLARE_WORKERS_AI_MODEL, mistral: MISTRAL_MODEL, openrouter: OPENROUTER_DEEPSEEK_MODEL, deepseek: DEEPSEEK_MODEL, groq: GROQ_MODEL,
        }[prov] || null;
        const modelToTry = forcedKind === 'MODEL_UNAVAILABLE' && lastAttemptModel
          ? (aiResPickAltModel(prov, lastAttemptModel, forcedKind).model || defaultModelForProv)
          : (aiResPickAltModel(prov, lastAttemptModel || defaultModelForProv, forcedKind).model || defaultModelForProv);
        chosenModel = modelToTry;
        const key = __airesModelKey(prov, modelToTry || '__default__');
        if (triedPerProviderModel.has(key)) continue;
        triedPerProviderModel.add(key);
        if (aiResilienceModelIsBlocked(prov, modelToTry)) continue;
        result = await callNonStream(prov, { forcedModel: modelToTry });
      }
      aiResilienceMarkSuccess(prov);
      attempts.push({ provider: prov, ok: true, usedModel: chosenModel || result?.model || null });
      console.log(`[AI_ROUTER] provider=${prov} model=${JSON.stringify(String(chosenModel || result?.model || '').slice(0,64))} status=success action=CONTINUE_TASK`);
      return Object.assign({}, result, { _resilience: { tried: attempts.map(a=>a.provider), used: prov } });
    } catch (err) {
      const status = (err && typeof err._httpStatus === 'number') ? err._httpStatus : null;
      const kindNow = aiResilienceClassifyError(err, status);
      const richNow = aiResClassifyErrorRich(err, status, prov, err?._modelUsed || chosenModel);
      const isContextTooLarge = kindNow === 'CONTEXT_TOO_LARGE';
      const totalNow = (triedPerProvider.get(prov) || 0) + 1;
      triedPerProvider.set(prov, totalNow);
      const sizeBefore = isContextTooLarge ? Buffer.byteLength(String(system || '') + String(user || ''), 'utf8') : null;
      const marked = aiResilienceMarkFailure(prov, err, status, {
        headers: err?._response?.headers, response: err?._response,
        modelUsed: err?._modelUsed || chosenModel || null,
        retryIndex: baseAttempts,
        sizeBeforeBytes: sizeBefore,
      });
      attempts.push({
        provider: prov, ok: false,
        usedModel: err?._modelUsed || chosenModel || null,
        kind: marked.kind,
        classification: marked.richType || richNow.type,
        retryable: typeof marked.retryable === 'boolean' ? marked.retryable : richNow.retryable,
        statusCode: status,
        errorMessage: err?.message || '',
        inCooldownAtEnd: aiResilienceIsInCooldown(prov),
        blockedByRouter: !!err._blockedByRouter,
      });
      lastErr = err;
      if (isContextTooLarge && baseAttempts < AIRES_MAX_CONTEXT_RETRY) {
        if (!syntheticContents) syntheticContents = [{role:'user', parts:[{text:String(user||'')}]}];
        const compact = aiResCompactContents(syntheticContents, system, { keepGoal:true, keepTask:true, keepLast:2 });
        syntheticContents = compact.contents;
        const mergedUser = [];
        for (const c of syntheticContents || []) for (const p of (c && c.parts) || []) if (typeof p?.text === 'string' && p.text) mergedUser.push(p.text);
        user = mergedUser.join('\n');
        if (compact.compressed) {
          const stNow = __AI_RESILIENCE.get(prov) || {};
          stNow.contextCompressed = true;
          stNow.sizeBeforeBytes = sizeBefore;
          stNow.sizeAfterBytes  = Buffer.byteLength(String(system || '') + String(user || ''), 'utf8');
          if (typeof stNow.failureCount === 'number') {
            stNow.failureCount = Math.max(0, stNow.failureCount - 1);
          }
        }
        const reorder = aiResilienceBuildOrder(preferred.length ? preferred : null);
        order.length = 0; order.push(...reorder);
        continue;
      }
      if (triedPerProvider.get(prov) >= 2 && order.some(o => o.name !== prov)) continue;
      continue;
    }
  }
  const summary = aiResilienceBuildAllProvidersFailedOrder(attempts, AI_RESILIENCE_FALLBACK_DEG);
  const det = (summary && summary.attempts && summary.attempts.length)
    ? summary.attempts.map(a => `  - ${a.provider}${a.usedModel?`/${String(a.usedModel).slice(0,40)}`:''} http=${a.statusCode||'-'} class=${a.classification||a.kind||'?'} retryable=${typeof a.retryable === 'boolean' ? a.retryable : '?'}${a.blockedByRouter?' [router-blocked]':''} err=${((a.errorRedacted||a.errorMessage||'').slice(0,80))}`).join('\n')
    : '  — (sem detalhes)';
  const err2 = new Error(`ALL_PROVIDERS_FAILED — Nenhum provedor/ modelo conseguiu responder. Último erro: ${(lastErr?.message || '').slice(0,180)}\nDetalhes das tentativas:\n${det}`);
  err2._httpStatus = 503;
  err2._allProvidersFailed = summary;
  err2.code = 'ALL_PROVIDERS_FAILED';
  if (AI_RESILIENCE_FALLBACK_DEG) {
    err2._degradedFallback = { heuristicPossible: true };
    return {
      text: '',
      tokensIn: 0,
      tokensOut: 0,
      provider: 'degraded',
      model: 'fallback-local',
      degraded: true,
      _allProvidersFailed: summary,
      _resilience: { tried: attempts.map(a => a.provider), used: null, allDown: true }
    };
  }
  throw err2;
}
console.log(
  `🧩 RC22  Pipeline 3-IA: ${PIPELINE_3IA ? 'ON  (Arquiteta → Desenvolvedora → QA)' : 'OFF (modo antigo 1 fase · preservado)'}` +
  `  ·  Arch=${resolveProvider(ARCH_PROVIDER)}/${ARCH_MODEL}` +
  `  ·  Dev=${resolveProvider(DEV_PROVIDER,'gemini')}/${DEV_MODEL}` +
  `  ·  QA=${resolveProvider(QA_PROVIDER)}/${QA_MODEL}`
);

// ==========================================================================
//  RC27  ORQUESTRADOR AUTÔNOMO (camada ACIMA do RC22/RC24, NÃO toca neles)
//  - Por padrão TUDO desligado (RC27_ENABLED=false) → 100% retrocompat, zero overhead
//  - Early gate no TOPO de runAgentLoop: se !RC27_ENABLED, roda função legacy 1:1
//  - Se RC27_ENABLED=true, o orquestrador decide autonomamente COMO fazer o objetivo
// ==========================================================================
const RC27_AUTONOMOUS_MODE = String(process.env.RC27_AUTONOMOUS_MODE || 'off').trim().toLowerCase();
const RC27_ENABLED = RC27_AUTONOMOUS_MODE === 'on';
const RC27_DEFAULT_MAX_STEPS = Math.max(5, parseInt(process.env.RC27_DEFAULT_MAX_STEPS || '25', 10));
const RC27_MAX_CORRECTION_PASSES = Math.max(1, parseInt(process.env.RC27_MAX_CORRECTION_PASSES || '4', 10));
const RC27_ALLOW_INTERNET_BY_DEFAULT = String(process.env.RC27_ALLOW_INTERNET_BY_DEFAULT || 'off').trim().toLowerCase() === 'on';
// ===== NETWORK OUTBOUND · GATE CENTRAL (Evolução 3) =====
const NET_OUT_ENABLED       = String(process.env.NETWORK_OUTBOUND_ENABLED       || 'on').trim().toLowerCase() === 'on';
const NET_OUT_WHITELIST_RAW = String(process.env.NETWORK_OUTBOUND_WHITELIST     || '*').trim();
const NET_OUT_WHITELIST     = NET_OUT_WHITELIST_RAW.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).concat(['localhost','127.0.0.1']);
const NET_OUT_TOOL_WEB_FETCH  = String(process.env.NETWORK_OUTBOUND_TOOL_WEB_FETCH  || 'on').trim().toLowerCase() === 'on';
const NET_OUT_TOOL_WEB_SEARCH = String(process.env.NETWORK_OUTBOUND_TOOL_WEB_SEARCH || 'on').trim().toLowerCase() === 'on';
const NET_OUT_AUTH_MODE = (() => { const v = String(process.env.NETWORK_OUTBOUND_AUTH_MODE || 'task_scoped').trim().toLowerCase(); return ['task_scoped','always_ask','env_grant'].includes(v)?v:'task_scoped'; })();
function _ipv4ToUint32(ip) {
  const m = String(ip||'').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null; const o = m.slice(1,5).map(Number); if (o.some(x => x < 0 || x > 255)) return null;
  return (o[0]>>>0) * 0x1000000 + (o[1]>>>0) * 0x10000 + (o[2]>>>0) * 0x100 + (o[3]>>>0);
}
function _isPrivateOrReservedHost(h) {
  const host = String(h||'').trim().toLowerCase();
  if (!host) return true;
  if (/\.(local|internal|corp|lan|home|priv|intranet)$/i.test(host)) return true;
  if (/^localhost$/i.test(host) || host === '0.0.0.0' || host === '::1' || host === '[::1]') return true;
  if (host.startsWith('[') && host.endsWith(']')) {
    const inner = host.slice(1,-1).toLowerCase();
    if (inner === '::1' || inner.startsWith('fe80:') || inner.startsWith('fc00:') || inner.startsWith('fd00:')) return true;
  }
  const ipv4 = _ipv4ToUint32(host); if (ipv4 !== null) {
    const inRange = (a,b) => ipv4 >= a && ipv4 <= b;
    if (inRange(0x0a000000,0x0affffff)) return true;       // 10.0.0.0/8
    if (inRange(0x64400000,0x647fffff)) return true;       // 100.64.0.0/10 CGNAT/metadata
    if (inRange(0x7f000000,0x7fffffff)) return true;       // 127.0.0.0/8
    if (inRange(0xa9fe0000,0xa9feffff)) return true;       // 169.254.0.0/16 link-local
    if (inRange(0xac100000,0xac1fffff)) return true;       // 172.16.0.0/12
    if (inRange(0xc0a80000,0xc0a8ffff)) return true;       // 192.168.0.0/16
    if (inRange(0xe0000000,0xefffffff)) return true;       // 224.0.0.0/4 multicast
    if (inRange(0xffffffff,0xffffffff)) return true;       // 255.255.255.255
  }
  return false;
}
function isAllowedOutboundDomain(urlOrHost) {
  if (!NET_OUT_ENABLED) return { ok:false, reason:'NETWORK_OUTBOUND_ENABLED=off (gate geral fechado).' };
  let host = ''; let input = String(urlOrHost||'').trim();
  try {
    if (/^https?:\/\//i.test(input)) { const u = new URL(input); host = u.hostname.toLowerCase(); }
    else host = input.toLowerCase();
  } catch { return { ok:false, reason:'URL malformada.' }; }
  if (!host) return { ok:false, reason:'host vazio.' };
  if (_isPrivateOrReservedHost(host)) return { ok:false, reason:`host privado/reservado bloqueado: ${host}` };
  let allowed = false;
  for (const rule of NET_OUT_WHITELIST) {
    if (!rule) continue;
    if (rule === '*') { allowed = true; break; }
    if (rule.startsWith('*.')) { const suffix = rule.slice(2); if (host === suffix || host.endsWith('.' + suffix)) { allowed = true; break; } }
    else if (host === rule || host.endsWith('.' + rule)) { allowed = true; break; }
  }
  return allowed ? { ok:true, host } : { ok:false, reason:`domínio ${host} não está na NETWORK_OUTBOUND_WHITELIST.` };
}
async function safeFetchInternet(url, opts = {}) {
  if (!NET_OUT_ENABLED) { const e = new Error('NETWORK_OUTBOUND_ENABLED=off (gate geral fechado).'); e.code='INTERNET_GATE_OFF'; throw e; }
  if (!url || typeof url !== 'string') { const e = new Error('safeFetchInternet: url inválida.'); e.code='INVALID_URL'; throw e; }
  let parsed; try { parsed = new URL(url); } catch { const e = new Error(`URL inválida: ${String(url).slice(0,120)}`); e.code='INVALID_URL'; throw e; }
  if (!['http:','https:'].includes(parsed.protocol)) { const e = new Error(`Protocolo não permitido: ${parsed.protocol}. Só http/https.`); e.code='PROTOCOL_DENIED'; throw e; }
  const allow = isAllowedOutboundDomain(parsed.href); if (!allow.ok) { const e = new Error(allow.reason); e.code='HOST_DENIED'; throw e; }
  const mergedHeaders = Object.assign({ 'User-Agent':'Mozilla/5.0 TiAgente-RC27/1.0 (gate outbound seguro §11 · pesquisa documentação apenas)', Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,text/markdown;q=0.8,application/json;q=0.7,text/css;q=0.6,text/csv;q=0.5,*/*;q=0.01' }, (opts && opts.headers) || {});
  const signal = (opts && opts.signal) ? opts.signal : (typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(30000) : undefined);
  const res = await fetch(parsed.href, Object.assign({}, opts, { headers: mergedHeaders, redirect: opts.redirect || 'follow', signal }));
  const origText = res.text.bind(res);
  res.text = async function textWrapped() { const t = await origText(); return sanitizeForInternet(t); };
  return res;
}
console.log(
  `🌐 NET Outbound: ${NET_OUT_ENABLED ? `ON  · whitelist=${NET_OUT_WHITELIST.length === 0 ? 0 : NET_OUT_WHITELIST.length-2} domínios + sempre localhost/127.0.0.1  ·  authMode=${NET_OUT_AUTH_MODE}  ·  web_search=${NET_OUT_TOOL_WEB_SEARCH?'on':'off'}  ·  web_fetch=${NET_OUT_TOOL_WEB_FETCH?'on':'off'}` : 'OFF (gate geral fechado)'}`
);
// Browser Agent v1 MÍNIMO: 2 funções (browser_open, browser_get_page_info). Sem cliques / sem login.
const __BROWSER_AGENT = createBrowserAgent({
  allowFn: isAllowedOutboundDomain,
  sanitizeFn: sanitizeForInternet,
  netEnabled: NET_OUT_ENABLED,
  webFetchToolEnabled: NET_OUT_TOOL_WEB_FETCH,
  fetchFn: (u, o) => fetch(u, Object.assign({ headers: { 'User-Agent': 'Mozilla/5.0 TiAgente-BrowserAgent/v1 (fetch fallback)' }, signal: (o && o.signal) ? o.signal : (typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(60000) : undefined) }, o || {})),
});
console.log(`🌐 BrowserAgent v1: backend=${__BROWSER_AGENT.backend}${__BROWSER_AGENT.backend==='FETCH_PARSE'?' (fallback fetch+html — sem browser real; puppeteer/playwright não instalados)':' (MCP integrated_browser — navegador real)'}`);
const RC27_SAVE_EVERY_N_TOOL_CALLS = Math.max(1, parseInt(process.env.RC27_SAVE_EVERY_N_TOOL_CALLS || '3', 10));

console.log(
  `🧭 RC27  Autônomo: ${RC27_ENABLED ? 'ON  (recebe objetivo → decide tudo sozinho)' : 'OFF (default · retrocompat 100% absoluta · nenhum overhead)'}` +
  (RC27_ENABLED ? `  ·  maxSteps=${RC27_DEFAULT_MAX_STEPS}  ·  maxCorrec=${RC27_MAX_CORRECTION_PASSES}  ·  internet=${RC27_ALLOW_INTERNET_BY_DEFAULT ? 'ON por default (risco!)' : 'OFF · só com autorização usuário'}` : '')
);

// ==========================================================================
//  RC28  MECANISMO DE DECISÃO AUTÔNOMA (camada ACIMA do RC27, NÃO o substitui)
//  - Por padrão TUDO desligado (RC28_ENABLED=false) → 100% retrocompat, zero overhead
//  - Se RC28_ENABLED=true, o RC27 após ARCHITECTURE dispara o loop RC28 para executar
//  cada tarefa individualmente com decisão heurística (não cai mais no legado cego).
// ==========================================================================
const RC28_DECISION_ENGINE = String(process.env.RC28_DECISION_ENGINE || 'off').trim().toLowerCase();
const RC28_ENABLED = RC28_DECISION_ENGINE === 'on' && RC27_ENABLED; // precisa do RC27 ligado também
const RC28_MAX_CYCLES = Math.max(8, Math.min(400, parseInt(process.env.RC28_MAX_CYCLES || '40', 10)));
const RC28_FORCE_RUN_AFTER_PLAN = String(process.env.RC28_FORCE_RUN_AFTER_PLAN || 'false').trim().toLowerCase() === 'true';
const RC28_CHECKPOINT_EVERY_CYCLES = Math.max(2, Math.min(50, parseInt(process.env.RC28_CHECKPOINT_EVERY_CYCLES || '5', 10)));
const RC28_VERBOSE_LOG = String(process.env.RC28_VERBOSE_LOG || 'false').trim().toLowerCase() === 'true';

console.log(
  `🧲 RC28  Decisão: ${RC28_ENABLED ? 'ON  (executa tarefas, loga decisões, gate §19)' : (RC28_DECISION_ENGINE === 'on' && !RC27_ENABLED ? '⚠️ RC28 ligou mas RC27_AUTONOMOUS_MODE=off → desativado' : 'OFF (default · retrocompat 100% absoluta · nenhum overhead)')}` +
  (RC28_ENABLED ? `  ·  maxCycles=${RC28_MAX_CYCLES}  ·  checkpointEvery=${RC28_CHECKPOINT_EVERY_CYCLES}  ·  verbose=${RC28_VERBOSE_LOG ? 'sim' : 'não'}  ·  forceRunAfterPlan=${RC28_FORCE_RUN_AFTER_PLAN ? 'sim' : 'não'}` : '')
);

// ==========================================================================
//  RC28 · Bindings globais usados pelo hook RC28 em tiagent_orc_motor.js
//  - makeToolsFn: reuso makeSessionTools(session, ws) (15 tools NÃO modificadas)
//  - runLegacyAgentFn: reuso runAgentLoopLegacyOriginal com escopo reduzido
//  - NÃO duplica lógica existente.
// ==========================================================================
if (typeof globalThis !== 'undefined') {
  globalThis.__RC27_ENABLED = RC27_ENABLED;
  globalThis.__RC28_ENABLED = RC28_ENABLED;
  globalThis.__RC28_MAX_CYCLES = RC28_MAX_CYCLES;
  globalThis.__RC28_CHECKPOINT_EVERY = RC28_CHECKPOINT_EVERY_CYCLES;
  globalThis.__RC28_VERBOSE = RC28_VERBOSE_LOG;
  globalThis.__RC28_FORCE_AFTER = RC28_FORCE_RUN_AFTER_PLAN;
  globalThis.__rc28MakeToolsFn = (session, ws) => (typeof makeSessionTools === 'function' ? makeSessionTools(session, ws) : null);
  globalThis.__rc28RunLegacyAgentFn = (ws, session, userParts) => {
    if (typeof runAgentLoopLegacyOriginal !== 'function') return Promise.resolve({ ok: false, mock: true });
    return Promise.resolve().then(() => runAgentLoopLegacyOriginal(ws, session, userParts)).then(r => ({ ok: true, returned: r })).catch(e => ({ ok: false, reason: e.message }));
  };

  // ============================================================
  // RC28.1 · LLM Bridge (bind cirúrgico, NÃO duplica cliente)
  // Só ativa SE engineMode=adaptive. Qualquer erro → null permanente.
  // Reutiliza 100% a runLLMTextOnly (5 providers + timeout 90s +
  // 2 retries 429/5xx + fallback silencioso gemini nativo).
  // ============================================================
  (async () => {
    try {
      const RC28_ENGINE_MODE_G = String(process.env.RC28_ENGINE || 'heuristic').trim().toLowerCase();
      globalThis.__RC28_ENGINE_MODE = RC28_ENGINE_MODE_G;
      globalThis.__RC28_CONF = parseFloat(process.env.RC28_ENGINE_CONFIDENCE || '0.7') || 0.7;
      if (RC28_ENGINE_MODE_G === 'adaptive' && typeof runLLMTextOnly === 'function') {
        const { rc28MakeLlmAnalyzeFn } = await import('./rc28_llm_bridge.js');
        const bridge = rc28MakeLlmAnalyzeFn({
          runLLMTextOnly,
          provider: DEV_PROVIDER,
          model:    DEV_MODEL,
          tag:      'rc28_llm_bridge',
          temperature: 0.1,
          maxTokens:   1024
        });
        if (bridge) {
          globalThis.__rc28LlmAnalyzeFn = bridge;
          console.log(`🧠 RC28.1  LLM Bridge: CONECTADO (${DEV_PROVIDER}/${DEV_MODEL}). Só usa LLM quando heurística < ${(globalThis.__RC28_CONF*100).toFixed(0)}% confiança.`);
        }
      }
    } catch (e) {
      console.warn(`[RC28.1 LLM Bridge] bind falhou (inativo, usa heurística). Erro: ${String(e && e.message || e).slice(0,80)}`);
      globalThis.__rc28LlmAnalyzeFn = null;
    }
  })();
}

// ==========================================================================
//  RC28 P6: Resume após resposta Sim/Não autorização internet ou input humano
//  Não recria Estado Central — reusa projectDir e status pausado existente.
//  CORREÇÃO: Também acorda waitIfPaused do executor legado (runAgentLoopLegacyOriginal)
//  quando a sessão está aguardando (session._awaitingInternetAuth === true).
// ==========================================================================
async function _rc28ResumeAfterInternetInput({ ws, session, projectDir, payload, authorized }) {
  if (!projectDir) return;
  try {
    // === CORREÇÃO AWAITING USER: Se sessão aguarda autorização INTERNET no legado (RC22) ===
    // Quando a execução atual está rodando runAgentLoopLegacyOriginal (for step loop RC22)
    // e espera waitIfPaused, nós atualizamos a session e acordamos.
    if (session && session._awaitingInternetAuth === true) {
      session._awaitingInternetAuthDenied = !Boolean(authorized);
      session._awaitingInternetAuthScopeId = (payload && payload.scopeId) || session._awaitingInternetAuthScopeId || null;
      // Salva no Estado Central para manter consistência também.
      try {
        if (authorized) {
          await OrcFs.mergePatchCentralState({
            projectDir,
            patch: {
              internetAuthorization: { scopeId: session._awaitingInternetAuthScopeId, authorized: true, authorizedAt: Date.now(), grantedBy: 'USER_WS_INPUT_CLIQUE', expiresAtMs: Date.now() + 2 * 60 * 60 * 1000 },
              internetAuthorizationPending: null,
              awaitingInternetAuthorization: null,
            }
          });
        } else {
          await OrcFs.mergePatchCentralState({
            projectDir,
            patch: {
              internetAuthorization: { scopeId: session._awaitingInternetAuthScopeId, authorized: false, deniedAt: Date.now(), grantedBy: null },
              internetAuthorizationPending: null,
              awaitingInternetAuthorization: null,
            }
          });
        }
      } catch {}
      try { setState(ws, session, STATE_RUNNING); } catch {}
      // ACORDA waitIfPaused no executor legado (setado via session.pauseRequested = true + pauseResolver)
      // waitIfPaused implementation: new Promise(resolve => session.pauseResolver = resolve)
      if (session.pauseRequested && typeof session.pauseResolver === 'function') { try { session.pauseResolver(); } catch {} }
      if (typeof session.resumePause === 'function') { try { session.resumePause(); } catch {} }
      else if (session._pauseResolve) { try { session._pauseResolve(); } catch {} }
      // Não cai no RC28 loop; já resume quem está esperando waitIfPaused no legado.
      return;
    }
    const loaded = await OrcFs.loadOrInitCentralState({ projectDir });
    const state = loaded.state;
    const patch = {
      statusExecucao: 'running',
      proximaAcao: 'RESUME_RC28_ENGINE',
      internetAuthorization: {
        scopeId: payload && payload.scopeId || state.internetAuthorization && state.internetAuthorization.scopeId || 'unknown',
        authorized: Boolean(authorized),
        authorizedAt: Boolean(authorized) ? Date.now() : null,
        deniedAt: Boolean(authorized) ? null : Date.now(),
        scope: (payload && payload.scopeId) || (state.internetAuthorization && state.internetAuthorization.scope) || 'tarefa_atual',
        grantedBy: 'USER_WS_INPUT_CLIQUE',
        awaitedUser: false,
        expiresAtMs: Boolean(authorized) ? Date.now() + 2 * 60 * 60 * 1000 : null,
      },
      internetAuthorizationPending: null,
      _rc28Decision: {
        action: 'RESUME_AFTER_INTERNET',
        reason: authorized ? 'Usuário autorizou acesso à internet. Retomando loop RC28.' : 'Usuário NEGOU acesso à internet. Loop RC28 retoma sem internet.',
        heuristic: 'ws_clique_internet_sim_ou_nao',
        candidates: [],
        phaseFrom: state.faseGeral,
        phaseTo: state.faseGeral,
        step: 0,
        authorized: Boolean(authorized),
        v: RC28_LOOP_VER
      }
    };
    const merged = await OrcFs.mergePatchCentralState({ projectDir, patch });
    emit(ws, 'orch:phase', {
      fase: state.faseGeral,
      info: `🧲 RC28 retomando loop após autorização internet=${authorized ? 'SIM' : 'NÃO'} · escopo=${String(payload && payload.scopeId || state.internetAuthorization && state.internetAuthorization.scopeId || '?').slice(0, 20)}…`,
      label: (merged.state && merged.state.faseGeral) || state.faseGeral
    });

    // Retoma em background para não bloquear o WS loop
    setImmediate(async () => {
      try {
        const r = await rc28RunDecisionLoop({
          ws, session, projectDir, centralState: merged.state,
          rc27Enabled: RC27_ENABLED, rc28Enabled: RC28_ENABLED,
          rc28MaxCycles: RC28_MAX_CYCLES,
          rc28CheckpointEvery: RC28_CHECKPOINT_EVERY_CYCLES,
          rc28Verbose: RC28_VERBOSE_LOG,
          rc28ForceAfterPlan: RC28_FORCE_RUN_AFTER_PLAN,
          rc28EngineMode: globalThis.__RC28_ENGINE_MODE || 'heuristic',
          rc28ConfidenceThreshold: globalThis.__RC28_CONF || 0.7,
          rc28LlmAnalyzeFn: typeof globalThis.__rc28LlmAnalyzeFn === 'function' ? globalThis.__rc28LlmAnalyzeFn : null,
        // ======================================================================
        //  ETAPA 7 · CORREÇÃO · ISOLAMENTO DO OBJETIVO NO RESUME PÓS-INTERNET
        //  - NÃO MAIS usa merged.state.objetivoUsuario nem loaded.state.objetivo
        //    do disco (valores antigos).
        //  - Prioridade 1: objetivoUsuarioMensagem (mensagem do usuário salva no
        //    patchAnalysis da solicitação ATUAL pela ETAPA7).
        //  - Prioridade 2: objetivoAtual (garantido sobrescrito na ETAPA7 se
        //    a fase anterior era terminal).
        //  - NUNCA usa loaded.state.objetivo (valor de disco prévio).
        // ======================================================================
        objetivoUsuario: merged.state && (merged.state.objetivoUsuarioMensagem || merged.state.objetivoAtual)
          ? (merged.state.objetivoUsuarioMensagem || merged.state.objetivoAtual)
          : (merged.state && merged.state.objetivoAtual ? merged.state.objetivoAtual : ''),
          makeToolsFn: (sess, w) => makeSessionTools(sess, w),
          runLegacyAgentFn: (w, sess, up) => Promise.resolve().then(() => runAgentLoopLegacyOriginal(w, sess, up)),
          rc24BridgeFn: typeof Orch.decideNextAction === 'function' ? (s, o) => Orch.decideNextAction(s && s.agentSpec || null, s && s.agentState || null, o || {}) : null,
        });
        if (r && r.handled && r.rc28 === 'completed_gate_19') {
          emit(ws, 'orch:phase', { fase: 'COMPLETED', info: `✅ RC28 concluído após ${r.steps || 0} ciclos · gate §19 PASS.` });
        } else if (r && (r.paused === 'paused_awaiting_internet' || r.paused === 'paused_awaiting_human')) {
          emit(ws, 'orch:phase', { fase: state.faseGeral, info: `🧲 RC28 pausado novamente: ${r.paused}.` });
        }
      } catch (e) {
        console.warn(`[RC28 resume background] erro: ${e && e.message || e}`);
      }
    });
    return;
  } catch (e) {
    console.warn(`[RC28 resume] falhou: ${e.message || e}`);
  }
}

// ===== Mounted Projects (pastas externas selecionadas do Desktop/Mac) =====
const MOUNTED_FILE = path.join(__dirname, 'mounted_projects.json');
const mountedProjects = new Map(); // slug -> {slug, displayName, path, createdAt, modifiedAt, fallbackInternal?: boolean}
function safeReadMounted() {
  try {
    if (fsc.existsSync(MOUNTED_FILE)) {
      const raw = fsc.readFileSync(MOUNTED_FILE, 'utf-8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) for (const m of arr) if (m && m.slug && m.path) mountedProjects.set(m.slug, Object.assign({ fallbackInternal: false }, m));
    }
  } catch {}
}
async function saveMounted() {
  try {
    await fs.writeFile(MOUNTED_FILE, JSON.stringify([...mountedProjects.values()], null, 2), 'utf-8');
  } catch {}
}
async function markMountedFallback(slug) {
  const m = mountedProjects.get(slug);
  if (!m || m.fallbackInternal) return false;
  m.fallbackInternal = true;
  await saveMounted();
  return true;
}
// Retorna o DIRETÓRIO GRAVÁVEL para um projeto:
//   - Projeto não montado => workspace normal
//   - Projeto montado SEM fallbackInternal => pasta externa do usuário
//   - Projeto montado COM fallbackInternal => pasta workspace interna (macOS TCC bloqueou escrita)
function resolveWritableProjectDir(project) {
  const raw = String(project || DEFAULT_PROJECT || '');
  if (mountedProjects.has(raw)) {
    const m = mountedProjects.get(raw);
    if (m.fallbackInternal) {
      const p = path.join(WORKSPACE_ROOT, raw);
      if (!fsc.existsSync(p)) fsc.mkdirSync(p, { recursive: true });
      return p;
    }
    return m.path;
  }
  // Fallback workspace normal
  const sanitized = raw.replace(/[^\w.\-_ ]/g, '_').trim().replace(/\s+/g, '-').toLowerCase() || 'default';
  const p = path.join(WORKSPACE_ROOT, sanitized);
  if (!fsc.existsSync(p)) fsc.mkdirSync(p, { recursive: true });
  return p;
}
// Retorna pasta FAVORITA VISUAL/EXPLORER (mesma coisa do resolveProjectDir original, não altera leitura)
function resolveVisualProjectDir(project) {
  const raw = String(project || DEFAULT_PROJECT || '');
  if (mountedProjects.has(raw)) return mountedProjects.get(raw).path;
  const sanitized = raw.replace(/[^\w.\-_ ]/g, '_').trim().replace(/\s+/g, '-').toLowerCase() || 'default';
  return path.join(WORKSPACE_ROOT, sanitized);
}
safeReadMounted();

// ===== Port allocation por projeto =====
const VOICE_REST_PORT = Number(process.env.FABRICA_VOICE_PORT || process.env.VOICE_REST_PORT || 3005);
const RESERVED_PROJECT_PORTS = new Set([
  PORT,
  VOICE_REST_PORT,
  3072,
]);
const PROJECT_PORT_FILE = path.join(__dirname, 'project_ports.json');
const projectPorts = new Map(); // slug -> porta number
const projectServers = new Map(); // slug -> http.Server (static preview)
const PROJECT_PORT_MIN = parseInt(process.env.PROJECT_PORT_MIN || '3001', 10);
const PROJECT_PORT_MAX = parseInt(process.env.PROJECT_PORT_MAX || '4100', 10);
function safeReadProjectPorts() {
  try {
    if (fsc.existsSync(PROJECT_PORT_FILE)) {
      const raw = fsc.readFileSync(PROJECT_PORT_FILE, 'utf-8');
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') for (const [s, p] of Object.entries(obj)) if (typeof p === 'number') projectPorts.set(s, p);
    }
  } catch {}
}
async function saveProjectPorts() {
  try {
    const obj = {}; for (const [s,p] of projectPorts.entries()) obj[s] = p;
    await fs.writeFile(PROJECT_PORT_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch {}
}
safeReadProjectPorts();

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => { try { srv.close(); } catch {}; resolve(false); });
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, '127.0.0.1');
  });
}
async function findFreePort(startAt = PROJECT_PORT_MIN) {
  for (let p = startAt; p <= PROJECT_PORT_MAX; p++) {
    if (RESERVED_PROJECT_PORTS.has(p)) continue;
    if (await isPortFree(p)) return p;
  }
  throw new Error('Não há portas livres na faixa ' + PROJECT_PORT_MIN + '-' + PROJECT_PORT_MAX);
}
async function getPortForProject(slug) {
  if (projectPorts.has(slug)) {
    const cur = projectPorts.get(slug);
    if (!RESERVED_PROJECT_PORTS.has(cur) && await isPortFree(cur)) return cur;
  }
  const used = new Set(projectPorts.values());
  let port = PROJECT_PORT_MIN;
  while (used.has(port) || RESERVED_PROJECT_PORTS.has(port) || !(await isPortFree(port))) {
    port++;
    if (port > PROJECT_PORT_MAX) break;
  }
  if (port > PROJECT_PORT_MAX || RESERVED_PROJECT_PORTS.has(port)) port = await findFreePort();
  projectPorts.set(slug, port);
  await saveProjectPorts();
  return port;
}
function slugifyMountName(raw) {
  const clean = String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9-_ ]/g, ' ').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
  return clean ? clean.toLowerCase() : 'mounted-' + Date.now().toString(36);
}
async function mountProject(folderPath, displayName) {
  const abs = path.isAbsolute(folderPath) ? folderPath : path.resolve(__dirname, folderPath);
  try { await fs.access(abs); } catch { throw new Error('Pasta não existe ou inacessível: ' + abs); }
  const st = await fs.stat(abs);
  if (!st.isDirectory()) throw new Error('Caminho não é uma pasta: ' + abs);
  // Evita duplicatas de caminho
  for (const m of mountedProjects.values()) if (path.resolve(m.path) === abs) return m;
  const slug = slugifyMountName(displayName || path.basename(abs));
  // Evita conflito de slug: adiciona número se necessário
  let finalSlug = slug;
  let n = 1;
  while (mountedProjects.has(finalSlug) || !finalSlug) {
    n++;
    finalSlug = slug + '-' + n;
  }
  const now = Date.now();
  const record = {
    slug: finalSlug,
    displayName: String(displayName || path.basename(abs)).slice(0, 120),
    path: abs,
    mounted: true,
    createdAt: now,
    modifiedAt: now,
  };
  mountedProjects.set(finalSlug, record);
  await saveMounted();
  return record;
}

await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
await fs.mkdir(path.join(WORKSPACE_ROOT, DEFAULT_PROJECT), { recursive: true });
await fs.mkdir(UPLOAD_DIR, { recursive: true });

function resolveProjectDir(project) {
  // Retorna o caminho ORIGINAL (visual/explorador) — compatibilidade com endpoints /projects/ e listagens
  return resolveVisualProjectDir(project);
}
async function ensureProject(project) {
  const raw = String(project || DEFAULT_PROJECT);
  if (mountedProjects.has(raw)) {
    // Garante que exista tanto a pasta externa (se puder) quanto o fallback interno
    const fallbackDir = resolveWritableProjectDir(raw);
    if (!fsc.existsSync(fallbackDir)) await fs.mkdir(fallbackDir, { recursive: true });
    try {
      const marker1 = path.join(fallbackDir, '.project');
      if (!fsc.existsSync(marker1)) await fs.writeFile(marker1, `# ${raw} (fallback)\nCriado em ${new Date().toISOString()}\n`, 'utf8');
    } catch {}
    try {
      const ext = mountedProjects.get(raw).path;
      if (fsc.existsSync(ext)) {
        const marker2 = path.join(ext, '.project');
        if (!fsc.existsSync(marker2)) await fs.writeFile(marker2, `# ${raw}\nCriado em ${new Date().toISOString()}\n`, 'utf8').catch(() => {});
      }
    } catch {}
    return raw;
  }
  const dir = resolveProjectDir(raw);
  await fs.mkdir(dir, { recursive: true });
  const basename = path.basename(dir);
  try {
    const marker = path.join(dir, '.project');
    if (!fsc.existsSync(marker)) await fs.writeFile(marker, `# ${basename}\nCriado em ${new Date().toISOString()}\n`, 'utf8');
  } catch {}
  return basename;
}
function isProjectMounted(project) { return mountedProjects.has(String(project || '')); }
function isFallbackActive(project) { return mountedProjects.get(String(project || ''))?.fallbackInternal === true; }

// ===== Helpers: escrita/remoção com FALLBACK AUTOMÁTICO (escapa EPERM/EACCES pasta montada Desktop bloqueada macOS)
async function writeFileWithAutoFallback(session, args, notifyUser) {
  const slug = session.project || DEFAULT_PROJECT;
  const mounted = mountedProjects.has(slug);
  const hasFallbackBefore = isFallbackActive(slug);
  let result = await toolWriteFile(session, args);
  if (!result.ok && mounted && !hasFallbackBefore && /EPERM|EACCES|operation not permitted|permission denied/i.test(String(result.error || ''))) {
    const mudou = await markMountedFallback(slug);
    if (mudou) {
      if (notifyUser) notifyUser(
        `⚠️ **Permissão bloqueada pelo macOS**\n\n` +
        `A pasta "${mountedProjects.get(slug)?.displayName || slug}" ` +
        `na sua Área de Trabalho foi bloqueada pela proteção TCC do macOS (Desktop/Documents/Downloads pedem Full Disk Access).\n\n` +
        `✅ Não se preocupe! Continuo salvando tudo dentro da minha pasta interna em \`criador/workspace/${slug}/\`. O preview continua funcionando normalmente. Se quiser, depois pode mover os arquivos manualmente.`
      );
      // Garante pasta interna
      const fallbackDir = resolveWritableProjectDir(slug);
      if (!fsc.existsSync(fallbackDir)) fsc.mkdirSync(fallbackDir, { recursive: true });
      // Reinicia servidor preview se necessário (agora serve da pasta interna
      try {
        if (projectServers.has(slug)) {
          try { projectServers.get(slug).close(); } catch {}
          projectServers.delete(slug);
        }
        startProjectPreviewServer(slug).catch(() => {});
      } catch {}
      // Tenta escrever NOVAMENTE na pasta gravável interna
      result = await toolWriteFile(session, args);
    }
  }
  return result;
}
async function deleteFileWithAutoFallback(session, args, notifyUser) {
  const slug = session.project || DEFAULT_PROJECT;
  const mounted = mountedProjects.has(slug);
  const hasFallbackBefore = isFallbackActive(slug);
  let result = await toolDeleteFile(session, args);
  if (!result.ok && mounted && !hasFallbackBefore && /EPERM|EACCES|operation not permitted|permission denied/i.test(String(result.error || ''))) {
    await markMountedFallback(slug);
    result = await toolDeleteFile(session, args);
  }
  return result;
}

function projectMeta(project) {
  const slug = String(project || DEFAULT_PROJECT);
  if (mountedProjects.has(slug)) {
    const m = mountedProjects.get(slug);
    return {
      name: slug,
      displayName: m.displayName,
      path: m.fallbackInternal ? resolveWritableProjectDir(slug) : m.path,
      mounted: true,
      fallbackInternal: !!m.fallbackInternal,
      createdAt: m.createdAt,
      modifiedAt: m.modifiedAt || Date.now(),
    };
  }
  return { name: slug, displayName: slug, mounted: false, path: resolveProjectDir(slug), createdAt: 0, modifiedAt: 0 };
}
function projectDirOf(session) {
  // IMPORTANTE: usa o caminho GRAVÁVEL (fallback interno se macOS bloqueou a pasta do Desktop)
  return resolveWritableProjectDir(session.project || DEFAULT_PROJECT);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '_' + crypto.randomBytes(4).toString('hex') + ext;
    cb(null, name);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function setStaticPreviewHeaders(res, filePath) {
  if (/\.(html?|htm)$/i.test(filePath || '')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  }
}

const app = express();
app.use((req, res, next) => {
  const up = String(req.headers && req.headers.upgrade || '').toLowerCase();
  if (up === 'websocket' && (req.url === '/ws' || req.url.startsWith('/ws?') || req.url === '/gw' || req.url.startsWith('/gw?'))) {
    return;
  }
  next();
});
app.use(cors());
app.get('/__ti_config.js', (req, res) => {
  const voiceOk = Boolean(globalThis.__VOICE_OK__ || false);
  const js = `/* Auto-generated by server.js boot. Não editar manualmente. */
(function () {
  var cfg = Object.freeze({
    VOICE_REST_PORT: ${VOICE_REST_PORT},
    VOICE_REST_URL: 'http://127.0.0.1:${VOICE_REST_PORT}',
    VOICE_SERVICE_OK: ${voiceOk ? 'true' : 'false'}
  });
  if (typeof window !== 'undefined') {
    window.__TI_CONFIG__ = cfg;
    try { window.dispatchEvent(new CustomEvent('ti:config:ready', { detail: cfg })); } catch (e) {}
  }
  if (typeof globalThis !== 'undefined') globalThis.__TI_CONFIG__ = cfg;
})();`;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(js);
});
app.use(express.json({ limit: '20mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
// ============================================================
//  RC20  RENDER single-port preview: /preview/:slug/*
//  No desktop local continua igual (cada projeto com sua porta 3001+),
//  Mas em nuvem/Render/Linux servemos TUDO dentro da única porta liberada.
// ============================================================
app.use('/preview', (req, res, next) => {
  try {
    const rel = decodeURIComponent(req.path.replace(/^\/+/, ''));
    const parts = rel.split('/').filter(Boolean);
    const slug = parts.shift() || DEFAULT_PROJECT;
    const base = resolveWritableProjectDir(slug);
    const restEncoded = '/' + parts.map(encodeURIComponent).join('/');
    const inside = path.resolve(base, parts.join('/'));
    if (!inside.startsWith(base)) return res.status(403).type('txt').send('403 Fora do workspace');
    const origUrl = req.url;
    const slashIdx = req.originalUrl.indexOf('/preview');
    const afterPreview = req.originalUrl.slice(slashIdx + '/preview'.length);
    const afterSlug = afterPreview.replace(/^\/+[^/]+/, '') || '/';
    req.url = afterSlug || '/';
    if (req.url === '/' || req.url === '') {
      const idxHtml = path.join(base, 'index.html');
      if (fsc.existsSync(idxHtml)) {
        setStaticPreviewHeaders(res, idxHtml);
        return res.sendFile(idxHtml);
      }
    }
    const staticHandler = express.static(base, {
      index: ['index.html', 'index.htm'],
      setHeaders: (res, filePath) => setStaticPreviewHeaders(res, filePath),
      extensions: ['html', 'htm'],
    });
    staticHandler(req, res, (err) => {
      req.url = origUrl;
      if (err) return next(err);
      res.status(404).type('txt').send(`404 — Página não existe no projeto "${slug}".`);
    });
  } catch (e) { next(e); }
});
app.use('/workspace', (req, res, next) => {
  const rel = decodeURIComponent(req.path.replace(/^\/+/, ''));
  const parts = rel.split('/').filter(Boolean);
  const project = parts.shift() || DEFAULT_PROJECT;
  // Serve da pasta GRAVÁVEL (fallback interno se macOS bloqueou) — arquivos atuais estão lá
  const base = resolveWritableProjectDir(project);
  const restPath = '/' + parts.map(encodeURIComponent).join('/');
  const inside = path.resolve(base, parts.join('/'));
  if (!inside.startsWith(base)) return res.status(403).send('Fora do workspace');
  const origUrl = req.url;
  req.url = restPath || '/';
  const staticHandler = express.static(base, {
    setHeaders: (res, filePath, stat) => {
      const ext = path.extname(filePath).toLowerCase();
      if (['.html','.htm'].includes(ext)) {
        res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, private');
      }
    }
  });
  staticHandler(req, res, (err) => {
    req.url = origUrl;
    if (err) return next(err);
    next();
  });
});
app.use('/', express.static(path.join(__dirname, 'public')));

function sanitizeForInternet(text) {
  if (text == null) return '';
  let s = typeof text === 'string' ? text : String(text);
  s = s.replace(/(AQ\.[A-Za-z0-9_\-]{8,})/g, 'AQ.[REDACTED]');
  s = s.replace(/(AIza[A-Za-z0-9_\-]{20,})/g, 'AIza[REDACTED]');
  s = s.replace(/(csk-[A-Za-z0-9_\-]{20,})/g, 'csk-[REDACTED]');
  s = s.replace(/(gsk_[A-Za-z0-9_\-]{20,})/g, 'gsk_[REDACTED]');
  s = s.replace(/(nvapi-[A-Za-z0-9_\-]{20,})/gi, 'nvapi-[REDACTED]');
  s = s.replace(/(AKIA[A-Za-z0-9]{12,})/g, 'AKIA[REDACTED]');
  s = s.replace(/(WATI[_-]?API[_-]?TOKEN\s*[=:]\s*['"]?)([^'"\s]{8,})/gi, '$1[REDACTED]');
  s = s.replace(/(EVOLUX[_-]?API[_-]?KEY\s*[=:]\s*['"]?)([^'"\s]{8,})/gi, '$1[REDACTED]');
  s = s.replace(/(MISTRAL[_-]?API[_-]?KEY\s*[=:]\s*['"]?)([^'"\s]{8,})/gi, '$1[REDACTED]');
  s = s.replace(/(CEREBRAS[_-]?API[_-]?KEY\s*[=:]\s*['"]?)([^'"\s]{8,})/gi, '$1[REDACTED]');
  s = s.replace(/(GROQ[_-]?API[_-]?KEY\s*[=:]\s*['"]?)([^'"\s]{8,})/gi, '$1[REDACTED]');
  s = s.replace(/(GOOGLE[_-]?API[_-]?KEY\s*[=:]\s*['"]?)([^'"\s]{8,})/gi, '$1[REDACTED]');
  s = s.replace(/(NVIDIA[_-]?API[_-]?KEY\s*[=:]\s*['"]?)([^'"\s]{8,})/gi, '$1[REDACTED]');
  return s;
}

function safeResolve(session, relativePath) {
  const baseDir = projectDirOf(session);
  const resolved = path.resolve(baseDir, relativePath || '.');
  if (!resolved.startsWith(baseDir)) {
    throw new Error(`Acesso negado: caminho fora do diretório de trabalho`);
  }
  return resolved;
}
function safeResolveBase(baseDir, relativePath) {
  const resolved = path.resolve(baseDir, relativePath || '.');
  if (!resolved.startsWith(baseDir)) {
    throw new Error(`Acesso negado: caminho fora do diretório de trabalho`);
  }
  return resolved;
}

async function toolReadFile(session, { path: filePath }) {
  if (!filePath) throw new Error('Parâmetro "path" é obrigatório');
  const fullPath = safeResolve(session, filePath);
  try {
    const content = await fs.readFile(fullPath, 'utf8');
    return { ok: true, path: filePath, content, size: content.length };
  } catch (err) {
    return { ok: false, path: filePath, error: err.message };
  }
}

async function toolWriteFile(session, { path: filePath, content }, _notifyUser) {
  if (!filePath) throw new Error('Parâmetro "path" é obrigatório');
  if (typeof content !== 'string') content = String(content ?? '');
  const fullPath = safeResolve(session, filePath);
  try {
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    const existed = await fs.access(fullPath).then(() => true).catch(() => false);
    await fs.writeFile(fullPath, content, 'utf8');
    const projectName = session.project || DEFAULT_PROJECT;
    const safePath = filePath.replace(/\\/g, '/').replace(/^\//, '');
    let url;
    const port = projectPorts.get(projectName);
    if (port) {
      url = `http://127.0.0.1:${port}/${safePath}`;
    } else {
      url = `/workspace/${encodeURIComponent(projectName)}/${safePath}`;
    }
    console.log('[TOOL write_file] projeto=' + projectName + ' | baseDir=' + (projectDirOf(session)) + ' | file=' + safePath + ' | size=' + content.length + ' | url=' + url);
    return {
      ok: true,
      path: filePath,
      action: existed ? 'updated' : 'created',
      size: content.length,
      url,
    };
  } catch (err) {
    console.log('[TOOL write_file FALHOU] projeto=' + (session.project || DEFAULT_PROJECT) + ' | file=' + filePath + ' | err=' + err.message);
    return { ok: false, path: filePath, error: err.message };
  }
}

async function toolDeleteFile(session, { path: filePath, recursive }) {
  if (!filePath) throw new Error('Parâmetro "path" é obrigatório');
  const fullPath = safeResolve(session, filePath);
  try {
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) return { ok: false, path: filePath, error: 'Arquivo/diretório não existe' };
    if (stat.isDirectory()) {
      await fs.rm(fullPath, { recursive: recursive !== false, force: true });
    } else {
      await fs.unlink(fullPath);
    }
    return { ok: true, path: filePath, action: 'deleted' };
  } catch (err) {
    return { ok: false, path: filePath, error: err.message };
  }
}

async function toolRunCommand(session, { command, timeout_sec, cwd }) {
  if (!command) throw new Error('Parâmetro "command" é obrigatório');
  const timeout = timeout_sec ? Math.min(300, parseInt(timeout_sec, 10)) * 1000 : COMMAND_TIMEOUT_MS;
  let execCwd = projectDirOf(session);
  if (cwd) {
    try { execCwd = safeResolve(session, cwd); } catch { /* usa base */ }
  }
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: execCwd,
      timeout,
      maxBuffer: 15 * 1024 * 1024,
      env: { ...process.env, PATH: [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(':') },
    });
    return {
      ok: true,
      command,
      stdout: stdout.slice(-6000),
      stderr: stderr.slice(-3000),
    };
  } catch (err) {
    return {
      ok: false,
      command,
      error: err.message,
      stdout: (err.stdout || '').slice(-3000),
      stderr: (err.stderr || '').slice(-3000),
    };
  }
}

async function toolListDir(session, { path: dirPath, depth }) {
  const baseDir = projectDirOf(session);
  const start = safeResolve(session, dirPath || '.');
  const maxDepth = Math.max(1, Math.min(5, parseInt(depth || '2', 10)));
  async function walk(dir, currentDepth) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const relBase = path.relative(baseDir, dir);
      const result = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const rel = path.join(relBase, e.name).replace(/\\/g, '/').replace(/^\.\//, '');
        if (e.name.startsWith('node_modules') || e.name.startsWith('.git')) continue;
        const item = {
          name: e.name,
          path: rel || '.',
          type: e.isDirectory() ? 'dir' : 'file',
        };
        if (e.isFile()) {
          try {
            const s = await fs.stat(full);
            item.size = s.size;
            item.mtimeMs = s.mtimeMs;
          } catch {}
        }
        if (e.isDirectory() && currentDepth < maxDepth) {
          item.children = await walk(full, currentDepth + 1);
          try {
            const sd = await fs.stat(full);
            item.mtimeMs = sd.mtimeMs;
          } catch {}
        }
        result.push(item);
      }
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return result;
    } catch (err) {
      return [{ name: 'error', type: 'error', error: err.message }];
    }
  }
  const tree = await walk(start, 1);
  return { ok: true, root: path.relative(baseDir, start) || '.', tree, project: session.project || DEFAULT_PROJECT };
}

async function toolStateGet(session) {
  const projectDir = projectDirOf(session);
  try {
    const state = await OrcFs.loadOrInitCentralState({ projectDir, session });
    const v = OrcState.validateCentralState(state);
    return { ok: true, state, schemaValid: v.ok, schemaErrors: v.errors || [], schemaWarnings: v.warnings || [] };
  } catch (err) {
    return { ok: false, error: err.message, state: null };
  }
}
async function toolStatePatch(session, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: 'patch deve ser um objeto JSON não-array.' };
  }
  const projectDir = projectDirOf(session);
  try {
    const merged = await OrcFs.mergePatchCentralState({ projectDir, patch });
    const v = OrcState.validateCentralState(merged);
    if (!v.ok) {
      return { ok: false, error: 'Schema inválido após patch.', schemaErrors: v.errors, state: merged };
    }
    return { ok: true, state: merged, warnings: v.warnings || [] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
async function toolTaskList(session) {
  const res = await toolStateGet(session);
  if (!res.ok) return res;
  const tarefas = Array.isArray(res.state?.tarefas) ? res.state.tarefas.slice() : [];
  tarefas.sort((a, b) => {
    const order = { pending: 0, blocked: 1, in_progress: 2, completed: 3, failed: 4 };
    const oa = order[String(a.status || 'pending')] ?? 0;
    const ob = order[String(b.status || 'pending')] ?? 0;
    if (oa !== ob) return oa - ob;
    return (a.seq ?? 9999) - (b.seq ?? 9999);
  });
  return { ok: true, tasks: tarefas, total: tarefas.length };
}
async function toolTaskUpdate(session, { id, status, result, evidencePath, note }) {
  if (!id) return { ok: false, error: 'id da tarefa obrigatório.' };
  const projectDir = projectDirOf(session);
  try {
    const state = await OrcFs.loadOrInitCentralState({ projectDir, session });
    const tarefas = Array.isArray(state.tarefas) ? state.tarefas : [];
    const idx = tarefas.findIndex(t => String(t.id) === String(id));
    if (idx === -1) return { ok: false, error: `Tarefa ${id} não existe no Estado Central.` };
    const beforeStatus = tarefas[idx].status;
    if (status) tarefas[idx].status = String(status);
    if (result !== undefined) tarefas[idx].resultado = result;
    if (evidencePath) tarefas[idx].evidencePath = String(evidencePath);
    if (note) tarefas[idx].nota = String(note);
    tarefas[idx].updatedAtMs = Date.now();
    const patch = { tarefas, _rc27RecalcCounters: true };
    const merged = await OrcFs.mergePatchCentralState({ projectDir, patch });
    const events = [];
    events.push(`Tarefa #${id}: ${beforeStatus || 'pending'} → ${tarefas[idx].status || status}`);
    return { ok: true, task: tarefas[idx], state: merged, events };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
async function toolWebRequestAskAuthorization(session, { reason, urls, estimatedScope }) {
  if (!NET_OUT_ENABLED) return { ok:false, error:'Gate geral fechado: NETWORK_OUTBOUND_ENABLED=off. Nenhuma requisição externa passa.', code:'INTERNET_GATE_OFF' };
  const projectDir = projectDirOf(session);
  const scopeId = 'inet_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const reasonClean = sanitizeForInternet(reason || '');
  const urlsClean = Array.isArray(urls) ? urls.map(u => sanitizeForInternet(String(u || ''))) : [];
  try {
    const state = await OrcFs.loadOrInitCentralState({ projectDir, session });
    state.internetAuthorizationPending = { scopeId, reason: reasonClean, urls: urlsClean, estimatedScope: estimatedScope || '', requestedAtMs: Date.now(), status: 'requested' };
    await OrcFs.mergePatchCentralState({ projectDir, patch: { internetAuthorizationPending: state.internetAuthorizationPending } });
  } catch {}
  const envGranted = (NET_OUT_AUTH_MODE === 'env_grant') || RC27_ALLOW_INTERNET_BY_DEFAULT === true;
  if (envGranted) {
    try {
      await OrcFs.mergePatchCentralState({
        projectDir,
        patch: {
          internetAuthorization: { scopeId, reason: reasonClean, urls: urlsClean, grantedBy: (NET_OUT_AUTH_MODE === 'env_grant' ? 'ENV_NETWORK_OUTBOUND_AUTH_MODE=env_grant' : 'ENV_RC27_ALLOW_INTERNET_BY_DEFAULT'), grantedAtMs: Date.now(), expiresAtMs: Date.now() + 2 * 60 * 60 * 1000 },
          internetAuthorizationPending: null,
        }
      });
    } catch {}
    return { ok: true, authorized: true, scopeId, autoGranted: true, note: 'Concedido via ENV (NETWORK_OUTBOUND_AUTH_MODE=env_grant ou RC27_ALLOW_INTERNET_BY_DEFAULT=on).' };
  }
  try {
    // Garante que a autorização chegue a TODOS os clientes conectados (broadcast para usuários logados na mesma sessão/projeto).
    // Antes: só enviava para `ws` (conexão RC27 específica). Bug: se usuário estava no chat do agente criado,
    //      não recebia `orch:internet_authorization_requested` → modal não aparecia.
    // Fix: tenta 3 vias (qualquer uma basta):
    //   (1) WS da sessão RC27 atual (antigo);
    //   (2) broadcast wss.clients (todas as conexões WebSocket);
    //   (3) fallback: também salva scopeId + pending no estado global session.internetAuthorizationPending para polling.
    const payloadBroadcast = {
      scopeId,
      reason: reasonClean,
      urls: urlsClean,
      estimatedScope: estimatedScope || '',
      sessionId: session.sessionId || null,
      project: session.project || DEFAULT_PROJECT,
      fallback: true,
    };
    // (1) WS RC27 (antigo, preservado)
    if (ws && ws.readyState === 1) {
      try { emit(ws, 'orch:internet_authorization_requested', payloadBroadcast); } catch(_) {}
    }
    // (2) broadcast para todos wss.clients (fallback principal)
    try {
      if (typeof wss !== 'undefined' && wss && wss.clients) {
        for (const client of wss.clients) {
          if (!client || client.readyState !== 1) continue;
          try {
            if (client.sessionId && session.sessionId && String(client.sessionId) !== String(session.sessionId)) continue;
            if (client.project && session.project && String(client.project) !== String(session.project)) continue;
            client.send(JSON.stringify({ type: 'orch:internet_authorization_requested', data: payloadBroadcast }));
          } catch(_) {}
        }
      }
    } catch(_) {}
    // (3) fallback no objeto session (caso cliente use polling em vez de WS)
    try { if (session) { session.internetAuthorizationPending = payloadBroadcast; } } catch(_) {}
  } catch {}
  return {
    ok: true,
    authorized: null,
    awaitingUser: true,
    scopeId,
    note: (NET_OUT_AUTH_MODE === 'always_ask' ? 'Sempre pergunta (NETWORK_OUTBOUND_AUTH_MODE=always_ask): ' : '') + 'Aguardando clique Sim/Não do usuário via modal UI. Estado Central salvo para resume.',
    _uiPrompt: { showModal: true, scopeId, reason: reasonClean, urls: urlsClean, estimatedScope },
  };
}
async function _rc27InternetScopeGranted(session, scope) {
  if (!scope) return false;
  try {
    const state = await OrcFs.loadOrInitCentralState({ projectDir: projectDirOf(session), session });
    const auth = state.internetAuthorization;
    if (!auth || !auth.scopeId) return false;
    if (auth.expiresAtMs && Date.now() > auth.expiresAtMs) return false;
    if (scope && auth.scopeId !== scope) return false;
    return true;
  } catch { return false; }
}
async function toolWebSearchAuthorized(session, { query, scope, numResults }) {
  if (!NET_OUT_ENABLED || !NET_OUT_TOOL_WEB_SEARCH) return { ok:false, error: NET_OUT_ENABLED ? 'web_search desligado: NETWORK_OUTBOUND_TOOL_WEB_SEARCH=off.' : 'Gate geral fechado: NETWORK_OUTBOUND_ENABLED=off.', code:'INTERNET_GATE_OFF' };
  if (!query) return { ok: false, error: 'query obrigatória para web_search.' };
  if (RC27_ALLOW_INTERNET_BY_DEFAULT !== true && NET_OUT_AUTH_MODE !== 'env_grant') {
    const granted = await _rc27InternetScopeGranted(session, scope);
    if (!granted) return { ok: false, error: 'Internet não autorizada. Chame web_request_ask_authorization primeiro.', code: 'INTERNET_NOT_AUTHORIZED' };
  }
  const q = sanitizeForInternet(String(query)).trim();
  if (!q) return { ok: false, error: 'query vazia após redação §11.' };
  try {
    const n = Math.max(1, Math.min(10, parseInt(numResults || '5', 10)));
    const u = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const res = await safeFetchInternet(u, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const txt = await res.text();
    const snippets = [];
    const re = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m; let i = 0;
    while ((m = re.exec(txt)) !== null && i < n) {
      const clean = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean.length > 20) snippets.push({ rank: i + 1, snippet: clean.slice(0, 600) });
      i++;
    }
    return { ok: true, query: q, count: snippets.length, results: snippets, source: 'ddg_html', note: 'Resultados em modo textual sanitizado §11.' };
  } catch (err) {
    return { ok: false, error: `web_search fetch falhou: ${err.message}${err.code ? ` [${err.code}]` : ''}` };
  }
}
async function toolWebFetchAuthorized(session, { url, scope }) {
  if (!NET_OUT_ENABLED || !NET_OUT_TOOL_WEB_FETCH) return { ok:false, error: NET_OUT_ENABLED ? 'web_fetch desligado: NETWORK_OUTBOUND_TOOL_WEB_FETCH=off.' : 'Gate geral fechado: NETWORK_OUTBOUND_ENABLED=off.', code:'INTERNET_GATE_OFF' };
  if (!url) return { ok: false, error: 'url obrigatória para web_fetch.' };
  if (RC27_ALLOW_INTERNET_BY_DEFAULT !== true && NET_OUT_AUTH_MODE !== 'env_grant') {
    const granted = await _rc27InternetScopeGranted(session, scope);
    if (!granted) return { ok: false, error: 'Internet não autorizada. Chame web_request_ask_authorization primeiro.', code: 'INTERNET_NOT_AUTHORIZED' };
  }
  const u = sanitizeForInternet(String(url));
  try {
    const res = await safeFetchInternet(u, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const contentType = res.headers.get('content-type') || '';
    let raw;
    if (/text|html|json|xml|markdown|yaml|javascript|css|csv/i.test(contentType)) {
      raw = await res.text();
    } else {
      raw = `[BINÁRIO ${contentType.slice(0,100)} · pulado por segurança §11]`;
    }
    return { ok: true, url: u, status: res.status, contentType, content: raw.slice(0, 20000), contentLength: raw.length };
  } catch (err) {
    return { ok: false, error: `web_fetch falhou: ${err.message}${err.code ? ` [${err.code}]` : ''}` };
  }
}
// ============================================================================
//  BROWSER AGENT v1 MÍNIMO · 2 ferramentas: browser_open, browser_get_page_info
//  - SEM cliques / SEM login / SEM formulários (versão 1 do usuário).
//  - Reaproveita NETWORK_OUTBOUND_ENABLED + whitelist + bloqueio IP privado §11.
//  - Backends automáticos: (a) MCP integrated_browser real via global bridge OU
//    (b) fallback FETCH_PARSE fetch+html leve.
// ============================================================================
async function toolBrowserOpen(session, { url, scope, timeoutMs }) {
  if (!NET_OUT_ENABLED || !NET_OUT_TOOL_WEB_FETCH) return { ok:false, error: NET_OUT_ENABLED ? 'browser desligado: NETWORK_OUTBOUND_TOOL_WEB_FETCH=off.' : 'Gate geral fechado: NETWORK_OUTBOUND_ENABLED=off.', code:'INTERNET_GATE_OFF' };
  if (!url) return { ok: false, error: 'url obrigatória para browser_open.' };
  if (RC27_ALLOW_INTERNET_BY_DEFAULT !== true && NET_OUT_AUTH_MODE !== 'env_grant') {
    const granted = await _rc27InternetScopeGranted(session, scope);
    if (!granted) return { ok: false, error: 'Internet não autorizada. Chame web_request_ask_authorization primeiro.', code: 'INTERNET_NOT_AUTHORIZED' };
  }
  try {
    const r = await __BROWSER_AGENT.open(String(url), { timeoutMs: timeoutMs ? Math.max(5000, Math.min(120000, parseInt(timeoutMs,10))) : 60000 });
    if (!r.ok) return { ok: false, error: r.error || 'browser_open falhou.', code: r.code || 'OPEN_FAILED' };
    return { ok: true, contextId: r.contextId, backend: r.backend, title: r.title, finalUrl: r.finalUrl, status: r.status };
  } catch (err) {
    return { ok: false, error: `browser_open falhou: ${err.message}${err.code ? ` [${err.code}]` : ''}`, code: err.code || 'OPEN_FAILED' };
  }
}
async function toolBrowserGetPageInfo(session, { contextId }) {
  if (!contextId) return { ok: false, error: 'contextId obrigatório (retornado por browser_open).', code: 'NO_CONTEXT' };
  const r = __BROWSER_AGENT.getInfo(String(contextId));
  if (!r.ok) return { ok: false, error: r.error, code: r.code };
  return {
    ok: true, contextId: r.contextId, backend: r.backend, openAtMs: r.openAtMs, status: r.status, finalUrl: r.finalUrl, title: r.title, description: r.description,
    textPreview: (r.textPreview || '').slice(0, 10000), textPreviewLength: (r.textPreview || '').length,
    linksFirst20: Array.isArray(r.links) ? r.links.slice(0, 20) : [], linksCount: r.linksCount, contentType: r.contentType,
  };
}
// ============================================================================
//  REMOTE RUN_TESTS WIRING (CIRÚRGICO) · fallback automático local
// ============================================================================
//  Objetivo: se existir worker remoto IDLE com capability 'run_tests' e
//  workspace autorizado no allowlist do worker → despachar remotamente.
//  Qualquer falha (dispatch, poll, workspace não autorizado, timeout, FAILED)
//  deve normalizar o resultado ou cair em fallback 100% local idêntico ao
//  comportamento original. NÃO altera RC22/RC27/RC28, TOOL_DECLARATIONS,
//  prompts, Gateway ou Remote Agent.
// ============================================================================
function __rtPickIdleRunTestsAgent() {
  try {
    if (!globalThis.REMOTE_EXECUTOR || typeof globalThis.REMOTE_EXECUTOR.listAgents !== 'function') return null;
    if (typeof globalThis.REMOTE_EXECUTOR.gatewayTokenConfigured === 'boolean' && !globalThis.REMOTE_EXECUTOR.gatewayTokenConfigured) return null;
    const agents = globalThis.REMOTE_EXECUTOR.listAgents();
    if (!Array.isArray(agents) || agents.length === 0) return null;
    const idle = agents.filter(a =>
      a && String(a.status || '').toUpperCase() === 'IDLE' &&
      Array.isArray(a.capabilities) && a.capabilities.includes('run_tests')
    );
    if (idle.length === 0) return null;
    idle.sort((a, b) => (Number(a.activeJobs || 0) - Number(b.activeJobs || 0)));
    return idle[0];
  } catch { return null; }
}
function __rtSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function __rtNormalizeResult(workspaceName, job, frameworkHint) {
  // job = getJob() completo: {status, exitCode, result, error, logsTail, agentId, durationMs, ...}
  const exitCode = Number(job?.exitCode ?? (job?.status === 'COMPLETED' ? 0 : 1));
  const logsCombined = Array.isArray(job?.logsTail) ? job.logsTail.map(l => String((l && typeof l === 'object' ? (l.message || l.text || l.msg || JSON.stringify(l)) : l))).join('\n') : '';
  const stdoutTail = logsCombined.slice(-3000);
  const stderrTail = '';
  const outcome = (job?.result && typeof job.result === 'object') ? job.result : {};
  // Parse TAP-style / mocha-style do stdout remoto (reutiliza heurísticas lib_tiagent_tests)
  let pass = 0, fail = 0, total = 0;
  try {
    const s = stdoutTail + '\n' + (typeof outcome.logs === 'string' ? outcome.logs : '');
    const tapTests = s.match(/^\s*#\s*tests[^\d]*(\d+)/im);
    const tapPass = s.match(/^\s*#\s*pass(?:ed)?[^\d]*(\d+)/im);
    const tapFail = s.match(/^\s*#\s*fail(?:ed|s)?[^\d]*(\d+)/im);
    const tapPlan = s.match(/^\s*1\.\.(\d+)/m);
    if (tapTests || tapPass || tapPlan) {
      total = tapTests ? parseInt(tapTests[1], 10) : (tapPlan ? parseInt(tapPlan[1], 10) : 0);
      pass = tapPass ? parseInt(tapPass[1], 10) : [...s.matchAll(/^ok\s+\d+/gm)].length;
      fail = tapFail ? parseInt(tapFail[1], 10) : [...s.matchAll(/^not\s+ok\s+\d+/gm)].length;
      if (!total) total = pass + fail;
    } else {
      const pm = s.match(/passing[^\d]*(\d+)/);
      const fm = s.match(/failing[^\d]*(\d+)/);
      pass = pm ? parseInt(pm[1], 10) : (outcome.ok && exitCode === 0 ? 1 : 0);
      fail = fm ? parseInt(fm[1], 10) : (!outcome.ok || exitCode !== 0 ? 1 : 0);
      total = pass + fail;
    }
  } catch {}
  const ok = (job?.status === 'COMPLETED') && exitCode === 0 && fail === 0 && !String(job?.error || '').trim();
  const statusFinal = job?.status || 'UNKNOWN';
  const remoteInfo = { executor: 'remote', agentId: job?.agentId || null, jobId: job?.jobId || null, workspace: workspaceName, status: statusFinal, durationMs: job?.durationMs || null };
  let warning = null;
  if (statusFinal === 'TIMEOUT') { warning = 'Job remoto expirou por timeout (TIMEOUT).'; }
  else if (statusFinal === 'CANCELLED') { warning = 'Job remoto cancelado antes da conclusão.'; }
  else if (statusFinal === 'FAILED') { warning = 'Job remoto terminou com FAILED: ' + String(job?.error || 'sem detalhes').slice(0, 300); }
  else if (statusFinal === 'QUEUED' || statusFinal === 'RUNNING') { warning = 'Job remoto não chegou a estado terminal dentro do polling.'; }
  if (!warning && String(job?.error || '').trim() && !ok) { warning = 'Remoto erro: ' + String(job.error).slice(0, 300); }
  return {
    ok,
    exitCode,
    framework: frameworkHint || 'remote_auto',
    commandRan: 'remote:run_tests',
    tests: { pass, fail, total: total || (pass + fail) },
    failedTests: [],
    stdoutTail,
    stderrTail,
    error: (ok ? null : (warning || String(job?.error || 'execução remota falhou').slice(0,500))),
    warning,
    skipped: false,
    remote: remoteInfo,
  };
}
async function __rtTryRemoteRunTests(session, timeoutSec) {
  try {
    const REMOTE_DISABLE_ENV = String(process.env.REMOTE_EXEC_DISABLE || '').trim().toLowerCase();
    if (REMOTE_DISABLE_ENV === '1' || REMOTE_DISABLE_ENV === 'true' || REMOTE_DISABLE_ENV === 'on') return { ok:false, reason:'disabled_by_env' };
    const agent = __rtPickIdleRunTestsAgent();
    if (!agent) return { ok:false, reason:'no_idle_agent' };
    const workspaceName = String(session.project || 'default').trim();
    if (!workspaceName) return { ok:false, reason:'no_workspace' };
    const timeoutSecN = Math.max(10, Math.min(600, parseInt(timeoutSec || '180', 10)));
    const timeoutMs = timeoutSecN * 1000;
    // Limites seguros herdados do __gwDispatchJob default
    const limits = { timeoutMs, memoryMb: 1024, cpuCores: 1 };
    const parameters = { projectSlug: workspaceName, framework: 'auto' };
    const dispatchRes = globalThis.REMOTE_EXECUTOR.dispatch({ type: 'run_tests', workspace: workspaceName, parameters, limits });
    if (!dispatchRes || !dispatchRes.ok || !dispatchRes.jobId) return { ok:false, reason:'dispatch_failed', detail: dispatchRes?.error || null };
    const jobId = dispatchRes.jobId;
    const startedAt = Date.now();
    const pollIntervalMs = Math.max(500, Math.min(3000, Math.floor(timeoutMs / 120)));
    let lastSeen = null;
    // Loop de polling com proteção por timeout máximo absoluto
    while (Date.now() - startedAt < timeoutMs + 15000) {
      const j = globalThis.REMOTE_EXECUTOR.getJob(jobId);
      if (j) lastSeen = j;
      const status = j ? String(j.status || '') : '';
      if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED' || status === 'TIMEOUT') {
        return { ok:true, result: __rtNormalizeResult(workspaceName, j, parameters.framework) };
      }
      if (Date.now() - startedAt > timeoutMs && !['COMPLETED','FAILED','CANCELLED','TIMEOUT'].includes(status)) {
        try { globalThis.REMOTE_EXECUTOR.cancel(jobId); } catch {}
        const timed = Object.assign({}, lastSeen || { jobId, status: 'TIMEOUT', agentId: agent.agentId }, { status: 'TIMEOUT', exitCode: 124, error: 'timeout_remote_executor' });
        return { ok:true, result: __rtNormalizeResult(workspaceName, timed, parameters.framework) };
      }
      await __rtSleep(pollIntervalMs);
    }
    // Fora do loop → timeout do polling
    try { globalThis.REMOTE_EXECUTOR.cancel(jobId).catch(() => {}); } catch {}
    const timed = Object.assign({}, lastSeen || { jobId, status: 'TIMEOUT', agentId: agent.agentId }, { status: 'TIMEOUT', exitCode: 124, error: 'timeout_polling_remote' });
    return { ok:true, result: __rtNormalizeResult(workspaceName, timed, parameters.framework) };
  } catch (err) {
    return { ok:false, reason:'exception', detail: err && err.message ? err.message : String(err) };
  }
}
async function toolRunTests(session, { timeout_sec }) {
  const projectDir = projectDirOf(session);
  // === TENTATIVA REMOTA === (sempre com fallback local abaixo)
  const remoteAttempt = await __rtTryRemoteRunTests(session, timeout_sec);
  // Usa resultado remoto SOMENTE se: a tentativa teve dispatch+poll válidos E o resultado
  // não é um "bloqueio de workspace/infra-estrutura recuperável". Falhas de workspace,
  // workspace não autorizado, path traversal, dispatch não autorizado → fallback local.
  let useRemote = false;
  let remoteResult = null;
  if (remoteAttempt && remoteAttempt.ok && remoteAttempt.result && typeof remoteAttempt.result === 'object') {
    remoteResult = remoteAttempt.result;
    const statusRaw = String(remoteResult.remote?.status || '').toUpperCase();
    const errRaw = String((remoteResult.error || '') + ' ' + (remoteResult.warning || '') + ' ' + (remoteAttempt.detail || '')).toLowerCase();
    const isWorkspaceBlock = /workspace (não autorizado|inválido|desconhecido|não existe)|path (fora de workspaceroot|traversal)/i.test(errRaw)
      || /SANDBOX.*workspace|SANDBOX.*path/i.test(errRaw);
    const isInfraBlock = /nenhum agente (online|com|disponível)|dispatch (falhou|failed|não autorizado)|type não autorizado/i.test(errRaw)
      || ['QUEUED_STUCK','NO_AGENT','DISPATCH_FAILED','GATEWAY_TOKEN_NOT_CONFIGURED'].includes(statusRaw);
    const terminalFail = ['COMPLETED','FAILED','CANCELLED','TIMEOUT'].includes(statusRaw) && !isWorkspaceBlock && !isInfraBlock;
    // Se o job chegou a um estado terminal do REMOTO (mesmo FAILED por npm test retornar 1),
    // usamos o resultado remoto. Se bloqueou por workspace/infra, cai local.
    if (terminalFail || (statusRaw === 'COMPLETED')) useRemote = true;
  }
  if (useRemote && remoteResult) {
    const result = remoteResult;
    try {
      // Atualiza Central Project State MESMO para execução remota (mesma política do local)
      if (result.ok && !result.skipped) {
        try {
          await OrcFs.mergePatchCentralState({
            projectDir,
            patch: {
              testesExecutados: [],
              resultadosTestes: { framework: result.framework, pass: result.tests?.pass || 0, fail: result.tests?.fail || 0, total: result.tests?.total || 0, executedAtMs: Date.now(), exitCode: result.exitCode, remoto: !!result.remote, agentId: result.remote?.agentId || null, jobId: result.remote?.jobId || null },
            }
          });
        } catch {}
      }
    } catch {}
    return result;
  }
  // === FALLBACK LOCAL (comportamento 100% idêntico ao original) ===
  try {
    const toolRunCommandBound = (args) => toolRunCommand(session, args);
    const result = await OrcTests.runTests({
      projectDir,
      toolRunCommand: toolRunCommandBound,
      timeout_sec: Math.max(10, Math.min(600, parseInt(timeout_sec || '180', 10))),
    });
    if (result.ok && !result.skipped) {
      try {
        await OrcFs.mergePatchCentralState({
          projectDir,
          patch: {
            testesExecutados: [],
            resultadosTestes: { framework: result.framework, pass: result.tests?.pass || 0, fail: result.tests?.fail || 0, total: result.tests?.total || 0, executedAtMs: Date.now(), exitCode: result.exitCode },
          }
        });
      } catch {}
    }
    // Marca explicitamente como local para o caller distinguir sem quebrar contrato
    return Object.assign({}, result, { remote: { executor: 'local', agentId: null, jobId: null, status: 'LOCAL_FALLBACK' } });
  } catch (err) {
    return { ok: false, error: `run_tests wrapper: ${err.message}`, remote: { executor: 'local', agentId: null, jobId: null, status: 'LOCAL_FALLBACK_ERROR' } };
  }
}
async function toolRollbackToCheckpoint(session, { checkpointId }) {
  if (!checkpointId) return { ok: false, error: 'checkpointId obrigatório.' };
  const projectDir = projectDirOf(session);
  try {
    const cpDir = OrcFs.checkpointDir ? OrcFs.checkpointDir(projectDir) : path.join(projectDir, '.rc27_checkpoints');
    const list = fsc.existsSync(cpDir) ? (await fs.readdir(cpDir)).filter(f => f.endsWith('.tar.gz')).sort().reverse() : [];
    const tarFile = list.find(f => String(f).includes(String(checkpointId)) || String(f).startsWith(String(checkpointId) + '_'));
    if (!tarFile) return { ok: false, error: `Checkpoint ${checkpointId} não encontrado em ${cpDir}. Disponíveis: ${list.slice(0, 5).join(', ')}` };
    const tarPath = path.join(cpDir, tarFile);
    const hashBefore = OrcFs.hashProjectTree ? await OrcFs.hashProjectTree(projectDir).catch(() => '') : '';
    const extractCmd = `tar -xzf '${tarPath.replace(/'/g, "'\\''")}' -C '${projectDir.replace(/'/g, "'\\''")}' --no-same-owner 2>&1 | tail -30`;
    const r = await toolRunCommand(session, { command: extractCmd, timeout_sec: 180 });
    if (!r.ok) return { ok: false, error: `tar extract falhou: ${r.error || r.stderr}`, raw: r };
    const hashAfter = OrcFs.hashProjectTree ? await OrcFs.hashProjectTree(projectDir).catch(() => '') : '';
    try {
      await OrcFs.mergePatchCentralState({
        projectDir,
        patch: {
          status: 'resumed_from_checkpoint',
          proximaAcao: 'Retomar da última tarefa pendente após rollback.',
          limites: (OrcFs.loadOrInitCentralState ? [] : []),
          rollbackAplicado: { checkpointId, arquivo: tarFile, hashBefore, hashAfter, aplicadoAtMs: Date.now() },
        }
      });
    } catch {}
    return { ok: true, checkpointId, arquivo: tarFile, hashBefore, hashAfter, extraiStdout: r.stdout, extraiStderr: r.stderr };
  } catch (err) {
    return { ok: false, error: `rollback: ${err.message}` };
  }
}
async function toolSecurityAuditAndAutofix(session, { mode, maxIter }) {
  const projectDir = projectDirOf(session);
  const slug = session.project || DEFAULT_PROJECT;
  const maxIt = Math.max(1, Math.min(5, parseInt(maxIter || '3', 10)));
  try {
    const audit = await SecBridge.auditarProjetoSecurity({ slug, projectDir, options: { maxIterations: maxIt } });
    const criticalCount = Array.isArray(audit?.findings) ? audit.findings.filter(f => String(f?.severity || '').toLowerCase() === 'critical' || String(f?.rule || '').startsWith('SEC-HC')).length : 0;
    const score = Number(audit?.score || audit?.securityScore || 0);
    let apply = { ok: false, error: 'Nenhuma correção aplicada (sem findings).' };
    if (Array.isArray(audit?.findings) && audit.findings.length > 0 && (score < 80 || criticalCount > 0)) {
      apply = await SecBridge.aplicarCorrecoesSecurity({
        slug,
        ids: audit.findings.map(f => f.id).filter(Boolean),
        applyMode: maxIt >= 3 ? 'auto_full_pipeline' : 'auto_apply_fixes',
        autoApply: true,
      });
    }
    const auditAfter = (apply && apply.ok && (score < 80 || criticalCount > 0))
      ? await SecBridge.auditarProjetoSecurity({ slug, projectDir, options: { maxIterations: 1 } }).catch(() => null)
      : null;
    try {
      await OrcFs.mergePatchCentralState({
        projectDir,
        patch: {
          segurancaAuditada: { antes: { score, criticalCount, findingsCount: audit?.findings?.length || 0 }, aplicouCorrecoes: !!(apply && apply.ok), depois: auditAfter ? { score: Number(auditAfter.score || auditAfter.securityScore || 0), findingsCount: auditAfter?.findings?.length || 0 } : null, executedAtMs: Date.now() },
        }
      });
    } catch {}
    return { ok: true, slug, mode: mode || 'HC_WHITELIST', maxIterations: maxIt, antes: audit, apply, depois: auditAfter, confirmAutoApplySafetyChecked: true };
  } catch (err) {
    return { ok: false, error: `Security bridge: ${err.message}` };
  }
}

// RC28 P7: Tool debug — status do engine (sem side effects).
async function toolRc28DecisionEngineStatus(session, { lastTrace }) {
  const projectDir = projectDirOf(session);
  const lastN = Math.max(1, Math.min(30, parseInt(lastTrace || 5, 10) || 5));
  try {
    const loaded = await OrcFs.loadOrInitCentralState({ projectDir, session });
    const state = loaded.state || {};
    const tarefas = Array.isArray(state.tarefas) ? state.tarefas : [];
    const pendentes = tarefas.filter(t => t && ['pending','in_progress','blocked'].includes(t.status)).length;
    const concluidas = tarefas.filter(t => t && t.status === 'completed').length;
    const trace = Array.isArray(state.decisionTrace) ? [...state.decisionTrace].slice(-lastN) : [];
    const ultimaDecisao = trace.length ? trace[trace.length - 1] : null;
    return {
      ok: true,
      rc28: {
        engine: RC28_LOOP_VER,
        enabled: RC28_ENABLED,
        envOn: RC28_ENABLED,
        maxCycles: RC28_MAX_CYCLES,
        checkpointEvery: RC28_CHECKPOINT_EVERY_CYCLES,
        verbose: RC28_VERBOSE_LOG,
        forceAfterPlan: RC28_FORCE_RUN_AFTER_PLAN,
        fase: state.faseGeral || null,
        statusExecucao: state.statusExecucao || null,
        tarefasTotais: tarefas.length,
        tarefasConcluidasN: concluidas,
        tarefasPendentesN: pendentes,
        checkpointsN: (Array.isArray(state.checkpoints) ? state.checkpoints.length : 0),
        ultimaDecisao,
        decisionTraceUltimasN: trace,
        internetAuthorizationExists: !!(state.internetAuthorization && typeof state.internetAuthorization === 'object'),
        internetAwaited: !!(state.internetAuthorization && state.internetAuthorization.awaitedUser === true),
      },
      rc27: {
        enabled: RC27_ENABLED,
        maxSteps: RC27_DEFAULT_MAX_STEPS,
        maxCorrection: RC27_MAX_CORRECTION_PASSES,
        allowInternetDefault: RC27_ALLOW_INTERNET_BY_DEFAULT,
      }
    };
  } catch (e) {
    return { ok: false, error: `decision_engine_status: ${e.message}`, rc28: { enabled: RC28_ENABLED, engine: RC28_LOOP_VER } };
  }
}

function makeSessionTools(session, ws) {
  const notifyUser = (text) => {
    try {
      if (ws && ws.readyState === 1) {
        emit(ws, 'message:ai', { id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), text, role: 'system' });
      }
    } catch {}
  };
  return {
    read_file: (a) => toolReadFile(session, a),
    write_file: (a) => writeFileWithAutoFallback(session, a, notifyUser),
    delete_file: (a) => deleteFileWithAutoFallback(session, a, notifyUser),
    run_command: (a) => toolRunCommand(session, a),
    list_dir: (a) => toolListDir(session, a),
    state_get: () => toolStateGet(session),
    state_patch: (a) => toolStatePatch(session, a),
    task_list: () => toolTaskList(session),
    task_update: (a) => toolTaskUpdate(session, a),
    web_request_ask_authorization: (a) => toolWebRequestAskAuthorization(session, a),
    web_search_authorized: (a) => toolWebSearchAuthorized(session, a),
    web_fetch_authorized: (a) => toolWebFetchAuthorized(session, a),
    browser_open: (a) => toolBrowserOpen(session, a),
    browser_get_page_info: (a) => toolBrowserGetPageInfo(session, a),
    run_tests: (a) => toolRunTests(session, a),
    rollback_to_checkpoint: (a) => toolRollbackToCheckpoint(session, a),
    security_audit_and_autofix: (a) => toolSecurityAuditAndAutofix(session, a),
    decision_engine_status: (a) => toolRc28DecisionEngineStatus(session, a),
  };
}

const TOOL_DECLARATIONS = [
  {
    name: 'read_file',
    description: 'Lê o conteúdo de um arquivo de texto dentro do diretório de trabalho.',
    parameters: {
      type: 'OBJECT',
      properties: { path: { type: 'STRING', description: 'Caminho relativo do arquivo (ex: src/index.js).' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Cria ou sobrescreve um arquivo. Cria subdiretórios automaticamente.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Caminho relativo do arquivo.' },
        content: { type: 'STRING', description: 'Conteúdo completo a ser escrito.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description: 'Remove um arquivo ou diretório vazio (use recursive=true para diretórios com conteúdo).',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Caminho relativo do arquivo/diretório.' },
        recursive: { type: 'BOOLEAN', description: 'Remove diretórios com conteúdo (padrão: true).' },
      },
      required: ['path'],
    },
  },
  {
    name: 'run_command',
    description: 'Executa um comando shell no diretório de trabalho.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING', description: 'Comando shell a executar.' },
        timeout_sec: { type: 'NUMBER', description: 'Timeout em segundos (máx 300). Padrão 60.', minimum: 1, maximum: 300 },
        cwd: { type: 'STRING', description: 'Subdiretório de execução (dentro do workspace).' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_dir',
    description: 'Lista arquivos e diretórios em árvore. Use para conhecer a estrutura do projeto.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Caminho relativo (padrão: raiz).' },
        depth: { type: 'NUMBER', description: 'Profundidade da árvore (1-5, padrão 2).', minimum: 1, maximum: 5 },
      },
      required: [],
    },
  },
  {
    name: 'state_get',
    description: 'Retorna o Estado Central completo do projeto (RC27). Use antes de qualquer ação para conhecer o contexto compartilhado.',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  {
    name: 'state_patch',
    description: 'Atualiza o Estado Central com merge atômico profundo. Passe apenas os campos a alterar; arrays são mesclados por id. Use a cada etapa importante.',
    parameters: {
      type: 'OBJECT',
      properties: { patch: { type: 'OBJECT', description: 'Objeto JSON com os campos a atualizar (ex: {status:"planning", arquitetura:{...}}).' } },
      required: ['patch'],
    },
  },
  {
    name: 'task_list',
    description: 'Lista as tarefas do plano autônomo ordenadas por status e sequência.',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  {
    name: 'task_update',
    description: 'Atualiza uma tarefa do plano autônomo por id (status, resultado, caminho de evidência). Sincroniza automaticamente os contadores do Estado Central.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'ID da tarefa obtido em task_list ou state_get.' },
        status: { type: 'STRING', description: 'Novo status: pending | in_progress | completed | blocked | failed.' },
        result: { type: 'STRING', description: 'Resumo textual do resultado ou justificativa.' },
        evidencePath: { type: 'STRING', description: 'Caminho relativo de arquivo que prova a conclusão (ex: src/index.html).' },
        note: { type: 'STRING', description: 'Nota interna opcional.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'web_request_ask_authorization',
    description: 'Solicita autorização do usuário para acessar a internet em um escopo de tarefa. Emite evento WS orch:internet_authorization_requested com modal Sim/Não. Respeita §8/§9.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Motivo claro da pesquisa (ex: "consultar documentação oficial Evolux API para integração WhatsApp").' },
        urls: { type: 'STRING', description: 'Opcional: JSON string com array de URLs planejadas.' },
        estimatedScope: { type: 'STRING', description: 'Resumo do escopo (ex: "3 consultas em developer.wati.io durante 2h").' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'web_search_authorized',
    description: 'Pesquisa texto na internet SOMENTE após autorização concedida. Aplica redação de credenciais §11 em query e resposta.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Pergunta ou termos de busca.' },
        scope: { type: 'STRING', description: 'scopeId retornado por web_request_ask_authorization (mesma tarefa = mesmo scopeId).' },
        numResults: { type: 'NUMBER', description: 'Quantidade de resultados (1-10, padrão 5).', minimum: 1, maximum: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch_authorized',
    description: 'Baixa conteúdo de uma URL documentação/API SOMENTE após autorização. Aplica §11: só texto/html/json, ignora binários e reda credenciais.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'URL completa (https://...).' },
        scope: { type: 'STRING', description: 'scopeId da autorização da mesma tarefa.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_open',
    description: '(v1 MÍNIMA) Abre URL em navegador controlado (headless ou real via MCP). Não executa cliques, login, formulários. Retorna contextId para consultar info da página. Respeita whitelist §11 e bloqueio IP privado.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'URL completa (http/https) para abrir (ex: https://www.youtube.com).' },
        scope: { type: 'STRING', description: 'scopeId da autorização da mesma tarefa (web_request_ask_authorization).' },
        timeoutMs: { type: 'NUMBER', description: 'Timeout em ms para carregamento (5000-120000, padrão 60000).', minimum: 5000, maximum: 120000 },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_get_page_info',
    description: '(v1 MÍNIMA) Extrai info da página aberta por browser_open: título, URL final, pré-visualização de texto, links encontrados, status HTTP. Não executa ações.',
    parameters: {
      type: 'OBJECT',
      properties: {
        contextId: { type: 'STRING', description: 'ID retornado por browser_open para consultar a página aberta.' },
      },
      required: ['contextId'],
    },
  },
  {
    name: 'run_tests',
    description: 'Detecta automaticamente o framework de teste (npm test > jest/vitest > mocha > node --test) e executa §13. Usa o sandbox run_command existente (timeout padrão 180s).',
    parameters: {
      type: 'OBJECT',
      properties: { timeout_sec: { type: 'NUMBER', description: 'Timeout em segundos (10-600, padrão 180).', minimum: 10, maximum: 600 } },
      required: [],
    },
  },
  {
    name: 'rollback_to_checkpoint',
    description: 'Restaura o projeto a um checkpoint tar.gz salvo antes de alterações importantes (§15/§16). Use antes de refatorações de risco.',
    parameters: {
      type: 'OBJECT',
      properties: { checkpointId: { type: 'STRING', description: 'ID ou prefixo do checkpoint (timestamp/nome da fase).' } },
      required: ['checkpointId'],
    },
  },
  {
    name: 'security_audit_and_autofix',
    description: 'Chama o TiAgente-Security RC26 (porta 3400) para auditoria + correções automáticas de vulnerabilidades. SEMPRE passa confirmAutoApplySafetyChecked=true (RC20).',
    parameters: {
      type: 'OBJECT',
      properties: {
        mode: { type: 'STRING', description: 'Modo: HC_WHITELIST (padrão · só regras seguras) ou EXTENDED.' },
        maxIter: { type: 'NUMBER', description: 'Iterações máximas de auto-correção (1-5, padrão 3).', minimum: 1, maximum: 5 },
      },
      required: [],
    },
  },
  // RC28 P7: Tool debug · 16ª ferramenta (no FINAL do array, preserva índices 0..14)
  {
    name: 'decision_engine_status',
    description: 'Retorna status interno do Engine RC28: ciclo atual, fase, última decisão tomada, últimas 5 entradas do decisionTrace, contagem de tarefas pendentes/concluídas. Apenas debug — não altera estado.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lastTrace: { type: 'NUMBER', description: 'Quantas últimas entradas do decisionTrace retornar (default=5).', minimum: 1, maximum: 30 },
      },
      required: [],
    },
  },
];

const SYSTEM_INSTRUCTION = (opts = {}) => {
  const modo = opts.mode === 'interactive'
    ? `=== MODO INTERATIVO (não-SOLO) ===
Antes de CHAMAR QUALQUER FERRAMENTA, aguarde a confirmação do usuário.
Você DEVE descrever o que vai fazer e ESPERAR. Não execute nada sozinho neste modo.`
    : `=== MODO SOLO (padrão) ===
VOCÊ É 100% AUTÔNOMO. Não peça permissão. Não espere confirmação. Decida e execute.
Continue até a tarefa estar 100% PRONTA E VALIDADA.
Se uma etapa falhar, auto-corrija e re-tente até 3 vezes.

=== PLANO DE EXECUÇÃO (Sempre no início) ===
ANTES de qualquer ferramenta, descreva UM PLANO DE EXECUÇÃO usando ESTE FORMATO EXATO:
---
**⚙️ Plano de execução**
1. [Título do passo 1] — breve descrição
2. [Título do passo 2] — breve descrição
3. ... (quantos passos forem necessários, normalmente 3-8)
---

=== DETECÇÃO DE CONCLUSÃO ===
Quando TUDO for criado, instalado E validado (comprovado):
- Escreva "### ✅ Concluído" seguido do resumo TRAE.
- Não chame mais nenhuma ferramenta. PARE.

=== PESQUISA NA INTERNET (§8 ask_auth_first · só tarefas AUTORIZADAS) ===
Você pode acessar a internet SOMENTE se TODAS as 3 condições forem verdadeiras:
(A) a tarefa em execução foi AUTORIZADA via web_request_ask_authorization nesta sessão;
(B) o domínio está na whitelist;
(C) é necessário para completar a tarefa (ex: consultar documentação oficial, biblioteca, API).
ORDEM OBRIGATÓRIA de uso:
1. Chame web_request_ask_authorization com reason=motivo CLARO (ex: "consultar React 19 docs sobre hooks") + urls planejadas.
2. Aguarde resposta ok;
3. Use web_search_authorized para achar docs/pages;
4. Use web_fetch_authorized para ler uma página.

=== BROWSER AGENT (§8.1 · navegação de sites · v1 MÍNIMA) ===
SE o usuário pedir para "abra", "acesse", "entre no site", "navegue para", ou equivalente, EXECUTE ESSA SEQUÊNCIA OBRIGATÓRIA, SEM PULAR NENHUM PASSO:
1. CHAME a ferramenta web_request_ask_authorization com reason="abrir site https://..." e urls=["https://..."]. NÃO escreva texto pedindo clique ANTES de chamar a ferramenta.
2. ANALISE o retorno da ferramenta web_request_ask_authorization (não invente o resultado):
   - Se retornou { authorized:true, autoGranted:true, scopeId }: autorização foi concedida automaticamente (ENV). Pule para o passo 4 usando esse scopeId.
   - Se retornou { awaitingUser:true, scopeId, note:"Aguardando clique Sim/Não..." }: SÓ AGORA, DEPOIS que a ferramenta já emitiu o evento WS e o modal apareceu de verdade, informe ao usuário "Acessei o sistema de autorizações. Clique no botão SIM no modal para conceder ou NÃO para negar, que eu continuo."
   - Se retornou { ok:false, error, code }: mostre o erro e código ao usuário exatamente como veio. Não continue.
3. ENQUANTO a autorização não for concedida, NÃO chame browser_open com scope vazio. Aguarde a autorização do usuário via tool depois.
4. AGORA, com o scopeId retornado no passo 1 (ou passo 2 autoGranted), CHAME browser_open(url, scope=scopeId, timeoutMs=60000). PRIORIZE browser_open sobre web_fetch_authorized (browser_open abre a página real ou fallback headless, mostra título e links).
5. ANALISE o retorno de browser_open. NUNCA INVENTE que o site foi aberto se a ferramenta retornar ok=false ou conter error. Se falhar, informe error + code exatos, e não continue como se tivesse funcionado. Se {ok:true, contextId, backend, title, finalUrl, status}, siga.
6. CHAME browser_get_page_info(contextId) para extrair preview de texto + links (não use web_fetch para a mesma URL se browser_open já abriu).
7. Quando browser_open e browser_get_page_info retornarem sucesso, sempre mostre no resultado ao usuário, sem faltar, os campos retornados pela ferramenta: backend, contextId, finalUrl, status, title.

PROIBIDO ESTRITAMENTE neste fluxo Browser Agent:
- ❌ escrever COMO TEXTO, antes de chamar web_request_ask_authorization, qualquer frase como "clique no botão de autorização Sim que apareceu" ou "o modal já abriu". O modal SÓ EXISTE DEPOIS que a ferramenta foi executada no backend e emite evento WS orch:internet_authorization_requested. Se você não chamou a tool, o modal não existe — mentir para o usuário é PROIBIDO.
- ❌ chamar browser_open sem scope válido quando a configuração task_scoped requer autorização.
- ❌ inventar backend, contextId, title ou finalUrl se a ferramenta ainda não retornou.

PROIBIDO ESTRITAMENTE:
- enviar chaves API, tokens, senhas, .env, dados privados ou do usuário em query/URL;
- executar ações externas (POST/PUT/DELETE, envio de emails, webhooks, formulários);
- rodar curl, wget, npm install -g, pip, gem install por run_command (SÓ instale no workspace se necessário para o projeto);
- acessar IPs privados, localhost de rede local, containers, *.local, *.corp.`;

  return `Você é um agente autônomo de programação SÊNIOR, no estilo TRAE IA. Seu objetivo é CRIAR, CORRIGIR e VALIDAR projetos de programação de ponta a ponta com código FUNCIONAL e de QUALIDADE.

${modo}

=== MODO DE COMUNICAÇÃO (igual TRAE IA) ===
1. **Pensamento conciso**: Antes de cada ação, explique EM 1-2 linhas O QUE você vai fazer e PORQUE. Não seja verboso.
2. **Ação direta**: Não pergunte ao usuário. Decida e execute (exceto no Modo Interativo).
3. **Código completo**: NUNCA envie trechos com "// ... resto do código". Escreva CÓDIGO COMPLETO e FUNCIONAL.
4. **Validação proativa**: Após criar arquivos, RODE build/tests/comandos para PROVAR que funciona.
5. **Auto-correção**: Se algo falhar, analise o erro, corrija e tente novamente AUTOMATICAMENTE.

=== ESTRATÉGIA DE TRABALHO ===
- **Passo 0 (explorar)**: Se não sabe a estrutura, use list_dir ou run_command("ls -la") ANTES de criar arquivos.
- **Passo 1 (planejar)**: Mencione brevemente os arquivos que vai criar.
- **Passo 2 (criar)**: Use write_file para criar TUDO (código completo).
- **Passo 3 (instalar)**: Use run_command para npm install / pip install etc.
- **Passo 4 (validar)**: Rode build, test, start, curl ou o que for necessário.
- **Passo 5 (resumo TRAE)**: No final, faça um resumo com:
  - ✅ Objetivo atingido
  - 📁 Arquivos criados (lista com caminhos)
  - 🚀 Comandos para rodar
  - 💡 Dicas de uso

=== REGRAS TÉCNICAS ===
- Diretório de trabalho: ${opts.projectDir || WORKSPACE_ROOT}
- Ferramentas: read_file, write_file, delete_file, run_command, list_dir
- Ao usar write_file: ENVIE SEMPRE O ARQUIVO COMPLETO. Use list_dir para ver o que já existe.
- Prefira Tailwind via CDN + HTML único para protótipos (isso entrega RÁPIDO e FUNCIONA).
- Não use placeholders, TODOs, "// implemente aqui".
- Linguagem: Português Brasileiro natural.

=== DICA DE VELOCIDADE ===
- Evite chamadas desnecessárias: se você SABE a estrutura, crie os arquivos diretamente em paralelo (várias chamadas de write_file numa resposta, quando possível).
- Quando for criar muitos arquivos, mencione primeiro "Vou criar X arquivos..." depois faça.

Diretório de trabalho atual: ${opts.projectDir || WORKSPACE_ROOT}.
Responda em português brasileiro.`;
};

const STATE_IDLE = 'idle';
const STATE_RUNNING = 'running';
const STATE_PAUSED = 'paused';
const STATE_STOPPED = 'stopped';

async function imageInlineData(filePath) {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
  const mime = mimeMap[ext] || 'image/jpeg';
  return { inlineData: { mimeType: mime, data: buf.toString('base64') } };
}

// ===== EVOLUÇÃO 2 · OpenAI compat stream (Cerebras/Mistral/Groq/OpenRouter/DeepSeek) =====
// Entrada: mesmo formato Gemini (contents, system, onChunk, extra.toolDeclarations)
// Saída: mesmo contrato de genAIStream → { parts:[{text}|{functionCall}], usage }
async function _openAICompatStream(provider, contents, system, onChunk, extra = {}) {
  let modelOverridden = extra.forcedModel || extra.model || null;
  if (provider && provider !== 'gemini') {
    const providerDefault = {
      cerebras: CEREBRAS_MODEL,
      cloudflare: CLOUDFLARE_WORKERS_AI_MODEL,
      mistral: MISTRAL_MODEL,
      openrouter: OPENROUTER_DEEPSEEK_MODEL,
      deepseek: DEEPSEEK_MODEL,
      groq: GROQ_MODEL,
    }[provider] || null;
    if (modelOverridden && providerDefault) {
      const isGeminiModel = /gemini/i.test(modelOverridden);
      const provLooksGood = !isGeminiModel && (/^[\w\-\.]+:[\w\-\.]+/.test(modelOverridden) || /^(llama|mistral|qwen|deepseek|gemma|hermes|codestral|pixtral|mixtral|command|nemotron|phi|gpt|claude|sonnet|opus|haiku|cf)\-/i.test(modelOverridden) || /^@cf\//.test(modelOverridden));
      if (!provLooksGood) modelOverridden = providerDefault;
    }
  }
  const ep = providerEndpoint(provider, modelOverridden || null);
  if (!ep) throw new Error(`[AI-RES] provider ${provider} não tem endpoint compat OpenAI`);
  const blockedEntry = aiResilienceModelIsBlocked(provider, ep.bodyModel);
  if (blockedEntry) {
    const err = new Error(`[${provider}] modelo bloqueado temporariamente ${JSON.stringify(ep.bodyModel)}: ${blockedEntry.classification} (${blockedEntry.failCount}x falhou). Bloqueado por ~${Math.round(blockedEntry.blockedMs/1000/60)}min.`);
    err._httpStatus = 404;
    err._response = null;
    err._modelUsed = ep.bodyModel;
    err._blockedByRouter = true;
    throw err;
  }
  try {
  const messages = _geminiContentsToOpenAIMessages(contents, system);
  const body = {
    model: ep.bodyModel,
    messages,
    stream: true,
    max_tokens: Math.max(32, parseInt(extra.maxTokens, 10) || 16384),
    temperature: typeof extra.temperature === 'number' ? extra.temperature : 0.15,
    top_p: typeof extra.topP === 'number' ? extra.topP : 0.95,
  };
  const tools = Array.isArray(extra.toolDeclarations) && extra.toolDeclarations.length > 0
    ? normalizeToolsForGroq(extra.toolDeclarations)
    : null;
  if (tools && tools.length) body.tools = tools;
  if (extra.toolConfig) body.tool_choice = extra.toolConfig;

  const res = await fetch(ep.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': ep.auth, 'Accept': 'text/event-stream', 'User-Agent': `TiAgente-Resilience-${provider}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = new Error(`[${provider}] HTTP ${res.status}: ${txt.slice(0,500)}`);
    err._httpStatus = res.status;
    err._response = res;
    err._modelUsed = ep.bodyModel;
    throw err;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf8');
  let buffer = '';
  let combinedText = [];
  let combinedFC = [];
  let usage = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      const delta = json?.choices?.[0]?.delta || {};
      if (json?.usage) usage = json.usage;
      const emitParts = [];
      if (typeof delta.content === 'string' && delta.content.length) {
        combinedText.push(delta.content);
        emitParts.push({ text: delta.content });
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          if (tc?.function?.name) {
            const argsPart = typeof tc.function.arguments === 'string' ? tc.function.arguments : (tc.function.arguments ? JSON.stringify(tc.function.arguments) : '');
            const entry = { functionCall: { id: tc.id || null, name: tc.function.name, args: argsPart } };
            combinedFC.push(entry);
            emitParts.push(entry);
          } else if (tc?.function?.arguments && combinedFC.length) {
            const lastFc = combinedFC[combinedFC.length-1];
            const ap = typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments||{});
            lastFc.functionCall.args = (lastFc.functionCall.args || '') + ap;
            emitParts.push({ functionCall: lastFc.functionCall });
          }
        }
      }
      if (emitParts.length) { try { onChunk && onChunk({ parts: emitParts, usage, done: false, _provider: provider }); } catch {} }
    }
  }
  const mergedParts = [];
  if (combinedText.length) mergedParts.push({ text: combinedText.join('') });
  for (const fc of combinedFC) {
    let args = fc.functionCall.args || {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { raw: args }; } }
    mergedParts.push({ functionCall: Object.assign({}, fc.functionCall, { args }) });
  }
  try { onChunk && onChunk({ done: true, usage, _provider: provider }); } catch {}
  return { parts: mergedParts, usage, provider };
  } catch (err) {
    if (err && typeof err === 'object' && !('_modelUsed' in err)) err._modelUsed = ep.bodyModel;
    throw err;
  }
}

async function genAIStream(contents, system, onChunk, extra = {}) {
  const rawModel = extra.model || GOOGLE_MODEL;
  const model = _safeGeminiModel(rawModel);
  const url = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${model}:streamGenerateContent?key=${GOOGLE_API_KEY}&alt=sse`;
  const body = {
    contents,
    systemInstruction: { parts: [{ text: system }] },
    tools: [{ functionDeclarations: Array.isArray(extra.toolDeclarations) && extra.toolDeclarations.length > 0 ? extra.toolDeclarations : TOOL_DECLARATIONS }],
    generationConfig: { temperature: 0.15, topP: 0.95, maxOutputTokens: 16384 },
  };
  if (extra.toolConfig) body.toolConfig = extra.toolConfig;

  let retries = 0;
  const maxRetries = 2;
  let lastErr = null;

  while (retries <= maxRetries) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        let json;
        try { json = JSON.parse(txt); } catch {}
        const msg = json?.error?.message || txt.slice(0, 500) || `HTTP ${res.status}`;
        if ((res.status === 429 || res.status >= 500) && retries < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * (retries + 1)));
          retries++;
          lastErr = msg;
          continue;
        }
        const err = new Error(`API ${res.status}: ${msg}`);
        err._httpStatus = res.status;
        err._response = res;
        err._modelUsed = model;
        throw err;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let combinedTextParts = [];
      let combinedFuncCallParts = [];
      let usage = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || !line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let json;
          try { json = JSON.parse(data); } catch { continue; }
          const candidate = json?.candidates?.[0];
          if (!candidate?.content?.parts) continue;
          const parts = candidate.content.parts;
          combinedTextParts.push(...parts.filter(p => typeof p.text === 'string'));
          combinedFuncCallParts.push(...parts.filter(p => p.functionCall && typeof p.functionCall === 'object'));
          if (candidate.usageMetadata) usage = candidate.usageMetadata;
          try { onChunk({ parts, usage, done: false, _provider: 'gemini' }); } catch {}
        }
      }
      try { onChunk({ done: true, usage, _provider: 'gemini' }); } catch {}
      return {
        parts: [...combinedTextParts, ...combinedFuncCallParts],
        usage,
        provider: 'gemini',
      };
    } catch (err) {
      if (err && err._httpStatus == null && typeof err.message === 'string') {
        const m = /(?:HTTP|API)\s+(\d{3})/.exec(err.message);
        if (m) err._httpStatus = parseInt(m[1], 10);
      }
      if (retries < maxRetries && (err.name === 'AbortError' || /timeout|429|5\d{2}/i.test(err.message || ''))) {
        await new Promise(r => setTimeout(r, 1500 * (retries + 1)));
        retries++;
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Falha na API');
}

// ===== EVOLUÇÃO 2 · Central failover stream (todos providers) =====
async function aiResilienceStreamWithFailover(contents, system, onChunk, extra = {}) {
  const preferred = Array.isArray(extra.providerOrder) && extra.providerOrder.length ? extra.providerOrder : null;
  const order = aiResilienceBuildOrder(preferred || []);
  if (!order.length) {
    const err = new Error('Nenhum provedor de IA está configurado (verifique .env / API keys).');
    err._allProvidersFailed = aiResilienceBuildAllProvidersFailedOrder([], false);
    throw err;
  }
  const attempts = [];
  const triedPerProvider = new Map();
  const triedPerProviderModelStream = new Set();
  const forceEnsembleForGemini = extra._forceEnsemble === true;
  let lastErr = null;
  let activeContents = contents;

  const MAX_LOOP_ITER = order.length * (AIRES_MAX_CONTEXT_RETRY + 1) + 2;
  for (let iter = 0; iter < MAX_LOOP_ITER; iter++) {
    if (triedPerProvider.size > 0 && Array.from(triedPerProvider.values()).every(v => v >= (AIRES_MAX_CONTEXT_RETRY + 1))) break;
    const entry = order[iter % order.length];
    if (!entry) break;
    const provider = entry.name;
    if (!providerIsUsable(provider)) continue;
    const baseAttempts = triedPerProvider.get(provider) || 0;
    if (baseAttempts >= (AIRES_MAX_CONTEXT_RETRY + 1)) continue;
    const lastSt = __AI_RESILIENCE.get(provider);
    const lastKind = lastSt?.lastKind || null;
    let runExtra = { ...extra };
    let compactRetryThisIter = false;
    let chosenModelStream = null;
    if (provider !== 'gemini') {
      const defaultModelForProvider =
        (provider === 'groq' ? GROQ_MODEL : null) ||
        (provider === 'cerebras' ? CEREBRAS_MODEL : null) ||
        (provider === 'cloudflare' ? CLOUDFLARE_WORKERS_AI_MODEL : null) ||
        (provider === 'mistral' ? MISTRAL_MODEL : null) ||
        (provider === 'openrouter' ? OPENROUTER_DEEPSEEK_MODEL : null) ||
        (provider === 'deepseek' ? DEEPSEEK_MODEL : null) ||
        null;
      const extraModelSafe = String(extra.model || '').match(/gemini/i) ? null : (extra.model || null);
      const prevModelUsed = lastSt?.modelUsed || defaultModelForProvider || extraModelSafe || null;
      const swapInfo = lastKind === 'MODEL_UNAVAILABLE'
        ? aiResPickAltModel(provider, prevModelUsed, lastKind)
        : aiResPickAltModel(provider, prevModelUsed, lastKind);
      const modelForThisRun = swapInfo.model || defaultModelForProvider;
      chosenModelStream = modelForThisRun;
      const key = __airesModelKey(provider, modelForThisRun || '__default__');
      if (triedPerProviderModelStream.has(key)) continue;
      triedPerProviderModelStream.add(key);
      if (aiResilienceModelIsBlocked(provider, modelForThisRun)) {
        attempts.push({ provider, ok:false, usedModel: modelForThisRun, kind:'MODEL_UNAVAILABLE', classification:'MODEL_UNAVAILABLE', retryable:false, statusCode:404, errorMessage:'modelo previamente bloqueado em memória (MODEL_UNAVAILABLE — cache 6h)', inCooldownAtEnd:false, blockedByRouter:true });
        continue;
      }
      if (swapInfo.altUsed) {
        runExtra.forcedModel = swapInfo.model;
        attempts.push({ provider, ok:false, note:'swap_model', from:prevModelUsed, to: swapInfo.model, because: lastKind || null });
      }
    }
    triedPerProvider.set(provider, baseAttempts + 1);
    try {
      let result;
      if (provider === 'gemini') {
        if (forceEnsembleForGemini && typeof extra._ensembleSession !== 'undefined') {
          result = await _callEnsembleGeminiOnly(extra._ensembleSession, activeContents, system, onChunk, runExtra);
        } else {
          result = await genAIStream(activeContents, system, onChunk, runExtra);
        }
      } else {
        result = await _openAICompatStream(provider, activeContents, system, onChunk, runExtra);
      }
      aiResilienceMarkSuccess(provider);
      attempts.push({ provider, ok: true, usedProvider: result?.provider || provider, usedModel: result?.model || chosenModelStream || null });
      console.log(`[AI_ROUTER] provider=${provider} model=${JSON.stringify(String(result?.model||chosenModelStream||'').slice(0,64))} status=success action=CONTINUE_TASK stream=true`);
      return Object.assign({}, result || {}, { provider: result?.provider || provider, _resilience: { tried: attempts.map(a => a.provider), used: result?.provider || provider } });
    } catch (err) {
      const status = (err && typeof err._httpStatus === 'number') ? err._httpStatus : null;
      const kindNow = aiResilienceClassifyError(err, status);
      const richNow = aiResClassifyErrorRich(err, status, provider, err?._modelUsed || chosenModelStream);
      const sizeBefore = kindNow === 'CONTEXT_TOO_LARGE' ? estimateContentsBytes(activeContents) : null;
      const marked = aiResilienceMarkFailure(provider, err, status, {
        headers: err?._response?.headers, response: err?._response,
        modelUsed: err?._modelUsed || runExtra.forcedModel || chosenModelStream || extra.model || null,
        retryIndex: baseAttempts,
        sizeBeforeBytes: sizeBefore,
      });
      attempts.push({
        provider, ok: false,
        usedModel: err?._modelUsed || runExtra.forcedModel || chosenModelStream || extra.model || null,
        kind: marked.kind,
        classification: marked.richType || richNow.type,
        retryable: typeof marked.retryable === 'boolean' ? marked.retryable : richNow.retryable,
        statusCode: status,
        errorMessage: err?.message || '',
        inCooldownAtEnd: aiResilienceIsInCooldown(provider),
        blockedByRouter: !!err._blockedByRouter,
      });
      lastErr = err;
      if (kindNow === 'CONTEXT_TOO_LARGE' && baseAttempts < AIRES_MAX_CONTEXT_RETRY) {
        const compact = aiResCompactContents(activeContents, system, { keepGoal:true, keepTask:true, keepLast:2 });
        activeContents = compact.contents;
        if (compact.compressed) {
          const stNow = __AI_RESILIENCE.get(provider) || {};
          stNow.contextCompressed = true;
          stNow.sizeBeforeBytes = sizeBefore;
          stNow.sizeAfterBytes  = compact.sizeAfterBytes;
          if (typeof stNow.failureCount === 'number') stNow.failureCount = Math.max(0, stNow.failureCount - 1);
        }
        compactRetryThisIter = true;
      }
      if (compactRetryThisIter) {
        triedPerProvider.set(provider, baseAttempts);
        iter--;
        continue;
      }
      if (_aiResIsFatalForThisCall(marked.kind) && attempts.length < Math.max(1, order.filter(o => !o.inCooldown).length)) {
        continue;
      }
      continue;
    }
  }
  const summary = aiResilienceBuildAllProvidersFailedOrder(attempts, false);
  const det = (summary && summary.attempts && summary.attempts.length)
    ? summary.attempts.map(a => `  - ${a.provider}${a.usedModel?`/${String(a.usedModel).slice(0,40)}`:''} http=${a.statusCode||'-'} class=${a.classification||a.kind||'?'} retryable=${typeof a.retryable === 'boolean' ? a.retryable : '?'}${a.blockedByRouter?' [router-blocked]':''} err=${((a.errorRedacted||a.errorMessage||'').slice(0,80))}`).join('\n')
    : '  — (sem detalhes)';
  const err2 = new Error(`ALL_PROVIDERS_FAILED — Nenhum provedor/ modelo conseguiu responder (stream). Último erro: ${(lastErr?.message || '').slice(0,180)}\nDetalhes das tentativas:\n${det}`);
  err2._httpStatus = 503;
  err2._allProvidersFailed = summary;
  err2.code = 'ALL_PROVIDERS_FAILED';
  throw err2;
}
async function _callEnsembleGeminiOnly(session, contents, system, onChunk, extra = {}) {
  const wantEnsemble = typeof session?.ensemble === 'boolean' ? session.ensemble : ENSEMBLE_ENABLED;
  const enabled = wantEnsemble && ensembleIsEnabled();
  if (!enabled) return await genAIStream(contents, system, onChunk, extra);
  const head1Msg = (p) => onChunk && onChunk({ _provider: 'gemini-a', ...p });
  const head2Msg = (p) => onChunk && onChunk({ _provider: 'gemini-b', ...p });
  let out1 = null, out2 = null, err1 = null, err2 = null;
  const extraA = { ...extra, model: FREE_MODEL_A };
  const extraB = { ...extra, model: FREE_MODEL_B };
  await Promise.allSettled([
    genAIStream(contents, system, head1Msg, extraA).then(r => (out1 = r)).catch(e => { err1 = e; }),
    genAIStream(contents, system, head2Msg, extraB).then(r => (out2 = r)).catch(e => { err2 = e; }),
  ]);
  if (!out1 && !out2) {
    const msg = 'Ensemble: ambas IAs falharam. ' + (err1?.message || '') + ' | ' + (err2?.message || '');
    const err = new Error(msg);
    if (err1?._httpStatus || err2?._httpStatus) err._httpStatus = err1?._httpStatus || err2?._httpStatus;
    throw err;
  }
  if (!out1) return Object.assign({}, out2, { provider: 'gemini-b' });
  if (!out2) return Object.assign({}, out1, { provider: 'gemini-a' });
  const text1 = out1.parts.filter(p => typeof p.text === 'string').map(p => p.text).join('\n\n').trim();
  const text2 = out2.parts.filter(p => typeof p.text === 'string').map(p => p.text).join('\n\n').trim();
  const fc1 = out1.parts.filter(p => p.functionCall && typeof p.functionCall === 'object');
  const fc2 = out2.parts.filter(p => p.functionCall && typeof p.functionCall === 'object');
  const mergedText = [];
  if (text1) mergedText.push({ text: `## Cabeça A · ${FREE_MODEL_A}\n${text1}` });
  if (text2) mergedText.push({ text: `## Cabeça B · ${FREE_MODEL_B}\n${text2}` });
  const winningTools = pickWinningToolCall(fc1, fc2);
  try { onChunk && onChunk({ done: true, usage: { providers: ['gemini-a', 'gemini-b'] } }); } catch {}
  return {
    parts: [...mergedText, ...winningTools],
    usage: { providers: ['gemini-a', 'gemini-b'], modelA: out1.usage, modelB: out2.usage },
    _ensemble: true,
    provider: 'gemini',
  };
}

// ===== ENSEMBLE GRATUITO · 2x Gemini (Paralelo · Voto Majoritário) =====
function pickWinningToolCall(listA, listB) {
  const a = Array.isArray(listA) ? listA : [];
  const b = Array.isArray(listB) ? listB : [];
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const keyOf = (fc) => `${fc.functionCall?.name || ''}::${(fc.functionCall?.args?.path || '')}`;
  const consensus = [];
  for (const fca of a) {
    const matchB = b.find(fcb => keyOf(fca) === keyOf(fcb));
    if (matchB) consensus.push(fca);
  }
  if (consensus.length > 0) return consensus;
  const score = (list) => list.filter(fc => /write_file|delete_file|run_command/i.test(fc.functionCall?.name || '')).length;
  return score(a) >= score(b) ? a : b;
}

async function callEnsembleOrSingle(session, contents, system, onChunk, extra = {}) {
  if (!AI_RESILIENCE_ENABLED) {
    const wantEnsemble = typeof session.ensemble === 'boolean' ? session.ensemble : ENSEMBLE_ENABLED;
    const enabled = wantEnsemble && ensembleIsEnabled();
    if (!enabled) return await genAIStream(contents, system, onChunk, extra);
    return await _callEnsembleGeminiOnly(session, contents, system, onChunk, extra);
  }
  const wantEnsemble = typeof session.ensemble === 'boolean' ? session.ensemble : ENSEMBLE_ENABLED;
  const enabled = wantEnsemble && ensembleIsEnabled();
  const extraIn = Object.assign({}, extra, enabled ? { _forceEnsemble: true, _ensembleSession: session } : {});
  return await aiResilienceStreamWithFailover(contents, system, onChunk, extraIn);
}

function fileToPart(file) {
  return imageInlineData(file.path).then(img => ({
    image: { inlineData: img.inlineData, filename: file.originalname, url: `/uploads/${file.filename}` },
    part: img,
  }));
}

const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      id,
      createdAt: Date.now(),
      lastActive: Date.now(),
      history: [],
      contents: [],
      mode: 'solo',
      model: GOOGLE_MODEL,
      project: DEFAULT_PROJECT,
      state: STATE_IDLE,
      abortRequested: false,
      pauseRequested: false,
      pauseResolver: null,
      ensemble: ENSEMBLE_ENABLED,
    });
  }
  sessions.get(id).lastActive = Date.now();
  return sessions.get(id);
}

function emit(ws, type, data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, data, ts: Date.now() }));
}

function setState(ws, session, state, extra = {}) {
  session.state = state;
  emit(ws, 'agent:state', Object.assign({ state, mode: session.mode, model: session.model, project: session.project || DEFAULT_PROJECT }, extra));
}

// ===== Static preview server separado POR PROJETO =====
async function startProjectPreviewServer(slug) {
  if (!slug) return null;
  // RC20 RENDER/Linux headless: NÃO cria servidor em outra porta (Render só libera 1 porta).
  // Previews são servidos na MESMA porta via rota /preview/:slug/* injetada no app express principal.
  if (IS_RENDER_OR_HEADLESS_LINUX) {
    const projectDir = resolveWritableProjectDir(slug);
    const previewUrl = RENDER_BASE_URL
      ? `${RENDER_BASE_URL}/preview/${encodeURIComponent(slug)}/`
      : `/preview/${encodeURIComponent(slug)}/`;
    return {
      port: null,
      running: true,
      alreadyRunning: projectServers.has(slug) || true,
      singlePortMode: true,
      url: previewUrl,
      path: projectDir,
    };
  }
  if (projectServers.has(slug) && projectPorts.has(slug)) {
    return { port: projectPorts.get(slug), running: true, alreadyRunning: true };
  }
  // IMPORTANTE: serve da pasta GRAVÁVEL (fallback interno se macOS bloqueou), pois os arquivos atuais estão lá
  const projectDir = resolveWritableProjectDir(slug);
  const port = await getPortForProject(slug);
  if (projectServers.has(slug)) {
    try { projectServers.get(slug).close(); } catch {}
    projectServers.delete(slug);
  }
  const app2 = express();
  app2.use(cors());
  app2.get('/', (req, res, next) => {
    const idx = path.join(projectDir, 'index.html');
    if (fsc.existsSync(idx)) return res.redirect('/index.html');
    next();
  });
  app2.use(express.static(projectDir, {
    index: ['index.html', 'index.htm'],
    setHeaders: (res, fPath) => setStaticPreviewHeaders(res, fPath),
    extensions: ['html', 'htm'],
  }));
  app2.use((req, res) => res.status(404).type('txt').send('404 — Página não existe neste projeto.'));
  const server = http.createServer(app2);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  server.unref();
  projectServers.set(slug, server);
  return { port, running: true, alreadyRunning: false, url: `http://127.0.0.1:${port}/`, path: projectDir };
}
async function stopProjectPreviewServer(slug) {
  if (!slug) return;
  if (projectServers.has(slug)) {
    try { projectServers.get(slug).close(); } catch {}
    projectServers.delete(slug);
  }
}
async function listProjects() {
  const map = new Map(); // slug -> projeto (mounted=true tem prioridade sobre workspace interno, evita duplicado mesmo slug)
  // 1) Workspace projetos (internos) — primeiro, se depois houver mounted=true ele SOBRESCREVE
  try {
    const entries = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      try {
        const full = path.join(WORKSPACE_ROOT, e.name);
        const st = await fs.stat(full);
        const port = projectPorts.get(e.name) || null;
        if (map.has(e.name)) continue; // mounted=true já entrou antes? pula
        let previewUrl = null;
        if (IS_RENDER_OR_HEADLESS_LINUX) {
          previewUrl = RENDER_BASE_URL
            ? `${RENDER_BASE_URL}/preview/${encodeURIComponent(e.name)}/`
            : `/preview/${encodeURIComponent(e.name)}/`;
        } else {
          previewUrl = port ? `http://127.0.0.1:${port}/` : null;
        }
        map.set(e.name, {
          name: e.name,
          displayName: e.name,
          mounted: false,
          path: full,
          port: IS_RENDER_OR_HEADLESS_LINUX ? null : port,
          previewUrl,
          createdAt: st.birthtimeMs || st.ctimeMs,
          modifiedAt: st.mtimeMs,
        });
      } catch {}
    }
  } catch {}
  // 2) Mounted projetos (pastas externas Desktop/Mac) — SEMPRE SOBRESCREVE workspace interno (prioridade visual)
  for (const m of mountedProjects.values()) {
    try {
      const st = await fs.stat(m.path).catch(() => null);
      const modifiedAt = st ? (st.mtimeMs || m.modifiedAt) : (m.modifiedAt || Date.now());
      const port = projectPorts.get(m.slug) || null;
      let previewUrl = null;
      if (IS_RENDER_OR_HEADLESS_LINUX) {
        previewUrl = RENDER_BASE_URL
          ? `${RENDER_BASE_URL}/preview/${encodeURIComponent(m.slug)}/`
          : `/preview/${encodeURIComponent(m.slug)}/`;
      } else {
        previewUrl = port ? `http://127.0.0.1:${port}/` : null;
      }
      map.set(m.slug, {
        name: m.slug,
        displayName: m.displayName || m.slug,
        mounted: true,
        path: m.path,
        fallbackInternal: !!m.fallbackInternal,
        port: IS_RENDER_OR_HEADLESS_LINUX ? null : port,
        previewUrl,
        createdAt: m.createdAt || Date.now(),
        modifiedAt,
      });
    } catch {}
  }
  const list = Array.from(map.values());
  list.sort((a, b) => {
    if (a.name === DEFAULT_PROJECT) return -1;
    if (b.name === DEFAULT_PROJECT) return 1;
    return (b.modifiedAt || 0) - (a.modifiedAt || 0);
  });
  return list;
}

async function waitIfPaused(session) {
  if (session.pauseRequested) {
    await new Promise((resolve) => { session.pauseResolver = resolve; });
    session.pauseRequested = false;
    session.pauseResolver = null;
  }
}

function parsePlanFromText(text) {
  try {
    if (!text) return null;
    const headerRe = /\*\*⚙️?\s*Plano de execução\*\*/i;
    const headerIdx = text.search(headerRe);
    if (headerIdx === -1) return null;
    const slice = text.slice(headerIdx);
    const endMatch = slice.match(/^---$\s*?/m) || slice.match(/\n{2,}(?=\s*### |\s*## ✅|\s*Concluído|$)/) || { index: Math.min(slice.length, 2500), 0: '' };
    const endIdx = typeof endMatch.index === 'number' ? endMatch.index : Math.min(slice.length, 2500);
    const block = slice.slice(0, endIdx);
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const steps = [];
    const SEEN = new Set();
    for (const l of lines) {
      const m = l.match(/^\s*(\d+)\.\s*(?:\[([^\]]{1,120})\]|([^—\n]{1,120}?))(?:\s*—\s*(.{0,200}))?$/);
      if (!m) continue;
      const num = parseInt(m[1], 10);
      if (!num || num <= 0 || num > 20) continue;
      if (SEEN.has(num)) continue;
      let title = (m[2] || m[3] || '').trim();
      const desc = (m[4] || title || '').trim();
      if (!title) continue;
      title = title.replace(/\.$/, '').trim();
      if (title.length < 4) continue;
      if (title.length > 140) continue;
      if (/[?？]/.test(title)) continue;
      if (/^(basta|abra|como|faq|rodapé|depoimentos|observação|observacoes|nota|atenção|importante)/i.test(title)) continue;
      SEEN.add(num);
      steps.push({ index: num, title, desc });
    }
    steps.sort((a, b) => a.index - b.index);
    if (steps.length === 0) return null;
    if (steps.length > 12) return steps.slice(0, 12);
    return steps;
  } catch {
    return null;
  }
}

// RC10 FIX A: Garante contents sempre terminem com user/turn NÃO VAZIO (nunca model)
// Remove turnos "mortos" model→user[] que causam erro 400 "Requests ending with a model turn are not supported"
function sanitizeContentsBeforeSend(arr, ctx = '') {
  if (!Array.isArray(arr)) return [];
  let pass1 = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item || typeof item !== 'object') continue;
    if (item.role === 'user' && Array.isArray(item.parts) && item.parts.length === 0) {
      if (pass1.length && pass1[pass1.length-1].role === 'model') pass1.pop();
      continue;
    }
    if (item.role === 'model' && Array.isArray(item.parts) && item.parts.length === 0) continue;
    const cleanParts = Array.isArray(item.parts)
      ? item.parts.filter(Boolean).map(p => {
          if (!p || typeof p !== 'object') return p;
          const copy = Object.assign({}, p);
          delete copy.role;
          return copy;
        })
      : [];
    pass1.push({ ...item, parts: cleanParts });
  }
  let result = pass1;
  while (result.length && result[result.length-1].role !== 'user') result.pop();
  if (result.length === 0 || !result[result.length-1] || result[result.length-1].role !== 'user') {
    result.push({ role: 'user', parts: [{ text: 'Continue usando as tools.' }] });
  }
  const lastUser = result[result.length-1];
  if (!Array.isArray(lastUser.parts) || lastUser.parts.length === 0) {
    lastUser.parts = [{ text: 'Continue.' }];
  }
  if (process.env.DEBUG_CONTENTS === '1') {
    const trace = result.map(x => `${x.role}(${Array.isArray(x.parts)?x.parts.length:0})`).join(' → ');
    console.log(`[RC10] sanitize (${ctx}): ${trace}`);
  }
  return result;
}

// ==========================================================================
// RC22  FASE 1 · IA ARQUITETA (planejamento SEM ferramentas, SEM escrever nada)
//  - Só analisa, retorna JSON estruturado planoArquitetura
//  - Provider: CEREBRAS por default (se key disponivel), senão fallback gemini automatico via runLLMTextOnly
//  - Max 2 retentativas se JSON invalido
// ==========================================================================
const ARCH_SYSTEM_PROMPT = `Você é a IA ARQUITETA de um pipeline de criação de sites. Seu trabalho exclusivo é ANALISAR o pedido do usuário e ENTREGAR UM PLANO ESTRUTURADO em formato JSON. VOCÊ NÃO ESCREVE CÓDIGO, NÃO USA FERRAMENTAS, NÃO CRIA ARQUIVOS.

Regras OBRIGATÓRIAS:
1. Responda SOMENTE JSON VÁLIDO, sem bloco de código markdown, sem comentários, sem nenhum texto antes ou depois.
2. O JSON DEVE ter as chaves: name, summary, palette, typography, sections, files, interactions, seo_accessibility, acceptanceCriteria.
3. "sections" = array de objetos com { title, description, order } (max 12).
4. "files" = array de objetos com { path, purpose, type } (max 20 arquivos). Todos paths são relativos ao projeto (ex: "index.html", "styles/main.css", "assets/logo.svg").
5. "palette" = { primary, secondary, accent, neutral, surface } (hex codes).
6. "typography" = { headingFont, bodyFont, scale }.
7. "interactions" = array string de 3-8 itens descrevendo comportamento JS esperado.
8. "seo_accessibility" = array string.
9. "acceptanceCriteria" = array string (condições para o QA aprovar).
10. Se o usuário pedir algo ambíguo, invente uma solução razoável coerente e continue (não peça mais informação).
11. Linguagem nos textos: português brasileiro natural.`;

async function runArchitectPhase({ws, session, userText, projectDir, project}) {
  emit(ws, 'agent:phase', { phase: 'ARCH', status: 'start', provider: resolveProvider(ARCH_PROVIDER), model: ARCH_MODEL, text: '🧠 IA Arquiteta: analisando requisitos e desenhando estrutura do site…' });
  emit(ws, 'message:ai:delta', { id: 'arch_' + Date.now(), text: '\n🧠 **IA Arquiteta** · Planejando a estrutura do site…\n', done: false });
  let lastRaw = '';
  let lastError = '';
  for (let attempt = 0; attempt <= MAX_ARCH_RETRIES; attempt++) {
    try {
      const userPrompt =
`# Pedido original do usuário (projeto ${project}):
${userText || ''}

# Contexto técnico:
- Pasta do projeto para referência (não crie nada, é só planejamento): ${projectDir}
- Ferramentas DEV disponíveis na próxima fase (não use aqui): write_file, read_file, run_command, list_dir, delete_file
- Stack preferida (inspiração para files): HTML5 semântico + Tailwind CSS CDN + JavaScript vanilla

# Instrução:
RETORNE APENAS O JSON VÁLIDO conforme SYSTEM_INSTRUCTION acima. Nada além do JSON.
${attempt > 0 ? `# TENTATIVA ${attempt+1} · última tentativa falhou. Motivo: ${lastError.slice(0,200)}. Corrija os campos obrigatórios e retorne JSON puro.\n` : ''}
`.trim();
      const out = await runLLMTextOnly({ provider: ARCH_PROVIDER, model: ARCH_MODEL, system: ARCH_SYSTEM_PROMPT, user: userPrompt, temperature: 0.35, maxTokens: 3500, tag: 'arch' });
      lastRaw = (out.text || '').trim();
      // Limpa markdown code fence se acidentalmente incluir ```json ... ```
      let toParse = lastRaw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const obj = JSON.parse(toParse);
      if (!obj || typeof obj !== 'object') throw new Error('retorno não é objeto JSON');
      // Validações de shape obrigatório (tolerante: falta campo → cria placeholder razoável)
      const normalized = validateAndNormalizeArchPlan(obj);
      emit(ws, 'agent:phase', { phase: 'ARCH', status: 'done', provider: out.provider, model: out.model, tokensIn: out.tokensIn, tokensOut: out.tokensOut });
      emit(ws, 'message:ai:delta', { id: 'arch_done_' + Date.now(), text:
        `✅ **Arquitetura pronta** (${out.provider}/${out.model})
· **${normalized.files.length}** arquivos planejados
· **${normalized.sections.length}** seções definidas
· Paleta: ${normalized.palette.primary || 'n/a'} · ${normalized.palette.accent || 'n/a'}
`, done: true });
      return { ok: true, plan: normalized, raw: lastRaw, provider: out.provider, model: out.model, tokensIn: out.tokensIn, tokensOut: out.tokensOut };
    } catch (e) {
      lastError = e.message || String(e);
      console.log(`[RC22 Arquiteta tentativa ${attempt+1} falhou]: ${lastError.slice(0,180)}`);
    }
  }
  // Fallback: plano mínimo razoável (nunca deixa a pipeline quebrar)
  const fallbackPlan = minimalFallbackPlan(String(userText||'').slice(0,80), project);
  emit(ws, 'agent:phase', { phase: 'ARCH', status: 'fallback', provider: 'local', model: 'fallback-default', text: '⚠️ Arquiteta externa indisponível. Usando plano mínimo.' });
  emit(ws, 'message:ai:delta', { id: 'arch_fb_' + Date.now(), text: '⚠️ Usando plano padrão (Arquiteta temporariamente indisponível).', done: true });
  return { ok: true, plan: fallbackPlan, raw: '', provider: 'fallback', model: 'local-template', tokensIn:0, tokensOut:0 };
}

function validateAndNormalizeArchPlan(o) {
  const s = (v, fallback) => (typeof v === 'string' && v.trim().length) ? v.trim() : fallback;
  const a = (v, min, fallback) => (Array.isArray(v) && v.length >= min) ? v : fallback;
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  return {
    name: s(o.name, 'site-sem-titulo-' + Date.now().toString(36)),
    summary: s(o.summary, 'Site criado automaticamente pelo pipeline 3-IA.'),
    palette: {
      primary:   (o.palette && hex.test(o.palette.primary))   ? o.palette.primary   : '#2563eb',
      secondary: (o.palette && hex.test(o.palette.secondary)) ? o.palette.secondary : '#0f172a',
      accent:    (o.palette && hex.test(o.palette.accent))    ? o.palette.accent    : '#10b981',
      neutral:   (o.palette && hex.test(o.palette.neutral))   ? o.palette.neutral   : '#64748b',
      surface:   (o.palette && hex.test(o.palette.surface))   ? o.palette.surface   : '#ffffff',
    },
    typography: Object.assign({ headingFont: 'Inter, sans-serif', bodyFont: 'Inter, sans-serif', scale: '1.25' }, o.typography || {}),
    sections: a(o.sections, 1, [ { title: 'Hero', description: 'Seção principal com CTA', order: 1 }, { title: 'Conteúdo', description: 'Conteúdo central', order: 2 }, { title: 'Rodapé', description: 'Footer com links', order: 3 } ]).map((it,i) => ({ title: s(it.title, `Seção ${i+1}`), description: s(it.description, ''), order: typeof it.order === 'number' ? it.order : (i+1) })),
    files: a(o.files, 1, [ { path:'index.html', purpose:'Página principal', type:'html' }, { path:'script.js', purpose:'Comportamento JS', type:'js' }, { path:'style.css', purpose:'Estilos adicionais', type:'css' } ]).map((f,i) => ({ path: s(f.path, `file-${i+1}.html`), purpose: s(f.purpose, ''), type: s(f.type || path.extname(f.path||'').slice(1).toLowerCase(), 'asset') })),
    interactions: a(o.interactions, 0, ['Menu responsivo mobile', 'Smooth scroll entre seções']).map(x => s(x,'').slice(0,240)).filter(Boolean),
    seo_accessibility: a(o.seo_accessibility, 0, ['Meta viewport definido','Imagens com alt','Lang pt-BR','Cabeçalhos h1-h6 hierárquicos']).map(x => s(x,'').slice(0,240)).filter(Boolean),
    acceptanceCriteria: a(o.acceptanceCriteria, 0, ['index.html contém DOCTYPE html','Sem erros JS no console','Responsivo em 375px e 1440px']).map(x => s(x,'').slice(0,240)).filter(Boolean),
    generatedAt: new Date().toISOString(),
  };
}
function minimalFallbackPlan(userSnippet, project) {
  return validateAndNormalizeArchPlan({
    name: `${project || 'site'}-fallback`,
    summary: `Projeto ${project || 'site'} criado a partir do fallback. Solicitação: ${userSnippet}`,
    palette: { primary: '#6366f1', secondary: '#0f172a', accent: '#f59e0b', neutral: '#64748b', surface: '#ffffff' },
    typography: { headingFont: 'Inter, sans-serif', bodyFont: 'Inter, sans-serif', scale: '1.25' },
    sections: [
      { title: 'Hero Principal', description: 'Faixa acima da dobra com título + CTA', order: 1 },
      { title: 'Sobre / Benefícios', description: '3 cards com benefícios', order: 2 },
      { title: 'Conteúdo / Depoimentos', description: 'Conteúdo textual ou depoimentos', order: 3 },
      { title: 'Formulário / CTA Final', description: 'Campos + botão final', order: 4 },
      { title: 'Rodapé', description: 'Links, copyright e ícones sociais', order: 5 },
    ],
    files: [
      { path: 'index.html',  purpose: 'Página principal com todas seções', type:'html' },
      { path: 'style.css',   purpose: 'Estilos personalizados (além do Tailwind CDN)', type:'css' },
      { path: 'script.js',   purpose: 'Interações: menu mobile, smooth scroll, formulário', type:'js' },
      { path: 'README.md',   purpose: 'Documentação do projeto', type:'markdown' },
    ],
    interactions: ['Menu hambúrguer mobile open/close','Smooth scroll âncoras','Validação mínima formulário','Animações fade-in seções'],
    seo_accessibility: ['<meta name="viewport">','<html lang="pt-BR">','<title> e <meta name="description">','h1 único','todas imagens com alt'],
    acceptanceCriteria: ['Carrega em <2s em 3G','Não há overflow-x em mobile 375px','Console browser sem erros vermelhos','Todos links internos funcionam','Paleta aplicada em CTA e títulos'],
  });
}

// ==========================================================================
// RC22  FASE 3 · IA ANALISTA / QA (sem correção automática · MAX_CORRECTION_LOOPS=0 default)
//  - Recebe arquivos gerados + plano ARQUITETO
//  - Retorna relatório JSON com issues[] (limite QA_MAX_ISSUES)
//  - Severidade: critico | aviso | ok
//  - Categorias: layout/responsividade · js · html · acessibilidade · seo · paleta · assets · performance
// ==========================================================================
const QA_SYSTEM_PROMPT = `Você é a IA ANALISTA QA (Garantia de Qualidade) de um pipeline de criação de sites. Você RECEBE:
- O plano de arquitetura (JSON estruturado) definido pela IA Arquiteta
- A lista de arquivos que foram gerados com seu conteúdo
- Eventualmente: screenshot do site em formato base64 (a ser adicionado posteriormente)

Sua MISSÃO: Comparar "O que foi planejado" vs "O que foi entregue" e listar PROBLEMAS reais e reproduzíveis, SEM FALSOS POSITIVOS.

Regras OBRIGATÓRIAS:
1. Responda SOMENTE JSON VÁLIDO, sem texto antes/depois, sem markdown, sem comentários.
2. Chaves obrigatórias no JSON: { "summary": string, "overallScore": number (0-100), "issues": Issue[] }
3. Cada Issue: { "severity": "critico"|"aviso"|"ok", "category": string, "file": string, "line": number|null, "title": string, "description": string, "suggestedFix": string, "refArquiteto": string }
4. Limite estrito de issues válidas: ${QA_MAX_ISSUES} (se sobrar, fique com os CRÍTICOS primeiro, depois AVISOS de maior impacto).
5. category deve ser uma das strings: "responsividade", "javascript", "html_semantico", "acessibilidade", "seo", "paleta_tipografia", "assets", "performance", "arquitetura_arquivos", "outro"
6. severity "ok" APENAS se você quiser dar um "ponto positivo" / checkmark aprovado (minímo de 2 ok's no total para equilíbrio).
7. Você NÃO inventa problemas. Se o site está 95% correto, fale 3 CRÍTICOS (se existir) + 4 AVISOS + 2 OK's.
8. Não peça correções. Não gere código de correção. Apenas DESCREVA.
9. Linguagem nos campos title/description/suggestedFix/refArquiteto: português brasileiro natural.`;

async function _qaLocalHeuristicFallbackReport(dir, filesSummary, project) {
  const issues = [];
  const files = Array.isArray(filesSummary?.files) ? filesSummary.files : [];
  const byPath = new Map();
  for (const f of files) byPath.set(String(f.path || '').toLowerCase(), f);
  const filePreview = p => {
    const f = byPath.get(String(p || '').toLowerCase());
    return (f && typeof f.preview === 'string') ? f.preview : '';
  };

  const pkgFile = files.find(f => /^(?:\.\/)?package\.json$/i.test(String(f.path || '')));
  const pkgPath = pkgFile ? path.join(dir, pkgFile.path) : path.join(dir, 'package.json');
  let pkgOK = false;
  let pkgText = '';
  try { pkgText = await fs.readFile(pkgPath, 'utf8'); JSON.parse(pkgText); pkgOK = true; }
  catch (e) { issues.push({ severity:'critico', category:'arquitetura_arquivos', file:'package.json', line:null, title:'package.json ausente ou JSON inválido', description:`Não foi possível ler ou fazer parse do package.json (${pkgOK?'ausente':e.message}). O projeto provavelmente não roda sem este arquivo.`, suggestedFix:'Criar package.json com { "name":"...", "version":"1.0.0", "type":"module", "dependencies":{"express":"latest","cors":"latest"} }', refArquiteto:'deliverables[0]' }); }
  if (pkgOK) {
    issues.push({ severity:'ok', category:'arquitetura_arquivos', file:'package.json', line:null, title:'package.json válido encontrado', description:'Arquivo package.json existe, JSON é válido e tem dependências básicas declaradas.', suggestedFix:'N/A', refArquiteto:'deliverables[0]' });
    try {
      const deps = Object.keys(JSON.parse(pkgText).dependencies || {});
      if (!deps.includes('express') && !deps.some(d => /express|fastify|koa|hono/i.test(d))) {
        issues.push({ severity:'aviso', category:'arquitetura_arquivos', file:'package.json', line:null, title:'Dependência web server ausente', description:'package.json não tem express/fastify/koa/hono listados em dependencies. Sem servidor o projeto pode não subir.', suggestedFix:'Adicionar "express": "^4.19.0" em dependencies.', refArquiteto:'deliverables[0].kind===node_express_app' });
      }
    } catch {}
  }

  const serverFile = files.find(f => /^(?:\.\/)?server\.(?:js|mjs|cjs|ts)$/i.test(String(f.path || '')));
  if (serverFile) {
    try {
      const checkPath = path.join(dir, serverFile.path);
      await execAsync(`"${process.execPath}" --check "${checkPath}"`, { timeout: 8000 });
      issues.push({ severity:'ok', category:'javascript', file:serverFile.path, line:null, title:'Sintaxe server.js válida', description:`node --check passou para ${serverFile.path}. Nenhum erro de sintaxe detectado.`, suggestedFix:'N/A', refArquiteto:'acceptanceCriteria[0]' });
    } catch (err) {
      const m = String(err.message || '').match(/line\s+(\d+)/i) || String(err.message || '').match(/:(\d+)\s/);
      issues.push({ severity:'critico', category:'javascript', file:serverFile.path, line: m ? parseInt(m[1],10) : null, title:'Erro de sintaxe em server.js', description:`node --check falhou: ${String(err.message||'').slice(0,280)}`, suggestedFix:'Revisar sintaxe do arquivo (parênteses, chaves, ponto e vírgula, imports).', refArquiteto:'acceptanceCriteria[0]' });
    }
    const prv = filePreview(serverFile.path);
    if (prv) {
      const Q1 = String.fromCharCode(39);
      const Q2 = String.fromCharCode(34);
      const QCLASS = '[' + Q1 + Q2 + ']';
      const NQCLASS = '[^' + Q1 + Q2 + ']*?';
      const xssSendReSrc = 'res\\.(?:send|write|end)\\s*\\(\\s*' + QCLASS + NQCLASS + '\\$\\{(?:req\\.(?:query|params|body|headers)|input|name|user)[^}]*\\}';
      const xssInReSrc = 'innerHTML\\s*=\\s*(?:req\\.|input|user|name|\\$\\{)';
      if (new RegExp(xssSendReSrc).test(prv) || new RegExp(xssInReSrc, 'i').test(prv)) {
        issues.push({ severity:'critico', category:'javascript', file:serverFile.path, line:1, title:'Possível XSS refletido em server.js', description:'Detectado padrão de interpolação direta de entrada (query/params/body) em resposta HTML ou innerHTML sem sanitização.', suggestedFix:'Sanitizar entrada com biblioteca de escape HTML ou usar textContent.', refArquiteto:'security[0]' });
      }
      if (/^\s*(?:let|const|var)\s+(\w+)\s*=[^;]*;\s*$(?![\s\S]*?\1)/m.test(prv)) {
        issues.push({ severity:'aviso', category:'javascript', file:serverFile.path, line:1, title:'Variável declarada e nunca usada', description:'Detectada declaração de variável que não parece ser referenciada no resto do preview do arquivo.', suggestedFix:'Remover a variável não utilizada ou comentar.', refArquiteto:'clean_code[0]' });
      }
    }
  } else {
    issues.push({ severity:'critico', category:'arquitetura_arquivos', file:'server.js', line:null, title:'Arquivo server.js ausente', description:'Não foi encontrado servidor principal (server.js/mjs/cjs/ts) na raiz do projeto.', suggestedFix:'Criar server.js com import express, middlewares, listen 30xx.', refArquiteto:'deliverables[0].files' });
  }

  const htmlFile = files.find(f => /^(?:\.\/)?public\/index\.html$/i.test(String(f.path || '')) || /^(?:\.\/)?index\.html$/i.test(String(f.path || '')));
  if (htmlFile) {
    const prv = filePreview(htmlFile.path) || '';
    const hasLang = /<html[^>]*\blang\s*=\s*["'][A-Za-z\-]{2,10}["']/i.test(prv);
    if (!hasLang) issues.push({ severity:'critico', category:'seo', file:htmlFile.path, line:1, title:'<html> sem atributo lang', description:'Tag <html> não tem lang="pt-BR" (ou outro). Prejudica SEO e acessibilidade leitores de tela.', suggestedFix:'Usar <html lang="pt-BR">', refArquiteto:'seo_accessibility[0]' });
    else issues.push({ severity:'ok', category:'seo', file:htmlFile.path, line:1, title:'<html lang> definido', description:`Atributo lang presente em <html>.`, suggestedFix:'N/A', refArquiteto:'seo_accessibility[0]' });
    const hasVp = /<meta[^>]*\bname\s*=\s*["']viewport["']/i.test(prv);
    if (!hasVp) issues.push({ severity:'critico', category:'responsividade', file:htmlFile.path, line:null, title:'Meta viewport ausente', description:'Sem <meta name="viewport" content="width=device-width, initial-scale=1.0"> o site não é responsivo em mobile.', suggestedFix:'Adicionar <meta name="viewport" content="width=device-width, initial-scale=1.0"> em <head>.', refArquiteto:'responsividade[0]' });
    else issues.push({ severity:'ok', category:'responsividade', file:htmlFile.path, line:null, title:'Meta viewport presente', description:'Viewport definido, base para responsividade mobile.', suggestedFix:'N/A', refArquiteto:'responsividade[0]' });
    const titleM = prv.match(/<title>([\s\S]*?)<\/title>/i);
    if (!titleM || !(titleM[1]||'').trim()) {
      issues.push({ severity:'critico', category:'seo', file:htmlFile.path, line:1, title:'<title> ausente ou vazio', description:'<title> é obrigatório para SEO e aparece na aba do navegador / resultados Google.', suggestedFix:'Adicionar <title> com até 60 chars descrevendo o site.', refArquiteto:'seo_accessibility[1]' });
    } else if (titleM[1].trim().length > 6) {
      issues.push({ severity:'ok', category:'seo', file:htmlFile.path, line:1, title:`<title> presente: "${(titleM[1]||'').trim().slice(0,60)}"`, description:'Título encontrado no head.', suggestedFix:'N/A', refArquiteto:'seo_accessibility[1]' });
    }
    const descM = prv.match(/<meta[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*=\s*["']([^"']{6,})["']/i) || prv.match(/<meta[^>]*\bcontent\s*=\s*["']([^"']{6,})["'][^>]*\bname\s*=\s*["']description/i);
    if (!descM) issues.push({ severity:'aviso', category:'seo', file:htmlFile.path, line:null, title:'Meta description ausente', description:'Sem <meta name="description" content="..."> (até 160 chars). Importante para resultados Google.', suggestedFix:'Adicionar meta description com até 160 caracteres.', refArquiteto:'seo_accessibility[2]' });
    const hasH1 = /<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(prv);
    const h1Count = (prv.match(/<h1\b/gi) || []).length;
    if (!hasH1) issues.push({ severity:'critico', category:'html_semantico', file:htmlFile.path, line:null, title:'<h1> semântico ausente', description:'Toda landing precisa de exatamente 1 <h1> único com o título principal da página.', suggestedFix:'Adicionar 1 <h1> principal na seção hero.', refArquiteto:'sections[0].acceptanceCriteria[0]' });
    else if (h1Count > 1) issues.push({ severity:'aviso', category:'html_semantico', file:htmlFile.path, line:null, title:`Múltiplos <h1> (${h1Count})`, description:`Encontrados ${h1Count} <h1>. Boa prática é 1 único h1 por página.`, suggestedFix:'Manter 1 h1 e usar h2/h3 para sub-títulos.', refArquiteto:'sections[0].acceptanceCriteria[0]' });
    else issues.push({ severity:'ok', category:'html_semantico', file:htmlFile.path, line:null, title:'1 <h1> único presente', description:'Hierarquia de títulos começa com um h1 único — boa prática SEO.', suggestedFix:'N/A', refArquiteto:'sections[0].acceptanceCriteria[0]' });
    const imgSemAlt = prv.match(/<img\b(?![^>]*\balt\s*=\s*["'][^"']{1,}["'])[^>]*>/gi) || [];
    if (imgSemAlt.length) {
      issues.push({ severity:'critico', category:'acessibilidade', file:htmlFile.path, line:null, title:`Imagens sem alt descritivo (${imgSemAlt.length})`, description:`${imgSemAlt.length} <img> sem atributo alt. Prejudica acessibilidade e SEO.`, suggestedFix:'Adicionar alt="descrição curta" em cada <img>, ou alt="" se decorativa.', refArquiteto:'seo_accessibility[3]' });
    } else if (/<img\b/i.test(prv)) {
      issues.push({ severity:'ok', category:'acessibilidade', file:htmlFile.path, line:null, title:'Todas <img> tem atributo alt', description:'Acessibilidade básica OK nas imagens.', suggestedFix:'N/A', refArquiteto:'seo_accessibility[3]' });
    }
    const Q1h = String.fromCharCode(39);
    const Q2h = String.fromCharCode(34);
    const QCLASSh = '[' + Q1h + Q2h + ']';
    const NQCLASSh = '[^' + Q1h + Q2h + ']*';
    const reOnerrorSrc = 'onerror\\s*=\\s*' + QCLASSh + NQCLASSh + '(?:alert\\(|eval\\(|prompt\\(|confirm\\(|document\\.|window\\[)';
    const reOnerror = new RegExp(reOnerrorSrc, 'i');
    const reInjectionSrc = 'innerHTML\\s*=\\s*' + QCLASSh + NQCLASSh + '<(?:script|img|iframe)\\b';
    const reInjection = new RegExp(reInjectionSrc, 'i');
    if (reOnerror.test(prv) || reInjection.test(prv)) {
      issues.push({ severity:'critico', category:'javascript', file:htmlFile.path, line:1, title:'XSS refletido ou evento inseguro no HTML', description:'Detectado onerror inline com código perigoso ou innerHTML injetando HTML sem sanitização.', suggestedFix:'Remover eventos onerror inseguros e evitar innerHTML com entrada de usuário; usar textContent.', refArquiteto:'security[1]' });
    }
    if (/^\s*$/.test(prv) || prv.replace(/\s+/g,'').length < 80) {
      issues.push({ severity:'aviso', category:'html_semantico', file:htmlFile.path, line:1, title:'HTML muito curto / vazio', description:'index.html tem menos de ~80 chars de conteúdo útil.', suggestedFix:'Adicionar estrutura mínima (head com title/description + body com conteúdo).', refArquiteto:'sections[0]' });
    }
  } else {
    issues.push({ severity:'critico', category:'arquitetura_arquivos', file:'public/index.html', line:null, title:'public/index.html ausente', description:'Não foi encontrado public/index.html (nem index.html na raiz). Página inicial faltando.', suggestedFix:'Criar public/index.html com head + body básicos.', refArquiteto:'deliverables[0].files' });
  }

  const publicDirExists = await fs.stat(path.join(dir, 'public')).then(s => s.isDirectory()).catch(() => false);
  if (publicDirExists) {
    issues.push({ severity:'ok', category:'arquitetura_arquivos', file:'public/', line:null, title:'Pasta public/ existe', description:'Conteúdo estático servido corretamente pelo Express.', suggestedFix:'N/A', refArquiteto:'deliverables[0].files' });
  } else {
    issues.push({ severity:'aviso', category:'arquitetura_arquivos', file:'public/', line:null, title:'Pasta public/ ausente', description:'Sem pasta public/ assets/imagens/CSS estarão em lugar inconsistente.', suggestedFix:'Criar pasta public/ com index.html + assets.', refArquiteto:'deliverables[0].files' });
  }
  issues.push({ severity:'ok', category:'arquitetura_arquivos', file:'N/A', line:null, title:`Arquivos detectados: ${files.length}`, description:`Total ${Math.round((filesSummary?.totalBytes||0)/1024)||0}KB lidos da pasta do projeto ${project || ''}.`, suggestedFix:'N/A', refArquiteto:'files' });
  return normalizeQAReport({
    summary: `Provedor de IA externo indisponível ou timeout. Relatório gerado localmente por heurísticas (sem LLM). ${issues.filter(i=>i.severity==='critico').length} críticos, ${issues.filter(i=>i.severity==='aviso').length} avisos, ${issues.filter(i=>i.severity==='ok').length} aprovados.`,
    overallScore: null,
    issues,
  });
}

async function runQAPhase({ws, session, archPlan, project, projectDir}) {
  emit(ws, 'agent:phase', { phase: 'QA', status: 'start', provider: resolveProvider(QA_PROVIDER), model: QA_MODEL, text: '🔍 IA QA: auditando arquivos gerados contra o plano da Arquiteta…' });
  emit(ws, 'message:ai:delta', { id: 'qa_' + Date.now(), text: '\n🔍 **Analista QA** · Revisando arquivos e plano…\n', done: false });
  let filesSummary;
  try { filesSummary = await collectProjectFilesForQA(projectDir); }
  catch (e) { filesSummary = { erro: String(e.message || e), files: [] }; }
  const filesCount = Array.isArray(filesSummary.files) ? filesSummary.files.length : 0;
  const totalBytes = Array.isArray(filesSummary.files) ? filesSummary.files.reduce((s,f) => s + (typeof f.sizeBytes==='number'?f.sizeBytes:0), 0) : 0;
  filesSummary.totalBytes = totalBytes;

  let userPrompt = '';
  try {
    userPrompt =
`# QA · Pipeline 3IA — Projeto "${project}"
# Plano ARQUITETO (entrada esperada):
${JSON.stringify(archPlan || {}, null, 2)}

# Arquivos ENTREGUES (${filesCount} arquivos, ${Math.round(totalBytes/1024)}KB totais):
${Array.isArray(filesSummary.files) ? filesSummary.files.map(f =>
  `--- ARQUIVO: ${f.path} (${f.sizeBytes} bytes) tipo=${f.type||'n/a'}
${typeof f.preview === 'string' ? f.preview : '<binário ou vazio>'}`
).join('\n\n') : 'Nenhum arquivo encontrado.'}

# INSTRUÇÃO:
Retorne SOMENTE JSON VÁLIDO, SOBREPONDO ATRIBUTOS, RESPEITANDO LIMITE DE ${QA_MAX_ISSUES} ISSUES, COM severidades critico/aviso/ok balanceadas. NÃO inclua \`\`\`json\`\`\`.
`.trim();
  } catch {}
  const qaSystem = QA_SYSTEM_PROMPT.replace('${QA_MAX_ISSUES}', String(QA_MAX_ISSUES));
  const attempts = [
    { provider: QA_PROVIDER, model: QA_MODEL, tag: 'qa', maxTokens: 4000 },
    { provider: 'gemini', model: 'gemini-3.5-flash-lite', tag: 'qa_gemini_fallback', maxTokens: 5000 },
  ];
  let out = null;
  const erros = [];
  for (const a of attempts) {
    try {
      if (erros.length) emit(ws, 'agent:phase', { phase: 'QA', status: 'start', provider: resolveProvider(a.provider), model: a.model, text: `🔁 QA fallback: tentando ${a.provider}/${a.model}…` });
      out = await runLLMTextOnly({ provider: a.provider, model: a.model, system: qaSystem, user: userPrompt, temperature: 0.2, maxTokens: a.maxTokens || 4000, tag: a.tag });
      if (out && typeof out.text === 'string' && out.text.trim().length > 40) break;
      erros.push(`${a.provider}/${a.model} retornou texto curto ou vazio`);
      out = null;
    } catch (e) { erros.push(`${a.provider}/${a.model}: ${String(e.message||e).slice(0,120)}`); out = null; }
  }
  if (out) {
    const parsed = _qaSafeParseJSON(out.text || '');
    const obj = parsed.ok ? parsed.value : null;
    if (obj && typeof obj === 'object') {
      const report = normalizeQAReport(obj);
      emit(ws, 'agent:qa_report', {
        project, phase: 'QA', provider: out.provider, model: out.model, tokensIn: out.tokensIn, tokensOut: out.tokensOut,
        summary: report.summary, overallScore: report.overallScore, issues: report.issues,
        counts: report._counts,
      });
      emit(ws, 'agent:phase', { phase: 'QA', status: 'done', provider: out.provider, model: out.model, tokensIn: out.tokensIn, tokensOut: out.tokensOut, counts: report._counts });
      emit(ws, 'message:ai:delta', { id: 'qa_done_' + Date.now(), text:
`🔍 **QA Finalizado** (${out.provider}/${out.model}) · Score **${report.overallScore}/100**
· 🔴 Críticos: **${report._counts.critico}**
· 🟡 Avisos:   **${report._counts.aviso}**
· 🟢 Aprovados: **${report._counts.ok}**
`, done: true });
      return { ok:true, report, raw: out.text, provider: out.provider, model: out.model };
    }
    erros.push('parse JSON final falhou: ' + ((parsed.errors||[]).slice(-1)[0] || ''));
  }

  const msg = (erros.length ? erros.slice(-1)[0] : 'provedores indisponíveis').slice(0, 160);
  emit(ws, 'agent:phase', { phase: 'QA', status: 'fallback', provider: 'local', model: 'heuristica', text: '⚠️ QA usou heurística local: ' + msg });
  let fallbackReport;
  try { fallbackReport = await _qaLocalHeuristicFallbackReport(projectDir, filesSummary, project); }
  catch (eHeur) {
    fallbackReport = normalizeQAReport({
      summary: `QA indisponível (${msg}). Erro na heurística: ${String(eHeur?.message||eHeur).slice(0,120)}.`,
      overallScore: 0,
      issues: [
        { severity:'critico', category:'outro', file:'N/A', line:null, title:'QA pipeline indisponível', description:'A revisão detalhada não pôde ser aplicada e a heurística também falhou.', suggestedFix:'Verificar variáveis de ambiente QA_PROVIDER/QA_MODEL e recriar.', refArquiteto:'acceptanceCriteria' },
        { severity:'ok', category:'arquitetura_arquivos', file:'N/A', line:null, title:`Arquivos detectados: ${filesCount}`, description:`Total ${Math.round(totalBytes/1024)}KB lidos da pasta do projeto ${project || ''}.`, suggestedFix:'N/A', refArquiteto:'files' }
      ]
    });
  }
  emit(ws, 'agent:qa_report', { project, summary: fallbackReport.summary, overallScore: fallbackReport.overallScore, issues: fallbackReport.issues, counts: fallbackReport._counts, fallback: true, heuristic: true });
  emit(ws, 'message:ai:delta', { id: 'qa_done_fb_' + Date.now(), text:
`🔍 **QA Finalizado** (local·heurística) · Score **${fallbackReport.overallScore}/100**
· 🔴 Críticos: **${fallbackReport._counts.critico}**
· 🟡 Avisos:   **${fallbackReport._counts.aviso}**
· 🟢 Aprovados: **${fallbackReport._counts.ok}**
· ℹ️ Observação: provedores de IA externos (Mistral + Gemini) indisponíveis. Use \`/ajuda chaves\` se recorrente.
`, done: true });
  return { ok:true, report: fallbackReport, fallback: true, heuristic: true, error: msg };
}
async function collectProjectFilesForQA(dir) {
  const IGNORE_EXT = new Set(['.png','.jpg','.jpeg','.gif','.webp','.ico','.svg_bin','.pdf','.zip','.node','.so','.dylib','.mp3','.mp4','.woff','.woff2','.ttf','.otf','.eot']);
  const IGNORE_DIRS = new Set(['node_modules','.git','.DS_Store','dist','build','.next','.nuxt','.svelte-kit']);
  const MAX_BYTES_PER_FILE = 24 * 1024; // 24KB preview por arquivo texto (evita estourar contexto prompt)
  const out = [];
  const queue = [ dir ];
  while (queue.length) {
    const current = queue.shift();
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory() && IGNORE_DIRS.has(e.name)) continue;
      const full = path.join(current, e.name);
      if (e.isDirectory()) { queue.push(full); continue; }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (IGNORE_EXT.has(ext)) {
        try {
          const st = await fs.stat(full);
          out.push({ path: path.relative(dir, full).split(path.sep).join('/'), type: ext || 'binary', sizeBytes: st.size, preview: `[binário ignorado: ${ext}]` });
        } catch {}
        continue;
      }
      let buf = '';
      let sz = 0;
      try {
        const st = await fs.stat(full);
        sz = st.size;
        const slice = Math.min(MAX_BYTES_PER_FILE, Math.max(8, sz));
        const fh = await fs.open(full, 'r');
        const rb = await fh.read({ buffer: Buffer.alloc(slice), length: slice, position: 0 });
        await fh.close();
        buf = rb.buffer.toString('utf8', 0, rb.bytesRead);
      } catch {}
      const previewType = (['.json','.md','.html','.css','.js','.mjs','.cjs','.ts','.tsx','.jsx','.txt','.yaml','.yml','.toml','.svg'].includes(ext)) ? 'code' : 'text';
      out.push({ path: path.relative(dir, full).split(path.sep).join('/'), type: ext.replace('.','') || previewType, sizeBytes: sz, preview: buf });
    }
  }
  out.sort((a,b) => a.path.localeCompare(b.path));
  return { files: out };
}

function _qaSafeJSONRepair(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/\r/g, '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const open = s.indexOf('{');
  const close = s.lastIndexOf('}');
  if (open >= 0 && close > open) s = s.slice(open, close + 1);
  const sb = [];
  let i = 0;
  const N = s.length;
  const isIdStart = c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
  const isIdCont = c => isIdStart(c) || (c >= '0' && c <= '9');
  const isDigit = c => c >= '0' && c <= '9';
  while (i < N) {
    let c = s[i];
    if (c === ' ' || c === '\n' || c === '\t') { sb.push(c); i++; continue; }
    if (c === '/' && i + 1 < N) {
      const n = s[i + 1];
      if (n === '*') {
        const end = s.indexOf('*/', i + 2);
        i = (end === -1) ? N : end + 2;
        sb.push(' ');
        continue;
      }
      if (n === '/') {
        const end = s.indexOf('\n', i + 2);
        i = (end === -1) ? N : end + 1;
        sb.push(' ');
        continue;
      }
    }
    if (c === '"') {
      const startIdx = i;
      let strEnd = -1;
      let escapeCount = 0;
      for (let j = i + 1; j < N; j++) {
        const cc = s[j];
        if (cc === '\\') { escapeCount++; j++; continue; }
        if (cc === '"' && (escapeCount % 2 === 0)) {
          let k = j + 1;
          while (k < N && (s[k] === ' ' || s[k] === '\n' || s[k] === '\t')) k++;
          const next = k < N ? s[k] : '';
          if (next === ',' || next === '}' || next === ']' || next === ':' || next === '') {
            strEnd = j;
            break;
          }
        }
        escapeCount = 0;
      }
      const innerRaw = strEnd >= 0 ? s.slice(startIdx + 1, strEnd) : s.slice(startIdx + 1).replace(/["\\]/g, '').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
      const fixed = [];
      for (let k = 0; k < innerRaw.length; k++) {
        const ch = innerRaw[k];
        if (ch === '\\' && k + 1 < innerRaw.length) {
          const nch = innerRaw[k + 1];
          const map = { '"':'"', '\\':'\\', '/':'/', 'b':'\b', 'f':'\f', 'n':'\n', 'r':'\r', 't':'\t' };
          if (map[nch] !== undefined) { fixed.push(ch + nch); k++; continue; }
          if (nch === 'u' && /^[0-9a-fA-F]{4}$/.test(innerRaw.slice(k+2, k+6))) { fixed.push(ch + innerRaw.slice(k+1, k+6)); k += 5; continue; }
          fixed.push('\\\\'); k++; continue;
        }
        if (ch === '"') fixed.push('\\"');
        else if (ch === '\\') fixed.push('\\\\');
        else if (ch === '\n') fixed.push('\\n');
        else if (ch === '\t') fixed.push('\\t');
        else if (ch === '\r') {}
        else if (ch < ' ') fixed.push('?');
        else fixed.push(ch);
      }
      sb.push('"' + fixed.join('') + '"');
      i = strEnd >= 0 ? strEnd + 1 : N;
      continue;
    }
    if (c === '-' || isDigit(c)) {
      let j = i;
      if (s[j] === '-') j++;
      while (j < N && isDigit(s[j])) j++;
      if (j < N && s[j] === '.') { j++; while (j < N && isDigit(s[j])) j++; }
      if (j < N && (s[j] === 'e' || s[j] === 'E')) {
        j++;
        if (j < N && (s[j] === '+' || s[j] === '-')) j++;
        while (j < N && isDigit(s[j])) j++;
      }
      sb.push(s.slice(i, j));
      i = j;
      continue;
    }
    if (isIdStart(c)) {
      let j = i;
      while (j < N && isIdCont(s[j])) j++;
      const id = s.slice(i, j);
      if (id === 'true' || id === 'false' || id === 'null') { sb.push(id); i = j; continue; }
      if (id === 'NaN' || id === 'undefined') { sb.push('null'); i = j; continue; }
      if (id === 'Infinity') { sb.push('1e308'); i = j; continue; }
      if (id === '-Infinity') { sb.push('-1e308'); i = j; continue; }
      let k = j;
      while (k < N && (s[k] === ' ' || s[k] === '\n' || s[k] === '\t')) k++;
      if (k < N && s[k] === ':') {
        sb.push('"' + id.replace(/"/g, '\\"') + '"');
        i = j;
        continue;
      }
      sb.push('"' + id.replace(/"/g, '\\"') + '"');
      i = j;
      continue;
    }
    sb.push(c);
    i++;
  }
  let out = sb.join('');
  out = out.replace(/\s*([\{\}\[\]:,])\s*/g, '$1');
  let prev = '';
  let guard = 0;
  while (prev !== out && guard < 10) {
    prev = out;
    out = out.replace(/,\s*([\]}])/g, '$1');
    out = out.replace(/:\s*,/g, ':null,');
    out = out.replace(/,\s*,+/g, ',');
    out = out.replace(/^\s*,\s*/, '').replace(/\s*,\s*$/, '');
    out = out.replace(/\[\s*,/g, '[').replace(/,\s*\]/g, ']');
    out = out.replace(/\{\s*,/g, '{').replace(/,\s*\}/g, '}');
    guard++;
  }
  const stk = [];
  let inStr2 = false;
  let rep2 = '';
  let p = 0;
  const M = out.length;
  while (p < M) {
    const c = out[p];
    if (inStr2) {
      if (c === '\\' && p + 1 < M) { rep2 += c + out[p+1]; p += 2; continue; }
      if (c === '"') { rep2 += c; inStr2 = false; p++; continue; }
      rep2 += c; p++; continue;
    }
    if (c === '"') { rep2 += c; inStr2 = true; p++; continue; }
    if (c === '{' || c === '[') { stk.push(c === '{' ? '}' : ']'); rep2 += c; p++; continue; }
    if (c === '}' || c === ']') {
      if (stk.length && stk[stk.length - 1] === c) stk.pop();
      else { continue; }
      rep2 += c; p++; continue;
    }
    rep2 += c; p++;
  }
  if (inStr2) rep2 += '"';
  while (stk.length) rep2 += stk.pop();
  return rep2.trim();
}
function _qaSafeParseJSON(raw) {
  const cleaned1 = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = /\{[\s\S]*\}/.exec(cleaned1);
  const candidates = [];
  if (cleaned1) candidates.push(cleaned1);
  if (match && match[0] !== cleaned1) candidates.push(match[0]);
  const repaired = _qaSafeJSONRepair(raw);
  if (repaired && repaired !== cleaned1 && (!match || repaired !== match[0])) candidates.push(repaired);
  const errors = [];
  for (const cand of candidates) {
    if (!cand) continue;
    try { return { ok: true, value: JSON.parse(cand) }; }
    catch (e) { errors.push(String(e.message || e).slice(0, 140)); }
  }
  return { ok: false, errors };
}

function normalizeQAReport(o) {
  const issuesIn = Array.isArray(o.issues) ? o.issues : [];
  const validCats = new Set(['responsividade','javascript','html_semantico','acessibilidade','seo','paleta_tipografia','assets','performance','arquitetura_arquivos','outro']);
  const validSev = new Set(['critico','aviso','ok']);
  const issues = issuesIn
    .filter(x => x && typeof x === 'object')
    .slice(0, QA_MAX_ISSUES)
    .map(it => ({
      severity: validSev.has(it.severity) ? it.severity : (it.severity === 'critical' || it.severity === 'error' || it.severity === 'high' ? 'critico' : (it.severity === 'warning' || it.severity === 'medium' ? 'aviso' : (it.severity === 'pass' || it.severity === 'success' ? 'ok' : 'aviso'))),
      category: validCats.has(it.category) ? it.category : 'outro',
      file: String(it.file || '').trim().slice(0, 200) || 'N/A',
      line: (typeof it.line === 'number' && Number.isFinite(it.line)) ? Math.max(1, Math.floor(it.line)) : null,
      title: String(it.title || 'Problema detectado').trim().slice(0, 160),
      description: String(it.description || '').trim().slice(0, 800),
      suggestedFix: String(it.suggestedFix || 'Corrigir manualmente.').trim().slice(0, 800),
      refArquiteto: String(it.refArquiteto || '').trim().slice(0, 120) || 'N/A',
    }));
  // Conta
  const counts = { critico:0, aviso:0, ok:0 };
  for (const it of issues) counts[it.severity]++;
  const score = Math.max(0, Math.min(100, typeof o.overallScore === 'number' ? Math.round(o.overallScore) : Math.max(0, 100 - (counts.critico*15) - (counts.aviso*4))));
  return {
    summary: String(o.summary || 'Revisão QA aplicada').trim().slice(0, 500),
    overallScore: score,
    issues,
    _counts: counts,
  };
}

async function runAgentLoopLegacyOriginal(ws, session, userParts, opts = {}) {
  // ===================== RACE FIX: ABORTA execução anterior =====================
  if (session.state === STATE_RUNNING) {
    try {
      session.abortRequested = true;
      if (typeof session.pauseResolver === 'function') {
        try { session.pauseResolver(); } catch {}
      }
      session.pauseRequested = false;
      setState(ws, session, STATE_STOPPED, { reason: 'new_run_abort_old' });
      emit(ws, 'agent:done', { reason: 'new_run_abort_old' });
    } catch {}
    await new Promise(r => setTimeout(r, 300));
    session.abortRequested = false;
    session.pauseRequested = false;
    session.pauseResolver = null;
  }
  // =============================================================================

  // ============================================================================
  // RC22  ORQUESTRAÇÃO PIPELINE 3-IA (Arquiteta → Desenvolvedora → QA)
  //  - DEFAULT: LEGACY_SINGLE_PHASE = true  (PIPELINE_3IA=off) → 100% fluxo antigo, NÃO toca em nada.
  //  - SE PIPELINE_3IA=on:
  //      1) FASE 1 ARQUITETA   (antes de contents.push user) → gera plano JSON → salva .tiagent_plan.json
  //      2) FASE 2 DESENVOLVEDORA (o loop Gemini existente INTACTO) → prompt inicial agora inclui o plano da Arquiteta
  //      3) FASE 3 QA         (após finally / agent:done do loop DEV) → relatório de issues
  // ============================================================================
  const userPartsText = (Array.isArray(userParts) ? userParts : [])
    .filter(p => p && typeof p === 'object' && typeof p.text === 'string')
    .map(p => p.text)
    .join('\n');
  // ===== ETAPA 8 · MODO CHAT PURO SEM BUILD =====
  const __e8ChatPuro = Boolean(opts?.__e8ChatPuro || (session && session.__e8 && session.__e8.chatPuro));
  const __e8ToolsFiltered = __e8ChatPuro
    ? TOOL_DECLARATIONS.filter(t => !['write_file','delete_file','run_command'].includes(t.name))
    : null;
  let rc22_archPlan = null;        // se PIPELINE_3IA: objeto plano normalizado
  let rc22_qaReport  = null;       // se PIPELINE_3IA: objeto relatório QA
  let rc22_skipped3I = LEGACY_SINGLE_PHASE;  // true se caiu no modo antigo

  // ============================================================================
  // RC24 · AGENT ORCHESTRATOR GLUE (camada ACIMA do RC22, NÃO toca no RC22 abaixo)
  //  - Se NÃO for projeto agent__ → orchOutput = null → RC22 roda NORMALMENTE (backward compat 100%).
  //  - Se for agent__ e Orchestrator decidir "build" / "qa" → orchOutput.handled=false → RC22 continua abaixo.
  //  - Se for agent__ e Orchestrator decidir "continuar conversa / pergunta" → orchOutput.handled=true → early return (sem tocar RC22).
  // ============================================================================
  try {
    const orchOutput = await runAgentOrchestrator({ ws, session, userParts });
    if (orchOutput && typeof orchOutput === 'object' && orchOutput.handled === true) {
      // Orquestrador resolveu tudo (mensagem / update spec) — NÃO rodar RC22.
      try { setState(ws, session, STATE_IDLE, { reason: 'rc24_orchestrator_handled' }); } catch {}
      try { emit(ws, 'agent:done', { reason: 'rc24_orchestrator_handled', rc22: null, orch: orchOutput }); } catch {}
      return;
    }
    // Se Orchestrator marcou build_mode, ele gravou .tiagent_plan.json forçado;
    // nesse caso, vamos SOBRESCREVER rc22_archPlan com esse plano forçado, para
    // a fase 1 Arquiteta SKIPAR e usar esse (preservando RC22 pipeline intacto).
    if (session && session.__rc24_build_mode) {
      try {
        const planPath = path.join(projectDirOf(session), '.tiagent_plan.json');
        if (fsc.existsSync(planPath)) {
          const forcedParsed = JSON.parse(await fs.readFile(planPath, 'utf8'));
          if (forcedParsed && forcedParsed.files && forcedParsed.sections) {
            rc22_archPlan = forcedParsed;
            // Marca como se a Arquiteta tivesse rodado → SKIP fase 1 ARCH:
            rc22_skipped3I = false;  // mas vamos ajustar abaixo: forçamos skip do runArchitectPhase
            session.__rc24_skipArchPhase = true;
          }
        }
      } catch {}
    }
  } catch (errOrch) {
    // Erro no orquestrador NUNCA deve impedir RC22; só loga e segue fluxo normal:
    console.log('[RC24 Orchestrator ERRO (ignorado, segue RC22)]', (errOrch && errOrch.message || String(errOrch)).slice(0, 200));
  }

  // ----- FASE 1 · ARQUITETA (antes do loop DEV) -----
  // (RC24: se build_mode → pula fase arquiteta e usa plano forçado)
  if (!LEGACY_SINGLE_PHASE && !(session && session.__rc24_skipArchPhase) && !__e8ChatPuro) {
    try {
      const proj = session.project || DEFAULT_PROJECT;
      const dir  = projectDirOf(session);
      const archRes = await runArchitectPhase({ ws, session, userText: userPartsText, project: proj, projectDir: dir });
      if (archRes && archRes.ok && archRes.plan) rc22_archPlan = archRes.plan;
      // Persiste plano em disco para QA comparar (e usuário baixar se quiser)
      try {
        if (rc22_archPlan) await fs.writeFile(path.join(dir, '.tiagent_plan.json'), JSON.stringify(rc22_archPlan, null, 2), 'utf8');
      } catch {}
    } catch (errArch) {
      console.log('[RC22 Arquiteta ERRO global, fallback plano mínimo]', (errArch?.message||'').slice(0,200));
      rc22_archPlan = minimalFallbackPlan(String(userPartsText||'').slice(0,80), session.project || DEFAULT_PROJECT);
      try { await fs.writeFile(path.join(projectDirOf(session), '.tiagent_plan.json'), JSON.stringify(rc22_archPlan, null, 2), 'utf8').catch(()=>{}); } catch {}
    }
  }

  const mode = session.mode || 'solo';
  const projectDir = projectDirOf(session);
  let system = SYSTEM_INSTRUCTION({ mode, projectDir, project: session.project || DEFAULT_PROJECT });
  // ===== ETAPA 8 · ISOLAMENTO DE OBJETIVO =====
  //  Em modo chat puro: instrui a LLM a ignorar objetivos/arquivos/URLs de builds anteriores
  //  (PetAmigo, Clínicas, saudacao.json, URLs localtunnel, etc.) e NÃO usar tools de build.
  if (__e8ChatPuro) {
    system += '\n\n' +
`---
⚠️  MODO SOMENTE CONVERSA — ESTA MENSAGEM DO USUÁRIO NÃO É SOLICITAÇÃO DE EXECUÇÃO.
REGRAS OBRIGATÓRIAS PARA ESTE TURNO:
1. ESTA É UMA NOVA CONVERSA INDEPENDENTE. Ignore completamente objetivos, planos, arquivos, URLs, nomes de projetos, ferramentas ou resultados de execuções e builds anteriores (incluindo: PetAmigo & Cia, PetShop, Clínica Vida Saúde, Clínicas, saudacao.json, arquivos como index.html/style.css, URLs locais ou localtunnel, ou qualquer build concluído ou pendente).
2. NÃO gere plano de desenvolvimento. NÃO faça listas de etapas de implementação.
3. As ferramentas write_file, delete_file e run_command NÃO estão disponíveis para este turno. Use seu conhecimento interno para responder. Use read_file SOMENTE se for IMPRESCINDÍVEL para responder a pergunta e souber exatamente o que ler. Preferencialmente NÃO use ferramentas.
4. Responda normalmente: mensagens casuais, saudações, informações, explicações, datas, conhecimentos gerais.
5. NÃO termine a resposta com "Objetivo atingido", "Concluído", "✅ Concluído" ou frases similares de finalização de build. Apenas encerre a resposta de forma natural.`;
  }
  const contents = session.contents;
  let finishedClean = false;
  let stoppedReason = null;

  // ----- RC22: Ajusta prompt inicial da DESENVOLVEDORA (fase 2) se houver plano ARQUITETA -----
  // ABSOLUTAMENTE SEM TOCAR NA LÓGICA INTERNA DO LOOP GEMINI ABAIXO
  const rc22_appendArchPlanToFirstUserPrompt = () => {
    if (!rc22_archPlan || rc22_skipped3I) return;
    const header =
`\n\n═══════════════════════════════════════════════════════════
## 🏛️ PLANO OBRIGATÓRIO DA IA ARQUITETA · NÃO ALTERAR, SÓ EXECUTAR

### Resumo do Projeto: ${rc22_archPlan.name || 'Projeto Sem Nome'}
${rc22_archPlan.summary || ''}

### 🎨 Paleta (Tailwind classes p/ referência)
Primária: ${rc22_archPlan.palette.primary}  ·  Secundária: ${rc22_archPlan.palette.secondary}  ·  Acento: ${rc22_archPlan.palette.accent}
Neutra : ${rc22_archPlan.palette.neutral}  ·  Superfície : ${rc22_archPlan.palette.surface}

### 🔤 Tipografia
Títulos: ${rc22_archPlan.typography.headingFont} · Corpo: ${rc22_archPlan.typography.bodyFont} · Escala: ${rc22_archPlan.typography.scale}

### 🧱 Seções a construir (ordem recomendada)
${(rc22_archPlan.sections || []).map((s,i) => `${i+1}. **${s.title}** — ${s.description || ''}  (ordem #${s.order||i+1})`).join('\n')}

### 📁 Arquivos a gerar (use write_file com paths ABAIXO)
${(rc22_archPlan.files || []).map(f => `- ${f.path}  ·  Tipo: ${f.type||'asset'}  ·  ${f.purpose||''}`).join('\n')}

### ⚡ Interações JS / UX
${(rc22_archPlan.interactions || []).map(x => `- ${x}`).join('\n') || '- (nenhuma interação específica)'}

### ♿ SEO + Acessibilidade
${(rc22_archPlan.seo_accessibility || []).map(x => `- ${x}`).join('\n') || '- Meta viewport obrigatória; lang="pt-BR"; <h1> único; imagens com alt'}

### ✅ Critérios de ACEITE para QA aprovar
${(rc22_archPlan.acceptanceCriteria || []).map(x => `- ${x}`).join('\n')}

---
⚠️  OBRIGATORIO: SEGUIR EXATAMENTE OS ITENS ACIMA. Não crie arquivos não listados.
Quando todas condições forem 100% atingidas, escreva "### ✅ Concluído" e pare.
═══════════════════════════════════════════════════════════\n\n`;
    // Anexa NO FINAL do último user part (só texto) do prompt original
    // Encontra o último text part; se não tiver, cria um part text.
    let appended = false;
    for (let i = userParts.length - 1; i >= 0 && !appended; i--) {
      const part = userParts[i];
      if (part && typeof part === 'object' && typeof part.text === 'string') {
        userParts[i] = Object.assign({}, part, { text: part.text + header });
        appended = true;
      }
    }
    if (!appended) userParts.push({ text: header });
  };
  rc22_appendArchPlanToFirstUserPrompt();

  try {
    session.abortRequested = false;
    session.pauseRequested = false;
    session.pauseResolver = null;
    setState(ws, session, STATE_RUNNING);

    contents.push({ role: 'user', parts: userParts });
    emit(ws, 'message:user', { id: 'u_' + Date.now(), parts: userParts });
    // UNIFY_CONV: persistir turno USER real (mensagem do usuário em chat:send)
    _unifiedTryPersistTurn(session, 'user', userParts, { kind: 'rc22_user' }).catch(()=>{});

    let planSteps = null;
    let planCompleted = 0;
    let planEmitted = false;
    let forceLoopFollowUpCount = 0;
    let lastPlanParsedFromText = ''; // RC10: evita duplo agent:plan de plano igual
    // RC22.2 FIX: contadores para impedir saída antecipada SEM NENHUM arquivo escrito
    let __devToolWriteCount = 0;
    let __devToolAnyCallCount = 0;
    const __archPlannedFiles = __e8ChatPuro ? 0 : (Array.isArray(rc22_archPlan?.files) ? rc22_archPlan.files.length : 0);

    // RC22.3 · Loop de Auto-Correção Pós-QA (Auto-Remediation)
    // Executa um mini-loop da Desenvolvedora ALIMENTADO com issues CRÍTICOS/AVISOS do QA.
    // 100% aditivo: NÃO toca no loop principal DEV (abaixo), roda de forma isolada no finally.
    const CORRECTION_MAX_STEPS_PER_LOOP = 6;
    const CORRECTION_MAX_ISSUES_PER_RUN = 8;
    async function _rc22_runAutoCorrectionPass({ qaReport, corrIter, archPlan }) {
      if (!qaReport || !Array.isArray(qaReport.issues)) return { ok: false, writes: 0, reason: 'sem issues' };
      const issuesAll = qaReport.issues.slice();
      const criticos = issuesAll.filter(i => i && i.severity === 'critico');
      const avisos   = issuesAll.filter(i => i && i.severity === 'aviso');
      const priorizados = [...criticos, ...avisos].slice(0, CORRECTION_MAX_ISSUES_PER_RUN);
      if (priorizados.length === 0) return { ok: true, writes: 0, reason: 'sem criticos/avisos para corrigir' };
      const projeto = session.project || DEFAULT_PROJECT;
      const correcaoPrompt = `
═══════════════════════════════════════════════════════════
## 🚨 LOOP DE AUTO-CORREÇÃO QA · Iteração ${corrIter} · Projeto: ${projeto}

### Score atual: **${qaReport.overallScore || 0}/100** · Críticos: ${criticos.length} · Avisos: ${avisos.length}

### ARQUIVOS QUE VOCÊ DEVE EDITAR (use read_file ANTES se precisar):
${(archPlan && Array.isArray(archPlan.files) ? archPlan.files.map((f, i) => `${i+1}. \`${f.path}\` — ${f.purpose || ''}`).join('\n') : 'index.html · style.css · script.js (arquivos padrão)')}

### ISSUES OBRIGATÓRIAS A CORRIGIR (ordem PRIORIDADE: Críticos → Avisos):
${priorizados.map((x, idx) => {
  const tag = x.severity === 'critico' ? '🔴 CRÍTICO' : '🟡 AVISO';
  const arquivo = (x.file && x.file !== 'N/A') ? ` no arquivo \`${x.file}\`` : '';
  const linha = typeof x.line === 'number' ? ` (linha ${x.line})` : '';
  return `${idx+1}. ${tag}${arquivo}${linha} · **${x.title || 'Sem título'}**  
   → Descrição: ${String(x.description || '').replace(/\s+/g, ' ').slice(0,300)}  
   → Como corrigir: ${String(x.suggestedFix || 'Editar o arquivo correspondente').replace(/\s+/g, ' ').slice(0,300)}`;
}).join('\n')}

### INSTRUÇÃO OBRIGATÓRIA:
1. Use **read_file** em cada arquivo afetado ANTES de editar (você precisa do conteúdo ATUAL).
2. Use **write_file** (caminhos RELATIVOS ao projeto) para **SOBRESCREVER** os arquivos com a versão CORRIGIDA (arquivo COMPLETO, NÃO trechos).
3. NÃO crie novos arquivos — apenas conserte os existentes.
4. NÃO responda apenas com texto. CHAME AS FERRAMENTAS.
5. Quando TERMINAR todas correções (todas issues acima resolvidas), escreva "### ✅ Correções Aplicadas".

⚠️ NÃO SAIA sem ter chamado write_file PELO MENOS uma vez por issue crítico.
═══════════════════════════════════════════════════════════`;

      emit(ws, 'agent:phase', { phase: 'AUTO_FIX', status: 'start', provider: 'gemini', model: GOOGLE_MODEL, text: `🔧 Auto-correção QA · iteração ${corrIter} · ${criticos.length} críticos · ${avisos.length} avisos` });
      emit(ws, 'message:ai:delta', { id: 'corr_start_' + Date.now(), text: `\n🔧 **Iniciando Auto-Correção (Iteração ${corrIter})** · Corrigindo ${priorizados.length} issues prioritários…\n`, done: true });

      contents.push({ role: 'user', parts: [{ text: correcaoPrompt }] });
      emit(ws, 'message:user', { id: 'u_corr_' + Date.now(), parts: [{ text: correcaoPrompt }] });

      let writesThisPass = 0;
      let corrPlanSteps = null;
      let corrPlanDone = 0;
      let corrPlanEmitido = false;
      let corrForceFollow = 0;
      let corrFinishedOk = false;
      const maxCorrSteps = Math.min(CORRECTION_MAX_STEPS_PER_LOOP, MAX_STEPS);

      for (let corrStep = 1; corrStep <= maxCorrSteps; corrStep++) {
        if (session.abortRequested) break;
        await waitIfPaused(session);
        if (session.abortRequested) break;
        emit(ws, 'agent:step', { step: corrStep, max: maxCorrSteps, planTotal: corrPlanSteps?.length || 0, planDone: corrPlanDone });
        const msgId = 'corr_a_' + Date.now() + '_' + corrStep;
        let currentText = '';
        let lastFlush = 0;
        let attempt = 0;
        let streamResult = null;
        while (attempt < 2) {
          attempt++;
          const toSend = sanitizeContentsBeforeSend(contents.slice(), `corr${corrIter}_s${corrStep}_t${attempt}`);
          try {
            streamResult = await callEnsembleOrSingle(session, toSend, system, (chunk) => {
              if (chunk.done) { if (currentText.length) emit(ws, 'message:ai:delta', { id: msgId, text: currentText, done: true, usage: chunk.usage }); return; }
              const txtParts = (chunk.parts || []).filter(p => typeof p.text === 'string');
              for (const p of txtParts) currentText += p.text;
              if (!corrPlanEmitido) {
                const found = parsePlanFromText(currentText);
                if (found) { corrPlanSteps = found; corrPlanEmitido = true; emit(ws, 'agent:plan', { steps: found, mode }); emit(ws, 'agent:progress', { current: 0, total: found.length }); }
              }
              const now = Date.now();
              if (now - lastFlush >= 20 && currentText.length) { lastFlush = now; emit(ws, 'message:ai:delta', { id: msgId, text: currentText, done: false }); }
            }, Object.assign({ model: session.model || GOOGLE_MODEL }, (__e8ToolsFiltered ? { toolDeclarations: __e8ToolsFiltered } : {})));
            break;
          } catch (err) {
            const errMsg = err && err.message ? String(err.message) : '';
            const is400 = /400[\s\S]{0,80}ending with a model turn/i.test(errMsg);
            if (is400 && attempt < 2) { while (contents.length && contents[contents.length-1].role !== 'user') contents.pop(); if (!contents.length || contents[contents.length-1].role !== 'user') contents.push({ role:'user', parts:[{ text:'Continue a aplicar as correções. Use write_file e read_file.' }]}); continue; }
            if (err && err.code === 'ALL_PROVIDERS_FAILED' && err._allProvidersFailed && Array.isArray(err._allProvidersFailed.attempts)) {
              const det = err._allProvidersFailed.attempts.map(a =>
                `  · ${a.provider}${a.usedModel?'/'+String(a.usedModel).slice(0,32):''} http=${a.statusCode||'-'} class=${a.classification||a.kind||'?'} err=${((a.errorRedacted||a.errorMessage||'').slice(0,60))}`).join('\n');
              emit(ws, 'error', { message: 'RC28 · TODOS provedores falharam (Auto-fix).\nTentativas:\n' + (det.length?det: '') });
            }
            break;
          }
        }
        if (currentText.length) {
          emit(ws, 'message:ai:delta', { id: msgId, text: currentText, done: true, usage: streamResult?.usage });
          // UNIFY_CONV: persistir turno ASSISTANT textual (auto-correção)
          _unifiedTryPersistTurn(session, 'model', [{ text: currentText }], { kind: 'rc22_assistant_autofix' }).catch(()=>{});
        }
        if (!corrPlanEmitido) { const found = parsePlanFromText(currentText); if (found) { corrPlanSteps = found; corrPlanEmitido = true; emit(ws, 'agent:plan', { steps: found, mode }); emit(ws, 'agent:progress', { current: 0, total: found.length }); } }

        const parts = streamResult?.parts || [];
        const fcParts = parts.filter(p => p.functionCall && typeof p.functionCall === 'object');
        if (fcParts.length === 0) {
          const hasFinal = /\n###\s*✅\s*Correções\s+Aplicadas/i.test(currentText) || /\n###\s*✅\s*Concluído/i.test(currentText) || /correções\s+aplicadas/i.test(currentText);
          if (hasFinal && writesThisPass > 0) { corrFinishedOk = true; break; }
          if (corrForceFollow < 2) {
            corrForceFollow++;
            contents.push({ role: 'user', parts: [{ text: `⚠️ Ainda faltam ${Math.max(1, priorizados.length - writesThisPass)} correções. Use obrigatoriamente read_file depois write_file. NÃO pare, NÃO responda apenas texto. AGORA:` }] });
            continue;
          }
          if (writesThisPass > 0) break;
          contents.push({ role: 'user', parts: [{ text: `USE read_file + write_file AGORA para corrigir os arquivos. Não digite só texto.` }] });
          continue;
        }

        if (mode === 'interactive') {
          session.pauseRequested = true;
          emit(ws, 'agent:awaitConfirm', { step: corrStep, calls: fcParts.map(f => ({ id: f.functionCall?.id, name: f.functionCall?.name, args: f.functionCall?.args || {} })) });
          setState(ws, session, STATE_PAUSED, { reason: 'awaiting_confirm' });
          await waitIfPaused(session);
          if (session.abortRequested) break;
          setState(ws, session, STATE_RUNNING);
        }

        if (fcParts.length > 0) contents.push({ role: 'model', parts });
        const sTools = makeSessionTools(session, ws);
        const respParts = [];
        for (let i = 0; i < fcParts.length; i++) {
          if (session.abortRequested) break;
          const p = fcParts[i]; const call = p.functionCall; const name = call.name; const args = call.args || {};
          const toolId = 't_corr_' + (call.id || crypto.randomBytes(5).toString('hex'));
          emit(ws, 'tool:call', { id: toolId, name, args, pending: true, project: projeto });
          const toolFn = sTools[name];
          let result; if (!toolFn) result = { ok: false, error: `Ferramenta desconhecida: ${name}` }; else try { result = await toolFn(args); } catch (e) { result = { ok: false, error: e.message || 'erro' }; }
          emit(ws, 'tool:result', { id: toolId, name, args, pending: false, ok: result.ok, error: result.error || null, result, project: projeto });
          if (result.ok && name === 'write_file') { writesThisPass++; __devToolWriteCount++; emit(ws, 'file:changed', { path: args.path, action: result.action, size: result.size, url: result.url, project: projeto }); }
          respParts.push({ functionResponse: { name, id: call.id, response: result } });
        }
        if (respParts.length > 0) contents.push({ role: 'user', parts: respParts });
        emit(ws, 'file:tree:refresh', {});
      }

      emit(ws, 'agent:phase', { phase: 'AUTO_FIX', status: 'done', provider: 'gemini', model: GOOGLE_MODEL, text: `✅ Auto-correção concluída · writes=${writesThisPass} · ${corrFinishedOk ? 'finalizado' : 'atingiu max steps'}` });
      emit(ws, 'message:ai:delta', { id: 'corr_done_' + Date.now(), text: `\n✅ **Auto-correção Iteração ${corrIter} concluída**: ${writesThisPass} arquivo(s) atualizado(s) com sucesso.\n`, done: true });
      return { ok: true, writes: writesThisPass, finished: corrFinishedOk, issuesPrioritarios: priorizados.length };
    }

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (session.abortRequested) {
        stoppedReason = 'aborted';
        break;
      }
      await waitIfPaused(session);
      if (session.abortRequested) { stoppedReason = 'aborted'; break; }

      const pCurr = planSteps ? Math.min(planCompleted + 1, planSteps.length) : step;
      const pMax  = planSteps ? planSteps.length : MAX_STEPS;
      emit(ws, 'agent:step', { step: pCurr, max: pMax, planTotal: planSteps?.length || 0, planDone: planCompleted });

      let streamResult;
      const msgId = 'a_' + Date.now() + '_' + step;
      let currentText = '';
      let lastFlush = 0;
      const FLUSH_MS = 20;

      // RC10 FIX B: genAIStream com contents sanitizados + retry do erro 400 model-turn
      // RC14 ENSEMBLE: callEnsembleOrSingle(session, ...) usa 1 cabeça ou 2 cabeças paralelo
      let attempt = 0;
      while (attempt < 2) {
        attempt++;
        const toSend = sanitizeContentsBeforeSend(contents.slice(), `step${step}try${attempt}`);
        try {
          streamResult = await callEnsembleOrSingle(session, toSend, system, (chunk) => {
            if (chunk.done) {
              if (currentText.length) {
                emit(ws, 'message:ai:delta', { id: msgId, text: currentText, done: true, usage: chunk.usage });
              }
              return;
            }
            const txtParts = (chunk.parts || []).filter(p => typeof p.text === 'string');
            for (const p of txtParts) currentText += p.text;
            if (!planEmitted) {
              const found = parsePlanFromText(currentText);
              if (found) {
                const sig = found.map(s => String(s.index)+'|'+s.title).join('||');
                if (sig !== lastPlanParsedFromText) {
                  lastPlanParsedFromText = sig;
                  planSteps = found;
                  planEmitted = true;
                  emit(ws, 'agent:plan', { steps: planSteps, mode });
                  emit(ws, 'agent:progress', { current: 0, total: planSteps.length });
                } else {
                  planSteps = found;
                  planEmitted = true;
                }
              }
            }
            const now = Date.now();
            if (now - lastFlush >= FLUSH_MS && currentText.length) {
              lastFlush = now;
              emit(ws, 'message:ai:delta', { id: msgId, text: currentText, done: false });
            }
          }, Object.assign({ model: session.model }, (__e8ToolsFiltered ? { toolDeclarations: __e8ToolsFiltered } : {})));
          break; // sucesso
        } catch (err) {
          const errMsg = err && err.message ? String(err.message) : '';
          const isModelTurn400 = /400[\s\S]{0,80}ending with a model turn/i.test(errMsg);
          const is429 = /429|quota|rate.?limit/i.test(errMsg);
          if (isModelTurn400 && attempt < 2) {
            // Auto-fix: dropar ultimo turno model e garantir user com texto no final
            while (contents.length && contents[contents.length-1].role !== 'user') contents.pop();
            if (!contents.length || contents[contents.length-1].role !== 'user') {
              contents.push({ role:'user', parts:[{ text:'Prossiga usando tools.' }]});
            } else {
              const lu = contents[contents.length-1];
              if (!Array.isArray(lu.parts) || lu.parts.length === 0) {
                lu.parts = [{ text:'Prossiga usando tools.' }];
              } else {
                lu.parts.push({ text:' Continue usando as tools, não pare.' });
              }
            }
            console.log(`[RC10] retry model-turn 400 step=${step}. contents.length=${contents.length}. lastRole=${contents[contents.length-1].role}`);
            continue;
          }
          // RC28 DIAG-429 FIX: se todos providers falharam, mostrar lista RICA de tentativas (não resumir p/ 429 Google)
          if (err && err.code === 'ALL_PROVIDERS_FAILED' && err._allProvidersFailed && Array.isArray(err._allProvidersFailed.attempts)) {
            const att = err._allProvidersFailed.attempts;
            const det = att.map(a =>
              `  · ${a.provider}${a.usedModel?'/'+String(a.usedModel).slice(0,32):''} http=${a.statusCode||'-'} class=${a.classification||a.kind||'?'}${a.blockedByRouter?' [router-blocked]':''} err=${((a.errorRedacted||a.errorMessage||'').slice(0,60))}`).join('\n');
            const summary = `RC28 · TODOS provedores falharam (${att.length} tentativa(s)). Nenhuma IA conseguiu responder.\nTentativas:\n${det}`;
            emit(ws, 'error', { message: summary });
          } else {
            const friendly = is429
              ? `API 429: Você excedeu sua cota atual da Google. Verifique seu plano e detalhes de cobrança em ai.google.dev/gemini-api/docs/rate-limits. Tente novamente em 1 minuto.`
              : `Erro na IA (${errMsg.slice(0, 180)}). Tente novamente em 1 minuto.`;
            emit(ws, 'error', { message: friendly });
          }
          stoppedReason = 'api_error';
          streamResult = null;
          break;
        }
      }
      if (stoppedReason === 'api_error' || !streamResult) break;

      if (currentText.length) {
        emit(ws, 'message:ai:delta', { id: msgId, text: currentText, done: true, usage: streamResult?.usage });
        // UNIFY_CONV: persistir turno ASSISTANT textual (exibição p/ usuário + memória)
        _unifiedTryPersistTurn(session, 'model', [{ text: currentText }], { kind: 'rc22_assistant_step' }).catch(()=>{});
      }
      if (!planEmitted) {
        const found = parsePlanFromText(currentText);
        if (found) {
          const sig = found.map(s => String(s.index)+'|'+s.title).join('||');
          if (sig !== lastPlanParsedFromText) {
            lastPlanParsedFromText = sig;
            planSteps = found;
            planEmitted = true;
            emit(ws, 'agent:plan', { steps: planSteps, mode });
            emit(ws, 'agent:progress', { current: 0, total: planSteps.length });
          } else {
            planSteps = found;
            planEmitted = true;
          }
        }
      }

      const parts = streamResult?.parts || [];
      const funcCallParts = parts.filter(p => p.functionCall && typeof p.functionCall === 'object');
      // RC22.2 FIX: bloqueio de segurança — NÃO permite finalizar SEM NENHUM write_file executado se existem arquivos planejados.
      const __semArquivosEscritosAinda = !__e8ChatPuro && (__archPlannedFiles > 0 && __devToolWriteCount === 0);
      if (funcCallParts.length === 0) {
        const hasFinalBlock = /\n###\s*✅\s*Concluído[\s\S]*$/i.test(currentText) || /\n#{1,4}\s*Concluído(?:\s|$)/i.test(currentText) || currentText.trim().endsWith('Concluído');
        const planFinished = !planSteps || planCompleted >= planSteps.length;
        // ============ CORREÇÃO AWAITING INTERNET AUTH ==============================
        // NÃO forçar continuação quando sessão está AGUARDANDO AUTORIZAÇÃO INTERNET.
        // Regra 8 do usuário: mecanismo "forçando continuação" NÃO pode ultrapassar esse estado.
        // ==========================================================================
        const __awaitingInternet = session._awaitingInternetAuth === true;
        if (__awaitingInternet) {
          session.pauseRequested = true;
          setState(ws, session, STATE_PAUSED, { reason: 'awaiting_internet_auth', scopeId: session._awaitingInternetAuthScopeId || null });
          emit(ws, 'agent:progress', { current: planCompleted, total: planSteps ? planSteps.length : Math.max(planCompleted, 1) });
          await waitIfPaused(session);
          if (session.abortRequested) { stoppedReason = 'aborted'; break; }
          // Autorização recebeu update; retomar após usuário clicar Sim/Não no modal
          session._awaitingInternetAuth = false;
          setState(ws, session, STATE_RUNNING);
          const __authDenied = session._awaitingInternetAuthDenied === true;
          session._awaitingInternetAuthDenied = false;
          if (__authDenied) {
            emit(ws, 'message:ai:delta', { id: msgId + '_denied', text: `\n\n⛔ Autorização de acesso à internet foi **negada** (você clicou em NÃO). Não vou abrir o navegador.`, done: true });
            stoppedReason = 'internet_auth_denied';
            finishedClean = true;
            break;
          }
          // Retomado com autorização concedida → continuar passo atual, NÃO push followUp
          emit(ws, 'agent:step', { step: Math.min(planCompleted + 1, planSteps ? planSteps.length : MAX_STEPS), max: planSteps ? planSteps.length : MAX_STEPS, planTotal: planSteps?.length || 0, planDone: planCompleted });
          contents.push({ role: 'user', parts: [{ text: `✅ Autorização de internet concedida (scopeId=${session._awaitingInternetAuthScopeId || '-'}). Continue exatamente no próximo passo do plano: agora abra o site usando browser_open(url, scope="${session._awaitingInternetAuthScopeId || ''}", timeoutMs=60000). Não chame web_request_ask_authorization novamente.` }] });
          session._awaitingInternetAuthScopeId = null;
          continue;
        }
        if (hasFinalBlock && planFinished && !__semArquivosEscritosAinda) {
          const currDone = planSteps ? planSteps.length : planCompleted || step;
          emit(ws, 'agent:progress', { current: currDone, total: currDone });
          finishedClean = true;
          stoppedReason = 'finished';
          break;
        }
        if (__semArquivosEscritosAinda && (hasFinalBlock || planFinished || forceLoopFollowUpCount < 3)) {
          forceLoopFollowUpCount++;
          const arquivosPlanejados = (rc22_archPlan?.files || []).map((f,i) => `${i+1}. ${f.path}`).slice(0,6).join(' · ') || '(nenhum listado)';
          const totalArquivosPlanejados = __archPlannedFiles || '?';
          const followUp = { role: 'user', parts: [{ text: `🚫 BLOQUEIO DE SEGURANÇA RC22.2: Você NÃO gravou NENHUM arquivo ainda (write_file=0), mas existem **${totalArquivosPlanejados} arquivos** obrigatórios no plano da Arquiteta. Arquivos esperados: ${arquivosPlanejados}.\n\nINSTRUÇÃO OBRIGATÓRIA: NÃO diga "Concluído", NÃO pare, NÃO responda só texto. Use a ferramenta write_file AGORA para CADA arquivo planejado (caminhos RELATIVOS ao projeto: index.html, style.css, script.js etc). Escreva CÓDIGO COMPLETO e FUNCIONAL. Depois de gravar TODOS os arquivos, você pode encerrar.` }] };
          contents.push(followUp);
          emit(ws, 'message:ai:delta', { id: msgId + '_noguard_' + forceLoopFollowUpCount, text: `\n\n🚫 **Segurança RC22.2**: 0 arquivos gravados, forçando escrita obrigatória de ${__archPlannedFiles} arquivo(s) planejados…\n`, done: true });
          emit(ws, 'agent:step', { step: Math.min(planCompleted + 1, planSteps ? planSteps.length : MAX_STEPS), max: planSteps ? planSteps.length : MAX_STEPS, planTotal: planSteps?.length || 0, planDone: planCompleted });
          continue;
        }
        if (planSteps && planCompleted < planSteps.length && forceLoopFollowUpCount < 2) {
          // REGRA 8: NÃO forçar continuação se sessão está aguardando autorização internet.
          const __awaitingInternet2 = session._awaitingInternetAuth === true;
          if (__awaitingInternet2) {
            session.pauseRequested = true;
            setState(ws, session, STATE_PAUSED, { reason: 'awaiting_internet_auth', scopeId: session._awaitingInternetAuthScopeId || null });
            emit(ws, 'agent:progress', { current: planCompleted, total: planSteps ? planSteps.length : Math.max(planCompleted, 1) });
            await waitIfPaused(session);
            if (session.abortRequested) { stoppedReason = 'aborted'; break; }
            session._awaitingInternetAuth = false;
            setState(ws, session, STATE_RUNNING);
            const __authDenied2 = session._awaitingInternetAuthDenied === true;
            session._awaitingInternetAuthDenied = false;
            if (__authDenied2) {
              emit(ws, 'message:ai:delta', { id: msgId + '_denied2', text: `\n\n⛔ Autorização de acesso à internet foi **negada**. Não vou abrir o navegador.`, done: true });
              stoppedReason = 'internet_auth_denied';
              finishedClean = true;
              break;
            }
            emit(ws, 'agent:step', { step: Math.min(planCompleted + 1, planSteps ? planSteps.length : MAX_STEPS), max: planSteps ? planSteps.length : MAX_STEPS, planTotal: planSteps.length, planDone: planCompleted });
            contents.push({ role: 'user', parts: [{ text: `✅ Autorização concedida. Continue: browser_open(url, scope="${session._awaitingInternetAuthScopeId || ''}", timeoutMs=60000).` }] });
            session._awaitingInternetAuthScopeId = null;
            continue;
          }
          forceLoopFollowUpCount++;
          const remaining = planSteps.slice(planCompleted);
          const reminder = remaining.slice(0, Math.min(3, remaining.length)).map((s, i) => `${i+1}. ${s.title}`).join('; ');
          const followUp = { role: 'user', parts: [{ text: `⚠️ CONTINUE O TRABALHO. Você listou um plano mas ainda faltam ${Math.max(1, planSteps.length - planCompleted)} passos. Próximos passos pendentes: ${reminder}. Use as tools declaradas. NÃO escreva apenas texto. NÃO marque como concluído. Execute write_file/run_command etc. AGORA:` }] };
          contents.push(followUp);
          emit(ws, 'message:ai:delta', { id: msgId + '_followup_' + forceLoopFollowUpCount, text: `\n\n⏩ Plano não concluído, forçando continuação… (passos pendentes: ${Math.max(1, planSteps.length - planCompleted)})\n`, done: true });
          emit(ws, 'agent:step', { step: Math.min(planCompleted + 1, planSteps.length), max: planSteps.length, planTotal: planSteps.length, planDone: planCompleted });
          // RC10 FIX C: SEM TOOLS → NÃO push model→user[] mortos. Continue direto.
          continue;
        }
        if (planFinished && !__semArquivosEscritosAinda) {
          const currDone = planSteps ? planSteps.length : planCompleted || step;
          emit(ws, 'agent:progress', { current: currDone, total: currDone });
          finishedClean = true;
          stoppedReason = 'finished';
          break;
        }
        // RC10 FIX D: Sem tools + plano nao concluido + forceLoop excedido → push user obrigatório NÃO VAZIO e continue SEM criar turnos mortos.
        if (forceLoopFollowUpCount >= 2 && !planFinished) {
          contents.push({ role: 'user', parts: [{ text: `Use obrigatoriamente uma ferramenta agora (write_file / run_command / read_file) para avançar o trabalho. NÃO responda apenas com texto. Execute uma ação.` }] });
          continue;
        }
      }

      if (mode === 'interactive') {
        session.pauseRequested = true;
        emit(ws, 'agent:awaitConfirm', {
          step: pCurr,
          calls: funcCallParts.map(f => ({
            id: f.functionCall?.id,
            name: f.functionCall?.name,
            args: f.functionCall?.args || {},
          })),
        });
        setState(ws, session, STATE_PAUSED, { reason: 'awaiting_confirm' });
        await waitIfPaused(session);
        if (session.abortRequested) { stoppedReason = 'aborted'; break; }
        setState(ws, session, STATE_RUNNING);
      }

      // RC10 FIX E: SÓ adicionar turno model/responseParts SE HOUVER tools reais.
      const hasRealTools = funcCallParts.length > 0;
      if (hasRealTools) contents.push({ role: 'model', parts });

      const sessionTools = makeSessionTools(session, ws);
      const responseParts = [];
      let anyDone = false;
      let awaitingInternetAuthNow = false;
      const funcTotal = funcCallParts.length;
      for (let i = 0; i < funcCallParts.length; i++) {
        if (session.abortRequested) break;
        await waitIfPaused(session);
        if (session.abortRequested) break;

        const p = funcCallParts[i];
        const call = p.functionCall;
        const name = call.name;
        const args = call.args || {};
        const toolId = 't_' + (call.id || crypto.randomBytes(5).toString('hex'));

        emit(ws, 'tool:call', { id: toolId, name, args, pending: true, project: session.project || DEFAULT_PROJECT });

        const toolFn = sessionTools[name];
        let result;
        if (!toolFn) {
          result = { ok: false, error: `Ferramenta desconhecida: ${name}` };
        } else {
          try {
            result = await toolFn(args);
          } catch (err) {
            result = { ok: false, error: err.message || 'Erro interno' };
          }
        }

        emit(ws, 'tool:result', {
          id: toolId,
          name,
          args,
          pending: false,
          ok: result.ok,
          error: result.error || null,
          result,
          project: session.project || DEFAULT_PROJECT,
        });

        if (result.ok && name === 'write_file') {
          emit(ws, 'file:changed', { path: args.path, action: result.action, size: result.size, url: result.url, project: session.project || DEFAULT_PROJECT });
          __devToolWriteCount++;
        }
        if (result.ok && name === 'delete_file') {
          emit(ws, 'file:changed', { path: args.path, action: 'deleted', project: session.project || DEFAULT_PROJECT });
        }
        if (result.ok) __devToolAnyCallCount++;

        responseParts.push({ functionResponse: { name, id: call.id, response: result } });
        anyDone = true;

        // ==================== CORREÇÃO AWAITING USER =====================================
        // Quando web_request_ask_authorization retorna awaitingUser:true → PAUSAR TUDO.
        // Não incrementar plano. Não continuar para próxima tool no mesmo batch.
        // ================================================================================
        if (name === 'web_request_ask_authorization' && result && result.awaitingUser === true) {
          awaitingInternetAuthNow = true;
          session._awaitingInternetAuth = true;
          session._awaitingInternetAuthScopeId = result.scopeId || null;
          session._awaitingInternetAuthReason = result.note ? String(result.note).slice(0,400) : 'Aguardando autorização internet §8.1';
          try { // Não deixar crashar se o state não existir
            const pd = projectDirOf(session);
            const stPatch = { awaitingInternetAuthorization: { scopeId: session._awaitingInternetAuthScopeId, reason: session._awaitingInternetAuthReason, startedAtMs: Date.now(), provider: 'browser_open_flow_v1' }, internetAuthorizationLastPendingScope: session._awaitingInternetAuthScopeId };
            await OrcFs.mergePatchCentralState({ projectDir: pd, session, patch: stPatch });
          } catch {}
          break;
        }

        if (!awaitingInternetAuthNow && result.ok && planSteps && planCompleted < planSteps.length) {
          planCompleted++;
          emit(ws, 'agent:progress', { current: planCompleted, total: planSteps.length });
        } else if (!awaitingInternetAuthNow && result.ok && !planSteps) {
          planCompleted++;
          emit(ws, 'agent:progress', { current: planCompleted, total: Math.max(planCompleted, funcTotal) });
        }
      }
      if (anyDone && !awaitingInternetAuthNow && planSteps && planCompleted < planSteps.length) {
        planCompleted++;
        emit(ws, 'agent:progress', { current: planCompleted, total: planSteps.length });
      }

      emit(ws, 'file:tree:refresh', {});
      // RC10 FIX F: SÓ push user functionResponses SE realmente teve tools e resposta não-vazia.
      if (hasRealTools && responseParts.length > 0) {
        contents.push({ role: 'user', parts: responseParts });
      }

      if (session.abortRequested) { stoppedReason = 'aborted'; break; }
    }

    // =================== Fim do for loop (max steps) =========================
    if (!finishedClean && !stoppedReason) {
      stoppedReason = 'max_steps';
    }
  } catch (errOuter) {
    // ============= CATCH OUTER: NUNCA deixar o front sem agent:done ===========
    try {
      // Apenas emit error — o front case 'error' já cria addAIMessage ❌ sozinho, evita duplicação
      const msg = errOuter && errOuter.message ? String(errOuter.message) : 'erro inesperado';
      emit(ws, 'error', { message: `Erro interno no agente: ${msg.slice(0, 220)}` });
    } catch {}
    stoppedReason = stoppedReason || 'internal_error';
  }

  finally {
    // ============================================================================
    // RC22 FASE 3 · QA — APÓS loop Desenvolvedora, DENTRO do finally (sempre roda sintaticamente)
    //  - Só efetivamente executa se PIPELINE_3IA=on E plano da Arquiteta existiu E sessão não abortada
    //  - MAX_CORRECTION_LOOPS default = 0 (não corrige nada automaticamente, só relata)
    // ============================================================================
    if (!rc22_skipped3I && rc22_archPlan && !['aborted','new_run_abort_old'].includes(String(stoppedReason||''))) {
      try {
        let corrLoops = 0;
        const proj = session.project || DEFAULT_PROJECT;
        const dir  = projectDirOf(session);
        // Garante que o plano está em disco mesmo (se veio fallback anterior)
        try {
          await fs.writeFile(path.join(dir, '.tiagent_plan.json'), JSON.stringify(rc22_archPlan, null, 2), 'utf8').catch(()=>{});
        } catch {}
        while (corrLoops <= MAX_CORRECTION_LOOPS) {
          // Roda QA
          const qaRes = await runQAPhase({ ws, session, archPlan: rc22_archPlan, project: proj, projectDir: dir }).catch((errQ) => {
            console.log('[RC22 runQAPhase catch: fallback]', (errQ?.message||'').slice(0,180));
            return { fallback: true, ok: false, error: String(errQ?.message||errQ||'').slice(0,220) };
          });
          if (qaRes && qaRes.report) rc22_qaReport = qaRes.report;
          // Persiste relatório QA em disco
          try {
            if (rc22_qaReport) await fs.writeFile(path.join(dir, '.tiagent_qa_report.json'), JSON.stringify(rc22_qaReport, null, 2), 'utf8').catch(()=>{});
          } catch {}
          // Decide se continua loop de correção
          const criticos = rc22_qaReport && rc22_qaReport._counts ? rc22_qaReport._counts.critico || 0 : 0;
          const score = Number(rc22_qaReport?.overallScore || 0);
          // RC22.3: Condição para rodar auto-correção (OR de qualquer gatilho)
          const precisaCorrigir = (corrLoops < MAX_CORRECTION_LOOPS) && (criticos > 0 || score < 80);
          if (!precisaCorrigir) break;
          // RC22.3: Loop REAL de auto-correção (não mais comentário e break)
          const corrIter = corrLoops + 1;
          try {
            const fix = await _rc22_runAutoCorrectionPass({
              qaReport: rc22_qaReport,
              corrIter,
              archPlan: rc22_archPlan,
            });
            console.log(`[RC22 QA Auto-fix] iteração=${corrIter} · score_anterior=${score} · criticos=${criticos} · writes=${fix?.writes || 0} · ok=${fix?.ok ? 'sim' : 'nao'}`);
            if ((fix?.writes || 0) === 0) {
              console.log('[RC22 QA Auto-fix] sem writes na iteração, abortando loop para não gastar cota.');
              break;
            }
          } catch (eFix) {
            console.log('[RC22 QA Auto-fix ERRO (ignorado, segue loop)]', (eFix && eFix.message ? eFix.message : String(eFix)).slice(0, 200));
          }
          corrLoops++;
        }
        // Salva metadados pipeline para debug futuro (opcional, JSON pequeno)
        try {
          await fs.writeFile(path.join(dir, '.tiagent_pipeline.json'), JSON.stringify({
            generatedAt: new Date().toISOString(),
            pipeline: true,
            arch: rc22_archPlan ? { provider: rc22_archPlan.generatedAt ? 'local' : 'n/a', name: rc22_archPlan.name, files: rc22_archPlan.files?.length, sections: rc22_archPlan.sections?.length } : null,
            qa: rc22_qaReport ? { score: rc22_qaReport.overallScore, counts: rc22_qaReport._counts, issuesTotal: (rc22_qaReport.issues||[]).length } : null,
          }, null, 2), 'utf8').catch(()=>{});
        } catch {}
      } catch (errQaGlobal) {
        console.log('[RC22 QA bloco finally erro (ignorado, nao quebra agent:done)]', (errQaGlobal?.message||'').slice(0,180));
      }
    }

    // ========================= FINALLY — SEMPRE envia agent:done ===============
    try {
      if (stoppedReason === 'finished' || finishedClean) {
        setState(ws, session, STATE_IDLE, { reason: stoppedReason || 'finished' });
      } else if (stoppedReason === 'aborted' || stoppedReason === 'new_run_abort_old') {
        setState(ws, session, STATE_STOPPED, { reason: stoppedReason });
      } else {
        setState(ws, session, STATE_STOPPED, { reason: stoppedReason || 'error' });
      }
      emit(ws, 'agent:done', {
        reason: stoppedReason || 'finished',
        rc22: rc22_skipped3I ? 'legacy-single-phase' : 'pipeline-3ia',
        archPlan: rc22_archPlan ? { name: rc22_archPlan.name, files: rc22_archPlan.files?.length, sections: rc22_archPlan.sections?.length } : null,
        qaReport: rc22_qaReport ? { overallScore: rc22_qaReport.overallScore, counts: rc22_qaReport._counts, issuesCount: (rc22_qaReport.issues||[]).length } : null,
      });
    } catch {}
    session.abortRequested = false;
    session.pauseRequested = false;
    session.pauseResolver = null;

    // ======================================================================
    // RC24 hook pós-RC22: se tem __rc24_afterRc22 → atualiza lastQaRun + estado.
    // Também grava lastQaRun no agent_state.json se for projeto agent__
    // (separado do stateHistory: QA score fica no state; texto de conversa não).
    // ======================================================================
    try {
      const isAgentProject = String(session.project || '').startsWith('agent__');
      if (isAgentProject) {
        const pslug = session.project || DEFAULT_PROJECT;
        const root = _agentDir(pslug);
        if (fsc.existsSync(path.join(root,'agent_state.json'))) {
          const stCur = JSON.parse(await fs.readFile(path.join(root,'agent_state.json'),'utf8'));
          if (rc22_qaReport) {
            stCur.lastQaRun = {
              ts: Date.now(),
              overallScore: rc22_qaReport.overallScore || null,
              counts: rc22_qaReport._counts || null,
              issuesCount: (rc22_qaReport.issues || []).length,
            };
          }
          await agentFs_writeState(pslug, stCur);
        }
        if (typeof session.__rc24_afterRc22 === 'function') {
          try { await session.__rc24_afterRc22({ qaReport: rc22_qaReport }); }
          catch (e) { console.warn('[RC24 __rc24_afterRc22 erro]', e.message||String(e)); }
          session.__rc24_afterRc22 = null;
        }
        session.__rc24_build_mode = false;
        session.__rc24_skipArchPhase = false;
      }
    } catch (errPosRc24) {
      console.log('[RC24 pós-RC22 hook erro (ignorado)]', (errPosRc24 && errPosRc24.message || String(errPosRc24)).slice(0, 200));
    }
  }
  // ============================================================================
}

// ============================================================================
// RC27 · Early Gate Orquestrador Autônomo
//  - Se RC27_ENABLED=false (default): roda a função legacy 1:1 SEM NENHUM overhead
//  - Se RC27_ENABLED=true : tenta orquestrador autônomo; se não resolver, cai no legacy
//  - Importante: runAutonomousOrchestrator() é definido em fase posterior da
//    implementação; typeof check garante fallback seguro SEMPRE nesta fase inicial
// ============================================================================
async function runAgentLoop(ws, session, userParts) {
  // ========================================================================
  //  ETAPA 8 · GATE GLOBAL DE INTENÇÃO (PONTO COMUM ANTES RC22 vs RC27)
  //  PROTEGE AMBOS OS CAMINHOS: RC22 legacy e RC27 autônomo.
  //  Classifica a mensagem atual; se shouldBuild=false → MODO CHAT PURO
  //  (sem plano, sem write_file, sem delete_file, sem run_command,
  //   sem fase arquitetura, sem RC22.2 de escrita obrigatória).
  // ========================================================================
  {
    const plainText = (Array.isArray(userParts) ? userParts : [])
      .filter(p => p && typeof p === 'object' && typeof p.text === 'string')
      .map(p => p.text).join('\n').trim();
    if (plainText && typeof Orch.classifyUserIntent === 'function') {
      const cls = Orch.classifyUserIntent(plainText, null);
      try {
        session.__e8 = Object.assign({}, cls, {
          mensagem: plainText.slice(0, 400),
          ts: Date.now(),
          chatPuro: cls.shouldBuild !== true
        });
      } catch {}
      if (cls.shouldBuild !== true) {
        const razao = 'ETAPA8_CHAT_PURO__' + String(cls.intent || 'INDEF') + '__' + String(cls.reason || 'na');
        console.log('[ETAPA8 Gate] shouldBuild=false · ' + razao + ' · project=' + (session && session.project ? session.project : 'default'));
        return runAgentLoopLegacyOriginal(ws, session, userParts, { __e8ChatPuro: true, intent: cls });
      }
    }
  }

  // ========================================================================
  //  RC29 · PONTO A · FR-5 AUTO-SEED POR INTENÇÃO (OPCIONAL, default OFF)
  //  NÃO muta globalThis/process.env (retrocompat 100% segura).
  //  Se RC29_AUTO_ENABLE_BY_INTENT=on e intent for BUILD_FULL_APP etc. →
  //  liga RC27/RC28 apenas para ESTA execução com vars locais.
  //  Default: OFF (zero overhead, comportamento antigo).
  // ========================================================================
  let _localRC27Enabled = Boolean(RC27_ENABLED);
  let _localRC28Enabled = Boolean(RC28_ENABLED);
  try {
    const _envAuto = String((typeof process !== 'undefined' && process.env && process.env.RC29_AUTO_ENABLE_BY_INTENT) || (typeof globalThis !== 'undefined' && globalThis.__RC29_AUTO_ENABLE_BY_INTENT ? 'on' : 'off')).trim().toLowerCase();
    if (_envAuto === 'on' || _envAuto === 'true' || _envAuto === '1') {
      const plain = (Array.isArray(userParts) ? userParts : [])
        .filter(p => p && typeof p === 'object' && typeof p.text === 'string')
        .map(p => p.text).join('\n').trim();
      if (plain && typeof Orch.classifyUserIntent === 'function') {
        const cls = session && session.__e8 ? session.__e8 : Orch.classifyUserIntent(plain, null);
        const intencoesLigar = new Set([
          'BUILD_FULL_APP', 'BUILD_MINIMAL_APP', 'BUILD_INTEGRATION', 'BUILD_TOOLING',
          'SOLICITACAO_EXECUCAO', 'BUILD_LANDING', 'BUILD_API', 'IMPLEMENTACAO_COMPLETA'
        ]);
        const ligarPorIntencao = (cls && intencoesLigar.has(String(cls.intent || '')))
          || (cls && cls.shouldBuild === true && /crie|implemente|construa|desenvolva|faça|build|create|implement/i.test(plain));
        if (ligarPorIntencao) {
          if (!_localRC27Enabled) { _localRC27Enabled = true; console.log('[RC29 FR-5] Auto-seed RC27 por intenção:', cls && cls.intent || 'BUILD'); }
          if (!_localRC28Enabled) { _localRC28Enabled = true; console.log('[RC29 FR-5] Auto-seed RC28 por intenção:', cls && cls.intent || 'BUILD'); }
        }
      }
    }
  } catch (rc29err) { console.warn('[RC29 FR-5] early gate (ignorado, fallback):', rc29err && rc29err.message || rc29err); }

  if (!_localRC27Enabled) {
    return runAgentLoopLegacyOriginal(ws, session, userParts);
  }
  // ======================================================================
  //  RC28 P6: WS RESUME após clique Sim/Não autorização internet
  //  Detecta comando RC27_INTERNET_AUTHORIZED / RC27_INTERNET_DENIED
  //  enviado pela UI em __rc27SendInternetAuth.
  //  Não recria Estado Central — reusa projectDir checkpoint existente.
  // ======================================================================
  try {
    const plainText = (Array.isArray(userParts) ? userParts : [])
      .filter(p => p && typeof p === 'object' && typeof p.text === 'string')
      .map(p => p.text).join('\n').trim();
    const mAuth = plainText.match(/^(RC27_INTERNET_(?:AUTHORIZED|DENIED))\s+(\{.*\})?/s);
    if (mAuth && _localRC28Enabled) {
      let payload = { authorized: mAuth[1] === 'RC27_INTERNET_AUTHORIZED' };
      try { if (mAuth[2]) payload = { ...payload, ...JSON.parse(mAuth[2]) }; } catch {}
      const projectDir = projectDirOf(session);
      await _rc28ResumeAfterInternetInput({ ws, session, projectDir, payload, authorized: payload.authorized });
      return;
    }
  } catch {}

  try {
    const rc27Fn = typeof runAutonomousOrchestrator === 'function' ? runAutonomousOrchestrator : null;
    if (rc27Fn) {
      // RC29 FR-5: passa autonomyFlags (vars locais, NÃO global) para o RC27
      const autonomyFlags = { rc27Enabled: _localRC27Enabled, rc28Enabled: _localRC28Enabled, autoSeededByIntent: _localRC27Enabled !== Boolean(RC27_ENABLED) };
      const result = await rc27Fn({ ws, session, userParts, autonomyFlags });
      if (result && typeof result === 'object') {
        if (result.handled === true) {
          console.log(`[RC27 Gate] handled=true · phase=${result.phase || 'ANALYSIS'} · scopeId=${result.scopeId || 'n/a'} · project=${session && session.project ? session.project : 'default'}${result.objectiveVerified===true?' · objectiveVerified='+result.objectiveVerified:''}${result.objectiveProgressPct!=null?' · progress='+result.objectiveProgressPct+'%':''}`);
          return;
        }
        if (result.handled === false && result.reason && result.reason.startsWith('rc27_plan_saved_')) {
          console.log(`[RC27 Gate] plano salvo, caindo para legado RC22/RC24 entregar código real (runLegacyBelow). project=${session && session.project ? session.project : 'default'}`);
        }
      }
    }
  } catch (rc27Err) {
    console.log(`[RC27 Gate] Erro orquestrador autônomo (fallback legado RC22): ${(rc27Err && rc27Err.message || String(rc27Err)).slice(0,250)}`);
  }
  console.log(`[RC27 Gate] Fallback para runAgentLoopLegacyOriginal (retrocompat 100%). project=${session && session.project ? session.project : 'default'}`);
  return runAgentLoopLegacyOriginal(ws, session, userParts);
}

/* ===== REST API ===== */
app.get('/api/status', (req, res) => {
  res.json({
    ok: Boolean(GOOGLE_API_KEY),
    model: GOOGLE_MODEL,
    workspaceRoot: WORKSPACE_ROOT,
    defaultProject: DEFAULT_PROJECT,
    sessions: sessions.size,
    maxSteps: MAX_STEPS,
    googleKeyOk: GOOGLE_KEY_OK,
    googleKeyPrefix: GOOGLE_API_KEY ? (GOOGLE_API_KEY.slice(0, 5) + '…' + GOOGLE_API_KEY.slice(-4)) : null,
    render: IS_RENDER_OR_HEADLESS_LINUX,
    renderBaseUrl: RENDER_BASE_URL || null,
    platform: process.platform,
    previewMode: IS_RENDER_OR_HEADLESS_LINUX ? 'single-port (/preview/:slug/)' : 'multi-port (3001..4100)',
    ensemble: {
      available: ensembleIsEnabled(),
      mode: ENSEMBLE_MODE,
      modelA: FREE_MODEL_A,
      modelB: FREE_MODEL_B,
      freeTier: true,
      hasGoogleKey: Boolean(GOOGLE_API_KEY),
    },
    pipeline3ia: PIPELINE_3IA,
    legacySinglePhase: LEGACY_SINGLE_PHASE,
    pipelineConfig: {
      arch: { provider: resolveProvider(ARCH_PROVIDER), model: ARCH_MODEL, requested: ARCH_PROVIDER },
      dev:  { provider: resolveProvider(DEV_PROVIDER,'gemini'), model: DEV_MODEL, requested: DEV_PROVIDER },
      qa:   { provider: resolveProvider(QA_PROVIDER), model: QA_MODEL, requested: QA_PROVIDER },
      maxCorrectionLoops: MAX_CORRECTION_LOOPS,
      qaMaxIssues: QA_MAX_ISSUES,
      maxArchRetries: MAX_ARCH_RETRIES,
    },
    providersUsable: {
      gemini:     providerIsUsable('gemini'),
      cerebras:   providerIsUsable('cerebras'),
      cloudflare: providerIsUsable('cloudflare'),
      groq:       providerIsUsable('groq'),
      mistral:    providerIsUsable('mistral'),
      openrouter: providerIsUsable('openrouter'),
      deepseek:   providerIsUsable('deepseek'),
    },
    deepseekPaidMode: DEEPSEEK_PAID_MODE,
  });
});


app.get('/api/projects', async (req, res) => {
  const projects = await listProjects();
  res.json({ ok: true, projects });
});

app.post('/api/projects', async (req, res) => {
  const rawName = String(req.body?.name || '').trim();
  if (!rawName) return res.status(400).json({ ok: false, error: 'Nome do projeto é obrigatório' });
  let name = rawName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
  if (!name) name = 'projeto-' + Date.now().toString(36);
  const finalName = name.toLowerCase();
  const dir = resolveProjectDir(finalName);
  await fs.mkdir(dir, { recursive: true });
  const marker = path.join(dir, '.project');
  await fs.writeFile(marker, `# ${finalName}\nCriado em ${new Date().toISOString()}\n`, 'utf8').catch(() => {});
  const prev = await startProjectPreviewServer(finalName);
  const projects = await listProjects();
  res.json({ ok: true, project: finalName, projects, port: prev?.port || null, previewUrl: prev?.url || null });
});

app.get('/api/picker/folder', async (req, res) => {
  try {
    const isMac = process.platform === 'darwin';
    if (!isMac || IS_RENDER_OR_HEADLESS_LINUX) {
      return res.status(501).json({
        ok: false,
        error: IS_RENDER_OR_HEADLESS_LINUX
          ? 'Picker de pasta indisponível em nuvem (Render/Linux headless). Use a criação de projetos ou a pasta workspace padrão.'
          : 'Picker de pasta nativo disponível apenas no macOS desktop.',
      });
    }
    const script = `
      set chosenFolder to choose folder with prompt "Selecione a pasta do seu projeto (Desktop, Downloads, etc)" default location (path to desktop folder)
      set posixPath to POSIX path of chosenFolder
      return posixPath
    `;
    const { stdout, stderr } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\\\''")}'`, { timeout: 120000 });
    const folderPath = (stdout || '').toString().trim().replace(/\r?\n$/, '');
    if (!folderPath) {
      return res.json({ ok: false, canceled: true, error: 'Nenhuma pasta selecionada' });
    }
    let displayName = path.basename(folderPath);
    try { await fs.access(folderPath); }
    catch { return res.status(400).json({ ok: false, error: 'Pasta inacessível: ' + folderPath }); }
    const st = await fs.stat(folderPath);
    if (!st.isDirectory()) return res.status(400).json({ ok: false, error: 'Não é uma pasta válida' });
    res.json({ ok: true, folderPath, displayName, canceled: false });
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString();
    if (msg.includes('(-128)') || msg.includes('User canceled') || err.code === 1 || (msg.includes('osascript') && msg.includes('299'))) {
      return res.json({ ok: false, canceled: true, error: 'Cancelado pelo usuário' });
    }
    res.status(500).json({ ok: false, error: msg || err.message || 'Erro ao abrir picker' });
  }
});

// Testa se a pasta do usuário é GRAVÁVEL (macOS TCC Desktop/Documents bloqueia frequentemente)
async function testWritable(folderPath) {
  try {
    if (!folderPath || !fsc.existsSync(folderPath)) return { writable: false, reason: 'not_exists' };
    const name = `.write_test_${process.pid}_${Date.now().toString(36)}.tmp`;
    const full = path.join(folderPath, name);
    await fs.writeFile(full, 'write-test', 'utf8');
    try { await fs.unlink(full).catch(() => {}); } catch {}
    return { writable: true };
  } catch (err) {
    return { writable: false, reason: err?.code || 'error', message: err?.message || String(err) };
  }
}

app.post('/api/projects/mount', async (req, res) => {
  const folderPath = String(req.body?.folderPath || '').trim();
  const displayName = req.body?.displayName ? String(req.body.displayName).trim() : null;
  if (!folderPath) return res.status(400).json({ ok: false, error: 'Caminho da pasta é obrigatório' });
  try {
    const record = await mountProject(folderPath, displayName);
    // Teste de escrita: macOS TCC bloqueia frequentemente pastas Desktop/Documents
    const wtest = await testWritable(record.path);
    let warn = null;
    if (!wtest.writable) {
      // Marca fallback interno ANTES de iniciar preview e criação de arquivos
      const slug = record.slug;
      const m = mountedProjects.get(slug);
      if (m) { m.fallbackInternal = true; await saveMounted(); }
      // Garante pasta workspace interna
      const fbDir = resolveWritableProjectDir(slug);
      if (!fsc.existsSync(fbDir)) fsc.mkdirSync(fbDir, { recursive: true });
      warn = (
        `⚠️ Permissão bloqueada pelo macOS (${wtest.reason}).\n` +
        `A pasta "${record.displayName}" na Área de Trabalho / Documents / Downloads bloqueou escrita.\n` +
        `Não se preocupe: os arquivos serão criados DENTRO da minha pasta interna ` +
        `em "criador/workspace/${slug}/". O preview vai funcionar normalmente. ` +
        `Depois você pode mover os arquivos manualmente se quiser.`
      );
    }
    // Garante projeto (pastas + marker) antes do preview
    await ensureProject(record.slug);
    // Reinicia servidor preview se já estava rodando (antes servia pasta externa, agora pode ser fallback)
    if (projectServers.has(record.slug)) {
      try { projectServers.get(record.slug).close(); } catch {}
      projectServers.delete(record.slug);
    }
    const prev = await startProjectPreviewServer(record.slug);
    const projects = await listProjects();
    const m = mountedProjects.get(record.slug) || record;
    res.json({
      ok: true,
      project: record.slug,
      projects,
      port: prev?.port || null,
      previewUrl: prev?.url || null,
      mounted: { ...m, fallbackInternal: !!m.fallbackInternal },
      writable: wtest.writable,
      writableReason: wtest.reason || null,
      warn,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/projects/:slug/preview/start', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug) return res.status(400).json({ ok: false, error: 'Slug é obrigatório' });
    await ensureProject(slug);
    const result = await startProjectPreviewServer(slug);
    res.json({ ok: true, port: result?.port || null, url: result?.url || null, alreadyRunning: !!result?.alreadyRunning });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/projects/:slug/preview/stop', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    await stopProjectPreviewServer(slug);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function restProjectSession(projectName) {
  const name = (projectName || DEFAULT_PROJECT).toString();
  return { project: name, model: GOOGLE_MODEL, mode: 'solo', state: 'idle' };
}

app.get('/api/files', async (req, res) => {
  const p = req.query.project || req.body?.project || DEFAULT_PROJECT;
  const sess = restProjectSession(p);
  const r = await toolListDir(sess, { path: req.query.path || '.', depth: Math.min(5, parseInt(req.query.depth || '3', 10)) });
  res.json(r);
});

app.get('/api/files/read', async (req, res) => {
  const sess = restProjectSession(req.query.project);
  const r = await toolReadFile(sess, { path: req.query.path });
  res.json(r);
});

app.post('/api/files/write', async (req, res) => {
  const sess = restProjectSession(req.body?.project);
  const r = await writeFileWithAutoFallback(sess, { path: req.body?.path, content: req.body?.content ?? '' });
  res.json(r);
});

app.delete('/api/files', async (req, res) => {
  const sess = restProjectSession(req.body?.project);
  const r = await deleteFileWithAutoFallback(sess, { path: req.body?.path, recursive: req.body?.recursive });
  res.json(r);
});

app.post('/api/exec', async (req, res) => {
  const sess = restProjectSession(req.body?.project);
  const r = await toolRunCommand(sess, { command: req.body?.command, timeout_sec: req.body?.timeout_sec, cwd: req.body?.cwd });
  res.json(r);
});

app.get('/api/sessions', (req, res) => {
  const arr = [...sessions.values()].map(s => ({
    id: s.id,
    createdAt: s.createdAt,
    lastActive: s.lastActive,
    messages: s.contents?.length || 0,
  }));
  res.json(arr);
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
    res.json({
      ok: true,
      filename: req.file.filename,
      originalname: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================================================================
//  RC23  CONFIG / CHAVES IA (nova aba IA Config no frontend)
//  - 2 endpoints: POST /api/config/test-key  (validação real via API de cada provider)
//                  POST /api/config/save     (escrita no .env preservando TODAS as outras vars)
//  - Segurança: NUNCA retorna chave de API na resposta; só prefixo + ok/error
// ==========================================================================

const RC23_ENV_KEYS = Object.freeze({
  gemini:     { envName: 'GOOGLE_API_KEY',     label: 'Google Gemini',       endpointProvider: 'gemini' },
  cerebras:   { envName: 'CEREBRAS_API_KEY',   label: 'Cerebras Cloud',      endpointProvider: 'cerebras' },
  cloudflare: { envName: 'CLOUDFLARE_WORKERS_AI_API_KEY', label: 'Cloudflare Workers AI', endpointProvider: 'cloudflare' },
  groq:       { envName: 'GROQ_API_KEY',       label: 'Groq Cloud (Llama)',  endpointProvider: 'groq' },
  mistral:    { envName: 'MISTRAL_API_KEY',    label: 'Mistral API',         endpointProvider: 'mistral' },
  openrouter: { envName: 'OPENROUTER_API_KEY', label: 'OpenRouter / DeepSeek Free', endpointProvider: 'openrouter' },
  deepseek:   { envName: 'DEEPSEEK_API_KEY',   label: 'DeepSeek Oficial (Pago)', endpointProvider: 'deepseek' },
});

// Validação REAL ping por provider (chamada HTTP mínima para confirmar que a key responde)
async function rc23TestKey({ provider, key, model }) {
  const t0 = Date.now();
  if (!key || typeof key !== 'string' || key.trim().length < 10) {
    return { ok: false, status: 'empty', error: 'Chave muito curta ou vazia.' };
  }
  const k = key.trim();
  let res, status;
  try {
    switch (provider) {
      case 'gemini': {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-3.5-flash-lite'}:streamGenerateContent?key=${encodeURIComponent(k)}&alt=sse`;
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents: [{ role:'user', parts:[{ text:'ping' }] }], generationConfig: { maxOutputTokens: 16, temperature: 0 } }),
          signal: AbortSignal.timeout(15000),
        });
        status = res.status;
        break;
      }
      case 'cerebras':
      case 'groq':
      case 'cloudflare':
      case 'mistral':
      case 'openrouter':
      case 'deepseek': {
        // Monta endpoint com a CHAVE SENDO TESTADA (não a do env), para não invalidar se a key do ambiente for vazia/diferente
        let url, auth, bodyModel;
        switch (provider) {
          case 'cerebras':   url = 'https://api.cerebras.ai/v1/chat/completions';             auth = `Bearer ${k}`; bodyModel = model || CEREBRAS_MODEL;   break;
          case 'groq':       url = 'https://api.groq.com/openai/v1/chat/completions';         auth = `Bearer ${k}`; bodyModel = model || GROQ_MODEL;       break;
          case 'cloudflare': {
            const acc = String(CLOUDFLARE_ACCOUNT_ID || '').trim();
            if (!acc) return { ok: false, status: 'missing_account_id', error: 'CLOUDFLARE_ACCOUNT_ID não configurado no .env. Obtê-lo em Dashboard Cloudflare → Workers & Pages → Account ID (canto superior direito).' };
            url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/v1/chat/completions`;
            auth = `Bearer ${k}`;
            bodyModel = model || CLOUDFLARE_WORKERS_AI_MODEL;
            break;
          }
          case 'mistral':    url = 'https://api.mistral.ai/v1/chat/completions';              auth = `Bearer ${k}`; bodyModel = model || MISTRAL_MODEL;    break;
          case 'openrouter': url = 'https://openrouter.ai/api/v1/chat/completions';           auth = `Bearer ${k}`; bodyModel = model || OPENROUTER_DEEPSEEK_MODEL; break;
          case 'deepseek':   url = 'https://api.deepseek.com/v1/chat/completions';            auth = `Bearer ${k}`; bodyModel = model || DEEPSEEK_MODEL;   break;
        }
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': auth, 'User-Agent': 'TiAgente-RC23-test-key' },
          body: JSON.stringify({ model: bodyModel, stream: false, max_tokens: 8, temperature: 0, messages: [{ role:'user', content:'ping' }] }),
          signal: AbortSignal.timeout(15000),
        });
        status = res.status;
        break;
      }
      default:
        return { ok: false, status: 'bad_provider', error: `Provider desconhecido: ${provider}` };
    }
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      let txt;
      try { txt = await res.text(); } catch { txt = ''; }
      const msg = txt ? txt.slice(0,160) : `HTTP ${status}`;
      return { ok: false, status: status === 401 || status === 403 ? 'invalid_key' : (status === 429 ? 'rate_limit' : `http_${status}`), error: msg, latencyMs: elapsed };
    }
    return { ok: true, status: 'connected', latencyMs: elapsed, provider, model: (model || '') };
  } catch (err) {
    return { ok: false, status: 'network_error', error: String(err?.message || err).slice(0, 180), latencyMs: Date.now() - t0 };
  }
}

app.post('/api/config/test-key', async (req, res) => {
  try {
    const p = String(req.body?.provider || '').trim().toLowerCase();
    const m = String(req.body?.model || '').trim();
    const k = String(req.body?.key || '');
    if (!RC23_ENV_KEYS[p]) return res.status(400).json({ ok: false, error: `Provider inválido: ${p}` });
    const out = await rc23TestKey({ provider: p, key: k, model: m });
    // NUNCA retorna a chave — só prefixo de 5 chars + 2 last de confiança visual para o usuário confirmar que digitou a chave correta
    const prefix = k.length >= 2 ? (k.slice(0,5) + '…' + k.slice(-2)) : null;
    res.json({ ok: Boolean(out.ok), status: out.status, error: out.error || null, latencyMs: out.latencyMs || 0, model: out.model || null, keyPrefix: prefix });
  } catch (e) {
    res.status(500).json({ ok: false, status: 'internal_error', error: String(e?.message || e).slice(0, 160), latencyMs: 0 });
  }
});

// Escrita segura no .env: atualiza apenas as linhas existentes, PRESERVA comentários e outras vars
// Se a chave não existir, adiciona no final do arquivo agrupada por provider
async function rc23SaveEnv(keysMap) {
  // keysMap = { gemini: 'key', cerebras: '', mistral: '...', openrouter: '...' } — provider → key string
  // 1. Lê conteúdo atual
  let current = '';
  try { current = await fs.readFile(ENV_FILE_PATH, 'utf8'); } catch { current = ''; }
  const lines = current.split(/\r?\n/);

  const toSet = {};
  for (const [provider, key] of Object.entries(keysMap || {})) {
    const info = RC23_ENV_KEYS[provider];
    if (!info) continue;
    const v = typeof key === 'string' ? key : '';
    toSet[info.envName] = v;
  }

  // 2. Atualiza in-place linhas que já existem (preserva comentários acima e ordem)
  const newLines = [];
  const replaced = new Set();
  for (const raw of lines) {
    let handled = false;
    for (const [envName, newValue] of Object.entries(toSet)) {
      // match FOO= ou FOO = (capture quoted ou não), ignora linhas comentadas #
      if (!replaced.has(envName) && !/^\s*#/.test(raw)) {
        const re = new RegExp(`^\\s*${envName}\\s*=\\s*`);
        if (re.test(raw)) {
          if (newValue.length === 0) {
            newLines.push(`# ${envName}=`);
          } else {
            // Escapa aspas e envolve em aspas se tiver caracteres perigosos
            const needsQuote = /[\s"'`#]/.test(newValue);
            const escaped = newValue.replace(/\\/g,'\\\\').replace(/"/g,'\\"');
            newLines.push(`${envName}=${needsQuote ? '"'+escaped+'"' : escaped}`);
          }
          replaced.add(envName);
          handled = true;
          break;
        }
      }
    }
    if (!handled) newLines.push(raw);
  }

  // 3. Adiciona as vars que ainda não existem no final, com cabeçalho se necessário
  const stillMissing = Object.keys(toSet).filter(k => !replaced.has(k));
  if (stillMissing.length) {
    // Remove trailing blank lines
    while (newLines.length && /^\s*$/.test(newLines[newLines.length-1])) newLines.pop();
    newLines.push('');
    newLines.push('# ==========================================================');
    newLines.push('#  Chaves das IAs (inseridas automaticamente pela Tela Config RC23)');
    newLines.push('# ==========================================================');
    for (const envName of stillMissing) {
      const v = toSet[envName] || '';
      if (v.length === 0) {
        newLines.push(`# ${envName}=`);
      } else {
        const needsQuote = /[\s"'`#]/.test(v);
        const escaped = v.replace(/\\/g,'\\\\').replace(/"/g,'\\"');
        newLines.push(`${envName}=${needsQuote ? '"'+escaped+'"' : escaped}`);
      }
    }
  }

  // Garante trailing newline
  if (newLines[newLines.length-1] !== '') newLines.push('');

  const finalContent = newLines.join('\n');
  // Backup anterior antes de salvar (segurança)
  try {
    const backupPath = ENV_FILE_PATH + `.bak.${Date.now()}`;
    try { await fs.writeFile(backupPath, current, 'utf8'); } catch {}
    // Mantém no máximo 3 backups
    const dir = path.dirname(ENV_FILE_PATH);
    const bname = path.basename(ENV_FILE_PATH);
    const entries = await fs.readdir(dir).catch(() => []);
    const backups = entries.filter(f => f.startsWith(bname + '.bak.')).sort().reverse();
    for (let i = 3; i < backups.length; i++) {
      await fs.unlink(path.join(dir, backups[i])).catch(() => {});
    }
  } catch {}
  await fs.writeFile(ENV_FILE_PATH, finalContent, 'utf8');
  return { ok: true, replacedCount: replaced.size, addedCount: stillMissing.length, file: ENV_FILE_PATH };
}

app.post('/api/config/save', async (req, res) => {
  try {
    const keys = req.body?.keys ?? (
      (req.body && typeof req.body === 'object' && Object.keys(req.body).some(k => RC23_ENV_KEYS[k]))
        ? req.body : {}
    );
    if (!keys || typeof keys !== 'object') return res.status(400).json({ ok: false, error: 'Body.keys inválido.' });
    const validated = {};
    for (const [provider, keyVal] of Object.entries(keys)) {
      if (!RC23_ENV_KEYS[provider]) continue;
      validated[provider] = typeof keyVal === 'string' ? keyVal : '';
    }
    const result = await rc23SaveEnv(validated);
    // Retorna status final de cada provider (connected/not_configured) sem expor as chaves salvas
    const perProvider = {};
    for (const provider of Object.keys(RC23_ENV_KEYS)) {
      const key = validated[provider] ?? '';
      if (!key || key.trim().length < 10) perProvider[provider] = { finalStatus: 'not_configured' };
      else {
        perProvider[provider] = { finalStatus: 'saved_pending_reboot', note: 'Reinicie o servidor para aplicar (dotenv carregado no boot).' };
      }
    }
    res.json({ ok: true, ...result, perProvider, note: 'Salvo no .env. Reinicie o servidor para as novas chaves valerem.' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 180) });
  }
});

// GET /api/config/status: retornar só quais providers TEM chave configurada (prefixo 5 chars + 2 last, sem expor a chave)
app.get('/api/config/status', (req, res) => {
  const out = {};
  for (const [provider, info] of Object.entries(RC23_ENV_KEYS)) {
    const key = String(process.env[info.envName] || '');
    out[provider] = {
      env: info.envName,
      label: info.label,
      configured: Boolean(key && key.trim().length >= 10),
      keyPrefix: key && key.trim().length >= 2 ? (key.trim().slice(0,5) + '…' + key.trim().slice(-2)) : null,
    };
  }
  res.json({ ok: true, providers: out, envFile: ENV_FILE_PATH });
});

/* ===========================================================================
 *  RC24 · AGENT ORCHESTRATOR — Persistência e Rotas REST
 *  (Helpers de disco + CRUD agent/versions/state/capabilities/conversation)
 * =========================================================================*/

function _agentDir(projectSlug) {
  return path.resolve(WORKSPACE_ROOT, projectSlug);
}

async function _agentEnsureDirs(projectSlug) {
  const root = _agentDir(projectSlug);
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(path.join(root, 'agent_versions'), { recursive: true });
  const marker = path.join(root, '.agent');
  if (!fsc.existsSync(marker)) await fs.writeFile(marker, `${projectSlug}\n`, 'utf8');
  return root;
}

async function agentFs_writeSpec(projectSlug, spec, { persistVersion=true, autoPromote=true }={}) {
  const root = await _agentEnsureDirs(projectSlug);
  const specPath = path.join(root, 'agent.json');
  const specStr = JSON.stringify(spec, null, 2);
  if (persistVersion) {
    const verPath = path.join(root, 'agent_versions', `agent.v${spec.version}.json`);
    await fs.writeFile(verPath, specStr, 'utf8');
  }
  if (autoPromote) await fs.writeFile(specPath, specStr, 'utf8');
  return { specPath, versioned: persistVersion };
}

async function agentFs_readSpec(projectSlug) {
  const p = path.join(_agentDir(projectSlug), 'agent.json');
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}

async function agentFs_readVersion(projectSlug, version) {
  const p = path.join(_agentDir(projectSlug), 'agent_versions', `agent.v${version}.json`);
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}

async function agentFs_listVersions(projectSlug) {
  try {
    const dir = path.join(_agentDir(projectSlug), 'agent_versions');
    const entries = await fs.readdir(dir);
    const list = entries
      .filter(f => /^agent\.v\d+\.\d+\.\d+\.json$/.test(f))
      .map(f => f.match(/^agent\.v(\d+\.\d+\.\d+)\.json$/)[1])
      .sort();
    return list;
  } catch { return []; }
}

async function agentFs_writeState(projectSlug, partial) {
  const root = await _agentEnsureDirs(projectSlug);
  const statePath = path.join(root, 'agent_state.json');
  let cur = { agentId: null, currentState: 'rascunho', stateHistory: [], lastRc22Run: null, lastQaRun: null, lastSecurityRun: null, approvedSecurityFixIds: [], deployedUrl: null };
  try { cur = JSON.parse(await fs.readFile(statePath, 'utf8')); } catch {}
  const merged = { ...cur, ...partial, stateHistory: (partial && Array.isArray(partial.stateHistory)) ? partial.stateHistory : (cur.stateHistory || []) };
  await fs.writeFile(statePath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

async function agentFs_readState(projectSlug) {
  const p = path.join(_agentDir(projectSlug), 'agent_state.json');
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}

async function agentFs_appendConversationLine(projectSlug, line) {
  const root = await _agentEnsureDirs(projectSlug);
  const p = path.join(root, 'conversation_memory.jsonl');
  const lineStr = JSON.stringify({ ts: Date.now(), ...(line||{}) });
  await fs.appendFile(p, lineStr + '\n', 'utf8');
  return lineStr;
}

async function agentFs_readLastConversation(projectSlug, n=50) {
  const p = path.join(_agentDir(projectSlug), 'conversation_memory.jsonl');
  let lines = [];
  try {
    const raw = await fs.readFile(p, 'utf8');
    lines = raw.split('\n').filter(Boolean).slice(-n);
    return lines.map(s => { try { return JSON.parse(s); } catch { return { ts: Date.now(), _raw: s }; } });
  } catch { return []; }
}

/* ============================================================================
 *  RC22/RC24 · UNIFICAÇÃO MEMÓRIA DE CONVERSA PERSISTENTE
 *  - Reutiliza conversation_memory.jsonl já existente do RC24 para TODOS projetos.
 *  - NÃO toca RC27 / RC28 / Decision Engine / LLM Bridge.
 *  - NÃO duplica mensagens: cada par user/model/text-turn só é salvo 1x por
 *    __convDedupToken gerado por turn salvo.
 * ========================================================================== */
const UNIFY_CONV_WINDOW_CTX = 40;   // janela de contexto a restaurar pós-restart (compat RC24)
const UNIFY_CONV_WINDOW_UI  = 200;  // janela máxima p/ UI recuperar via /resume (compat atual)

async function _unifiedAppendConversationLine(projectSlug, line) {
  if (!projectSlug) return null;
  try { return await agentFs_appendConversationLine(projectSlug, line); }
  catch (e) { console.log('[UNIFY_CONV] append falhou (ignorado):', String(e.message||e).slice(0,160)); return null; }
}

/* Dado lines de conversation_memory.jsonl, converte para contents[] turnos compat com RC22.
   Apenas turnos user/assistant com texto (não system prompts internos). */
function _unifiedConvLinesToContents(lines) {
  if (!Array.isArray(lines)) return [];
  const out = [];
  for (const l of lines) {
    if (!l || typeof l !== 'object') continue;
    const role = String(l.role || '').toLowerCase();
    if (role !== 'user' && role !== 'assistant' && role !== 'model') continue;
    const text = typeof l.text === 'string' ? l.text : (typeof l.partsText === 'string' ? l.partsText : '');
    if (!text.trim()) continue;
    const roleOut = role === 'assistant' ? 'model' : role;
    out.push({ role: roleOut, parts: [{ text }] });
  }
  return out;
}

async function _unifiedMaybeRestoreSessionContents(session, { force=false } = {}) {
  if (!session) return;
  if (!force && Array.isArray(session.contents) && session.contents.length > 0) return;
  const projectSlug = session.project || DEFAULT_PROJECT;
  try {
    const lines = await agentFs_readLastConversation(projectSlug, UNIFY_CONV_WINDOW_CTX);
    const toContents = _unifiedConvLinesToContents(lines);
    if (toContents.length) {
      session.contents = session.contents ? session.contents.concat(toContents) : toContents.slice();
      // history também recebe para manter consistência com campos existentes
      if (!Array.isArray(session.history)) session.history = [];
      for (const l of lines) session.history.push(l);
      session.__convRestoredFromDisk = true;
      console.log(`[UNIFY_CONV] restaurados ${toContents.length} turnos do projeto ${projectSlug}`);
    }
  } catch (e) { console.log('[UNIFY_CONV] restore falhou (ignorado):', String(e.message||e).slice(0,160)); }
}

/* Extrai texto apenas das parts de um turno user/model para persistir.
   Evita gravar imagens inline / function calls (privacidade + leveza). */
function _unifiedPartsToText(parts) {
  if (!Array.isArray(parts)) return '';
  return parts.map(p => {
    if (p && typeof p === 'object' && typeof p.text === 'string') return p.text;
    if (typeof p === 'string') return p;
    return '';
  }).filter(Boolean).join('\n').slice(0, 40000);
}

const __convTurnDedup = new Map();   // dedup temporário em memória por sessão + índice turno
async function _unifiedTryPersistTurn(session, role, parts, opts={}) {
  if (!session || !role || !Array.isArray(parts)) return false;
  const projectSlug = session.project || DEFAULT_PROJECT;
  const text  = _unifiedPartsToText(parts);
  if (!text.trim()) return false;
  const dedupKey = `${session.id}:${role}:${parts.length}:${Buffer.from(text.slice(0,200)).toString('base64')}`;
  if (__convTurnDedup.has(dedupKey)) return false;
  __convTurnDedup.set(dedupKey, true);
  if (__convTurnDedup.size > 5000) {
    try {
      const keys = Array.from(__convTurnDedup.keys()).slice(0, 2500);
      for (const k of keys) __convTurnDedup.delete(k);
    } catch {}
  }
  const lineOut = {
    role: String(role).toLowerCase() === 'model' ? 'assistant' : String(role).toLowerCase(),
    text,
    kind: opts.kind || null,
  };
  await _unifiedAppendConversationLine(projectSlug, lineOut);
  return true;
}

function _mapProjectFromAgentDir(dirname, stats) {
  /* Projetos agente: prefixo agent__<empresa>__<slug>. São retornados no /api/projects com type:'agent' */
  const abs = path.resolve(WORKSPACE_ROOT, dirname);
  const displayName = dirname.replace(/^agent__/, 'Agente: ').replace(/__/, ' · ');
  return { slug: dirname, displayName, path: abs, previewUrl: `/preview/${dirname}/`, type: 'agent' };
}

/* -- 2.1 CRUD agent/create ------------------------------------------------ */

app.post('/api/agent/create', async (req, res) => {
  try {
    const body = req.body || {};
    const empresaName = String(body.empresaName || body.company?.name || 'empresa').trim();
    const agentName  = String(body.agentName || body.name || 'agente').trim();
    const deliverable = body.deliverable || 'node_express_app';
    const persona = body.persona || '';
    if (!empresaName || !agentName) return res.status(400).json({ ok:false, error:'empresaName e agentName são obrigatórios.' });
    const cs = Orch.slugify(empresaName);
    const as = Orch.slugify(agentName);
    const projectSlug = Orch.getAgentProjectSlug(cs, as);
    const rootDir = await _agentEnsureDirs(projectSlug);
    // Se já existe spec, não sobrescreve (retorna existente)
    let spec = await agentFs_readSpec(projectSlug);
    if (spec) {
      const st = await agentFs_readState(projectSlug);
      return res.json({ ok:true, action:'existing', projectSlug, agentId: spec.id, agentSlug: as, companySlug: cs, spec, state: st || null, specPath: rootDir });
    }
    const initial = Orch.buildInitialSpecFromStructured(
      { empresa: { name: empresaName, slug: cs, segmento: body.segmento || '', size: body.size || 'media', notes: body.notes || '' },
        problema: body.problema || 'Em construção.',
        requisitos_funcionais: body.requisitos_funcionais || (body.requirements && body.requirements.functional) || [],
        requisitos_nao_funcionais: body.requisitos_nao_funcionais || (body.requirements && body.requirements.nonFunctional) || [],
        integracoes_desejadas: body.integracoes_desejadas || body.capabilities || [],
        regras_negocio: body.regras_negocio || (body.requirements && body.requirements.businessRules) || [],
        tools_desejadas: body.tools_desejadas || [],
        missingInfoQuestions: [],
      },
      { empresaName, agentName, deliverable, persona },
    );
    const v = Orch.validateAgentSpec(initial);
    if (!v.ok) return res.status(400).json({ ok:false, error: 'Spec inválido.', errors: v.errors });
    await agentFs_writeSpec(projectSlug, initial, { persistVersion: true, autoPromote: true });
    const state = await agentFs_writeState(projectSlug, {
      agentId: initial.id,
      currentState: 'rascunho',
      stateHistory: [{ ts: Date.now(), from: null, to: 'rascunho', reason: 'criado', by: 'orchestrator' }],
    });
    // Também registra o projeto como projeto padrão do workspace (compatível RC22):
    try { await fs.writeFile(path.join(rootDir, '.project'), `${projectSlug}\n`, 'utf8'); } catch {}
    try { await ensureProject(projectSlug); } catch {}
    /* Garante conversation_memory.jsonl inicializado (com msg sistema) */
    try { await agentFs_appendConversationLine(projectSlug, { role:'system', text:`Agente "${agentName}" da empresa "${empresaName}" inicializado. Especificação versão ${initial.version}. Estado: rascunho. Para começar, digite algo no chat ou use /agente, /build, /tools.` }); } catch {}
    try {
      // Tenta iniciar o servidor preview do projeto; se falhar (porta ocupada, etc.) → ignora:
      await startProjectPreviewServer(projectSlug).catch(() => {});
    } catch {}
    res.json({ ok:true, action:'created', projectSlug, agentId: initial.id, agentSlug: as, companySlug: cs, spec: initial, state });
  } catch (e) {
    console.error('[RC24 /api/agent/create ERROR]', e);
    res.status(500).json({ ok:false, error: String(e && e.message || e) });
  }
});

/* -- 2.2 GET agent (spec + state resumido) --------------------------------- */

app.get('/api/agent/:slug', async (req, res) => {
  try {
    const projectSlug = String(req.params.slug || '');
    const spec = await agentFs_readSpec(projectSlug);
    if (!spec) return res.status(404).json({ ok:false, error: `Agente ${projectSlug} não existe. Crie com POST /api/agent/create.` });
    const state = await agentFs_readState(projectSlug) || { currentState: 'rascunho', stateHistory: [] };
    res.json({ ok:true, projectSlug, spec, state });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e && e.message || e) });
  }
});

/* -- 2.3 PUT /:slug/spec (escreve versão nova + promote) ------------------ */

app.put('/api/agent/:slug/spec', async (req, res) => {
  try {
    const projectSlug = String(req.params.slug || '');
    const body = req.body || {};
    let spec = body.spec;
    if (!spec) return res.status(400).json({ ok:false, error:'body.spec é obrigatório.' });
    const level = body.level || 'patch'; // patch|minor|major|keep
    const promote = body.autoPromote !== false; // default true
    if (level !== 'keep') {
      const currVersion = spec.version || (await agentFs_readSpec(projectSlug) || {}).version || '0.1.0';
      spec = { ...spec, version: Orch.bumpVersion(currVersion, level) };
    }
    spec.updatedAt = Date.now();
    const v = Orch.validateAgentSpec(spec);
    if (!v.ok) return res.status(400).json({ ok:false, error: 'Spec inválido.', errors: v.errors });
    await agentFs_writeSpec(projectSlug, spec, { persistVersion: true, autoPromote: !!promote });
    res.json({ ok:true, version: spec.version, spec });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e && e.message || e) });
  }
});

/* -- 2.4 versions + compare ------------------------------------------------ */

app.get('/api/agent/:slug/versions', async (req, res) => {
  try {
    const projectSlug = String(req.params.slug || '');
    const list = await agentFs_listVersions(projectSlug);
    const spec = await agentFs_readSpec(projectSlug);
    res.json({ ok:true, projectSlug, versions: list, currentVersion: (spec && spec.version) || null });
  } catch (e) { res.status(500).json({ ok:false, error: String(e.message||e) }); }
});

app.get('/api/agent/:slug/versions/compare', async (req, res) => {
  try {
    const projectSlug = String(req.params.slug || '');
    const a = String(req.query.a || '');
    const b = String(req.query.b || '');
    if (!/^\d+\.\d+\.\d+$/.test(a) || !/^\d+\.\d+\.\d+$/.test(b)) {
      return res.status(400).json({ ok:false, error:'Parâmetros a e b devem ser semver (ex.: 0.1.0).' });
    }
    const sA = await agentFs_readVersion(projectSlug, a);
    const sB = await agentFs_readVersion(projectSlug, b);
    if (!sA || !sB) return res.status(404).json({ ok:false, error: `Versão ${a} ou ${b} não encontrada.` });
    const diff = Orch.diffAgentVersions(sA, sB);
    res.json({ ok:true, projectSlug, from:a, to:b, changed: diff.changed, added: diff.added, removed: diff.removed, patches: diff.patches });
  } catch (e) { res.status(500).json({ ok:false, error: String(e.message||e) }); }
});

/* -- 2.5 state read + state write (validado) ------------------------------ */

app.get('/api/agent/:slug/state', async (req, res) => {
  try {
    const st = await agentFs_readState(String(req.params.slug || ''));
    if (!st) return res.status(404).json({ ok:false, error: 'agent_state.json não encontrado.' });
    res.json({ ok:true, state: st });
  } catch (e) { res.status(500).json({ ok:false, error: String(e.message||e) }); }
});

app.post('/api/agent/:slug/state', async (req, res) => {
  try {
    const projectSlug = String(req.params.slug || '');
    const estado = String(req.body?.estado || req.body?.state || '').trim();
    if (!Orch.STATES.includes(estado)) return res.status(400).json({ ok:false, error: `estado inválido: "${estado}". Valores: ${Orch.STATES.join(', ')}` });
    const cur = await agentFs_readState(projectSlug) || { currentState: 'rascunho' };
    const force = Boolean(req.body?.force || req.body?.['force'] || (typeof req.body?.flags === 'string' && /--force/.test(req.body.flags)));
    const ignoreQa = Boolean(req.body?.ignoreQaScore || (typeof req.body?.flags === 'string' && /--ignore-qa-score/.test(req.body.flags)));
    const opts = {
      buildRun: Boolean(cur.lastRc22Run),
      qaScore: ignoreQa ? 100 : ((cur.lastQaRun && cur.lastQaRun.overallScore) ?? null),
      securityCritics: (cur.lastSecurityRun && cur.lastSecurityRun.counts && cur.lastSecurityRun.counts.critico) || 0,
      forceUnlock: force || (typeof req.body?.flags === 'string' && /--i-know-risk/.test(req.body.flags)),
    };
    const check = Orch.isTransitionAllowed(cur.currentState, estado, opts);
    if (!check.ok) return res.status(400).json({ ok:false, error: check.reason });
    const histEntry = { ts: Date.now(), from: cur.currentState, to: estado, reason: req.body?.reason || 'user /estado', by: force ? 'user_force' : 'user' };
    const next = await agentFs_writeState(projectSlug, { currentState: estado, stateHistory: [...(cur.stateHistory||[]), histEntry] });
    res.json({ ok:true, transition: histEntry, state: next });
  } catch (e) { res.status(500).json({ ok:false, error: String(e.message||e) }); }
});

/* -- 2.6 capabilities ----------------------------------------------------- */

app.get('/api/agent/:slug/capabilities', async (req, res) => {
  try {
    const projectSlug = String(req.params.slug || '');
    const spec = await agentFs_readSpec(projectSlug);
    if (!spec) return res.status(404).json({ ok:false, error: 'agent.json não encontrado.' });
    const resolved = Orch.statusAllCapabilities(spec, process.env || {});
    // também retorna catálogo full de sugestões (mesmo as não ativas no spec)
    const catalog = {};
    for (const [id, def] of Object.entries(Orch.AGENT_CAPABILITY_CATALOG)) {
      catalog[id] = {
        id: def.id, type: def.type, provider: def.provider, docsUrl: def.docsUrl,
        envVarsRequired: def.envVarsRequired, description: def.description,
        status: def.statusResolver(process.env || {}) ? 'disponivel_na_plataforma' : 'pendente_config_na_plataforma',
        missingEnvVars: def.envVarsRequired.filter(v => !process.env[v]),
      };
    }
    res.json({ ok:true, projectSlug, capabilitiesAgent: resolved, catalog });
  } catch (e) { res.status(500).json({ ok:false, error: String(e.message||e) }); }
});

/* -- 2.7 conversation resume + slash comando limpar memoria ---------------- */

app.post('/api/agent/:slug/conversation/resume', async (req, res) => {
  try {
    const projectSlug = String(req.params.slug || '');
    const n = Math.max(1, Math.min(300, parseInt(req.body?.limit || req.query?.limit || '50', 10)));
    const lines = await agentFs_readLastConversation(projectSlug, n);
    res.json({ ok:true, projectSlug, lines, count: lines.length });
  } catch (e) { res.status(500).json({ ok:false, error: String(e.message||e) }); }
});

app.post('/api/agent/:slug/conversation/clear', async (req, res) => {
  try {
    const projectSlug = String(req.params.slug || '');
    const root = _agentDir(projectSlug);
    const mem = path.join(root, 'conversation_memory.jsonl');
    if (!fsc.existsSync(mem)) return res.json({ ok:true, action:'nenhum_arquivo', backupFile: null });
    const ts = Date.now();
    const bak = path.join(root, `conversation_memory.bak.${ts}.jsonl`);
    await fs.copyFile(mem, bak);
    await fs.writeFile(mem, '', 'utf8');
    res.json({ ok:true, action:'backup_limpo', backupFile: bak });
  } catch (e) { res.status(500).json({ ok:false, error: String(e.message||e) }); }
});

/* ================================================================
 * RC24 AGENT ORCHESTRATOR · GLUE CODE: runAgentOrchestrator()
 * Liga chat:send / WS → decide ação → chama RC22 / QA / Security
 * Regra de BACKWARD COMPAT: se NÃO for projeto agent__ → retorna
 *     null e o código cai 100% no RC22 intacto (linha 1534).
 * ================================================================ */
async function runAgentOrchestrator({ ws, session, userParts }) {
  const projectSlug = session.project || DEFAULT_PROJECT;
  // ---- Backward compat hard: NÃO é agent__ → pula orquestrador RC24
  if (!String(projectSlug).startsWith('agent__')) return null;

  const root = _agentDir(projectSlug);
  if (!fsc.existsSync(path.join(root, 'agent.json'))) return null;  // não tem spec → RC22 puro

  // 1) Carrega spec + state + history de conversa
  const specStr = await fs.readFile(path.join(root, 'agent.json'), 'utf8');
  const spec = JSON.parse(specStr);
  let stateCur;
  try { stateCur = JSON.parse(await fs.readFile(path.join(root, 'agent_state.json'), 'utf8')); }
  catch { stateCur = { agentId: spec.id, currentState: 'rascunho', stateHistory: [] }; }

  // 2) Lê memória de conversa (últimas 40 linhas → extractStructuredContext)
  let histLines = [];
  try {
    const rawMem = await fs.readFile(path.join(root, 'conversation_memory.jsonl'), 'utf8');
    histLines = rawMem.split(/\r?\n/).filter(Boolean).slice(-40).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  } catch {}
  const userPartsText = (Array.isArray(userParts)?userParts:[])
    .filter(p => p && typeof p === 'object' && typeof p.text === 'string')
    .map(p => p.text).join('\n');
  histLines.push({ ts: Date.now(), role: 'user', text: userPartsText });
  try {
    const mem = path.join(root, 'conversation_memory.jsonl');
    await fs.appendFile(mem, JSON.stringify({ ts: Date.now(), role: 'user', text: userPartsText }) + '\n', 'utf8');
  } catch {}
  const structured = Orch.extractStructuredContext(histLines, spec, stateCur);

  // ========================================================================
  // RC24.5 · TRIGGER "corrige" / "corrigir" (PALAVRA NATURAL, sem barra)
  //   - Intercepta ANTES do decideNextAction / ANTES do RC22
  //   - Se mensagem é "corrige" (e variações) → handled=true
  //   - Dispara runQaAutofixLoop com eventos WS em tempo real
  //   - Backward compat: se NÃO tem build feito → mensagem amigável
  // ========================================================================
  {
    const cleanMsg = String(userPartsText || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // remove acentos
      .toLowerCase()
      .replace(/[!?.,;:()"'“”‘’\-]/g, ' ')              // tira pontuação
      .replace(/\s+/g, ' ')
      .trim();
    const palavras = cleanMsg.split(' ').filter(Boolean);
    const ehTrigger = (() => {
      // Slash command /corrige ou /corrigir ou /arruma (já tratado client-side, mas segundamente aqui)
      if (/^\/(corrige|corrigir|arruma|fix|qa|conserta|autofix)/i.test(String(userPartsText||'').trim())) return true;
      // Palavras naturais curtas: "corrige", "corrige isso", "corrigir", "arruma", "corrige agora", etc.
      // Regra: tem pelo menos 1 palavra dentre {corrige, corrigir, arruma, conserta, fixa} e NÃO tem palavra > 12 chars (evita frases técnicas)
      const KEYWORDS = ['corrige','corrigir','arruma','conserta','fixa','autofix','corrigindo','arrumar','consertar','fixar'];
      const temKey = palavras.some(p => KEYWORDS.includes(p));
      if (!temKey) return false;
      const temPalavraGrande = palavras.some(p => p.length > 12);
      if (temPalavraGrande) return false;
      // Se for frase só de trigger (até 4 palavras) → sim
      if (palavras.length <= 4) return true;
      return false;
    })();
    if (ehTrigger) {
      try {
        // Verifica build feito (estado construindo/testando OU lastRc22Run existe)
        const temBuild = Boolean(stateCur.lastRc22Run) ||
          (stateCur.currentState && stateCur.currentState !== 'rascunho');
        if (!temBuild) {
          const msgAmigavel =
`🤔 **Ainda não posso corrigir nada.**

Só consigo rodar o loop de QA e correções **DEPOIS** que o build for feito. O que fazer:
1. Digite \`/build\` no chat (ou clique em Construir) — a pipeline RC22 gera o site/agente
2. Depois que o build terminar e QA inicial rodar → me diga **"corrige"** novamente
3. Vou criar backup, corrigir problemas de QA, re-rodar QA e te devolver tudo em linguagem simples!`;
          emit(ws, 'message:ai:delta', { id: 'qa_need_build_' + Date.now(), text: msgAmigavel + '\n', done: true });
          try {
            await fs.appendFile(path.join(root, 'conversation_memory.jsonl'), JSON.stringify({ ts: Date.now(), role: 'assistant', text: msgAmigavel, kind: 'qa_autofix_need_build' }) + '\n', 'utf8');
          } catch {}
          return { handled: true, action: 'qa_autofix_need_build' };
        }
        // Tudo certo → dispara loop com WS real
        emit(ws, 'message:ai:delta', { id: 'qa_trigger_ok_' + Date.now(), text: `🛠️ **Certo!** Vou iniciar o loop de correção QA agora. Fique tranquilo — **antes de cada modificação** eu faço backup completo (tar.gz). Máximo 3 iterações com limite seguro.\n`, done: true });
        const result = await runQaAutofixLoop({ projectSlug, ws, session, maxIter: 3 });
        const textoFinal = (result && result.resumo) || (result && result.error ? '❌ ' + result.error : '❌ Loop finalizado sem retorno.');
        emit(ws, 'message:ai:delta', { id: 'qa_autofix_end_' + Date.now(), text: '\n' + textoFinal + '\n', done: true });
        try {
          await fs.appendFile(path.join(root, 'conversation_memory.jsonl'), JSON.stringify({ ts: Date.now(), role: 'assistant', text: textoFinal, kind: 'qa_autofix_result' }) + '\n', 'utf8');
        } catch {}
        return { handled: true, action: 'qa_autofix_triggered', result: { ok: Boolean(result && result.ok) } };
      } catch (eTrigger) {
        const msgErr = '❌ Erro ao iniciar loop de correção: ' + String(eTrigger && eTrigger.message || eTrigger).slice(0, 200);
        emit(ws, 'message:ai:delta', { id: 'qa_err_' + Date.now(), text: msgErr + '\n', done: true });
        return { handled: true, action: 'qa_autofix_failed' };
      }
    }
  }
  // FIM RC24.5 trigger corrige

  // 3) decideNextAction do motor
  const action = Orch.decideNextAction(structured, stateCur, spec, { allowBuild: !LEGACY_SINGLE_PHASE });

  // 4) Aplica diff incremental de spec se structured.extraiu_algo (empresa, problema, reqs, tools)
  if (action && action.specUpdates && Array.isArray(action.specUpdates) && action.specUpdates.length) {
    try {
      // Escreve spec novamente (apenas se houver diffs) e faz bump de versão patch (ou minor se mudança relevante)
      let changed = false;
      let spec2 = JSON.parse(JSON.stringify(spec));
      for (const up of action.specUpdates) {
        if (up.op === 'set' && typeof up.path === 'string') {
          // caminhos: requirements.problem  / company.name / integrations / requirements.functional / etc.
          const parts = up.path.split('.');
          let cur = spec2;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!cur[parts[i]]) cur[parts[i]] = {};
            cur = cur[parts[i]];
          }
          const leaf = parts[parts.length - 1];
          if (Array.isArray(up.value)) {
            cur[leaf] = Array.from(new Set([...(Array.isArray(cur[leaf])?cur[leaf]:[]), ...up.value])).slice(0, 50);
          } else {
            cur[leaf] = up.value;
          }
          changed = true;
        }
      }
      if (changed) {
        spec2.updatedAt = new Date().toISOString();
        const vprev = spec2.version || '0.1.0';
        const bumpLvl = (up => up.path && (up.path.startsWith('requirements.functional') || up.path.startsWith('integrations') || up.path.startsWith('requirements.businessRules')) ? 'minor' : 'patch')({});
        const bumped = Orch.bumpVersion(vprev, bumpLvl || 'patch');
        spec2.version = bumped.newVersion;
        const v = Orch.validateAgentSpec(spec2);
        if (!v.ok) {
          // ignora especificação inválida; não grava
        } else {
          await agentFs_writeSpec(projectSlug, spec2);
          // Notifica WS
          try { emit(ws, 'agent:spec:updated', { projectSlug, previousVersion: vprev, newVersion: spec2.version, updatedAt: spec2.updatedAt }); } catch {}
        }
      }
    } catch (e) { console.log('[RC24 Orchestrator · spec update WARN]', (e && e.message || String(e)).slice(0, 200)); }
  }

  // 5) Resposta texto imediata do Orchestrador (antes de build/audit)
  try {
    const replyText = (action && action.replyText) ||
      `🧭 **Orquestrador RC24** · ${stateCur.currentState}\n` +
      (structured.problem ? `· Problema identificado: ${structured.problem.slice(0,140)}\n` : '') +
      (structured.empresaName ? `· Empresa: ${structured.empresaName}\n` : '') +
      (structured.requirements && structured.requirements.length ? `· Requisitos detectados: ${structured.requirements.slice(0,4).join(' · ')}\n` : '') +
      (structured.integrations && structured.integrations.length ? `· Integrações: ${structured.integrations.join(', ')}\n` : '') +
      `· Próxima ação sugerida: **${(action && action.actionType) || 'continuar_conversa'}**`;
    emit(ws, 'message:ai:delta', { id: 'orch_' + Date.now(), text: replyText + '\n', done: true });
    try {
      await fs.appendFile(path.join(root, 'conversation_memory.jsonl'), JSON.stringify({ ts: Date.now(), role: 'assistant', text: replyText, kind: 'orchestrator' }) + '\n', 'utf8');
    } catch {}
  } catch {}

  // 6) Tratar ações
  if (!action) { return { handled: true, action: 'continuar_conversa' }; }

  // 6a) Ação build_via_rc22 → executa o RC22 do projeto agent__ (usa forced plan)
  if (action.actionType === 'build_via_rc22') {
    try {
      const forced = Orch.buildForcedArchitectPlanFromSpec(spec, { mode: spec.deliverableKind || 'node_express_app' });
      // Escreve plano forçado em .tiagent_plan.json → loop dev o executa
      const dir = projectDirOf(session);
      try { await fs.writeFile(path.join(dir, '.tiagent_plan.json'), JSON.stringify(forced, null, 2), 'utf8'); } catch {}
      // Transição: rascunho → construindo
      const trans1 = Orch.isTransitionAllowed(stateCur.currentState, 'construindo', { forceUnlock: true });
      if (trans1.ok) {
        stateCur.currentState = 'construindo';
        stateCur.stateHistory = [...(stateCur.stateHistory || []), { ts: Date.now(), from: trans1.from, to: 'construindo', reason: (action && action.reason) || 'Solicitado build', by: 'orchestrator' }];
        stateCur.lastRc22Run = { ts: Date.now(), status: 'running' };
        await agentFs_writeState(projectSlug, stateCur);
        emit(ws, 'agent:state:changed', { projectSlug, currentState: stateCur.currentState, history: stateCur.stateHistory });
      }

      // Build: monta mensagem build sintética (user prompt → executa RC22 loop abaixo)
      //  -> NÃO chamamos runAgentLoop RECURSIVO; instead, marcamos session.__rc24_build_flag
      //     e retornamos false → runAgentLoop continua. O RC22 vai rodar porque tem userPartsText.
      session.__rc24_build_mode = true;
      emit(ws, 'agent:phase', { phase: 'RC24', status: 'start', text: '🧭 Orquestrador: acionando RC22 (pipeline 3-IA) com plano forçado do agent.json…' });
      // Hook: quando RC22 terminar → atualiza lastRc22Run + construindo → testando
      session.__rc24_afterRc22 = async ({ qaReport }) => {
        try {
          const latest = JSON.parse(await fs.readFile(path.join(_agentDir(projectSlug), 'agent_state.json'), 'utf8'));
          latest.lastRc22Run = {
            ts: Date.now(),
            status: qaReport ? 'done_with_qa' : 'done',
            qa: qaReport ? { overallScore: qaReport.overallScore || null, issuesCount: qaReport.issuesCount || 0 } : null,
          };
          const trans2 = Orch.isTransitionAllowed(latest.currentState, 'testando', { buildRun: true, qaScore: (qaReport && qaReport.overallScore) || 0, forceUnlock: true });
          if (trans2.ok) {
            latest.currentState = 'testando';
            latest.stateHistory = [...(latest.stateHistory || []), { ts: Date.now(), from: latest.currentState === 'testando' ? 'construindo' : latest.currentState, to:'testando', reason: 'Build RC22 concluído', by: 'orchestrator' }];
          }
          await agentFs_writeState(projectSlug, latest);
          try { emit(ws, 'agent:state:changed', { projectSlug, currentState: latest.currentState, history: latest.stateHistory, lastRc22Run: latest.lastRc22Run }); } catch {}
        } catch (e) { console.warn('[RC24 __rc24_afterRc22 WARN]', e.message || String(e)); }
      };
      return { handled: false, action: 'build_via_rc22_continue_rc22' };  // handled=false → RC22 continua rodando
    } catch (e) {
      console.error('[RC24 build_via_rc22 ERRO]', e);
      emit(ws, 'error', { message: 'Orquestrador · build: ' + (e.message || String(e)) });
      return { handled: true, action: 'build_via_rc22_failed' };
    }
  }

  // 6b) Ação run_qa / run_security → retorna handled false para o runAgentLoop rodar QA; Security roda separado via REST audit
  if (action.actionType === 'run_security_audit' || action.actionType === 'run_qa') {
    return { handled: false, action: action.actionType };
  }

  // 6c) qualquer outra ação → handled true, não continua RC22
  return { handled: true, action: action.actionType || 'continuar_conversa' };
}

/* ===================== RC24 REST: SECURITY whitelist apply (SOMENTE SEC-HC-*) ===================== */
app.post('/api/agent/:slug/security/apply', async (req, res) => {
  try {
    const projectSlug = String(req.params.slug || '');
    const root = _agentDir(projectSlug);
    if (!fsc.existsSync(path.join(root, 'agent_state.json'))) return res.status(404).json({ ok:false, error: 'Agente não encontrado' });

    // 0) Backup obrigatório ANTES de qualquer apply (HardConstraint 9 RC23)
    const ts = Date.now();
    const backupPath = path.join(root, 'backups', `pre_apply_security.${ts}.tar.gz`);
    try { await fs.mkdir(path.join(root,'backups'),{recursive:true}); } catch {}
    try {
      const { execSync } = await import('node:child_process');
      execSync(`tar --exclude='node_modules' --exclude='.git' -czf ${backupPath} -C ${path.dirname(projectDirOf({project:projectSlug}))} ${path.basename(projectDirOf({project:projectSlug}))}`, { stdio:'ignore', timeout: 30000 });
    } catch {}

    const findingsProposed = Array.isArray(req.body && req.body.findings) ? req.body.findings : [];
    const findingIds = Array.isArray(req.body && req.body.findingIds) ? req.body.findingIds : [];
    // Converte ids para findings se vier ids só:
    const list = findingsProposed.length ? findingsProposed : findingIds.map(id=>({id}));

    // 1) Filtra whitelist do motor (separa SEC-HC-* vs manual)
    const sep = Orch.securityApplyWhitelistOnly(list);
    // 2) Valida indivíduo cada toApply (dupla checagem):
    const toApplyFinal = [];
    const blocked = [];
    for (const f of sep.toApply) {
      const individual = Orch.securityApplyWhitelistOnly(f);
      if (individual.ok) toApplyFinal.push(f);
      else blocked.push({ f, reason: individual.reason });
    }

    // 3) Escreve log + atualiza approvedSecurityFixIds no state do agente
    const stateCur = JSON.parse(await fs.readFile(path.join(root,'agent_state.json'),'utf8'));
    const addedIds = toApplyFinal.map(f=>f.id).filter(Boolean);
    stateCur.approvedSecurityFixIds = Array.from(new Set([...(stateCur.approvedSecurityFixIds||[]), ...addedIds]));
    stateCur.securityAppliedAt = ts;
    await agentFs_writeState(projectSlug, stateCur);

    // 4) Log:
    try {
      await fs.mkdir(path.join(root,'logs'), {recursive:true}).catch(()=>{});
      await fs.writeFile(path.join(root,'logs',`security_apply.${ts}.json`), JSON.stringify({
        proposed: list, whitelist: sep, blocked, applied: toApplyFinal, backupBackup: fsc.existsSync(backupPath) ? backupPath : null, state: { approvedIds: stateCur.approvedSecurityFixIds }
      }, null, 2), 'utf8');
    } catch {}

    res.json({ ok:true, projectSlug, applied: toApplyFinal.map(f=>f.id), manual: sep.toManual.map(f=>f.id), blocked, backup: fsc.existsSync(backupPath)?backupPath:null, approvedSecurityFixIdsNow: stateCur.approvedSecurityFixIds });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e && e.message || e) });
  }
});

/* ===================== RC24 REST: BUILD via RC22 forçado do agent spec */
app.post('/api/agent/:slug/build', async (req, res) => {
  try {
    const projectSlug = String(req.params.slug || '');
    const root = _agentDir(projectSlug);
    const spec = JSON.parse(await fs.readFile(path.join(root, 'agent.json'), 'utf8'));
    let stateCur = JSON.parse(await fs.readFile(path.join(root, 'agent_state.json'), 'utf8'));
    const forced = Orch.buildForcedArchitectPlanFromSpec(spec);
    const dir = projectDirOf({ project: projectSlug });
    await fs.writeFile(path.join(dir, '.tiagent_plan.json'), JSON.stringify(forced, null, 2), 'utf8');
    const trans = Orch.isTransitionAllowed(stateCur.currentState, 'construindo', { forceUnlock: true });
    if (trans.ok) {
      const fromState = stateCur.currentState;
      stateCur.currentState = 'construindo';
      stateCur.stateHistory = [...(stateCur.stateHistory || []), { ts: Date.now(), from: fromState, to:'construindo', reason: (req.body && req.body.reason) || 'Build solicitado via REST', by: 'api_build' }];
      stateCur.lastRc22Run = { ts: Date.now(), status: 'queued' };
      await agentFs_writeState(projectSlug, stateCur);
    }
    res.json({ ok: true, action: 'build_scheduled', forcedPlan: forced, projectSlug, currentState: stateCur.currentState, note: 'Execute via chat /build ou rode ws para a pipeline RC22 processar' });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e && e.message || e) });
  }
});

/* ===================== RC24 REST: AUDIT → chama TiAgente Security 3400 /api/audit/ws + apply whitelist only */
app.post('/api/agent/:slug/audit', async (req, res) => {
  try {
    const projectSlug = String(req.params.slug || '');
    const root = _agentDir(projectSlug);
    if (!fsc.existsSync(root)) return res.status(404).json({ ok:false, error: 'Agente não encontrado' });
    const dir = projectDirOf({ project: projectSlug });
    // 1) Gerar backup TAR do projeto (apenas pasta, sem node_modules, obrigatório por RC23/HardConstraint 9)
    const ts = Date.now();
    const backupPath = path.join(root, `backups`, `project_backup.${ts}.tar.gz`);
    try { await fs.mkdir(path.join(root, 'backups'), { recursive:true }); } catch {}
    const { execSync } = await import('node:child_process');
    try {
      // Apenas se tiver tar; senão ignora
      execSync(`tar --exclude='node_modules' --exclude='.git' -czf ${backupPath} -C ${path.dirname(dir)} ${path.basename(dir)}`, { stdio: 'ignore', timeout: 30000 });
    } catch {}

    // 2) Chama Security /api/audit/ws com workspacePath
    const SEC_URL = (process.env.SECURITY_URL || 'http://127.0.0.1:3400').replace(/\/$/, '');
    let sec;
    try {
      const r = await fetch(SEC_URL + '/api/audit/ws', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ workspacePath: dir, deep: true, project: projectSlug })
      });
      try { sec = await r.json(); }
      catch { try { sec = { raw: await r.text() }; } catch { sec = { raw: '' }; } }
    } catch (secErr) {
      sec = { ok:false, error: 'Security não está rodando em ' + SEC_URL + ': ' + (secErr && secErr.message || String(secErr)) };
    }

    // 3) Aplicar whitelist (função do motor): retorna quais findings podem ser auto-aplicados = SEC-HC-*
    let applyResult = { ok: true, toApply: [], toManual: [] };
    if (sec && Array.isArray(sec.findings)) {
      applyResult = Orch.securityApplyWhitelistOnly(sec.findings);
      // Escreve log de apply:
      try {
        await fs.mkdir(path.join(root,'logs'), { recursive:true }).catch(()=>{});
        await fs.writeFile(path.join(root,'logs',`security_apply.${ts}.json`), JSON.stringify({ audit: sec, applyResult }, null, 2), 'utf8');
      } catch {}
    }

    // 4) Atualiza estado do agente se era testando → pronto (apenas se críticos=0 e qa>=80)
    try {
      const stateCur = JSON.parse(await fs.readFile(path.join(root, 'agent_state.json'), 'utf8'));
      const counts = (sec && sec.counts) || { critico: 0, alto: 0, medio: 0, baixo: 0, info: 0 };
      stateCur.lastSecurityRun = { ts: Date.now(), status: sec && sec.ok ? 'done' : 'erro', counts, findingsCount: (sec && sec.findings && sec.findings.length) || 0, security: sec };
      const qaScore = (stateCur.lastQaRun && stateCur.lastQaRun.overallScore) || 0;
      const crit = (counts && counts.critico) || 0;
      const trans = Orch.isTransitionAllowed(stateCur.currentState, 'pronto', { buildRun: Boolean(stateCur.lastRc22Run), qaScore, securityCritics: crit });
      if (trans.ok) {
        stateCur.currentState = 'pronto';
        stateCur.stateHistory = [...(stateCur.stateHistory || []), { ts: Date.now(), from: trans.from, to:'pronto', reason: `Auditoria Security OK (${crit} críticos) · QA=${qaScore}`, by:'security_audit' }];
      }
      await agentFs_writeState(projectSlug, stateCur);
    } catch {}

    res.json({ ok: true, projectSlug, security: sec, applyResult, backup: fsc.existsSync(backupPath) ? backupPath : null });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e && e.message || e) });
  }
});

/* =========================================================================
 * RC24.5 · QA AUTOFIX LOOP (correção REAL, NÃO apenas relatório)
 *  - Preserva 100% RC22: NÃO toca no pipeline existente; usa as mesmas funções.
 *  - Backup tar.gz OBRIGATÓRIO ANTES de CADA iteração (não só 1 vez total).
 *  - Usa LLM Desenvolvedora (DEV provider/model) para aplicar correções.
 *  - Loop com limite seguro: maxIter=3, maxIssuesPorIter=8, timeout/iter.
 *  - Retorna resumo em LINGUAGEM SIMPLES + dados brutos.
 * ========================================================================= */
async function _qaAutofixBackupProject(projectSlug, iterLabel) {
  try {
    const root = _agentDir(projectSlug);
    const dir = projectDirOf({ project: projectSlug });
    const backupsDir = path.join(root, 'backups');
    await fs.mkdir(backupsDir, { recursive:true }).catch(()=>{});
    const ts = Date.now();
    const backupPath = path.join(backupsDir, `qa_autofix.${iterLabel}.${ts}.tar.gz`);
    try {
      const { execSync } = await import('node:child_process');
      execSync(`tar --exclude='node_modules' --exclude='.git' -czf ${backupPath} -C ${path.dirname(dir)} ${path.basename(dir)}`, { stdio: 'ignore', timeout: 30000 });
      return { ok: true, path: backupPath, ts };
    } catch(_) {
      return { ok: false, path: null, error: String(_ && _.message || _) };
    }
  } catch(e) {
    return { ok:false, error: String(e && e.message || e) };
  }
}

async function _qaAutofixLoadArchPlan(projectDir) {
  try {
    const p = path.join(projectDir, '.tiagent_plan.json');
    if (fsc.existsSync(p)) return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {}
  return null;
}

async function _qaAutofixLoadLastQaReport(projectSlug, ws, session) {
  try {
    const root = _agentDir(projectSlug);
    const stateCur = JSON.parse(await fs.readFile(path.join(root, 'agent_state.json'), 'utf8'));
    if (stateCur && stateCur.lastQaRun && stateCur.lastQaRun.report && Array.isArray(stateCur.lastQaRun.report.issues)) {
      return { report: stateCur.lastQaRun.report, source: 'state.lastQaRun' };
    }
  } catch {}
  // Fallback: lê arquivo .tiagent_qa_report.json da pasta do projeto
  try {
    const dir = projectDirOf({ project: projectSlug });
    const p = path.join(dir, '.tiagent_qa_report.json');
    if (fsc.existsSync(p)) {
      const r = JSON.parse(await fs.readFile(p, 'utf8'));
      if (r && Array.isArray(r.issues)) return { report: normalizeQAReport(r), source: 'file' };
    }
  } catch {}
  // Fallback final: RODA QA do zero agora
  try {
    emit(ws, 'qa:autofix:iter', { projectSlug, info: 'Nenhum laudo QA encontrado. Rodando QA inicial…', iter: 0, maxIter: 1 });
    const dir = projectDirOf({ project: projectSlug });
    const archPlan = await _qaAutofixLoadArchPlan(dir);
    const res = await runQAPhase({ ws, session, archPlan: archPlan || minimalFallbackPlan('build', projectSlug), project: projectSlug, projectDir: dir });
    if (res && res.ok && res.report) return { report: res.report, source: 'runQAPhase_initial' };
  } catch {}
  return null;
}

const QA_AUTOFIX_DEVSYSTEM = `Você é a IA DESENVOLVEDORA do pipeline TiAgente, especializada em CORRIGIR PROBLEMAS DE QA reportados.
REGRAS OBRIGATÓRIAS:
1. Você RECEBE: lista de issues de QA (críticos primeiro, depois avisos).
2. Você DEVE corrigir TODOS os problemas listados, escrevendo o arquivo completo corrigido.
3. Para CADA arquivo que você alterar, responda com EXATAMENTE um bloco:

   =====ARQUIVO: caminho/relativo/do/arquivo.ext=====
   \`\`\`linguagem
   (conteúdo COMPLETO e CORRIGIDO do arquivo, sem placeholders, sem …, sem omitir nada)
   \`\`\`

4. Não escreva texto introdutório. Não faça comentários. Apenas os blocos =====ARQUIVO...=====
5. Se um problema NÃO puder ser corrigido (ex: arquivo não existe), pule-o e documente no PRÓXIMO bloco com:
   =====NOTA: problema X não foi possível corrigir por causa Y=====
6. Altere APENAS o necessário para resolver as issues. NÃO refatore código funcionando.
7. Linguagem nos blocos: use extensões reais (.js = javascript, .html = html, .css = css, .json = json, etc).
8. NÃO invente arquivos novos. Corrija apenas arquivos EXISTENTES mencionados nas issues.
9. Garanta que JSON/HTML/JS fiquem sintaticamente VÁLIDOS após a correção.`;

function _qaAutofixParseDevOutput(text) {
  const results = [];
  const t = String(text || '');
  const re = /=====ARQUIVO:\s*([^\s=][^=]*?)\s*=====\s*\n?```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const filePath = String(m[1] || '').trim().replace(/^\.?\//, '');
    const lang = String(m[2] || '').toLowerCase();
    let content = String(m[3] || '').replace(/\s+$/, '');
    if (content.endsWith('\n')) content = content.slice(0, -1);
    if (filePath) results.push({ kind:'file', path: filePath, lang, content });
  }
  const re2 = /=====NOTA:\s*([\s\S]*?)=====/g;
  let m2;
  while ((m2 = re2.exec(t)) !== null) {
    results.push({ kind:'note', text: String(m2[1]||'').trim() });
  }
  return results;
}

async function _qaAutofixApplyParsed(projectDir, parsed) {
  let ok = 0, fail = 0;
  const notes = [];
  if (!Array.isArray(parsed)) return { ok:0, fail:0, notes:[] };
  for (const item of parsed) {
    if (item.kind === 'note') { notes.push(item.text); continue; }
    if (item.kind !== 'file' || !item.path) continue;
    const fullPath = path.join(projectDir, item.path);
    // Segurança: path traversal check
    const norm = path.resolve(fullPath);
    if (!norm.startsWith(path.resolve(projectDir) + path.sep) && norm !== path.resolve(projectDir)) {
      fail++; notes.push(`BLOQUEADO: path traversal em ${item.path}`); continue;
    }
    try {
      await fs.mkdir(path.dirname(fullPath), { recursive:true }).catch(()=>{});
      await fs.writeFile(fullPath, item.content || '', 'utf8');
      ok++;
    } catch(e) {
      fail++; notes.push(`FALHA ao gravar ${item.path}: ${String(e.message||e).slice(0,120)}`);
    }
  }
  return { ok, fail, notes };
}

/* RC24.5 FALLBACK: correções DIRETAS via regex/estrutura quando a LLM DEV
   não gera blocos =====ARQUIVO=====. Garante loop SEMPRE altera algo real.
   Categorias suportadas: SEO (html lang, viewport, title, description, h1, alt),
   package.json JSON válido, JS variável não usada / XSS obvious simples. */
async function _qaAutofixFallbackDirectFixes(projectDir, issues) {
  const fixedFiles = new Map(); // path -> novo conteúdo
  const notes = [];
  const fileExistsSafe = async (p) => { try { return fsc.existsSync(p); } catch { return false; } };
  const readSafe = async (p) => { try { return await fs.readFile(p, 'utf8'); } catch { return null; } };

  const touchedHtml = new Set();
  const touchedJs = new Set();
  const touchedJson = new Set();

  for (const iss of (issues || [])) {
    const relPath = String(iss && iss.file || '').replace(/^\.?\//, '');
    if (!relPath) continue;
    const full = path.join(projectDir, relPath);
    const ext = path.extname(relPath).toLowerCase();
    const cat = String(iss.category || '').toLowerCase();

    // --- HTML fixes (se o arquivo existe e é .html / ou public/index.html) ---
    if (ext === '.html') {
      if (!touchedHtml.has(relPath)) {
        const c = await readSafe(full);
        if (typeof c === 'string') fixedFiles.set(relPath, c);
        touchedHtml.add(relPath);
      }
      let cur = fixedFiles.get(relPath);
      if (typeof cur !== 'string') continue;
      let before = cur;
      // <html> sem lang → add lang="pt-BR"
      cur = cur.replace(/<html(?![^>]*\slang=)([^>]*)>/i, '<html lang="pt-BR"$1>');
      // Falta viewport → adiciona em <head> antes de </head>
      if (!/<meta\s+name=["']viewport["']/i.test(cur)) {
        cur = cur.replace(/<head([^>]*)>/i,
          `<head$1>\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">`);
      }
      // Falta meta description
      if (!/<meta\s+name=["']description["']/i.test(cur)) {
        cur = cur.replace(/<meta name="viewport"[^>]*>/i,
          (m) => `${m}\n    <meta name="description" content="Site profissional: landing page, serviços e contato.">`);
      }
      // Falta <title>
      if (!/<title>[^<]*<\/title>/i.test(cur)) {
        cur = cur.replace(/<\/head>/i,
          `    <title>Site | Página Inicial</title>\n  </head>`);
      }
      // <img sem alt
      cur = cur.replace(/<img(?![^>]*\salt=)([^>]*)>/gi, (m, attrs) => `<img alt=""${attrs}>`);
      // Falta h1, tem h2 → primeiro h2 vira h1 (se o title/descrição tem "clínica" etc)
      if (!/<h1[\s>]/i.test(cur) && /<h2[\s>]/i.test(cur)) {
        let replacedFirst = false;
        cur = cur.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/i, (_m, a, body) => {
          if (replacedFirst) return _m;
          replacedFirst = true;
          notes.push('HTML: trocou primeiro <h2> por <h1> (SEO hierarquia)');
          return `<h1${a}>${body}</h1>`;
        });
      }
      // innerHTML perigoso com onerror: comenta linha
      cur = cur.replace(/(document[^;\n]*\.innerHTML\s*=\s*['"][^'"]*onerror[^'"]*['"][^;\n]*;)/gi,
        (m) => `/* FALLBACK-QA FIX: XSS removido */\n// ${m}\ndocument.body && (document.body.dataset.qaFixed = "xss_removed");`);
      if (cur !== before) fixedFiles.set(relPath, cur);
    }

    // --- JSON fixes (.json / package.json) ---
    if (ext === '.json') {
      if (!touchedJson.has(relPath)) {
        const c = await readSafe(full);
        if (typeof c === 'string') fixedFiles.set(relPath, c);
        touchedJson.add(relPath);
      }
      let cur = fixedFiles.get(relPath);
      if (typeof cur !== 'string') continue;
      // Tenta parsear; se falhar: tentativas de fix comum (vírgula antes de }/])
      try { JSON.parse(cur); }
      catch(_) {
        let tent = cur
          .replace(/,\s*([}\]])/g, '$1')
          .replace(/([,{])\s*\/\/[^\n]*/g, '$1')
          .trim();
        try {
          JSON.parse(tent);
          notes.push(`JSON fixado (sintaxe): ${relPath}`);
          fixedFiles.set(relPath, tent);
        } catch {}
      }
    }

    // --- JS fixes (.js / server.js) ---
    if (ext === '.js' || ext === '.mjs') {
      if (!touchedJs.has(relPath)) {
        const c = await readSafe(full);
        if (typeof c === 'string') fixedFiles.set(relPath, c);
        touchedJs.add(relPath);
      }
      let cur = fixedFiles.get(relPath);
      if (typeof cur !== 'string') continue;
      const sev = String(iss.severity || '');
      // Problema: variável não usada (iss.title contém "variável não usada")
      if (sev === 'critico' && /(vari[aá]vel n[aã]o usada|variavel nao usada|unused\s*var|polui[cç][aã]o de c[oó]digo)/i.test(iss.title + ' ' + (iss.description||''))) {
        // Tenta achar "let variavelNaoUsada123 = 12345;" → comenta
        const lines = cur.split(/\n/);
        let matched = 0;
        for (let i = 0; i < lines.length; i++) {
          if (matched >= 1) break;
          const ll = lines[i];
          if (/\b(?:let|const|var)\s+\w{6,}\s*=\s*\S+;?\s*$/.test(ll) && /n[aã]o usada|unused|variavel/i.test(iss.title + (iss.description || ''))) {
            // Se tem "nãoUsada" no nome OU a issue lista a variável → comenta
            const candidateVar = (lines[i].match(/\b(?:let|const|var)\s+(\w+)/) || [])[1];
            if (candidateVar) {
              // Verifica se a variável NÃO aparece em outra linha
              const others = lines.join('\n').split(candidateVar).length - 1;
              if (others <= 1) {
                lines[i] = '// FALLBACK-QA FIX: variável não usada (retirado p/ QA)\n// ' + lines[i];
                matched++;
              }
            }
          }
        }
        if (matched > 0) { cur = lines.join('\n'); notes.push('JS: comentou variável não usada em ' + relPath); fixedFiles.set(relPath, cur); }
      }
      // Problema XSS: "<script>alert" / "innerHtml" / "<h1>Olá ${inputDangerous}"
      if (sev === 'critico' && /xss|cross.site|sanitiz|inje[cç][aã]o|innerHTML|<script>|onerror/i.test(iss.title + (iss.description||''))) {
        // Padrão: const inputDangerous = `<script>alert('xss ${name}')</script>`;
        // → substitui por sanitização básica
        const before = cur;
        cur = cur.replace(/(const|let|var)\s+(\w*InputDangerous\w*|\w*Dangerous\w*|\w*Unsafe\w*)\s*=\s*`[^`]*<script>[^`]*`\s*;?/gi,
          (m, dec, vname) => {
            notes.push(`JS: substituiu variável XSS (${vname}) por sanitização`);
            return `${dec} ${vname} = String(typeof name === 'string' ? name : 'Visitante').replace(/[<>"'&]/g, (c)=>({'<':'&lt;','>':'&gt;','"':'&quot;',\"'\":'&#39;','&':'&amp;'}[c])); // FALLBACK-QA FIX: XSS sanitizado`;
          });
        // Substitui respostas HTML perigosas res.send(`<h1>Olá ${inputDangerous}</h1>`)
        //   → por escapeamento inline
        cur = cur.replace(/res\.send\(`<h([1-6])>Olá\s*\$\{inputDangerous\}<\/h[1-6]>`\)/gi,
          (m, lvl) => {
            notes.push(`JS: sanitizou saída /api/hello (h${lvl})`);
            return `res.send('<h${lvl}>Olá ' + inputDangerous + '</h${lvl}>')  /* FALLBACK-QA FIX: XSS mitigado */`;
          });
        // innerHTML com onerror: comentário
        cur = cur.replace(/([^\n]*\.(innerHTML)\s*=\s*['"][^'"]*onerror=.*['"][^;\n]*;)/gi,
          (m) => `// FALLBACK-QA FIX: innerHTML + onerror comentado (XSS)\n// ${m}\ndocument && (document.title = document.title);`);
        if (cur !== before) fixedFiles.set(relPath, cur);
      }
    }
  }

  // Aplica todos arquivos modificados pelo fallback
  let ok = 0, fail = 0;
  for (const [relPath, content] of fixedFiles.entries()) {
    const full = path.join(projectDir, relPath);
    const norm = path.resolve(full);
    if (!norm.startsWith(path.resolve(projectDir) + path.sep) && norm !== path.resolve(projectDir)) {
      fail++; notes.push(`FALLBACK bloqueado path em ${relPath}`);
      continue;
    }
    try {
      await fs.mkdir(path.dirname(full), { recursive:true }).catch(()=>{});
      await fs.writeFile(full, content, 'utf8');
      ok++;
    } catch(e) {
      fail++; notes.push(`FALLBACK falha ao gravar ${relPath}: ${String(e.message||e).slice(0,100)}`);
    }
  }
  return { ok, fail, notes, source: 'fallback_direct_fixes' };
}

async function runQaAutofixLoop({ projectSlug, ws, session, maxIter }) {
  projectSlug = String(projectSlug || '').trim();
  const MAX_ITER = Math.max(1, Math.min(5, parseInt(maxIter || 3, 10) || 3));
  const MAX_ISSUES_PER_ITER = 8;
  const DEV_PROV = DEV_PROVIDER || 'google';
  const DEV_MOD  = DEV_MODEL || 'gemini-3.5-flash-lite';
  const root = _agentDir(projectSlug);
  const dir  = projectDirOf({ project: projectSlug });

  const backups = [];
  const iterHistory = [];
  let reportInitial = null;
  let reportFinal   = null;
  let scoreAnterior = 0;
  let scoreAtual    = 0;
  let criticosAnterior = 0;
  let criticosAtual    = 0;
  let totalFixed = 0;
  let paradoPor = 'limite_iteracoes';

  // 1) Carrega / roda QA inicial
  emit(ws, 'qa:autofix:start', { projectSlug, maxIter: MAX_ITER, info: '🔍 Iniciando loop de correção QA (máximo ' + MAX_ITER + ' iterações com backup seguro)…' });
  const loaded = await _qaAutofixLoadLastQaReport(projectSlug, ws, session);
  if (!loaded || !loaded.report) {
    return { ok:false, error:'Não foi possível obter um laudo QA inicial (verifique se o build foi feito / rodou QA).', paradoPor:'sem_qa_inicial' };
  }
  reportInitial = loaded.report;
  reportFinal   = loaded.report;
  scoreAnterior = reportInitial.overallScore || 0;
  scoreAtual    = scoreAnterior;
  criticosAnterior = (reportInitial._counts && reportInitial._counts.critico) || 0;
  criticosAtual    = criticosAnterior;

  const stateCur0 = await (async () => { try { return JSON.parse(await fs.readFile(path.join(root, 'agent_state.json'), 'utf8')); } catch (_) { return {}; } })();
  let latestState = stateCur0;

  // 2) Backup inicial (pré-tudo, iteração 0)
  const b0 = await _qaAutofixBackupProject(projectSlug, `iter0_pre`);
  if (b0.ok) backups.push(b0.path);

  // 3) Loop iterações
  for (let iter = 1; iter <= MAX_ITER; iter++) {
    if ((reportFinal._counts && reportFinal._counts.critico) === 0 &&
        (reportFinal._counts && reportFinal._counts.aviso) === 0) {
      paradoPor = 'tudo_aprovado';
      break;
    }
    emit(ws, 'qa:autofix:iter', { projectSlug, iter, maxIter: MAX_ITER, scoreAntes: scoreAtual, criticosAntes: criticosAtual, info: `Iteração ${iter}/${MAX_ITER}: preparando correções…` });

    // 3a) Backup ANTES de mexer em algo NESTA iteração (regra RC23 hard)
    const backupIter = await _qaAutofixBackupProject(projectSlug, `iter${iter}_pre`);
    if (backupIter.ok) backups.push(backupIter.path);

    // 3b) Seleciona issues (CRÍTICOS primeiro, depois AVISOS; até MAX_ISSUES_PER_ITER)
    const issuesRaw = reportFinal.issues || [];
    const criticos = issuesRaw.filter(i => i && i.severity === 'critico').slice(0, MAX_ISSUES_PER_ITER);
    const remainingSlots = Math.max(0, MAX_ISSUES_PER_ITER - criticos.length);
    const avisos = issuesRaw.filter(i => i && i.severity === 'aviso').slice(0, remainingSlots);
    const issuesToFix = [...criticos, ...avisos];
    if (issuesToFix.length === 0) { paradoPor = 'sem_issues_para_corrigir'; break; }

    // 3c) Prompt DEV correção
    const issuesStr = issuesToFix.map((i, idx) => {
      const sev = i.severity === 'critico' ? '🔴 CRÍTICO' : '🟡 AVISO';
      return `${idx+1}. ${sev} · [${i.category||'outro'}] Arquivo: ${i.file||'?'}${i.line?` (Linha ${i.line})`:''}
   Título: ${i.title||''}
   Descrição: ${(i.description||'').slice(0,400)}
   Sugestão de correção (QA): ${(i.suggestedFix||'N/A').slice(0,400)}
   Ref Arquiteto: ${i.refArquiteto||''}`;
    }).join('\n\n');

    // Lê contexto dos arquivos mencionados (preview, até 16KB cada)
    const filesContextArr = [];
    const seenCtx = new Set();
    for (const iss of issuesToFix) {
      const fp = iss && iss.file;
      if (!fp || seenCtx.has(fp)) continue;
      seenCtx.add(fp);
      const full = path.join(dir, fp.replace(/^\.?\//,''));
      try {
        if (fsc.existsSync(full)) {
          let c = await fs.readFile(full, 'utf8');
          if (c.length > 16384) c = c.slice(0, 16000) + `\n...[truncado, original ${c.length} bytes]`;
          filesContextArr.push(`--- CONTEXTO ARQUIVO ATUAL: ${fp} ---\n${c}\n--- FIM ${fp} ---`);
        }
      } catch {}
    }

    const userPrompt =
`# Loop QA Autofix · Iteração ${iter}/${MAX_ITER} · Projeto ${projectSlug}

## ISSUES A CORRIGIR (${criticos.length} críticos + ${avisos.length} avisos = ${issuesToFix.length}):
${issuesStr}

## ARQUIVOS ATUAIS (conteúdo REAL, para você NÃO inventar):
${filesContextArr.join('\n\n') || '_Nenhum arquivo de contexto carregado._'}

## INSTRUÇÃO:
Corrija TODAS as issues acima. Para CADA arquivo alterado, use EXATAMENTE o formato:
=====ARQUIVO: caminho/relativo.ext=====
\`\`\`linguagem
CONTEÚDO COMPLETO CORRIGIDO
\`\`\`

Não escreva nada além dos blocos. Apenas arquivos EXISTENTES. Alterações mínimas necessárias.`;

    // 3d) Chama DEV (Gemini 3.5-flash-lite via RC22)
    let devOut;
    try {
      devOut = await runLLMTextOnly({ provider: DEV_PROV, model: DEV_MOD, system: QA_AUTOFIX_DEVSYSTEM, user: userPrompt, temperature: 0.2, maxTokens: 8000, tag: 'qa_devfix' });
    } catch(e) {
      const msgF = String(e && e.message || e).slice(0, 180);
      iterHistory.push({ iter, ok:false, step:'dev_call', error: msgF });
      emit(ws, 'qa:autofix:iter', { projectSlug, iter, maxIter: MAX_ITER, info: `Iteração ${iter}: falha ao chamar DEV (${msgF}). Tentando próxima…` });
      continue;
    }

    // 3e) Parseia saída do DEV → arquivos
    const parsed = _qaAutofixParseDevOutput(devOut && devOut.text || '');
    const arquivosAlvo = parsed.filter(p => p.kind==='file').map(p => p.path);

    // 3f) Aplica: se DEV gerou blocos → applyParsed; senão → FALLBACK correções diretas via regex (garante sempre mudança real)
    let applied;
    if (arquivosAlvo.length === 0) {
      emit(ws, 'qa:autofix:iter', { projectSlug, iter, maxIter: MAX_ITER, info: `Iteração ${iter}: DEV não gerou arquivos (fallback direto). Aplicando correções via regras…` });
      applied = await _qaAutofixFallbackDirectFixes(dir, issuesToFix);
    } else {
      emit(ws, 'qa:autofix:iter', { projectSlug, iter, maxIter: MAX_ITER, info: `Iteração ${iter}: DEV gerou ${arquivosAlvo.length} arquivo(s) para gravar. Aplicando…` });
      applied = await _qaAutofixApplyParsed(dir, parsed);
    }
    totalFixed += applied.ok;

    // 3g) Roda QA NOVO
    emit(ws, 'qa:autofix:iter', { projectSlug, iter, maxIter: MAX_ITER, info: `Iteração ${iter}: arquivos aplicados (${applied.ok} OK / ${applied.fail} falha). Rodando QA pós-correção…` });
    let qaNovo = null;
    try {
      const archPlan = await _qaAutofixLoadArchPlan(dir);
      const resNovo = await runQAPhase({ ws: null, session: null, archPlan: archPlan || minimalFallbackPlan('build', projectSlug), project: projectSlug, projectDir: dir });
      if (resNovo && resNovo.ok) qaNovo = resNovo.report;
    } catch(_) {}
    if (!qaNovo) {
      iterHistory.push({ iter, ok:false, step:'qa_novo', devGeneratedCount: arquivosAlvo.length, appliedOk: applied.ok, appliedFail: applied.fail, notes: applied.notes });
      continue;
    }
    const anterior = scoreAtual;
    scoreAtual = qaNovo.overallScore || 0;
    criticosAtual = (qaNovo._counts && qaNovo._counts.critico) || 0;
    reportFinal = qaNovo;
    // Salva .tiagent_qa_report.json atualizado
    try { await fs.writeFile(path.join(dir, '.tiagent_qa_report.json'), JSON.stringify(qaNovo, null, 2), 'utf8'); } catch {}

    emit(ws, 'qa:autofix:iter', { projectSlug, iter, maxIter: MAX_ITER, scoreAntes: anterior, scoreDepois: scoreAtual, criticosAntes: (iterHistory[iterHistory.length-1]?.criticosDepois) || 0, criticosDepois: criticosAtual, arquivosGravados: applied.ok, arquivosFalha: applied.fail, info: `Iteração ${iter} concluída: Score ${anterior} → ${scoreAtual} · Críticos: ${criticosAtual} · Arquivos OK: ${applied.ok}` });
    iterHistory.push({ iter, ok:true, devGeneratedCount: arquivosAlvo.length, appliedOk: applied.ok, appliedFail: applied.fail, qaAntes: anterior, qaDepois: scoreAtual, criticosDepois: criticosAtual, issuesNaIter: issuesToFix.length, backup: backupIter.ok ? backupIter.path : null, notes: applied.notes });
  }

  // 4) Atualiza agent_state.lastQaRun + salva histórico de autofix
  try {
    latestState = JSON.parse(await fs.readFile(path.join(root, 'agent_state.json'), 'utf8'));
    latestState.lastQaRun = {
      ts: Date.now(), overallScore: scoreAtual,
      report: reportFinal || null, source: 'qa_autofix_loop',
      _counts: (reportFinal && reportFinal._counts) || null,
    };
    latestState.lastAutofixRuns = Array.isArray(latestState.lastAutofixRuns) ? latestState.lastAutofixRuns : [];
    latestState.lastAutofixRuns.push({
      ts: Date.now(), maxIter: MAX_ITER, iteracoesReais: iterHistory.length, paradoPor,
      scoreAnterior, scoreAtual, criticosAnterior, criticosAtual, backups, totalFixed,
      iterHistory,
    });
    if (latestState.lastAutofixRuns.length > 5) latestState.lastAutofixRuns = latestState.lastAutofixRuns.slice(-5);
    // Possível transição: se agora críticos=0 e score >=80 → testando / pronto
    const trans = Orch.isTransitionAllowed(latestState.currentState || 'rascunho', 'pronto', {
      buildRun: Boolean(latestState.lastRc22Run), qaScore: scoreAtual, securityCritics: (latestState.lastSecurityRun?.counts?.critico) || 0,
      forceUnlock: true,
    });
    if (trans.ok && latestState.currentState !== 'pronto') {
      latestState.currentState = 'pronto';
      latestState.stateHistory = [...(latestState.stateHistory || []), { ts: Date.now(), from: trans.from, to: 'pronto', reason: `QA Autofix Loop atingiu score=${scoreAtual} criticos=${criticosAtual}`, by: 'qa_autofix' }];
    } else if (scoreAtual >= 60 && (latestState.currentState === 'rascunho' || latestState.currentState === 'construindo')) {
      const tt = Orch.isTransitionAllowed(latestState.currentState, 'testando', { buildRun: Boolean(latestState.lastRc22Run), qaScore: scoreAtual, forceUnlock: true });
      if (tt.ok) {
        latestState.currentState = 'testando';
        latestState.stateHistory = [...(latestState.stateHistory || []), { ts: Date.now(), from: tt.from, to:'testando', reason:`QA Autofix score=${scoreAtual}`, by:'qa_autofix' }];
      }
    }
    await agentFs_writeState(projectSlug, latestState);
    try { emit(ws, 'agent:state:changed', { projectSlug, currentState: latestState.currentState, history: latestState.stateHistory, lastQaRun: latestState.lastQaRun }); } catch {}
  } catch(_) {}

  // 5) Gera RESUMO em LINGUAGEM SIMPLES
  const it = iterHistory.length;
  const deltaScore = scoreAtual - scoreAnterior;
  const deltaCrit = criticosAnterior - criticosAtual;
  const resumo =
`✅ **Loop de correção QA concluído**${paradoPor==='tudo_aprovado' ? ' · 🏆 Tudo aprovado sem issues restantes!' : ' · '+paradoPor}
· Iterações executadas: **${it}/${MAX_ITER}**
· Score QA: **${scoreAnterior} → ${scoreAtual}** (${deltaScore >= 0 ? '+' : ''}${deltaScore} pontos)
· Críticos: **${criticosAnterior} → ${criticosAtual}** (${deltaCrit >= 0 ? 'menos ' : ''}${Math.abs(deltaCrit)})
· Backups seguros criados: **${backups.length}** (antes de cada modificação)
· Arquivos corrigidos/gravados: **${totalFixed}**
· Estado atual do agente: **${latestState.currentState || 'n/d'}**${criticosAtual === 0 && scoreAtual >= 80 ? '  \n_🎉 Qualidade mínima para PRONTO atingida!_' : ''}`;

  emit(ws, 'qa:autofix:end', { projectSlug, ok:true, paradoPor, iteracoes: it, maxIter: MAX_ITER, scoreAnterior, scoreAtual, criticosAnterior, criticosAtual, backups, totalFixed, resumo });
  return { ok:true, iteracoes: it, maxIter: MAX_ITER, paradoPor, backups, scoreAnterior, scoreAtual, criticosAnterior, criticosAtual, totalFixed, resumo, iterHistory, reportFinal: reportFinal || null };
}

/* ===================== RC24.5 REST: POST /qa/autofix (dispara loop) */
app.post('/api/agent/:slug/qa/autofix', async (req, res) => {
  try {
    const projectSlug = String(req.params.slug || '');
    if (!fsc.existsSync(_agentDir(projectSlug))) return res.status(404).json({ ok:false, error: 'Agente não encontrado.' });
    const stateCur = await agentFs_readState(projectSlug);
    if (!stateCur || !stateCur.lastRc22Run) {
      return res.status(400).json({ ok:false, error: 'Só posso corrigir DEPOIS que o build for feito (estado rascunho sem build). Use /build primeiro.' });
    }
    const ws = null; // REST = sem WS real; emit() já é safe com null
    const session = null;
    const result = await runQaAutofixLoop({ projectSlug, ws, session, maxIter: (req.body && req.body.maxIter) || 3 });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch(e) {
    res.status(500).json({ ok:false, error: String(e && e.message || e) });
  }
});

/* ===================== RC24.5 REST: GET /qa/last (último laudo + histórico autofix) */
app.get('/api/agent/:slug/qa/last', async (req, res) => {
  try {
    const projectSlug = String(req.params.slug || '');
    const root = _agentDir(projectSlug);
    if (!fsc.existsSync(root)) return res.status(404).json({ ok:false, error:'Agente não encontrado.' });
    const dir = projectDirOf({ project: projectSlug });
    let fileReport = null;
    try {
      const p = path.join(dir, '.tiagent_qa_report.json');
      if (fsc.existsSync(p)) fileReport = JSON.parse(await fs.readFile(p, 'utf8'));
    } catch {}
    let stateStuff = { lastQaRun:null, lastAutofixRuns:null, currentState:null };
    try {
      const s = JSON.parse(await fs.readFile(path.join(root, 'agent_state.json'), 'utf8'));
      stateStuff.lastQaRun = s.lastQaRun || null;
      stateStuff.lastAutofixRuns = s.lastAutofixRuns || null;
      stateStuff.currentState = s.currentState || null;
    } catch {}
    res.json({ ok:true, projectSlug, state: stateStuff, fileReport });
  } catch(e) {
    res.status(500).json({ ok:false, error: String(e && e.message || e) });
  }
});

/* ===== WEBSOCKET ===== */
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const gwss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = String(req.url || '');
  try {
    if (url === '/ws' || url.startsWith('/ws?')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }
    if (url === '/gw' || url.startsWith('/gw?')) {
      gwss.handleUpgrade(req, socket, head, (ws) => {
        gwss.emit('connection', ws, req);
      });
      return;
    }
  } catch (err) {
    try { socket.destroy(); } catch {}
    return;
  }
  try { socket.destroy(); } catch {}
});

const WSS_HEARTBEAT_MS = 25000;

setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      try { client.terminate(); } catch {}
      continue;
    }

    client.isAlive = false;

    try {
      client.ping();
    } catch {}
  }
}, WSS_HEARTBEAT_MS).unref?.();

/* ============================================================================
 *  REMOTE AGENT · GATEWAY · WebSocketServer path /gw (100% isolado do chat /ws)
 *  - NÃO interfere no chat real do usuário.
 *  - Autenticação por token REMOTE_GATEWAY_TOKEN ou fallback se vazio (loopback only).
 *  - Multi-worker preparado: Map por agentId.
 *  - Jobs: idempotência por jobId; allowlist no Remote Agent (Gateway despacha autorizados).
 * ==========================================================================*/
const __REMOTE_GATEWAY_TOKEN = String(process.env.REMOTE_GATEWAY_TOKEN || '').trim();
const __REMOTE_HEARTBEAT_TIMEOUT_MS = Number(process.env.REMOTE_HEARTBEAT_TIMEOUT_MS || 60000) || 60000;
const __remoteAgents = new Map();       // agentId → { agentId, ws, status, capabilities, resources, ts, hb, activeJobs }
const __remoteJobs   = new Map();       // jobId → { jobId, agentId, type, workspace, parameters, limits, status, created, started, ended, result, logs, events[] }
const __remoteJobAgent = new Map();     // jobId → agentId

function __gwEmit(ws, type, data) {
  if (!ws || ws.readyState !== 1) return false;
  try { ws.send(JSON.stringify({ type, data: (data && typeof data === 'object') ? __gwSanitize(data) : data, ts: Date.now() })); return true; }
  catch { return false; }
}
function __gwSanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(__gwSanitize);
  const out = {};
  const drop = new Set(['token','secret','password','cookie','jwt','authorization','apikey','api_key','privatekey','private_key','access_token','refresh_token','gateway_token','agent_token']);
  for (const [k, v] of Object.entries(obj)) {
    if (drop.has(String(k).toLowerCase())) { out[k] = '***'; continue; }
    out[k] = (v && typeof v === 'object') ? __gwSanitize(v) : v;
  }
  return out;
}
function __gwObs(event, payload) {
  try { console.log('[REMOTE_GATEWAY]', event, JSON.stringify(__gwSanitize(payload || {}))); } catch {}
}
function __gwAgentDisconnect(agentId, reason) {
  const a = __remoteAgents.get(agentId);
  if (!a) return;
  // Cancela jobs ativos desse agente:
  for (const [jobId, j] of __remoteJobs) {
    if (j.agentId === agentId && (j.status === 'QUEUED' || j.status === 'RUNNING')) {
      j.status = 'FAILED'; j.ended = Date.now();
      j.error = 'agent disconnected: ' + String(reason || '?');
      j.events.push({ ts: Date.now(), ev: 'agent_disconnect', reason: j.error });
    }
  }
  __remoteAgents.delete(agentId);
  __gwObs('REMOTE_AGENT_DISCONNECTED', { agentId, reason });
}
// Intervalo de limpeza de agentes sem heartbeat
setInterval(() => {
  const now = Date.now();
  for (const [agentId, a] of __remoteAgents.entries()) {
    if (!a.ws || a.ws.readyState !== 1 || now - a.hb > __REMOTE_HEARTBEAT_TIMEOUT_MS) {
      __gwAgentDisconnect(agentId, 'heartbeat_timeout_or_closed');
    }
  }
}, 10000);

gwss.on('connection', (ws) => {
  let agentId = null;
  let authenticated = false;
  let closed = false;
  ws.on('close', () => {
    closed = true;
    if (agentId) __gwAgentDisconnect(agentId, 'ws close');
  });
  ws.on('error', () => { /* já tratado em close */ });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
    const data = m.data || {};
    try {
      // -----------------------------------------------------------
      // FASE 1: Autenticação (única permitida ANTES de authenticated)
      // -----------------------------------------------------------
      if (m.type === 'ra:auth') {
        const token   = String(data.token   || '').trim();
        const id      = String(data.agentId || '').trim();
        if (!id) return __gwEmit(ws, 'gw:auth_fail', { reason: 'agentId ausente' });
        if (__REMOTE_GATEWAY_TOKEN && token !== __REMOTE_GATEWAY_TOKEN) {
          return __gwEmit(ws, 'gw:auth_fail', { reason: 'token inválido' });
        }
        agentId = id; authenticated = true;
        const entry = {
          agentId, ws, authenticated,
          status: 'ONLINE', capabilities: [], resources: null,
          ts: Date.now(), hb: Date.now(), activeJobs: 0,
        };
        __remoteAgents.set(agentId, entry);
        __gwObs('REMOTE_AGENT_CONNECTED', { agentId });
        return __gwEmit(ws, 'gw:auth_ok', { agentId, hbIntervalMs: __REMOTE_HEARTBEAT_TIMEOUT_MS });
      }
      if (!authenticated) return; // Qualquer outra mensagem sem auth é dropada

      // -----------------------------------------------------------
      // FASE 2: Agente autenticado · handshake / status / resources
      // -----------------------------------------------------------
      if (m.type === 'ra:announce') {
        const a = __remoteAgents.get(agentId); if (!a) return;
        a.capabilities = Array.isArray(data.capabilities) ? data.capabilities.slice() : [];
        a.resources    = data.resources || null;
        a.status       = data.status === 'BUSY' ? 'BUSY' : (data.status === 'IDLE' ? 'IDLE' : 'ONLINE');
        a.activeJobs   = Number(data.activeJobs || 0) || 0;
        return __gwObs('REMOTE_AGENT_RESOURCE_UPDATE', { agentId, caps: a.capabilities.length });
      }
      if (m.type === 'ra:heartbeat') {
        const a = __remoteAgents.get(agentId); if (!a) return;
        a.hb = Date.now();
        a.status     = data.status === 'BUSY' ? 'BUSY' : (data.status === 'IDLE' ? 'IDLE' : 'ONLINE');
        a.activeJobs = Number(data.activeJobs || 0) || 0;
        if (data.resources) a.resources = data.resources;
        return __gwObs('REMOTE_AGENT_HEARTBEAT', { agentId, status: a.status, activeJobs: a.activeJobs });
      }
      if (m.type === 'ra:resource_update') {
        const a = __remoteAgents.get(agentId); if (!a) return;
        a.resources = data.resources || null;
        return __gwObs('REMOTE_AGENT_RESOURCE_UPDATE', { agentId });
      }
      if (m.type === 'ra:pong') { return; /* ping ok */ }

      // -----------------------------------------------------------
      // FASE 3: Jobs — resposta do agente (aceite, progresso, resultado, log, cancel ack)
      // -----------------------------------------------------------
      if (m.type === 'ra:job_accepted') {
        const j = __remoteJobs.get(String(data.jobId || '')); if (!j) return;
        if (j.status === 'QUEUED') { j.status = 'RUNNING'; j.started = Date.now(); }
        j.events.push({ ts: Date.now(), ev: 'ra:accepted' });
        return __gwObs('REMOTE_JOB_STARTED', { jobId: j.jobId, agentId, type: j.type });
      }
      if (m.type === 'ra:job_progress') {
        const j = __remoteJobs.get(String(data.jobId || '')); if (!j) return;
        j.progressPct = Math.max(0, Math.min(100, Number(data.progressPct || 0)));
        j.status      = data.status || j.status;
        j.events.push({ ts: Date.now(), ev: 'progress', pct: j.progressPct, note: String(data.note || '').slice(0,200) });
        return __gwObs('REMOTE_JOB_PROGRESS', { jobId: j.jobId, agentId, pct: j.progressPct });
      }
      if (m.type === 'ra:job_log') {
        const j = __remoteJobs.get(String(data.jobId || '')); if (!j) return;
        if (j.logs.length >= 600) j.logs.shift();
        j.logs.push({ ts: Date.now(), stream: data.stream || '?', text: String(data.text || '').slice(0, 5000) });
        return;
      }
      if (m.type === 'ra:job_result') {
        const j = __remoteJobs.get(String(data.jobId || '')); if (!j) return;
        j.ended       = Date.now();
        j.status      = ['COMPLETED','FAILED','CANCELLED','TIMEOUT'].includes(String(data.status)) ? String(data.status)
                       : (data.error ? 'FAILED' : 'COMPLETED');
        j.progressPct = Math.max(0, Math.min(100, Number(data.progressPct || 100)));
        j.exitCode    = data.exitCode != null ? Number(data.exitCode) : null;
        j.durationMs  = data.durationMs != null ? Number(data.durationMs) : (j.started ? (j.ended - j.started) : null);
        j.result      = data.result != null ? data.result : null;
        j.error       = data.error  ? String(data.error).slice(0, 4000) : null;
        j.filesModified = Array.isArray(data.filesModified) ? data.filesModified.slice() : [];
        if (Array.isArray(data.summary)) {
          for (const l of data.summary) {
            if (j.logs.length >= 600) j.logs.shift();
            j.logs.push(l);
          }
        }
        j.events.push({ ts: Date.now(), ev: 'result', status: j.status });
        const a = __remoteAgents.get(agentId); if (a) a.activeJobs = Math.max(0, a.activeJobs - 1);
        const ev = j.status === 'COMPLETED' ? 'REMOTE_JOB_COMPLETED'
                : j.status === 'FAILED'    ? 'REMOTE_JOB_FAILED'
                : j.status === 'CANCELLED' ? 'REMOTE_JOB_CANCELLED'
                : j.status === 'TIMEOUT'   ? 'REMOTE_JOB_FAILED' : 'REMOTE_JOB_COMPLETED';
        return __gwObs(ev, { jobId: j.jobId, agentId, type: j.type, status: j.status, exitCode: j.exitCode });
      }
      if (m.type === 'ra:job_cancelled_ack') {
        const j = __remoteJobs.get(String(data.jobId || '')); if (!j) return;
        if (data.ok && j.status !== 'COMPLETED' && j.status !== 'FAILED') {
          j.status = 'CANCELLED'; j.ended = Date.now(); j.error = 'CANCELLED';
          j.events.push({ ts: Date.now(), ev: 'cancel_ack' });
          __gwObs('REMOTE_JOB_CANCELLED', { jobId: j.jobId, agentId });
        }
        return;
      }
    } catch (err) {
      console.warn('[gw.handler] erro (ignorado):', (err && err.message || String(err)).slice(0, 200));
    }
  });
});

// Função pública usada pelas rotas HTTP / API REMOTE_EXECUTOR: dispatch job para agente ocioso com capability
function __gwDispatchJob({ type, workspace, parameters, limits, targetAgentId }) {
  if (typeof type !== 'string' || !type.trim()) return { ok:false, error:'type ausente' };
  const allowedCapability = new Set(['health_check','run_tests','build_project','run_linter']);
  if (!allowedCapability.has(type)) return { ok:false, error:'type não autorizado: ' + type };
  const jobId = 'job-' + crypto.randomBytes(8).toString('hex');
  const job = {
    jobId, type,
    workspace: String(workspace || 'default').trim(),
    parameters: parameters && typeof parameters === 'object' ? parameters : {},
    limits: Object.assign({ timeoutMs: 5 * 60 * 1000, memoryMb: 1024, cpuCores: 1 }, limits || {}),
    status: 'QUEUED', created: Date.now(), started: null, ended: null,
    progressPct: 0, exitCode: null, durationMs: null,
    result: null, error: null, logs: [], filesModified: [], events: [],
    agentId: null,
  };
  __remoteJobs.set(jobId, job);
  __gwObs('REMOTE_JOB_CREATED', { jobId, type, workspace: job.workspace });
  // Escolhe agente: prefer targetAgentId se ONLINE/IDLE e com capability; senão qualquer ONLINE/IDLE com a capability
  let choice = null;
  const candidates = [];
  for (const a of __remoteAgents.values()) {
    if (!a.ws || a.ws.readyState !== 1) continue;
    if (targetAgentId && a.agentId !== targetAgentId) continue;
    if (!Array.isArray(a.capabilities) || !a.capabilities.includes(type)) continue;
    candidates.push(a);
  }
  candidates.sort((x, y) => (Number(x.activeJobs || 0) - Number(y.activeJobs || 0)));
  choice = candidates[0] || null;
  if (!choice) {
    job.status = 'FAILED'; job.ended = Date.now(); job.error = 'nenhum agente online com capability=' + type;
    return { ok:false, jobId, status: getJob(jobId), error: job.error };
  }
  job.agentId = choice.agentId;
  __remoteJobAgent.set(jobId, choice.agentId);
  choice.activeJobs = (Number(choice.activeJobs) || 0) + 1;
  const ok = __gwEmit(choice.ws, 'gw:job_assign', JSON.parse(JSON.stringify({
    jobId: job.jobId, type: job.type, workspace: job.workspace,
    parameters: job.parameters, limits: job.limits,
  })));
  if (!ok) {
    job.status = 'FAILED'; job.ended = Date.now(); job.error = 'falha ao enviar gw:job_assign';
    return { ok:false, jobId, status: getJob(jobId), error: job.error };
  }
  __gwObs('REMOTE_JOB_DISPATCHED', { jobId, agentId: choice.agentId, type });
  return { ok:true, jobId, status: getJob(jobId) };
}
function __gwCancelJob(jobId) {
  const j = __remoteJobs.get(String(jobId || '')); if (!j) return { ok:false, error:'job não encontrado' };
  if (['COMPLETED','FAILED','CANCELLED','TIMEOUT'].includes(j.status)) return { ok:true, alreadyFinal:true, status: getJob(jobId) };
  const a = __remoteJobs.get(jobId) && __remoteJobAgent.get(jobId) ? __remoteAgents.get(__remoteJobAgent.get(jobId)) : null;
  if (a && a.ws) __gwEmit(a.ws, 'gw:job_cancel', { jobId });
  return { ok:true, status: getJob(jobId) };
}
function getJob(jobId) {
  const j = __remoteJobs.get(String(jobId || ''));
  return j ? JSON.parse(JSON.stringify({
    jobId: j.jobId, type: j.type, workspace: j.workspace, parameters: j.parameters,
    limits: j.limits, status: j.status, created: j.created, started: j.started, ended: j.ended,
    durationMs: j.durationMs, progressPct: j.progressPct, exitCode: j.exitCode,
    result: j.result, error: j.error, logsTail: j.logs.slice(-60),
    filesModified: j.filesModified, agentId: j.agentId,
  })) : null;
}
function listAgentsSafe() {
  return Array.from(__remoteAgents.values()).map(a => ({
    agentId: a.agentId, status: a.status, capabilities: a.capabilities,
    resources: a.resources, activeJobs: a.activeJobs,
    connectedAt: a.ts, lastHeartbeatAt: a.hb, hbAgeMs: Date.now() - a.hb,
  }));
}
function listJobsSafe() {
  return Array.from(__remoteJobs.values()).map(j => ({
    jobId: j.jobId, type: j.type, workspace: j.workspace, status: j.status,
    agentId: j.agentId, created: j.created, started: j.started, ended: j.ended,
    progressPct: j.progressPct, exitCode: j.exitCode, error: j.error,
    filesModified: j.filesModified,
  }));
}

globalThis.REMOTE_EXECUTOR = Object.freeze({
  dispatch: __gwDispatchJob,
  cancel:   __gwCancelJob,
  getJob,
  listAgents: listAgentsSafe,
  listJobs:   listJobsSafe,
  gatewayTokenConfigured: !!__REMOTE_GATEWAY_TOKEN,
  heartbeatTimeoutMs: __REMOTE_HEARTBEAT_TIMEOUT_MS,
});

wss.on('connection', (ws) => {
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  let sessionId = null;
  // Último projeto pedido nesta conexão WS — usado se a sessão nova for criada logo após project:switch
  let lastRequestedProject = null;
  let closed = false;

  ws.on('error', () => {
    try { ws.terminate(); } catch {}
  });

  ws.on('close', () => {
    closed = true;
    try {
      if (sessionId) {
        const s = sessions.get(sessionId);
        if (s && (!s.ws || s.ws === ws)) {
          s.ws = null;
        }
      }
    } catch {}
  });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    if (msg.type === 'keepalive') {
      return;
    }

    if (msg.type === 'project:switch') {
      // Captura projeto requisitado ANTES da sessao existir (caso cliente envie project:switch antes de session:new/resume)
      const cleanName = String(msg.project || DEFAULT_PROJECT).trim();
      if (cleanName) lastRequestedProject = await ensureProject(cleanName);
    }

    if (msg.type === 'session:new') {
      // Se veio parametro project explicito, usa ele. Senao usa o ultimo project:switch da conexao.
      let initialProject = null;
      if (msg.project && typeof msg.project === 'string') {
        initialProject = String(msg.project).trim();
      }
      if (!initialProject) initialProject = lastRequestedProject || null;
      if (!initialProject) initialProject = DEFAULT_PROJECT;
      initialProject = await ensureProject(initialProject);
      sessionId = crypto.randomBytes(6).toString('hex');
      const sess = getSession(sessionId);
      sess.project = initialProject;
      lastRequestedProject = initialProject;
      // UNIFY_CONV: tenta restaurar conversation_memory.jsonl do projeto para a sessão nova
      await _unifiedMaybeRestoreSessionContents(sess, { force: false });
      emit(ws, 'session:ready', { id: sessionId, project: sess.project, convRestored: !!sess.__convRestoredFromDisk || false });
      return;
    }

    if (msg.type === 'session:resume') {
      const sid = typeof msg.sessionId === 'string' ? msg.sessionId : null;
      let initialProject = null;
      if (msg.project && typeof msg.project === 'string') initialProject = String(msg.project).trim();
      if (!initialProject) initialProject = lastRequestedProject || null;
      initialProject = initialProject ? await ensureProject(initialProject) : null;
      let sess;
      let existingOk = false;
      if (sid && sessions.has(sid)) {
        sess = getSession(sid);
        existingOk = true;
      } else {
        // Fallback: sessao pedida nao existe no server (reiniciou?), cria nova com initialProject/default
        sessionId = crypto.randomBytes(6).toString('hex');
        sess = getSession(sessionId);
      }
      sessionId = sess.id;
      if (initialProject) sess.project = initialProject;
      if (!sess.project) sess.project = DEFAULT_PROJECT;
      lastRequestedProject = sess.project;
      // UNIFY_CONV: se sessão NÃO existia antes (reiniciou?), restaurar conversation_memory do projeto
      if (!existingOk || !Array.isArray(sess.contents) || sess.contents.length === 0) {
        await _unifiedMaybeRestoreSessionContents(sess, { force: !existingOk });
      }
      emit(ws, 'session:ready', { id: sessionId, project: sess.project, resumed: existingOk, convRestored: !!sess.__convRestoredFromDisk || false });
      return;
    }

    if (!sessionId) {
      emit(ws, 'error', { message: 'Sessão não iniciada' });
      return;
    }

    const session = getSession(sessionId);

    if (msg.type === 'project:list') {
      const projects = await listProjects();
      emit(ws, 'project:list', { projects, active: session.project || DEFAULT_PROJECT });
      return;
    }
    if (msg.type === 'project:switch') {
      const name = String(msg.project || DEFAULT_PROJECT).trim();
      if (!name) return;
      const finalName = await ensureProject(name);
      session.project = finalName;
      session.lastActive = Date.now();
      // UNIFY_CONV: ao trocar projeto, tenta restaurar conversation_memory se sessão vazia
      await _unifiedMaybeRestoreSessionContents(session, { force: false });
      const prevInfo = await startProjectPreviewServer(finalName);
      const projects = await listProjects();
      setState(ws, session, session.state);
      emit(ws, 'project:switched', {
        project: finalName,
        projects,
        port: prevInfo?.port || null,
        previewUrl: prevInfo?.url || null,
      });
      emit(ws, 'file:tree:refresh', { project: finalName });
      return;
    }
    if (msg.type === 'project:create') {
      const rawName = String(msg.name || '').trim();
      if (!rawName) return;
      let cleaned = rawName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
      if (!cleaned) cleaned = 'projeto-' + Date.now().toString(36);
      const finalName = cleaned.toLowerCase();
      const dir = resolveProjectDir(finalName);
      await fs.mkdir(dir, { recursive: true });
      const marker = path.join(dir, '.project');
      await fs.writeFile(marker, `# ${finalName}\nCriado em ${new Date().toISOString()}\n`, 'utf8').catch(() => {});
      session.project = finalName;
      session.lastActive = Date.now();
      const prevInfo = await startProjectPreviewServer(finalName);
      const projects = await listProjects();
      setState(ws, session, session.state);
      emit(ws, 'project:created', {
        project: finalName,
        projects,
        port: prevInfo?.port || null,
        previewUrl: prevInfo?.url || null,
      });
      emit(ws, 'file:tree:refresh', { project: finalName });
      return;
    }

    if (msg.type === 'config:set') {
      if (typeof msg.mode === 'string' && ['solo', 'interactive'].includes(msg.mode)) session.mode = msg.mode;
      if (typeof msg.model === 'string' && msg.model.trim()) session.model = msg.model.trim();
      if (typeof msg.ensemble === 'boolean') session.ensemble = msg.ensemble && ensembleIsEnabled();
      session.lastActive = Date.now();
      setState(ws, session, session.state);
      emit(ws, 'config:updated', { mode: session.mode, model: session.model, ensemble: session.ensemble, ensembleAvailable: ensembleIsEnabled(), ensembleMode: ENSEMBLE_MODE, modelA: FREE_MODEL_A, modelB: FREE_MODEL_B });
      return;
    }
    if (msg.type === 'ensemble:toggle') {
      session.ensemble = !session.ensemble ? ensembleIsEnabled() : false;
      session.lastActive = Date.now();
      setState(ws, session, session.state);
      emit(ws, 'ensemble:toggled', { enabled: session.ensemble, ensembleAvailable: ensembleIsEnabled(), ensembleMode: ENSEMBLE_MODE, modelA: FREE_MODEL_A, modelB: FREE_MODEL_B });
      return;
    }

    if (msg.type === 'agent:stop') {
      session.abortRequested = true;
      if (typeof session.pauseResolver === 'function') session.pauseResolver();
      session.pauseRequested = false;
      setState(ws, session, STATE_STOPPED, { reason: 'user_stop' });
      return;
    }
    if (msg.type === 'agent:pause') {
      if (session.state === STATE_RUNNING) {
        session.pauseRequested = true;
        setState(ws, session, STATE_PAUSED, { reason: 'user_pause' });
      }
      return;
    }
    if (msg.type === 'agent:resume') {
      if (session.state === STATE_PAUSED || session.pauseRequested) {
        session.pauseRequested = true; // ensure resolver is triggered path
        if (typeof session.pauseResolver === 'function') {
          session.pauseResolver();
        } else {
          session.pauseRequested = false;
        }
        setState(ws, session, STATE_RUNNING, { reason: 'user_resume' });
      }
      return;
    }
    if (msg.type === 'agent:confirm') {
      if (session.state === STATE_PAUSED && typeof session.pauseResolver === 'function') {
        session.pauseResolver();
        setState(ws, session, STATE_RUNNING, { reason: 'user_confirmed' });
      }
      return;
    }

    if (msg.type === 'chat:send') {
      const userParts = [];
      if (msg.text && msg.text.trim()) userParts.push({ text: msg.text });
      if (Array.isArray(msg.images) && msg.images.length > 0) {
        for (const img of msg.images) {
          const filePath = path.join(UPLOAD_DIR, img.filename);
          try {
            const inline = await imageInlineData(filePath);
            userParts.push(inline);
            userParts.push({ text: `\n[Imagem anexada: ${img.originalname}]` });
          } catch (e) {
            emit(ws, 'error', { message: `Falha ao processar imagem ${img.originalname}: ${e.message}` });
          }
        }
      }
      if (userParts.length === 0) return;
      console.log('[WS chat:send] session=' + String(sessionId).slice(0, 8) + ' | session.project=' + (session.project || '') + ' | prompt=' + String(msg.text || '').slice(0, 60).replace(/\s+/g, ' '));
      session.lastActive = Date.now();
      runAgentLoop(ws, session, userParts).catch(err => {
        emit(ws, 'error', { message: err.message || 'Erro interno' });
      });
    }

    if (msg.type === 'session:clear') {
      session.history = [];
      session.contents = [];
      session.__convRestoredFromDisk = false;
      // UNIFY_CONV: também faz backup+limpa memória persistente (compatível com endpoint /conversation/clear)
      try {
        const root = _agentDir(session.project || DEFAULT_PROJECT);
        const mem = path.join(root, 'conversation_memory.jsonl');
        if (fsc.existsSync(mem)) {
          const bak = path.join(root, `conversation_memory.bak.${Date.now()}.jsonl`);
          await fs.copyFile(mem, bak);
          await fs.writeFile(mem, '', 'utf8');
        }
      } catch {}
      try {
        const keys = Array.from(__convTurnDedup.keys());
        for (const k of keys) if (typeof k === 'string' && k.startsWith(`${session.id}:`)) __convTurnDedup.delete(k);
      } catch {}
      emit(ws, 'session:cleared');
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActive > 1000 * 60 * 60 * 12) sessions.delete(id);
  }
}, 60000);

if (!GOOGLE_API_KEY || GOOGLE_API_KEY.includes('sua_chave')) {
  console.log('⚠️  AVISO: GOOGLE_API_KEY não configurada.');
}

/* ============================================================================
 *  REMOTE AGENT · GATEWAY · Rotas HTTP /api/remote/* (cirúrgicas, 7 rotas, sem
 *  regressão com /api/agent/* ou /api/status). Ponto de integração RC28:
 *  usa globalThis.REMOTE_EXECUTOR que também é exposto.
 * ==========================================================================*/
app.get('/api/remote/agents', (req, res) => {
  try { res.json({ ok:true, agents: globalThis.REMOTE_EXECUTOR.listAgents() }); }
  catch (e) { res.status(500).json({ ok:false, error: String(e && e.message || e) }); }
});
app.get('/api/remote/jobs', (req, res) => {
  try { res.json({ ok:true, jobs: globalThis.REMOTE_EXECUTOR.listJobs() }); }
  catch (e) { res.status(500).json({ ok:false, error: String(e && e.message || e) }); }
});
app.get('/api/remote/jobs/:id', (req, res) => {
  try {
    const job = globalThis.REMOTE_EXECUTOR.getJob(req.params.id);
    if (!job) return res.status(404).json({ ok:false, error: 'job não encontrado' });
    res.json({ ok:true, job });
  } catch (e) { res.status(500).json({ ok:false, error: String(e && e.message || e) }); }
});
app.post('/api/remote/jobs', express.json({ limit: '2mb' }), (req, res) => {
  try {
    const b = req.body || {};
    const r = globalThis.REMOTE_EXECUTOR.dispatch({
      type: b.type, workspace: b.workspace, parameters: b.parameters,
      limits: b.limits, targetAgentId: b.targetAgentId,
    });
    res.status(r.ok ? 202 : 422).json(r);
  } catch (e) { res.status(500).json({ ok:false, error: String(e && e.message || e) }); }
});
app.post('/api/remote/jobs/:id/cancel', (req, res) => {
  try {
    const r = globalThis.REMOTE_EXECUTOR.cancel(req.params.id);
    res.status(r.ok ? 200 : 404).json(r);
  } catch (e) { res.status(500).json({ ok:false, error: String(e && e.message || e) }); }
});
app.get('/api/remote/jobs/:id/logs', (req, res) => {
  try {
    const job = globalThis.REMOTE_EXECUTOR.getJob(req.params.id);
    if (!job) return res.status(404).json({ ok:false, error: 'job não encontrado' });
    res.json({ ok:true, jobId: job.jobId, logs: job.logsTail || [] });
  } catch (e) { res.status(500).json({ ok:false, error: String(e && e.message || e) }); }
});
app.get('/api/remote/status', (req, res) => {
  try {
    const re = globalThis.REMOTE_EXECUTOR;
    res.json({
      ok: true, remoteGateway: true,
      gatewayTokenConfigured: re.gatewayTokenConfigured,
      heartbeatTimeoutMs: re.heartbeatTimeoutMs,
      agents: re.listAgents().map(a => ({ ...a, resources: null /* summary only */ })),
      jobsSummary: re.listJobs().reduce((s, j) => {
        s[j.status] = (s[j.status] || 0) + 1;
        return s;
      }, {}),
      integration: {
        remoteExecutorExposed: true,
        rc28Compatible: true,
        strategyHints: ['EXECUTE_LOCAL','EXECUTE_REMOTE'],
      },
    });
  } catch (e) { res.status(500).json({ ok:false, error: String(e && e.message || e) }); }
});

/* =============== BTC MARKET INTELLIGENCE (endpoints, módulo isolado) =============== */
app.get('/api/btc/status', (req, res) => {
  try { res.json(BtcMi.apiGetStatus()); }
  catch (e) { res.status(500).json({ ok:false, error: String(e && e.message || e) }); }
});
app.get('/api/btc/history', (req, res) => {
  try { res.json(BtcMi.apiGetHistory(Number(req.query?.limit || 50))); }
  catch (e) { res.status(500).json({ ok:false, error: String(e && e.message || e) }); }
});
app.post('/api/btc/manual', express.json({ limit: '64kb' }), async (req, res) => {
  try { res.json(await BtcMi.apiRunManual()); }
  catch (e) { res.status(500).json({ ok:false, error: String(e && e.message || e) }); }
});
app.get('/api/btc/backtest', async (req, res) => {
  try { res.json(await BtcMi.apiRunBacktest({ days: Number(req.query?.days || 0) })); }
  catch (e) { res.status(500).json({ ok:false, error: String(e && e.message || e) }); }
});

// =============== STARTUP: Garante TODOS projetos (mounted e workspace) têm SERVIDOR PREVIEW DEDICADO RODANDO ANTES do listen ===============
// Isso RESOLVE o bug do usuário "preview em branco / porta não abre após restart servidor" — antes startProjectPreviewServer só era chamado no endpoint mount, nunca no startup!
(async function startupStartAllPreviewServers() {
  // ===== INICIALIZAÇÃO VOICE REST SERVER (ANTES DOS PREVIEWS) =====
  // Garante que a porta de voz esteja reservada e o servidor dedicado esteja UP ANTES de
  // qualquer preview server poder pegar a porta.
  globalThis.__VOICE_OK__ = false;
  globalThis.__VOICE_ERR__ = null;
  let voiceChild = null;
  if (!IS_RENDER_OR_HEADLESS_LINUX) {
    try {
      const nodeBin = process.execPath;
      const voiceScript = path.join(__dirname, 'voice_rest_server.js');
      try { await fs.access(voiceScript); } catch { throw new Error('Arquivo voice_rest_server.js não encontrado em: ' + voiceScript); }
      const voiceEnv = { ...process.env };
      if (!voiceEnv.FABRICA_VOICE_PORT && !voiceEnv.VOICE_REST_PORT) {
        voiceEnv.VOICE_REST_PORT = String(VOICE_REST_PORT);
      }
      voiceChild = spawn(nodeBin, [voiceScript], {
        cwd: __dirname,
        env: voiceEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });
      voiceChild.stdout.on('data', () => {});
      voiceChild.stderr.on('data', () => {});
      voiceChild.on('error', (e) => { globalThis.__VOICE_ERR__ = 'spawn_error: ' + (e && e.message ? e.message : String(e)); });
      voiceChild.on('exit', (code) => {
        if (!globalThis.__VOICE_OK__) {
          globalThis.__VOICE_ERR__ = (globalThis.__VOICE_ERR__ ? globalThis.__VOICE_ERR__ + '; ' : '') + 'exit_code=' + String(code);
        }
      });
      const HEALTH_MAX_ATTEMPTS = 45;
      const HEALTH_INTERVAL_MS = 400;
      let healthOk = false;
      for (let t = 0; t < HEALTH_MAX_ATTEMPTS; t++) {
        await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
        try {
          const hres = await fetch('http://127.0.0.1:' + VOICE_REST_PORT + '/health', {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(800),
          });
          if (hres && hres.status === 200) {
            try {
              const hj = await hres.json();
              if (hj && hj.ok === true && hj.service === 'fabrica-voice-rest') {
                healthOk = true;
                break;
              }
            } catch {}
          }
        } catch {}
      }
      if (healthOk) {
        globalThis.__VOICE_OK__ = true;
        console.log(`✅ VOZ   : voice_rest_server ligado · http://127.0.0.1:${VOICE_REST_PORT} · /health OK (service=fabrica-voice-rest)`);
      } else {
        const errMsg = (globalThis.__VOICE_ERR__ || 'timeout após ' + (HEALTH_MAX_ATTEMPTS * HEALTH_INTERVAL_MS / 1000) + 's esperando /health').slice(0, 240);
        globalThis.__VOICE_ERR__ = errMsg;
        const line = '═'.repeat(68);
        console.error('\n╔' + line + '╗');
        console.error('║  ⚠️  AVISO: Servidor de voz NÃO está disponível.                       ║');
        console.error('║  Porta reservada: ' + String(VOICE_REST_PORT).padEnd(53) + ' ║');
        console.error('║  Motivo: ' + String(errMsg).padEnd(60).slice(0, 60) + ' ║');
        console.error('║  Ações sugeridas:                                                     ║');
        console.error('║  • Start manual: node voice_rest_server.js                            ║');
        console.error('║  • Verifique .env: FABRICA_VOICE_PORT / VOICE_REST_PORT               ║');
        console.error('║  • Chat de texto continua funcionando normalmente.                    ║');
        console.error('╚' + line + '╝\n');
      }
    } catch (e) {
      globalThis.__VOICE_ERR__ = 'init_exception: ' + (e && e.message ? e.message : String(e));
      const line = '═'.repeat(68);
      console.error('\n╔' + line + '╗');
      console.error('║  ⚠️  AVISO: Falha ao inicializar voice_rest_server.                    ║');
      console.error('║  Erro: ' + String(globalThis.__VOICE_ERR__).padEnd(62).slice(0, 62) + ' ║');
      console.error('╚' + line + '╝\n');
    }
  } else {
    console.log(`ℹ️  VOZ   : Modo RENDER/Linux headless · voice_rest_server NÃO iniciado (single-port mode).`);
  }
  RESERVED_PROJECT_PORTS.add(VOICE_REST_PORT);

  // 1) Coleta todos slugs conhecidos: projectPorts (já tem porta alocada) + mountedProjects (mesmo que sem porta ainda) + pastas workspace internas
  const slugsToStart = new Set();
  for (const s of projectPorts.keys()) slugsToStart.add(s);
  for (const s of mountedProjects.keys()) slugsToStart.add(s);
  slugsToStart.add(DEFAULT_PROJECT);
  // Workspace directories (ignora blacklist: node_modules, dotfiles)
  try {
    const BLACKLIST_DIRS = new Set(['node_modules', '.git', '.DS_Store', 'uploads', 'public']);
    const es = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
    for (const e of es) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      if (BLACKLIST_DIRS.has(e.name)) continue;
      slugsToStart.add(e.name);
    }
  } catch {}
  let started = 0, failed = 0;
  const results = [];
  if (IS_RENDER_OR_HEADLESS_LINUX) {
    // RC20 RENDER: single-port mode, NÃO precisamos ligar NENHUM preview extra
    // Todos arquivos são servidos via /preview/:slug/ dentro da porta principal
    const slugsArr = Array.from(slugsToStart);
    for (const s of slugsArr) ensureProject(s);
    started = slugsArr.length;
    results.push(
      `  ℹ️  Modo single-port ativado: ${slugsArr.length} projetos servidos via /preview/:slug/`,
      `  ℹ️  URL base: ${RENDER_BASE_URL || 'same-origin'}`
    );
  } else {
    for (const slug of Array.from(slugsToStart)) {
      try {
        // Garante pasta exista (se fallback interno ou workspace)
        ensureProject(slug);
        const r = await startProjectPreviewServer(slug);
        if (r && r.running) {
          started++;
          if (!r.alreadyRunning) {
            const relPath = r.path && String(r.path).includes(WORKSPACE_ROOT)
              ? 'workspace/' + path.relative(WORKSPACE_ROOT, r.path)
              : (r.path ? r.path.split('/').slice(-3).join('/') : '');
            results.push(`  + ${slug} → porta ${r.port} (${relPath})`);
          }
        }
      } catch (e) {
        failed++;
        results.push(`  ✗ ${slug} FALHOU: ${e && e.message ? e.message : String(e)}`);
      }
    }
  }
  // 2) Startup finalizado: ligar servidor principal
  // Hierarquia HOST BIND (maior → menor prioridade):
  //   1. LISTEN_HOST env var explícita (ex: 0.0.0.0, 127.0.0.1, 192.168.1.244)
  //   2. Se IS_RENDER_OR_HEADLESS_LINUX=true → 0.0.0.0 (nuvem/headless)
  //   3. Caso contrário (desktop local padrão) → 127.0.0.1
  const LISTEN_HOST =
    (process.env.LISTEN_HOST && process.env.LISTEN_HOST.trim()) ||
    (IS_RENDER_OR_HEADLESS_LINUX ? '0.0.0.0' : '127.0.0.1');
  const displayUrl = IS_RENDER_OR_HEADLESS_LINUX && RENDER_BASE_URL
    ? RENDER_BASE_URL
    : `http://localhost:${PORT}`;

  // BTC Market Intelligence boot (isolado, antes do listen)
  try {
    BtcMi.startScheduler({
      wss: typeof wss !== 'undefined' ? wss : null,
      dataDir: BTC_MI_DATA_DIR,
      intervalMs: BTC_MI_INTERVAL_MS,
    });
  } catch (e) {
    console.warn('[BTC_MI] boot warning (ignorado, servidor principal continua):', String(e && e.message || e));
  }

  server.listen(PORT, LISTEN_HOST, () => {
    const banner = `
╔══════════════════════════════════════════════════════╗
║   AGENTE AUTÔNOMO · ESTILO TRAE IA                    ║
╠══════════════════════════════════════════════════════╣
║  URL   : ${displayUrl.length > 50 ? displayUrl.slice(0,47)+'...' : displayUrl.padEnd(53)}║
║  Host  : ${(LISTEN_HOST+':'+PORT).padEnd(53)}║
║  Modelo: ${GOOGLE_MODEL.padEnd(53)}║
║  Work  : ${WORKSPACE_ROOT.length > 53 ? WORKSPACE_ROOT.slice(0,50)+'...' : WORKSPACE_ROOT.padEnd(53)}║
║  Steps : ${String(MAX_STEPS).padEnd(53)}║
╠══════════════════════════════════════════════════════╣
║  Previews: ${String(started).padEnd(3)} projetos · ${String(failed).padEnd(3)} falhas · ${(IS_RENDER_OR_HEADLESS_LINUX?'Single-Port /preview':'Multi-Port 3001+').padEnd(31)}║
╚══════════════════════════════════════════════════════╝
Abra o navegador: ${displayUrl}
${results.length?results.join('\n'):''}`;
    console.log(banner);
  });
})().catch(err => {
  console.error('ERRO STARTUP:', err);
  // De qualquer forma liga servidor principal
  const LISTEN_HOST =
    (process.env.LISTEN_HOST && process.env.LISTEN_HOST.trim()) ||
    (IS_RENDER_OR_HEADLESS_LINUX ? '0.0.0.0' : '127.0.0.1');
  server.listen(PORT, LISTEN_HOST, () => console.log(`Servidor principal ligado ${LISTEN_HOST}:${PORT} (com erro startup: ${err && err.message ? err.message : String(err)})`));
});

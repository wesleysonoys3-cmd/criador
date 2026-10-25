// ============================================================
//  whatsapp_client_unified.js — ROUTER AUTOMÁTICO DUAL PROVIDER
//  Assinatura IDÊNTICA aos clientes Evolux + WATI para drop-in.
//  100% ADITIVO: não altera evolux_whatsapp_api.js nem wati.
//  Prioridade de roteamento:
//    1. WATI       → se WATI_API_TOKEN tem valor real (não vazio/placeholder)
//    2. Evolux     → senão, se EVOLUX_API_KEY ou WHATSAPP_EVOLUX_API_KEY
//    3. Erro ENV_MISSING → senão nenhum configurado
// ============================================================
import * as Evolux from './evolux_whatsapp_api.js';
import * as Wati from './wati_whatsapp_api.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// ---- Carrega .env AUTOMATICAMENTE se existir (0 deps, sem package.json alterar) ----
(function _carregarDotEnvLocal() {
  try {
    const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.env');
    if (fs.existsSync(envPath)) {
      const linhas = String(fs.readFileSync(envPath, 'utf8') || '').split(/\r?\n/);
      for (const linha of linhas) {
        if (!linha || /^\s*#/.test(linha)) continue;
        const idx = linha.indexOf('=');
        if (idx <= 0) continue;
        const k = linha.slice(0, idx).trim();
        let v = linha.slice(idx + 1);
        const cm = v.indexOf('  #');
        if (cm > 0) v = v.slice(0, cm);
        v = v.trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!(k in process.env)) process.env[k] = v;
      }
    }
  } catch (_) {}
})();

const EVOLUX_DEFAULTS_VAZIOS = new Set([
  '', 'sua_chave_aqui', 'sua_instancia_aqui', 'seu_token_webhook',
  'coloque_sua_chave_aqui', 'undefined', 'null', 'placeholder'
]);
const WATI_DEFAULTS_VAZIOS = new Set(['', 'coloque_aqui', 'undefined', 'null', 'placeholder']);

function _cfgWati() {
  const env = typeof process !== 'undefined' && process.env ? process.env : {};
  const t = String(env.WATI_API_TOKEN || env.WATI_BEARER_TOKEN || env.WATI_API_KEY || '').trim();
  return {
    tem: !WATI_DEFAULTS_VAZIOS.has(t) && t.length >= 8,
    token: t,
    instanceName: String(env.WATI_INSTANCE_NAME || '').trim()
  };
}

function _cfgEvolux() {
  const env = typeof process !== 'undefined' && process.env ? process.env : {};
  const k = String(env.EVOLUX_API_KEY || env.WHATSAPP_EVOLUX_API_KEY || '').trim();
  const inst = String(env.EVOLUX_INSTANCE_ID || env.WHATSAPP_EVOLUX_INSTANCE_ID || '').trim();
  const kValido = !EVOLUX_DEFAULTS_VAZIOS.has(k) && k.length >= 8;
  const instValido = !EVOLUX_DEFAULTS_VAZIOS.has(inst);
  return { tem: kValido && instValido, key: k, instanceId: inst };
}

export function detectProvider() {
  const w = _cfgWati();
  const e = _cfgEvolux();
  if (w.tem) { return { provider: 'wati', ok: true, reason: 'WATI_API_TOKEN configurado', instanceName: w.instanceName || null }; }
  if (e.tem) { return { provider: 'evolux', ok: true, reason: 'EVOLUX_API_KEY+INSTANCE_ID configurados' }; }
  return { provider: null, ok: false, reason: 'Nenhuma credencial WhatsApp (WATI nem Evolux) encontrada no .env.' };
}

function _errNenhumConfigurado(codeExtra = 'ENV_MISSING') {
  const e = 'Nenhum provedor WhatsApp configurado. Defina WATI_API_TOKEN (wati.pro) ou EVOLUX_API_KEY+EVOLUX_INSTANCE_ID (Evolux) no arquivo .env.';
  if (typeof console !== 'undefined' && console.error) {
    const ts = new Date().toISOString();
    console.error(`[WA_UNIFIED][${ts}][router] ${e}`);
  }
  return { ok: false, error: e, code: codeExtra, provider: null, raw: null };
}

// ---------- 4 métodos públicos ASSINATURA IDÊNTICA ----------

export async function sendTextMessage(to, text, options) {
  const d = detectProvider();
  if (!d.ok) return _errNenhumConfigurado();
  if (d.provider === 'wati') return Wati.sendTextMessage(to, text, options);
  return Evolux.sendTextMessage(to, text, options);
}

export async function sendAudioMessage(to, audioUrlBuffer, options) {
  const d = detectProvider();
  if (!d.ok) return _errNenhumConfigurado();
  if (d.provider === 'wati') return Wati.sendAudioMessage(to, audioUrlBuffer, options);
  return Evolux.sendAudioMessage(to, audioUrlBuffer, options);
}

export async function sendInteractiveButtons(to, title, buttons, options) {
  const d = detectProvider();
  if (!d.ok) return _errNenhumConfigurado();
  if (d.provider === 'wati') return Wati.sendInteractiveButtons(to, title, buttons, options);
  return Evolux.sendInteractiveButtons(to, title, buttons, options);
}

export function parseIncomingWebhook(reqBody) {
  const d = detectProvider();
  const w = _cfgWati();
  const e = _cfgEvolux();
  if (!d.ok && !w.tem && !e.tem) return _errNenhumConfigurado('ENV_MISSING_PARSE');
  if (w.tem && !e.tem) {
    try { return Wati.parseIncomingWebhook(reqBody); } catch (_) {}
  }
  if (e.tem && !w.tem) {
    try { return Evolux.parseIncomingWebhook(reqBody); } catch (_) {}
  }
  try {
    const rW = Wati.parseIncomingWebhook(reqBody);
    if (rW && rW.ok && rW.normalized && (rW.normalized.telefone || (rW.normalized.status && rW.normalized.ehStatus))) {
      return rW;
    }
  } catch (_) {}
  try {
    const rE = Evolux.parseIncomingWebhook(reqBody);
    if (rE && rE.ok) return rE;
  } catch (_) {}
  return {
    ok: false,
    error: 'Não foi possível parsear webhook em nenhum dos dois provedores.',
    code: 'PARSE_FALHA_AMBOS',
    provider: null,
    normalized: null,
    raw: reqBody
  };
}

export function getConfig() {
  const d = detectProvider();
  if (!d.ok) {
    return {
      ok: false,
      provider: null,
      error: 'Nenhum provedor WhatsApp configurado.',
      code: 'ENV_MISSING',
      wati: Wati.getConfig(),
      evolux: Evolux.getConfig()
    };
  }
  const sub = d.provider === 'wati' ? Wati.getConfig() : Evolux.getConfig();
  return {
    ok: true,
    provider: d.provider,
    reason: d.reason,
    instanceName: d.instanceName || null,
    router: d,
    ...sub,
    watiStatus: Wati.getConfig(),
    evoluxStatus: Evolux.getConfig()
  };
}

export default {
  sendTextMessage,
  sendAudioMessage,
  sendInteractiveButtons,
  parseIncomingWebhook,
  getConfig,
  detectProvider,
  _internals: { _cfgWati, _cfgEvolux, _errNenhumConfigurado },
  providers: { evolux: Evolux.default || Evolux, wati: Wati.default || Wati }
};

// evolux_whatsapp_api.js — Cliente Oficial Evolux
// Auto-carrega .env local (0 deps, NÃO usa dotenv)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
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

const EVOLUX_DEFAULT_API_URL = 'https://api.evolux.com.br/v1';

function _conf() {
  const env = typeof process !== 'undefined' && process.env ? process.env : {};
  const apiUrl = env.EVOLUX_API_URL || env.WHATSAPP_EVOLUX_API_URL || EVOLUX_DEFAULT_API_URL;
  const apiKey = env.EVOLUX_API_KEY || env.WHATSAPP_EVOLUX_API_KEY || '';
  const instanceId = env.EVOLUX_INSTANCE_ID || env.WHATSAPP_EVOLUX_INSTANCE_ID || '';
  const webhookSecret = env.EVOLUX_WEBHOOK_SECRET || env.WHATSAPP_EVOLUX_WEBHOOK_SECRET || '';
  return {
    apiUrl: String(apiUrl || EVOLUX_DEFAULT_API_URL).replace(/\/+$/, ''),
    apiKey: String(apiKey || ''),
    instanceId: String(instanceId || ''),
    webhookSecret: String(webhookSecret || ''),
  };
}

function _limparNumero(num) {
  const s = String(num || '').replace(/\D/g, '');
  if (!s) return '';
  if (s.length >= 12 && s.startsWith('55')) return s;
  if (s.length >= 10 && s.length <= 11) return '55' + s;
  return s;
}

function _logErro(fn, msg, extra) {
  const ts = new Date().toISOString();
  const ex = extra !== undefined ? (typeof extra === 'object' ? ' :: ' + JSON.stringify(extra).slice(0, 400) : ' :: ' + String(extra)) : '';
  if (typeof console !== 'undefined' && console.error) {
    console.error(`[EVOLUX_API][${ts}][${fn}] ${String(msg || 'erro')}${ex}`);
  }
}

function _logInfo(fn, msg, extra) {
  const ts = new Date().toISOString();
  const ex = extra !== undefined ? (typeof extra === 'object' ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ' :: ' + String(extra)) : '';
  if (typeof console !== 'undefined' && console.log) {
    console.log(`[EVOLUX_API][${ts}][${fn}] ${String(msg || '')}${ex}`);
  }
}

async function _chamarApi({ metodo = 'POST', caminho, bodyObj, instanceIdOverride = null, timeoutMs = 30000 }) {
  const cfg = _conf();
  const instanceId = String(instanceIdOverride || cfg.instanceId || '').trim();
  if (!cfg.apiKey) {
    const e = 'EVOLUX_API_KEY/WHATSAPP_EVOLUX_API_KEY não encontrada no ambiente.';
    _logErro('_chamarApi', e, { caminho });
    return { ok: false, error: e, code: 'ENV_API_KEY_MISSING', raw: null };
  }
  if (!instanceId) {
    const e = 'EVOLUX_INSTANCE_ID/WHATSAPP_EVOLUX_INSTANCE_ID não encontrada (não foi passado instanceId nem configurada no ambiente).';
    _logErro('_chamarApi', e, { caminho });
    return { ok: false, error: e, code: 'ENV_INSTANCE_MISSING', raw: null };
  }
  const url = `${cfg.apiUrl}${String(caminho || '').startsWith('/') ? '' : '/'}${caminho || ''}`;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const tm = ctrl ? setTimeout(() => ctrl.abort(), Number(timeoutMs) || 30000) : null;
  try {
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': cfg.apiKey,
      'X-Instance-Id': instanceId,
      'User-Agent': 'TiAgente-Evolux/1.0',
    };
    const opts = {
      method: String(metodo || 'POST').toUpperCase(),
      headers,
    };
    if (bodyObj !== undefined && bodyObj !== null) {
      opts.body = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
    }
    if (ctrl) opts.signal = ctrl.signal;

    const resp = await fetch(url, opts);
    const txt = await resp.text();
    let json;
    try { json = txt ? JSON.parse(txt) : null; } catch (e) { json = { __raw: String(txt || '').slice(0, 500) }; }

    if (!resp.ok) {
      const motivo = String(
        (json && (json.message || json.error || json.error_description || json.status || json.__raw)) ||
        txt ||
        ('HTTP ' + resp.status)
      ).slice(0, 250);
      _logErro('_chamarApi', `HTTP ${resp.status} em ${url}`, { motivo, body: bodyObj ? (typeof bodyObj === 'object' ? JSON.stringify(bodyObj).slice(0,200) : String(bodyObj).slice(0,200)) : null });
      return {
        ok: false,
        error: `Evolux retornou HTTP ${resp.status}: ${motivo}`,
        code: 'EVOLUX_HTTP_' + resp.status,
        httpStatus: resp.status,
        raw: json,
      };
    }

    return {
      ok: true,
      httpStatus: resp.status,
      id: (json && (json.id || json.messageId || json.message_id || json.data?.id || json.data?.messageId)) || null,
      data: json,
      raw: json,
    };
  } catch (e) {
    const abortado = !!(e && (e.name === 'AbortError' || /abort/i.test(String(e.message || e))));
    const msg = abortado
      ? `Timeout de ${(timeoutMs/1000)|0}s ao chamar ${url}`
      : `Falha de rede/chamada fetch em ${url}: ${String(e.message || e).slice(0,200)}`;
    _logErro('_chamarApi', msg, { erro: e && e.stack ? String(e.stack).slice(0,300) : String(e) });
    return {
      ok: false,
      error: msg,
      code: abortado ? 'TIMEOUT' : 'NETWORK_ERROR',
      raw: null,
    };
  } finally {
    if (tm) clearTimeout(tm);
  }
}

export async function sendTextMessage(to, text, instanceId) {
  const fn = 'sendTextMessage';
  const num = _limparNumero(to);
  const txt = String(text == null ? '' : text);
  if (!num) {
    const e = 'Destinatário "to" vazio ou inválido (deve ter DD + número).';
    _logErro(fn, e, { to });
    return { ok: false, error: e, code: 'INVALID_TO' };
  }
  if (!txt || !txt.trim()) {
    const e = 'Mensagem de texto vazia.';
    _logErro(fn, e);
    return { ok: false, error: e, code: 'EMPTY_TEXT' };
  }
  const cfg = _conf();
  const inst = String(instanceId || cfg.instanceId || '').trim();
  if (!inst) {
    const e = 'instanceId não informado e EVOLUX_INSTANCE_ID não configurada.';
    _logErro(fn, e);
    return { ok: false, error: e, code: 'ENV_INSTANCE_MISSING' };
  }
  const caminho = `/instances/${encodeURIComponent(inst)}/messages/send`;
  _logInfo(fn, `Enviando texto para ${num} (instância ${inst})`, { chars: txt.length });
  const r = await _chamarApi({
    caminho,
    bodyObj: {
      number: num,
      type: 'text',
      text: txt,
    },
    instanceIdOverride: inst,
  });
  if (r.ok) {
    _logInfo(fn, `Texto enviado OK ${num}`, { id: r.id });
  }
  return r;
}

export async function sendAudioMessage(to, audioUrlBuffer, instanceId) {
  const fn = 'sendAudioMessage';
  const num = _limparNumero(to);
  if (!num) {
    const e = 'Destinatário "to" vazio ou inválido (deve ter DD + número).';
    _logErro(fn, e, { to });
    return { ok: false, error: e, code: 'INVALID_TO' };
  }
  const cfg = _conf();
  const inst = String(instanceId || cfg.instanceId || '').trim();
  if (!inst) {
    const e = 'instanceId não informado e EVOLUX_INSTANCE_ID não configurada.';
    _logErro(fn, e);
    return { ok: false, error: e, code: 'ENV_INSTANCE_MISSING' };
  }
  const caminho = `/instances/${encodeURIComponent(inst)}/messages/send`;
  const arg = audioUrlBuffer;
  const tipoArg = typeof arg === 'string' ? 'url' : (arg && (arg instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(arg)))) ? 'buffer' : (arg && typeof arg === 'object' && (arg.url || arg.mimeType || arg.base64)) ? 'obj' : 'unknown';

  let body;
  if (tipoArg === 'url') {
    const u = String(arg || '').trim();
    if (!u) {
      const e = 'URL do áudio vazia.';
      _logErro(fn, e);
      return { ok: false, error: e, code: 'EMPTY_AUDIO_URL' };
    }
    _logInfo(fn, `Enviando áudio (URL) para ${num}`, { url: u.slice(0,80) });
    body = { number: num, type: 'audio', media_url: u };
  } else if (tipoArg === 'buffer') {
    let b64 = '';
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(arg)) {
      b64 = arg.toString('base64');
    } else if (arg instanceof Uint8Array) {
      if (typeof Buffer !== 'undefined') {
        b64 = Buffer.from(arg.buffer, arg.byteOffset, arg.byteLength).toString('base64');
      } else if (typeof btoa !== 'undefined') {
        let bin = '';
        for (let i = 0; i < arg.byteLength; i++) bin += String.fromCharCode(arg[i]);
        b64 = btoa(bin);
      }
    }
    if (!b64) {
      const e = 'Não foi possível codificar o Buffer do áudio em base64.';
      _logErro(fn, e);
      return { ok: false, error: e, code: 'BUFFER_ENCODE_FAIL' };
    }
    _logInfo(fn, `Enviando áudio (Buffer base64) para ${num}`, { bytes: b64.length });
    body = { number: num, type: 'audio', media_base64: b64, mime_type: 'audio/mp3' };
  } else if (tipoArg === 'obj') {
    const url = String(arg.url || '').trim();
    const b64 = String(arg.base64 || '').trim();
    const mime = String(arg.mimeType || arg.mime_type || 'audio/mpeg').trim();
    if (!url && !b64) {
      const e = 'Objeto audio deve ter "url" ou "base64".';
      _logErro(fn, e, { chaves: Object.keys(arg) });
      return { ok: false, error: e, code: 'AUDIO_OBJ_INVALIDO' };
    }
    _logInfo(fn, `Enviando áudio (obj) para ${num}`, { temUrl: !!url, temB64: !!b64, mime });
    body = url
      ? { number: num, type: 'audio', media_url: url, mime_type: mime }
      : { number: num, type: 'audio', media_base64: b64, mime_type: mime };
  } else {
    const e = 'Argumento audioUrlBuffer deve ser URL string, Buffer/Uint8Array ou objeto {url?} {base64?,mimeType?}.';
    _logErro(fn, e, { tipoArg, tipo: typeof arg, instanciaof: arg && arg.constructor ? arg.constructor.name : null });
    return { ok: false, error: e, code: 'AUDIO_ARG_INVALIDO' };
  }

  const r = await _chamarApi({ caminho, bodyObj: body, instanceIdOverride: inst });
  if (r.ok) {
    _logInfo(fn, `Áudio enviado OK ${num}`, { id: r.id });
  }
  return r;
}

export async function sendInteractiveButtons(to, title, buttons, instanceId) {
  const fn = 'sendInteractiveButtons';
  const num = _limparNumero(to);
  if (!num) {
    const e = 'Destinatário "to" vazio ou inválido.';
    _logErro(fn, e, { to });
    return { ok: false, error: e, code: 'INVALID_TO' };
  }
  if (!Array.isArray(buttons) || buttons.length === 0) {
    const e = 'É obrigatório passar um array "buttons" com pelo menos 1 botão.';
    _logErro(fn, e, { tipo: typeof buttons, tam: Array.isArray(buttons) ? buttons.length : null });
    return { ok: false, error: e, code: 'BUTTONS_VAZIO' };
  }
  if (buttons.length > 3) {
    _logInfo(fn, `Aviso: ${buttons.length} botões enviados — API Evolux costuma limitar a 3 botões interativos por mensagem; mantendo todos mas cliente pode truncar.`, { qtd: buttons.length });
  }
  const cfg = _conf();
  const inst = String(instanceId || cfg.instanceId || '').trim();
  if (!inst) {
    const e = 'instanceId não informado e EVOLUX_INSTANCE_ID não configurada.';
    _logErro(fn, e);
    return { ok: false, error: e, code: 'ENV_INSTANCE_MISSING' };
  }

  const botoesNormalizados = buttons.map((b, i) => {
    if (typeof b === 'string') {
      return { id: `btn_${i}_${Date.now()}`, title: String(b).slice(0, 20) };
    }
    if (b && typeof b === 'object') {
      const id = String(b.id || b.value || b._id || `btn_${i}_${Date.now()}`).slice(0, 128);
      const ttl = String(b.title || b.label || b.text || b.caption || 'Opção').slice(0, 20);
      return { id, title: ttl };
    }
    return { id: `btn_${i}_${Date.now()}`, title: String(b || '').slice(0, 20) || 'Opção' };
  });

  const titleStr = String(title || '').trim() || 'Escolha uma opção';
  const caminho = `/instances/${encodeURIComponent(inst)}/messages/send`;
  _logInfo(fn, `Enviando ${botoesNormalizados.length} botões para ${num}`, { title: titleStr.slice(0,60), botoes: botoesNormalizados.map(b => b.title) });

  let body;
  try {
    body = {
      number: num,
      type: 'interactive',
      interactive: {
        type: 'button',
        header: { type: 'text', text: titleStr.length <= 60 ? titleStr : titleStr.slice(0, 57) + '...' },
        body: { text: titleStr },
        action: {
          buttons: botoesNormalizados.map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    };
  } catch (e) {
    _logErro(fn, 'Erro ao montar payload interactive', e);
    return { ok: false, error: 'Erro interno montar botões: ' + String(e.message || e).slice(0, 150), code: 'INTERNAL_PAYLOAD' };
  }

  let r = await _chamarApi({ caminho, bodyObj: body, instanceIdOverride: inst });
  if (!r.ok && (r.code === 'EVOLUX_HTTP_400' || r.code === 'EVOLUX_HTTP_422')) {
    _logInfo(fn, 'Interactive falhou, fazendo fallback para texto com botões em linha (compatibilidade max providers).', { motivo: r.error });
    const linhas = botoesNormalizados.map((b, i) => `${i+1}. ${b.title}  (responder ${String(i+1)})`).join('\n');
    const fallbackTxt = `${titleStr}\n\n${linhas}\n\nResponda com o NÚMERO da opção.`;
    r = await sendTextMessage(num, fallbackTxt, inst);
    r.__fallback = 'interactive_para_texto_botoes';
    return r;
  }
  if (r.ok) {
    _logInfo(fn, `Botões interativos OK ${num}`, { id: r.id });
  }
  return r;
}

export function parseIncomingWebhook(reqBody) {
  const fn = 'parseIncomingWebhook';
  if (reqBody == null) {
    return {
      ok: false,
      error: 'reqBody vazio/null/undefined.',
      code: 'EMPTY_PAYLOAD',
      normalized: null,
      raw: reqBody,
    };
  }
  let p = reqBody;
  if (typeof reqBody === 'string') {
    try { p = JSON.parse(reqBody); } catch (e) {
      return { ok: false, error: 'reqBody string não é JSON válido: ' + String(e.message || e).slice(0,200), code: 'INVALID_JSON', normalized: null, raw: reqBody };
    }
  }

  const r = {
    ok: true,
    provider: 'evolux',
    normalized: null,
    raw: p,
  };

  function pegar(...paths) {
    for (const path of paths) {
      const parts = String(path || '').split('.').filter(Boolean);
      let cur = p;
      let ok = true;
      for (const part of parts) {
        if (cur == null || typeof cur !== 'object') { ok = false; break; }
        cur = cur[part];
      }
      if (ok && cur != null && cur !== '') return cur;
    }
    return undefined;
  }

  const who = pegar('from','who','remoteJid','remote_jid','data.from','data.who','payload.from','payload.who','contact','number');
  const telefone = _limparNumero(who || '');
  const nome = String(pegar('pushName','push_name','senderName','sender_name','profileName','contactName','data.senderName') || '').trim() || null;
  const instance = String(pegar('instanceId','instance_id','instance','data.instanceId') || '').trim() || null;
  const msgId = String(pegar('id','messageId','message_id','msgId','key.id','data.id') || '').trim() || null;
  const ts = pegar('timestamp','ts','date','createdAt','data.timestamp');
  const timestamp = ts == null ? null : (typeof ts === 'number' ? ts : (Date.parse(String(ts)) || null));

  const text = String(
    pegar(
      'text.message','text.body','text','message.text','message.body','body','content.text','content.body','data.text',
      'message.conversation','conversation','messages[0].text.body','message.text.message','message.text.body',
      'payload.text','payload.body'
    ) || ''
  ).trim();

  const caption = String(pegar(
    'caption','media.caption','message.image.caption','message.audio.caption','message.document.caption',
    'message.video.caption','image.caption','document.caption'
  ) || '').trim();

  const audioUrl = String(pegar(
    'audio.url','media.url','audioUrl','mediaUrl','message.audio.url','message.voice.url','voice.url',
    'data.media.url','payload.audio.url','data.audio.url','messages[0].audio.url'
  ) || '').trim() || null;
  const audioMime = String(pegar(
    'audio.mimeType','mime_type','media.mimeType','audioMime','message.audio.mime_type','message.voice.mime_type',
    'audio.mime_type','voice.mime_type'
  ) || '').trim() || null;
  const audioBase64 = String(pegar(
    'audio.base64','media.base64','audioBase64','mediaBase64','message.audio.base64','data.audio.base64'
  ) || '').trim() || null;
  const temAudio = !!(audioUrl || audioBase64);

  const imageUrl = String(pegar(
    'image.url','media.url','imageUrl','message.image.url','data.image.url','payload.image.url'
  ) || '').trim() || null;
  const documentUrl = String(pegar(
    'document.url','media.url','documentUrl','message.document.url','data.document.url','payload.document.url'
  ) || '').trim() || null;
  const videoUrl = String(pegar(
    'video.url','media.url','videoUrl','message.video.url','data.video.url'
  ) || '').trim() || null;

  const _temButtonId = !!String(pegar(
    'message.interactive.buttonReply.id','interactive.buttonReply.id','buttonReply.id','button_response.id',
    'reply.id','data.reply.id','payload.reply.id','message.buttonReply.id','message.button_response.id'
  ) || '').trim();
  const _temButtonTitle = !!String(pegar(
    'message.interactive.buttonReply.title','interactive.buttonReply.title','buttonReply.title','button_response.title',
    'reply.title','data.reply.title','payload.reply.title','message.buttonReply.title'
  ) || '').trim();

  let tipoMensagem = 'unknown';
  if (pegar('type')) tipoMensagem = String(pegar('type')).toLowerCase();
  else if (temAudio) tipoMensagem = 'audio';
  else if (imageUrl) tipoMensagem = 'image';
  else if (documentUrl) tipoMensagem = 'document';
  else if (videoUrl) tipoMensagem = 'video';
  else if (_temButtonId || _temButtonTitle) tipoMensagem = 'button';
  else if (text) tipoMensagem = 'text';

  const buttonReply = (() => {
    const id = String(pegar(
      'message.interactive.buttonReply.id','interactive.buttonReply.id','buttonReply.id','button_response.id',
      'reply.id','data.reply.id','payload.reply.id','message.buttonReply.id','message.button_response.id'
    ) || '').trim();
    const title = String(pegar(
      'message.interactive.buttonReply.title','interactive.buttonReply.title','buttonReply.title','button_response.title',
      'reply.title','data.reply.title','payload.reply.title','message.buttonReply.title'
    ) || '').trim();
    if (!id && !title) return null;
    return { id: id || null, title: title || null };
  })();

  const statusEvento = (() => {
    const ev = String(pegar('event','status','messageStatus','message.status','data.event') || '').trim();
    if (!ev) return null;
    return {
      event: ev.toLowerCase(),
      messageId: String(pegar('messageId','message_id','data.messageId') || msgId || '').trim() || null,
      ack: pegar('ack') == null ? null : Number(pegar('ack')) || null,
    };
  })();

  r.normalized = {
    telefone,
    telefoneBruto: who ? String(who) : null,
    nome,
    instanceId: instance,
    messageId: msgId,
    timestamp,
    tipo: tipoMensagem,
    texto: text || caption || '',
    audio: temAudio ? { url: audioUrl, base64: audioBase64 || null, mimeType: audioMime || null } : null,
    imagem: imageUrl ? { url: imageUrl, caption: caption || null } : null,
    documento: documentUrl ? { url: documentUrl, caption: caption || null } : null,
    video: videoUrl ? { url: videoUrl, caption: caption || null } : null,
    buttonReply,
    status: statusEvento,
    ehStatus: !!(statusEvento && !text && !temAudio && !imageUrl && !documentUrl && !videoUrl && !buttonReply),
    rawResumo: {
      tem: [
        text ? 'texto' : null,
        temAudio ? 'audio' : null,
        imageUrl ? 'imagem' : null,
        documentUrl ? 'documento' : null,
        videoUrl ? 'video' : null,
        buttonReply ? 'botao' : null,
        statusEvento ? 'status' : null,
      ].filter(Boolean),
    },
  };

  if (!telefone && !statusEvento) {
    r.ok = false;
    r.error = 'Não foi possível extrair telefone nem evento de status do webhook.';
    r.code = 'PHONE_OR_STATUS_MISSING';
    _logErro(fn, r.error, { keys: Object.keys(p || {}).slice(0, 20) });
  } else {
    _logInfo(fn, `Webhook parseado ${r.normalized.tipo}${telefone ? ' → ' + telefone : ''}${statusEvento ? ' status=' + statusEvento.event : ''}`, { msgId });
  }

  return r;
}

export function getConfig() {
  const c = _conf();
  return {
    ok: true,
    apiUrl: c.apiUrl,
    temApiKey: !!c.apiKey,
    temInstanceId: !!c.instanceId,
    temWebhookSecret: !!c.webhookSecret,
    apiKeyMask: c.apiKey ? (String(c.apiKey).slice(0,4) + '…' + String(c.apiKey).slice(-4)) : null,
    instanceIdMask: c.instanceId ? (String(c.instanceId).slice(0,4) + '…' + String(c.instanceId).slice(-4)) : null,
    defaults: { defaultApiUrl: EVOLUX_DEFAULT_API_URL },
  };
}

export default {
  sendTextMessage,
  sendAudioMessage,
  sendInteractiveButtons,
  parseIncomingWebhook,
  getConfig,
  _internals: { _limparNumero, _conf, _chamarApi },
};

// wati_whatsapp_api.js — Cliente Oficial WATI.io
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

const WATI_DEFAULT_API_URL = 'https://wati.pro';

function _conf() {
  const env = typeof process !== 'undefined' && process.env ? process.env : {};
  const apiUrl = env.WATI_API_URL || env.WATI_ENDPOINT || WATI_DEFAULT_API_URL;
  const apiToken = env.WATI_API_TOKEN || env.WATI_BEARER_TOKEN || env.WATI_API_KEY || '';
  const deviceId = env.WATI_DEVICE_ID || '';
  const webhookSecret = env.WATI_WEBHOOK_SECRET || env.WATI_SIGNING_SECRET || '';
  const instanceName = env.WATI_INSTANCE_NAME || env.WATI_WHATSAPP_NUMBER || '';
  return {
    apiUrl: String(apiUrl || WATI_DEFAULT_API_URL).replace(/\/+$/, ''),
    apiToken: String(apiToken || ''),
    deviceId: String(deviceId || ''),
    webhookSecret: String(webhookSecret || ''),
    instanceName: String(instanceName || ''),
  };
}

function _limparNumero(num) {
  const s = String(num || '').replace(/\D/g, '');
  if (!s) return '';
  if (s.length >= 12 && s.startsWith('55')) return s;
  if (s.length >= 10 && s.length <= 11) return '55' + s;
  return s;
}

function _formatarE164(numLimpo) {
  const s = String(numLimpo || '').replace(/\D/g, '');
  if (!s) return '';
  return '+' + s;
}

function _logErro(fn, msg, extra) {
  const ts = new Date().toISOString();
  const ex = extra !== undefined
    ? (typeof extra === 'object'
      ? ' :: ' + JSON.stringify(
        Object.fromEntries(
          Object.entries(extra).map(([k, v]) => [
            k,
            /(token|secret|key|password|auth)/i.test(String(k)) && typeof v === 'string'
              ? (v.length > 8 ? v.slice(0, 3) + '…' + v.slice(-3) : '***')
              : v
          ])
        )
      ).slice(0, 400)
      : ' :: ' + String(extra))
    : '';
  if (typeof console !== 'undefined' && console.error) {
    console.error(`[WATI_API][${ts}][${fn}] ${String(msg || 'erro')}${ex}`);
  }
}

function _logInfo(fn, msg, extra) {
  const ts = new Date().toISOString();
  const ex = extra !== undefined ? (typeof extra === 'object' ? ' :: ' + JSON.stringify(extra).slice(0,300) : ' :: ' + String(extra)) : '';
  if (typeof console !== 'undefined' && console.log) {
    console.log(`[WATI_API][${ts}][${fn}] ${String(msg || '')}${ex}`);
  }
}

function _mascaraToken(t) {
  const s = String(t || '');
  if (!s) return null;
  if (s.length <= 8) return '***';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

async function _chamarApi({ metodo = 'POST', caminho, bodyObj, timeoutMs = 30000 }) {
  const cfg = _conf();
  const token = cfg.apiToken;
  if (!token) {
    const e = 'WATI_API_TOKEN/WATI_BEARER_TOKEN/WATI_API_KEY não encontrada no ambiente.';
    _logErro('_chamarApi', e, { caminho });
    return { ok: false, error: e, code: 'ENV_TOKEN_MISSING', raw: null, provider: 'wati' };
  }
  const url = `${cfg.apiUrl}${String(caminho || '').startsWith('/') ? '' : '/'}${caminho || ''}`;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const tm = ctrl ? setTimeout(() => ctrl.abort(), Number(timeoutMs) || 30000) : null;
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      'User-Agent': 'TiAgente-WATI/1.0',
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
      _logErro('_chamarApi', `HTTP ${resp.status} em ${url}`, {
        motivo,
        bodyLen: bodyObj ? (typeof bodyObj === 'string' ? bodyObj.length : JSON.stringify(bodyObj).length) : 0
      });
      return {
        ok: false,
        error: `WATI retornou HTTP ${resp.status}: ${motivo}`,
        code: 'WATI_HTTP_' + resp.status,
        httpStatus: resp.status,
        raw: json,
        provider: 'wati',
      };
    }

    return {
      ok: true,
      httpStatus: resp.status,
      id: (json && (json.id || json.messageId || json.message_id || json.data?.id || json.data?.messageId)) || null,
      data: json,
      raw: json,
      provider: 'wati',
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
      provider: 'wati',
    };
  } finally {
    if (tm) clearTimeout(tm);
  }
}

export async function sendTextMessage(to, text, optionsOrDeviceId) {
  const fn = 'sendTextMessage';
  const num = _limparNumero(to);
  const txt = String(text == null ? '' : text);
  if (!num) {
    const e = 'Destinatário "to" vazio ou inválido (precisa ter DD + número).';
    _logErro(fn, e, { to });
    return { ok: false, error: e, code: 'INVALID_TO', provider: 'wati' };
  }
  if (!txt || !txt.trim()) {
    const e = 'Mensagem de texto vazia.';
    _logErro(fn, e);
    return { ok: false, error: e, code: 'EMPTY_TEXT', provider: 'wati' };
  }
  const cfg = _conf();
  const deviceId = (() => {
    if (typeof optionsOrDeviceId === 'string') return optionsOrDeviceId;
    if (optionsOrDeviceId && typeof optionsOrDeviceId === 'object') return String(optionsOrDeviceId.deviceId || optionsOrDeviceId.instanceId || '');
    return '';
  })() || cfg.deviceId || undefined;
  const e164 = _formatarE164(num);
  _logInfo(fn, `Enviando texto para ${e164}`, { chars: txt.length, deviceId: deviceId ? 'definido' : 'default' });

  const body = { to: e164, message: txt };
  if (deviceId) body.deviceId = deviceId;

  const r = await _chamarApi({ caminho: '/api/public/v1/send', bodyObj: body });
  if (r.ok) {
    _logInfo(fn, `Texto enviado OK ${e164}`, { id: r.id });
  }
  return r;
}

export async function sendAudioMessage(to, audioUrlBuffer, optionsOrDeviceId) {
  const fn = 'sendAudioMessage';
  const num = _limparNumero(to);
  if (!num) {
    const e = 'Destinatário "to" vazio ou inválido.';
    _logErro(fn, e, { to });
    return { ok: false, error: e, code: 'INVALID_TO', provider: 'wati' };
  }
  const cfg = _conf();
  const deviceId = (() => {
    if (typeof optionsOrDeviceId === 'string') return optionsOrDeviceId;
    if (optionsOrDeviceId && typeof optionsOrDeviceId === 'object') return String(optionsOrDeviceId.deviceId || optionsOrDeviceId.instanceId || '');
    return '';
  })() || cfg.deviceId || undefined;
  const e164 = _formatarE164(num);
  const arg = audioUrlBuffer;
  const tipoArg = typeof arg === 'string' ? 'url'
    : (arg && (arg instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(arg)))) ? 'buffer'
    : (arg && typeof arg === 'object' && (arg.url || arg.mimeType || arg.base64)) ? 'obj'
    : 'unknown';

  let corpo;
  if (tipoArg === 'url') {
    const u = String(arg || '').trim();
    if (!u) {
      const e = 'URL do áudio vazia.';
      _logErro(fn, e);
      return { ok: false, error: e, code: 'EMPTY_AUDIO_URL', provider: 'wati' };
    }
    corpo = { to: e164, type: 'audio', url: u };
    if (deviceId) corpo.deviceId = deviceId;
    _logInfo(fn, `Enviando áudio (URL) para ${e164}`, { url: u.slice(0,80), deviceId: deviceId ? 'sim' : 'default' });
  } else if (tipoArg === 'obj' && arg.url) {
    const u = String(arg.url || '').trim();
    const caption = String(arg.caption || '').trim() || undefined;
    const mime = String(arg.mimeType || arg.mime_type || 'audio/mpeg').trim();
    corpo = { to: e164, type: 'audio', url: u, caption, mimetype: mime };
    if (deviceId) corpo.deviceId = deviceId;
    _logInfo(fn, `Enviando áudio (obj url) para ${e164}`, { temCaption: !!caption, mime, deviceId: deviceId ? 'sim' : 'default' });
  } else if (tipoArg === 'buffer' || (tipoArg === 'obj' && !!(arg && arg.base64))) {
    let b64 = '';
    let mime = 'audio/mpeg';
    if (tipoArg === 'buffer') {
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
    } else {
      b64 = String(arg.base64 || '').trim();
      if (arg.mimeType || arg.mime_type) mime = String(arg.mimeType || arg.mime_type).trim();
    }
    if (!b64) {
      const e = 'Não foi possível codificar o Buffer/base64 do áudio.';
      _logErro(fn, e);
      return { ok: false, error: e, code: 'BUFFER_ENCODE_FAIL', provider: 'wati' };
    }
    if (!b64.startsWith('data:')) {
      b64 = `data:${mime};base64,${b64}`;
    }
    corpo = { to: e164, type: 'audio', url: b64, mimetype: mime };
    if (deviceId) corpo.deviceId = deviceId;
    _logInfo(fn, `Enviando áudio (Buffer/base64 inline) para ${e164}`, { bytes: b64.length, mime, deviceId: deviceId ? 'sim' : 'default' });
  } else {
    const e = 'Argumento audioUrlBuffer deve ser URL string, Buffer/Uint8Array ou objeto {url?, base64?, mimeType?}.';
    _logErro(fn, e, { tipoArg, tipo: typeof arg, construtor: arg && arg.constructor ? arg.constructor.name : null });
    return { ok: false, error: e, code: 'AUDIO_ARG_INVALIDO', provider: 'wati' };
  }

  const r = await _chamarApi({ caminho: '/api/public/v1/send-media', bodyObj: corpo });
  if (r.ok) {
    _logInfo(fn, `Áudio enviado OK ${e164}`, { id: r.id });
  }
  return r;
}

export async function sendInteractiveButtons(to, title, buttons, optionsOrDeviceId) {
  const fn = 'sendInteractiveButtons';
  const num = _limparNumero(to);
  if (!num) {
    const e = 'Destinatário "to" vazio ou inválido.';
    _logErro(fn, e, { to });
    return { ok: false, error: e, code: 'INVALID_TO', provider: 'wati' };
  }
  if (!Array.isArray(buttons) || buttons.length === 0) {
    const e = 'É obrigatório passar um array "buttons" com pelo menos 1 botão.';
    _logErro(fn, e, { tipo: typeof buttons, tam: Array.isArray(buttons) ? buttons.length : null });
    return { ok: false, error: e, code: 'BUTTONS_VAZIO', provider: 'wati' };
  }
  if (buttons.length > 3) {
    _logInfo(fn, `Aviso: ${buttons.length} botões enviados — WhatsApp Interactive Messages costumam limitar a 3 botões; mantendo mas cliente pode truncar.`, { qtd: buttons.length });
  }
  const cfg = _conf();
  const deviceId = (() => {
    if (typeof optionsOrDeviceId === 'string') return optionsOrDeviceId;
    if (optionsOrDeviceId && typeof optionsOrDeviceId === 'object') return String(optionsOrDeviceId.deviceId || optionsOrDeviceId.instanceId || '');
    return '';
  })() || cfg.deviceId || undefined;
  const e164 = _formatarE164(num);

  const botoesNormalizados = buttons.map((b, i) => {
    if (typeof b === 'string') {
      return { id: `btn_${i}_${Date.now()}`, title: String(b).slice(0, 20) };
    }
    if (b && typeof b === 'object') {
      const id = String(b.id || b.value || b._id || `btn_${i}_${Date.now()}`).slice(0, 256);
      const ttl = String(b.title || b.label || b.text || b.caption || 'Opção').slice(0, 20);
      return { id, title: ttl };
    }
    return { id: `btn_${i}_${Date.now()}`, title: String(b || '').slice(0,20) || 'Opção' };
  });

  const titleStr = String(title || '').trim() || 'Escolha uma opção';
  _logInfo(fn, `Enviando ${botoesNormalizados.length} botões para ${e164}`, { title: titleStr.slice(0,60), botoes: botoesNormalizados.map(b => b.title), deviceId: deviceId ? 'sim' : 'default' });

  const corpo = {
    to: e164,
    message: titleStr,
    customParams: {
      whatsapp_interactive: {
        type: 'button',
        body: { text: titleStr },
        action: {
          buttons: botoesNormalizados.map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    },
  };
  if (deviceId) corpo.deviceId = deviceId;

  let r = await _chamarApi({ caminho: '/api/public/v1/send', bodyObj: corpo });
  if (!r.ok && (r.code === 'WATI_HTTP_400' || r.code === 'WATI_HTTP_422')) {
    _logInfo(fn, 'Interactive falhou, fazendo fallback para texto com botões em linha (compatibilidade máxima).', { motivo: r.error });
    const linhas = botoesNormalizados.map((b, i) => `${i+1}. ${b.title}  (responder ${String(i+1)})`).join('\n');
    const fallbackTxt = `${titleStr}\n\n${linhas}\n\nResponda com o NÚMERO da opção.`;
    r = await sendTextMessage(e164, fallbackTxt, deviceId);
    r.__fallback = 'interactive_para_texto_botoes';
    return r;
  }
  if (r.ok) {
    _logInfo(fn, `Botões interativos OK ${e164}`, { id: r.id });
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
      provider: 'wati',
    };
  }
  let p = reqBody;
  if (typeof reqBody === 'string') {
    try { p = JSON.parse(reqBody); } catch (e) {
      return { ok: false, error: 'reqBody string não é JSON válido: ' + String(e.message || e).slice(0,200), code: 'INVALID_JSON', normalized: null, raw: reqBody, provider: 'wati' };
    }
  }

  const r = { ok: true, provider: 'wati', normalized: null, raw: p };

  function pegar(...paths) {
    for (const path of paths) {
      const parts = String(path || '').split('.').filter(Boolean);
      let cur = p;
      let ok = true;
      for (const part of parts) {
        if (cur == null || typeof cur !== 'object') { ok = false; break; }
        if (/^\d+$/.test(part) && Array.isArray(cur)) {
          cur = cur[Number(part)];
        } else {
          cur = cur[part];
        }
      }
      if (ok && cur != null && cur !== '') return cur;
    }
    return undefined;
  }

  const who = pegar(
    'from','who','remoteJid','remote_jid','waId','wa_id','phone','number','contact.wa_id','contact.number',
    'payload.from','data.from','message.from','sender.from','sender.id'
  );
  const telefone = _limparNumero(who || '');
  const nome = String(pegar(
    'pushName','push_name','senderName','sender_name','profileName','contactName','contact.profile.name',
    'contact.pushName','payload.senderName','data.contactName'
  ) || '').trim() || null;
  const deviceId = String(pegar('deviceId','device_id','instanceId','instance_id') || '').trim() || null;
  const msgId = String(pegar(
    'id','messageId','message_id','msgId','key.id','waId','message.key.id',
    'data.id','payload.id'
  ) || '').trim() || null;
  const ts = pegar('timestamp','ts','date','createdAt','receivedAt','received_at','data.timestamp');
  const timestamp = ts == null ? null : (typeof ts === 'number' ? ts : (Date.parse(String(ts)) || null));

  const text = String(pegar(
    'text','message','body','text.text','message.text','message.body','content.text','content.body',
    'data.text','payload.text','payload.message','conversation','message.conversation',
    'whatsapp.text.body','whatsapp.message.text'
  ) || '').trim();

  const caption = String(pegar(
    'caption','media.caption','message.image.caption','message.audio.caption','message.document.caption','message.video.caption'
  ) || '').trim();

  const audioUrl = String(pegar(
    'audio.url','media.url','audioUrl','mediaUrl','message.audio.url','message.voice.url',
    'voice.url','data.media.url','payload.audio.url','whatsapp.audio.url','media','mediaLink','media_link'
  ) || '').trim() || null;
  const audioMime = String(pegar('audio.mimeType','mime_type','media.mimeType','audioMime','message.audio.mime_type','audio.mime_type') || '').trim() || null;
  const audioBase64 = String(pegar('audio.base64','media.base64','audioBase64','mediaBase64') || '').trim() || null;
  const temAudio = !!(audioUrl || audioBase64);

  const imageUrl = String(pegar('image.url','media.url','imageUrl','message.image.url','data.image.url') || '').trim() || null;
  const documentUrl = String(pegar('document.url','media.url','documentUrl','message.document.url','data.document.url') || '').trim() || null;
  const videoUrl = String(pegar('video.url','media.url','videoUrl','message.video.url','data.video.url') || '').trim() || null;

  const _temButtonId = !!String(pegar(
    'message.interactive.buttonReply.id','interactive.buttonReply.id','buttonReply.id','button_response.id',
    'reply.id','data.reply.id','payload.reply.id','message.buttonReply.id','whatsapp.button.id'
  ) || '').trim();
  const _temButtonTitle = !!String(pegar(
    'message.interactive.buttonReply.title','interactive.buttonReply.title','buttonReply.title','button_response.title',
    'reply.title','data.reply.title','payload.reply.title','message.buttonReply.title','whatsapp.button.text'
  ) || '').trim();
  const _temListReply = !!String(pegar(
    'message.interactive.listReply.id','interactive.listReply.id','listReply.id','list_response.id'
  ) || '').trim();

  let tipoMensagem = 'unknown';
  const tipoRaw = pegar('type','messageType','message.type','event','whatsapp.type');
  if ((_temButtonId || _temButtonTitle || _temListReply) && (!tipoRaw || String(tipoRaw).toLowerCase() === 'interactive')) {
    tipoMensagem = 'button';
  } else if (tipoRaw) {
    tipoMensagem = String(tipoRaw || '').toLowerCase();
    if (tipoMensagem === 'interactive') tipoMensagem = 'button';
  } else if (temAudio) tipoMensagem = 'audio';
  else if (imageUrl) tipoMensagem = 'image';
  else if (documentUrl) tipoMensagem = 'document';
  else if (videoUrl) tipoMensagem = 'video';
  else if (text) tipoMensagem = 'text';

  const buttonReply = (() => {
    const id = String(pegar(
      'message.interactive.buttonReply.id','interactive.buttonReply.id','buttonReply.id','button_response.id',
      'reply.id','data.reply.id','payload.reply.id','message.buttonReply.id','whatsapp.button.id',
      'message.interactive.listReply.id','interactive.listReply.id','listReply.id','list_response.id'
    ) || '').trim();
    const title = String(pegar(
      'message.interactive.buttonReply.title','interactive.buttonReply.title','buttonReply.title','button_response.title',
      'reply.title','data.reply.title','payload.reply.title','message.buttonReply.title','whatsapp.button.text',
      'whatsapp.button.title','message.interactive.listReply.title','interactive.listReply.title','listReply.title'
    ) || '').trim();
    if (!id && !title) return null;
    return { id: id || null, title: title || null };
  })();

  const statusEvento = (() => {
    const ev = String(pegar('event','status','messageStatus','message.status','data.event','statusEvent') || '').trim();
    if (!ev) return null;
    return {
      event: ev.toLowerCase(),
      messageId: String(pegar('messageId','message_id','data.messageId','key.id') || msgId || '').trim() || null,
      ack: pegar('ack') == null ? null : Number(pegar('ack')) || null,
    };
  })();

  r.normalized = {
    telefone,
    telefoneE164: telefone ? _formatarE164(telefone) : null,
    telefoneBruto: who ? String(who) : null,
    nome,
    deviceId,
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
    r.error = 'Não foi possível extrair telefone nem evento de status do webhook WATI.';
    r.code = 'PHONE_OR_STATUS_MISSING';
    _logErro(fn, r.error, { keys: Object.keys(p || {}).slice(0,20) });
  } else {
    _logInfo(fn, `Webhook parseado ${r.normalized.tipo}${telefone ? ' → ' + telefone : ''}${statusEvento ? ' status=' + statusEvento.event : ''}`, { msgId });
  }

  return r;
}

export function getConfig() {
  const c = _conf();
  return {
    ok: true,
    provider: 'wati',
    apiUrl: c.apiUrl,
    temToken: !!c.apiToken,
    temDeviceId: !!c.deviceId,
    temWebhookSecret: !!c.webhookSecret,
    temInstanceName: !!c.instanceName,
    tokenMask: _mascaraToken(c.apiToken),
    deviceIdMask: c.deviceId ? _mascaraToken(c.deviceId) : null,
    instanceName: c.instanceName || null,
    defaults: { defaultApiUrl: WATI_DEFAULT_API_URL },
  };
}

export default {
  sendTextMessage,
  sendAudioMessage,
  sendInteractiveButtons,
  parseIncomingWebhook,
  getConfig,
  _internals: { _limparNumero, _formatarE164, _conf, _chamarApi, _mascaraToken },
};

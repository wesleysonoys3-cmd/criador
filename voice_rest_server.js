import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import {
  executarFluxoVozCompleto,
  executarFluxoTextoCompleto,
  extrairContextoDeTexto,
  sttTranscreverAudio,
  ttsGerarRespostaAudio,
} from './voice_processor.js';
import { pipelineCriarAuditarCorrigir, statusServices, criadorBaseUrl } from './integration_bridge.js';

const PORT = Number(process.env.FABRICA_VOICE_PORT || process.env.VOICE_REST_PORT || 3005);
const HOST = process.env.FABRICA_VOICE_HOST || '127.0.0.1';
const MAX_AUDIO_BYTES = Math.min(64 * 1024 * 1024, Number(process.env.FABRICA_VOICE_MAX_MB || 32) * 1024 * 1024);

const _TEMP = (() => {
  try { fs.mkdirSync(path.resolve(process.cwd(), 'audio_tmp'), { recursive: true }); } catch {}
  return path.resolve(process.cwd(), 'audio_tmp');
})();

function _sanitizeForJson(v) {
  if (typeof v === 'string') {
    return v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/\r\n/g, '\n');
  }
  if (Array.isArray(v)) return v.map(x => _sanitizeForJson(x));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = _sanitizeForJson(v[k]);
    return out;
  }
  return v;
}
function _jsonStringifySafe(v, space = 0) {
  try {
    const clean = _sanitizeForJson(v);
    return JSON.stringify(clean, null, space);
  } catch (e) {
    try { return JSON.stringify({ error: 'serialize', m: String(e.message || e).slice(0, 120) }); }
    catch { return '{"error":"serialize_fatal"}'; }
  }
}
function _sendJson(res, status, payload) {
  const body = _jsonStringifySafe(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, *',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function _parseContentTypeBoundary(ct) {
  if (!ct || typeof ct !== 'string') return null;
  const lower = ct.toLowerCase();
  if (!lower.includes('multipart/form-data')) return null;
  const m = /boundary=(-+[A-Za-z0-9'()+_,.-]+|[^";,\s]+)/i.exec(ct);
  if (!m) return null;
  const b = m[1].trim();
  return b.startsWith('"') && b.endsWith('"') ? b.slice(1, -1) : b;
}

function _parseMultipart(buffer, boundary) {
  const sep = Buffer.from('--' + boundary);
  const endSep = Buffer.from('--' + boundary + '--');
  const parts = [];
  let i = 0;
  while (i < buffer.length) {
    const p = buffer.indexOf(sep, i);
    if (p < 0) break;
    let pe = buffer.indexOf(sep, p + sep.length);
    let isEnd = false;
    if (pe < 0) {
      const endIdx = buffer.indexOf(endSep, p + sep.length);
      if (endIdx > 0) { pe = endIdx; isEnd = true; } else break;
    }
    const chunk = buffer.slice(p + sep.length, pe);
    i = pe + (isEnd ? endSep.length : sep.length);
    if (chunk.length < 4) continue;
    // \r\n\r\n separa headers de body
    const doubleCrlf = chunk.indexOf(Buffer.from('\r\n\r\n'));
    if (doubleCrlf < 0) continue;
    const headerBuf = chunk.slice(0, doubleCrlf).toString('utf-8');
    let body = chunk.slice(doubleCrlf + 4);
    // Remover trailing \r\n antes do prox sep
    if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) body = body.slice(0, -2);
    const dispositionMatch = /Content-Disposition:[ \t]*form-data;([^\r\n]*)/i.exec(headerBuf);
    const contentTypeMatch = /Content-Type:[ \t]*([^\r\n;]+)/i.exec(headerBuf);
    const nameMatch = /name="([^"]+)"/i.exec(dispositionMatch ? dispositionMatch[1] : '');
    const filenameMatch = /filename="([^"]+)"/i.exec(dispositionMatch ? dispositionMatch[1] : '');
    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: contentTypeMatch ? contentTypeMatch[1].trim() : null,
      body,
    });
    if (isEnd) break;
  }
  return parts;
}

function _readAllBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let finished = false;
    const t = setTimeout(() => { if (!finished) { finished = true; reject(new Error('TIMEOUT_BODY')); } }, 120000);
    req.on('data', (chunk) => {
      if (finished) return;
      size += chunk.length;
      if (size > maxBytes) { finished = true; reject(new Error('BODY_TOO_BIG_' + size)); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (finished) return;
      finished = true;
      clearTimeout(t);
      resolve(Buffer.concat(chunks, size));
    });
    req.on('error', (e) => { if (!finished) { finished = true; clearTimeout(t); reject(e); } });
  });
}

async function _handleVoiceProcess(req, res) {
  const ct = req.headers['content-type'] || '';
  const boundary = _parseContentTypeBoundary(ct);
  if (!boundary) return _sendJson(res, 400, { ok: false, error: 'Requisição inválida: esperava Content-Type multipart/form-data com áudio (MediaRecorder webm do voice_recorder.js).', code: 'BAD_CONTENT_TYPE' });

  let raw;
  try { raw = await _readAllBody(req, MAX_AUDIO_BYTES); }
  catch (e) { return _sendJson(res, 413, { ok: false, error: 'Body inválido ou excedeu tamanho máximo (' + Math.round(MAX_AUDIO_BYTES/1024/1024) + ' MB). Detalhe: ' + String(e.message || e).slice(0,100), code: 'BODY_ERR' }); }

  const partes = _parseMultipart(raw, boundary);
  const audioPart = partes.find(p => p && p.name === 'audio' && p.body && p.body.length > 0);
  if (!audioPart) return _sendJson(res, 400, { ok: false, error: 'Campo "audio" ausente ou vazio no FormData. Envie o arquivo de áudio gravado pelo MediaRecorder.', code: 'NO_AUDIO_FIELD' });

  const durationField = partes.find(p => p && p.name === 'durationMs');
  const mimeField = partes.find(p => p && p.name === 'mimeType');
  const returnOnlyField = partes.find(p => p && p.name === 'returnTranscriptOnly');

  const mime = (mimeField && mimeField.body ? mimeField.body.toString('utf-8').trim() : (audioPart.contentType || 'audio/webm')) || 'audio/webm';
  const durationMs = durationField && durationField.body ? Number(durationField.body.toString('utf-8')) || 0 : 0;
  const returnTranscriptOnly = returnOnlyField && returnOnlyField.body && /^(1|true|sim|yes|on)$/i.test(returnOnlyField.body.toString('utf-8').trim());

  try {
    const audioBuffer = Buffer.from(audioPart.body);
    if (returnTranscriptOnly) {
      const stt = await sttTranscreverAudio({ audioBuffer, audioMime: mime, provider: 'auto' });
      let txt = '';
      let ctx = null;
      if (stt.ok) {
        txt = String(stt.transcrição || stt.transcript || stt.texto || '').trim();
        if (txt) ctx = extrairContextoDeTexto(txt);
      }
      return _sendJson(res, 200, {
        ok: !!stt.ok,
        transcript: txt,
        transcricao: txt,
        contexto: ctx || null,
        durationMs,
        audioBytes: audioBuffer.length,
        mimeType: mime,
        stt,
      });
    }
    const r = await executarFluxoVozCompleto({ audioBuffer, audioMime: mime, userId: 'web_ui_mic' });
    return _sendJson(res, (r && r.ok) ? 200 : 500, Object.assign({ durationMs, audioBytes: audioBuffer.length, mimeType: mime }, r || { ok: false, error: 'fluxo voz sem resultado' }));
  } catch (e) {
    return _sendJson(res, 500, { ok: false, error: 'PROCESSAMENTO_VOZ: ' + String(e && e.message ? e.message : e).slice(0, 260), stack: String(e && e.stack || '').slice(0, 260) });
  }
}

async function _handleFactoryText(req, res) {
  let raw;
  try { raw = await _readAllBody(req, 4 * 1024 * 1024); }
  catch (e) { return _sendJson(res, 413, { ok: false, error: 'texto muito grande', code: 'BODY_ERR', detail: String(e.message || e).slice(0,100) }); }
  let body = null;
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) {
    try { body = JSON.parse(raw.toString('utf-8')); }
    catch (e) { return _sendJson(res, 400, { ok: false, error: 'JSON inválido em body.' }); }
  } else if (ct.includes('application/x-www-form-urlencoded') || !ct) {
    body = {};
    const q = new URLSearchParams(raw.toString('utf-8'));
    for (const [k, v] of q.entries()) body[k] = v;
  }
  const texto = String(body && (body.texto || body.text || body.prompt || '') || '').trim();
  if (!texto) return _sendJson(res, 400, { ok: false, error: 'Campo "texto" obrigatório (json {texto:"..."}).', code: 'NO_TEXT' });

  try {
    const userId = String(body.userId || body.user || 'web_ui_text');
    const flagsPipe = Object.assign(
      { doBuild: false, doAutoApplySecurity: true, securityFixMaxIter: 2 },
      (body.flags && typeof body.flags === 'object' ? body.flags : {})
    );
    const r = await executarFluxoTextoCompleto({ texto, userId });
    let pipe = null;
    if (r && r.ok && r.criacao && r.criacao.projectSlug && flagsPipe.doPipeline) {
      pipe = await pipelineCriarAuditarCorrigir({
        slug: r.criacao.projectSlug,
        projectDir: r.criacao.buildDocs && r.criacao.buildDocs.projectDir || null,
        flags: flagsPipe,
      }).catch(err => ({ ok: false, error: String(err && err.message || err).slice(0,200) }));
    }
    return _sendJson(res, (r && r.ok) ? 200 : 500, Object.assign({ criadorBase: criadorBaseUrl(), pipeline: pipe }, r || { ok: false, error: 'fluxo texto sem resultado' }));
  } catch (e) {
    return _sendJson(res, 500, { ok: false, error: 'PROCESSAMENTO_TEXTO: ' + String(e && e.message ? e.message : e).slice(0,260) });
  }
}

async function _handleTTS(req, res) {
  let raw;
  try { raw = await _readAllBody(req, 2 * 1024 * 1024); } catch (e) { return _sendJson(res, 413, { ok: false, error: 'tts body grande' }); }
  let body = {};
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) { try { body = JSON.parse(raw.toString('utf-8')); } catch {} }
  const texto = String((body && (body.texto || body.text)) || '').trim();
  if (!texto) return _sendJson(res, 400, { ok: false, error: 'Campo "texto" obrigatório.' });
  try {
    const r = await ttsGerarRespostaAudio({ texto, voice: body.voice || 'pt-BR-Neural2-A' });
    _sendJson(res, r.ok ? 200 : 500, r);
  } catch (e) {
    _sendJson(res, 500, { ok: false, error: 'TTS err: ' + String(e.message || e).slice(0,200) });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, *',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'local'}`);
    const p = urlObj.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && p === '/health') return _sendJson(res, 200, { ok: true, service: 'fabrica-voice-rest', port: PORT, host: HOST, time: Date.now() });
    if (req.method === 'GET' && (p === '/api/status' || p === '/status')) {
      const st = await statusServices({ timeoutMs: 6000 }).catch(() => ({ criador: { ok: false }, security: { ok: false } }));
      const cleanSt = {
        criador: { url: st.criador?.url, http: st.criador?.http || 0, ok: !!st.criador?.ok },
        security: { url: st.security?.url, http: st.security?.http || 0, ok: !!st.security?.ok },
      };
      return _sendJson(res, 200, { ok: true, voice: { ok: true, port: PORT }, criador: cleanSt.criador, security: cleanSt.security });
    }
    if (req.method === 'POST' && p === '/api/voice/process') return _handleVoiceProcess(req, res);
    if (req.method === 'POST' && p === '/api/factory/text') return _handleFactoryText(req, res);
    if (req.method === 'POST' && p === '/api/tts') return _handleTTS(req, res);
    if (req.method === 'GET' && p === '/') return _sendJson(res, 200, {
      ok: true,
      service: 'Fábrica Voice REST · TiAgente',
      endpoints: [
        { method:'POST', path:'/api/voice/process', descr:'Recebe FormData multipart com campo audio (MediaRecorder webm). Retorna transcript + fluxo completo criação agente.' },
        { method:'POST', path:'/api/factory/text', descr:'{texto: "..."} → executa criação via texto com extração de nicho/empresa/objetivos.' },
        { method:'POST', path:'/api/tts', descr:'{texto:"...", voice?:"pt-BR-Neural2-A"} → mp3 base64 via Google Cloud TTS.' },
        { method:'GET',  path:'/health', descr:'Healthcheck simples.' },
        { method:'GET',  path:'/api/status', descr:'Status + ping Criador 3000 e Security 3400.' },
      ],
    });
    return _sendJson(res, 404, { ok: false, error: 'Rota não encontrada: ' + req.method + ' ' + p, code: 'NOT_FOUND' });
  } catch (e) {
    try { return _sendJson(res, 500, { ok: false, error: 'INTERNAL: ' + String(e.message || e).slice(0, 300) }); } catch {}
  }
});

server.listen(PORT, HOST, () => {
  const dt = new Date();
  console.log(`[${dt.toISOString().slice(11,19)}] 🎙️  Fábrica Voice REST (media + factory text) · http://${HOST}:${PORT}`);
  console.log(`              POST /api/voice/process  (multipart audio MediaRecorder)`);
  console.log(`              POST /api/factory/text   (json texto prompt)`);
  console.log(`              POST /api/tts`);
  console.log(`              GET  /health · GET /api/status`);
});

process.on('SIGTERM', () => { try { server.close(() => process.exit(0)); } catch { process.exit(0); } });
process.on('SIGINT',  () => { try { server.close(() => process.exit(0)); } catch { process.exit(0); } });

export default server;

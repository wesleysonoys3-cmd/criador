/* =========================================================
 * autoclips/transcribe.js — Transcrição automática (STT com tempos)
 * ---------------------------------------------------------
 * A análise do AutoClips exige segmentos (início, fim, texto). Este
 * módulo produz esses segmentos a partir do vídeo de origem:
 *   1. extrai o áudio em blocos com o ffmpeg (1 canal, 16 kHz, MP3);
 *   2. mede cada bloco com o ffprobe (deslocamento exato no tempo);
 *   3. transcreve cada bloco no Gemini, pedindo JSON com os tempos
 *      relativos ao bloco;
 *   4. desloca os tempos para a linha do tempo do vídeo e junta tudo.
 *
 * LIMITE HONESTO: o modelo devolve os tempos por FRASE, não palavra a
 * palavra — os resultados são marcados como aproximados (approximate)
 * e cada bloco que falhar é reportado, nunca silenciado.
 * =======================================================*/
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectFfmpeg } from './render.js';

const execFileAsync = promisify(execFile);
const _log = (...a) => console.log('[AUTOCLIPS][transcribe]', ...a);

const MAX_BUFFER = 32 * 1024 * 1024;
const DEFAULT_CHUNK_SECONDS = 55;
const STT_TIMEOUT_MS = 120000;

/* Modelos de STT em ordem de preferência: o configurado no .env primeiro e,
 * se ele estiver indisponível (ex.: 503 de alta demanda ou 404), os
 * alternativos que respondem em JSON. */
const FALLBACK_STT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

function sttModels() {
  const configured = [process.env.GEMINI_STT_MODEL, process.env.GEMINI_MODEL, process.env.GOOGLE_MODEL]
    .map((m) => String(m || '').trim())
    .filter(Boolean);
  return [...new Set([...configured, ...FALLBACK_STT_MODELS])];
}

function apiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

function tail(s, n = 260) {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(-n) : t;
}

/* ---------------- 1. Áudio em blocos ---------------- */

async function probeSeconds(bin, file) {
  try {
    const { stdout } = await execFileAsync(bin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { timeout: 30000, maxBuffer: MAX_BUFFER });
    const d = parseFloat(String(stdout || '').trim());
    return Number.isFinite(d) ? d : null;
  } catch { return null; }
}

async function extractChunks(ffmpegBin, probeBin, inputPath, workDir, chunkSeconds) {
  const dir = path.join(workDir, 'audio');
  await fs.mkdir(dir, { recursive: true });
  const args = [
    '-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000',
    '-c:a', 'libmp3lame', '-b:a', '64k',
    '-f', 'segment', '-segment_time', String(chunkSeconds),
    path.join(dir, 'bloco_%03d.mp3'),
  ];
  await execFileAsync(ffmpegBin, args, { timeout: 30 * 60 * 1000, maxBuffer: MAX_BUFFER });

  const names = (await fs.readdir(dir)).filter((n) => /^bloco_\d+\.mp3$/.test(n)).sort();
  const chunks = [];
  let offset = 0;
  for (const n of names) {
    const file = path.join(dir, n);
    const dur = await probeSeconds(probeBin, file) || chunkSeconds;
    chunks.push({ file, start: Math.round(offset * 100) / 100, duration: dur });
    offset += dur;
  }
  return chunks;
}

/* ---------------- 2. Gemini STT ---------------- */

const PROMPT = `Transcreva o áudio anexado em português do Brasil.
Responda SOMENTE com um objeto JSON, sem comentários e sem markdown, no formato:
{"segments":[{"start":0.0,"end":2.5,"text":"primeira frase"}]}
Regras:
- start e end em SEGUNDOS, relativos ao início DESTE áudio (começa em 0).
- Quebre a fala em frases completas e curtas (até 12 palavras por segmento).
- Transcreva exatamente o que foi dito: não resuma, não corrija, não embeleze.
- Se alguma palavra for inaudível, escreva [inaudível].`;

function stripFences(s) {
  return String(s || '').replace(/```json/gi, '').replace(/```/g, '').trim();
}

/* Converte a resposta do modelo em segmentos válidos dentro do bloco. */
function parseSegments(rawText, chunkDuration) {
  const clean = stripFences(rawText);
  let data = null;
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  const firstBracket = clean.indexOf('[');
  const lastBracket = clean.lastIndexOf(']');
  try {
    if (firstBrace >= 0 && lastBrace > firstBrace) data = JSON.parse(clean.slice(firstBrace, lastBrace + 1));
    else if (firstBracket >= 0 && lastBracket > firstBracket) data = JSON.parse(clean.slice(firstBracket, lastBracket + 1));
  } catch { data = null; }

  const list = Array.isArray(data) ? data : (data && Array.isArray(data.segments) ? data.segments : null);
  const out = [];
  if (list) {
    for (const s of list) {
      const text = String((s && s.text) || '').trim();
      if (!text) continue;
      let start = Number(s && s.start);
      let end = Number(s && s.end);
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end) || end <= start) end = Math.min(chunkDuration, start + 3);
      start = Math.max(0, Math.min(chunkDuration, start));
      end = Math.max(start + 0.2, Math.min(chunkDuration, end));
      out.push({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, text });
    }
    out.sort((a, b) => a.start - b.start);
  }
  if (out.length) return { segments: out, parsed: true };

  // Sem JSON utilizável: aproveita o texto puro cobrindo o bloco inteiro.
  const plain = clean.replace(/^[\[{].*$/s, '').trim() || clean;
  if (!plain) return { segments: [], parsed: false };
  return { segments: [{ start: 0, end: Math.round(chunkDuration * 100) / 100, text: plain }], parsed: false };
}

async function transcribeChunk(file, model, key, chunkDuration) {
  let b64 = '';
  try { b64 = (await fs.readFile(file)).toString('base64'); }
  catch (e) { return { ok: false, reason: 'Não foi possível ler o bloco de áudio: ' + tail(e && e.message) }; }

  const body = {
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: 'audio/mp3', data: b64 } }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: 'application/json' },
  };
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(STT_TIMEOUT_MS),
    });
    const txt = await res.text();
    let json = null;
    try { json = JSON.parse(txt); } catch { json = null; }
    if (!res.ok) {
      const msg = tail((json && json.error && json.error.message) || txt, 240);
      return { ok: false, reason: 'Gemini HTTP ' + res.status + ': ' + msg };
    }
    const parts = (json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
    const text = parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('\n');
    const parsed = parseSegments(text, chunkDuration);
    if (!parsed.segments.length) return { ok: false, reason: 'Resposta sem texto transcrito.' };
    return { ok: true, segments: parsed.segments, parsed: parsed.parsed };
  } catch (e) {
    return { ok: false, reason: 'Falha na chamada do STT: ' + tail((e && e.message) || e) };
  }
}

/* ---------------- 3. API do módulo ---------------- */

/* Transcreve o vídeo inteiro em segmentos com tempos. Nunca lança. */
export async function transcribeVideo(inputPath, { workDir, chunkSeconds = DEFAULT_CHUNK_SECONDS, onProgress = null } = {}) {
  if (!inputPath) return { ok: false, code: 'origem_ausente', reason: 'Arquivo de vídeo não informado para transcrever.' };
  if (!workDir) return { ok: false, code: 'destino_ausente', reason: 'Pasta de trabalho não informada.' };

  const key = apiKey();
  if (!key) return { ok: false, code: 'stt_sem_chave', reason: 'GEMINI_API_KEY/GOOGLE_API_KEY não configurada no .env — necessária para a transcrição automática.' };

  const t = await detectFfmpeg();
  if (!t.available) {
    return {
      ok: false, code: 'ffmpeg_ausente', pending: true,
      reason: 'Transcrição não executada: o ffmpeg não está instalado nesta máquina (é ele que separa o áudio do vídeo).',
      hint: t.installHint,
    };
  }

  let chunks = [];
  const audioDir = path.join(workDir, 'audio');
  try {
    chunks = await extractChunks(t.ffmpeg.bin, t.ffprobe.ok ? t.ffprobe.bin : t.ffmpeg.bin, inputPath, workDir, chunkSeconds);
  } catch (e) {
    return { ok: false, code: 'audio_falhou', reason: 'Não foi possível extrair o áudio do vídeo: ' + tail((e && e.stderr) || (e && e.message) || e) };
  }
  if (!chunks.length) return { ok: false, code: 'audio_vazio', reason: 'O vídeo não produziu faixas de áudio para transcrever.' };

  const models = sttModels();
  const segments = [];
  const failures = [];
  let parsedBlocks = 0;
  let active = 0;
  _log('transcribeVideo: ' + chunks.length + ' bloco(s) de ~' + chunkSeconds + 's · modelo=' + models[0]);

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    // Usa o modelo atual; se ele falhar (ex.: 503 do provedor), tenta os
    // alternativos e passa a usar o que responder.
    let r = null;
    for (let k = 0; k < models.length; k++) {
      const idx = (active + k) % models.length;
      r = await transcribeChunk(c.file, models[idx], key, c.duration);
      if (r.ok) { active = idx; break; }
    }
    if (r && r.ok) {
      if (r.parsed) parsedBlocks++;
      for (const s of r.segments) {
        segments.push({
          start: Math.round((c.start + s.start) * 100) / 100,
          end: Math.round((c.start + s.end) * 100) / 100,
          text: s.text,
        });
      }
    } else {
      failures.push({ bloco: i + 1, inicio: c.start, reason: (r && r.reason) || 'falha desconhecida no STT.' });
    }
    if (typeof onProgress === 'function') onProgress(i + 1, chunks.length);
  }

  // Limpeza: os blocos de áudio já não são necessários.
  try { await fs.rm(audioDir, { recursive: true, force: true }); } catch { /* ok */ }

  if (!segments.length) {
    // O motivo real do provedor é devolvido junto: sem ele o erro fica opaco.
    const why = (failures[0] && failures[0].reason) ? ' Motivo do STT: ' + failures[0].reason : '';
    return { ok: false, code: 'stt_vazio', reason: 'Nenhum trecho foi transcrito.' + why, failures, chunks: chunks.length, model: models[active] };
  }

  const approximate = parsedBlocks < chunks.length;
  return {
    ok: true,
    segments,
    chunks: chunks.length,
    failedChunks: failures,
    model: models[active],
    approximate,
    note: approximate
      ? 'Transcrição parcial/estimada: ' + failures.length + ' bloco(s) sem tempos confiáveis — os tempos desses trechos foram estimados pela duração do áudio.'
      : 'Transcrição automática: tempos por frase (origem: blocos de ' + chunkSeconds + 's).',
  };
}

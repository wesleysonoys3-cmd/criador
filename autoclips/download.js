/* =========================================================
 * autoclips/download.js — Vídeo de origem por link (yt-dlp)
 * ---------------------------------------------------------
 * O render precisa de um ARQUIVO local. Quando a fonte da tarefa é
 * uma URL, este módulo converte o link em arquivo com o yt-dlp:
 *   - detecta o binário (AUTOCLIPS_YTDLP, PATH ou pastas padrão);
 *   - baixa em MP4 (com merge via ffmpeg quando necessário);
 *   - quando o yt-dlp não existe, devolve erro explícito com a
 *     instrução de instalação — nada de simular download.
 *
 * O que este módulo NÃO faz: não contorna DRM, paywall, login ou
 * qualquer proteção — se o yt-dlp não conseguir baixar, o motivo real
 * é reportado.
 * =======================================================*/
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectFfmpeg } from './render.js';

const execFileAsync = promisify(execFile);
const _log = (...a) => console.log('[AUTOCLIPS][download]', ...a);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_BIN = path.resolve(HERE, '..', 'bin');

const MAX_BUFFER = 32 * 1024 * 1024;
const BIN_DIRS = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin'];
const INSTALL_HINT = 'Instale o yt-dlp (ex.: "brew install yt-dlp" no macOS) ou defina AUTOCLIPS_YTDLP com o caminho do binário.';

let _cache = null;

/* Caminhos candidatos: env → PATH → bin local do projeto → pastas padrão. */
function candidates() {
  const env = String(process.env.AUTOCLIPS_YTDLP || '').trim();
  const list = [];
  if (env) list.push(env);
  list.push('yt-dlp');
  list.push(path.join(LOCAL_BIN, 'yt-dlp'));
  for (const d of BIN_DIRS) list.push(path.join(d, 'yt-dlp'));
  return [...new Set(list)];
}

async function probeBin(bin) {
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 20000, maxBuffer: MAX_BUFFER });
    const v = String(stdout || '').trim().split('\n')[0] || null;
    return { ok: true, version: v };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

/* Detecta o yt-dlp (com cache em memória). */
export async function detectYtDlp({ refresh = false } = {}) {
  if (_cache && !refresh) return _cache;
  let found = null;
  let lastError = null;
  for (const bin of candidates()) {
    const p = await probeBin(bin);
    if (p.ok) { found = { bin, version: p.version }; break; }
    lastError = p.error;
  }
  _cache = {
    available: !!found,
    bin: found ? found.bin : candidates()[0],
    version: found ? found.version : null,
    error: found ? null : lastError,
    checkedAt: new Date().toISOString(),
    installHint: INSTALL_HINT,
  };
  _log('detectYtDlp: ' + (_cache.available ? 'OK ' + _cache.version + ' (' + _cache.bin + ')' : 'AUSENTE'));
  return _cache;
}

export function ytDlpStatus() { return _cache; }

function tail(s, n = 400) {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(-n) : t;
}

/* Escolhe o arquivo baixado na pasta (ignora partes incompletas). */
async function pickDownloaded(dir) {
  let names = [];
  try { names = await fs.readdir(dir); } catch { return null; }
  const found = [];
  for (const n of names) {
    if (n.endsWith('.part') || n.endsWith('.ytdl') || n.endsWith('.temp')) continue;
    if (!/^fonte\./.test(n)) continue;
    const full = path.join(dir, n);
    try {
      const st = await fs.stat(full);
      if (st.isFile() && st.size > 0) found.push({ file: full, size: st.size, mtime: st.mtimeMs });
    } catch { /* ignora */ }
  }
  if (!found.length) return null;
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0];
}

/* Baixa o vídeo da URL para `outDir` como MP4. Nunca lança. */
export async function downloadVideo(url, { outDir, timeoutMs = 45 * 60 * 1000 } = {}) {
  const value = String(url || '').trim();
  if (!value) return { ok: false, code: 'url_ausente', reason: 'URL de vídeo vazia.' };
  if (!outDir) return { ok: false, code: 'destino_ausente', reason: 'Pasta de destino do download não informada.' };

  const t = await detectYtDlp();
  if (!t.available) {
    return {
      ok: false, code: 'ytdlp_ausente', pending: true,
      reason: 'Download não executado: o yt-dlp não está instalado nesta máquina. Sem ele o link não vira arquivo, e sem arquivo não há corte.',
      hint: t.installHint, error: t.error,
    };
  }

  await fs.mkdir(outDir, { recursive: true });
  // Aponta o ffmpeg detectado para o yt-dlp (mescla de vídeo+áudio sem
  // depender de um ffmpeg no PATH do sistema).
  const ff = await detectFfmpeg();
  const args = [
    '--no-playlist', '--no-warnings', '--restrict-filenames',
    '--merge-output-format', 'mp4',
    '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
    '-o', path.join(outDir, 'fonte.%(ext)s'),
    value,
  ];
  if (ff.available && ff.ffmpeg && ff.ffmpeg.ok) args.splice(args.length - 1, 0, '--ffmpeg-location', ff.ffmpeg.bin);
  _log('downloadVideo: ' + value + ' → ' + outDir);
  try {
    const { stdout, stderr } = await execFileAsync(t.bin, args, { timeout: timeoutMs, maxBuffer: MAX_BUFFER });
    const file = await pickDownloaded(outDir);
    if (!file) {
      return { ok: false, code: 'download_sem_arquivo', reason: 'O yt-dlp terminou sem gerar arquivo na pasta de destino.', raw: tail(stdout), stderr: tail(stderr) };
    }
    _log('downloadVideo OK: ' + file.file + ' (' + Math.round(file.size / 1024) + ' KB)');
    return { ok: true, path: file.file, size: file.size, bin: t.bin, ytDlpVersion: t.version, stderr: tail(stderr, 200) };
  } catch (e) {
    return {
      ok: false, code: 'download_falhou',
      reason: 'Falha ao baixar o vídeo do link: ' + tail(String((e && (e.stderr || e.message)) || e), 300),
      stderr: tail(e && e.stderr),
    };
  }
}

export { INSTALL_HINT as DOWNLOAD_INSTALL_HINT };

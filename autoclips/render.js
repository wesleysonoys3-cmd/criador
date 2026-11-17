/* =========================================================
 * autoclips/render.js — Render real com ffmpeg
 * ---------------------------------------------------------
 * Detecta o ffmpeg/ffprobe (env AUTOCLIPS_FFMPEG/AUTOCLIPS_FFPROBE,
 * PATH ou pastas padrão) e EXECUTA o corte de verdade:
 *   - escreve os insumos de cada corte (legendas .srt e título .txt);
 *   - corta, reenquadra (vertical/quadrado/horizontal), aplica legendas
 *     e QUEIMA o título do corte no vídeo;
 *   - concatena os cortes em final.mp4 (best-effort);
 *   - devolve os arquivos gerados com caminho e link para publicação.
 *
 * Quando o ffmpeg não existe, nada é fingido: o resultado sai com
 * código, motivo e instrução de instalação, e o plano continua válido.
 * =======================================================*/
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { forceStyle, buildSrt } from './captions.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const _log = (...a) => console.log('[AUTOCLIPS][render]', ...a);

const MAX_BUFFER = 16 * 1024 * 1024;
const CUT_TIMEOUT_MS = 20 * 60 * 1000;
const BIN_DIRS = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin'];

/* Filtros que o render usa para queimar legendas e título. Dependem da
 * libass e NÃO existem em todo build de ffmpeg (alguns recortes do
 * Homebrew saem sem ela) — por isso a capacidade é sondada, não suposta. */
const NEEDED_FILTERS = ['subtitles'];

let _cache = null;

/* Descobre o binário informado por env ou o padrão do sistema. */
function binFor(name) {
  const envKey = 'AUTOCLIPS_' + name.toUpperCase();
  return String(process.env[envKey] || name).trim();
}

/* Binários estáticos embutidos via npm (ffmpeg-static/ffprobe-static).
 * Servem de último recurso quando não há ffmpeg instalado no sistema. */
async function staticBinCandidates(name) {
  try {
    if (name === 'ffmpeg') {
      const m = await import('ffmpeg-static');
      const p = m.default || m;
      if (typeof p === 'string' && p) return [p];
    } else if (name === 'ffprobe') {
      const m = await import('ffprobe-static');
      const p = m.default || m;
      if (p && p.path) return [p.path];
    }
  } catch { /* pacote ausente: segue sem o fallback */ }
  return [];
}

/* Caminhos candidatos: env → PATH → pastas padrão (cobre apps abertos
 * por duplo clique, cujo PATH costuma não incluir o Homebrew) → estáticos. */
function candidatesFor(name, extra = []) {
  const list = [binFor(name), name];
  for (const d of BIN_DIRS) list.push(path.join(d, name));
  for (const e of extra) if (e) list.push(e);
  return [...new Set(list.filter(Boolean))];
}

async function probeBin(bin) {
  try {
    const { stdout } = await execAsync(bin + ' -version', { timeout: 8000, maxBuffer: MAX_BUFFER });
    const first = String(stdout || '').split('\n')[0];
    const m = first.match(/version\s+([0-9][^\s]*)/i);
    return { ok: true, version: m ? m[1] : first.slice(0, 80) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

/* Sonda quais filtros o binário oferece (a lista é lida de "ffmpeg -filters"). */
async function probeFilters(bin) {
  const have = {};
  for (const f of NEEDED_FILTERS) have[f] = false;
  try {
    const { stdout } = await execAsync(bin + ' -hide_banner -filters', { timeout: 10000, maxBuffer: MAX_BUFFER });
    const text = String(stdout || '');
    for (const f of NEEDED_FILTERS) have[f] = new RegExp('(^|\\s)' + f + '\\s').test(text);
  } catch { /* lista indisponível: assume sem os filtros */ }
  return have;
}

/* Tenta cada candidato e guarda o que realmente funciona. Quando
 * `needFilters` é informado, prefere um binário que ofereça TODOS esses
 * filtros (ex.: subtitles/libass); se nenhum tiver, devolve o primeiro
 * que ao menos executa, para não inviabilizar o corte sem legendas. */
async function resolveBin(name, extra = [], needFilters = null) {
  let lastError = null;
  let firstOk = null;
  for (const bin of candidatesFor(name, extra)) {
    const p = await probeBin(bin);
    if (!p.ok) { lastError = p.error; continue; }
    const filters = needFilters ? await probeFilters(bin) : null;
    const found = { bin, ok: true, version: p.version, error: null, filters };
    if (!needFilters || needFilters.every((f) => filters[f])) return found;
    if (!firstOk) firstOk = found;
  }
  if (firstOk) return firstOk;
  return { bin: binFor(name), ok: false, version: null, error: lastError, filters: null };
}

/* Detecta ferramentas (com cache em memória). */
export async function detectFfmpeg({ refresh = false } = {}) {
  if (_cache && !refresh) return _cache;
  const [ffExtra, fpExtra] = await Promise.all([staticBinCandidates('ffmpeg'), staticBinCandidates('ffprobe')]);
  const ff = await resolveBin('ffmpeg', ffExtra, NEEDED_FILTERS);
  const fp = await resolveBin('ffprobe', fpExtra);
  const subtitles = !!(ff.filters && ff.filters.subtitles);
  _cache = {
    available: ff.ok,
    ffmpeg: { bin: ff.bin, ok: ff.ok, version: ff.version, error: ff.error, filters: ff.filters || null },
    ffprobe: { bin: fp.bin, ok: fp.ok, version: fp.version, error: fp.error },
    subtitles,
    checkedAt: new Date().toISOString(),
    installHint: 'Instale o ffmpeg (ex.: "brew install ffmpeg" no macOS) ou defina AUTOCLIPS_FFMPEG com o caminho do binário.',
    probedAsync: true,
  };
  _log('detectFfmpeg: ffmpeg=' + (ff.ok ? 'OK ' + ff.version + ' (' + ff.bin + ')' : 'AUSENTE')
    + ' · legendas=' + (subtitles ? 'OK' : 'INDISPONÍVEL (build sem libass)')
    + ' · ffprobe=' + (fp.ok ? 'OK ' + fp.version : 'AUSENTE'));
  return _cache;
}

export function ffmpegStatus() { return _cache; }

/* Mede a duração de um arquivo de mídia (quando o ffprobe existe). */
export async function probeDuration(filePath) {
  const t = await detectFfmpeg();
  if (!t.available) return { ok: false, code: 'ffmpeg_ausente', reason: 'ffmpeg/ffprobe não estão disponíveis.' };
  const bin = t.ffprobe.ok ? t.ffprobe.bin : t.ffmpeg.bin;
  try {
    const args = t.ffprobe.ok
      ? '"' + filePath + '" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1'
      : '-i "' + filePath + '" 2>&1';
    const { stdout } = await execAsync(bin + ' ' + args, { timeout: 20000, maxBuffer: MAX_BUFFER });
    const d = parseFloat(String(stdout || '').trim());
    return { ok: true, duration: Number.isFinite(d) ? d : null };
  } catch (e) {
    return { ok: false, reason: 'Não foi possível medir a duração: ' + String((e && e.message) || e).slice(0, 160) };
  }
}

/* ---------------- Nomes dos arquivos de saída ---------------- */
function pad(n) { return String(n).padStart(2, '0'); }
function cutName(index) { return 'cut_' + pad(index) + '.mp4'; }
function srtName(index) { return 'cut_' + pad(index) + '.srt'; }
function titleName(index) { return 'title_' + pad(index) + '.ass'; }

/* Dimensões de saída por enquadramento (usadas no ASS do título). */
function dimsFor(aspect) {
  if (aspect === '9:16') return { w: 1080, h: 1920 };
  if (aspect === '1:1') return { w: 1080, h: 1080 };
  return { w: 1920, h: 1080 };
}

function assTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const whole = Math.floor(s);
  const cs = Math.min(99, Math.round((s - whole) * 100));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  return h + ':' + pad(m) + ':' + pad(whole % 60) + '.' + pad(cs);
}

function assEscape(text) {
  return String(text || '').replace(/\r?\n/g, '\\N').replace(/[{}]/g, '');
}

/* Título queimado como ASS (libass): funciona mesmo em builds de ffmpeg
 * sem o filtro drawtext. Fica centralizado no topo, com caixa escura. */
function assTitleContent(cut, aspect) {
  const dims = dimsFor(aspect);
  const size = dims.w === 1080 && dims.h === 1920 ? 72 : (dims.h === dims.w ? 64 : 52);
  const marginV = Math.round(dims.h * 0.06);
  const font = String(process.env.AUTOCLIPS_TITLE_FONT || 'Arial').trim() || 'Arial';
  const duration = Math.max(0.5, Math.round(((cut.end - cut.start) || 0) * 100) / 100);
  const style = 'Style: Titulo,' + font + ',' + size
    + ',&H00FFFFFF,&H000000FF,&H00000000,&H88000000,-1,0,0,0,100,100,0,0,3,4,0,8,30,30,' + marginV + ',1';
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: ' + dims.w,
    'PlayResY: ' + dims.h,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,' + assTime(0) + ',' + assTime(duration) + ',Titulo,,0,0,0,,' + assEscape(cut.title),
    '',
  ].join('\n');
}

function videoFilter(plan) {
  if (plan.aspect === '9:16') return 'crop=ih*9/16:ih,scale=1080:1920';
  if (plan.aspect === '1:1') return 'crop=ih:ih,scale=1080:1080';
  return 'scale=1920:1080';
}

function shellish(bin, args) {
  return bin + ' ' + args.map((a) => (/[\s'"]/.test(a) ? "'" + a + "'" : a)).join(' ');
}

/* ---------------- Insumos (legendas, títulos, lista) ---------------- */
/* Os arquivos são escritos na pasta de saída e referenciados por nome
 * simples, porque o ffmpeg roda com cwd = pasta do trabalho. */
export function buildAssets({ plan, captions = null, titleBurn = true }) {
  const files = [];
  const burn = !!titleBurn;
  for (const c of plan.cuts || []) {
    const caps = Array.isArray(c.captions) ? c.captions : [];
    if (plan.captionsEnabled !== false && caps.length) {
      // Tempos relativos ao início do corte (o ffmpeg busca com -ss).
      const shifted = Object.assign({}, c, {
        captions: caps.map((x) => ({
          start: Math.max(0, Number(x.start) - Number(c.start)),
          end: Math.max(0, Number(x.end) - Number(c.start)),
          text: x.text,
        })),
      });
      files.push({ file: srtName(c.index), content: buildSrt(shifted, captions || {}) });
    }
    if (burn && String(c.title || '').trim()) {
      files.push({ file: titleName(c.index), content: assTitleContent(c, plan.aspect) });
    }
  }
  files.push({ file: 'lista.txt', content: (plan.cuts || []).map((c) => "file '" + cutName(c.index) + "'").join('\n') + '\n' });
  return files;
}

/* ---------------- Comandos (auditáveis e executáveis) ---------------- */
export function buildCommands({ plan, inputPath, outputDir, captions = null, titleBurn = true, burnSubtitles = true }) {
  const cmds = [];
  const vfBase = videoFilter(plan);
  const style = captions ? forceStyle(captions) : '';
  // Sem o filtro `subtitles` (ffmpeg sem libass) queimar legendas/título
  // derrubaria o comando inteiro: nesse caso o corte sai limpo.
  const burn = !!titleBurn && burnSubtitles;
  const capsOn = plan.captionsEnabled !== false && burnSubtitles;
  for (const c of plan.cuts || []) {
    const chain = [vfBase, 'setsar=1'];
    if (capsOn && (c.captions || []).length) {
      chain.push("subtitles='" + srtName(c.index) + "'" + (style ? ":force_style='" + style + "'" : ''));
    }
    if (burn && String(c.title || '').trim()) chain.push("subtitles='" + titleName(c.index) + "'");

    const duration = Math.max(0.5, Math.round(((c.end - c.start) || 0) * 100) / 100);
    const args = [
      '-y',
      '-ss', String(c.start),
      '-i', inputPath,
      '-t', String(duration),
      '-vf', chain.join(','),
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      cutName(c.index),
    ];
    cmds.push({
      kind: 'cut',
      index: c.index,
      title: c.title || null,
      output: path.join(outputDir, cutName(c.index)),
      args,
      command: shellish('ffmpeg', args),
    });
  }
  const concatArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-c', 'copy', 'final.mp4'];
  cmds.push({
    kind: 'concat',
    output: path.join(outputDir, 'final.mp4'),
    args: concatArgs,
    command: shellish('ffmpeg', concatArgs),
  });
  return cmds;
}

function tail(s, n = 300) {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(-n) : t;
}

/* Executa o render. Sem ffmpeg, retorna bloqueio explícito e honesto. */
export async function renderPlan({ plan, inputPath, outputDir, captions = null, titleBurn = true }) {
  if (!plan || !Array.isArray(plan.cuts) || !plan.cuts.length) {
    return { ok: false, code: 'plano_vazio', reason: 'Não há plano de edição para renderizar.' };
  }
  if (!inputPath) {
    return { ok: false, code: 'origem_ausente', reason: 'Informe o arquivo de vídeo de origem para renderizar.' };
  }

  const dir = outputDir || path.join(process.cwd(), 'autoclips/out');

  const t = await detectFfmpeg();
  if (!t.available) {
    return {
      ok: false,
      code: 'ffmpeg_ausente',
      pending: true,
      reason: 'Render não executado: o ffmpeg não está instalado nesta máquina. O plano de edição está pronto e pode ser renderizado assim que o ffmpeg estiver disponível.',
      hint: t.installHint,
      plan: { cutsCount: plan.cutsCount, totalDuration: plan.totalDuration, aspect: plan.aspect },
      commands: buildCommands({ plan, inputPath, outputDir: dir, captions, titleBurn }),
    };
  }

  const burnSubtitles = t.subtitles !== false;
  const assets = buildAssets({ plan, captions, titleBurn });
  const commands = buildCommands({ plan, inputPath, outputDir: dir, captions, titleBurn, burnSubtitles });

  // 1. Insumos do render (legendas .srt, títulos .txt, lista de concatenação).
  try {
    await fs.mkdir(dir, { recursive: true });
    for (const a of assets) await fs.writeFile(path.join(dir, a.file), a.content, 'utf8');
  } catch (e) {
    return { ok: false, code: 'insumos_falharam', reason: 'Não foi possível preparar os arquivos do render: ' + tail((e && e.message) || e), commands, outputs: [] };
  }

  // 2. Execução dos comandos, um a um, na pasta do trabalho.
  const bin = t.ffmpeg.bin;
  const warnings = [];
  const results = [];
  for (const c of commands) {
    const startedAt = Date.now();
    try {
      await execFileAsync(bin, c.args, { cwd: dir, timeout: CUT_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
      results.push({ kind: c.kind, index: c.index || null, output: c.output, ok: true, ms: Date.now() - startedAt });
      _log('render ' + c.kind + (c.index ? ' #' + c.index : '') + ' OK (' + (Date.now() - startedAt) + 'ms)');
    } catch (e) {
      const err = tail((e && e.stderr) || (e && e.message) || e);
      results.push({ kind: c.kind, index: c.index || null, output: c.output, ok: false, error: err, ms: Date.now() - startedAt });
      _log('render ' + c.kind + (c.index ? ' #' + c.index : '') + ' FALHOU: ' + err);
    }
  }

  // 3. Coleta dos arquivos realmente gerados.
  const jobId = path.basename(dir);
  const outputs = [];
  for (const cut of plan.cuts) {
    const r = results.find((x) => x.kind === 'cut' && x.index === cut.index);
    if (!r || !r.ok) continue;
    const file = path.join(dir, cutName(cut.index));
    let size = null;
    try { size = (await fs.stat(file)).size; } catch { /* arquivo sumiu: não entra na lista */ }
    if (!size) continue;
    outputs.push({
      index: cut.index,
      file,
      url: '/autoclips-media/' + jobId + '/' + cutName(cut.index),
      title: cut.title || null,
      start: cut.start,
      end: cut.end,
      duration: cut.duration,
      size,
    });
  }

  const cutResults = results.filter((r) => r.kind === 'cut');
  const cutFailures = cutResults.filter((r) => !r.ok);
  const concat = results.find((r) => r.kind === 'concat');
  if (!burnSubtitles) warnings.push('O ffmpeg em uso (' + bin + ') não oferece o filtro de legendas (libass): os cortes saíram sem legendas nem título queimados.');
  if (concat && !concat.ok) warnings.push('A junção final falhou (os cortes individuais estão prontos): ' + (concat.error || ''));
  for (const f of cutFailures) warnings.push('Corte #' + f.index + ' falhou: ' + (f.error || 'erro desconhecido'));

  const ok = outputs.length > 0 && cutFailures.length === 0;
  return {
    ok,
    code: ok ? null : (outputs.length ? 'render_parcial' : 'render_falhou'),
    reason: ok
      ? null
      : (outputs.length
        ? outputs.length + ' de ' + cutResults.length + ' corte(s) renderizado(s); ' + cutFailures.length + ' falhou(aram).'
        : 'Nenhum corte foi renderizado.'),
    outputs,
    final: concat && concat.ok ? { file: path.join(dir, 'final.mp4'), url: '/autoclips-media/' + jobId + '/final.mp4' } : null,
    results,
    commands,
    folder: dir,
    titleBurn: !!titleBurn,
    warnings,
    ffmpeg: { bin, version: t.ffmpeg.version },
    renderedAt: new Date().toISOString(),
  };
}

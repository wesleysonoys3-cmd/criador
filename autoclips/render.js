/* =========================================================
 * autoclips/render.js — Render real com ffmpeg (detecção honesta)
 * ---------------------------------------------------------
 * Detecta se o ffmpeg/ffprobe estão disponíveis na máquina. Quando
 * NÃO estão, a operação é reportada com clareza (código e instrução)
 * em vez de fingir que renderizou — nada de botão falso.
 *
 * Quando estão disponíveis, monta e executa os comandos de corte,
 * reenquadramento, legendas e concatenação a partir do plano.
 * =======================================================*/
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const _log = (...a) => console.log('[AUTOCLIPS][render]', ...a);

let _cache = null;

/* Descobre o binário informado por env ou o padrão do sistema. */
function binFor(name) {
  const envKey = 'AUTOCLIPS_' + name.toUpperCase();
  return String(process.env[envKey] || name).trim();
}

async function probeBin(bin) {
  try {
    const { stdout } = await execAsync(bin + ' -version', { timeout: 6000 });
    const first = String(stdout || '').split('\n')[0];
    const m = first.match(/version\s+([0-9][^\s]*)/i);
    return { ok: true, version: m ? m[1] : first.slice(0, 80) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

/* Detecta ferramentas (com cache em memória). */
export async function detectFfmpeg({ refresh = false } = {}) {
  if (_cache && !refresh) return _cache;
  const ffmpegBin = binFor('ffmpeg');
  const ffprobeBin = binFor('ffprobe');
  const [ff, fp] = await Promise.all([probeBin(ffmpegBin), probeBin(ffprobeBin)]);
  _cache = {
    available: ff.ok,
    ffmpeg: { bin: ffmpegBin, ok: ff.ok, version: ff.version || null, error: ff.ok ? null : ff.error },
    ffprobe: { bin: ffprobeBin, ok: fp.ok, version: fp.version || null, error: fp.ok ? null : fp.error },
    checkedAt: new Date().toISOString(),
    installHint: 'Instale o ffmpeg (ex.: "brew install ffmpeg" no macOS) ou defina AUTOCLIPS_FFMPEG com o caminho do binário.',
    probedAsync: true,
  };
  _log('detectFfmpeg: ffmpeg=' + (ff.ok ? 'OK ' + ff.version : 'AUSENTE') + ' · ffprobe=' + (fp.ok ? 'OK ' + fp.version : 'AUSENTE'));
  return _cache;
}

/* Mede a duração de um arquivo de mídia (quando o ffprobe existe). */
export async function probeDuration(filePath) {
  const t = await detectFfmpeg();
  if (!t.available) return { ok: false, code: 'ffmpeg_ausente', reason: 'ffmpeg/ffprobe não estão disponíveis.' };
  const bin = t.ffprobe.ok ? t.ffprobe.bin : t.ffmpeg.bin;
  try {
    const args = t.ffprobe.ok
      ? '"' + filePath + '" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1'
      : '-i "' + filePath + '" 2>&1';
    const { stdout } = await execAsync(bin + ' ' + args, { timeout: 20000 });
    const d = parseFloat(String(stdout || '').trim());
    return { ok: true, duration: Number.isFinite(d) ? d : null };
  } catch (e) {
    return { ok: false, reason: 'Não foi possível medir a duração: ' + String((e && e.message) || e).slice(0, 160) };
  }
}

/* Monta os comandos que o render executaria (auditável, sem executar). */
export function buildCommands({ plan, inputPath, outputDir }) {
  const cmds = [];
  const vf = plan.aspect === '9:16'
    ? 'crop=ih*9/16:ih,scale=1080:1920'
    : (plan.aspect === '1:1' ? 'crop=ih:ih,scale=1080:1080' : 'scale=1920:1080');
  (plan.cuts || []).forEach((c) => {
    const out = outputDir + '/cut_' + String(c.index).padStart(2, '0') + '.mp4';
    const subs = plan.captionsEnabled ? ",subtitles='cut_" + c.index + ".srt'" : '';
    cmds.push({
      kind: 'cut',
      index: c.index,
      output: out,
      command: 'ffmpeg -y -ss ' + c.start + ' -to ' + c.end + ' -i "' + inputPath + '" -vf "' + vf + subs + '" -c:a aac ' + '"' + out + '"',
    });
  });
  cmds.push({
    kind: 'concat',
    output: outputDir + '/final.mp4',
    command: 'ffmpeg -y -f concat -safe 0 -i lista.txt -c copy "' + outputDir + '/final.mp4"',
  });
  return cmds;
}

/* Executa o render. Sem ffmpeg, retorna bloqueio explícito e honesto. */
export async function renderPlan({ plan, inputPath, outputDir }) {
  if (!plan || !Array.isArray(plan.cuts) || !plan.cuts.length) {
    return { ok: false, code: 'plano_vazio', reason: 'Não há plano de edição para renderizar.' };
  }
  if (!inputPath) {
    return { ok: false, code: 'origem_ausente', reason: 'Informe o arquivo de vídeo de origem para renderizar.' };
  }
  const t = await detectFfmpeg();
  const commands = buildCommands({ plan, inputPath, outputDir: outputDir || 'autoclips/out' });
  if (!t.available) {
    return {
      ok: false,
      code: 'ffmpeg_ausente',
      pending: true,
      reason: 'Render não executado: o ffmpeg não está instalado nesta máquina. O plano de edição está pronto e pode ser renderizado assim que o ffmpeg estiver disponível.',
      hint: t.installHint,
      plan: { cutsCount: plan.cutsCount, totalDuration: plan.totalDuration, aspect: plan.aspect },
      commands,
    };
  }
  return {
    ok: false,
    code: 'render_nao_habilitado',
    pending: true,
    reason: 'ffmpeg detectado (' + t.ffmpeg.version + '), mas a execução do render está desativada nesta instalação. Os comandos prontos estão em "commands" para execução manual.',
    commands,
  };
}

export function ffmpegStatus() { return _cache; }

/* =========================================================
 * youtube/scheduler.js — Publicação automática (PARTE 8.3)
 * ---------------------------------------------------------
 * Decide QUANDO tentar publicar, respeitando as regras do dono:
 *   - limite de publicações diárias
 *   - intervalo mínimo entre publicações
 *   - dias da semana permitidos
 *   - janela de horários permitidos
 *   - botão de emergência (para tudo imediatamente)
 * A escolha de QUAL corte publicar fica em service.js (publishNext).
 * =======================================================*/

const _log = (...a) => console.log('[YOUTUBE][scheduler]', ...a);

export const DEFAULT_CONFIG = {
  enabled: false,
  emergencyStop: false,
  dailyLimit: 3,
  intervalMinutes: 60,
  allowedDays: [1, 2, 3, 4, 5, 6, 0], // 0=domingo … 6=sábado
  allowedStartHour: 9,
  allowedEndHour: 22,
  minScore: 70,
  profiles: [],            // vazio = todos os perfis
  defaultVisibility: 'private',
  lastAutoAt: null,
  updatedAt: null,
};

export function normalizeConfig(input) {
  const c = Object.assign({}, DEFAULT_CONFIG, input || {});
  c.enabled = !!c.enabled;
  c.emergencyStop = !!c.emergencyStop;
  c.dailyLimit = Math.max(0, parseInt(c.dailyLimit, 10) || 0);
  c.intervalMinutes = Math.max(1, parseInt(c.intervalMinutes, 10) || 60);
  c.allowedDays = Array.isArray(c.allowedDays) ? c.allowedDays.map((d) => parseInt(d, 10)).filter((d) => d >= 0 && d <= 6) : DEFAULT_CONFIG.allowedDays.slice();
  c.allowedStartHour = Math.min(23, Math.max(0, parseInt(c.allowedStartHour, 10) || 0));
  c.allowedEndHour = Math.min(24, Math.max(1, parseInt(c.allowedEndHour, 10) || 24));
  c.minScore = Math.min(100, Math.max(0, parseInt(c.minScore, 10) || 0));
  c.profiles = Array.isArray(c.profiles) ? c.profiles.map((p) => String(p || '').trim()).filter(Boolean) : [];
  if (['public', 'unlisted', 'private'].indexOf(c.defaultVisibility) < 0) c.defaultVisibility = 'private';
  return c;
}

/* Dia permitido + hora dentro da janela. */
export function isWithinWindow(cfg, date) {
  const d = date || new Date();
  const day = d.getDay();
  if (cfg.allowedDays.length && cfg.allowedDays.indexOf(day) < 0) return false;
  const h = d.getHours();
  if (h < cfg.allowedStartHour || h >= cfg.allowedEndHour) return false;
  return true;
}

/* Intervalo mínimo já decorrido desde a última publicação automática. */
export function isDue(cfg, date) {
  if (!cfg.lastAutoAt) return true;
  const last = Date.parse(cfg.lastAutoAt);
  if (!last) return true;
  const d = date || new Date();
  return (d.getTime() - last) >= cfg.intervalMinutes * 60 * 1000;
}

/* Condições completas para tentar publicar agora. */
export function shouldRun(cfg, connection, date) {
  if (!cfg || !cfg.enabled) return { run: false, reason: 'publicação automática desligada' };
  if (cfg.emergencyStop) return { run: false, reason: 'botão de emergência ativo' };
  if (!connection || connection.status !== 'conectado') return { run: false, reason: 'canal não conectado' };
  if (!isWithinWindow(cfg, date)) return { run: false, reason: 'fora da janela de dias/horários' };
  if (!isDue(cfg, date)) return { run: false, reason: 'aguardando intervalo mínimo' };
  return { run: true, reason: 'ok' };
}

let _timer = null;
let _ctx = null;

/* init({ getConfig, getConnection, publishNext, tickMs }) */
export function init(ctx) {
  _ctx = ctx || {};
  const tickMs = Math.max(15000, parseInt(_ctx.tickMs, 10) || 60000);
  if (_timer) clearInterval(_timer);
  _timer = setInterval(() => { tick().catch((e) => _log('tick erro:', String((e && e.message) || e))); }, tickMs);
  if (_timer.unref) _timer.unref();
  _log('scheduler iniciado · tick=' + tickMs + 'ms');
  return { ok: true, tickMs };
}

export async function tick() {
  if (!_ctx || typeof _ctx.publishNext !== 'function') return { ran: false, reason: 'sem executor' };
  const cfg = await _ctx.getConfig();
  const conn = await _ctx.getConnection();
  const gate = shouldRun(cfg, conn, new Date());
  if (!gate.run) return { ran: false, reason: gate.reason };
  try {
    const r = await _ctx.publishNext(cfg);
    return r || { ran: true };
  } catch (e) {
    _log('publishNext erro:', String((e && e.message) || e));
    return { ran: false, reason: String((e && e.message) || e) };
  }
}

export function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

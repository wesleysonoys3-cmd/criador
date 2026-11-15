/* =========================================================
 * youtube/batch.js — Agendamento com fuso horário (Etapa 6)
 * ---------------------------------------------------------
 * Converte data + hora + fuso (ex.: 2026-02-10 19:30 em
 * America/Sao_Paulo) para o instante UTC que a plataforma entende.
 *
 * Sem dependências novas: usa Intl (nativo do Node >= 18).
 * Nada é simulado — apenas cálculo de data/hora.
 * =======================================================*/

const _log = (...a) => console.log('[YOUTUBE][batch]', ...a);

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/* Lista curta e útil de fusos (a interface mostra estes). */
export const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Bahia',
  'America/Fortaleza',
  'America/Manaus',
  'America/Rio_Branco',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Luanda',
  'Asia/Dubai',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
  'UTC',
];

export function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(tz || '') });
    return true;
  } catch { return false; }
}

/* Deslocamento (ms) do fuso em relação a UTC no instante informado. */
function tzOffsetMs(date, timezone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour) % 24, Number(map.minute), Number(map.second),
  );
  return asUTC - date.getTime();
}

/*
 * Converte "2026-02-10" + "19:30" no fuso informado → ISO UTC.
 * Retorna null quando data/hora/fuso são inválidos.
 */
export function zonedToUtc(dateStr, timeStr, timezone) {
  const tz = String(timezone || DEFAULT_TIMEZONE);
  const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  const mt = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '').trim());
  if (!md || !mt || !isValidTimezone(tz)) return null;
  const y = +md[1], mo = +md[2] - 1, d = +md[3];
  const h = +mt[1], mi = +mt[2];
  if (h > 23 || mi > 59) return null;
  const naive = Date.UTC(y, mo, d, h, mi, 0);
  let ts = naive;
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMs(new Date(ts), tz);
    ts = naive - off;
  }
  const out = new Date(ts);
  return Number.isFinite(out.getTime()) ? out.toISOString() : null;
}

/* Formata um instante UTC no fuso informado (para exibir ao usuário). */
export function utcToZonedParts(iso, timezone) {
  const tz = String(timezone || DEFAULT_TIMEZONE);
  const d = new Date(String(iso || ''));
  if (!Number.isFinite(d.getTime())) return null;
  try {
    const dtf = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
    return dtf.format(d); // dd/mm/aaaa, hh:mm
  } catch { return null; }
}

/*
 * Valida um pedido de agendamento.
 * mode: 'now' (imediato) | 'schedule' (data/hora/fuso)
 * Devolve { ok, scheduledAt|null, issues[] }
 */
export function validateSchedule({ mode, date, time, timezone }) {
  const issues = [];
  if (String(mode || 'now') === 'now') return { ok: true, scheduledAt: null, issues };
  const tz = String(timezone || DEFAULT_TIMEZONE);
  if (!isValidTimezone(tz)) issues.push('Fuso horário inválido: ' + tz);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '').trim())) issues.push('Data inválida (use AAAA-MM-DD).');
  if (!/^\d{1,2}:\d{2}$/.test(String(time || '').trim())) issues.push('Hora inválida (use HH:MM).');
  if (issues.length) return { ok: false, scheduledAt: null, issues };
  const iso = zonedToUtc(date, time, tz);
  if (!iso) return { ok: false, scheduledAt: null, issues: ['Não foi possível interpretar data/hora no fuso informado.'] };
  if (Date.parse(iso) <= Date.now()) return { ok: false, scheduledAt: iso, issues: ['O horário agendado precisa estar no futuro.'] };
  return { ok: true, scheduledAt: iso, issues };
}

export default { TIMEZONES, DEFAULT_TIMEZONE, isValidTimezone, zonedToUtc, utcToZonedParts, validateSchedule };

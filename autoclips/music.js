/* =========================================================
 * autoclips/music.js — Biblioteca de músicas (honesta)
 * ---------------------------------------------------------
 * Nenhuma faixa é embutida no sistema: músicas têm direitos
 * autorais e NÃO podem ser distribuídas sem licença.
 *
 * O usuário pode registrar as PRÓPRIAS faixas por URL compatível,
 * declarando a licença. O sistema guarda apenas a referência.
 *
 * O controle de volume, o abaixamento automático durante as falas
 * (ducking) e a mixagem dependem do ffmpeg no render — quando ele
 * estiver ausente, isso é reportado como pendente (não simulado).
 * =======================================================*/
import fs from 'node:fs/promises';
import path from 'node:path';

const _log = (...a) => console.log('[AUTOCLIPS][music]', ...a);

let _file = null;

export function init({ dataDir = null } = {}) {
  if (dataDir) _file = path.join(dataDir, 'ac_music.json');
  return { ok: true, file: _file };
}

async function readAll() {
  if (!_file) return [];
  try {
    const raw = await fs.readFile(_file, 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j.tracks) ? j.tracks : [];
  } catch { return []; }
}

async function writeAll(tracks) {
  if (!_file) return;
  const tmp = _file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify({ tracks }, null, 2), 'utf8');
  await fs.rename(tmp, _file);
}

function validUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
  } catch { return null; }
}

function newId() { return 'trk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

/* Faixas disponíveis: nenhuma embutida (por direitos autorais). */
export function listTracks() {
  return readAll().then((user) => ({
    ok: true,
    bundled: [],
    user,
    total: user.length,
    note: 'Nenhuma música é embutida no sistema (direitos autorais). Registre as SUAS faixas por URL, declarando a licença.',
    audioNote: 'Mistura, controle de volume e abaixamento automático durante as falas são aplicados no render com ffmpeg. Sem ffmpeg, ficam pendentes.',
  }));
}

/* Registra uma faixa fornecida pelo usuário. Exige licença declarada. */
export async function addTrack(input = {}) {
  const url = validUrl(input.url);
  if (!url) return { ok: false, reason: 'Informe uma URL http(s) válida para a música.' };
  const license = String(input.license || '').trim();
  if (!license) return { ok: false, reason: 'Declare a licença/autorização da faixa (ex.: "CC0", "própria", "licenciada").' };
  if (input.confirmRights !== true) return { ok: false, reason: 'Confirme que você possui autorização para usar esta faixa.' };

  const tracks = await readAll();
  const dup = tracks.find((t) => t.url === url);
  if (dup) return { ok: false, reason: 'Esta faixa já está registrada.' };

  const track = {
    id: newId(),
    title: String(input.title || '').trim().slice(0, 120) || url.split('/').pop().slice(0, 80),
    url,
    license,
    volume: Number.isFinite(Number(input.volume)) ? Math.max(0, Math.min(1, Number(input.volume))) : 0.35,
    ducking: input.ducking !== false,
    createdAt: new Date().toISOString(),
    note: 'Referência externa. O AutoClips não redistribui o arquivo.',
  };
  tracks.push(track);
  await writeAll(tracks);
  _log('track adicionada: ' + track.id);
  return { ok: true, track };
}

export async function removeTrack(id) {
  const tracks = await readAll();
  const next = tracks.filter((t) => t.id !== String(id));
  if (next.length === tracks.length) return { ok: false, reason: 'Faixa não encontrada.' };
  await writeAll(next);
  return { ok: true, removed: String(id) };
}

export async function updateTrack(id, patch = {}) {
  const tracks = await readAll();
  const t = tracks.find((x) => x.id === String(id));
  if (!t) return { ok: false, reason: 'Faixa não encontrada.' };
  if (patch.title != null) t.title = String(patch.title).slice(0, 120);
  if (patch.volume != null && Number.isFinite(Number(patch.volume))) t.volume = Math.max(0, Math.min(1, Number(patch.volume)));
  if (patch.ducking != null) t.ducking = !!patch.ducking;
  await writeAll(tracks);
  return { ok: true, track: t };
}

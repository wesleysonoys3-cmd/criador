/* =========================================================
 * gamestudio/state.js — Persistência do Game Studio
 * ---------------------------------------------------------
 * Um arquivo JSON por projeto de jogo (sem banco de dados),
 * mesmo padrão dos módulos jogos/ e curriculos/.
 * Guarda metadados, versões (histórico) e registros de teste.
 * =======================================================*/
import fs from 'node:fs/promises';
import fsc from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCHEMA = 'gamestudio_v1';
export const MAX_RECORD_FILES = 400;
export const MAX_VERSIONS = 30;
export const MAX_BUILDS = 20;

export const GAME_STATUS = ['rascunho', 'pronto', 'testado', 'publicado'];
export const GAME_TYPES = ['2d', '3d'];

const _log = (...a) => console.log('[GAMESTUDIO][state]', ...a);

export function newGameId() {
  return 'gs_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
}

export function normalizeOwner(owner) {
  const s = String(owner || '').trim().toLowerCase();
  return s || 'local';
}

function fileNameFor(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  return 'gs_' + safe + '.json';
}

class GamestudioState {
  constructor() {
    this.dataDir = path.resolve(process.cwd(), 'gamestudio/data');
    this.games = new Map();
  }

  setDataDir(dir) { if (dir) this.dataDir = dir; }
  recordPath(id) { return path.join(this.dataDir, fileNameFor(id)); }

  async _ensureDir() {
    try { await fs.mkdir(this.dataDir, { recursive: true }); } catch { /* ok */ }
  }

  async loadAll() {
    await this._ensureDir();
    this.games.clear();
    let names = [];
    try { names = await fs.readdir(this.dataDir); } catch { names = []; }
    let loaded = 0;
    for (const n of names) {
      if (!n.startsWith('gs_') || !n.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.dataDir, n), 'utf8');
        const rec = JSON.parse(raw);
        if (rec && rec.id) { this.games.set(rec.id, rec); loaded++; }
      } catch { _log('registro inválido ignorado:', n); }
    }
    await this._prune();
    _log(`loadAll: ${loaded} projeto(s) carregado(s)`);
    return loaded;
  }

  async _prune() {
    if (this.games.size <= MAX_RECORD_FILES) return;
    const items = Array.from(this.games.values())
      .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
    const excess = this.games.size - MAX_RECORD_FILES;
    for (let i = 0; i < excess; i++) { try { await this.remove(items[i].id); } catch { /* ok */ } }
  }

  async save(rec) {
    if (!rec || !rec.id) return false;
    this.games.set(rec.id, rec);
    await this._ensureDir();
    const target = this.recordPath(rec.id);
    const tmp = target + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(rec, null, 2), 'utf8');
    await fs.rename(tmp, target);
    return true;
  }

  async remove(id) {
    const rec = this.games.get(String(id || ''));
    this.games.delete(String(id || ''));
    try { await fs.unlink(this.recordPath(id)); } catch { /* ok */ }
    return !!rec;
  }

  get(id) { return this.games.get(String(id || '')) || null; }
  all() { return Array.from(this.games.values()); }

  list(owner) {
    const o = owner ? normalizeOwner(owner) : null;
    return this.all().filter(r => !o || normalizeOwner(r.owner) === o);
  }

  exists() { return fsc.existsSync(this.dataDir); }
}

const state = new GamestudioState();
export default state;

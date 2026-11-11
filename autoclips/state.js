/* =========================================================
 * autoclips/state.js — Persistência do AutoClips AI
 * ---------------------------------------------------------
 * Um arquivo JSON por tarefa de processamento (sem banco de dados),
 * no mesmo padrão dos módulos jogos/, curriculos/ e gamestudio/.
 * Guarda o estado da tarefa, direitos, análise, cortes e publicação.
 * As configurações (perfis de edição e regras de publicação) ficam
 * em um único arquivo ac_config.json.
 * =======================================================*/
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCHEMA = 'autoclips_v1';
export const MAX_JOBS = 300;

const _log = (...a) => console.log('[AUTOCLIPS][state]', ...a);

export function newJobId() {
  return 'ac_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
}

export function normalizeOwner(owner) {
  const s = String(owner || '').trim().toLowerCase();
  return s || 'local';
}

function jobFileName(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  return 'ac_job_' + safe + '.json';
}

class AutoclipsState {
  constructor() {
    this.dataDir = path.resolve(process.cwd(), 'autoclips/data');
    this.jobs = new Map();
    this.config = null;
    this._chain = Promise.resolve(); // serializa as gravações (evita corrida no .tmp)
  }

  setDataDir(dir) { if (dir) this.dataDir = dir; }
  jobPath(id) { return path.join(this.dataDir, jobFileName(id)); }
  configPath() { return path.join(this.dataDir, 'ac_config.json'); }

  async _ensureDir() {
    try { await fs.mkdir(this.dataDir, { recursive: true }); } catch { /* ok */ }
  }

  /* Grava em disco de forma serializada e atômica. */
  _enqueueWrite(fn) {
    const run = this._chain.then(fn, fn);
    this._chain = run.catch(() => {});
    return run;
  }

  async loadAll() {
    await this._ensureDir();
    this.jobs.clear();
    let names = [];
    try { names = await fs.readdir(this.dataDir); } catch { names = []; }
    let loaded = 0;
    for (const n of names) {
      if (!n.startsWith('ac_job_') || !n.endsWith('.json')) continue;
      try {
        const rec = JSON.parse(await fs.readFile(path.join(this.dataDir, n), 'utf8'));
        if (rec && rec.id) { this.jobs.set(rec.id, rec); loaded++; }
      } catch { _log('tarefa inválida ignorada:', n); }
    }
    try { this.config = JSON.parse(await fs.readFile(this.configPath(), 'utf8')); } catch { this.config = null; }
    await this._prune();
    _log(`loadAll: ${loaded} tarefa(s) carregada(s)`);
    return loaded;
  }

  async _prune() {
    if (this.jobs.size <= MAX_JOBS) return;
    const items = Array.from(this.jobs.values())
      .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
    const excess = this.jobs.size - MAX_JOBS;
    for (let i = 0; i < excess; i++) { try { await this.remove(items[i].id); } catch { /* ok */ } }
  }

  async save(rec) {
    if (!rec || !rec.id) return false;
    this.jobs.set(rec.id, rec);
    const snapshot = JSON.stringify(rec, null, 2);
    return this._enqueueWrite(async () => {
      await this._ensureDir();
      const target = this.jobPath(rec.id);
      const tmp = target + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, target);
      return true;
    });
  }

  async saveConfig(cfg) {
    this.config = cfg;
    const snapshot = JSON.stringify(cfg, null, 2);
    return this._enqueueWrite(async () => {
      await this._ensureDir();
      const target = this.configPath();
      const tmp = target + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, target);
      return true;
    });
  }

  async remove(id) {
    const rec = this.jobs.get(String(id || ''));
    this.jobs.delete(String(id || ''));
    await this._enqueueWrite(async () => { try { await fs.unlink(this.jobPath(id)); } catch { /* ok */ } });
    return !!rec;
  }

  get(id) { return this.jobs.get(String(id || '')) || null; }
  all() { return Array.from(this.jobs.values()); }

  list(owner) {
    const o = owner ? normalizeOwner(owner) : null;
    return this.all().filter((r) => !o || normalizeOwner(r.owner) === o);
  }
}

const state = new AutoclipsState();
export default state;

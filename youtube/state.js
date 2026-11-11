/* =========================================================
 * youtube/state.js — Persistência do módulo YouTube (PARTE 8)
 * ---------------------------------------------------------
 * Um arquivo JSON por publicação + arquivos únicos de conexão,
 * configuração e sessões OAuth pendentes (sem banco de dados),
 * no mesmo padrão dos módulos jogos/, curriculos/, gamestudio/.
 * Escrita atômica e serializada (.tmp + rename) para evitar
 * corrida quando há gravações concorrentes.
 * =======================================================*/
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCHEMA = 'youtube_v1';
export const MAX_PUBLICATIONS = 500;

const _log = (...a) => console.log('[YOUTUBE][state]', ...a);

export function newPublicationId() {
  return 'ytpub_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
}

export function normalizeOwner(owner) {
  const s = String(owner || '').trim().toLowerCase();
  return s || 'local';
}

function safeName(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 90);
}

class YouTubeState {
  constructor() {
    this.dataDir = path.resolve(process.cwd(), 'youtube/data');
    this.connection = null;     // canal conectado + tokens (criptografados)
    this.config = null;         // regras de publicação automática
    this.oauthSessions = {};    // state -> { verifier, createdAt, redirectUri }
    this.publications = new Map();
    this.activity = [];         // registro de atividades (memória; espelhado em arquivo)
    this._chain = Promise.resolve();
  }

  setDataDir(dir) { if (dir) this.dataDir = dir; }
  pubPath(id) { return path.join(this.dataDir, 'yt_pub_' + safeName(id) + '.json'); }
  connectionPath() { return path.join(this.dataDir, 'yt_connection.json'); }
  configPath() { return path.join(this.dataDir, 'yt_config.json'); }
  oauthPath() { return path.join(this.dataDir, 'yt_oauth.json'); }
  activityPath() { return path.join(this.dataDir, 'yt_activity.jsonl'); }

  async _ensureDir() { try { await fs.mkdir(this.dataDir, { recursive: true }); } catch { /* ok */ } }

  _enqueueWrite(fn) {
    const run = this._chain.then(fn, fn);
    this._chain = run.catch(() => {});
    return run;
  }

  async _writeJson(target, obj) {
    await this._ensureDir();
    const snapshot = JSON.stringify(obj, null, 2);
    return this._enqueueWrite(async () => {
      const tmp = target + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, target);
      return true;
    });
  }

  async loadAll() {
    await this._ensureDir();
    this.publications.clear();

    try { this.connection = JSON.parse(await fs.readFile(this.connectionPath(), 'utf8')); } catch { this.connection = null; }
    try { this.config = JSON.parse(await fs.readFile(this.configPath(), 'utf8')); } catch { this.config = null; }
    try { this.oauthSessions = JSON.parse(await fs.readFile(this.oauthPath(), 'utf8')) || {}; } catch { this.oauthSessions = {}; }

    let names = [];
    try { names = await fs.readdir(this.dataDir); } catch { names = []; }
    let loaded = 0;
    for (const n of names) {
      if (!n.startsWith('yt_pub_') || !n.endsWith('.json')) continue;
      try {
        const rec = JSON.parse(await fs.readFile(path.join(this.dataDir, n), 'utf8'));
        if (rec && rec.id) { this.publications.set(rec.id, rec); loaded++; }
      } catch { _log('publicação inválida ignorada:', n); }
    }

    try {
      const raw = await fs.readFile(this.activityPath(), 'utf8');
      this.activity = raw.split('\n').filter(Boolean).slice(-400).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { this.activity = []; }

    await this._prune();
    _log(`loadAll: ${loaded} publicação(ões) · conexão=${this.connection ? 'sim' : 'não'} · config=${this.config ? 'sim' : 'não'}`);
    return loaded;
  }

  async _prune() {
    if (this.publications.size <= MAX_PUBLICATIONS) return;
    const items = Array.from(this.publications.values())
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    const excess = this.publications.size - MAX_PUBLICATIONS;
    for (let i = 0; i < excess; i++) { try { await this.removePublication(items[i].id); } catch { /* ok */ } }
  }

  async saveConnection(conn) {
    this.connection = conn;
    return this._writeJson(this.connectionPath(), conn);
  }

  async clearConnection() {
    this.connection = null;
    return this._writeJson(this.connectionPath(), null);
  }

  async saveConfig(cfg) {
    this.config = cfg;
    return this._writeJson(this.configPath(), cfg);
  }

  async saveOauthSessions(map) {
    this.oauthSessions = map || {};
    return this._writeJson(this.oauthPath(), this.oauthSessions);
  }

  async savePublication(pub) {
    if (!pub || !pub.id) return false;
    this.publications.set(pub.id, pub);
    return this._writeJson(this.pubPath(pub.id), pub);
  }

  async removePublication(id) {
    const rec = this.publications.get(String(id || ''));
    this.publications.delete(String(id || ''));
    await this._enqueueWrite(async () => { try { await fs.unlink(this.pubPath(id)); } catch { /* ok */ } });
    return !!rec;
  }

  /* Registro de atividades (PARTE 8.4) — sequencial, mantém as últimas 400. */
  appendActivity(entry) {
    const rec = Object.assign({ at: new Date().toISOString() }, entry || {});
    this.activity.push(rec);
    if (this.activity.length > 400) this.activity = this.activity.slice(-400);
    const line = JSON.stringify(rec) + '\n';
    this._enqueueWrite(async () => {
      await this._ensureDir();
      try { await fs.appendFile(this.activityPath(), line, 'utf8'); } catch { /* ok */ }
      return true;
    });
    return rec;
  }

  getPublication(id) { return this.publications.get(String(id || '')) || null; }
  allPublications() { return Array.from(this.publications.values()); }
  listPublications(owner) {
    const o = owner ? normalizeOwner(owner) : null;
    return this.allPublications()
      .filter((r) => !o || normalizeOwner(r.owner) === o)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }
}

const state = new YouTubeState();
export default state;

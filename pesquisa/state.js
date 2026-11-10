/* =========================================================
 * pesquisa/state.js — Persistência da Pesquisa Autorizada
 * ---------------------------------------------------------
 * Mesmo padrão de memoria/state.js, gamestudio/state.js e
 * jogos/state.js: arquivos JSON em <dataDir>, sem banco.
 * Guarda:
 *   _config.json   → hash do PIN + controle de tentativas/bloqueio
 *   _sessions.json → sessões de autorização (validade + revogação)
 *   _cache.json    → cache de pesquisas/páginas (LRU simples)
 *   _catalog.json  → catálogo de recursos (origem/licença/versão)
 *   _sources.json  → registro de fontes consultadas
 * NUNCA guarda o PIN em texto puro (somente hash scrypt).
 * =======================================================*/
import * as fs from 'node:fs/promises';
import * as fsc from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const _log = (...a) => console.log('[PESQUISA][state]', ...a);

export const SCHEMA = 'pesquisa_v1';

export const CONFIG_FILE = '_config.json';
export const SESSIONS_FILE = '_sessions.json';
export const CACHE_FILE = '_cache.json';
export const CATALOG_FILE = '_catalog.json';
export const SOURCES_FILE = '_sources.json';

/* Limites (evitam crescimento sem controle) */
export const MAX_CACHE = 200;
export const MAX_CATALOG = 300;
export const MAX_SOURCES = 300;

/* Política de segurança (Módulo 2.1) */
export const MAX_FAILED_ATTEMPTS = 5;               // tentativas antes de bloquear
export const LOCK_MS = 5 * 60 * 1000;               // bloqueio temporário: 5 min
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;   // validade da sessão: 2h

/* Parâmetros scrypt (hash seguro do PIN) */
export const SCRYPT_N = 16384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 32;

export function newSessionToken() {
  return 'psq_' + crypto.randomBytes(24).toString('hex');
}

/** Chave determinística para o cache (hash do conteúdo da consulta). */
export function cacheKey(kind, value) {
  return crypto.createHash('sha256').update(String(kind) + '\u0000' + String(value)).digest('hex').slice(0, 40);
}

function atomicWriteSync(file, data) {
  const tmp = file + '.tmp';
  fsc.writeFileSync(tmp, data, 'utf8');
  fsc.renameSync(tmp, file);
}

export function nowIso() { return new Date().toISOString(); }

class PesquisaState {
  constructor() {
    this.dataDir = null;
    this.loaded = false;
    /* Config do PIN (somente hash) + controle de tentativas */
    this.config = {
      pinHash: null,          // 'scrypt$N$r$p$saltB64$hashB64'
      pinAlg: 'scrypt',
      pinUpdatedAt: null,
      pinSource: null,        // 'ui' | 'env'
      failedAttempts: 0,
      lockedUntilMs: 0,
    };
    this.sessions = new Map(); // token -> { token, createdAt, expiresAt, note }
    this.cache = new Map();    // key -> { key, kind, atMs, payload }
    this.catalog = [];         // recursos externos aprovados
    this.sources = [];         // log de fontes consultadas
  }

  setDataDir(dir) {
    this.dataDir = path.resolve(String(dir || './pesquisa/data'));
    if (!fsc.existsSync(this.dataDir)) fsc.mkdirSync(this.dataDir, { recursive: true });
  }

  _p(name) { return path.join(this.dataDir, name); }

  async _readJson(name, fallback) {
    try {
      const raw = await fs.readFile(this._p(name), 'utf8');
      const data = JSON.parse(raw);
      return data == null ? fallback : data;
    } catch { return fallback; }
  }

  async _writeJson(name, data) {
    if (!this.dataDir) throw new Error('dataDir não definido.');
    atomicWriteSync(this._p(name), JSON.stringify(data, null, 2));
    return data;
  }

  async loadAll() {
    if (!this.dataDir) return { ok: false, reason: 'dataDir não definido.' };

    const cfg = await this._readJson(CONFIG_FILE, null);
    if (cfg && typeof cfg === 'object') {
      this.config = {
        pinHash: typeof cfg.pinHash === 'string' ? cfg.pinHash : null,
        pinAlg: cfg.pinAlg || 'scrypt',
        pinUpdatedAt: cfg.pinUpdatedAt || null,
        pinSource: cfg.pinSource || null,
        failedAttempts: Number.isFinite(cfg.failedAttempts) ? cfg.failedAttempts : 0,
        lockedUntilMs: Number.isFinite(cfg.lockedUntilMs) ? cfg.lockedUntilMs : 0,
      };
    }

    const ses = await this._readJson(SESSIONS_FILE, []);
    if (Array.isArray(ses)) {
      for (const s of ses) {
        if (s && typeof s.token === 'string') this.sessions.set(s.token, s);
      }
    }

    const cache = await this._readJson(CACHE_FILE, []);
    if (Array.isArray(cache)) {
      for (const c of cache) {
        if (c && typeof c.key === 'string') this.cache.set(c.key, c);
      }
    }

    const catalog = await this._readJson(CATALOG_FILE, []);
    if (Array.isArray(catalog)) this.catalog = catalog.slice(-MAX_CATALOG);

    const sources = await this._readJson(SOURCES_FILE, []);
    if (Array.isArray(sources)) this.sources = sources.slice(-MAX_SOURCES);

    this.loaded = true;
    _log(`loadAll: pin=${this.config.pinHash ? 'definido' : 'ausente'} · sessões=${this.sessions.size} · cache=${this.cache.size} · catálogo=${this.catalog.length} · fontes=${this.sources.length}`);
    return { ok: true, sessions: this.sessions.size, cache: this.cache.size, catalog: this.catalog.length, sources: this.sources.length };
  }

  /* ---------------- PIN ---------------- */
  async saveConfig() {
    return this._writeJson(CONFIG_FILE, {
      schema: SCHEMA,
      pinHash: this.config.pinHash,
      pinAlg: this.config.pinAlg,
      pinUpdatedAt: this.config.pinUpdatedAt,
      pinSource: this.config.pinSource,
      failedAttempts: this.config.failedAttempts,
      lockedUntilMs: this.config.lockedUntilMs,
      updatedAt: nowIso(),
    });
  }

  /* ---------------- Sessões ---------------- */
  async saveSessions() {
    return this._writeJson(SESSIONS_FILE, [...this.sessions.values()]);
  }

  purgeExpiredSessions() {
    const now = Date.now();
    let removed = 0;
    for (const [k, s] of this.sessions) {
      if (!s || !s.expiresAt || new Date(s.expiresAt).getTime() <= now) { this.sessions.delete(k); removed++; }
    }
    return removed;
  }

  /* ---------------- Cache ---------------- */
  async saveCache() {
    // LRU: mantém as MAX_CACHE entradas mais recentes por atMs
    const arr = [...this.cache.values()].sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
    const trimmed = arr.slice(0, MAX_CACHE);
    if (trimmed.length !== arr.length) {
      this.cache = new Map(trimmed.map(c => [c.key, c]));
    }
    return this._writeJson(CACHE_FILE, trimmed);
  }

  cacheGet(key) {
    const hit = this.cache.get(key);
    if (!hit) return null;
    hit.hits = (hit.hits || 0) + 1;
    hit.lastHitMs = Date.now();
    return hit;
  }

  cacheSet(entry) {
    this.cache.set(entry.key, entry);
    if (this.cache.size > MAX_CACHE) {
      const arr = [...this.cache.values()].sort((a, b) => (a.atMs || 0) - (b.atMs || 0));
      for (const old of arr.slice(0, this.cache.size - MAX_CACHE)) this.cache.delete(old.key);
    }
  }

  async cacheClear() {
    this.cache.clear();
    return this._writeJson(CACHE_FILE, []);
  }

  /* ---------------- Catálogo de recursos ---------------- */
  async saveCatalog() {
    if (this.catalog.length > MAX_CATALOG) this.catalog = this.catalog.slice(-MAX_CATALOG);
    return this._writeJson(CATALOG_FILE, this.catalog);
  }

  /* ---------------- Fontes ---------------- */
  async saveSources() {
    if (this.sources.length > MAX_SOURCES) this.sources = this.sources.slice(-MAX_SOURCES);
    return this._writeJson(SOURCES_FILE, this.sources);
  }
}

const singleton = new PesquisaState();
export default singleton;
export { PesquisaState };

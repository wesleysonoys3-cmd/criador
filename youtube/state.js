/* =========================================================
 * youtube/state.js — Persistência do módulo de redes sociais (PARTE 8)
 * ---------------------------------------------------------
 * Um arquivo JSON por publicação + arquivos únicos de CONTAS,
 * configuração e sessões OAuth pendentes (sem banco de dados),
 * no mesmo padrão dos módulos jogos/, curriculos/, gamestudio/.
 * Escrita atômica e serializada (.tmp + rename) para evitar
 * corrida quando há gravações concorrentes.
 *
 * MÚLTIPLAS CONTAS (Etapa 5):
 *   - this.connections guarda TODAS as contas conectadas (de qualquer
 *     rede: youtube, instagram, ...), cada uma com id próprio.
 *   - this.connection é um atalho de leitura que devolve a conta
 *     PRIMÁRIA (compatibilidade com o código que já existia: agendador,
 *     Analytics e publicação automática continuam funcionando).
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

class SocialState {
  constructor() {
    this.dataDir = path.resolve(process.cwd(), 'youtube/data');
    this.connections = [];      // TODAS as contas conectadas (multi-rede)
    this.config = null;         // regras de publicação automática
    this.oauthSessions = {};    // state -> { verifier, createdAt, redirectUri, platform }
    this.publications = new Map();
    this.activity = [];         // registro de atividades (memória; espelhado em arquivo)
    this._chain = Promise.resolve();
  }

  /* Conta principal: a marcada como primária ou a primeira conectada. */
  get connection() {
    const list = (this.connections || []).filter(Boolean);
    if (!list.length) return null;
    return list.find((c) => c.primary)
      || list.find((c) => c.status === 'conectado')
      || list[0];
  }

  setDataDir(dir) { if (dir) this.dataDir = dir; }
  pubPath(id) { return path.join(this.dataDir, 'yt_pub_' + safeName(id) + '.json'); }
  accountsPath() { return path.join(this.dataDir, 'yt_accounts.json'); }
  legacyConnectionPath() { return path.join(this.dataDir, 'yt_connection.json'); }
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

    this.connections = [];
    try {
      const raw = JSON.parse(await fs.readFile(this.accountsPath(), 'utf8'));
      if (Array.isArray(raw)) this.connections = raw.filter(Boolean);
    } catch { this.connections = []; }

    /* Migração: instalações antigas guardavam UMA conexão em yt_connection.json. */
    if (!this.connections.length) {
      try {
        const old = JSON.parse(await fs.readFile(this.legacyConnectionPath(), 'utf8'));
        if (old && old.status) {
          const migrated = Object.assign({}, old, {
            id: old.id || migrateId(old),
            platform: old.platform || 'youtube',
            primary: true,
          });
          this.connections = [migrated];
          await this.saveConnections(this.connections);
          _log('conexão antiga migrada para o formato multi-conta.');
        }
      } catch { /* sem arquivo antigo */ }
    }

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
    _log(`loadAll: ${loaded} publicação(ões) · contas=${this.connections.length} · config=${this.config ? 'sim' : 'não'}`);
    return loaded;
  }

  async _prune() {
    if (this.publications.size <= MAX_PUBLICATIONS) return;
    const items = Array.from(this.publications.values())
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    const excess = this.publications.size - MAX_PUBLICATIONS;
    for (let i = 0; i < excess; i++) { try { await this.removePublication(items[i].id); } catch { /* ok */ } }
  }

  /* ---------------- Contas (multi-rede) ---------------- */
  allAccounts() { return (this.connections || []).filter(Boolean); }
  getAccount(id) { const k = String(id || ''); return this.connections.find((c) => String(c.id) === k) || null; }
  accountsFor(platform) {
    const p = String(platform || '').toLowerCase();
    return this.connections.filter((c) => String(c.platform || 'youtube').toLowerCase() === p);
  }

  async saveConnections(list) {
    this.connections = Array.isArray(list) ? list.filter(Boolean) : [];
    return this._writeJson(this.accountsPath(), this.connections);
  }

  /* Insere/atualiza uma conta pelo id. Garante no máximo uma primária por rede. */
  async saveAccount(acc) {
    if (!acc || !acc.id) return false;
    const idx = this.connections.findIndex((c) => String(c.id) === String(acc.id));
    if (idx >= 0) this.connections[idx] = acc; else this.connections.push(acc);
    await this._normalizePrimary(acc);
    return this.saveConnections(this.connections);
  }

  async removeAccount(id) {
    const k = String(id || '');
    const before = this.connections.length;
    this.connections = this.connections.filter((c) => String(c.id) !== k);
    await this.saveConnections(this.connections);
    return this.connections.length < before;
  }

  /* Define qual conta é a primária (uma por vez, no conjunto). */
  async setPrimary(id) {
    const k = String(id || '');
    let found = false;
    this.connections = this.connections.map((c) => {
      const is = String(c.id) === k;
      if (is) found = true;
      return Object.assign({}, c, { primary: is });
    });
    if (!found) return false;
    await this.saveConnections(this.connections);
    return true;
  }

  async _normalizePrimary(acc) {
    const same = String(acc.platform || 'youtube');
    const others = this.connections.filter((c) => String(c.id) !== String(acc.id) && String(c.platform || 'youtube') === same);
    const hasPrimary = others.some((c) => c.primary);
    if (!hasPrimary) acc.primary = true;
  }

  /* Compatibilidade: grava uma única conexão substituindo-a por id. */
  async saveConnection(conn) {
    if (!conn) return this.clearConnection();
    if (!conn.id) conn.id = migrateId(conn);
    if (!conn.platform) conn.platform = 'youtube';
    return this.saveAccount(conn);
  }

  async clearConnection() {
    this.connections = [];
    return this._writeJson(this.accountsPath(), []);
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

/* Gera um id estável a partir do canal (ou do dono) para migração. */
function migrateId(conn) {
  const cid = conn && conn.channel && conn.channel.id;
  const base = cid || conn.authorizedAt || Date.now();
  return 'youtube:' + safeName(base);
}

const state = new SocialState();
export default state;

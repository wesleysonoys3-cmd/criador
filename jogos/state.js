/* =========================================================
 * jogos/state.js — Persistência das sessões de observação (módulo Jogos)
 * Histórico separado por site, jogo e sessão, em arquivos JSON.
 * Mesmo padrão de btc_market/state.js (sem banco de dados).
 * =======================================================*/
import * as fs from 'node:fs/promises';
import * as fsc from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const _log = (...a) => console.log('[JOGOS][state]', ...a);

export const MAX_SESSION_FILES = 300;
export const SCHEMA = 'jogos_session_v1';

/** Nome de arquivo seguro derivado do id (nunca usa entrada crua do usuário). */
function fileNameFor(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  return `session_${safe}.json`;
}

export function newSessionId() {
  return 'js_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
}

class JogosState {
  constructor() {
    this.sessions = new Map(); // id -> sessão
    this.dataDir = null;
    this.loaded = false;
  }

  setDataDir(dir) {
    this.dataDir = path.resolve(String(dir || './jogos/data'));
    if (!fsc.existsSync(this.dataDir)) fsc.mkdirSync(this.dataDir, { recursive: true });
  }

  async loadAll() {
    if (!this.dataDir) return { ok: false, reason: 'dataDir não definido.' };
    let files = [];
    try { files = await fs.readdir(this.dataDir); } catch { return { ok: true, loaded: 0 }; }
    const jsons = files.filter(f => /^session_[a-zA-Z0-9_.-]+\.json$/.test(f)).sort();
    let loaded = 0;
    for (const f of jsons) {
      try {
        const raw = await fs.readFile(path.join(this.dataDir, f), 'utf8');
        const data = JSON.parse(raw);
        if (data && data.id) { this.sessions.set(data.id, data); loaded++; }
      } catch (e) { _log('ignorando arquivo inválido', f, String(e?.message || e)); }
    }
    this.loaded = true;
    _log(`loadAll: ${loaded} sessão(ões) carregada(s) de ${this.dataDir}`);
    return { ok: true, loaded };
  }

  async _prune() {
    if (!this.dataDir) return;
    let files = [];
    try { files = await fs.readdir(this.dataDir); } catch { return; }
    const jsons = files.filter(f => /^session_[a-zA-Z0-9_.-]+\.json$/.test(f));
    if (jsons.length <= MAX_SESSION_FILES) return;
    const withTime = [];
    for (const f of jsons) {
      try { const st = await fs.stat(path.join(this.dataDir, f)); withTime.push({ f, m: st.mtimeMs }); } catch {}
    }
    withTime.sort((a, b) => a.m - b.m);
    const excess = withTime.slice(0, withTime.length - MAX_SESSION_FILES);
    for (const { f } of excess) {
      try { await fs.unlink(path.join(this.dataDir, f)); this.sessions.delete(f.replace(/^session_|\.json$/g, '')); } catch {}
    }
    if (excess.length) _log(`prune: ${excess.length} sessão(ões) antiga(s) removida(s).`);
  }

  async save(session) {
    if (!this.dataDir) throw new Error('dataDir não definido.');
    if (!session || !session.id) throw new Error('sessão inválida.');
    session.savedAt = new Date().toISOString();
    session.schema = SCHEMA;
    this.sessions.set(session.id, session);
    const p = path.join(this.dataDir, fileNameFor(session.id));
    await fs.writeFile(p, JSON.stringify(session, null, 0), 'utf8');
    this._prune().catch(() => {});
    return p;
  }

  async remove(id) {
    const s = this.sessions.get(String(id));
    this.sessions.delete(String(id));
    if (this.dataDir && s) { try { await fs.unlink(path.join(this.dataDir, fileNameFor(s.id))); } catch {} }
    return !!s;
  }

  get(id) { return this.sessions.get(String(id)) || null; }

  list() {
    return [...this.sessions.values()]
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
      .map(s => ({
        id: s.id, siteHost: s.siteHost, siteUrl: s.siteUrl,
        gameName: s.gameName, gameVersion: s.gameVersion,
        status: s.status, createdAt: s.createdAt, updatedAt: s.updatedAt, endedAt: s.endedAt,
        recordsCount: Array.isArray(s.records) ? s.records.length : 0,
        hasReference: !!(s.reference && s.reference.probabilities),
      }));
  }
}

const singleton = new JogosState();
export default singleton;
export { JogosState };

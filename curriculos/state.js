/* =========================================================
 * curriculos/state.js — Persistência do módulo Currículos
 * ---------------------------------------------------------
 * Mesmo padrão de jogos/state.js e btc_market/state.js:
 * um arquivo JSON por currículo em <dataDir>, sem banco de dados.
 * Escopo por proprietário (owner): nada é listado ou lido fora do dono.
 * =======================================================*/
import * as fs from 'node:fs/promises';
import * as fsc from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const _log = (...a) => console.log('[CURRICULOS][state]', ...a);

export const MAX_DOC_FILES = 500;
export const SCHEMA = 'curriculos_doc_v1';
export const MAX_VERSIONS = 40;

function fileNameFor(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  return `cv_${safe}.json`;
}

export function newDocId() {
  return 'cv_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
}

export function newVersionId() {
  return 'v_' + Date.now().toString(36) + '_' + crypto.randomBytes(2).toString('hex');
}

/** Normaliza o identificador de proprietário recebido do cliente. */
export function normalizeOwner(owner) {
  const s = String(owner || '').trim();
  if (!s) return 'local';
  return s.replace(/[^a-zA-Z0-9_:\-.@]/g, '').slice(0, 64) || 'local';
}

class CurriculosState {
  constructor() {
    this.docs = new Map(); // id -> documento
    this.dataDir = null;
    this.loaded = false;
  }

  setDataDir(dir) {
    this.dataDir = path.resolve(String(dir || './curriculos/data'));
    if (!fsc.existsSync(this.dataDir)) fsc.mkdirSync(this.dataDir, { recursive: true });
  }

  async loadAll() {
    if (!this.dataDir) return { ok: false, reason: 'dataDir não definido.' };
    let files = [];
    try { files = await fs.readdir(this.dataDir); } catch { return { ok: true, loaded: 0 }; }
    const jsons = files.filter(f => /^cv_[a-zA-Z0-9_.-]+\.json$/.test(f)).sort();
    let loaded = 0;
    for (const f of jsons) {
      try {
        const raw = await fs.readFile(path.join(this.dataDir, f), 'utf8');
        const data = JSON.parse(raw);
        if (data && data.id) { this.docs.set(data.id, data); loaded++; }
      } catch (e) { _log('ignorando arquivo inválido', f, String(e?.message || e)); }
    }
    this.loaded = true;
    _log(`loadAll: ${loaded} currículo(s) carregado(s) de ${this.dataDir}`);
    return { ok: true, loaded };
  }

  async _prune() {
    if (!this.dataDir) return;
    let files = [];
    try { files = await fs.readdir(this.dataDir); } catch { return; }
    const jsons = files.filter(f => /^cv_[a-zA-Z0-9_.-]+\.json$/.test(f));
    if (jsons.length <= MAX_DOC_FILES) return;
    const withTime = [];
    for (const f of jsons) {
      try { const st = await fs.stat(path.join(this.dataDir, f)); withTime.push({ f, m: st.mtimeMs }); } catch {}
    }
    withTime.sort((a, b) => a.m - b.m);
    const excess = withTime.slice(0, withTime.length - MAX_DOC_FILES);
    for (const { f } of excess) {
      try { await fs.unlink(path.join(this.dataDir, f)); this.docs.delete(f.replace(/^cv_|\.json$/g, '')); } catch {}
    }
    if (excess.length) _log(`prune: ${excess.length} currículo(s) antigo(s) removido(s).`);
  }

  async save(doc) {
    if (!this.dataDir) throw new Error('dataDir não definido.');
    if (!doc || !doc.id) throw new Error('currículo inválido.');
    doc.updatedAt = new Date().toISOString();
    doc.schema = SCHEMA;
    if (Array.isArray(doc.versions) && doc.versions.length > MAX_VERSIONS) {
      doc.versions = doc.versions.slice(doc.versions.length - MAX_VERSIONS);
    }
    this.docs.set(doc.id, doc);
    await fs.writeFile(path.join(this.dataDir, fileNameFor(doc.id)), JSON.stringify(doc, null, 0), 'utf8');
    this._prune().catch(() => {});
    return doc;
  }

  async remove(id) {
    const key = String(id);
    const d = this.docs.get(key);
    this.docs.delete(key);
    if (this.dataDir && d) { try { await fs.unlink(path.join(this.dataDir, fileNameFor(d.id))); } catch {} }
    return !!d;
  }

  get(id) { return this.docs.get(String(id)) || null; }

  /** Lista SOMENTE os currículos do proprietário informado (resumo). */
  list(owner) {
    const o = normalizeOwner(owner);
    return [...this.docs.values()]
      .filter(d => normalizeOwner(d.owner) === o)
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
      .map(d => ({
        id: d.id,
        title: d.title,
        areaId: d.areaId,
        areaName: d.areaName || null,
        templateId: d.templateId,
        status: d.status,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        versionsCount: Array.isArray(d.versions) ? d.versions.length : 0,
        targetJob: d.targetJob ? { title: d.targetJob.title || null, company: d.targetJob.company || null } : null,
        lastScore: d.lastAnalysis && typeof d.lastAnalysis.total === 'number' ? d.lastAnalysis.total : null,
      }));
  }
}

const singleton = new CurriculosState();
export default singleton;
export { CurriculosState };

/* =========================================================
 * memoria/state.js — Persistência da Memória Inteligente
 * ---------------------------------------------------------
 * Mesmo padrão de jogos/state.js e curriculos/state.js:
 * um arquivo JSON por registro em <dataDir>, sem banco de dados.
 * Guarda também a configuração das categorias em _config.json.
 * =======================================================*/
import * as fs from 'node:fs/promises';
import * as fsc from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const _log = (...a) => console.log('[MEMORIA][state]', ...a);

export const MAX_RECORD_FILES = 800;
export const SCHEMA = 'memoria_v1';
export const MAX_VERSIONS = 20;
export const CONFIG_FILE = '_config.json';

/** Categorias oficiais de memória (A–F). Chave interna + rótulo + sigla. */
export const CATEGORIES = [
  { key: 'projetos', letter: 'A', label: 'Memória de projetos' },
  { key: 'tecnica', letter: 'B', label: 'Memória técnica' },
  { key: 'procedimentos', letter: 'C', label: 'Memória de procedimentos' },
  { key: 'erros', letter: 'D', label: 'Memória de erros' },
  { key: 'preferencias', letter: 'E', label: 'Memória de preferências' },
  { key: 'recursos', letter: 'F', label: 'Memória de recursos' },
];
export const CATEGORY_KEYS = CATEGORIES.map(c => c.key);

/** Estados de validação do conhecimento (Módulo 3.3). */
export const VALIDATION_STATES = ['Pendente', 'Testado', 'Confirmado', 'Rejeitado', 'Desatualizado'];

function fileNameFor(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  return `mem_${safe}.json`;
}

export function newRecordId() {
  return 'mem_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
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

/** Normaliza o identificador de projeto (escopo). */
export function normalizeProject(project) {
  const s = String(project || '').trim();
  if (!s) return null;
  return s.replace(/[^a-zA-Z0-9_:\-.@ ]/g, '').slice(0, 80) || null;
}

class MemoriaState {
  constructor() {
    this.records = new Map(); // id -> registro
    this.dataDir = null;
    this.loaded = false;
    this.config = { disabledCategories: [] }; // categorias desativadas
  }

  setDataDir(dir) {
    this.dataDir = path.resolve(String(dir || './memoria/data'));
    if (!fsc.existsSync(this.dataDir)) fsc.mkdirSync(this.dataDir, { recursive: true });
  }

  configPath() { return path.join(this.dataDir, CONFIG_FILE); }

  async loadAll() {
    if (!this.dataDir) return { ok: false, reason: 'dataDir não definido.' };
    // Configuração (categorias desativadas)
    try {
      const rawCfg = await fs.readFile(this.configPath(), 'utf8');
      const cfg = JSON.parse(rawCfg);
      if (cfg && Array.isArray(cfg.disabledCategories)) {
        this.config.disabledCategories = cfg.disabledCategories.filter(k => CATEGORY_KEYS.includes(k));
      }
    } catch { /* sem config ainda */ }

    let files = [];
    try { files = await fs.readdir(this.dataDir); } catch { return { ok: true, loaded: 0 }; }
    const jsons = files.filter(f => /^mem_[a-zA-Z0-9_.-]+\.json$/.test(f)).sort();
    let loaded = 0;
    for (const f of jsons) {
      try {
        const raw = await fs.readFile(path.join(this.dataDir, f), 'utf8');
        const data = JSON.parse(raw);
        if (data && data.id) { this.records.set(data.id, data); loaded++; }
      } catch (e) { _log('ignorando arquivo inválido', f, String(e?.message || e)); }
    }
    this.loaded = true;
    _log(`loadAll: ${loaded} registro(s) carregado(s) de ${this.dataDir}`);
    return { ok: true, loaded };
  }

  async _prune() {
    if (!this.dataDir) return;
    let files = [];
    try { files = await fs.readdir(this.dataDir); } catch { return; }
    const jsons = files.filter(f => /^mem_[a-zA-Z0-9_.-]+\.json$/.test(f));
    if (jsons.length <= MAX_RECORD_FILES) return;
    const withTime = [];
    for (const f of jsons) {
      try { const st = await fs.stat(path.join(this.dataDir, f)); withTime.push({ f, m: st.mtimeMs }); } catch {}
    }
    withTime.sort((a, b) => a.m - b.m);
    const excess = withTime.slice(0, withTime.length - MAX_RECORD_FILES);
    for (const { f } of excess) {
      try { await fs.unlink(path.join(this.dataDir, f)); this.records.delete(f.replace(/^mem_|\.json$/g, '')); } catch {}
    }
    if (excess.length) _log(`prune: ${excess.length} registro(s) antigo(s) removido(s).`);
  }

  async save(record) {
    if (!this.dataDir) throw new Error('dataDir não definido.');
    if (!record || !record.id) throw new Error('registro inválido.');
    record.updatedAt = new Date().toISOString();
    record.schema = SCHEMA;
    if (Array.isArray(record.versions) && record.versions.length > MAX_VERSIONS) {
      record.versions = record.versions.slice(record.versions.length - MAX_VERSIONS);
    }
    this.records.set(record.id, record);
    await fs.writeFile(path.join(this.dataDir, fileNameFor(record.id)), JSON.stringify(record, null, 0), 'utf8');
    this._prune().catch(() => {});
    return record;
  }

  async saveConfig() {
    if (!this.dataDir) throw new Error('dataDir não definido.');
    const cfg = { disabledCategories: this.config.disabledCategories.slice(), updatedAt: new Date().toISOString() };
    await fs.writeFile(this.configPath(), JSON.stringify(cfg, null, 2), 'utf8');
    return cfg;
  }

  async remove(id) {
    const key = String(id);
    const r = this.records.get(key);
    this.records.delete(key);
    if (this.dataDir && r) { try { await fs.unlink(path.join(this.dataDir, fileNameFor(r.id))); } catch {} }
    return !!r;
  }

  get(id) { return this.records.get(String(id)) || null; }

  all() { return [...this.records.values()]; }

  /** Resumo leve (sem conteúdo pesado) para listagens. */
  summary(r) {
    return {
      id: r.id,
      category: r.category,
      kind: r.kind,
      scope: r.scope,
      project: r.project || null,
      title: r.title,
      summary: r.summary || '',
      tags: Array.isArray(r.tags) ? r.tags : [],
      status: r.status,
      source: r.source ? { origin: r.source.origin || null, ref: r.source.ref || null } : null,
      useCount: r.useCount || 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      versionsCount: Array.isArray(r.versions) ? r.versions.length : 0,
    };
  }
}

const singleton = new MemoriaState();
export default singleton;
export { MemoriaState };

/* =========================================================
 * memoria/service.js — Orquestração da Memória Inteligente
 * ---------------------------------------------------------
 * Registro de tarefas e conhecimentos, categorias (A–F),
 * recuperação por relevância, validação das soluções,
 * versionamento, backup/recuperação e painel.
 * Tudo determinístico (sem IA): a memória é gravada e
 * consultada por regras, reduzindo consumo de recursos.
 * =======================================================*/
import path from 'node:path';
import state, {
  newRecordId, normalizeOwner, normalizeProject,
  CATEGORIES, CATEGORY_KEYS, VALIDATION_STATES, MAX_VERSIONS,
} from './state.js';

const _log = (...a) => console.log('[MEMORIA][service]', ...a);

let _initialized = false;

export function init({ dataDir = null } = {}) {
  state.setDataDir(dataDir || path.resolve(process.cwd(), 'memoria/data'));
  if (!_initialized) {
    _initialized = true;
    state.loadAll().catch(e => _log('loadAll erro:', String(e?.message || e)));
  }
  return { ok: true, dataDir: state.dataDir, records: state.records.size };
}

export function status() {
  const counts = {};
  for (const k of CATEGORY_KEYS) counts[k] = 0;
  for (const r of state.all()) if (counts[r.category] !== undefined) counts[r.category]++;
  return {
    ok: true,
    dataDir: state.dataDir,
    total: state.records.size,
    counts,
    categories: categories(),
    validationStates: VALIDATION_STATES.slice(),
  };
}

export function categories() {
  const disabled = state.config.disabledCategories || [];
  return CATEGORIES.map(c => ({ ...c, enabled: disabled.indexOf(c.key) === -1 }));
}

/* ---------------- Proteção: nunca guardar segredos ---------------- */
const SECRET_KEY_RE = /(pass(word)?|senha|token|secret|api[_-]?key|apikey|credenc|authorization|auth[_-]?token|bearer|private[_-]?key|cookie|session[_-]?id)/i;
const SECRET_VALUE_RE = /\b(sk-[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}|Bearer\s+[A-Za-z0-9._-]{10,})\b/g;

/** Remove/omite qualquer valor com cara de credencial. Retorna { value, redacted }. */
function scrub(value, depth = 0) {
  if (depth > 8) return { value: '[removido]', redacted: true };
  if (value === null || value === undefined) return { value: value, redacted: false };
  if (typeof value === 'string') {
    if (SECRET_VALUE_RE.test(value)) { SECRET_VALUE_RE.lastIndex = 0; return { value: String(value).replace(SECRET_VALUE_RE, '[removido]'), redacted: true }; }
    return { value: value, redacted: false };
  }
  if (typeof value !== 'object') return { value: value, redacted: false };
  if (Array.isArray(value)) {
    let redacted = false;
    const out = value.map(v => { const r = scrub(v, depth + 1); redacted = redacted || r.redacted; return r.value; });
    return { value: out, redacted };
  }
  let redacted = false;
  const out = {};
  for (const k of Object.keys(value)) {
    if (SECRET_KEY_RE.test(k)) { out[k] = '[removido]'; redacted = true; continue; }
    const r = scrub(value[k], depth + 1);
    out[k] = r.value; redacted = redacted || r.redacted;
  }
  return { value: out, redacted };
}

/* ---------------- Normalização de entrada ---------------- */
const KIND_CATEGORY = {
  tarefa: 'projetos',
  projeto: 'projetos',
  conhecimento: 'tecnica',
  tecnica: 'tecnica',
  procedimento: 'procedimentos',
  erro: 'erros',
  preferencia: 'preferencias',
  recurso: 'recursos',
};
const KINDS = Object.keys(KIND_CATEGORY);

function clampStr(v, max) { return v == null ? '' : String(v).slice(0, max); }
function toArray(v, maxItems = 40, maxLen = 80) {
  const arr = Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
  const out = [];
  for (const item of arr) {
    const s = clampStr(item, maxLen).trim();
    if (s && out.indexOf(s) === -1) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeValidation(s) {
  const v = String(s || '').trim();
  for (const st of VALIDATION_STATES) if (st.toLowerCase() === v.toLowerCase()) return st;
  return 'Pendente';
}

function fingerprint(rec) {
  const t = String(rec.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return [rec.category, rec.project || '', t].join('|');
}

function currentUser() { return 'local'; }

/* ---------------- Registro ---------------- */
/**
 * Cria (ou atualiza, evitando duplicação) um registro de memória.
 * input: { category, kind, title, summary, content, tags, files, technologies,
 *          project, scope, status, source, evidence, task }
 */
export function register(input = {}, owner = null) {
  const sc = scrub(input);
  const data = sc.value && typeof sc.value === 'object' ? sc.value : {};
  const _owner = normalizeOwner(owner || data.owner || currentUser());

  const title = clampStr(data.title, 160).trim();
  if (!title) return { ok: false, error: 'Informe um título para o registro.' };

  let kind = clampStr(data.kind, 30).trim().toLowerCase();
  if (KINDS.indexOf(kind) === -1) kind = 'conhecimento';
  let category = clampStr(data.category, 30).trim().toLowerCase();
  if (CATEGORY_KEYS.indexOf(category) === -1) category = KIND_CATEGORY[kind];

  const project = normalizeProject(data.project);
  const scope = project ? 'projeto' : (data.scope === 'projeto' ? 'projeto' : 'global');

  const record = {
    id: newRecordId(),
    owner: _owner,
    category,
    kind,
    scope,
    project: scope === 'projeto' ? (project || null) : null,
    title,
    summary: clampStr(data.summary, 2000),
    content: clampStr(data.content, 20000),
    tags: toArray(data.tags),
    files: toArray(data.files, 60, 240),
    technologies: toArray(data.technologies, 40, 60),
    status: normalizeValidation(data.status),
    source: {
      origin: clampStr((data.source && data.source.origin) || data.origin || 'tiagente', 40),
      ref: clampStr((data.source && data.source.ref) || data.ref, 300) || null,
    },
    evidence: clampStr(data.evidence, 4000) || null,
    task: data.task && typeof data.task === 'object' ? {
      objective: clampStr(data.task.objective, 2000),
      result: clampStr(data.task.result, 4000),
      tests: clampStr(data.task.tests, 2000),
    } : null,
    useCount: 0,
    lastUsedAt: null,
    versions: [],
    createdAt: new Date().toISOString(),
  };

  // Dedupe: mesma categoria + projeto + título → atualiza o registro existente.
  const fp = fingerprint(record);
  let existing = null;
  for (const r of state.all()) {
    if (r.owner !== _owner) continue;
    if (fingerprint(r) === fp) { existing = r; break; }
  }
  if (existing) {
    const changed = existing.summary !== record.summary || existing.content !== record.content
      || existing.status !== record.status || existing.kind !== record.kind;
    if (changed) {
      existing.versions = (existing.versions || []);
      existing.versions.push({
        id: 'v_' + Date.now().toString(36),
        at: new Date().toISOString(),
        snapshot: {
          summary: existing.summary, content: existing.content,
          tags: existing.tags, status: existing.status, kind: existing.kind,
        },
      });
      if (existing.versions.length > MAX_VERSIONS) existing.versions = existing.versions.slice(-MAX_VERSIONS);
    }
    existing.kind = record.kind;
    existing.summary = record.summary;
    existing.content = record.content;
    existing.tags = record.tags;
    existing.files = record.files;
    existing.technologies = record.technologies;
    existing.status = record.status;
    existing.source = record.source;
    existing.evidence = record.evidence;
    existing.task = record.task;
    existing.redacted = sc.redacted || existing.redacted || false;
    state.save(existing).catch(() => {});
    return { ok: true, updated: true, record: state.summary(existing), redacted: !!existing.redacted };
  }

  record.redacted = sc.redacted;
  state.records.set(record.id, record);
  state.save(record).catch(e => _log('save erro:', String(e?.message || e)));
  return { ok: true, updated: false, record: state.summary(record), redacted: !!record.redacted };
}

/** Registro de tarefa executada (Módulo 3.2 — "registrar o que foi realizado"). */
export function registerTask(input = {}, owner = null) {
  const data = Object.assign({}, input, { kind: input.kind || 'tarefa' });
  if (!data.category) data.category = 'projetos';
  return register(data, owner);
}

export function get(id, owner = null) {
  const r = state.get(id);
  if (!r) return { ok: false, error: 'Registro não encontrado.' };
  if (owner && normalizeOwner(owner) !== r.owner) return { ok: false, error: 'Registro não encontrado.' };
  return { ok: true, record: r };
}

export function update(id, patch = {}, owner = null) {
  const r = state.get(id);
  if (!r) return { ok: false, error: 'Registro não encontrado.' };
  if (owner && normalizeOwner(owner) !== r.owner) return { ok: false, error: 'Registro não encontrado.' };
  const sc = scrub(patch);
  const p = sc.value && typeof sc.value === 'object' ? sc.value : {};

  const before = {
    summary: r.summary, content: r.content, tags: r.tags,
    status: r.status, title: r.title, kind: r.kind,
  };
  if (p.title !== undefined) r.title = clampStr(p.title, 160).trim() || r.title;
  if (p.summary !== undefined) r.summary = clampStr(p.summary, 2000);
  if (p.content !== undefined) r.content = clampStr(p.content, 20000);
  if (p.tags !== undefined) r.tags = toArray(p.tags);
  if (p.files !== undefined) r.files = toArray(p.files, 60, 240);
  if (p.technologies !== undefined) r.technologies = toArray(p.technologies, 40, 60);
  if (p.status !== undefined) r.status = normalizeValidation(p.status);
  if (p.kind !== undefined && KINDS.indexOf(String(p.kind).toLowerCase()) !== -1) r.kind = String(p.kind).toLowerCase();
  if (p.category !== undefined && CATEGORY_KEYS.indexOf(String(p.category).toLowerCase()) !== -1) r.category = String(p.category).toLowerCase();
  if (p.project !== undefined) { const pr = normalizeProject(p.project); r.project = pr; r.scope = pr ? 'projeto' : 'global'; }
  if (p.source !== undefined && p.source && typeof p.source === 'object') {
    r.source = { origin: clampStr(p.source.origin, 40) || r.source.origin, ref: clampStr(p.source.ref, 300) || null };
  }
  if (p.evidence !== undefined) r.evidence = clampStr(p.evidence, 4000) || null;

  const after = { summary: r.summary, content: r.content, tags: r.tags, status: r.status, title: r.title, kind: r.kind };
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    r.versions = r.versions || [];
    r.versions.push({ id: 'v_' + Date.now().toString(36), at: new Date().toISOString(), snapshot: before });
    if (r.versions.length > MAX_VERSIONS) r.versions = r.versions.slice(-MAX_VERSIONS);
  }
  if (sc.redacted) r.redacted = true;
  state.save(r).catch(() => {});
  return { ok: true, record: state.summary(r), redacted: !!r.redacted };
}

/** Validação do conhecimento (Módulo 3.3). */
export function validate(id, { status = '', note = '', evidence = '' } = {}, owner = null) {
  const r = state.get(id);
  if (!r) return { ok: false, error: 'Registro não encontrado.' };
  if (owner && normalizeOwner(owner) !== r.owner) return { ok: false, error: 'Registro não encontrado.' };
  const next = normalizeValidation(status);
  const sc = scrub(note ? { note: note, evidence: evidence } : {});
  r.versions = r.versions || [];
  r.versions.push({
    id: 'v_' + Date.now().toString(36),
    at: new Date().toISOString(),
    snapshot: { status: r.status, note: sc.value.note || '', evidence: r.evidence },
  });
  if (r.versions.length > MAX_VERSIONS) r.versions = r.versions.slice(-MAX_VERSIONS);
  r.status = next;
  if (sc.value.evidence) r.evidence = clampStr(sc.value.evidence, 4000);
  state.save(r).catch(() => {});
  return { ok: true, record: state.summary(r) };
}

export async function remove(id, owner = null) {
  const r = state.get(id);
  if (!r) return { ok: false, error: 'Registro não encontrado.' };
  if (owner && normalizeOwner(owner) !== r.owner) return { ok: false, error: 'Registro não encontrado.' };
  await state.remove(id);
  return { ok: true };
}

export function markUsed(id) {
  const r = state.get(id);
  if (!r) return { ok: false, error: 'Registro não encontrado.' };
  r.useCount = (r.useCount || 0) + 1;
  r.lastUsedAt = new Date().toISOString();
  state.save(r).catch(() => {});
  return { ok: true, useCount: r.useCount };
}

/* ---------------- Categorias ---------------- */
export function setCategoryEnabled(category, enabled) {
  const key = String(category || '').toLowerCase();
  if (CATEGORY_KEYS.indexOf(key) === -1) return { ok: false, error: 'Categoria inválida.' };
  const set = new Set(state.config.disabledCategories || []);
  if (enabled) set.delete(key); else set.add(key);
  state.config.disabledCategories = CATEGORY_KEYS.filter(k => set.has(k));
  state.saveConfig().catch(() => {});
  return { ok: true, categories: categories() };
}

/* ---------------- Listagem e busca por relevância ---------------- */
function isDisabled(cat) { return (state.config.disabledCategories || []).indexOf(cat) !== -1; }

function normalizeText(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function tokens(s) {
  return normalizeText(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2);
}

export function list(opts = {}, owner = null) {
  const o = owner ? normalizeOwner(owner) : null;
  const category = opts.category ? String(opts.category).toLowerCase() : null;
  const project = opts.project ? normalizeProject(opts.project) : null;
  const status = opts.status ? normalizeValidation(opts.status) : null;
  const kind = opts.kind ? String(opts.kind).toLowerCase() : null;
  const includeDisabled = !!opts.includeDisabled;
  const limit = Math.max(1, Math.min(500, parseInt(opts.limit || 200, 10) || 200));

  let items = state.all();
  if (o) items = items.filter(r => r.owner === o);
  if (category) items = items.filter(r => r.category === category);
  if (kind) items = items.filter(r => r.kind === kind);
  if (project) items = items.filter(r => r.project === project || r.scope === 'global');
  if (status) items = items.filter(r => r.status === status);
  if (!includeDisabled) items = items.filter(r => !isDisabled(r.category));

  items.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  return { ok: true, items: items.slice(0, limit).map(r => state.summary(r)) };
}

const STATUS_WEIGHT = { Confirmado: 3, Testado: 2, Pendente: 1, Desatualizado: 0.5, Rejeitado: 0.2 };

/**
 * Recuperação inteligente (Módulo 3.4): retorna somente o que é relevante.
 * Considera projeto, objetivo, linguagem/tecnologia, tipo e texto livre.
 */
export function search(opts = {}, owner = null) {
  const o = owner ? normalizeOwner(owner) : null;
  const query = clampStr(opts.query || opts.q || '', 300);
  const project = opts.project ? normalizeProject(opts.project) : null;
  const category = opts.category ? String(opts.category).toLowerCase() : null;
  const kind = opts.kind ? String(opts.kind).toLowerCase() : null;
  const tags = toArray(opts.tags).map(t => normalizeText(t));
  const technologies = toArray(opts.technologies).map(t => normalizeText(t));
  const includeDisabled = !!opts.includeDisabled;
  const track = !!opts.track;
  const limit = Math.max(1, Math.min(100, parseInt(opts.limit || 20, 10) || 20));

  const qTokens = tokens(query);
  // Correspondência textual: só exige match quando há texto/etiquetas/tecnologias.
  const hasTextQuery = qTokens.length > 0 || tags.length > 0 || technologies.length > 0;

  let items = state.all();
  if (o) items = items.filter(r => r.owner === o);
  if (!includeDisabled) items = items.filter(r => !isDisabled(r.category));
  if (category) items = items.filter(r => r.category === category);
  if (kind) items = items.filter(r => r.kind === kind);

  const now = Date.now();
  const scored = [];
  for (const r of items) {
    let match = 0; // correspondência textual/etiquetas/tecnologias
    let boost = 0; // reforços (projeto, validação, recência, reutilização)
    const titleN = normalizeText(r.title);
    const summaryN = normalizeText(r.summary);
    const contentN = normalizeText(r.content);
    const tagN = (r.tags || []).map(normalizeText);
    const techN = (r.technologies || []).map(normalizeText);

    for (const t of qTokens) {
      if (titleN.indexOf(t) !== -1) match += 5;
      if (summaryN.indexOf(t) !== -1) match += 2;
      if (contentN.indexOf(t) !== -1) match += 1;
      for (const tg of tagN) if (tg.indexOf(t) !== -1) match += 4;
      for (const tc of techN) if (tc.indexOf(t) !== -1) match += 4;
    }
    for (const tg of tags) if (tagN.indexOf(tg) !== -1) match += 6;
    for (const tc of technologies) if (techN.indexOf(tc) !== -1) match += 6;

    // Sem correspondência textual → não é resultado (não basta status/recência).
    if (hasTextQuery && match <= 0) continue;

    if (project) {
      if (r.project === project) boost += 6;
      else if (r.scope === 'global') boost += 2; // conhecimento geral reutilizável
    }
    boost += STATUS_WEIGHT[r.status] || 0;
    if (r.updatedAt) {
      const ageDays = (now - Date.parse(r.updatedAt)) / 86400000;
      if (Number.isFinite(ageDays)) boost += Math.max(0, 1.5 - ageDays / 120); // leve reforço de recência
    }
    boost += Math.min(r.useCount || 0, 8) * 0.2; // soluções já reutilizadas sobem

    scored.push({ r, score: match + boost });
  }

  scored.sort((a, b) => (b.score - a.score) || String(b.r.updatedAt || '').localeCompare(String(a.r.updatedAt || '')));
  const top = scored.slice(0, limit);
  if (track) for (const { r } of top) markUsed(r.id);

  return {
    ok: true,
    query: query || null,
    count: top.length,
    items: top.map(({ r, score }) => Object.assign(state.summary(r), { score: Math.round(score * 100) / 100 })),
  };
}

/* ---------------- Backup e recuperação (Módulo 3.7) ---------------- */
export function backup(owner = null) {
  const o = owner ? normalizeOwner(owner) : null;
  let items = state.all();
  if (o) items = items.filter(r => r.owner === o);
  return {
    ok: true,
    schema: 'memoria_backup_v1',
    exportedAt: new Date().toISOString(),
    count: items.length,
    categories: categories(),
    records: items,
  };
}

export async function restore(payload = {}, owner = null) {
  const o = owner ? normalizeOwner(owner) : null;
  const records = Array.isArray(payload) ? payload : (Array.isArray(payload.records) ? payload.records : null);
  if (!records) return { ok: false, error: 'Backup inválido: informe { records: [...] }.' };
  let inserted = 0, updated = 0, skipped = 0;
  for (const raw of records) {
    if (!raw || typeof raw !== 'object') { skipped++; continue; }
    if (!raw.title) { skipped++; continue; }
    const sc = scrub(raw);
    const data = sc.value;
    if (o && raw.owner && normalizeOwner(raw.owner) !== o) { skipped++; continue; }
    const res = register(data, o || data.owner || null);
    if (res.ok && res.updated) updated++;
    else if (res.ok) inserted++;
    else skipped++;
  }
  return { ok: true, inserted, updated, skipped };
}

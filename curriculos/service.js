/* =========================================================
 * curriculos/service.js — Orquestração do módulo Currículos
 * ---------------------------------------------------------
 * Reutiliza a IA já existente (runLLMTextOnly, injetado) e a persistência
 * JSON por módulo. Nenhum serviço duplicado, nenhuma dependência nova.
 * =======================================================*/
import path from 'node:path';
import state, { newDocId, newVersionId, normalizeOwner } from './state.js';
import { AREAS, getArea, listAreas, detectArea } from './areas.js';
import {
  normalizeProfile, guardNoFabrication, resolveSectionOrder, suggestTemplate,
  TEMPLATES, SECTION_DEFS,
} from './profile.js';
import { atsReport, scoreResume, extractKeywords } from './ats.js';
import {
  buildInterviewPrompt, buildGeneratePrompt, buildEditPrompt, buildAnalysisPrompt,
  fallbackQuestions, SYSTEM_RECRUITER, missingFields,
} from './prompt.js';
import AI from './ai.js';

const _log = (...a) => console.log('[CURRICULOS][service]', ...a);
export const MODULE_VERSION = 'curriculos_v1';

let _initialized = false;

export function init({ dataDir = null, runLLMTextOnly = null, providers = null, model = null } = {}) {
  state.setDataDir(dataDir || path.resolve(process.cwd(), 'curriculos/data'));
  AI.init({ runLLMTextOnly, providers, model });
  if (!_initialized) {
    _initialized = true;
    state.loadAll().catch(e => _log('loadAll erro:', String(e?.message || e)));
  }
  return { ok: true, dataDir: state.dataDir, docs: state.docs.size, ai: AI.available() };
}

function nowIso() { return new Date().toISOString(); }

/* ---------------- utilidades ---------------- */
const s = (v) => String(v === null || v === undefined ? '' : v).trim();
const uniq = (arr) => [...new Set(arr.map(x => s(x)).filter(Boolean))];

/** Verifica propriedade: um currículo nunca é acessado fora do dono. */
function owned(id, owner) {
  const doc = state.get(String(id));
  if (!doc) return { ok: false, error: 'Currículo não encontrado.' };
  if (normalizeOwner(doc.owner) !== normalizeOwner(owner)) {
    return { ok: false, error: 'Currículo não encontrado.' }; // mesma mensagem: não revela existência
  }
  return { ok: true, doc };
}

function sanitizeName(v) {
  return s(v).replace(/[\\/:*?"<>|\n\r\t]/g, '').slice(0, 60) || 'curriculo';
}

function slugFile(name) {
  return s(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'curriculo';
}

/** Junta o que a IA/usuário informou ao perfil existente, sem apagar dados. */
function mergeProfile(base, patch) {
  const b = normalizeProfile(base);
  const p = patch && typeof patch === 'object' ? patch : {};
  const scalar = ['fullName', 'headline', 'objective', 'email', 'phone', 'city', 'state', 'country', 'summary'];
  for (const k of scalar) if (s(p[k])) b[k] = s(p[k]);
  if (Array.isArray(p.links) && p.links.length) {
    const merged = [...b.links, ...normalizeProfile({ links: p.links }).links];
    b.links = merged.filter((l, i) => merged.findIndex(x => x.url === l.url) === i);
  }
  const mergeList = (key, idKeys, subArrays = []) => {
    const incoming = Array.isArray(p[key]) ? normalizeProfile({ [key]: p[key] })[key] : [];
    for (const item of incoming) {
      const existing = b[key].find(x => idKeys.every(k => s(x[k]).toLowerCase() === s(item[k]).toLowerCase() && s(item[k])));
      if (!existing) { b[key].push(item); continue; }
      for (const sub of subArrays) existing[sub] = uniq([...(existing[sub] || []), ...(item[sub] || [])]);
      for (const k of Object.keys(item)) {
        if (subArrays.includes(k)) continue;
        if (!s(existing[k]) && s(item[k])) existing[k] = s(item[k]);
      }
    }
  };
  mergeList('experiences', ['company', 'role'], ['bullets', 'results', 'technologies']);
  mergeList('education', ['institution', 'course'], []);
  mergeList('courses', ['name'], []);
  mergeList('certifications', ['name'], []);
  mergeList('languages', ['name'], []);
  mergeList('projects', ['name'], ['bullets']);
  if (p.skills && typeof p.skills === 'object') {
    b.skills = {
      technical: uniq([...b.skills.technical, ...(Array.isArray(p.skills.technical) ? p.skills.technical : [])]),
      behavioral: uniq([...b.skills.behavioral, ...(Array.isArray(p.skills.behavioral) ? p.skills.behavioral : [])]),
      tools: uniq([...b.skills.tools, ...(Array.isArray(p.skills.tools) ? p.skills.tools : [])]),
    };
  }
  if (Array.isArray(p.achievements) && p.achievements.length) b.achievements = uniq([...b.achievements, ...p.achievements]);
  return normalizeProfile(b);
}

/** Resumo profissional derivado SOMENTE de dados reais (quando a IA não está disponível). */
function deterministicSummary(profile, areaId) {
  const p = normalizeProfile(profile);
  const area = getArea(areaId);
  const bits = [];
  const role = p.headline || (area ? `profissional da área de ${area.name}` : 'profissional');
  bits.push(`${role}.`);
  if (p.experiences.length) {
    const last = p.experiences[0];
    const comps = [last.role, last.company].filter(Boolean).join(' na ');
    if (comps) bits.push(`Experiência mais recente em ${comps}.`);
  } else {
    bits.push('Em início de trajetória profissional, com foco em desenvolvimento e aprendizado contínuo.');
  }
  const skills = [...p.skills.technical, ...p.skills.tools].slice(0, 6);
  if (skills.length) bits.push(`Conhecimentos em ${skills.join(', ')}.`);
  if (p.education.length) {
    const ed = p.education[0];
    const t = [ed.course, ed.institution].filter(Boolean).join(' — ');
    if (t) bits.push(`Formação: ${t}.`);
  }
  if (p.languages.length) bits.push(`Idiomas: ${p.languages.map(l => l.name).join(', ')}.`);
  return bits.join(' ');
}

function saveVersion(doc, source, note) {
  const v = { id: newVersionId(), createdAt: nowIso(), source, note: note || '', profile: doc.profile };
  doc.versions = Array.isArray(doc.versions) ? doc.versions : [];
  doc.versions.push(v);
  return v;
}

function publicDoc(doc, { includeVersions = true } = {}) {
  if (!doc) return null;
  return {
    id: doc.id,
    title: doc.title,
    areaId: doc.areaId,
    areaName: doc.areaName,
    templateId: doc.templateId,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    targetJob: doc.targetJob || null,
    profile: doc.profile,
    sectionOrder: doc.sectionOrder || null,
    hasOriginal: !!doc.original,
    originalMeta: doc.original ? {
      filename: doc.original.filename || null,
      importedAt: doc.original.importedAt || null,
      confidence: doc.original.confidence || null,
      preview: String(doc.original.text || '').slice(0, 600),
    } : null,
    versions: includeVersions ? (doc.versions || []).map(v => ({ id: v.id, createdAt: v.createdAt, source: v.source, note: v.note })) : [],
    lastAnalysis: doc.lastAnalysis || null,
    aiMeta: doc.aiMeta || null,
    removedFabrication: doc.removedFabrication || [],
    missingInfo: doc.missingInfo || [],
  };
}

/* =========================================================
 * API
 * =======================================================*/

export function status() {
  return {
    ok: true,
    moduleVersion: MODULE_VERSION,
    dataDir: state.dataDir,
    docs: state.docs.size,
    ai: {
      available: AI.available(),
      lastError: AI.lastError(),
      meta: AI.lastMeta(),
      note: AI.available()
        ? 'IA conectada pela integração existente do TI Agente (mesmas chaves da aba IA Config).'
        : 'IA não configurada: o módulo continua funcionando com organização automática determinística, mas sem análise generativa.',
    },
    areas: listAreas().length,
    templates: TEMPLATES.map(t => ({ id: t.id, name: t.name, desc: t.desc })),
    disclaimer: 'A pontuação mede qualidade documental. Não há previsão de contratação.',
  };
}

export function areas() {
  return { ok: true, areas: listAreas(), templates: TEMPLATES.map(t => ({ id: t.id, name: t.name, desc: t.desc })) };
}

export async function create({ owner, areaId = null, goal = '', templateId = null, fullName = '' } = {}) {
  const o = normalizeOwner(owner);
  const detected = areaId ? getArea(areaId) : (detectArea(goal) ? getArea(detectArea(goal).id) : null);
  const profile = normalizeProfile({ fullName });
  const doc = {
    id: newDocId(),
    owner: o,
    title: fullName ? `Currículo — ${fullName}` : 'Novo currículo',
    areaId: detected ? detected.id : null,
    areaName: detected ? detected.name : null,
    areaHint: s(goal),
    templateId: templateId || suggestTemplate(profile, detected?.id),
    status: 'entrevista',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    targetJob: null,
    profile,
    sectionOrder: resolveSectionOrder(profile, templateId || 'moderno'),
    original: null,
    versions: [],
    lastAnalysis: null,
    aiMeta: null,
    removedFabrication: [],
    missingInfo: [],
  };
  await state.save(doc);
  return { ok: true, doc: publicDoc(doc) };
}

export function list(owner) {
  return { ok: true, items: state.list(owner) };
}

export function get(id, owner) {
  const r = owned(id, owner);
  if (!r.ok) return r;
  return { ok: true, doc: publicDoc(r.doc) };
}

export async function update(id, owner, patch = {}) {
  const r = owned(id, owner);
  if (!r.ok) return r;
  const doc = r.doc;
  if (patch.profile) {
    doc.profile = normalizeProfile({ ...doc.profile, ...patch.profile });
    if (patch.profile.skills) {
      doc.profile.skills = {
        technical: uniq([...(doc.profile.skills.technical || []), ...(patch.profile.skills.technical || [])]),
        behavioral: uniq([...(doc.profile.skills.behavioral || []), ...(patch.profile.skills.behavioral || [])]),
        tools: uniq([...(doc.profile.skills.tools || []), ...(patch.profile.skills.tools || [])]),
      };
    }
    doc.profile = normalizeProfile(doc.profile);
  }
  if (patch.templateId) doc.templateId = s(patch.templateId);
  if (patch.title) doc.title = s(patch.title).slice(0, 120);
  if (patch.sectionOrder && Array.isArray(patch.sectionOrder)) {
    const valid = new Set(SECTION_DEFS.map(d => d.id));
    doc.sectionOrder = patch.sectionOrder.filter(x => valid.has(x));
  }
  if (patch.targetJob !== undefined) {
    doc.targetJob = patch.targetJob ? {
      title: s(patch.targetJob.title), company: s(patch.targetJob.company), description: s(patch.targetJob.description),
    } : null;
  }
  if (patch.areaId) { const a = getArea(patch.areaId); if (a) { doc.areaId = a.id; doc.areaName = a.name; } }
  doc.status = patch.status ? s(patch.status) : doc.status;
  doc.sectionOrder = doc.sectionOrder && doc.sectionOrder.length ? doc.sectionOrder : resolveSectionOrder(doc.profile, doc.templateId);
  await state.save(doc);
  return { ok: true, doc: publicDoc(doc) };
}

export async function remove(id, owner) {
  const r = owned(id, owner);
  if (!r.ok) return r;
  await state.remove(r.doc.id);
  return { ok: true, removed: r.doc.id };
}

/* ---------------- Entrevista ---------------- */
export async function interview(id, owner, { message = '' } = {}) {
  const r = owned(id, owner);
  if (!r.ok) return r;
  const doc = r.doc;
  const msg = s(message);

  if (!msg) {
    const qs = fallbackQuestions(doc.profile, doc.areaId);
    let reply = 'Vamos montar seu currículo. Eu conduzo as perguntas — você só responde com o que for verdade.';
    let questions = qs;
    let aiUsed = false;

    if (AI.available()) {
      const pr = buildInterviewPrompt({ profile: doc.profile, areaId: doc.areaId, areaHint: doc.areaHint, firstMessage: '' });
      const out = await AI.askJson({ ...pr, tag: 'cv_interview_start' });
      if (out.ok && out.data) {
        reply = s(out.data.reply) || reply;
        if (Array.isArray(out.data.questions) && out.data.questions.length) questions = out.data.questions.slice(0, 4);
        aiUsed = true;
        doc.aiMeta = { lastProvider: out.provider || null, lastModel: out.model || null, lastAt: nowIso(), lastOp: 'entrevista' };
      }
    }
    doc.status = 'entrevista';
    await state.save(doc);
    return {
      ok: true, doc: publicDoc(doc), reply, questions,
      aiUsed, aiError: aiUsed ? null : AI.lastError(),
      missing: missingFields(doc.profile),
    };
  }

  // mensagem do usuário → extrai dados e continua a entrevista
  if (!AI.available()) {
    doc.status = 'entrevista';
    doc.missingInfo = missingFields(doc.profile);
    await state.save(doc);
    return {
      ok: true, doc: publicDoc(doc),
      reply: 'Não consegui usar a IA agora, então não vou interpretar sua mensagem automaticamente. Preencha os campos abaixo (eles são salvos como você escreveu) ou tente novamente em instantes.',
      questions: fallbackQuestions(doc.profile, doc.areaId),
      aiUsed: false, aiError: AI.lastError(), missing: doc.missingInfo,
    };
  }

  const pr = buildInterviewPrompt({ profile: doc.profile, areaId: doc.areaId, areaHint: doc.areaHint, firstMessage: msg });
  const out = await AI.askJson({ ...pr, tag: 'cv_interview' });
  if (!out.ok || !out.data) {
    return { ok: false, error: out.error || 'A IA não conseguiu responder agora.', doc: publicDoc(doc) };
  }
  const data = out.data;
  const before = doc.profile;
  if (data.patch && typeof data.patch === 'object') {
    const candidate = mergeProfile(doc.profile, data.patch);
    const guarded = guardNoFabrication(candidate, before);
    doc.removedFabrication = [...(doc.removedFabrication || []), ...guarded.removed];
    doc.profile = guarded.profile;
  }
  if (!doc.areaId) {
    const det = detectArea(`${doc.areaHint} ${msg} ${s(data.patch?.headline)} ${s(data.patch?.objective)}`);
    if (det) { doc.areaId = det.id; doc.areaName = det.name; }
  }
  doc.sectionOrder = resolveSectionOrder(doc.profile, doc.templateId);
  doc.missingInfo = Array.isArray(data.questions) && data.questions.length
    ? data.questions.map(q => s(q.field)).filter(Boolean)
    : missingFields(doc.profile);
  doc.status = data.done ? 'rascunho' : 'entrevista';
  doc.aiMeta = { lastProvider: out.provider || null, lastModel: out.model || null, lastAt: nowIso(), lastOp: 'entrevista' };
  await state.save(doc);

  return {
    ok: true, doc: publicDoc(doc),
    reply: s(data.reply) || 'Dados atualizados.',
    questions: Array.isArray(data.questions) ? data.questions.slice(0, 4) : [],
    aiUsed: true, missing: doc.missingInfo,
  };
}

/* ---------------- Importar currículo antigo ---------------- */
export async function importOriginal(id, owner, { filename = '', mimeType = '', contentBase64 = '' } = {}) {
  const r = owned(id, owner);
  if (!r.ok) return r;
  const doc = r.doc;

  if (!contentBase64) return { ok: false, error: 'Nenhum arquivo recebido.' };
  let buffer;
  try { buffer = Buffer.from(String(contentBase64).split(',').pop(), 'base64'); }
  catch { return { ok: false, error: 'Arquivo inválido.' }; }
  if (buffer.length > 8 * 1024 * 1024) return { ok: false, error: 'Arquivo maior que 8 MB não é aceito.' };

  const { extractResumeText, guessContact } = await import('./extract.js');
  const ext = extractResumeText({ filename, mimeType, buffer });
  if (!ext.ok) {
    return { ok: false, error: ext.reason, partial: ext.partial || null };
  }

  doc.original = {
    filename: sanitizeName(filename),
    importedAt: nowIso(),
    confidence: ext.confidence || 'média',
    text: String(ext.text).slice(0, 30000),
    profileBefore: doc.profile,
  };

  // Pré-preenche apenas contato quando ainda vazio (não interpreta o conteúdo por conta própria)
  const guess = guessContact(ext.text);
  const patch = {};
  if (!doc.profile.fullName && guess.nameLike) patch.fullName = guess.nameLike;
  if (!doc.profile.email && guess.email) patch.email = guess.email;
  if (!doc.profile.phone && guess.phone) patch.phone = guess.phone;
  if (Object.keys(patch).length) doc.profile = mergeProfile(doc.profile, patch);

  doc.missingInfo = missingFields(doc.profile);
  await state.save(doc);
  return {
    ok: true,
    doc: publicDoc(doc),
    extracted: {
      chars: ext.text.length,
      confidence: ext.confidence,
      preview: ext.text.slice(0, 1200),
      suggestAI: true,
    },
  };
}

/* ---------------- Gerar currículo ---------------- */
export async function generate(id, owner, { templateId = null, useOriginal = false } = {}) {
  const r = owned(id, owner);
  if (!r.ok) return r;
  const doc = r.doc;
  if (templateId) doc.templateId = s(templateId);

  const sourceText = useOriginal && doc.original?.text ? `\n\nTEXTO DO CURRÍCULO ANTIGO ENVIADO PELO CANDIDATO (use como fonte de dados reais):\n${doc.original.text.slice(0, 8000)}` : '';

  if (!AI.available()) {
    doc.profile = normalizeProfile(doc.profile);
    if (!doc.profile.summary) doc.profile.summary = deterministicSummary(doc.profile, doc.areaId);
    doc.sectionOrder = resolveSectionOrder(doc.profile, doc.templateId);
    doc.status = 'gerado';
    const v = saveVersion(doc, 'deterministico', 'Organização automática (sem IA)');
    await state.save(doc);
    return {
      ok: true, doc: publicDoc(doc), version: { id: v.id, createdAt: v.createdAt, source: v.source },
      aiUsed: false, aiError: AI.lastError(),
      note: 'A IA não está configurada. O currículo foi organizado automaticamente a partir dos dados reais que você informou — nada foi inventado.',
    };
  }

  const pr = buildGeneratePrompt({ profile: doc.profile, areaId: doc.areaId, targetJob: doc.targetJob, templateId: doc.templateId });
  pr.user += sourceText;
  const out = await AI.askJson({ ...pr, maxTokens: 4000, tag: 'cv_generate' });
  if (!out.ok || !out.data) {
    return { ok: false, error: out.error || 'A IA não conseguiu gerar o currículo agora.', doc: publicDoc(doc) };
  }

  const data = out.data || {};
  const candidate = normalizeProfile(data.profile || {});
  const guarded = guardNoFabrication(candidate, doc.profile);
  const merged = mergeProfile(doc.profile, guarded.profile);
  doc.profile = merged;
  doc.removedFabrication = [...(doc.removedFabrication || []), ...guarded.removed];
  doc.sectionOrder = Array.isArray(data.sectionOrder) && data.sectionOrder.length
    ? data.sectionOrder.filter(x => SECTION_DEFS.some(d => d.id === x))
    : resolveSectionOrder(doc.profile, doc.templateId);
  if (data.templateId && TEMPLATES.some(t => t.id === data.templateId) && !templateId) doc.templateId = data.templateId;
  doc.suggestions = {
    highlights: Array.isArray(data.highlights) ? data.highlights.map(String).slice(0, 10) : [],
    missingInfo: Array.isArray(data.missingInfo) ? data.missingInfo.map(String).slice(0, 10) : [],
    recommendations: Array.isArray(data.recommendations) ? data.recommendations.map(String).slice(0, 10) : [],
  };
  doc.status = 'gerado';
  doc.aiMeta = { lastProvider: out.provider || null, lastModel: out.model || null, lastAt: nowIso(), lastOp: 'gerar' };
  const v = saveVersion(doc, 'ia', 'Versão gerada pela IA');
  await state.save(doc);

  return {
    ok: true, doc: publicDoc(doc), version: { id: v.id, createdAt: v.createdAt, source: v.source },
    aiUsed: true, removed: guarded.removed, suggestions: doc.suggestions,
  };
}

/* ---------------- Análise (ATS + nota + leitura qualitativa) ---------------- */
export async function analyze(id, owner, { jobDescription = null, withAI = true } = {}) {
  const r = owned(id, owner);
  if (!r.ok) return r;
  const doc = r.doc;
  const jobDesc = jobDescription !== null ? s(jobDescription) : (doc.targetJob?.description || '');

  const ats = atsReport(doc.profile, jobDesc, doc.areaId);
  const score = scoreResume(doc.profile, jobDesc, doc.areaId);
  const missing = missingFields(doc.profile);

  let qualitative = null;
  let aiUsed = false;
  if (withAI && AI.available()) {
    const pr = buildAnalysisPrompt({ profile: doc.profile, areaId: doc.areaId, targetJob: { description: jobDesc }, ats });
    const out = await AI.askJson({ ...pr, maxTokens: 1800, tag: 'cv_analyze' });
    if (out.ok && out.data) {
      qualitative = {
        pontosFortes: Array.isArray(out.data.pontosFortes) ? out.data.pontosFortes.map(String).slice(0, 8) : [],
        lacunas: Array.isArray(out.data.lacunas) ? out.data.lacunas.map(String).slice(0, 8) : [],
        sugestoes: Array.isArray(out.data.sugestoes) ? out.data.sugestoes.map(String).slice(0, 8) : [],
        leituraRecrutador: s(out.data.leituraRecrutador),
      };
      aiUsed = true;
      doc.aiMeta = { lastProvider: out.provider || null, lastModel: out.model || null, lastAt: nowIso(), lastOp: 'analise' };
    }
  }

  const analysis = {
    at: nowIso(),
    total: score.total,
    dimensions: score.dimensions,
    improvements: score.improvements,
    ats,
    missing,
    qualitative,
    aiUsed,
    aiError: aiUsed ? null : AI.lastError(),
    disclaimer: score.disclaimer,
  };
  doc.lastAnalysis = analysis;
  doc.status = doc.status === 'entrevista' ? 'rascunho' : doc.status;
  await state.save(doc);
  return { ok: true, analysis, doc: publicDoc(doc) };
}

/* ---------------- Adaptar para uma vaga ---------------- */
export async function tailor(id, owner, { title = '', company = '', description = '' } = {}) {
  const r = owned(id, owner);
  if (!r.ok) return r;
  const doc = r.doc;
  const desc = s(description);
  if (!desc) return { ok: false, error: 'Cole a descrição da vaga para adaptar o currículo.' };

  doc.targetJob = { title: s(title), company: s(company), description: desc };
  const keywords = extractKeywords(desc);

  let aiUsed = false;
  let suggestions = null;
  if (AI.available()) {
    const pr = buildGeneratePrompt({ profile: doc.profile, areaId: doc.areaId, targetJob: doc.targetJob, templateId: doc.templateId });
    const out = await AI.askJson({ ...pr, maxTokens: 4000, tag: 'cv_tailor' });
    if (out.ok && out.data) {
      const candidate = normalizeProfile(out.data.profile || {});
      const guarded = guardNoFabrication(candidate, doc.profile);
      doc.profile = mergeProfile(doc.profile, guarded.profile);
      doc.removedFabrication = [...(doc.removedFabrication || []), ...guarded.removed];
      suggestions = {
        highlights: Array.isArray(out.data.highlights) ? out.data.highlights.map(String).slice(0, 10) : [],
        missingInfo: Array.isArray(out.data.missingInfo) ? out.data.missingInfo.map(String).slice(0, 10) : [],
        recommendations: Array.isArray(out.data.recommendations) ? out.data.recommendations.map(String).slice(0, 10) : [],
      };
      aiUsed = true;
      doc.aiMeta = { lastProvider: out.provider || null, lastModel: out.model || null, lastAt: nowIso(), lastOp: 'adaptar' };
    }
  }

  const ats = atsReport(doc.profile, desc, doc.areaId);
  const score = scoreResume(doc.profile, desc, doc.areaId);
  doc.lastAnalysis = {
    at: nowIso(), total: score.total, dimensions: score.dimensions, improvements: score.improvements,
    ats, missing: missingFields(doc.profile), qualitative: null, aiUsed,
    aiError: aiUsed ? null : AI.lastError(), disclaimer: score.disclaimer, forJob: doc.targetJob.title || null,
  };
  doc.sectionOrder = resolveSectionOrder(doc.profile, doc.templateId);
  doc.status = 'adaptado';
  const v = saveVersion(doc, aiUsed ? 'ia' : 'manual', `Adaptação para vaga${doc.targetJob.title ? ': ' + doc.targetJob.title : ''}`);
  await state.save(doc);

  return {
    ok: true, doc: publicDoc(doc), analysis: doc.lastAnalysis, keywords,
    suggestions, aiUsed, aiError: aiUsed ? null : AI.lastError(),
    version: { id: v.id, createdAt: v.createdAt, source: v.source },
  };
}

/* ---------------- Edição por conversa ---------------- */
export async function chat(id, owner, { message = '' } = {}) {
  const r = owned(id, owner);
  if (!r.ok) return r;
  const doc = r.doc;
  const msg = s(message);
  if (!msg) return { ok: false, error: 'Escreva o que você quer alterar.' };
  if (!AI.available()) {
    return { ok: false, error: 'A IA não está configurada, então não consigo aplicar alterações por conversa. Edite os campos manualmente.', doc: publicDoc(doc) };
  }
  const before = doc.profile;
  const pr = buildEditPrompt({ profile: doc.profile, message: msg });
  const out = await AI.askJson({ ...pr, maxTokens: 4000, tag: 'cv_edit' });
  if (!out.ok || !out.data) return { ok: false, error: out.error || 'A IA não conseguiu aplicar a alteração.', doc: publicDoc(doc) };

  const candidate = normalizeProfile(out.data.profile || {});
  const guarded = guardNoFabrication(candidate, before);
  doc.profile = mergeProfile(doc.profile, guarded.profile);
  doc.removedFabrication = [...(doc.removedFabrication || []), ...guarded.removed];
  doc.sectionOrder = resolveSectionOrder(doc.profile, doc.templateId);
  doc.aiMeta = { lastProvider: out.provider || null, lastModel: out.model || null, lastAt: nowIso(), lastOp: 'edicao' };
  if (out.data.changed !== false) saveVersion(doc, 'ia', 'Alteração por conversa');
  await state.save(doc);
  return { ok: true, doc: publicDoc(doc), reply: s(out.data.reply) || 'Alteração aplicada.', removed: guarded.removed };
}

/* ---------------- Pré-visualização / download / versões ---------------- */
export async function preview(id, owner, { templateId = null } = {}) {
  const r = owned(id, owner);
  if (!r.ok) return r;
  const doc = r.doc;
  const { renderHtml } = await import('./render.js');
  const html = renderHtml(doc.profile, {
    templateId: templateId || doc.templateId,
    sectionOrder: doc.sectionOrder,
  });
  return { ok: true, html, templateId: templateId || doc.templateId };
}

export async function restoreVersion(id, owner, versionId) {
  const r = owned(id, owner);
  if (!r.ok) return r;
  const doc = r.doc;
  const v = (doc.versions || []).find(x => x.id === String(versionId));
  if (!v) return { ok: false, error: 'Versão não encontrada.' };
  saveVersion(doc, 'manual', 'Antes de restaurar versão anterior');
  doc.profile = normalizeProfile(v.profile);
  doc.sectionOrder = resolveSectionOrder(doc.profile, doc.templateId);
  await state.save(doc);
  return { ok: true, doc: publicDoc(doc) };
}

export async function download(id, owner, { format = 'pdf', templateId = null, versionId = null } = {}) {
  const r = owned(id, owner);
  if (!r.ok) return r;
  const doc = r.doc;
  let profile = doc.profile;
  if (versionId) {
    const v = (doc.versions || []).find(x => x.id === String(versionId));
    if (!v) return { ok: false, error: 'Versão não encontrada.' };
    profile = v.profile;
  }
  const fmt = String(format || 'pdf').toLowerCase();
  const tplId = templateId || doc.templateId;
  const { renderHtml, htmlToPdf } = await import('./render.js');
  const html = renderHtml(profile, { templateId: tplId, sectionOrder: doc.sectionOrder });
  const base = slugFile(profile.fullName ? `${profile.fullName}_${tplId}` : doc.title);

  if (fmt === 'docx') {
    const { buildBlocks } = await import('./render.js');
    const { buildDocx } = await import('./docx.js');
    const blocks = buildBlocks(profile, { templateId: tplId, sectionOrder: doc.sectionOrder });
    const docxBlocks = blocks.map(b => ({ type: b.type === 'subtitle' ? 'p' : (b.type === 'meta' ? 'p' : b.type), text: b.text }));
    const buf = buildDocx(docxBlocks, { title: doc.title });
    return { ok: true, buffer: buf, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: `${base}.docx` };
  }
  if (fmt === 'html') {
    return { ok: true, buffer: Buffer.from(html, 'utf8'), contentType: 'text/html; charset=utf-8', filename: `${base}.html` };
  }
  const pdf = await htmlToPdf(html);
  if (!pdf.ok) return { ok: false, error: pdf.error };
  return { ok: true, buffer: pdf.buffer, contentType: 'application/pdf', filename: `${base}.pdf` };
}

export function summary(owner) {
  const items = state.list(owner);
  const withScore = items.filter(i => typeof i.lastScore === 'number');
  const avg = withScore.length ? Math.round(withScore.reduce((a, b) => a + b.lastScore, 0) / withScore.length) : null;
  return { ok: true, total: items.length, avgScore: avg, items };
}

export default {
  MODULE_VERSION, init, status, areas, create, list, get, update, remove,
  interview, importOriginal, generate, analyze, tailor, chat,
  preview, restoreVersion, download, summary,
  // reexports úteis para testes
  _internal: { mergeProfile, deterministicSummary, normalizeProfile, guardNoFabrication },
};

export { AREAS };

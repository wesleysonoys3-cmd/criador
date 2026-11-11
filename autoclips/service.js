/* =========================================================
 * autoclips/service.js — Orquestração do AutoClips AI
 * ---------------------------------------------------------
 * Fluxo completo (PARTE 7):
 *   7.1 Entrada de vídeos (fontes locais/URL + transcrição)
 *   7.2 Verificação de direitos (bloqueia sem autorização)
 *   7.3 Análise inteligente (determinística, explicável)
 *   7.4 Perfis de edição
 *   7.5 Edição automática (plano de edição auditável)
 *   7.6 Metadados (título, descrição, tags, capítulos)
 *   7.7 Controle de qualidade
 *   7.8 Fila/processamento com retomada
 *
 * O render real depende do ffmpeg: quando ausente, é sinalizado de
 * forma honesta (sem botão falso). Registra o realizado na Memória
 * Inteligente (Módulo 4), quando disponível.
 * =======================================================*/
import fs from 'node:fs/promises';
import path from 'node:path';
import state, { newJobId, normalizeOwner, SCHEMA } from './state.js';
import { evaluate as evaluateRights, canProcess, canPublish, emptyRights, RIGHT_LABELS } from './rights.js';
import { listProfiles, normalizeProfile, profileByKey } from './profiles.js';
import { analyze as runAnalysis } from './analysis.js';
import { buildPlan } from './editor.js';
import { buildMetadata } from './metadata.js';
import { runQA } from './qa.js';
import { detectFfmpeg, renderPlan, probeDuration, ffmpegStatus } from './render.js';
import queue, { MAX_ATTEMPTS } from './queue.js';

const _log = (...a) => console.log('[AUTOCLIPS][service]', ...a);

export const JOB_STATUS = [
  'rascunho', 'bloqueado', 'pronto', 'processando', 'analisado', 'editado',
  'revisao', 'concluido', 'aguardando_render', 'renderizado', 'erro',
];

export const STAGES = ['direitos', 'analise', 'edicao', 'metadados', 'qa', 'render'];
const STAGE_LABELS = {
  direitos: 'Verificação de direitos',
  analise: 'Análise inteligente',
  edicao: 'Edição automática',
  metadados: 'Geração de metadados',
  qa: 'Controle de qualidade',
  render: 'Render',
};

let _initialized = false;
let _memorySvc = null;
const OUT_ROOT = path.resolve(process.cwd(), 'autoclips/out');

function nowIso() { return new Date().toISOString(); }
function outDirFor(id) { return path.join(OUT_ROOT, String(id).replace(/[^a-zA-Z0-9_.-]/g, '_')); }

function getOwned(id, owner) {
  const rec = state.get(id);
  if (!rec) return null;
  if (owner && normalizeOwner(owner) !== normalizeOwner(rec.owner)) return null;
  return rec;
}

function logStep(rec, stage, message) {
  rec.log = rec.log || [];
  rec.log.push({ at: nowIso(), stage, message });
  if (rec.log.length > 100) rec.log = rec.log.slice(-100);
}

function setProgress(rec, progress, stage) {
  rec.progress = Math.max(0, Math.min(100, Math.round(progress)));
  if (stage) { rec.stage = stage; rec.stageLabel = STAGE_LABELS[stage] || stage; }
}

/* ---------------- Inicialização ---------------- */
export function init({ dataDir = null, memorySvc = null } = {}) {
  state.setDataDir(dataDir || path.resolve(process.cwd(), 'autoclips/data'));
  if (memorySvc && typeof memorySvc.register === 'function') _memorySvc = memorySvc;

  queue.init({ runner: runJob, dirFor: outDirFor });
  queue.onChange((st) => { /* observável; a UI consulta /api/autoclips/status */ });

  if (!_initialized) {
    _initialized = true;
    state.loadAll().then(() => {
      // 7.8 Retomada: tarefas que ficaram "processando" voltam para a fila.
      const stuck = state.all().filter((r) => r.status === 'processando').map((r) => r.id);
      if (stuck.length) queue.resume(stuck);
      _log('init: dataDir=' + state.dataDir + ' · tarefas=' + state.jobs.size + ' · retomadas=' + stuck.length);
    }).catch((e) => _log('loadAll erro: ' + String((e && e.message) || e)));
    // Detecção de ffmpeg (assíncrona; não bloqueia o boot).
    detectFfmpeg().catch(() => { /* ok */ });
  }
  return { ok: true, dataDir: state.dataDir, jobs: state.jobs.size, profiles: listProfiles().length };
}

/* ---------------- Resumo exposto à interface ---------------- */
function summary(rec) {
  const rights = rec.rights || null;
  return {
    id: rec.id,
    title: rec.title,
    status: rec.status,
    statusLabel: statusLabel(rec.status),
    progress: rec.progress || 0,
    stage: rec.stage || null,
    stageLabel: rec.stageLabel || null,
    sourcesCount: (rec.sources || []).length,
    profileKey: (rec.profile && rec.profile.key) || rec.profileKey || null,
    profileLabel: (rec.profile && rec.profile.label) || null,
    rights: rights ? { status: rights.status, canProcess: !!rights.canProcess, canPublish: !!rights.canPublish } : null,
    analysis: rec.analysis ? { moments: (rec.analysis.moments || []).length, averageScore: rec.analysis.averageScore } : null,
    plan: rec.plan ? { cutsCount: rec.plan.cutsCount, totalDuration: rec.plan.totalDuration, aspect: rec.plan.aspect, averageScore: rec.plan.averageScore } : null,
    metadata: rec.metadata ? { title: rec.metadata.title, tags: (rec.metadata.tags || []).length, chapters: (rec.metadata.chapters || []).length } : null,
    qa: rec.qa ? { ok: !!rec.qa.ok, score: rec.qa.score, failed: rec.qa.failed } : null,
    render: rec.render ? { state: rec.render.state, code: rec.render.code, pending: !!rec.render.pending } : null,
    attempts: rec.attempts || 0,
    queued: queue.isQueued(rec.id),
    error: rec.error || null,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    memoryId: rec.memoryId || null,
  };
}

function statusLabel(s) {
  const map = {
    rascunho: 'Rascunho', bloqueado: 'Bloqueado por direitos', pronto: 'Pronto para processar',
    processando: 'Processando', analisado: 'Analisado', editado: 'Editado', revisao: 'Em revisão',
    concluido: 'Concluído', aguardando_render: 'Aguardando render (ffmpeg)', renderizado: 'Renderizado',
    erro: 'Erro',
  };
  return map[s] || s;
}

/* ---------------- Status / catálogo ---------------- */
export function status() {
  const byStatus = {}; for (const s of JOB_STATUS) byStatus[s] = 0;
  for (const r of state.all()) if (byStatus[r.status] !== undefined) byStatus[r.status]++;
  const ff = ffmpegStatus();
  return {
    ok: true,
    dataDir: state.dataDir,
    total: state.jobs.size,
    byStatus,
    statuses: JOB_STATUS.slice(),
    stages: STAGES.map((s) => ({ key: s, label: STAGE_LABELS[s] })),
    profiles: listProfiles(),
    queue: queue.status(),
    ffmpeg: ff ? { available: ff.available, ffmpeg: ff.ffmpeg, ffprobe: ff.ffprobe, installHint: ff.installHint } : { available: null, pending: true },
    memory: !!_memorySvc,
    renderNote: 'O render real usa o ffmpeg. Sem ele, o plano de edição fica pronto e o render é sinalizado como pendente.',
  };
}

export function profiles() { return { ok: true, profiles: listProfiles() }; }

export function list(owner = null) {
  return {
    ok: true,
    items: state.list(owner).map(summary)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))),
  };
}

export function get(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  return {
    ok: true,
    job: summary(rec),
    rights: rec.rights || null,
    profile: rec.profile || null,
    transcript: (rec.transcript || []).slice(0, 400),
    analysis: rec.analysis || null,
    plan: rec.plan || null,
    metadata: rec.metadata || null,
    qa: rec.qa || null,
    render: rec.render || null,
    log: (rec.log || []).slice(-40),
  };
}

/* ---------------- 7.1 Entrada de vídeos ---------------- */
export async function create(input = {}, owner = null) {
  const title = String(input.title || input.name || '').trim().slice(0, 120);
  if (!title) return { ok: false, reason: 'Informe um título para a tarefa.' };

  const sources = normalizeSources(input.sources);
  const transcript = normalizeTranscript(input.transcript || input.segments);
  const prof = normalizeProfile(input.profile || input.profileKey || {});

  const rec = {
    id: newJobId(),
    schema: SCHEMA,
    owner: normalizeOwner(owner),
    title,
    description: String(input.description || '').slice(0, 600),
    sources,
    transcript,
    profileKey: prof.key,
    profile: prof,
    rights: null,
    analysis: null,
    plan: null,
    metadata: null,
    qa: null,
    render: null,
    status: 'rascunho',
    progress: 0,
    stage: null,
    stageLabel: null,
    attempts: 0,
    errors: [],
    log: [],
    memoryId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  logStep(rec, 'criacao', 'Tarefa criada com ' + sources.length + ' fonte(s) e ' + transcript.length + ' segmento(s).');

  // Já avalia os direitos a partir do que foi informado (se houver).
  if (input.rights) rec.rights = evaluateRights(input.rights);
  applyRightsStatus(rec);

  await state.save(rec);
  rec.memoryId = registerMemory(rec, owner);
  if (rec.memoryId) await state.save(rec);

  _log('create: ' + rec.id + ' · ' + title);
  return { ok: true, job: summary(rec), profile: rec.profile };
}

function normalizeSources(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  for (const raw of arr) {
    if (!raw) continue;
    if (typeof raw === 'string') { out.push({ kind: 'referencia', value: raw.trim(), label: raw.trim().slice(0, 120) }); continue; }
    const kind = ['local', 'url', 'referencia'].includes(String(raw.kind)) ? String(raw.kind) : 'referencia';
    const value = String(raw.value || raw.path || raw.url || '').trim();
    if (!value) continue;
    out.push({
      kind,
      value,
      label: String(raw.label || path.basename(value) || value).slice(0, 120),
      duration: Number.isFinite(Number(raw.duration)) ? Number(raw.duration) : null,
    });
  }
  return out.slice(0, 20);
}

function normalizeTranscript(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  for (const raw of arr) {
    if (!raw) continue;
    const start = Number(raw.start);
    let end = Number(raw.end);
    if (!Number.isFinite(start)) continue;
    if (!Number.isFinite(end) || end <= start) end = start + 5;
    out.push({
      start, end,
      text: String(raw.text || raw.content || '').trim(),
      speaker: String(raw.speaker || '').trim(),
      energy: Number.isFinite(Number(raw.energy)) ? Math.max(0, Math.min(1, Number(raw.energy))) : null,
    });
  }
  return out.sort((a, b) => a.start - b.start).slice(0, 5000);
}

/* ---------------- 7.2 Verificação de direitos ---------------- */
function applyRightsStatus(rec) {
  const r = rec.rights;
  if (!r) { rec.status = rec.status === 'erro' ? 'erro' : 'rascunho'; return; }
  if (!r.canProcess) { rec.status = 'bloqueado'; return; }
  if (['rascunho', 'bloqueado'].includes(rec.status)) rec.status = 'pronto';
}

export async function setRights(id, input = {}, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  const src = (input && typeof input === 'object') ? input : {};
  const verify = (src.rights && typeof src.rights === 'object')
    ? src
    : { rights: src, evidence: src.evidence, source: src.source, responsible: src.responsible, notes: src.notes };
  rec.rights = evaluateRights(verify);
  applyRightsStatus(rec);
  logStep(rec, 'direitos', 'Direitos avaliados: ' + rec.rights.status + (rec.rights.canProcess ? ' (pode processar)' : ' (bloqueado para processar)'));
  rec.updatedAt = nowIso();
  await state.save(rec);
  const cp = canProcess(rec.rights);
  return {
    ok: true,
    rights: rec.rights,
    canProcess: cp.ok,
    blockedReason: cp.ok ? null : cp.message,
    job: summary(rec),
  };
}

/* ---------------- 7.3 Análise inteligente ---------------- */
export async function analyze(id, input = {}, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };

  const cp = canProcess(rec.rights);
  if (!cp.ok) return { ok: false, code: 'direitos_insuficientes', reason: cp.message };

  let segments = normalizeTranscript(input.transcript || input.segments);
  if (!segments.length) segments = rec.transcript || [];
  if (!segments.length) {
    return { ok: false, code: 'transcricao_ausente', reason: 'Sem transcrição. Envie os segmentos (início, fim e texto) para a análise.' };
  }
  rec.transcript = segments;

  const prof = input.profile || input.profileKey ? normalizeProfile(Object.assign({}, rec.profile, input.profile || {}, input.profileKey ? { key: input.profileKey } : {})) : rec.profile;
  rec.profile = prof;
  rec.profileKey = prof.key;

  const res = runAnalysis({ segments, profile: prof });
  if (res.ok === false) return res;
  rec.analysis = res.result;
  rec.status = 'analisado';
  setProgress(rec, 40, 'analise');
  logStep(rec, 'analise', res.result.moments.length + ' momento(s) encontrado(s), média ' + res.result.averageScore + '.');
  rec.updatedAt = nowIso();
  await state.save(rec);
  return { ok: true, analysis: rec.analysis, job: summary(rec) };
}

/* ---------------- 7.4/7.5 Edição automática ---------------- */
export async function edit(id, input = {}, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };

  const cp = canProcess(rec.rights);
  if (!cp.ok) return { ok: false, code: 'direitos_insuficientes', reason: cp.message };

  if (!rec.analysis || !(rec.analysis.moments || []).length) {
    const a = await analyze(id, input, owner);
    if (a.ok === false) return a;
  }

  if (input.profile || input.profileKey) {
    rec.profile = normalizeProfile(Object.assign({}, rec.profile, input.profile || {}, input.profileKey ? { key: input.profileKey } : {}));
    rec.profileKey = rec.profile.key;
  }

  const res = buildPlan({
    moments: rec.analysis.moments,
    segments: rec.transcript,
    profile: rec.profile,
    options: { order: input.order },
  });
  if (res.ok === false) return res;
  rec.plan = res.plan;
  rec.status = 'editado';
  setProgress(rec, 60, 'edicao');
  logStep(rec, 'edicao', res.plan.cuts.length + ' corte(s) no plano · ' + res.plan.totalDuration + 's.');
  rec.updatedAt = nowIso();
  await state.save(rec);
  return { ok: true, plan: rec.plan, job: summary(rec) };
}

/* ---------------- 7.6 Metadados ---------------- */
export async function buildMetadataForJob(id, input = {}, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  if (!rec.plan) return { ok: false, code: 'plano_ausente', reason: 'Gere o plano de edição antes dos metadados.' };

  const res = buildMetadata({ plan: rec.plan, job: rec, profile: rec.profile, options: input });
  if (res.ok === false) return res;
  rec.metadata = res.metadata;
  setProgress(rec, 75, 'metadados');
  logStep(rec, 'metadados', 'Metadados gerados: "' + res.metadata.title + '".');
  rec.updatedAt = nowIso();
  await state.save(rec);
  return { ok: true, metadata: rec.metadata, job: summary(rec) };
}

/* ---------------- 7.7 Controle de qualidade ---------------- */
export async function qualityCheck(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  if (!rec.plan) return { ok: false, code: 'plano_ausente', reason: 'Gere o plano de edição antes do controle de qualidade.' };

  const media = mediaInfo(rec);
  const res = runQA({ job: rec, plan: rec.plan, metadata: rec.metadata, profile: rec.profile, media });
  rec.qa = res;
  if (res.ok) {
    if (rec.status !== 'concluido' && rec.status !== 'renderizado') rec.status = 'concluido';
  } else {
    rec.status = 'revisao';
  }
  setProgress(rec, 90, 'qa');
  logStep(rec, 'qa', res.passed + '/' + res.checks.length + ' verificações aprovadas (nota ' + res.score + ').');
  rec.updatedAt = nowIso();
  await state.save(rec);
  if (res.ok && rec.memoryId) validateMemory(rec, owner);
  return { ok: true, qa: res, job: summary(rec) };
}

function mediaInfo(rec) {
  const s = (rec.sources || []).find((x) => Number.isFinite(x.duration));
  return s ? { duration: s.duration } : null;
}

/* ---------------- 7.8 Processamento completo (fila) ---------------- */
export async function startJob(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };

  const cp = canProcess(rec.rights);
  if (!cp.ok) {
    rec.status = 'bloqueado';
    rec.updatedAt = nowIso();
    await state.save(rec);
    return { ok: false, code: 'direitos_insuficientes', reason: cp.message };
  }
  if (!(rec.transcript || []).length) {
    return { ok: false, code: 'transcricao_ausente', reason: 'Sem transcrição. Envie os segmentos para processar.' };
  }

  rec.status = 'processando';
  rec.progress = 0;
  rec.attempts = 0;
  rec.error = null;
  rec.updatedAt = nowIso();
  logStep(rec, 'fila', 'Tarefa enviada para a fila.');
  await state.save(rec);

  queue.enqueue(rec.id);
  return { ok: true, queued: true, job: summary(rec), queue: queue.status() };
}

/* Executor chamado pela fila — roda o pipeline inteiro. */
async function runJob(jobId) {
  const rec = state.get(jobId);
  if (!rec) return;
  try {
    rec.status = 'processando';
    rec.attempts = (rec.attempts || 0) + 1;
    setProgress(rec, 10, 'direitos');
    logStep(rec, 'direitos', 'Conferindo direitos...');
    const cp = canProcess(rec.rights);
    if (!cp.ok) {
      rec.status = 'bloqueado';
      logStep(rec, 'direitos', 'BLOQUEADO: ' + cp.message);
      await state.save(rec);
      return;
    }
    setProgress(rec, 20, 'direitos');

    // 7.3 Análise
    setProgress(rec, 25, 'analise');
    const a = runAnalysis({ segments: rec.transcript, profile: rec.profile });
    if (a.ok === false) throw new Error(a.reason);
    rec.analysis = a.result;
    setProgress(rec, 40, 'analise');
    logStep(rec, 'analise', a.result.moments.length + ' momento(s).');

    // 7.5 Edição
    setProgress(rec, 45, 'edicao');
    const p = buildPlan({ moments: rec.analysis.moments, segments: rec.transcript, profile: rec.profile });
    if (p.ok === false) {
      // Sem momentos é determinístico (não é falha transitória): encerra em revisão.
      rec.status = 'revisao';
      rec.error = null;
      setProgress(rec, 100, null);
      logStep(rec, 'edicao', 'Sem cortes: ' + p.reason);
      rec.updatedAt = nowIso();
      await state.save(rec);
      _log('runJob: ' + rec.id + ' → revisao (sem momentos)');
      return;
    }
    rec.plan = p.plan;
    setProgress(rec, 60, 'edicao');
    logStep(rec, 'edicao', p.plan.cuts.length + ' corte(s).');

    // 7.6 Metadados
    setProgress(rec, 70, 'metadados');
    const m = buildMetadata({ plan: rec.plan, job: rec, profile: rec.profile });
    if (m.ok === false) throw new Error(m.reason);
    rec.metadata = m.metadata;
    setProgress(rec, 78, 'metadados');

    // 7.7 QA
    setProgress(rec, 85, 'qa');
    const qa = runQA({ job: rec, plan: rec.plan, metadata: rec.metadata, profile: rec.profile, media: mediaInfo(rec) });
    rec.qa = qa;
    setProgress(rec, 92, 'qa');
    logStep(rec, 'qa', qa.passed + '/' + qa.checks.length + ' verificações.');

    // 7.8 Render (honesto: sem ffmpeg fica pendente)
    setProgress(rec, 95, 'render');
    const sourcePath = (rec.sources.find((s) => s.kind === 'local') || {}).value || null;
    const r = await renderPlan({ plan: rec.plan, inputPath: sourcePath, outputDir: outDirFor(rec.id) });
    rec.render = r.ok
      ? { state: 'renderizado', at: nowIso() }
      : { state: r.pending ? 'pendente' : 'erro', code: r.code, reason: r.reason, hint: r.hint || null, commands: r.commands || [], at: nowIso() };
    logStep(rec, 'render', r.reason || 'Render concluído.');

    rec.status = qa.ok ? (r.ok ? 'renderizado' : 'concluido') : 'revisao';
    setProgress(rec, 100, null);
    rec.error = null;
    rec.updatedAt = nowIso();
    await state.save(rec);

    if (qa.ok) { validateMemory(rec, null); registerTaskMemory(rec, null, 'Produção automática concluída'); }
    _log('runJob: ' + rec.id + ' → ' + rec.status);
  } catch (e) {
    const msg = String((e && e.message) || e);
    rec.errors = rec.errors || [];
    rec.errors.push({ at: nowIso(), message: msg });
    if ((rec.attempts || 0) < MAX_ATTEMPTS) {
      rec.status = 'processando';
      logStep(rec, 'erro', 'Falha (tentativa ' + rec.attempts + '/' + MAX_ATTEMPTS + '): ' + msg + ' — será reprocessado.');
      await state.save(rec);
      queue.requeue(rec.id); // nova tentativa (o job ainda é "current"; requeue evita no-op)
    } else {
      rec.status = 'erro';
      rec.error = msg;
      setProgress(rec, 100, null);
      logStep(rec, 'erro', 'Falha definitiva após ' + rec.attempts + ' tentativa(s): ' + msg);
      await state.save(rec);
    }
  }
}

export function cancel(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  const r = queue.cancel(rec.id);
  if (r.ok) { rec.status = 'pronto'; rec.updatedAt = nowIso(); state.save(rec).catch(() => {}); }
  return r;
}

/* ---------------- Relatório final ---------------- */
export async function report(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  const pub = canPublish(rec.rights);
  return {
    ok: true,
    report: {
      job: summary(rec),
      rights: rec.rights,
      canPublish: pub.ok,
      publishBlockedReason: pub.ok ? null : pub.message,
      analysis: rec.analysis,
      plan: rec.plan,
      metadata: rec.metadata,
      qa: rec.qa,
      render: rec.render,
      log: (rec.log || []).slice(-30),
      generatedAt: nowIso(),
    },
  };
}

/* ---------------- Remoção ---------------- */
export async function remove(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  queue.cancel(rec.id);
  await state.remove(rec.id);
  try { await fs.rm(outDirFor(rec.id), { recursive: true, force: true }); } catch { /* ok */ }
  return { ok: true, removed: rec.id };
}

/* ---------------- Integração com a Memória (Módulo 4) ---------------- */
function memoryContent(rec) {
  const lines = [
    'Produção automática de vídeo (AutoClips AI).',
    'Tarefa: ' + rec.title,
    'Perfil de edição: ' + (rec.profile ? rec.profile.label + ' (' + rec.profile.key + ')' : '—'),
    'Fontes: ' + (rec.sources || []).map((s) => s.kind + ':' + s.label).join(', '),
    'Direitos: ' + (rec.rights ? rec.rights.status : 'não avaliados'),
  ];
  if (rec.plan) lines.push('Cortes: ' + rec.plan.cutsCount + ' · duração total ' + rec.plan.totalDuration + 's · ' + rec.plan.aspect);
  if (rec.metadata) lines.push('Título sugerido: ' + rec.metadata.title);
  if (rec.qa) lines.push('Controle de qualidade: ' + rec.qa.passed + '/' + rec.qa.checks.length + ' (nota ' + rec.qa.score + ')');
  if (rec.render) lines.push('Render: ' + rec.render.state + (rec.render.code ? ' (' + rec.render.code + ')' : ''));
  return lines.join('\n');
}

function registerMemory(rec, owner) {
  if (!_memorySvc || typeof _memorySvc.register !== 'function') return null;
  try {
    const r = _memorySvc.register({
      kind: 'projeto',
      category: 'projetos',
      title: 'Vídeo (AutoClips): ' + rec.title,
      summary: 'Produção automática com perfil ' + (rec.profile ? rec.profile.label : '—') + '.',
      content: memoryContent(rec),
      tags: ['autoclips', 'video', rec.profile ? rec.profile.key : 'personalizado'],
      technologies: ['ffmpeg', 'AutoClips'],
      project: rec.id,
      status: 'Pendente',
      source: { origin: 'autoclips' },
    }, owner);
    return (r && r.record && r.record.id) || (r && r.id) || null;
  } catch (e) { _log('registerMemory erro: ' + String((e && e.message) || e)); return null; }
}

function validateMemory(rec, owner) {
  if (!_memorySvc || typeof _memorySvc.validate !== 'function' || !rec.memoryId) return;
  try {
    _memorySvc.validate(rec.memoryId, {
      status: 'Confirmado',
      note: 'Controle de qualidade aprovado (nota ' + (rec.qa ? rec.qa.score : 0) + ').',
      evidence: (rec.qa ? rec.qa.checks : []).map((c) => (c.ok ? 'OK ' : 'FALHA ') + c.name).join('; '),
    }, owner);
  } catch { /* acessório */ }
}

function registerTaskMemory(rec, owner, what) {
  if (!_memorySvc || typeof _memorySvc.registerTask !== 'function') return;
  try {
    _memorySvc.registerTask({
      title: 'AutoClips: ' + what + ' — ' + rec.title,
      summary: what + ' para a tarefa ' + rec.id + '.',
      project: rec.id,
      tags: ['autoclips', what],
      task: { objective: what, result: rec.plan ? (rec.plan.cutsCount + ' corte(s)') : '—' },
    }, owner);
  } catch { /* acessório */ }
}

export { probeDuration, detectFfmpeg, outDirFor, RIGHT_LABELS };

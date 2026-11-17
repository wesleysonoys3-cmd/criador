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
import { listProfiles, normalizeProfile, profileByKey, ASPECTS } from './profiles.js';
import { analyze as runAnalysis } from './analysis.js';
import { buildPlan, buildCaptions } from './editor.js';
import { buildMetadata } from './metadata.js';
import { runQA } from './qa.js';
import { detectFfmpeg, renderPlan, probeDuration, ffmpegStatus } from './render.js';
import { downloadVideo, detectYtDlp } from './download.js';
import { transcribeVideo } from './transcribe.js';
import queue, { MAX_ATTEMPTS } from './queue.js';
import { fetchVideoInfo } from './url_info.js';
import { buildCovers, dimensionsFor } from './covers.js';
import * as music from './music.js';
import { catalog as captionCatalog, normalizeCaptions, defaultCaptions, buildSrt, forceStyle, describe as describeCaptions } from './captions.js';

const _log = (...a) => console.log('[AUTOCLIPS][service]', ...a);

export const JOB_STATUS = [
  'rascunho', 'bloqueado', 'pronto', 'processando', 'analisado', 'editado',
  'revisao', 'concluido', 'aguardando_render', 'renderizado', 'erro',
];

export const STAGES = ['direitos', 'analise', 'edicao', 'metadados', 'qa', 'render'];
const STAGE_LABELS = {
  direitos: 'Verificação de direitos',
  entrada: 'Vídeo de origem (download)',
  transcricao: 'Transcrição automática',
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
  music.init({ dataDir: state.dataDir });
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
    source: rec.sourceInfo
      ? { provider: rec.sourceInfo.provider || null, title: rec.sourceInfo.title || null, thumbnail: rec.sourceInfo.thumbnail || null, author: rec.sourceInfo.author || null, duration: rec.sourceInfo.duration || null }
      : null,
    url: (rec.sources || []).filter((s) => s.kind === 'url').map((s) => s.value)[0] || null,
    analysis: rec.analysis ? { moments: (rec.analysis.moments || []).length, averageScore: rec.analysis.averageScore } : null,
    plan: rec.plan ? { cutsCount: rec.plan.cutsCount, totalDuration: rec.plan.totalDuration, aspect: rec.plan.aspect, averageScore: rec.plan.averageScore } : null,
    metadata: rec.metadata ? { title: rec.metadata.title, tags: (rec.metadata.tags || []).length, chapters: (rec.metadata.chapters || []).length } : null,
    qa: rec.qa ? { ok: !!rec.qa.ok, score: rec.qa.score, failed: rec.qa.failed } : null,
    render: rec.render ? { state: rec.render.state, code: rec.render.code, pending: !!rec.render.pending, outputs: (rec.render.outputs || []).length, folder: rec.render.folder || null } : null,
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

/* ---------------- Revisão dos cortes (Meus cortes) ---------------- */
export const CUT_STATES = ['pendente', 'aprovado', 'descartado'];

function cutStateOf(rec, index) {
  const m = (rec && rec.cutStates) || {};
  const s = String(m[index] || 'pendente');
  return CUT_STATES.includes(s) ? s : 'pendente';
}

/* Lista consolidada dos cortes de todas as tarefas. */
export function cuts(owner = null) {
  const items = [];
  for (const rec of state.list(owner)) {
    const plan = rec.plan;
    if (!plan || !Array.isArray(plan.cuts)) continue;
    for (const c of plan.cuts) {
      items.push({
        jobId: rec.id, jobTitle: rec.title, profileKey: rec.profileKey || null,
        index: c.index, title: c.title, start: c.start, end: c.end, duration: c.duration,
        score: c.score || 0, captionsCount: c.captionsCount || 0,
        state: cutStateOf(rec, c.index),
        renderState: rec.render ? rec.render.state : null,
        createdAt: rec.createdAt, updatedAt: rec.updatedAt,
      });
    }
  }
  items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return {
    ok: true,
    total: items.length,
    pending: items.filter((x) => x.state === 'pendente').length,
    approved: items.filter((x) => x.state === 'aprovado').length,
    discarded: items.filter((x) => x.state === 'descartado').length,
    items,
  };
}

export async function setCutState(id, index, cutState, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  const n = Math.round(Number(index));
  const exists = rec.plan && Array.isArray(rec.plan.cuts) && rec.plan.cuts.some((c) => c.index === n);
  if (!exists) return { ok: false, reason: 'Corte não encontrado nesta tarefa.' };
  const s = String(cutState || '').toLowerCase();
  if (!CUT_STATES.includes(s)) return { ok: false, reason: 'Estado de corte inválido.' };
  rec.cutStates = rec.cutStates || {};
  if (s === 'pendente') delete rec.cutStates[n]; else rec.cutStates[n] = s;
  logStep(rec, 'revisao', 'Corte #' + n + ' marcado como ' + s + '.');
  rec.updatedAt = nowIso();
  await state.save(rec);
  return { ok: true, jobId: rec.id, index: n, state: s, job: summary(rec) };
}

/* ---------------- Visão geral (tela inicial) ---------------- */
export function overview(owner = null) {
  const all = state.list(owner);
  const byStatus = {}; for (const s of JOB_STATUS) byStatus[s] = 0;
  for (const r of all) if (byStatus[r.status] !== undefined) byStatus[r.status]++;

  const cutList = cuts(owner);
  const processing = all
    .filter((r) => r.status === 'processando' || queue.isQueued(r.id))
    .map(summary)
    .sort((a, b) => (b.progress || 0) - (a.progress || 0));
  const review = all.filter((r) => r.status === 'revisao').map(summary);
  const recent = all.map(summary)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 8);

  const ff = ffmpegStatus();
  return {
    ok: true,
    videos: { total: all.length, byStatus, processing: processing.length, review: review.length },
    cuts: { total: cutList.total, pending: cutList.pending, approved: cutList.approved, discarded: cutList.discarded },
    pendingReview: review,
    processing,
    recent,
    queue: queue.status(),
    ffmpeg: ff ? { available: ff.available, version: (ff.ffmpeg && ff.ffmpeg.version) || null, installHint: ff.installHint } : { available: null, pending: true },
  };
}

/* ---------------- 7.1 Entrada por URL (vídeos do usuário) ---------------- */
const PLATFORM_HOSTS = [
  { name: 'YouTube', hosts: ['youtube.com', 'youtu.be', 'm.youtube.com'] },
  { name: 'Vimeo', hosts: ['vimeo.com'] },
  { name: 'TikTok', hosts: ['tiktok.com', 'vm.tiktok.com'] },
  { name: 'Instagram', hosts: ['instagram.com'] },
  { name: 'Facebook', hosts: ['facebook.com', 'fb.watch'] },
  { name: 'Twitch', hosts: ['twitch.tv'] },
  { name: 'Dailymotion', hosts: ['dailymotion.com', 'dai.ly'] },
  { name: 'X', hosts: ['x.com', 'twitter.com'] },
  { name: 'LinkedIn', hosts: ['linkedin.com'] },
];

function platformFor(host) {
  const p = PLATFORM_HOSTS.find((x) => x.hosts.some((h) => host === h || host.endsWith('.' + h)));
  return p ? p.name : 'Site';
}

/* Valida a URL e identifica a plataforma. Não baixa nada. */
export function analyzeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, reason: 'URL vazia.' };
  let u = null;
  try { u = new URL(value); } catch { return { ok: false, reason: 'Endereço inválido: ' + value.slice(0, 80) }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Apenas endereços http(s) são aceitos.' };
  const host = u.hostname.replace(/^www\./i, '').toLowerCase();
  if (!host || host.indexOf('.') < 0) return { ok: false, reason: 'Endereço sem domínio válido.' };
  const platform = platformFor(host);
  return { ok: true, url: u.toString(), host, platform, known: platform !== 'Site' };
}

/* Cria uma tarefa por URL informada. A URL entra como fonte real; a
 * transcrição continua sendo o insumo da análise (nada é simulado). */
export async function ingest(input = {}, owner = null) {
  const raw = input.urls !== undefined ? input.urls : input.url;
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[\n,]+/);
  const cleaned = list.map((s) => String(s || '').trim()).filter(Boolean);
  if (!cleaned.length) return { ok: false, reason: 'Informe pelo menos uma URL de vídeo.' };
  if (cleaned.length > 20) return { ok: false, reason: 'Máximo de 20 URLs por vez.' };

  const overrides = {};
  const mc = Number(input.maxCuts);
  if (Number.isFinite(mc)) overrides.maxCuts = Math.round(Math.max(1, Math.min(50, mc)));
  const dur = Number(input.cutDuration);
  if (Number.isFinite(dur) && dur > 0) {
    overrides.minDuration = Math.max(5, Math.round(dur * 0.8));
    overrides.maxDuration = Math.min(900, Math.round(dur * 1.2));
  }
  if (ASPECTS.includes(String(input.aspect))) overrides.aspect = String(input.aspect);

  // Formatos (1 ou vários): 9:16, 1:1, 16:9.
  let formats = input.formats !== undefined ? input.formats : (input.aspects !== undefined ? input.aspects : input.aspect);
  if (typeof formats === 'string') formats = formats.split(/[\s,;]+/);
  if (!Array.isArray(formats)) formats = [];
  formats = [...new Set(formats.map((a) => String(a).trim()).filter((a) => ASPECTS.includes(a)))];
  if (!formats.length) formats = [overrides.aspect || '9:16'];

  const created = []; const invalid = [];
  for (const item of cleaned) {
    const v = analyzeUrl(item);
    if (!v.ok) { invalid.push({ url: item, reason: v.reason }); continue; }
    const base = String(input.title || '').trim();
    const title = base ? (cleaned.length > 1 ? base + ' ' + (created.length + 1) : base) : (v.platform + ' · ' + v.host);
    const r = await create({
      title,
      sources: [{ kind: 'url', value: v.url, label: v.url }],
      formats,
      profile: Object.assign({ key: String((input.profile && input.profile.key) || input.profileKey || 'podcast') }, overrides),
    }, owner);
    if (r.ok) {
      created.push({ id: r.job.id, title: r.job.title, url: v.url, platform: v.platform });
      // Busca os dados públicos reais em segundo plano (não bloqueia o ingest).
      enrichFromUrl(r.job.id, owner).catch(() => { /* best-effort, honesto */ });
    } else invalid.push({ url: item, reason: r.reason });
  }
  return {
    ok: created.length > 0,
    created,
    invalid,
    formats,
    reason: created.length ? null : 'Nenhuma URL válida foi aceita.',
    note: 'A URL é registrada como fonte e os dados públicos (título/miniatura) são buscados. Para a análise, envie a transcrição do trecho (Etapa 3).',
  };
}

/* ---------------- 3.x Metadados reais por URL ---------------- */
/* Busca informações públicas do vídeo (oEmbed/Open Graph) e guarda na
 * tarefa. Nada é simulado: se não houver dados, informa o motivo. */
export async function enrichFromUrl(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  const src = (rec.sources || []).find((s) => s.kind === 'url');
  if (!src || !src.value) return { ok: false, reason: 'Esta tarefa não tem URL de vídeo como fonte.' };

  const info = await fetchVideoInfo(src.value);
  if (!info.ok) {
    logStep(rec, 'metadados_url', 'Não foi possível ler dados públicos: ' + info.reason);
    rec.updatedAt = nowIso();
    await state.save(rec);
    return info;
  }

  rec.sourceInfo = info;
  // Se o título ainda é genérico ("Plataforma · host"), usa o título real.
  const generic = /·/.test(String(rec.title || '')) || /^(YouTube|Vimeo|TikTok|Instagram|Facebook|Twitch|Dailymotion|X|LinkedIn|Site)\b/.test(String(rec.title || ''));
  if (generic && info.title) rec.title = String(info.title).slice(0, 120);
  if (info.duration && !(rec.sources.some((s) => Number.isFinite(s.duration)))) {
    const i = rec.sources.indexOf(src); if (i >= 0) rec.sources[i].duration = info.duration;
  }
  logStep(rec, 'metadados_url', 'Dados públicos obtidos: "' + (info.title || '—') + '"' + (info.author ? ' · ' + info.author : '') + '.');
  rec.updatedAt = nowIso();
  await state.save(rec);
  return { ok: true, sourceInfo: rec.sourceInfo, job: summary(rec) };
}

/* ---------------- 3.x Capas automáticas (3 por corte) ---------------- */
export function covers(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  return { ok: true, covers: rec.covers || null };
}

export async function generateCovers(id, input = {}, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  if (!rec.plan || !Array.isArray(rec.plan.cuts) || !rec.plan.cuts.length) {
    return { ok: false, code: 'plano_ausente', reason: 'Gere o plano de edição antes das capas.' };
  }
  const aspect = ASPECTS.includes(String(input.aspect)) ? String(input.aspect) : (rec.plan.aspect || '9:16');
  const indexFilter = Number.isFinite(Number(input.index)) ? Number(input.index) : null;

  const items = [];
  for (const cut of rec.plan.cuts) {
    if (indexFilter !== null && cut.index !== indexFilter) {
      const prev = (rec.covers && rec.covers.items || []).find((x) => x.index === cut.index);
      if (prev) items.push(prev);
      continue;
    }
    const built = buildCovers({ cut, info: rec.sourceInfo || null, aspect, title: (rec.metadata && rec.metadata.title) || cut.title });
    items.push({ index: cut.index, aspect, width: built.width, height: built.height, hasThumbnail: built.hasThumbnail, covers: built.covers });
  }
  rec.covers = { aspect, generatedAt: nowIso(), hasThumbnail: !!((rec.sourceInfo || {}).thumbnail), items };
  logStep(rec, 'capas', items.length + ' corte(s) com 3 opções de capa (' + aspect + ').');
  rec.updatedAt = nowIso();
  await state.save(rec);
  return { ok: true, covers: rec.covers, job: summary(rec) };
}

/* ---------------- 4.x Formatos (múltiplos por corte) ---------------- */
export async function setFormats(id, input = {}, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  let list = input.aspects !== undefined ? input.aspects : input.aspect;
  if (typeof list === 'string') list = list.split(/[\s,;]+/);
  if (!Array.isArray(list)) list = [];
  const aspects = [...new Set(list.map((a) => String(a).trim()).filter((a) => ASPECTS.includes(a)))];
  if (!aspects.length) return { ok: false, reason: 'Informe ao menos um formato válido (' + ASPECTS.join(', ') + ').' };
  rec.formats = aspects;
  if (rec.plan) rec.plan.aspects = aspects;
  logStep(rec, 'formatos', 'Formatos definidos: ' + aspects.join(', ') + '.');
  rec.updatedAt = nowIso();
  await state.save(rec);
  return { ok: true, formats: aspects, dimensions: aspects.map((a) => ({ aspect: a, ...dimensionsFor(a) })), job: summary(rec) };
}

/* ---------------- 6.x Músicas (wrapper do módulo) ---------------- */
export function musicList() { return music.listTracks(); }
export function musicAdd(input = {}) { return music.addTrack(input); }
export function musicRemove(id) { return music.removeTrack(id); }
export function musicUpdate(id, patch = {}) { return music.updateTrack(id, patch); }

/* =========================================================
 * 5.x Editor integrado — cortes, ordem, legendas e histórico
 * ---------------------------------------------------------
 * Todas as alterações passam por aqui e ficam registradas em um
 * histórico (desfazer/refazer) por tarefa. Nada é recalculado às
 * escondas: o plano continua sendo o que o render executaria.
 * =======================================================*/
const HISTORY_LIMIT = 25;
const EDITABLE_FIELDS = ['plan', 'cutStates', 'captionConfig', 'covers', 'formats'];

function captionConfigOf(rec) {
  return normalizeCaptions(rec && rec.captionConfig, defaultCaptions());
}

/* Estilo inicial de um trabalho novo: o padrão salvo pelo usuário tem
 * prioridade; sem padrão salvo, usa o estilo do perfil escolhido. Por
 * fim, o que veio explicitamente na própria requisição. */
function defaultCaptionConfigFor(input = {}, prof = null) {
  const saved = (state.config && state.config.defaultCaptionStyle) || null;
  const p = prof || (input && input.profile);
  const profStyle = p && p.captions && p.captions.style ? p.captions.style : null;
  const base = saved || normalizeCaptions({ style: profStyle || 'padrao' }, defaultCaptions());
  return normalizeCaptions((input && (input.captions || input.captionConfig)) || {}, base);
}

/* Guarda um instantâneo do estado editável antes de cada alteração. */
function pushHistory(rec, label) {
  const snap = {};
  for (const k of EDITABLE_FIELDS) snap[k] = rec[k] === undefined ? null : JSON.parse(JSON.stringify(rec[k]));
  rec.history = rec.history || [];
  rec.history.push({ at: nowIso(), label: String(label || 'edição'), snapshot: snap });
  if (rec.history.length > HISTORY_LIMIT) rec.history = rec.history.slice(-HISTORY_LIMIT);
  rec.redoStack = [];
  return rec.history.length;
}

function applySnapshot(rec, snap) {
  for (const k of EDITABLE_FIELDS) {
    if (!snap || snap[k] === undefined || snap[k] === null) delete rec[k];
    else rec[k] = JSON.parse(JSON.stringify(snap[k]));
  }
}

function findCut(rec, index) {
  const n = Math.round(Number(index));
  if (!rec.plan || !Array.isArray(rec.plan.cuts)) return null;
  return rec.plan.cuts.find((c) => c.index === n) || null;
}

/* Recalcula totais do plano depois de qualquer edição de corte. */
function reindexPlan(rec) {
  const p = rec.plan;
  if (!p || !Array.isArray(p.cuts)) return;
  p.cuts.forEach((c, i) => { c.index = i + 1; });
  p.cutsCount = p.cuts.length;
  p.totalDuration = Math.round(p.cuts.reduce((a, c) => a + (Number(c.duration) || 0), 0) * 100) / 100;
  p.averageScore = p.cuts.length ? Math.round(p.cuts.reduce((a, c) => a + (Number(c.score) || 0), 0) / p.cuts.length) : 0;
  p.editedAt = nowIso();
}

/* Edita um corte: entrada, saída, título, texto e legendas. */
export async function updateCut(id, index, patch = {}, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  const cut = findCut(rec, index);
  if (!cut) return { ok: false, reason: 'Corte não encontrado nesta tarefa.' };
  const cp = canProcess(rec.rights);
  if (!cp.ok) return { ok: false, code: 'direitos_insuficientes', reason: cp.message };

  const src = patch && typeof patch === 'object' ? patch : {};

  if (src.start !== undefined) {
    const v = Number(src.start);
    if (!Number.isFinite(v) || v < 0) return { ok: false, reason: 'Início inválido.' };
    cut.start = Math.round(v * 100) / 100;
  }
  if (src.end !== undefined) {
    const v = Number(src.end);
    if (!Number.isFinite(v) || v <= 0) return { ok: false, reason: 'Fim inválido.' };
    cut.end = Math.round(v * 100) / 100;
  }
  if (cut.end <= cut.start) return { ok: false, reason: 'O fim precisa ser maior que o início.' };
  if (src.title !== undefined) cut.title = String(src.title || '').trim().slice(0, 120) || cut.title;
  if (src.text !== undefined) cut.text = String(src.text || '').slice(0, 600);

  let captionsTouched = false;
  if (Array.isArray(src.captions)) {
    cut.captions = src.captions
      .map((c) => ({
        start: Math.max(cut.start, Number(c && c.start) || cut.start),
        end: Math.min(cut.end, Number(c && c.end) || cut.end),
        text: String((c && c.text) || '').trim().slice(0, 200),
        speaker: String((c && c.speaker) || '').slice(0, 60),
      }))
      .filter((c) => c.text && c.end > c.start);
    captionsTouched = true;
  } else if (src.start !== undefined || src.end !== undefined) {
    // Recalcula as legendas a partir da transcrição no novo intervalo.
    if (rec.profile && rec.profile.captions && rec.profile.captions.enabled) {
      cut.captions = buildCaptions(rec.transcript || [], cut.start, cut.end);
      captionsTouched = true;
    }
  }
  if (captionsTouched) cut.captionsCount = (cut.captions || []).length;

  cut.duration = Math.round((cut.end - cut.start) * 100) / 100;
  if (src.score !== undefined) {
    const v = Number(src.score);
    if (Number.isFinite(v)) cut.score = Math.max(0, Math.min(100, Math.round(v)));
  }

  pushHistory(rec, 'corte #' + index + ' editado');
  reindexPlan(rec);
  logStep(rec, 'editor', 'Corte #' + cut.index + ' editado (' + cut.start + 's → ' + cut.end + 's, ' + cut.duration + 's).');
  rec.updatedAt = nowIso();
  await state.save(rec);
  return { ok: true, cut, plan: rec.plan, job: summary(rec) };
}

/* Reordena os cortes por critério ou por lista explícita de índices. */
export async function reorderCuts(id, input = {}, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  if (!rec.plan || !Array.isArray(rec.plan.cuts) || !rec.plan.cuts.length) {
    return { ok: false, reason: 'Não há cortes para reordenar.' };
  }
  const order = String((input && input.order) || 'score');
  const cuts = rec.plan.cuts.slice();

  if (Array.isArray(input.indexes)) {
    const byIndex = new Map(cuts.map((c) => [c.index, c]));
    const ordered = [];
    for (const i of input.indexes) {
      const c = byIndex.get(Math.round(Number(i)));
      if (c) { ordered.push(c); byIndex.delete(c.index); }
    }
    for (const c of cuts) if (byIndex.has(c.index)) ordered.push(c);
    rec.plan.cuts = ordered;
  } else if (order === 'cronologica' || order === 'timeline') {
    cuts.sort((a, b) => a.start - b.start);
    rec.plan.cuts = cuts;
  } else if (order === 'duracao') {
    cuts.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    rec.plan.cuts = cuts;
  } else {
    cuts.sort((a, b) => (b.score || 0) - (a.score || 0));
    rec.plan.cuts = cuts;
  }

  // Os estados (aprovado/descartado) acompanham o corte, não a posição.
  pushHistory(rec, 'ordem alterada (' + order + ')');
  reindexPlan(rec);
  rec.plan.order = Array.isArray(input.indexes) ? 'manual' : order;
  logStep(rec, 'editor', 'Cortes reordenados: ' + rec.plan.order + '.');
  rec.updatedAt = nowIso();
  await state.save(rec);
  return { ok: true, plan: rec.plan, job: summary(rec) };
}

/* Define o estilo/animação das legendas de um trabalho. */
export async function setCaptions(id, input = {}, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  const cfg = normalizeCaptions(input, captionConfigOf(rec));
  pushHistory(rec, 'legendas atualizadas');
  rec.captionConfig = cfg;
  if (rec.profile) {
    rec.profile.captions = { enabled: cfg.enabled, style: cfg.style };
  }
  if (rec.plan) {
    rec.plan.captionsEnabled = cfg.enabled;
    rec.plan.captionStyle = cfg.enabled ? cfg.style : null;
    rec.plan.captionConfig = cfg;
  }
  const d = describeCaptions(cfg);
  logStep(rec, 'editor', 'Legendas: ' + (cfg.enabled ? d.styleLabel + ' · ' + d.animationLabel + ' · ' + d.positionLabel : 'desativadas') + '.');
  rec.updatedAt = nowIso();
  await state.save(rec);
  return { ok: true, captionConfig: cfg, described: d, job: summary(rec) };
}

/* Arquivo SRT de um corte, com o estilo atual aplicado. */
export function cutSrt(id, index, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  const cut = findCut(rec, index);
  if (!cut) return { ok: false, reason: 'Corte não encontrado nesta tarefa.' };
  const cfg = captionConfigOf(rec);
  return { ok: true, index: cut.index, srt: buildSrt(cut, cfg), forceStyle: forceStyle(cfg), captionConfig: cfg };
}

/* Catálogo de estilos + estilo salvo como padrão. */
export function captions() {
  const cat = captionCatalog();
  const saved = (state.config && state.config.defaultCaptionStyle) || null;
  return {
    ...cat,
    hasDefault: !!saved,
    defaultCaptionStyle: saved ? normalizeCaptions(saved, defaultCaptions()) : null,
    forceStyleExample: forceStyle(saved || defaultCaptions()),
  };
}

/* Salva o estilo informado como padrão dos próximos trabalhos.
 * Com { clear: true }, remove o padrão salvo (volta a usar o perfil). */
export async function saveStyleDefaults(input = {}) {
  if (input && input.clear === true) {
    const cfgFile = Object.assign({}, state.config || {}, { updatedAt: nowIso() });
    delete cfgFile.defaultCaptionStyle;
    await state.saveConfig(cfgFile);
    return { ok: true, defaultCaptionStyle: null, described: describeCaptions(defaultCaptions()), note: 'Estilo padrão removido: novos trabalhos voltam a usar o estilo do perfil.' };
  }
  const current = (state.config && state.config.defaultCaptionStyle) || null;
  const cfg = normalizeCaptions(input, current || defaultCaptions());
  const cfgFile = Object.assign({}, state.config || {}, { defaultCaptionStyle: cfg, updatedAt: nowIso() });
  await state.saveConfig(cfgFile);
  return { ok: true, defaultCaptionStyle: cfg, described: describeCaptions(cfg) };
}

/* Desfazer a última alteração de edição. */
export async function undo(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  if (!Array.isArray(rec.history) || !rec.history.length) return { ok: false, reason: 'Nada para desfazer.' };
  const entry = rec.history.pop();
  const current = {};
  for (const k of EDITABLE_FIELDS) current[k] = rec[k] === undefined ? null : JSON.parse(JSON.stringify(rec[k]));
  rec.redoStack = rec.redoStack || [];
  rec.redoStack.push({ at: nowIso(), label: entry.label, snapshot: current });
  applySnapshot(rec, entry.snapshot);
  logStep(rec, 'editor', 'Desfeito: ' + entry.label + '.');
  rec.updatedAt = nowIso();
  await state.save(rec);
  return { ok: true, undone: entry.label, job: summary(rec), history: historyState(rec) };
}

/* Refazer a última alteração desfeita. */
export async function redo(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  if (!Array.isArray(rec.redoStack) || !rec.redoStack.length) return { ok: false, reason: 'Nada para refazer.' };
  const entry = rec.redoStack.pop();
  const current = {};
  for (const k of EDITABLE_FIELDS) current[k] = rec[k] === undefined ? null : JSON.parse(JSON.stringify(rec[k]));
  rec.history = rec.history || [];
  rec.history.push({ at: nowIso(), label: entry.label, snapshot: current });
  applySnapshot(rec, entry.snapshot);
  logStep(rec, 'editor', 'Refeito: ' + entry.label + '.');
  rec.updatedAt = nowIso();
  await state.save(rec);
  return { ok: true, redone: entry.label, job: summary(rec), history: historyState(rec) };
}

function historyState(rec) {
  const hist = Array.isArray(rec.history) ? rec.history : [];
  const redo = Array.isArray(rec.redoStack) ? rec.redoStack : [];
  return {
    canUndo: hist.length > 0,
    canRedo: redo.length > 0,
    undoLabel: hist.length ? hist[hist.length - 1].label : null,
    redoLabel: redo.length ? redo[redo.length - 1].label : null,
    depth: hist.length,
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
    sources: rec.sources || [],
    sourceInfo: rec.sourceInfo || null,
    transcript: (rec.transcript || []).slice(0, 400),
    analysis: rec.analysis || null,
    plan: rec.plan || null,
    cutStates: rec.cutStates || {},
    covers: rec.covers || null,
    formats: rec.formats || null,
    captionConfig: captionConfigOf(rec),
    captionsDescribed: describeCaptions(captionConfigOf(rec)),
    history: historyState(rec),
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
  const prof = normalizeProfile(Object.assign({}, input.profile || {}, input.profileKey ? { key: input.profileKey } : {}));

  let formats = input.formats !== undefined ? input.formats : input.aspect;
  if (typeof formats === 'string') formats = formats.split(/[\s,;]+/);
  formats = Array.isArray(formats) ? [...new Set(formats.map((a) => String(a).trim()).filter((a) => ASPECTS.includes(a)))] : [];
  if (!formats.length) formats = [prof.aspect || '9:16'];

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
    formats,
    sourceInfo: null,
    covers: null,
    captionConfig: defaultCaptionConfigFor(input, prof),
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

/* Cria uma tarefa a partir de um ARQUIVO DE VÍDEO LOCAL (upload).
 * O caminho real do arquivo é registrado como fonte "local" e a duração
 * é medida com o ffprobe quando disponível (best-effort, sem simular). */
export async function createLocal(input = {}, owner = null) {
  const filePath = String(input.path || input.file || '').trim();
  if (!filePath) return { ok: false, reason: 'Arquivo de vídeo não informado.' };
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile() || st.size <= 0) return { ok: false, reason: 'Arquivo de vídeo inválido ou vazio.' };
  } catch {
    return { ok: false, reason: 'Arquivo de vídeo não encontrado no servidor.' };
  }

  // Ajustes de corte (mesma semântica do ingest por URL).
  const overrides = {};
  const mc = Number(input.maxCuts);
  if (Number.isFinite(mc)) overrides.maxCuts = Math.round(Math.max(1, Math.min(50, mc)));
  const dur = Number(input.cutDuration);
  if (Number.isFinite(dur) && dur > 0) {
    overrides.minDuration = Math.max(5, Math.round(dur * 0.8));
    overrides.maxDuration = Math.min(900, Math.round(dur * 1.2));
  }

  let duration = null;
  try {
    const p = await probeDuration(filePath);
    if (p && p.ok && Number.isFinite(p.duration) && p.duration > 0) duration = p.duration;
  } catch { /* best-effort: sem ffprobe segue sem duração */ }

  const title = String(input.title || path.basename(filePath)).trim().slice(0, 120) || 'Vídeo enviado';
  const profKey = String((input.profile && input.profile.key) || input.profileKey || 'podcast');

  const src = { kind: 'local', value: filePath, label: String(input.label || path.basename(filePath)).slice(0, 120) };
  if (duration) src.duration = duration;

  const r = await create({
    title,
    description: input.description,
    sources: [src],
    formats: input.formats !== undefined ? input.formats : input.aspect,
    profile: Object.assign({ key: profKey }, overrides),
    rights: input.rights,
    transcript: input.transcript,
  }, owner);

  if (r.ok) r.local = { path: filePath, duration, hasFfmpeg: duration !== null };
  return r;
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
  // O plano carrega a configuração de legendas vigente (estilo/animação),
  // para que prévia, SRT e render usem exatamente a mesma definição.
  const cfg = captionConfigOf(rec);
  rec.plan.captionConfig = cfg;
  rec.plan.captionsEnabled = cfg.enabled;
  rec.plan.captionStyle = cfg.enabled ? cfg.style : null;
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
    // Sem transcrição trazida pelo usuário, a tarefa ainda pode rodar se
    // houver um vídeo de origem: o pipeline baixa (quando é link) e
    // transcreve automaticamente antes da análise.
    const hasMedia = (rec.sources || []).some((s) => s && s.value && (s.kind === 'local' || s.kind === 'url'));
    if (!hasMedia) {
      return { ok: false, code: 'transcricao_ausente', reason: 'Sem transcrição e sem vídeo de origem. Envie os segmentos ou informe um arquivo/URL de vídeo.' };
    }
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
    // Encerra uma etapa obrigatória que não pode continuar (sem simular
    // sucesso): grava o motivo real e para o processamento.
    const fail = async (stage, code, message) => {
      rec.status = 'erro';
      rec.error = message;
      setProgress(rec, 100, null);
      logStep(rec, stage, 'FALHA' + (code ? ' (' + code + ')' : '') + ': ' + message);
      rec.updatedAt = nowIso();
      await state.save(rec);
      _log('runJob: ' + rec.id + ' → erro (' + code + ')');
    };
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

    // 7.1.1 Vídeo de origem: o render exige um ARQUIVO. Quando a fonte é
    // um link, ele é baixado aqui (yt-dlp) e passa a valer como fonte local.
    const work = outDirFor(rec.id);
    let sourcePath = ((rec.sources || []).find((s) => s.kind === 'local' && s.value) || {}).value || null;
    if (!sourcePath) {
      const url = ((rec.sources || []).find((s) => s.kind === 'url' && s.value) || {}).value || null;
      if (!url) {
        await fail('entrada', 'origem_ausente', 'Nenhum vídeo de origem: envie um arquivo de vídeo ou informe uma URL.');
        return;
      }
      setProgress(rec, 14, 'entrada');
      logStep(rec, 'entrada', 'Baixando o vídeo do link informado...');
      await state.save(rec);
      const d = await downloadVideo(url, { outDir: work });
      if (!d.ok) {
        await fail('entrada', d.code, d.reason + (d.hint ? ' ' + d.hint : ''));
        return;
      }
      sourcePath = d.path;
      rec.sources.push({ kind: 'local', value: d.path, label: path.basename(d.path), duration: null });
      logStep(rec, 'entrada', 'Vídeo baixado: ' + path.basename(d.path) + ' (' + Math.round(d.size / 1024) + ' KB).');
      await state.save(rec);
    }

    // 7.1.2 Transcrição automática quando a tarefa não trouxe segmentos.
    if (!(rec.transcript || []).length) {
      setProgress(rec, 18, 'transcricao');
      logStep(rec, 'transcricao', 'Transcrevendo o áudio do vídeo...');
      await state.save(rec);
      const tr = await transcribeVideo(sourcePath, {
        workDir: work,
        onProgress: (i, n) => { setProgress(rec, 18 + Math.round((i / Math.max(1, n)) * 8), 'transcricao'); },
      });
      if (!tr.ok) {
        await fail('transcricao', tr.code, tr.reason + (tr.hint ? ' ' + tr.hint : ''));
        return;
      }
      rec.transcript = tr.segments;
      rec.transcriptSource = { kind: 'stt', model: tr.model, chunks: tr.chunks, approximate: !!tr.approximate, failedChunks: (tr.failedChunks || []).length, at: nowIso() };
      logStep(rec, 'transcricao', tr.segments.length + ' segmento(s) transcrito(s) · ' + tr.note);
      await state.save(rec);
    }

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

    // 7.8 Render real (corte, reenquadramento, legendas e título)
    setProgress(rec, 95, 'render');
    logStep(rec, 'render', 'Renderizando ' + rec.plan.cutsCount + ' corte(s)...');
    await state.save(rec);
    const r = await renderPlan({
      plan: rec.plan,
      inputPath: sourcePath,
      outputDir: work,
      captions: captionConfigOf(rec),
      titleBurn: true,
    });
    rec.render = r.ok
      ? {
        state: 'renderizado', at: nowIso(),
        folder: r.folder, outputs: r.outputs || [], final: r.final || null,
        titleBurn: !!r.titleBurn, warnings: r.warnings || [], ffmpeg: r.ffmpeg || null,
      }
      : {
        state: r.pending ? 'pendente' : 'erro', code: r.code, reason: r.reason,
        hint: r.hint || null, commands: r.commands || [],
        outputs: r.outputs || [], warnings: r.warnings || [], at: nowIso(),
      };
    logStep(rec, 'render', r.ok
      ? (r.outputs.length + ' corte(s) renderizado(s) em ' + r.folder + (r.final ? ' (+ final.mp4)' : ''))
      : (r.reason || 'Render não concluído.'));

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

/* ---------------- 7.9 Entrega local (baixar no navegador) ----------------
 * Os cortes já são servidos em /autoclips-media/<jobId>/<arquivo> (o render
 * anexa "url" a cada corte). Esta função devolve a pasta real em disco para
 * a UI abrir no Finder/Explorer. */
export function folderFor(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Tarefa do AutoClips não encontrada.' };
  const folder = (rec.render && rec.render.folder) || outDirFor(rec.id);
  return { ok: true, folder, jobId: rec.id, title: rec.title || null };
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

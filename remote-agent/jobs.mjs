// remote-agent/jobs.mjs · Estado local de jobs, idempotência, timeout/cancelamento

import { validateJob, prepareJob } from './policy.mjs';
import { getExecutor } from './executor.mjs';

const STATUS = Object.freeze({
  QUEUED:    'QUEUED',
  RUNNING:   'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED:    'FAILED',
  CANCELLED: 'CANCELLED',
  TIMEOUT:   'TIMEOUT',
});

export const JOB_STATUS = STATUS;

const active = new Map();   // jobId → state completo
const runningAbort = new Map(); // jobId → AbortController

export function hasJob(jobId) { return active.has(String(jobId)); }

export function getJob(jobId) {
  const s = active.get(String(jobId));
  return s ? JSON.parse(JSON.stringify(s)) : null;
}

export function listJobs() {
  return Array.from(active.values()).map(s => JSON.parse(JSON.stringify(s)));
}

export async function dispatchJob(job, { sendProgress, sendResult, sendLog }) {
  const jobId = String(job.jobId);
  if (active.has(jobId)) {
    return { ok:false, status: getJob(jobId), duplicate: true, reason: 'jobId duplicado; reuso resultado existente' };
  }
  const validation = validateJob(job);
  if (!validation.ok) {
    const failed = createStub(job, STATUS.FAILED, { error: validation.reason });
    active.set(jobId, failed);
    sendResult(jobId, STATUS.FAILED, { error: validation.reason }, failed);
    return { ok:false, status: failed, reason: validation.reason };
  }
  const prepared = prepareJob(job);
  const state = createStub(prepared, STATUS.QUEUED, null, validation.limits);
  active.set(jobId, state);
  // Dispara async SEM esperar: retorna imediatamente, atualiza via callbacks
  runJobAsync(jobId, prepared, state, { sendProgress, sendResult, sendLog }).catch(err => {
    try { state.error = String(err && err.message || err); } catch {}
    finishJob(jobId, STATUS.FAILED, { error: String(err && err.message || err) });
    try { sendResult(jobId, STATUS.FAILED, state.error, state); } catch {}
  });
  return { ok:true, status: getJob(jobId) };
}

export function cancelJob(jobId) {
  const id = String(jobId);
  const st = active.get(id);
  if (!st) return { ok:false, reason:'job não encontrado' };
  if (st.status === STATUS.COMPLETED || st.status === STATUS.FAILED || st.status === STATUS.CANCELLED || st.status === STATUS.TIMEOUT) {
    return { ok:true, alreadyFinal: true, status: st.status };
  }
  try {
    const ac = runningAbort.get(id);
    if (ac) ac.abort();
  } catch {}
  finishJob(id, STATUS.CANCELLED, { cancelled: true });
  return { ok:true, status: getJob(id) };
}

function createStub(job, status, extra, limits) {
  const now = Date.now();
  return {
    jobId: String(job.jobId),
    type: job.type,
    workspace: job.workspace || 'default',
    parameters: job.parameters || {},
    limits: limits || job.limits || {},
    status,
    createdTs: now, startedTs: status === STATUS.RUNNING ? now : null, endedTs: null,
    durationMs: null,
    progressPct: status === STATUS.COMPLETED ? 100 : 0,
    exitCode: null,
    logs: [],
    filesModified: [],
    result: null,
    error: extra && extra.error ? extra.error : null,
    ...(extra || {}),
  };
}

function appendLog(state, stream, text) {
  const line = { ts: Date.now(), stream, text: String(text).slice(0, 8000) };
  if (state.logs.length >= 400) state.logs.shift();
  state.logs.push(line);
}

function finishJob(jobId, status, result) {
  const s = active.get(String(jobId));
  if (!s) return;
  s.status = status;
  s.endedTs = Date.now();
  s.durationMs = s.startedTs ? s.endedTs - s.startedTs : 0;
  if (status === STATUS.TIMEOUT) s.error = s.error || 'job excedeu timeoutMs';
  if (status === STATUS.CANCELLED) s.error = s.error || 'job cancelado';
  if (result && typeof result === 'object') {
    if (result.exitCode != null) s.exitCode = result.exitCode;
    if (Array.isArray(result.files)) s.filesModified = result.files.slice();
    if (result.outcome) s.result = result.outcome;
    if (!s.result && result.result != null) s.result = result.result;
    if (!s.error && result.error) s.error = String(result.error);
  }
  runningAbort.delete(String(jobId));
}

async function runJobAsync(jobId, job, state, { sendProgress, sendResult, sendLog }) {
  state.status = STATUS.RUNNING;
  state.startedTs = Date.now();
  sendProgress(jobId, 1, STATUS.RUNNING, null);
  const executor = getExecutor(job.type);
  if (!executor) {
    finishJob(jobId, STATUS.FAILED, { error: 'executor não encontrado para type=' + job.type });
    sendResult(jobId, STATUS.FAILED, state.error, state);
    return;
  }
  const abort = new AbortController();
  runningAbort.set(jobId, abort);
  try {
    const onProgress = (pct, note) => {
      const p = Math.max(0, Math.min(100, Number(pct) || 0));
      state.progressPct = p;
      sendProgress(jobId, p, STATUS.RUNNING, String(note || ''));
    };
    const onLog = (stream, text) => {
      appendLog(state, stream, String(text || ''));
      sendLog(jobId, stream, String(text || '').slice(0, 4000));
    };
    const onFileModified = (f) => {
      appendLog(state, 'file', String(f));
      sendLog(jobId, 'file', String(f));
    };
    const res = await executor(job, { onProgress, onLog, onFileModified, abortSignal: abort.signal });
    // Timeout externo?
    if (abort.signal.aborted && state.status !== STATUS.CANCELLED) {
      // Não sobrescreve cancelamento
    }
    const status = (res && res.outcome && res.outcome.timeout) ? STATUS.TIMEOUT
                 : state.status === STATUS.CANCELLED ? STATUS.CANCELLED
                 : (res && res.exitCode === 0) ? STATUS.COMPLETED : STATUS.FAILED;
    finishJob(jobId, status, res);
    sendResult(jobId, status, state.error, state);
  } catch (err) {
    finishJob(jobId, STATUS.FAILED, { error: String(err && err.message || err) });
    sendResult(jobId, STATUS.FAILED, state.error, state);
  } finally {
    runningAbort.delete(jobId);
  }
}

export default { JOB_STATUS, hasJob, getJob, listJobs, dispatchJob, cancelJob };

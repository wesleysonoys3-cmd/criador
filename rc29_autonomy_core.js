// rc29_autonomy_core.js · RC29 · Núcleo de Autonomia do T-Agente
// Camada ADITIVA acima do RC27/RC28. NENHUMA dependência externa.
// Funções puras (exceto Date.now() em timestamps, parametrizável).
export const RC29_SCHEMA_VERSION = 1;

const RC29_KINDS = new Set([
  'INTERNET_UNAUTHORIZED',
  'WORKSPACE_REMOTE_MISSING',
  'RESOURCE_MISSING',
  'INFORMATION_MISSING',
  'AUTHORIZATION_REQUIRED',
]);

function _clone(obj) {
  if (obj == null) return obj;
  if (typeof obj !== 'object') return obj;
  try { return JSON.parse(JSON.stringify(obj)); }
  catch { return obj; }
}

export function rc29InitRuntime({ objective, _nowMs }) {
  const now = Number(_nowMs) > 0 ? Number(_nowMs) : Date.now();
  const obj = String(objective || '').trim();
  return Object.freeze ? Object.freeze({
    version: RC29_SCHEMA_VERSION,
    objective: obj.slice(0, 2000),
    objectiveAtMs: now,
    currentTaskId: null,
    completedTaskIds: [],
    failedTaskIds: [],
    nextAction: 'Inicializado. Próximo passo: analisar objetivo e definir tarefas.',
    objectiveProgressPct: 0,
    taskCompleted: false,
    objectiveVerified: false,
    lastVerificationReason: null,
    stall: {
      cyclesNoProgress: 0,
      lastProgressAtMs: now,
      status: 'none',
    },
    recoveryAttempts: [],
    blockingReason: null,
    loops: 0,
    concludedAtMs: null,
  }) : {
    version: RC29_SCHEMA_VERSION,
    objective: obj.slice(0, 2000),
    objectiveAtMs: now,
    currentTaskId: null,
    completedTaskIds: [],
    failedTaskIds: [],
    nextAction: 'Inicializado. Próximo passo: analisar objetivo e definir tarefas.',
    objectiveProgressPct: 0,
    taskCompleted: false,
    objectiveVerified: false,
    lastVerificationReason: null,
    stall: {
      cyclesNoProgress: 0,
      lastProgressAtMs: now,
      status: 'none',
    },
    recoveryAttempts: [],
    blockingReason: null,
    loops: 0,
    concludedAtMs: null,
  };
}

export function rc29RecordTaskResult(runtime, { taskId, status, errorSummary, _nowMs }) {
  const base = runtime && typeof runtime === 'object' ? runtime : rc29InitRuntime({ objective: '' });
  const now = Number(_nowMs) > 0 ? Number(_nowMs) : Date.now();
  const r = _clone(base);
  if (!Array.isArray(r.completedTaskIds)) r.completedTaskIds = [];
  if (!Array.isArray(r.failedTaskIds)) r.failedTaskIds = [];
  const tid = String(taskId || '').trim();
  if (tid) r.currentTaskId = null;
  const normalize = String(status || '').toLowerCase();
  if (tid && normalize === 'completed') {
    if (!r.completedTaskIds.includes(tid)) r.completedTaskIds.push(tid);
    r.taskCompleted = true;
    r.stall.cyclesNoProgress = 0;
    r.stall.lastProgressAtMs = now;
    r.stall.status = 'none';
  } else if (tid && (normalize === 'failed' || normalize === 'error' || normalize === 'timeout')) {
    const prev = r.failedTaskIds.find(x => x && String(x.taskId) === tid);
    if (prev) {
      prev.attempts = Number(prev.attempts || 0) + 1;
      prev.lastAtMs = now;
      if (errorSummary) prev.errorSummary = String(errorSummary).slice(0, 500);
    } else {
      r.failedTaskIds.push({
        taskId: tid,
        errorSummary: errorSummary ? String(errorSummary).slice(0, 500) : (normalize || 'sem_motivo'),
        attempts: 1,
        lastAtMs: now,
      });
    }
    r.taskCompleted = false;
  }
  r.loops = Number(r.loops || 0) + 1;
  return r;
}

export function rc29ComputeProgress(runtime, tarefas, testesResults, qaLastResult) {
  const r = runtime && typeof runtime === 'object' ? runtime : rc29InitRuntime({ objective: '' });
  const out = _clone(r);
  const list = Array.isArray(tarefas) ? tarefas : [];
  const total = list.length;
  const done = list.filter(t => t && (t.status === 'completed' || t.status === 'cancelled')).length;
  const tarefasPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  let testesPct = -1;
  if (Array.isArray(testesResults) && testesResults.length > 0) {
    const last = testesResults[testesResults.length - 1];
    const pass = Number(last && last.tests && last.tests.pass) || 0;
    const fail = Number(last && last.tests && last.tests.fail) || 0;
    const exitOk = last && (last.exitCode == null || Number(last.exitCode) === 0 || last.ok === true);
    if (pass + fail > 0) testesPct = exitOk ? Math.min(100, Math.round((pass / (pass + fail)) * 100)) : Math.max(0, Math.round((pass / (pass + fail)) * 100) - 40);
    else testesPct = exitOk ? 90 : 20;
  }

  let qaPct = -1;
  if (qaLastResult && typeof qaLastResult === 'object') {
    const score = Number(qaLastResult.overallScore);
    if (!Number.isNaN(score) && score >= 0) qaPct = Math.max(0, Math.min(100, score));
  }

  let numerator = 0;
  let denominator = 0;
  const w_tarefa = 60; numerator += tarefasPct * w_tarefa; denominator += w_tarefa;
  if (testesPct >= 0) { const w = 25; numerator += testesPct * w; denominator += w; }
  if (qaPct >= 0) { const w = 15; numerator += qaPct * w; denominator += w; }
  out.objectiveProgressPct = denominator > 0 ? Math.max(0, Math.min(100, Math.round(numerator / denominator))) : Math.max(0, Math.min(100, tarefasPct));

  const wasCompletedCount = Array.isArray(out.completedTaskIds) ? out.completedTaskIds.length : 0;
  if (total > 0 && done > wasCompletedCount) { out.stall.cyclesNoProgress = 0; out.stall.status = 'none'; out.stall.lastProgressAtMs = Date.now(); }
  return out;
}

export function rc29RecordRecoveryAttempt(runtime, { strategy, ok, note, _nowMs }) {
  const r = runtime && typeof runtime === 'object' ? runtime : rc29InitRuntime({ objective: '' });
  const out = _clone(r);
  if (!Array.isArray(out.recoveryAttempts)) out.recoveryAttempts = [];
  out.recoveryAttempts.push({
    strategy: String(strategy || 'UNKNOWN').slice(0, 200),
    ok: ok === true,
    note: note ? String(note).slice(0, 500) : null,
    atMs: Number(_nowMs) > 0 ? Number(_nowMs) : Date.now(),
  });
  return out;
}

export function rc29BuildBlockingReason({ kind, title, detail, userActionRequired, _nowMs }) {
  const k = RC29_KINDS.has(kind) ? kind : 'RESOURCE_MISSING';
  return {
    kind: k,
    title: String(title || 'Bloqueio detectado').slice(0, 200),
    detail: String(detail || '').slice(0, 800),
    userActionRequired: String(userActionRequired || 'Informe ao usuário qual ação precisa ser tomada.').slice(0, 500),
    blockedAtMs: Number(_nowMs) > 0 ? Number(_nowMs) : Date.now(),
  };
}

export function rc29ApplyBlockingReason(runtime, block) {
  const r = runtime && typeof runtime === 'object' ? runtime : rc29InitRuntime({ objective: '' });
  const out = _clone(r);
  out.blockingReason = block && typeof block === 'object' ? block : null;
  out.objectiveVerified = false;
  out.lastVerificationReason = block && block.title ? `Bloqueio: ${block.title}` : out.lastVerificationReason;
  return out;
}

function _countWords(s) { return String(s || '').split(/\s+/).filter(Boolean).length; }

export function rc29VerifyObjectiveAgainstState(objective, state, opts = {}) {
  const result = { verified: false, reason: '', evidence: [], nextActionSuggested: '' };
  const obj = String(objective || '').toLowerCase();
  const tarefas = Array.isArray(opts.tarefas) ? opts.tarefas : (state && Array.isArray(state.tarefas) ? state.tarefas : []);
  const testesResults = Array.isArray(opts.testesResults) ? opts.testesResults : (state && Array.isArray(state.testesExecutadosResultados) ? state.testesExecutadosResultados : []);
  const qaLastResult = opts.qaLastResult != null ? opts.qaLastResult : (state && state.qaLastResult ? state.qaLastResult : null);
  const needsPersistence = Boolean(opts.needsPersistence === true || state && state.needsPersistence === true);
  const limitacoes = Array.isArray(state && state.limitacoes) ? state.limitacoes.map(x => String(x).toLowerCase()) : [];

  // 1) Tarefas 100%
  const totalTasks = tarefas.length;
  const doneTasks = tarefas.filter(t => t && (t.status === 'completed' || t.status === 'cancelled')).length;
  if (totalTasks === 0) {
    result.evidence.push('tarefas: 0/0 (plano vazio)');
    result.nextActionSuggested = 'Criar um plano com pelo menos 1 tarefa antes de concluir.';
  } else if (doneTasks < totalTasks) {
    result.evidence.push(`tarefas: ${doneTasks}/${totalTasks} concluídas`);
    result.nextActionSuggested = `Continuar executando as tarefas pendentes (${totalTasks - doneTasks} restantes).`;
  } else {
    result.evidence.push(`tarefas: ${doneTasks}/${totalTasks} concluídas`);
  }

  // 2) Testes
  if (testesResults.length === 0) {
    if (/teste|test|jest|vitest|qa|assert/i.test(obj)) {
      result.evidence.push('testes: nenhum resultado encontrado (objetivo pede testes)');
      if (!result.nextActionSuggested) result.nextActionSuggested = 'Executar os testes do projeto para validar funcionamento.';
    } else {
      result.evidence.push('testes: objetivo não menciona testes (neutro)');
    }
  } else {
    const last = testesResults[testesResults.length - 1];
    const pass = Number(last && last.tests && last.tests.pass) || 0;
    const fail = Number(last && last.tests && last.tests.fail) || 0;
    const exitOk = last && (last.exitCode == null || Number(last.exitCode) === 0 || last.ok === true);
    const remotoOk = last && last.ok === true;
    if ((pass + fail > 0 && pass >= fail && exitOk) || remotoOk) {
      result.evidence.push(`testes: pass=${pass} fail=${fail} exitCode=${last && last.exitCode != null ? last.exitCode : 'n/a'} PASS`);
    } else {
      result.evidence.push(`testes: pass=${pass} fail=${fail} FAIL`);
      if (!result.nextActionSuggested) result.nextActionSuggested = 'Corrigir os testes que estão falhando antes de concluir.';
    }
  }

  // 3) QA
  if (qaLastResult && typeof qaLastResult === 'object') {
    const score = Number(qaLastResult.overallScore);
    const criticos = Array.isArray(qaLastResult.issues) ? qaLastResult.issues.filter(i => i && i.severity === 'critico').length : 0;
    if (!Number.isNaN(score) && score >= 70 && criticos === 0) {
      result.evidence.push(`qa: score=${score} issues_criticas=0 OK`);
    } else if (!Number.isNaN(score)) {
      result.evidence.push(`qa: score=${score} issues_criticas=${criticos} NÃO_OK`);
      if (!result.nextActionSuggested) result.nextActionSuggested = 'Corrigir QA issues (especialmente severidade crítica) antes de concluir.';
    }
  }

  // 4) Placeholder persistence
  if (needsPersistence) {
    const fake = limitacoes.some(l => /fake_storage|fake_?persistence|placeholder_?storage/i.test(l));
    if (fake) {
      result.evidence.push('persistence: needsPersistence=true porém limitacões=placeholder/fake_storage (NÃO_OK)');
      if (!result.nextActionSuggested) result.nextActionSuggested = 'Substituir armazenamento placeholder por implementação real de persistência.';
    } else {
      result.evidence.push('persistence: needsPersistence=true sem placeholder (OK)');
    }
  } else if (/banco|database|db|sqlite|postgres|mysql|persist/i.test(obj)) {
    result.evidence.push('persistence: objetivo menciona persistência mas needsPersistence=false (inconsistência)');
    if (!result.nextActionSuggested) result.nextActionSuggested = 'Confirmar que a camada de persistência foi implementada de verdade (não placeholder).';
  }

  // 5) Keyword mapping heurístico (TASK vs OBJETIVO)
  const keywords = [
    { rx: /\bapi\b|endpoint|rota\b|serviço web|web service|rest|graphql/i, needs: 'endpoints/API implementados', hint: 'Confirmar se há rotas/endpoints reais implementados (ver tarefas com agente DEVELOPER completas e needsPersistence coerente).' },
    { rx: /webhook|aave|monitoramento|alerta|bot\b|integração com/i, needs: 'evidência de integração/monitoramento externo', hint: 'Garantir que a parte de integração com sistema externo (webhooks, monitoramento, alertas) foi implementada; se exigir internet, autorização foi concedida.' },
    { rx: /frontend|interface|tela|ui|landing|página|dashboard/i, needs: 'páginas/UI implementadas', hint: 'Confirmar que as páginas frontend foram criadas e são servidas corretamente.' },
    { rx: /teste|test|jest|vitest|cobertura/i, needs: 'testes automatizados executados com sucesso', hint: 'Executar a suíte de testes do projeto e garantir PASS.' },
    { rx: /banco|dados|sqlite|postgres|mysql|mongodb|persist|schema\b|migra/i, needs: 'camada de persistência funcional', hint: 'Verificar se a camada de banco de dados funciona (não placeholder) e schemas/migrations existem.' },
  ];
  for (const k of keywords) {
    if (k.rx.test(obj)) {
      result.evidence.push(`keyword_match: /${k.rx.source}/ → requer ${k.needs}`);
      if (!result.nextActionSuggested) result.nextActionSuggested = k.hint;
    }
  }

  // 6) REGRA RC29 RÍGIDA · Integração Externa SEMPRE exige evidência:
  //    (teste PASS OU QA score >= 85).
  //    Evita falso positivo: "4/4 tarefas done" mas webhook/monitoramento/AAVE
  //    nunca foram testados de verdade (NÃO implementa internet ainda).
  const extRx = /webhook|aave|monitoramento|alerta real|integração com extern|api externa|crawler|scraper|trading|integração webhook/i;
  let temIntegracaoExterna = extRx.test(obj);
  if (!temIntegracaoExterna) {
    for (const e of result.evidence || []) {
      if (/integração\/monitoramento externo|evidência de integração/i.test(e)) { temIntegracaoExterna = true; break; }
    }
  }
  const lastTestRC29 = testesResults.length ? testesResults[testesResults.length - 1] : null;
  const testPassRC29 = lastTestRC29 && (
    lastTestRC29.ok === true ||
    (lastTestRC29.exitCode == null || Number(lastTestRC29.exitCode) === 0) &&
      (lastTestRC29.tests && Number(lastTestRC29.tests.pass || 0) > 0 &&
       Number(lastTestRC29.tests.fail || 0) <= Number(lastTestRC29.tests.pass || 0))
  );
  const qaAltoRC29 = qaLastResult && typeof qaLastResult.overallScore === 'number' && Number(qaLastResult.overallScore) >= 85;
  const evidenciaIntegracaoOK = testPassRC29 || qaAltoRC29;
  if (temIntegracaoExterna && !evidenciaIntegracaoOK) {
    result.evidence.push(`external_integration: requer teste PASS ou QA>=85; temTeste=${!!lastTestRC29}, testePass=${!!testPassRC29}, qaScore=${qaLastResult && qaLastResult.overallScore != null ? qaLastResult.overallScore : 'n/a'}`);
    if (!result.nextActionSuggested || _countWords(result.nextActionSuggested) < 4) {
      result.nextActionSuggested = 'Integração externa (webhook/monitoramento/API) requer evidência. Executar pelo menos 1 teste PASS ou atingir QA score >= 85; se exigir internet, autorizar via modal.';
    }
  }

  // Condição final de verificação
  const blockers = [];
  if (totalTasks === 0) blockers.push('plano vazio (0 tarefas)');
  else if (doneTasks < totalTasks) blockers.push(`${totalTasks - doneTasks} tarefa(s) pendente(s)`);
  if (/teste|test|jest|vitest|qa/i.test(obj) && testesResults.length === 0) blockers.push('objetivo pede testes mas nenhum foi executado');
  if (temIntegracaoExterna && !evidenciaIntegracaoOK) blockers.push('integração externa sem evidência (nenhum teste PASS e QA<85)');
  if (testesResults.length > 0) {
    const last = testesResults[testesResults.length - 1];
    const pass = Number(last && last.tests && last.tests.pass) || 0;
    const fail = Number(last && last.tests && last.tests.fail) || 0;
    const exitOk = last && (last.exitCode == null || Number(last.exitCode) === 0 || last.ok === true);
    if (pass + fail > 0 && fail > pass) blockers.push(`${fail} testes falharam (mais falhas que sucessos)`);
    else if (!exitOk && !(pass + fail > 0 && pass >= fail)) blockers.push(`último teste exitCode=${last && last.exitCode} (falhou)`);
  }
  if (qaLastResult && typeof qaLastResult.overallScore === 'number') {
    const s = Number(qaLastResult.overallScore);
    const crit = Array.isArray(qaLastResult.issues) ? qaLastResult.issues.filter(i => i && i.severity === 'critico').length : 0;
    if (s < 70 || crit > 0) blockers.push(`qa score=${s} issues_criticas=${crit} (abaixo do limiar 70)`);
  }
  if (needsPersistence) {
    const fake = limitacoes.some(l => /fake_storage|fake_?persistence|placeholder_?storage/i.test(l));
    if (fake) blockers.push('persistência é placeholder (fake_storage)');
  }

  if (blockers.length === 0) {
    result.verified = true;
    result.reason = 'Verificação heurística passou: ' + result.evidence.filter(e => !/NÃO_OK|FAIL|inconsist/i.test(e)).slice(0, 3).join('; ') + '.';
    result.lastVerificationReason = result.reason;
    if (!result.nextActionSuggested) result.nextActionSuggested = 'Objetivo verificado. Concluir a execução.';
  } else {
    result.verified = false;
    result.reason = 'Objetivo ainda NÃO verificado. Bloqueios: ' + blockers.join(', ') + '.';
    result.lastVerificationReason = result.reason;
    if (!result.nextActionSuggested || _countWords(result.nextActionSuggested) < 3) {
      result.nextActionSuggested = `Próxima ação: resolver → ${blockers[0]}. Depois reexecutar os testes.`;
    }
  }

  return result;
}

export function rc29StallTick(runtime, { hadProgress, stallMaxCycles, _nowMs }) {
  const r = runtime && typeof runtime === 'object' ? runtime : rc29InitRuntime({ objective: '' });
  const out = _clone(r);
  const now = Number(_nowMs) > 0 ? Number(_nowMs) : Date.now();
  if (!out.stall || typeof out.stall !== 'object') out.stall = { cyclesNoProgress: 0, lastProgressAtMs: now, status: 'none' };
  if (hadProgress === true) {
    out.stall.cyclesNoProgress = 0;
    out.stall.lastProgressAtMs = now;
    out.stall.status = 'none';
  } else {
    out.stall.cyclesNoProgress = Number(out.stall.cyclesNoProgress || 0) + 1;
    const max = Number(stallMaxCycles) > 0 ? Number(stallMaxCycles) : 16;
    const pct = out.stall.cyclesNoProgress / max;
    out.stall.status = pct >= 1 ? 'blocked' : (pct >= 0.5 ? 'warn' : 'none');
  }
  return out;
}

export default {
  RC29_SCHEMA_VERSION,
  rc29InitRuntime,
  rc29RecordTaskResult,
  rc29ComputeProgress,
  rc29RecordRecoveryAttempt,
  rc29BuildBlockingReason,
  rc29ApplyBlockingReason,
  rc29VerifyObjectiveAgainstState,
  rc29StallTick,
};

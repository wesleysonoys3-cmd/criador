// ============================================================================
//  RC28 · rc28_decision_engine.js — DECISION ENGINE ADAPTATIVO
// ============================================================================
//  NÍVEIS:
//    Nível 1 — rc28DecideNext(state, opts)  ← (LEGACY preservado 100%)
//              Heurística rápida ZERO-LLM, compatível c/ chamadores atuais.
//    Nível 2 — analyzeAndDecide(input)      ← (NOVO ENGINE 12 campos)
//              Entrada rica + camada adaptativa. Retorna output estruturado
//              { analysis, hypotheses, alternatives, evaluationCriteria,
//                selectedStrategy, selectionReason, expectedResult,
//                nextAction, successCriteria, risks, fallbackStrategy }
//
//  KILL-SWITCH:
//    engineMode: 'heuristic' (DEFAULT! seguro, usa Nível 1 p/ decidir)
//                'adaptive'  (usa heurística + lógica adaptativa se confiança baixa)
//
//  Regras HARD:
//    • NÃO acessa FS. NÃO faz HTTP. Pode chamar opts.llmAnalyzeFn SE e
//      somente SE engineMode='adaptive' E confiança heurística < threshold.
//    • NÃO expõe cadeia de pensamento privada. Saídas contêm apenas
//      justificativas operacionais resumidas + decisões + evidências.
//    • Bridge RC24 existente é respeitado.
// ============================================================================
import { topoSortTasks } from './agent_orchestrator.js';
// RC29 Autonomy Core (camada ACIMA do RC28, aditiva, NÃO substitui) — re-exporta verifyObjective
import * as RC29 from './rc29_autonomy_core.js';

const RC28_DECISION_VERSION = 'rc28.1.decisor.v2';
const ENGINE_VERSION        = 'rc28.decision.engine.v1';

const PHASE_ORDER = [
  'ANALYSIS', 'PLANNING', 'ARCHITECTURE',
  'IMPLEMENTATION', 'TESTS', 'CORRECTIONS',
  'VALIDATION', 'COMPLETED', 'BLOCKED'
];

const TASK_STATUS_PRIORITY = {
  in_progress: 0,
  pending: 1,
  blocked: 2,
  completed: 999,
  cancelled: 999
};

const STRATEGY_TYPES = Object.freeze([
  'HEURISTIC_DEFAULT',
  'PRIORITY_FIRST_UNBLOCKED',
  'PARALLEL_READY_BY_AGENT_TYPE',
  'CORRECT_FIRST_FAIL_FAST',
  'RESEARCH_THEN_EXECUTE',
  'SECURITY_AUDIT_FIRST',
  'TEST_DRIVEN_FIX',
  'MINI_STEP_BACKTRACK'
]);

function phaseIndex(phase) { return Math.max(0, PHASE_ORDER.indexOf(phase)); }

function isTriviallyCompleted(state) {
  if (!state || !Array.isArray(state.tarefas)) return false;
  const total = state.tarefas.length;
  if (total === 0) return false;
  const done = state.tarefas.filter(t => t && (t.status === 'completed' || t.status === 'cancelled')).length;
  return done === total;
}

function nextPhaseNoop(current) {
  const i = phaseIndex(current);
  if (i >= phaseIndex('COMPLETED')) return 'COMPLETED';
  return PHASE_ORDER[i + 1] || 'COMPLETED';
}

function pendingNotBlocked(state) {
  if (!Array.isArray(state.tarefas)) return [];
  const ids = new Set(state.tarefas.map(t => t && t.id).filter(Boolean));
  return state.tarefas.filter(t => {
    if (!t || !t.id) return false;
    if (t.status === 'completed' || t.status === 'cancelled') return false;
    const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    for (const d of deps) {
      if (!ids.has(d)) continue;
      const depTask = state.tarefas.find(x => x && x.id === d);
      if (!depTask || depTask.status !== 'completed') return false;
    }
    return true;
  });
}

function chooseTaskHeuristically(candidates, phase) {
  if (!candidates || candidates.length === 0) return null;
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const t of candidates) {
    const s1 = 100 - (TASK_STATUS_PRIORITY[t.status] ?? 10);
    const s2 = phase === 'IMPLEMENTATION' && (t.agent === 'DEVELOPER' || t.agent === 'ARCHITECT') ? 30 : 0;
    const s3 = phase === 'TESTS' && (t.agent === 'QA' || t.agent === 'TEST') ? 30 : 0;
    const s4 = phase === 'VALIDATION' && t.agent === 'SECURITY' ? 30 : 0;
    const s5 = t.priority === 'high' ? 15 : (t.priority === 'low' ? -5 : 0);
    const s6 = t.status === 'in_progress' ? 50 : 0;
    const score = s1 + s2 + s3 + s4 + s5 + s6;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

function buildCompletionGate(state, opts) {
  const reasons = [];
  if (!Array.isArray(state.tarefas)) reasons.push('tarefas ausente');
  else {
    const total = state.tarefas.length;
    const done = state.tarefas.filter(t => t && (t.status === 'completed' || t.status === 'cancelled')).length;
    if (total === 0) reasons.push('plano vazio, nenhuma tarefa a executar');
    else if (done < total) reasons.push(`tarefas ${done}/${total} concluídas`);
  }
  const lastTests = Array.isArray(state.testesExecutadosResultados) ? state.testesExecutadosResultados.slice(-1)[0] : null;
  if (lastTests) {
    if (typeof lastTests.fail === 'number' && lastTests.fail > 0) reasons.push(`últimos testes ${lastTests.fail} falha(s)`);
    else if (typeof lastTests.pass === 'number' && typeof lastTests.total === 'number' && lastTests.pass !== lastTests.total) reasons.push(`últimos testes ${lastTests.pass}/${lastTests.total}`);
  } else {
    reasons.push('nenhum teste executado ainda');
  }
  if (state.needsPersistence) {
    const lims = Array.isArray(state.limitacoes) ? state.limitacoes : [];
    const fake = lims.some(l => typeof l === 'string' && /fake_storage|fake_?persistence|placeholder_?storage/i.test(l));
    if (fake) reasons.push('limitacões: persistência é fake_storage (§19 requer persistência real)');
  }
  const secScores = (Array.isArray(state.testesExecutadosResultados) ? state.testesExecutadosResultados : [])
    .filter(x => x && typeof x === 'object' && typeof x.securityScore === 'number');
  if (secScores.length) {
    const last = secScores[secScores.length - 1].securityScore;
    if (last < 80) reasons.push(`securityScore=${last} < 80`);
  }
  return reasons;
}

// ============================================================
//  NÍVEL 1 · rc28DecideNext  (LEGACY — preservado 100%)
//  Usado quando engineMode='heuristic' (padrão seguro).
//  Também é chamado como FALLBACK do Nível 2 em caso de erro.
// ============================================================
export function rc28DecideNext(state, opts = {}) {
  if (!state || typeof state !== 'object') {
    return {
      action: 'HUMAN_REVIEW',
      reason: 'Estado Central inválido ou ausente. Requer revisão manual.',
      heuristic: 'entrada_state_invalido',
      version: RC28_DECISION_VERSION
    };
  }
  if (opts.maxCycles != null && typeof opts.step === 'number' && opts.step >= opts.maxCycles) {
    return {
      action: 'HUMAN_REVIEW',
      reason: `Excedeu maxCycles=${opts.maxCycles} ciclos (anti-loop §17).`,
      heuristic: 'max_cycles_excedido',
      version: RC28_DECISION_VERSION
    };
  }

  const currentPhase = state.faseGeral || 'ANALYSIS';
  const currentExec = state.statusExecucao || 'idle';

  if (phaseIndex(currentPhase) < phaseIndex('IMPLEMENTATION')) {
    return {
      action: 'ADVANCE_PHASE',
      phaseTo: nextPhaseNoop(currentPhase),
      reason: `Fase atual ${currentPhase} deve ser resolvida pelo RC27 (ANALYSIS → PLANNING → ARCHITECTURE). Avançando automaticamente.`,
      heuristic: 'fase_menor_que_implementation_avancar',
      candidates: [],
      version: RC28_DECISION_VERSION
    };
  }

  if (currentExec === 'blocked' || currentPhase === 'BLOCKED') {
    return {
      action: 'HUMAN_REVIEW',
      reason: `statusExecucao=${currentExec} · faseGeral=${currentPhase} — RC28 não desbloqueia sozinho.`,
      heuristic: 'status_bloqueado',
      version: RC28_DECISION_VERSION
    };
  }

  const intAuth = state.internetAuthorization;
  if (intAuth && typeof intAuth === 'object') {
    if (intAuth.awaitedUser === true && !intAuth.authorizedAt && !intAuth.deniedAt) {
      return {
        action: 'AWAIT_WS_INTERNET',
        taskId: null,
        reason: `Autorização internet pendente por escopo=${String(intAuth.scope||'?')}. Aguardando clique Sim/Não do usuário via WS.`,
        heuristic: 'awaiting_internet_authorization',
        version: RC28_DECISION_VERSION
      };
    }
  }
  if (currentExec === 'paused_awaiting_internet') {
    return {
      action: 'AWAIT_WS_INTERNET',
      reason: `statusExecucao=pause_awaiting_internet. Aguardando autorização usuário via WS.`,
      heuristic: 'awaiting_internet_exec',
      version: RC28_DECISION_VERSION
    };
  }
  if (currentExec === 'paused_awaiting_human') {
    return {
      action: 'AWAIT_WS_HUMAN',
      reason: `statusExecucao=pause_awaiting_human. Aguardando input do usuário via WS.`,
      heuristic: 'awaiting_human_exec',
      version: RC28_DECISION_VERSION
    };
  }

  if (phaseIndex(currentPhase) >= phaseIndex('VALIDATION')) {
    const blockers = buildCompletionGate(state, opts);
    if (blockers.length === 0) {
      return {
        action: 'CONCLUDE',
        phaseTo: 'COMPLETED',
        reason: 'Critérios §19 todos atendidos: 100% tarefas, testes PASS, persistência ok, QA OK. Concluir execução.',
        heuristic: 'completion_gate_19_passou',
        version: RC28_DECISION_VERSION
      };
    }
    const completed = isTriviallyCompleted(state);
    if (completed) {
      return {
        action: 'HUMAN_REVIEW',
        reason: `Tarefas concluídas porém gate §19 bloqueia: ${blockers.join('; ')}. Requer intervenção humana.`,
        heuristic: 'completion_gate_19_bloqueou',
        candidates: blockers,
        version: RC28_DECISION_VERSION
      };
    }
  }

  const topo = topoSortTasks(state.tarefas || []);
  const pendingReady = pendingNotBlocked(state);
  const candidatesIds = pendingReady.map(t => t.id);

  let bridgeUsed = null;
  if (typeof opts.rc24Bridge === 'function') {
    try {
      const rc24 = opts.rc24Bridge(state, opts);
      if (rc24 && rc24.decision) bridgeUsed = rc24;
    } catch { /* ignore bridge failure */ }
  }

  if (pendingReady.length === 0 && isTriviallyCompleted(state)) {
    let target = nextPhaseNoop(currentPhase);
    if (phaseIndex(currentPhase) < phaseIndex('TESTS')) target = 'TESTS';
    else if (phaseIndex(currentPhase) < phaseIndex('VALIDATION')) target = 'VALIDATION';
    return {
      action: 'ADVANCE_PHASE',
      phaseTo: target,
      reason: `Tarefas 100% concluídas. Avançando fase ${currentPhase} → ${target}.`,
      heuristic: 'todas_tarefas_completas_avancar_fase',
      bridgeUsed: bridgeUsed ? bridgeUsed.decision : null,
      version: RC28_DECISION_VERSION
    };
  }

  if (pendingReady.length === 0) {
    const hasBlocked = Array.isArray(state.tarefas) && state.tarefas.some(t => t && t.status === 'blocked');
    return {
      action: hasBlocked ? 'HUMAN_REVIEW' : 'WAIT_OR_CORRECT',
      reason: hasBlocked
        ? 'Há tarefas status=blocked. Requer revisão humana para desbloquear.'
        : 'Sem candidatas: todas tarefas pendentes tem dependências não-concluídas ou está em ciclo topológico.',
      heuristic: hasBlocked ? 'tarefa_bloqueada_manual' : (topo.hasCycle ? 'topologico_ciclo_detectado' : 'dependencias_pendentes'),
      candidates: topo.hasCycle ? topo.cycleNodes : [],
      bridgeUsed: bridgeUsed ? bridgeUsed.decision : null,
      version: RC28_DECISION_VERSION
    };
  }

  const chosen = chooseTaskHeuristically(pendingReady, currentPhase);
  if (!chosen) {
    return {
      action: 'HUMAN_REVIEW',
      reason: 'Escolha heurística falhou apesar de candidatas existirem.',
      heuristic: 'heuristica_escolha_vazia',
      candidates: candidatesIds,
      version: RC28_DECISION_VERSION
    };
  }

  return {
    action: 'EXECUTE_TASK',
    taskId: chosen.id,
    reason: `Próxima tarefa topologicamente válida: ${chosen.id} · ${chosen.agent || '?'} · "${String(chosen.title||'').slice(0,80)}". Motivo: ${
      chosen.status === 'in_progress' ? 'continua em progresso' : (
        (phaseIndex(currentPhase) >= phaseIndex('TESTS') && (chosen.agent==='QA'||chosen.agent==='TEST') ? 'fase TESTS prioriza QA/TEST' :
        (phaseIndex(currentPhase) >= phaseIndex('IMPLEMENTATION') && (chosen.agent==='DEVELOPER'||chosen.agent==='ARCHITECT') ? 'fase IMPL prioriza DEV/ARCH' :
        (chosen.priority==='high' ? 'prioridade alta' : 'próxima na fila topológica')))
      )}.`,
    heuristic: bridgeUsed ? 'rc24_bridge_priority' : 'heuristica_fase_prioridade',
    candidates: candidatesIds,
    bridgeUsed: bridgeUsed ? bridgeUsed.decision : null,
    version: RC28_DECISION_VERSION
  };
}

// ============================================================
//  HELPERS INTERNOS DO NOVO ENGINE (NÍVEL 2)
// ============================================================

function _resolveDecisionEngineMode(state, opts) {
  if (opts && typeof opts.engineMode === 'string') {
    const m = opts.engineMode.trim().toLowerCase();
    if (m === 'adaptive' || m === 'heuristic') return m;
  }
  try {
    if (state && state.decisionEngine && typeof state.decisionEngine.mode === 'string') {
      const m = state.decisionEngine.mode.trim().toLowerCase();
      if (m === 'adaptive' || m === 'heuristic') return m;
    }
  } catch {}
  if (typeof process !== 'undefined' && process.env && typeof process.env.RC28_ENGINE === 'string') {
    const m = process.env.RC28_ENGINE.trim().toLowerCase();
    if (m === 'adaptive') return 'adaptive';
  }
  return 'heuristic'; // DEFAULT SEGURO
}

function _resolveConfidenceThreshold(state, opts) {
  if (opts && typeof opts.confidenceThreshold === 'number' && isFinite(opts.confidenceThreshold)) {
    return Math.max(0, Math.min(1, opts.confidenceThreshold));
  }
  try {
    const v = state?.decisionEngine?.adaptiveConstraints?.confidenceThreshold;
    if (typeof v === 'number' && isFinite(v)) return Math.max(0, Math.min(1, v));
  } catch {}
  return 0.7;
}

function _normalizeArray(v, maxLen = 200) {
  if (!Array.isArray(v)) return [];
  const out = v.slice(0, maxLen);
  return out;
}

function _safeTaskSummary(t) {
  if (!t || typeof t !== 'object') return null;
  return {
    id: String(t.id || ''),
    agent: String(t.agent || ''),
    status: String(t.status || ''),
    title: String(t.title || '').slice(0, 120),
    priority: String(t.priority || 'normal'),
    dependsOnCount: Array.isArray(t.dependsOn) ? t.dependsOn.length : 0
  };
}

function _buildAnalysisSnippet({ state, contextoProjeto, restricoes, historicoAcoes, resultadosAnteriores, errosEncontrados }) {
  const lines = [];
  const fase = state?.faseGeral || 'DESCONHECIDA';
  lines.push(`fase=${fase}`);
  const total = Array.isArray(state?.tarefas) ? state.tarefas.length : 0;
  const done = Array.isArray(state?.tarefas) ? state.tarefas.filter(t => t && t.status === 'completed').length : 0;
  lines.push(`tarefas=${done}/${total}`);
  const lastErr = Array.isArray(errosEncontrados) ? errosEncontrados.slice(-1)[0] : null;
  if (lastErr) {
    const msg = typeof lastErr === 'object' && lastErr.message ? lastErr.message : String(lastErr);
    lines.push(`ultimo_erro=${msg.slice(0, 140)}`);
  }
  const noProg = state?.decisionEngine?.progressMetrics?.noProgressStreak || 0;
  if (noProg > 0) lines.push(`streak_sem_progresso=${noProg}`);
  if (contextoProjeto && typeof contextoProjeto === 'object' && contextoProjeto.stack) lines.push(`stack=${String(contextoProjeto.stack).slice(0,40)}`);
  const restrCount = Array.isArray(restricoes) ? restricoes.length : 0;
  if (restrCount > 0) lines.push(`restricoes=${restrCount}`);
  const histCount = Array.isArray(historicoAcoes) ? historicoAcoes.length : 0;
  if (histCount > 0) lines.push(`historico_acoes=${histCount}`);
  const resCount = Array.isArray(resultadosAnteriores) ? resultadosAnteriores.length : 0;
  if (resCount > 0) lines.push(`resultados_anteriores=${resCount}`);
  return lines.join(' · ');
}

function _generateHypotheses({ state, errosEncontrados, estrategiasAnteriores, objetivo }) {
  const hyps = [];
  const done = Array.isArray(state?.tarefas) ? state.tarefas.filter(t => t && t.status === 'completed').length : 0;
  const total = Array.isArray(state?.tarefas) ? state.tarefas.length : 0;

  hyps.push({
    id: 'H_PROGRESS_LINEAR',
    statement: 'O progresso atual segue o plano; completar as próximas tarefas topológicas deve atingir o objetivo.',
    confidence: total > 0 ? Math.min(0.9, 0.4 + (done / Math.max(1, total)) * 0.5) : 0.3,
    evidence: [`tarefas_concluidas=${done}/${total}`, `fase=${state?.faseGeral || 'ANALYSIS'}`],
    createdAt: Date.now()
  });

  if (Array.isArray(errosEncontrados) && errosEncontrados.length > 0) {
    const sigs = new Map();
    for (const e of errosEncontrados) {
      const key = (typeof e === 'object' && typeof e.loop === 'string') ? e.loop : (typeof e === 'object' && e.message ? e.message.slice(0, 40) : String(e).slice(0, 40));
      sigs.set(key, (sigs.get(key) || 0) + 1);
    }
    const repeated = [...sigs.entries()].find(([k, v]) => v >= 2);
    if (repeated) {
      hyps.push({
        id: 'H_ERRO_RECORRENTE',
        statement: 'Existe um erro recorrente; repetir a mesma estratégia tende a continuar falhando.',
        confidence: 0.8,
        evidence: [`assinatura="${String(repeated[0]).slice(0,80)}" repetiu=${repeated[1]}x`, `total_erros=${errosEncontrados.length}`],
        createdAt: Date.now()
      });
    }
  }

  const inefCount = state?.decisionEngine?.ineffectiveStrategies?.length || 0;
  if (inefCount > 0) {
    hyps.push({
      id: 'H_ESTRATEGIA_INEFICAZ_ANTERIOR',
      statement: `${inefCount} estratégia(s) já foram descartadas por ineficácia; evitar variações da mesma família.`,
      confidence: Math.min(0.95, 0.6 + inefCount * 0.1),
      evidence: [`ineffectiveStrategies.length=${inefCount}`],
      createdAt: Date.now()
    });
  }

  const noProg = state?.decisionEngine?.progressMetrics?.noProgressStreak || 0;
  if (noProg >= 2) {
    hyps.push({
      id: 'H_STALL_DETECTADO',
      statement: `Stall detectado (${noProg} ciclos sem progresso); requer mudança de estratégia, não continuidade.`,
      confidence: Math.min(0.95, 0.5 + noProg * 0.15),
      evidence: [`noProgressStreak=${noProg}`],
      createdAt: Date.now()
    });
  }

  if (state?.faseGeral === 'TESTS' || state?.faseGeral === 'CORRECTIONS') {
    const lastTests = Array.isArray(state?.testesExecutadosResultados) ? state.testesExecutadosResultados.slice(-1)[0] : null;
    if (lastTests && typeof lastTests.fail === 'number' && lastTests.fail > 0) {
      hyps.push({
        id: 'H_CORRECAO_DIRIGIDA_POR_TESTE',
        statement: 'Falhas de teste apontam arquivos específicos; corrigi-los primeiro reduz risco de regressão.',
        confidence: 0.75,
        evidence: [`ultimos_testes_fail=${lastTests.fail}`],
        createdAt: Date.now()
      });
    }
  }

  return hyps.slice(0, 5);
}

function _generateAlternatives({ state, hypotheses, estrategiasAnteriores, ineffectiveStrategies }) {
  const alt = [];
  const currentPhase = state?.faseGeral || 'IMPLEMENTATION';
  const pendingReady = pendingNotBlocked(state);
  const ineff = new Set(
    (ineffectiveStrategies || []).map(x => typeof x === 'object' && x.strategyType ? String(x.strategyType) : String(x))
  );
  // GAP 2 FIX: assinatura do motivo do ineficaz, para permitir repetir
  // estratégia SE as condições relevantes MUDARAM (ex: ineficaz era "sem testes"
  // mas agora tem testes rodando). Sempre filtra por chave: strategyType +
  // reasonSignature (se existir). Permite re-tentar estratégia se assinatura mudou.
  const ineffKey = new Set();
  for (const x of (ineffectiveStrategies || [])) {
    if (!x || typeof x !== 'object') continue;
    const st = String(x.strategyType || '');
    if (!st) continue;
    // Assinatura: se tem stall, erro recorrente, ou fase específica — faz parte da key
    const sigParts = [];
    if (typeof x.reason === 'string') {
      const sig = x.reason.slice(0, 60).replace(/\s+/g,' ').trim();
      sigParts.push(sig);
    }
    // Condição de similaridade: se o mesmo motivo base acontece, NÃO repete
    ineffKey.add(st + '::' + (sigParts[0] || '*'));
    // Também bloqueia genericamente se acumulou 3+ da mesma estratégia (qualquer motivo)
    const sameTypeCount = (ineffectiveStrategies || []).filter(y => y && typeof y==='object' && y.strategyType === st).length;
    if (sameTypeCount >= 3) ineff.add(st);
  }

  function _candidate(strategyType, description, extra) {
    if (ineff.has(strategyType)) return;
    alt.push({
      strategyType,
      description,
      expectedROI: 0.5,
      estimatedCost: 1,
      riskLevel: 'low',
      ...(extra || {})
    });
  }

  _candidate(
    'HEURISTIC_DEFAULT',
    'Usar heurística existente (escolha de tarefa por fase + prioridade + dependências).',
    { expectedROI: 0.65, estimatedCost: 1, riskLevel: 'low', reason: 'Caminho validado por histórico.' }
  );

  // GAP 2 FIX: SEMPRE propor PRIORITY_FIRST_UNBLOCKED também (pega 1ª tarefa
  // pronta com maior prioridade dependente). Complementa a heurística default.
  if (pendingReady.length >= 1) {
    _candidate(
      'PRIORITY_FIRST_UNBLOCKED',
      'Executar a 1ª tarefa pronta com maior prioridade (por dependências e agent).',
      { expectedROI: 0.6, estimatedCost: 1, riskLevel: 'low', reason: `Existem ${pendingReady.length} tarefas prontas para execução.` }
    );
  }

  if (hypotheses.some(h => h.id === 'H_CORRECAO_DIRIGIDA_POR_TESTE')) {
    _candidate(
      'CORRECT_FIRST_FAIL_FAST',
      'Primeiro resolver falhas de testes antes de qualquer nova implementação.',
      { expectedROI: 0.8, estimatedCost: 2, riskLevel: 'low', reason: 'Falhas de teste tem causa raiz mais localizada.' }
    );
    _candidate(
      'TEST_DRIVEN_FIX',
      'Roda testes, identifica arquivos com falha, aplica correção e reexecuta testes em loop até passar.',
      { expectedROI: 0.85, estimatedCost: 3, riskLevel: 'medium', reason: 'Feedback rápido por teste.' }
    );
  }

  if (pendingReady.some(t => t && t.agent === 'SECURITY') && currentPhase !== 'COMPLETED') {
    _candidate(
      'SECURITY_AUDIT_FIRST',
      'Executar auditoria/autofix de segurança antes de novas features.',
      { expectedROI: 0.7, estimatedCost: 3, riskLevel: 'medium', reason: 'Vulnerabilidades podem inviabilizar entrega final §19.' }
    );
  }

  if (hypotheses.some(h => h.id === 'H_STALL_DETECTADO' || h.id === 'H_ERRO_RECORRENTE')) {
    _candidate(
      'MINI_STEP_BACKTRACK',
      'Dividir a próxima tarefa em 2+ mini-passos verificáveis, ou rollback ao último checkpoint com sucesso.',
      { expectedROI: 0.6, estimatedCost: 2, riskLevel: 'medium', reason: 'Stall indica granularidade inadequada; mini-passos permitem isolar falha.' }
    );
  }

  if (hypotheses.some(h => h.id === 'H_ESTRATEGIA_INEFICAZ_ANTERIOR') || ineff.size > 0) {
    // Quando estratégia foi ineficaz, propor RESEARCH_THEN_EXECUTE e TEST_DRIVEN_FIX
    // para obter mais evidência antes de executar cegamente.
    _candidate(
      'RESEARCH_THEN_EXECUTE',
      'Primeiro analisar arquivos/estado/endpoints do projeto; depois executar com plano ajustado.',
      { expectedROI: 0.55, estimatedCost: 2, riskLevel: 'low', reason: `Há ${ineff.size} estratégia(s) ineficaz(es); precisa de mais evidência.` }
    );
    _candidate(
      'TEST_DRIVEN_FIX',
      'Executar testes existentes primeiro; basear a próxima decisão no resultado real dos testes.',
      { expectedROI: 0.7, estimatedCost: 2, riskLevel: 'low', reason: 'Evidencia por teste > heurística.' }
    );
  }

  if (pendingReady.length > 2) {
    _candidate(
      'PARALLEL_READY_BY_AGENT_TYPE',
      'Selecionar tarefas prontas de agentes complementares (ex: 1 DEV + 1 QA se ambos prontos).',
      { expectedROI: 0.55, estimatedCost: 1, riskLevel: 'low', reason: 'Quando há muitas candidatas, diversificar tipo reduz dependências em cascata.' }
    );
  }

  const req = state?.requisitos?.detection || {};
  if ((req.needsInternet || req.needsWhatsApp || req.needsPayment) && !(state?.internetAuthorization && state.internetAuthorization.authorizedAt)) {
    _candidate(
      'RESEARCH_THEN_EXECUTE',
      'Antes de executar, solicitar autorização de pesquisa para confirmar versões/documentação atualizada.',
      { expectedROI: 0.5, estimatedCost: 2, riskLevel: 'low', reason: 'Integrações externas desatualizadas geram retrabalho.' }
    );
  }

  if (alt.length === 0) {
    alt.push({
      strategyType: 'HEURISTIC_DEFAULT',
      description: 'Fallback: usar heurística padrão (todas outras ineficazes).',
      expectedROI: 0.3,
      estimatedCost: 1,
      riskLevel: 'high',
      reason: 'Única estratégia restante; risco de stall contínuo elevado.'
    });
  }

  return alt.slice(0, 5);
}

function _evaluateAndSelect(alternatives, hypotheses, evaluationCriteria) {
  const criteria = evaluationCriteria && Array.isArray(evaluationCriteria) && evaluationCriteria.length
    ? evaluationCriteria
    : [
        { name: 'progresso_esperado', weight: 0.35 },
        { name: 'custo_estimado',   weight: 0.2 },
        { name: 'risco',            weight: 0.25 },
        { name: 'evidencia_historica', weight: 0.2 }
      ];

  const riskScore = { low: 1, medium: 0.6, high: 0.25 };
  const stallHyp = hypotheses.find(h => h.id === 'H_STALL_DETECTADO');
  const recErrHyp = hypotheses.find(h => h.id === 'H_ERRO_RECORRENTE');

  const scored = alternatives.map(a => {
    let c1 = Math.max(0, Math.min(1, typeof a.expectedROI === 'number' ? a.expectedROI : 0.5));
    let riskLvl = String(a.riskLevel || 'low').toLowerCase();
    if (stallHyp && a.strategyType === 'HEURISTIC_DEFAULT') c1 = Math.min(c1, 0.25);
    if (stallHyp && a.strategyType === 'MINI_STEP_BACKTRACK') c1 = Math.max(c1, 0.8);
    const c2 = 1 - Math.min(1, (typeof a.estimatedCost === 'number' ? a.estimatedCost : 1) / 8);
    if (stallHyp && a.strategyType === 'MINI_STEP_BACKTRACK') riskLvl = 'low';
    if (recErrHyp && a.strategyType === 'CORRECT_FIRST_FAIL_FAST') riskLvl = 'low';
    const c3 = riskScore[riskLvl] ?? 0.5;
    let c4 = 0.6;
    if (stallHyp && a.strategyType === 'MINI_STEP_BACKTRACK') c4 = 0.95;
    if (recErrHyp && (a.strategyType === 'CORRECT_FIRST_FAIL_FAST' || a.strategyType === 'MINI_STEP_BACKTRACK')) c4 = Math.max(c4, 0.9);
    if (a.strategyType === 'HEURISTIC_DEFAULT' && (stallHyp || recErrHyp)) c4 = 0.25;

    const rawScore =
      c1 * (criteria[0]?.weight || 0.25) +
      c2 * (criteria[1]?.weight || 0.25) +
      c3 * (criteria[2]?.weight || 0.25) +
      c4 * (criteria[3]?.weight || 0.25);

    return { alt: a, rawScore, components: { c1, c2, c3, c4 } };
  });

  scored.sort((A, B) => B.rawScore - A.rawScore);
  const best = scored[0];
  const confidence = best ? Math.max(0, Math.min(1, best.rawScore)) : 0.2;
  return {
    selected: best ? best.alt : (alternatives[0] || { strategyType: 'HEURISTIC_DEFAULT', description: 'nenhuma alternativa' }),
    scored: scored.map(s => ({
      strategyType: s.alt.strategyType,
      score: Number(s.rawScore.toFixed(3)),
      risk: s.alt.riskLevel
    })),
    confidence
  };
}

function _buildSuccessCriteria(state, selectedStrategy, nextAction) {
  const criteria = [];
  const ph = state?.faseGeral || 'IMPLEMENTATION';
  if (nextAction && nextAction.action === 'EXECUTE_TASK') {
    criteria.push(`tarefa_${nextAction.taskId || 'unknown'}_status=completed`);
    criteria.push(`após_execucao: sem_novos_erros_em_errosEncontrados`);
  }
  if (nextAction && nextAction.action === 'ADVANCE_PHASE') {
    criteria.push(`faseGeral=COMPLETED ou nova fase com tarefas pendentes reduzidas`);
  }
  if (nextAction && nextAction.action === 'CONCLUDE') {
    criteria.push(`buildCompletionGate_retornou_0_blockers`);
  }
  if (selectedStrategy && (selectedStrategy.strategyType === 'MINI_STEP_BACKTRACK' || selectedStrategy.strategyType === 'CORRECT_FIRST_FAIL_FAST')) {
    criteria.push(`decisionEngine.progressMetrics.noProgressStreak < valor_anterior`);
  }
  if (criteria.length === 0) criteria.push(`progresso_medido: tarefas concluidas aumentou OU gate_19_atingido`);
  return criteria.slice(0, 5);
}

function _buildRisks(selectedStrategy, hypotheses, alternativesCount) {
  const risks = [];
  if (selectedStrategy?.riskLevel === 'high') {
    risks.push({ id: 'R_ALTA', severity: 'high', description: 'Estratégia marcada como alto risco; preparar rollback.' });
  }
  if (hypotheses.some(h => h.id === 'H_ERRO_RECORRENTE')) {
    risks.push({ id: 'R_RECORRENCIA', severity: 'medium', description: 'Erro recorrente pode persistir sem diagnóstico mais profundo.' });
  }
  if (hypotheses.some(h => h.id === 'H_STALL_DETECTADO')) {
    risks.push({ id: 'R_STALL_CONTINUA', severity: 'medium', description: 'Stall pode continuar se a nova estratégia também for ineficaz.' });
  }
  if (alternativesCount <= 1) {
    risks.push({ id: 'R_SEM_ALTERNATIVAS', severity: 'high', description: 'Apenas 1 estratégia disponível; se falhar, requer intervenção humana.' });
  }
  return risks;
}

function _buildFallbackStrategy(selectedStrategy, alternatives) {
  const primaryType = selectedStrategy?.strategyType || 'HEURISTIC_DEFAULT';
  const other = (alternatives || []).filter(a => a.strategyType !== primaryType);
  if (other.length > 0) {
    return {
      strategyType: other[0].strategyType,
      trigger: `SE ${primaryType} não gerar progresso em 1 ciclo OU 1 novo erro recorrente`,
      description: other[0].description,
      rollbackToLastCheckpoint: (other[0].strategyType === 'MINI_STEP_BACKTRACK')
    };
  }
  return {
    strategyType: 'HEURISTIC_DEFAULT',
    trigger: 'Qualquer falha ou ausência de progresso',
    description: 'Fallback para heurística segura padrão.',
    rollbackToLastCheckpoint: false
  };
}

function _deriveNextActionFromStrategy(state, opts, selectedStrategy, hypotheses) {
  const currentPhase = state?.faseGeral || 'IMPLEMENTATION';
  const stall = hypotheses.find(h => h.id === 'H_STALL_DETECTADO');
  const recorr = hypotheses.find(h => h.id === 'H_ERRO_RECORRENTE');
  const type = selectedStrategy?.strategyType || 'HEURISTIC_DEFAULT';

  if (type === 'RESEARCH_THEN_EXECUTE') {
    if (!(state.internetAuthorization && state.internetAuthorization.authorizedAt)) {
      return {
        action: 'AWAIT_WS_INTERNET',
        reason: 'Estratégia RESEARCH_THEN_EXECUTE requer autorização internet §8/§9.',
        heuristic: 'strategia_research_requer_auth_internet',
        version: RC28_DECISION_VERSION
      };
    }
  }

  if (type === 'MINI_STEP_BACKTRACK' && (stall || recorr)) {
    const pendingReady = pendingNotBlocked(state);
    if (pendingReady.length > 0) {
      const t = pendingReady[0];
      return {
        action: 'EXECUTE_TASK',
        taskId: t.id,
        reason: `Estratégia MINI_STEP_BACKTRACK: iniciar pela primeira tarefa pronta, confirmando passo a passo após stall.`,
        heuristic: 'strategia_mini_step_primeira_pronta',
        version: RC28_DECISION_VERSION
      };
    }
  }

  if (type === 'CORRECT_FIRST_FAIL_FAST') {
    const pendingReady = pendingNotBlocked(state);
    const qaOrTest = pendingReady.find(t => t && (t.agent === 'QA' || t.agent === 'TEST' || t.agent === 'DEVELOPER'));
    if (qaOrTest) {
      return {
        action: 'EXECUTE_TASK',
        taskId: qaOrTest.id,
        reason: 'Estratégia CORRECT_FIRST_FAIL_FAST: priorizar QA/TEST/DEV para corrigir falhas medidas.',
        heuristic: 'strategia_correct_first_prioriza_qatest',
        version: RC28_DECISION_VERSION
      };
    }
  }

  if (type === 'SECURITY_AUDIT_FIRST') {
    const pendingReady = pendingNotBlocked(state);
    const sec = pendingReady.find(t => t && t.agent === 'SECURITY');
    if (sec) {
      return {
        action: 'EXECUTE_TASK',
        taskId: sec.id,
        reason: 'Estratégia SECURITY_AUDIT_FIRST: executar tarefa SECURITY pendente.',
        heuristic: 'strategia_security_first',
        version: RC28_DECISION_VERSION
      };
    }
    if (phaseIndex(currentPhase) < phaseIndex('VALIDATION')) {
      return {
        action: 'ADVANCE_PHASE',
        phaseTo: 'VALIDATION',
        reason: 'Estratégia SECURITY_AUDIT_FIRST: avançar para VALIDATION para disparar auditoria.',
        heuristic: 'strategia_security_avanca_validation',
        version: RC28_DECISION_VERSION
      };
    }
  }

  if (type === 'PARALLEL_READY_BY_AGENT_TYPE') {
    const pendingReady = pendingNotBlocked(state);
    const byAgent = {};
    for (const t of pendingReady) {
      const a = t?.agent || 'OTHER';
      if (!byAgent[a]) byAgent[a] = t;
    }
    const diverse = Object.values(byAgent);
    if (diverse.length >= 1) {
      const t = chooseTaskHeuristically(diverse, currentPhase) || diverse[0];
      return {
        action: 'EXECUTE_TASK',
        taskId: t.id,
        reason: 'Estratégia PARALLEL_READY_BY_AGENT_TYPE: escolher heurística dentre as famílias de agentes prontos.',
        heuristic: 'strategia_parallel_por_agente',
        candidates: diverse.map(x => x.id),
        version: RC28_DECISION_VERSION
      };
    }
  }

  return rc28DecideNext(state, opts);
}

// ============================================================
//  NÍVEL 2 · analyzeAndDecide  (NOVO ENGINE ADAPTATIVO)
//
//  Entrada mínima:
//    { objetivo, estadoAtual, contextoProjeto, restricoes,
//      ferramentasDisponiveis, historicoAcoes, resultadosAnteriores,
//      errosEncontrados, hipotesesExistentes, estrategiasAnteriores,
//      engineMode?, confidenceThreshold?, llmAnalyzeFn?, step?, maxCycles?,
//      rc24Bridge? }
//
//  Saída estruturada (12 campos):
//    { analysis, hypotheses, alternatives, evaluationCriteria,
//      selectedStrategy, selectionReason, expectedResult,
//      nextAction, successCriteria, risks, fallbackStrategy,
//      _meta: { engineVersion, mode, confidence, scoredAlternatives } }
// ============================================================
export function analyzeAndDecide(input = {}) {
  const {
    objetivo = '',
    estadoAtual = null,
    contextoProjeto = null,
    restricoes = null,
    ferramentasDisponiveis = null,
    historicoAcoes = null,
    resultadosAnteriores = null,
    errosEncontrados = null,
    hipotesesExistentes = null,
    estrategiasAnteriores = null,
    engineMode = undefined,
    confidenceThreshold = undefined,
    llmAnalyzeFn = null,
    step = null,
    maxCycles = null,
    rc24Bridge = null
  } = input;

  const state = estadoAtual && typeof estadoAtual === 'object' ? estadoAtual : {};
  const realErros = Array.isArray(errosEncontrados) ? errosEncontrados
    : (Array.isArray(state.errosEncontrados) ? state.errosEncontrados : []);
  const realHist = Array.isArray(historicoAcoes) ? historicoAcoes
    : (Array.isArray(state.decisionTrace) ? state.decisionTrace : []);
  const realResult = Array.isArray(resultadosAnteriores) ? resultadosAnteriores
    : (Array.isArray(state.tentativasRealizadas) ? state.tentativasRealizadas : []);
  const realRestr = Array.isArray(restricoes) ? restricoes
    : (Array.isArray(state.limitacoes) ? state.limitacoes : []);
  const realIneff = state?.decisionEngine?.ineffectiveStrategies || [];

  const engineOpts = {
    step: typeof step === 'number' ? step : null,
    maxCycles: typeof maxCycles === 'number' ? maxCycles : null,
    engineMode,
    confidenceThreshold,
    rc24Bridge: typeof rc24Bridge === 'function' ? rc24Bridge : null
  };

  const mode = _resolveDecisionEngineMode(state, engineOpts);
  const thresh = _resolveConfidenceThreshold(state, engineOpts);
  let confidence = 0.5;

  const _fallbackStructured = (legacyDecision, reasonFallback) => {
    const analysis = _buildAnalysisSnippet({ state, contextoProjeto, restricoes: realRestr, historicoAcoes: realHist, resultadosAnteriores: realResult, errosEncontrados: realErros });
    const hyps = _generateHypotheses({ state, errosEncontrados: realErros, estrategiasAnteriores, objetivo });
    // GAP 2 FIX: fallback não hardcoda mais HEURISTIC_DEFAULT único.
    // Gera alternativas de verdade usando _generateAlternatives, que RESPEITA
    // ineffectiveStrategies Set (L447-L451), e avalia com _evaluateAndSelect
    // (L537-555, incluindo peso MINI_STEP_BACKTRACK qdo stall≥2).
    // Se todas alternativas são ineficazes, ainda usa o fallback default (sem ineficaz).
    const altsBase = _generateAlternatives({ state, hypotheses: hyps, estrategiasAnteriores, ineffectiveStrategies: realIneff });
    const altsHasHd = altsBase.some(a => a && a.strategyType === 'HEURISTIC_DEFAULT');
    let alts;
    if (altsBase.length === 0 || (altsBase.length === 1 && altsHasHd && realIneff.some(x => x && x.strategyType === 'HEURISTIC_DEFAULT'))) {
      // Todas bloqueadas → usar fallback final SEM o filtro (risco alto, mas pelo menos progresso)
      alts = [{
        strategyType: 'HEURISTIC_DEFAULT',
        description: 'Fallback final: todas estratégias bloqueadas. Reexecutar heurística.',
        expectedROI: 0.3, estimatedCost: 1, riskLevel: 'high',
        reason: 'Única estratégia restante.'
      }];
    } else {
      alts = altsBase;
    }
    const criteria = [
      { name: 'progresso_esperado', weight: 0.35 },
      { name: 'custo_estimado',   weight: 0.2  },
      { name: 'risco',            weight: 0.25 },
      { name: 'evidencia_historica', weight: 0.2 }
    ];
    const evaluated = _evaluateAndSelect(alts, hyps, criteria);
    const strategy = evaluated.selected || alts[0] || { strategyType: 'HEURISTIC_DEFAULT', description: 'fallback' };
    confidence = evaluated.confidence || 0.5;
    const scoredAlt = evaluated.scored || [{ strategyType: strategy.strategyType, score: 0.55, risk: strategy.riskLevel }];
    return {
      analysis,
      hypotheses: _normalizeArray(hipotesesExistentes && Array.isArray(hipotesesExistentes) && hipotesesExistentes.length ? hipotesesExistentes : hyps, 8),
      alternatives: alts.slice(0, 5),
      evaluationCriteria: criteria,
      selectedStrategy: strategy,
      selectionReason: reasonFallback || 'Modo padrão heurístico (kill-switch RC28_ENGINE=heuristic OU falha layer adaptativo).',
      expectedResult: `Aplicar ${legacyDecision?.action || 'HUMAN_REVIEW'} com progresso incremental medido.`,
      nextAction: legacyDecision || { action: 'HUMAN_REVIEW', reason: 'fallback_legado_sem_decisao' },
      successCriteria: _buildSuccessCriteria(state, strategy, legacyDecision),
      risks: _buildRisks(strategy, hyps, alts.length),
      fallbackStrategy: _buildFallbackStrategy(strategy, alts),
      _meta: {
        engineVersion: ENGINE_VERSION,
        mode,
        confidence: Math.max(0.3, confidence),
        scoredAlternatives: scoredAlt,
        legacyUsed: true,
        fallbackReason: reasonFallback || null
      }
    };
  };

  try {
    if (mode !== 'adaptive') {
      return _fallbackStructured(rc28DecideNext(state, engineOpts), `engineMode=${mode}, usando heurística padrão.`);
    }

    const analysis = _buildAnalysisSnippet({ state, contextoProjeto, restricoes: realRestr, historicoAcoes: realHist, resultadosAnteriores: realResult, errosEncontrados: realErros });
    const hypothesesNew = _generateHypotheses({ state, errosEncontrados: realErros, estrategiasAnteriores, objetivo });
    const hypothesesMerged = (hipotesesExistentes && Array.isArray(hipotesesExistentes) && hipotesesExistentes.length)
      ? hipotesesExistentes.concat(hypothesesNew).slice(0, 8)
      : hypothesesNew;

    const alternatives = _generateAlternatives({ state, hypotheses: hypothesesMerged, estrategiasAnteriores, ineffectiveStrategies: realIneff });
    const evaluationCriteria = [
      { name: 'progresso_esperado', weight: 0.35 },
      { name: 'custo_estimado',   weight: 0.2  },
      { name: 'risco',            weight: 0.25 },
      { name: 'evidencia_historica', weight: 0.2 }
    ];

    const evaluated = _evaluateAndSelect(alternatives, hypothesesMerged, evaluationCriteria);
    const selectedStrategy = evaluated.selected;
    confidence = evaluated.confidence;

    let llmEnhanced = false;
    if (typeof llmAnalyzeFn === 'function' && confidence < thresh) {
      try {
        const llmPayload = {
          objetivo: String(objetivo || '').slice(0, 400),
          analysis,
          hypotheses: hypothesesMerged.map(h => ({ id: h.id, statement: h.statement, confidence: h.confidence })),
          alternatives: alternatives.map(a => ({ strategyType: a.strategyType, description: a.description, expectedROI: a.expectedROI, risk: a.riskLevel })),
          currentConfidence: confidence,
          threshold: thresh,
          constraints: realRestr.slice(0, 5),
          lastErrors: realErros.slice(-3).map(e => typeof e === 'object' ? ({ message: String(e.message || '').slice(0, 200), loop: e.loop || null }) : String(e).slice(0, 200))
        };
        const res = Promise.resolve(llmAnalyzeFn(llmPayload)).catch(() => null);
        if (res && typeof res.then === 'function') {
          // Chamada síncrona não espera; se o caller quiser async, ele deve usar
          // analyzeAndDecideAsync abaixo. Aqui só marcamos se foi possível sincronamente.
        } else if (res && typeof res === 'object') {
          if (Array.isArray(res.alternatives) && res.alternatives.length) {
            for (let i = 0; i < Math.min(2, res.alternatives.length); i++) {
              const ra = res.alternatives[i];
              if (ra && typeof ra === 'object' && ra.strategyType) {
                alternatives.push(Object.assign({ expectedROI: 0.5, estimatedCost: 1, riskLevel: 'medium' }, ra));
              }
            }
            const re = _evaluateAndSelect(alternatives, hypothesesMerged, evaluationCriteria);
            evaluated.selected = re.selected;
            evaluated.scored = re.scored;
            confidence = re.confidence;
            Object.assign(selectedStrategy, re.selected);
            llmEnhanced = true;
          }
        }
      } catch {
        // LLM é opcional; se falhar, ignora sem quebrar nada.
      }
    }

    const scoredAlt = evaluated.scored || [];
    const nextAction = _deriveNextActionFromStrategy(state, engineOpts, selectedStrategy, hypothesesMerged);
    const successCriteria = _buildSuccessCriteria(state, selectedStrategy, nextAction);
    const risks = _buildRisks(selectedStrategy, hypothesesMerged, alternatives.length);
    const fallbackStrategy = _buildFallbackStrategy(selectedStrategy, alternatives);

    const selectionReason = [
      `Estratégia selecionada: ${selectedStrategy.strategyType}.`,
      `Confiança=${(confidence * 100).toFixed(0)}% (threshold=${(thresh * 100).toFixed(0)}%).`,
      selectedStrategy.reason ? selectedStrategy.reason : '',
      `Score entre ${alternatives.length} alternativas: top=${scoredAlt[0]?.score || '?'} vs segunda=${scoredAlt[1]?.score || '?'}.`
    ].filter(Boolean).join(' ');

    const expectedResult = `Aplicar estratégia ${selectedStrategy.strategyType}: ${selectedStrategy.description || ''} Espera-se: ${successCriteria.join(' ; ')}.`;

    return {
      analysis,
      hypotheses: hypothesesMerged.slice(0, 5),
      alternatives: alternatives.slice(0, 5),
      evaluationCriteria,
      selectedStrategy: {
        strategyType: selectedStrategy.strategyType,
        description: selectedStrategy.description || '',
        estimatedCost: selectedStrategy.estimatedCost,
        expectedROI: selectedStrategy.expectedROI,
        riskLevel: selectedStrategy.riskLevel || 'low'
      },
      selectionReason,
      expectedResult,
      nextAction,
      successCriteria,
      risks,
      fallbackStrategy,
      _meta: {
        engineVersion: ENGINE_VERSION,
        mode,
        confidence,
        threshold: thresh,
        scoredAlternatives: scoredAlt.slice(0, 5),
        llmEnhanced,
        legacyUsed: false
      }
    };
  } catch (e) {
    try {
      return _fallbackStructured(rc28DecideNext(state, engineOpts), `Engine adaptativo lançou exceção: ${String(e && e.message || e).slice(0, 140)}. Fallback seguro.`);
    } catch (e2) {
      return _fallbackStructured({ action: 'HUMAN_REVIEW', reason: 'erro_engine_total_fallback' }, `Falha dupla no engine: ${String(e2 && e2.message || e2).slice(0, 140)}.`);
    }
  }
}

export async function analyzeAndDecideAsync(input) {
  const llmAsync = input && typeof input.llmAnalyzeFn === 'function' ? input.llmAnalyzeFn : null;
  if (!llmAsync) return analyzeAndDecide(input);
  let enriched = input;
  try {
    const preview = analyzeAndDecide(Object.assign({}, input, { llmAnalyzeFn: null }));
    if (preview._meta && preview._meta.confidence < (preview._meta.threshold || 0.7)) {
      const llmPayload = {
        objetivo: String(input?.objetivo || '').slice(0, 800),
        analysis: preview.analysis,
        hypotheses: preview.hypotheses.map(h => ({ id: h.id, statement: h.statement, confidence: h.confidence, evidence: h.evidence })),
        alternatives: preview.alternatives.map(a => ({ strategyType: a.strategyType, description: a.description, expectedROI: a.expectedROI, risk: a.riskLevel })),
        currentConfidence: preview._meta.confidence,
        threshold: preview._meta.threshold || 0.7,
        lastDecision: input?.estadoAtual?.decisionEngine?.lastDecision || null,
        lastMeasuredResult: input?.estadoAtual?.decisionEngine?.lastMeasuredResult || null,
        ineffectiveStrategies: input?.estadoAtual?.decisionEngine?.ineffectiveStrategies || []
      };
      const r = await Promise.resolve(llmAsync(llmPayload)).catch(() => null);
      if (r && typeof r === 'object') {
        const mergedAlt = Array.isArray(r.alternatives)
          ? preview.alternatives.concat(r.alternatives.filter(Boolean)).slice(0, 5)
          : preview.alternatives;
        const mergedHyp = Array.isArray(r.hypotheses)
          ? preview.hypotheses.concat(r.hypotheses.filter(Boolean)).slice(0, 5)
          : preview.hypotheses;
        enriched = Object.assign({}, input, {
          _overrideAlternatives: mergedAlt,
          _overrideHypotheses: mergedHyp,
          llmAnalyzeFn: null
        });
      }
    }
  } catch {}
  return analyzeAndDecide(enriched);
}

export function diagnoseFailureAndUpdateHypotheses({ state, previousDecision, actualResult, strategiesTriedAppend }) {
  if (!state || typeof state !== 'object') return { patch: {}, hypotheses: [], discardedStrategies: [] };
  const de = state.decisionEngine || {};
  const prevHyp = Array.isArray(de.hypotheses) ? de.hypotheses.slice() : [];
  const prevInef = Array.isArray(de.ineffectiveStrategies) ? de.ineffectiveStrategies.slice() : [];
  const prevTried = Array.isArray(de.strategiesTried) ? de.strategiesTried.slice() : [];
  const prevAlt = Array.isArray(de.alternativesHistory) ? de.alternativesHistory.slice() : [];

  const discarded = [];
  const strategy = previousDecision?.selectedStrategy?.strategyType || null;
  const ok = actualResult && typeof actualResult === 'object' && actualResult.success === true;

  if (!ok && strategy) {
    const record = {
      strategyType: strategy,
      discardedAtMs: Date.now(),
      reason: actualResult?.failReason || 'resultado_nao_atendeu_successCriteria',
      cycle: typeof actualResult?.cycle === 'number' ? actualResult.cycle : null
    };
    prevInef.push(record);
    discarded.push(record);
  }
  if (strategy) {
    prevTried.push({
      strategyType: strategy,
      success: Boolean(ok),
      atMs: Date.now(),
      resultSummary: actualResult ? String(actualResult.summary || '').slice(0, 200) : ''
    });
  }
  if (Array.isArray(strategiesTriedAppend)) {
    for (const x of strategiesTriedAppend) prevTried.push(Object.assign({ atMs: Date.now() }, x));
  }
  for (let i = 0; i < prevHyp.length; i++) {
    const h = prevHyp[i];
    if (h && typeof h === 'object') {
      if (ok && h.id === 'H_STALL_DETECTADO') prevHyp[i] = Object.assign({}, h, { invalidated: true, invalidatedAtMs: Date.now(), confidence: Math.max(0, (h.confidence || 0) - 0.3) });
      if (ok && h.id === 'H_ERRO_RECORRENTE') prevHyp[i] = Object.assign({}, h, { invalidated: true, invalidatedAtMs: Date.now(), confidence: Math.max(0, (h.confidence || 0) - 0.4) });
    }
  }
  if (previousDecision) {
    prevAlt.push({
      atMs: Date.now(),
      selectedStrategy: strategy,
      alternativesCount: Array.isArray(previousDecision.alternatives) ? previousDecision.alternatives.length : 0,
      outcome: ok ? 'success' : 'failure',
      summary: actualResult?.summary || ''
    });
  }

  const metrics = Object.assign({ totalCycles: 0, cyclesWithProgress: 0, lastProgressAtMs: 0, noProgressStreak: 0, objectiveProgressPct: 0 }, de.progressMetrics || {});
  metrics.totalCycles += 1;
  if (ok) {
    metrics.cyclesWithProgress += 1;
    metrics.lastProgressAtMs = Date.now();
    metrics.noProgressStreak = 0;
    const total = Array.isArray(state.tarefas) ? state.tarefas.length : 0;
    const doneTasks = Array.isArray(state.tarefas) ? state.tarefas.filter(t => t && t.status === 'completed').length : 0;
    const arquivosMod = Array.isArray(state.arquivosModificados) ? state.arquivosModificados.length : 0;
    // GAP3 ETAPA6: objectiveProgressPct PONDERADO — NÃO é só done/total.
    // 2 eixos (sem quebrar arquitetura engine com importações externas):
    //   Eixo 1 (60%): tarefas realmente completas (feito/total)
    //   Eixo 2 (40%): arquivos modificados na sessão (objetivo requer implementação = arquivos novos/alterados)
    //                 teto=100% quando >=4 arquivos modificados
    const eixoTarefas = total > 0 ? (doneTasks / total) : 0;
    const eixoArquivos = Math.min(1, arquivosMod / 4);
    // Tarefas completas sem nenhum arquivo modificado? → NÃO pode chegar a 100% (teto 60%)
    const rawProgress = (eixoTarefas * 0.60) + (eixoArquivos * 0.40);
    metrics.objectiveProgressPct = Math.min(100, Math.round(rawProgress * 100));
  } else {
    metrics.noProgressStreak += 1;
  }

  const MAX = 200;
  while (prevHyp.length > MAX) prevHyp.shift();
  while (prevInef.length > MAX) prevInef.shift();
  while (prevTried.length > MAX) prevTried.shift();
  while (prevAlt.length > MAX) prevAlt.shift();

  const patch = {
    decisionEngine: Object.assign({}, de, {
      hypotheses: prevHyp,
      ineffectiveStrategies: prevInef,
      strategiesTried: prevTried,
      alternativesHistory: prevAlt,
      lastDecision: previousDecision ? {
        selectedStrategy: strategy,
        selectionReason: String(previousDecision.selectionReason || '').slice(0, 500),
        nextAction: previousDecision.nextAction,
        decidedAtMs: Date.now()
      } : (de.lastDecision || null),
      lastMeasuredResult: actualResult ? Object.assign({}, actualResult, { measuredAtMs: Date.now() }) : (de.lastMeasuredResult || null),
      progressMetrics: metrics
    })
  };
  return { patch, hypotheses: prevHyp, discardedStrategies: discarded };
}

export const RC28_DECISOR_VERSION = RC28_DECISION_VERSION;
export const RC28_ENGINE_VERSION = ENGINE_VERSION;

// ================================================================
//  RC29 · PONTO F · Re-export do verificador de objetivo (camada
//  Engine consome do core RC29). Outros módulos (server.js,
//  integrações) podem importar daqui sem conhecer o arquivo core.
// ================================================================
export function rc28_rc29VerifyObjectiveAgainstState(objective, state, opts) {
  return RC29.rc29VerifyObjectiveAgainstState(objective, state, opts || {});
}

export default rc28DecideNext;

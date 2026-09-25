// ============================================================================
//  RC28 · rc28_decision_loop.js
//  Loop de DECISÃO + EXECUÇÃO tarefa a tarefa (G01/G04/G05/G07/G08).
//  - Early gate se RC28 off (zero overhead)
//  - Máximo RC28_MAX_CYCLES=40 ciclos anti-loop §17
//  - Reusa makeSessionTools(session, ws) 15 tools existentes
//  - Reusa runAgentLoopLegacyOriginal com escopo reduzido para cada tarefa
//  - Usa autoCorrectionLoop já existente do tiagent_orc_motor.js em testes
//  - Checkpoint a cada N ciclos
//  - Gate conclusão §19 rígido
//
//  RC28.1 NOVO (camada adaptativa):
//  - Usa Decision Engine de 12 campos (analyzeAndDecide) em engineMode='adaptive'
//  - Após cada execução: mede sucesso p/ successCriteria, atualiza hipóteses,
//    descarta estratégia ineficaz, aciona fallback automático.
//  - Kill-switch: engineMode='heuristic' DEFAULT = comportamento antigo 100%
// ============================================================================
import {
  loadOrInitCentralState,
  mergePatchCentralState,
  createCheckpoint
} from './tiagent_orc_fs.js';
import { assignTaskContext } from './agent_orchestrator.js';
import {
  rc28DecideNext,
  analyzeAndDecide,
  diagnoseFailureAndUpdateHypotheses
} from './rc28_decision_engine.js';
import { autoCorrectionLoop } from './tiagent_orc_motor.js';
// RC29 Autonomy Core (camada ACIMA do RC28, aditiva, NÃO substitui)
import * as RC29 from './rc29_autonomy_core.js';

const RC28_LOOP_VERSION = 'rc28.1.loop.v2';

export function _rc28PhaseLabel(fase) {
  const m = {
    ANALYSIS: 'Análise', PLANNING: 'Planejamento', ARCHITECTURE: 'Arquitetura',
    IMPLEMENTATION: 'Implementação', TESTS: 'Testes', CORRECTIONS: 'Correções',
    VALIDATION: 'Validação', COMPLETED: 'Concluído', BLOCKED: 'Bloqueado'
  };
  return m[fase] || fase || 'Fase';
}

function _emitWs(ws, type, payload) {
  try { if (ws && typeof ws.send === 'function') ws.send(JSON.stringify({ type, ...payload })); } catch {}
}

function _mergeDecidePatchAndTrace(d, step, phaseFrom, phaseTo) {
  const trace = {
    action: d && d.action,
    taskId: d && d.taskId || null,
    reason: d && d.reason || '',
    heuristic: d && d.heuristic || '',
    candidates: d && d.candidates || [],
    bridgeUsed: d && d.bridgeUsed || null,
    step,
    phaseFrom: phaseFrom || null,
    phaseTo: phaseTo || (d && d.phaseTo) || null,
    v: RC28_LOOP_VERSION
  };
  return { _rc28Decision: trace };
}

function _mergeDecideV2Patch(fullDecision, step, phaseFrom) {
  if (!fullDecision || typeof fullDecision !== 'object') return {};
  return { _rc28DecisionV2: fullDecision };
}

function _measureSuccessAgainstCriteria({ stateBefore, stateAfter, taskId, nextAction, successCriteria, runResult }) {
  const criteria = Array.isArray(successCriteria) ? successCriteria : [];
  if (criteria.length === 0) {
    return {
      success: !!(runResult && runResult.ok),
      criteriaPassed: [],
      criteriaFailed: [],
      summary: (runResult && runResult.ok) ? 'sem_successCriteria_mas_run_ok' : 'sem_successCriteria_e_run_falhou'
    };
  }
  const passed = [];
  const failed = [];
  for (const raw of criteria) {
    const c = String(raw || '');
    let ok = false;
    try {
      if (nextAction && nextAction.action === 'EXECUTE_TASK' && c.startsWith('tarefa_') && c.includes('_status=completed')) {
        const tarefas = Array.isArray(stateAfter?.tarefas) ? stateAfter.tarefas : [];
        const t = tarefas.find(x => String(x.id) === String(taskId || nextAction.taskId));
        if (t && t.status === 'completed') ok = true;
        else failed.push({ c, detail: `tarefa status=${t ? t.status : 'not_found'}` });
      } else if (/sem_novos_erros/.test(c)) {
        const before = Array.isArray(stateBefore?.errosEncontrados) ? stateBefore.errosEncontrados.length : 0;
        const after = Array.isArray(stateAfter?.errosEncontrados) ? stateAfter.errosEncontrados.length : 0;
        if (after <= before) ok = true;
        else failed.push({ c, detail: `errosEncontrados.length subiu ${before}→${after}` });
      } else if (/buildCompletionGate_retornou_0_blockers/.test(c)) {
        if (stateAfter && typeof stateAfter === 'object') {
          const blockers = [];
          const total = Array.isArray(stateAfter.tarefas) ? stateAfter.tarefas.length : 0;
          const done = Array.isArray(stateAfter.tarefas) ? stateAfter.tarefas.filter(t => t && t.status === 'completed').length : 0;
          if (done < total) blockers.push(1);
          const lastT = Array.isArray(stateAfter.testesExecutadosResultados) ? stateAfter.testesExecutadosResultados.slice(-1)[0] : null;
          if (lastT && typeof lastT.fail === 'number' && lastT.fail > 0) blockers.push(2);
          const secScores = (Array.isArray(stateAfter.testesExecutadosResultados) ? stateAfter.testesExecutadosResultados : []).filter(x => x && typeof x.securityScore === 'number');
          const lastSec = secScores[secScores.length - 1];
          if (lastSec && lastSec.securityScore < 80) blockers.push(3);
          if (blockers.length === 0) ok = true; else failed.push({ c, detail: `blockers=${blockers.length}` });
        } else failed.push({ c, detail: 'sem stateAfter' });
      } else if (/faseGeral=COMPLETED/.test(c) || /tarefas pendentes reduzidas/.test(c)) {
        if (stateAfter?.faseGeral === 'COMPLETED') ok = true;
        else {
          const pendB = Array.isArray(stateBefore?.tarefas) ? stateBefore.tarefas.filter(t => t && t.status !== 'completed').length : 0;
          const pendA = Array.isArray(stateAfter?.tarefas) ? stateAfter.tarefas.filter(t => t && t.status !== 'completed').length : 0;
          if (pendA < pendB) ok = true;
          else failed.push({ c, detail: `pendentes ${pendB}→${pendA}` });
        }
      } else if (/noProgressStreak < valor_anterior/.test(c)) {
        const before = stateBefore?.decisionEngine?.progressMetrics?.noProgressStreak ?? 0;
        const after = stateAfter?.decisionEngine?.progressMetrics?.noProgressStreak ?? 0;
        if (after < before) ok = true;
        else failed.push({ c, detail: `streak ${before}→${after}` });
      } else if (/progresso_medido/.test(c)) {
        const doneB = Array.isArray(stateBefore?.tarefas) ? stateBefore.tarefas.filter(t => t && t.status === 'completed').length : 0;
        const doneA = Array.isArray(stateAfter?.tarefas) ? stateAfter.tarefas.filter(t => t && t.status === 'completed').length : 0;
        if (doneA > doneB || stateAfter?.faseGeral === 'COMPLETED') ok = true;
        else failed.push({ c, detail: `concluídas ${doneB}→${doneA}` });
      } else {
        // Critério não mapeado: default = ok SE runResult.ok
        if (runResult && runResult.ok) ok = true;
        else failed.push({ c, detail: 'criterio_nao_mapeado_e_run_nao_ok' });
      }
    } catch (e) {
      failed.push({ c, detail: 'excecao: ' + String(e && e.message || e).slice(0, 120) });
    }
    if (ok) passed.push(c);
  }
  const success = passed.length > 0 && failed.length === 0
    ? true
    : (passed.length >= Math.ceil(criteria.length / 2));
  return {
    success,
    criteriaPassed: passed,
    criteriaFailed: failed,
    summary: `critérios ${passed.length}/${criteria.length}`
  };
}

export async function rc28RunDecisionLoop(opts) {
  const {
    ws, session, projectDir, centralState: initialCentralState,
    rc27Enabled, rc28Enabled,
    rc28MaxCycles = 40,
    rc28CheckpointEvery = 5,
    rc28Verbose = false,
    rc28ForceAfterPlan = false,
    makeToolsFn,
    runLegacyAgentFn,
    rc24BridgeFn = null,
    rc28EngineMode = 'heuristic',
    rc28ConfidenceThreshold = 0.7,
    rc28LlmAnalyzeFn = null,
    objetivoUsuario = ''
  } = opts || {};

  // Early gate HARD — primeira linha
  if (!rc28Enabled || !rc27Enabled) {
    return { handled: false, rc28: 'off', skipped: true, reason: 'rc28_gate_off' };
  }
  if (!projectDir) return { handled: false, rc28: 'bad_args', skipped: true, reason: 'project_dir_vazio' };

  let centralState = initialCentralState && typeof initialCentralState === 'object' ? initialCentralState : null;
  if (!centralState) {
    const loaded = await loadOrInitCentralState({ projectDir });
    centralState = loaded.state;
  }

  // Garante campos RC28 mesmo em estados antigos (migração forward)
  // GAP 1 FIX: SEMPRE sincroniza decisionEngine.mode com o rc28EngineMode do
  // loop (que veio de ENV / globalThis). Se o state foi salvo anteriormente com
  // mode='heuristic' mas agora RC28_ENGINE=adaptive, atualiza. Também garante
  // adaptiveConstraints.confidenceThreshold = rc28ConfidenceThreshold.
  {
    const needsSeed = !centralState.decisionEngine || typeof centralState.decisionEngine !== 'object';
    const deBefore = centralState.decisionEngine || {};
    const patchDe = {
      decisionEngine: {
        engineVersion: deBefore.engineVersion || 'rc28.decision.v1',
        // GAP 1 FIX: valor vem do parâmetro rc28EngineMode (prioridade).
        // Se rc28EngineMode='adaptive' → mode sempre 'adaptive' enquanto durar a sessão.
        // Se rc28EngineMode='heuristic' → preserva state.mode se setado, senão 'heuristic'.
        mode: rc28EngineMode === 'adaptive'
          ? 'adaptive'
          : (rc28EngineMode === 'heuristic' ? 'heuristic' : (String(deBefore.mode || 'heuristic').toLowerCase() === 'adaptive' ? 'adaptive' : 'heuristic')),
        hypotheses: Array.isArray(deBefore.hypotheses) ? deBefore.hypotheses : [],
        strategiesTried: Array.isArray(deBefore.strategiesTried) ? deBefore.strategiesTried : [],
        ineffectiveStrategies: Array.isArray(deBefore.ineffectiveStrategies) ? deBefore.ineffectiveStrategies : [],
        alternativesHistory: Array.isArray(deBefore.alternativesHistory) ? deBefore.alternativesHistory : [],
        progressMetrics: Object.assign(
          { totalCycles: 0, cyclesWithProgress: 0, lastProgressAtMs: 0, noProgressStreak: 0, objectiveProgressPct: 0 },
          (deBefore.progressMetrics && typeof deBefore.progressMetrics === 'object') ? deBefore.progressMetrics : {}
        ),
        lastDecision: deBefore.lastDecision || null,
        lastMeasuredResult: deBefore.lastMeasuredResult || null,
        adaptiveConstraints: Object.assign(
          { maxCycles: rc28MaxCycles, maxStrategies: null, confidenceThreshold: rc28ConfidenceThreshold },
          (deBefore.adaptiveConstraints && typeof deBefore.adaptiveConstraints === 'object') ? deBefore.adaptiveConstraints : {},
          // GAP 1 FIX: SEMPRE sobrescreve confidenceThreshold para o da sessão atual
          { confidenceThreshold: typeof rc28ConfidenceThreshold === 'number' && isFinite(rc28ConfidenceThreshold) ? rc28ConfidenceThreshold : 0.7,
            maxCycles: Number.isFinite(rc28MaxCycles) ? rc28MaxCycles : (deBefore.adaptiveConstraints?.maxCycles || null) }
        )
      }
    };
    if (needsSeed || centralState.decisionEngine.mode !== patchDe.decisionEngine.mode ||
        Math.abs((centralState.decisionEngine.adaptiveConstraints?.confidenceThreshold ?? -1) - rc28ConfidenceThreshold) > 1e-9) {
      const seed = await mergePatchCentralState({ projectDir, patch: patchDe });
      centralState = seed.state;
    }
  }

  // ==========================================================================
  //  ETAPA 7 · CORREÇÃO · ISOLAMENTO DO OBJETIVO NO RC28
  //  - NÃO HÁ MAIS fallback para centralState.objetivoAtual (antiga linha
  //    objetivoUsuario || centralState.objetivoAtual). Esse fallback era o
  //    principal vetor de contaminação PetShop/Clínica.
  //  - Se objetivoUsuario veio vazio → early return ERRO (handled:false)
  //    para cair no RC22 legado; em hipótese alguma o RC28 usa valor antigo
  //    de disco como objetivo da execução ATUAL.
  //  - O valor objetivoUsuario é salvo em decisionEngine.objetivoSeedadoAtual
  //    para ser usado no gate §19 OBJECTIVE_VERIFIED (verifica apenas o
  //    objetivo da solicitação ATUAL, não de execuções passadas).
  // ==========================================================================
  {
    const _objetivoRaw = String(objetivoUsuario || '').trim();
    if (!_objetivoRaw) {
      return {
        handled: false,
        rc28: 'ETAPA7_BLOQUEIO_OBJETIVO_VAZIO',
        skipped: true,
        reason: 'RC28 SEM objetivoUsuario + fallback centralState DESATIVADO na ETAPA7. Impossível continuar sem objetivo da solicitação ATUAL.',
        steps: 0
      };
    }
    // Seed do objetivo no decisionEngine para uso posterior em OBJECTIVE_VERIFIED.
    // ================================================================
    //  RC29 · PONTO E · Seed do autonomyRuntime NO RC28 tbm
    //  - Se não existir ou objetivo diferenca → reset com rc29InitRuntime
    //  - Merge no patch junto com decisionEngine (1 write só, não 2)
    // ================================================================
    try {
      const before = (centralState.decisionEngine && typeof centralState.decisionEngine === 'object') ? centralState.decisionEngine : {};
      const patchSeed = {
        decisionEngine: Object.assign({}, before, {
          objetivoSeedadoAtual: _objetivoRaw.slice(0, 2000),
          objetivoOrigem: String(before.objetivoOrigem || (centralState.objetivoOrigem || 'NOVA_SOLICITACAO')),
          etapa7Isolated: true,
          etapa7SeedAtMs: Date.now()
        })
      };
      const runtimeAtual = centralState && centralState.autonomyRuntime && typeof centralState.autonomyRuntime === 'object' ? centralState.autonomyRuntime : null;
      const precisaResetRuntime = !runtimeAtual
        || typeof runtimeAtual.objective !== 'string'
        || String(runtimeAtual.objective).slice(0, 2000) !== String(_objetivoRaw).slice(0, 2000);
      if (precisaResetRuntime) {
        patchSeed.autonomyRuntime = RC29.rc29InitRuntime({ objective: _objetivoRaw });
      }
      const _patched = await mergePatchCentralState({ projectDir, patch: patchSeed });
      if (_patched && _patched.ok) centralState = _patched.state;
    } catch {}
  }
  const objetivoFinal = String(objetivoUsuario || '').slice(0, 2000);

  _emitWs(ws, 'orch:phase', {
    fase: centralState.faseGeral, label: _rc28PhaseLabel('IMPLEMENTATION'),
    info: `🧲 RC28 Engine LIGADO (mode=${rc28EngineMode}, maxCycles=${rc28MaxCycles}). ${
      rc28EngineMode === 'adaptive'
        ? 'Decision Engine adaptativo de 12 campos ATIVADO.'
        : 'Modo heurístico padrão (kill-switch SAFE DEFAULT).'
    }`
  });

  const maxCycles = Math.max(8, Math.min(400, parseInt(rc28MaxCycles || 40, 10)));
  let step = 0;
  let handledFinal = { handled: false, reason: 'rc28_fim_sem_handled', state: centralState, steps: 0, rc28: 'ok' };
  let fallbackUsedThisCycle = 0;
  const MAX_FALLBACK_PER_STEP = 2;

  while (step < maxCycles) {
    step++;
    const phaseBefore = centralState.faseGeral;
    const stateBeforeStep = centralState;

    // 1. Decision Engine de 12 campos (camada adaptativa)
    let fullDecision = null;
    let decide = null;
    // GAP 1 FIX (L214): engineModeNow tem 3 fontes, em ordem de prioridade:
    //   1) parâmetro do loop rc28EngineMode (vem de ENV/globalThis via tiagent_orc_motor)
    //   2) centralState.decisionEngine.mode (persistido)
    //   3) fallback heurística segura
    // Não há mais AND duplo. Se rc28EngineMode='adaptive' SEMPRE entra adaptive.
    const engineModeNow = (
      rc28EngineMode === 'adaptive'
        ? 'adaptive'
        : (rc28EngineMode === 'heuristic'
           ? 'heuristic'
           : (centralState.decisionEngine?.mode === 'adaptive' ? 'adaptive' : 'heuristic'))
    );

    try {
      const engineInput = {
        objetivo: objetivoFinal,
        estadoAtual: centralState,
        contextoProjeto: {
          projectDir,
          stack: centralState.tecnologias ? `${centralState.tecnologias.lang||'?'}+${centralState.tecnologias.framework||'?'}` : null
        },
        restricoes: Array.isArray(centralState.limitacoes) ? centralState.limitacoes : [],
        ferramentasDisponiveis: Array.isArray(centralState.ferramentasDisponiveis) ? centralState.ferramentasDisponiveis : null,
        historicoAcoes: Array.isArray(centralState.decisionTrace) ? centralState.decisionTrace.slice(-50) : [],
        resultadosAnteriores: Array.isArray(centralState.tentativasRealizadas) ? centralState.tentativasRealizadas.slice(-30) : [],
        errosEncontrados: Array.isArray(centralState.errosEncontrados) ? centralState.errosEncontrados.slice(-20) : [],
        hipotesesExistentes: centralState.decisionEngine?.hypotheses || [],
        estrategiasAnteriores: centralState.decisionEngine?.strategiesTried || [],
        // GAP 1 FIX: passa SEMPRE engineModeNow (jamais força heuristic aqui)
        engineMode: engineModeNow,
        confidenceThreshold: rc28ConfidenceThreshold,
        llmAnalyzeFn: engineModeNow === 'adaptive' && typeof rc28LlmAnalyzeFn === 'function' ? rc28LlmAnalyzeFn : null,
        step,
        maxCycles,
        rc24Bridge: typeof rc24BridgeFn === 'function' ? rc24BridgeFn : undefined
      };
      if (engineModeNow === 'adaptive') {
        // GAP 1 + GAP 2 FIX: em adaptive, rodar analyzeAndDecide para gerar alternativas
        // e scoredAlternatives de verdade. A chamada da LLM síncrona é placeholder; se
        // precisar async real, analyzeAndDecideAsync retorna o patch completo.
        fullDecision = analyzeAndDecide(engineInput);
        decide = fullDecision && fullDecision.nextAction && typeof fullDecision.nextAction === 'object' &&
                 typeof fullDecision.nextAction.action === 'string'
          ? fullDecision.nextAction
          : rc28DecideNext(centralState, { step, maxCycles, rc24Bridge: engineInput.rc24Bridge });
      } else {
        // modo heuristic: decisão rápida por rc28DecideNext, mas também gera
        // a estrutura completa de 12 campos (com alternatives count >= 1) p/ trace.
        decide = rc28DecideNext(centralState, { step, maxCycles, rc24Bridge: engineInput.rc24Bridge });
        fullDecision = analyzeAndDecide(Object.assign({}, engineInput, { engineMode: 'heuristic' }));
      }
    } catch (e) {
      decide = rc28DecideNext(centralState, { step, maxCycles });
      fullDecision = null;
      if (rc28Verbose) console.log(`[RC28 step=${step}] engine falhou: ${String(e && e.message || e).slice(0,120)} — fallback heurística`);
    }

    if (rc28Verbose) {
      console.log(`[RC28 step=${step}/${maxCycles} mode=${engineModeNow}] action=${decide.action} ${decide.taskId ? 'task=' + decide.taskId : ''} reason=${String(decide.reason||'').slice(0,140)}`);
      if (fullDecision && fullDecision.selectedStrategy) {
        console.log(`[RC28 step=${step}] strategy=${fullDecision.selectedStrategy.strategyType} conf=${(fullDecision._meta?.confidence||0).toFixed(2)} scored=${JSON.stringify(fullDecision._meta?.scoredAlternatives||[])}`);
      }
    }

    // 1b. Persistir decisão V2 (12 campos) + trace legado
    {
      const patchV2 = _mergeDecideV2Patch(fullDecision, step, phaseBefore);
      const traceLegacy = _mergeDecidePatchAndTrace(decide, step, phaseBefore);
      if (Object.keys(patchV2).length || Object.keys(traceLegacy).length) {
        const m0 = await mergePatchCentralState({ projectDir, patch: { ...traceLegacy, ...patchV2 } });
        centralState = m0.state;
      }
    }

    // 2. Ações de FLUXO (não consomem tools)
    if (decide.action === 'ADVANCE_PHASE') {
      const phaseTo = decide.phaseTo || (['ANALYSIS','PLANNING','ARCHITECTURE','IMPLEMENTATION','TESTS','CORRECTIONS','VALIDATION','COMPLETED'][
        Math.min(7, ['ANALYSIS','PLANNING','ARCHITECTURE','IMPLEMENTATION','TESTS','CORRECTIONS','VALIDATION','COMPLETED'].indexOf(phaseBefore) + 1)
      ]);
      const patch = { faseGeral: phaseTo, proximaAcao: `RC28_FASE_${phaseTo}`, ..._mergeDecidePatchAndTrace(decide, step, phaseBefore, phaseTo) };
      const m = await mergePatchCentralState({ projectDir, patch });
      centralState = m.state;
      _emitWs(ws, 'orch:phase', { fase: phaseTo, label: _rc28PhaseLabel(phaseTo), info: `Step ${step}/${maxCycles}: RC28 avançou fase → ${phaseTo}. Motivo: ${String(decide.reason||'').slice(0, 100)}` });

      // Diagnóstico adaptativo pós fase avançada
      const measured = _measureSuccessAgainstCriteria({
        stateBefore: stateBeforeStep, stateAfter: centralState,
        nextAction: decide, successCriteria: fullDecision?.successCriteria, runResult: { ok: true }
      });
      const diag = diagnoseFailureAndUpdateHypotheses({
        state: centralState, previousDecision: fullDecision,
        actualResult: { success: measured.success, summary: `avançou_fase_${phaseTo} · ${measured.summary}`, cycle: step }
      });
      if (diag.patch && Object.keys(diag.patch).length) {
        const mm = await mergePatchCentralState({ projectDir, patch: diag.patch });
        centralState = mm.state;
      }

      if (phaseTo === 'COMPLETED') {
        handledFinal = { handled: true, rc28: 'completed', steps: step, state: centralState, reason: 'fase_completed_via_advance_phase' };
        break;
      }
      continue;
    }

    if (decide.action === 'CONCLUDE') {
      // ==============================================================
      //  RC29 · PONTO D(b) · GATE RÍGIDO PRÉ-CONCLUDE
      //  REGRA FUNDAMENTAL: TASK_COMPLETED ≠ OBJECTIVE_VERIFIED.
      //  → Se RC28 decidiu CONCLUDE mas RC29 ainda não validou,
      //    NÃO concluir. Rodar verifyAgainstState, marcar stall,
      //    só deixar passar se tudo estiver OK.
      // ==============================================================
      const rc29PreState = centralState || {};
      const rc29PreRuntime = rc29PreState.autonomyRuntime || RC29.rc29InitRuntime({ objective: String(objetivoUsuario||'') });
      if (rc29PreRuntime.objectiveVerified !== true) {
        // Run verification
        const rc29Verify = RC29.rc29VerifyObjectiveAgainstState(String(objetivoUsuario||''), rc29PreState, {
          tarefas: Array.isArray(rc29PreState.tarefas) ? rc29PreState.tarefas : [],
          testesResults: Array.isArray(rc29PreState.testesExecutadosResultados) ? rc29PreState.testesExecutadosResultados : [],
          qaLastResult: rc29PreState.qaLastResult || null,
          needsPersistence: rc29PreState.needsPersistence === true,
        });
        // Stall tick sem progresso real e salvar patch
        const runtimeAfterVerify = rc29Verify.verified === true
          ? { ...rc29PreRuntime, objectiveVerified: true, lastVerificationReason: rc29Verify.reason, nextAction: 'Objetivo verificado. Concluir.' }
          : RC29.rc29StallTick({
              ...rc29PreRuntime,
              lastVerificationReason: rc29Verify.reason,
              nextAction: rc29Verify.nextActionSuggested || 'RC29 bloqueou CONCLUDE, re-tentar sem progresso.',
            }, { hadProgress: false, stallMaxCycles: Math.max(8, Math.floor(maxCycles * 0.4)) });

        // Stall >= blocked → gerar bloqueio INFORMATION_MISSING/RESOURCE_MISSING
        let runtimeFinal = runtimeAfterVerify;
        if (!rc29Verify.verified && runtimeAfterVerify.stall && runtimeAfterVerify.stall.status === 'blocked') {
          // Detecta se foi RESOURCE ou INFORMATION
          const kind = /persist|banco|arquivo|libs?|lib |npm |node-|build |deploy|workspace|remote|worker/i.test(rc29Verify.reason + ' ' + (rc29Verify.nextActionSuggested||''))
            ? 'RESOURCE_MISSING' : 'INFORMATION_MISSING';
          const block = RC29.rc29BuildBlockingReason({
            kind,
            title: kind === 'RESOURCE_MISSING'
              ? 'Recurso ausente para concluir o objetivo'
              : 'Informação insuficiente para confirmar que o objetivo foi atingido',
            detail: `RC29 bloqueou o CONCLUDE automático após ${String(runtimeAfterVerify.stall.cyclesNoProgress||'?')} ciclos sem progresso · ${String(rc29Verify.reason||'').slice(0, 400)}`,
            userActionRequired: kind === 'RESOURCE_MISSING'
              ? 'Instale o recurso/dependência necessária (ex: npm install, configure banco remoto, autorize workspace) e reenvie o objetivo como continuação.'
              : 'Adicione mais contexto ao objetivo (ex: qual API, qual página, qual formato de dados) ou clique em Continuar mesmo assim (próxima versão).',
          });
          runtimeFinal = RC29.rc29ApplyBlockingReason(runtimeAfterVerify, block);
          _emitWs(ws, 'orch:blocked', {
            kind: block.kind,
            title: block.title,
            detail: block.detail,
            userActionRequired: block.userActionRequired,
            blockedAtMs: block.blockedAtMs,
            phase: 'VALIDATION',
            objectiveProgressPct: Number(runtimeFinal.objectiveProgressPct || 0),
            rc28Step: step,
            rc28MaxCycles: maxCycles,
          });
          // Escreve o patch (stall + bloqueio)
          try {
            const mB = await mergePatchCentralState({ projectDir, patch: { autonomyRuntime: runtimeFinal, statusExecucao: 'blocked', proximaAcao: 'RC29_BLOQUEIO_' + block.kind, faseGeral: 'BLOCKED' } });
            if (mB && mB.ok) centralState = mB.state;
          } catch {}
          handledFinal = { handled: true, rc28: 'blocked_rc29_' + block.kind, steps: step, state: centralState, reason: 'rc29_blocked_' + block.kind };
          break;
        }
        // Apenas não-verificado mas não bloqueado ainda → patch stall + continue loop
        let patchPre = { autonomyRuntime: runtimeFinal, proximaAcao: rc29Verify.nextActionSuggested ? ('RC29_REVERIFICAR: ' + String(rc29Verify.nextActionSuggested).slice(0,300)) : 'RC29_REVERIFICAR_ANTES_DE_CONCLUIR' };
        // Se houver evidências de tarefas pendentes, setar fase IMPLEMENTATION para RC28 re-executar
        if (rc29Verify.nextActionSuggested && /corrig|pendente|falh/i.test(rc29Verify.nextActionSuggested)) {
          patchPre.faseGeral = 'CORRECTIONS';
          patchPre.statusExecucao = 'running';
        }
        const mPre = await mergePatchCentralState({ projectDir, patch: patchPre });
        if (mPre && mPre.ok) centralState = mPre.state;
        _emitWs(ws, 'orch:phase', {
          fase: centralState.faseGeral || phaseBefore || 'IMPLEMENTATION',
          label: _rc28PhaseLabel('VALIDATION') + ' · RC29 validando',
          info: `Step ${step}/${maxCycles}: RC29 bloqueou CONCLUDE (verified=${rc29Verify.verified}). ${String(rc29Verify.reason||'').slice(0, 200)}`,
          verified: rc29Verify.verified,
          evidence: rc29Verify.evidence || [],
          suggested: rc29Verify.nextActionSuggested || null,
        });
        continue; // ← MANTÉM LOOP! Não deixa CONCLUDE.
      }
      const patch = { faseGeral: 'COMPLETED', statusExecucao: 'completed', proximaAcao: 'CONCLUIDO_OK_GATE_19', ..._mergeDecidePatchAndTrace(decide, step, phaseBefore, 'COMPLETED') };
      const m = await mergePatchCentralState({ projectDir, patch });
      centralState = m.state;
      const measured = _measureSuccessAgainstCriteria({
        stateBefore: stateBeforeStep, stateAfter: centralState,
        nextAction: decide, successCriteria: fullDecision?.successCriteria, runResult: { ok: true }
      });
      const diag = diagnoseFailureAndUpdateHypotheses({
        state: centralState, previousDecision: fullDecision,
        actualResult: { success: true, summary: `gate_19_passou · ${measured.summary}`, cycle: step }
      });
      if (diag.patch && Object.keys(diag.patch).length) {
        await mergePatchCentralState({ projectDir, patch: diag.patch });
      }
      _emitWs(ws, 'orch:phase', { fase: 'COMPLETED', label: _rc28PhaseLabel('COMPLETED'), info: `✅ RC28 concluiu após ${step} ciclos · critérios §19 PASS.` });
      handledFinal = { handled: true, rc28: 'completed_gate_19', steps: step, state: centralState, reason: 'gate_19_passou_concluiu' };
      break;
    }

    if (decide.action === 'HUMAN_REVIEW') {
      const patch = { faseGeral: 'BLOCKED', statusExecucao: 'blocked', proximaAcao: 'AGUARDA_INTERVENCAO_HUMANA_RC28', blockedReason: decide.reason || 'HUMAN_REVIEW', ..._mergeDecidePatchAndTrace(decide, step, phaseBefore, 'BLOCKED') };
      const m = await mergePatchCentralState({ projectDir, patch });
      centralState = m.state;
      const diag = diagnoseFailureAndUpdateHypotheses({
        state: centralState, previousDecision: fullDecision,
        actualResult: { success: false, summary: `human_review · ${String(decide.reason||'').slice(0,160)}`, failReason: decide.reason || 'HUMAN_REVIEW', cycle: step }
      });
      if (diag.patch && Object.keys(diag.patch).length) await mergePatchCentralState({ projectDir, patch: diag.patch });
      _emitWs(ws, 'orch:human_intervention_needed', {
        taskId: null, level: 'warn', step, maxCycles,
        finalReason: decide.reason || 'HUMAN_REVIEW',
        userMessage: `🧲 RC28 (step ${step}/${maxCycles}): ${decide.reason || 'Intervenção humana necessária.'}`,
      });
      handledFinal = { handled: true, rc28: 'blocked_human', steps: step, state: centralState, reason: 'human_review_blocked' };
      break;
    }

    if (decide.action === 'WAIT_OR_CORRECT') {
      if (phaseBefore === 'TESTS' && Array.isArray(centralState.testesExecutadosResultados) && centralState.testesExecutadosResultados.length > 0) {
        const patch = { faseGeral: 'CORRECTIONS', proximaAcao: 'APLICAR_CORRECOES_AUTOMATICAS', ..._mergeDecidePatchAndTrace(decide, step, phaseBefore, 'CORRECTIONS') };
        const m = await mergePatchCentralState({ projectDir, patch });
        centralState = m.state;
        _emitWs(ws, 'orch:phase', { fase: 'CORRECTIONS', label: _rc28PhaseLabel('CORRECTIONS'), info: `Step ${step}/${maxCycles}: sem candidatas → entrou em CORRECTIONS.` });
        const devPending = (centralState.tarefas||[]).find(t => t && (t.status === 'pending' || t.status === 'in_progress') && (t.agent === 'DEVELOPER' || t.agent === 'QA'));
        if (devPending) {
          const run = await _rc28RunSingleTask({ ws, session, projectDir, centralState, task: devPending, makeToolsFn, runLegacyAgentFn });
          centralState = run.newState || centralState;
          const measured = _measureSuccessAgainstCriteria({
            stateBefore: stateBeforeStep, stateAfter: centralState,
            nextAction: { action: 'EXECUTE_TASK', taskId: devPending.id },
            successCriteria: fullDecision?.successCriteria, runResult: run
          });
          const diag = diagnoseFailureAndUpdateHypotheses({
            state: centralState, previousDecision: fullDecision,
            actualResult: { success: measured.success, summary: `wait_or_correct_auto · ${measured.summary}`, failReason: run.reason || null, cycle: step }
          });
          if (diag.patch && Object.keys(diag.patch).length) {
            const pp = await mergePatchCentralState({ projectDir, patch: diag.patch });
            centralState = pp.state;
          }
          if (run.ok) {
            const patchAfter = await mergePatchCentralState({ projectDir, patch: { statusExecucao: 'running' } });
            centralState = patchAfter.state;
          }
          continue;
        }
      }
      const patch = { statusExecucao: 'running', ..._mergeDecidePatchAndTrace(decide, step, phaseBefore) };
      const m = await mergePatchCentralState({ projectDir, patch });
      centralState = m.state;
      _emitWs(ws, 'orch:phase', { fase: phaseBefore, label: _rc28PhaseLabel(phaseBefore), info: `Step ${step}/${maxCycles}: ${decide.reason || 'sem candidatas'}. Esperando próxima iteração.` });
      continue;
    }

    if (decide.action === 'AWAIT_WS_INTERNET' || decide.action === 'AWAIT_WS_HUMAN') {
      const pausedStatus = decide.action === 'AWAIT_WS_INTERNET' ? 'paused_awaiting_internet' : 'paused_awaiting_human';
      const patch = { statusExecucao: pausedStatus, proximaAcao: pausedStatus.toUpperCase(), ..._mergeDecidePatchAndTrace(decide, step, phaseBefore) };
      const m = await mergePatchCentralState({ projectDir, patch });
      centralState = m.state;
      handledFinal = { handled: true, rc28: decide.action, steps: step, state: centralState, reason: 'await_ws_' + pausedStatus, paused: pausedStatus };
      break;
    }

    if (decide.action === 'EXECUTE_TASK') {
      const task = centralState.tarefas && Array.isArray(centralState.tarefas)
        ? centralState.tarefas.find(t => String(t.id) === String(decide.taskId))
        : null;
      if (!task) {
        continue;
      }
      await mergePatchCentralState({ projectDir, patch: { tarefaEmExecucaoId: task.id } });
      _emitWs(ws, 'orch:phase', {
        fase: phaseBefore,
        label: _rc28PhaseLabel(phaseBefore),
        info: `Step ${step}/${maxCycles}: executando tarefa [${task.id}] · ${task.agent||'?'} · ${String(task.title||'').slice(0, 80)} · estratégia=${fullDecision?.selectedStrategy?.strategyType || 'HEURISTIC_DEFAULT'}`
      });

      const runResult = await _rc28RunSingleTask({
        ws, session, projectDir, centralState, task, makeToolsFn, runLegacyAgentFn,
        maxCorrectionPasses: 4,
        rc28Verbose
      });
      centralState = runResult.newState || centralState;

      const tarefas = (centralState.tarefas || []).slice();
      const idx = tarefas.findIndex(t => String(t.id) === String(task.id));
      let taskEndStatus = runResult.ok ? 'completed' : 'blocked';
      let measured = _measureSuccessAgainstCriteria({
        stateBefore: stateBeforeStep, stateAfter: centralState,
        taskId: task.id, nextAction: decide,
        successCriteria: fullDecision?.successCriteria, runResult
      });

      // RC28.1 ADAPTATIVO: se primeira estratégia falhou E temos fallback,
      // executa o fallbackStrategy (até MAX_FALLBACK_PER_STEP vezes no mesmo step)
      let fallbackUsed = 0;
      while (!runResult.ok && fallbackUsed < MAX_FALLBACK_PER_STEP &&
             fullDecision && fullDecision.fallbackStrategy &&
             engineModeNow === 'adaptive') {
        fallbackUsed++;
        fallbackUsedThisCycle++;
        const fbk = fullDecision.fallbackStrategy;
        if (rc28Verbose) console.log(`[RC28 step=${step}] FALLBACK #${fallbackUsed} → ${fbk.strategyType} trigger=${fbk.trigger}`);
        _emitWs(ws, 'orch:phase', {
          fase: phaseBefore, label: _rc28PhaseLabel(phaseBefore),
          info: `🔄 Step ${step}/${maxCycles}: estratégia primária falhou. Usando fallback=${fbk.strategyType}.`
        });
        if (fbk.rollbackToLastCheckpoint) {
          try {
            const lastCp = Array.isArray(centralState.checkpoints) && centralState.checkpoints.length
              ? centralState.checkpoints[centralState.checkpoints.length - 1]
              : null;
            if (lastCp && rc28Verbose) console.log(`[RC28 step=${step}] rollback checkpoint (placeholder) id=${lastCp.id}`);
          } catch {}
        }
        const fallbackTaskCandidate = (centralState.tarefas||[]).find(t => t && (t.status === 'pending' || t.status === 'in_progress'));
        if (fallbackTaskCandidate) {
          const fbkRun = await _rc28RunSingleTask({
            ws, session, projectDir, centralState, task: fallbackTaskCandidate, makeToolsFn, runLegacyAgentFn,
            maxCorrectionPasses: 4, rc28Verbose
          });
          centralState = fbkRun.newState || centralState;
          const fidx = tarefas.findIndex(t => String(t.id) === String(fallbackTaskCandidate.id));
          if (fidx !== -1) tarefas[fidx] = { ...tarefas[fidx], status: fbkRun.ok ? 'completed' : 'blocked', updatedAtMs: Date.now(), motivoBloqueio: fbkRun.ok ? null : (fbkRun.reason || 'fallback_falhou') };
          if (fbkRun.ok) {
            runResult.ok = true;
            taskEndStatus = 'completed';
            measured = _measureSuccessAgainstCriteria({
              stateBefore: stateBeforeStep, stateAfter: centralState,
              taskId: fallbackTaskCandidate.id, nextAction: { action: 'EXECUTE_TASK', taskId: fallbackTaskCandidate.id },
              successCriteria: fullDecision?.successCriteria, runResult: fbkRun
            });
            measured.summary = `via_fallback_${fbk.strategyType} · ${measured.summary}`;
            break;
          }
        }
        break; // 1 fallback por while (evita spin)
      }

      if (idx !== -1) {
        tarefas[idx] = {
          ...tarefas[idx],
          status: taskEndStatus,
          updatedAtMs: Date.now(),
          motivoBloqueio: runResult.ok ? null : (runResult.reason || 'falhou')
        };
        const patchT = { tarefas, tarefaEmExecucaoId: null, statusExecucao: 'running' };
        const mm = await mergePatchCentralState({ projectDir, patch: patchT });
        centralState = mm.state;
      }

      // Diagnóstico adaptativo: atualiza hipóteses, descarta estratégia, acumula métricas
      const diag = diagnoseFailureAndUpdateHypotheses({
        state: centralState, previousDecision: fullDecision,
        actualResult: {
          success: measured.success,
          summary: measured.summary + (runResult.ok ? '' : ` · motivo=${String(runResult.reason||'').slice(0,200)}`),
          failReason: runResult.ok ? null : (runResult.reason || 'falha_desconhecida'),
          cycle: step,
          taskId: task.id
        }
      });
      if (diag.patch && Object.keys(diag.patch).length) {
        const mm2 = await mergePatchCentralState({ projectDir, patch: diag.patch });
        centralState = mm2.state;
      }
      if (diag.discardedStrategies && diag.discardedStrategies.length && rc28Verbose) {
        console.log(`[RC28 step=${step}] estratégia(s) descartada(s): ${JSON.stringify(diag.discardedStrategies.map(x=>x.strategyType))}`);
      }

      _emitWs(ws, 'orch:phase', {
        fase: phaseBefore, label: _rc28PhaseLabel(phaseBefore),
        info: (runResult.ok ? `✅ Tarefa ${task.id} OK` : `⚠️ Tarefa ${task.id} falhou (${String(runResult.reason||'').slice(0, 80)})`) +
              ` · step ${step}/${maxCycles} · ${measured.summary}` +
              (diag.discardedStrategies?.length ? ` · descartadas=${diag.discardedStrategies.length}` : '')
      });

      // ================================================================
      //  RC29 · PONTO D(a) · PÓS EXECUTE_TASK
      //  1) Registra resultado da tarefa em autonomyRuntime (completed/failed)
      //  2) Computa progresso ponderado 60/25/15
      //  3) Se 100% tarefas concluídas → rodar verifyObjective
      //  4) Se verify pass → objectiveVerified=true (libera Pré-CONCLUDE)
      // ================================================================
      try {
        const baseRuntime = centralState.autonomyRuntime || RC29.rc29InitRuntime({ objective: String(objetivoUsuario||'') });
        let runtimePatched = RC29.rc29RecordTaskResult(baseRuntime, {
          taskId: task.id,
          status: runResult.ok ? 'completed' : 'failed',
          errorSummary: runResult.ok ? null : String(runResult.reason || 'tarefa_falhou').slice(0, 500),
        });
        const tarefasAtualizadas = Array.isArray(centralState.tarefas) ? centralState.tarefas : [];
        runtimePatched = RC29.rc29ComputeProgress(
          runtimePatched,
          tarefasAtualizadas,
          Array.isArray(centralState.testesExecutadosResultados) ? centralState.testesExecutadosResultados : [],
          centralState.qaLastResult || null
        );
        runtimePatched.currentTaskId = null;
        // 3) 100% tarefas concluídas? → rodar verificação
        const total = tarefasAtualizadas.length;
        const done = tarefasAtualizadas.filter(t => t && (t.status === 'completed' || t.status === 'cancelled')).length;
        const allDone = total > 0 && done >= total;
        if (allDone && runtimePatched.objectiveVerified !== true) {
          const vrf = RC29.rc29VerifyObjectiveAgainstState(String(objetivoUsuario||''), centralState, {
            tarefas: tarefasAtualizadas,
            testesResults: Array.isArray(centralState.testesExecutadosResultados) ? centralState.testesExecutadosResultados : [],
            qaLastResult: centralState.qaLastResult || null,
            needsPersistence: centralState.needsPersistence === true,
          });
          runtimePatched.lastVerificationReason = vrf.reason;
          runtimePatched.nextAction = vrf.nextActionSuggested || runtimePatched.nextAction;
          if (vrf.verified === true) {
            runtimePatched.objectiveVerified = true;
            _emitWs(ws, 'orch:phase', {
              fase: 'VALIDATION',
              label: '✅ RC29 · objetivo verificado pós-tarefas',
              info: String(vrf.reason || '').slice(0, 240),
              evidence: vrf.evidence || [],
              objectiveProgressPct: runtimePatched.objectiveProgressPct,
            });
          } else {
            // Stall se tem tarefas 100% mas não passou verificação
            runtimePatched = RC29.rc29StallTick(runtimePatched, { hadProgress: false, stallMaxCycles: Math.max(8, Math.floor(maxCycles * 0.4)) });
          }
        } else if (runResult.ok) {
          // teve progresso (tarefa OK), zera stall
          runtimePatched = RC29.rc29StallTick(runtimePatched, { hadProgress: true, stallMaxCycles: Math.max(8, Math.floor(maxCycles * 0.4)) });
        }
        // Aplicar recovery attempts log se recuperou de falha
        if (runResult.ok && baseRuntime.failedTaskIds && Array.isArray(baseRuntime.failedTaskIds)) {
          const prev = baseRuntime.failedTaskIds.find(f => f && String(f.taskId) === String(task.id));
          if (prev) {
            runtimePatched = RC29.rc29RecordRecoveryAttempt(runtimePatched, {
              strategy: 'CORRECT_FIRST_FAIL_FAST',
              ok: true,
              note: `Tarefa ${task.id} recuperou após ${Number(prev.attempts||1)} tentativa(s) · ${String(task.title||'').slice(0,100)}`,
            });
          }
        }
        // Atualiza centralState via mergePatch (incremental, aditivo)
        const mpRc29 = await mergePatchCentralState({ projectDir, patch: { autonomyRuntime: runtimePatched } });
        if (mpRc29 && mpRc29.ok) centralState = mpRc29.state;
      } catch (rc29err) {
        console.warn(`[RC28→RC29 pós EXECUTE_TASK] erro não fatal (continuando): ${rc29err && rc29err.message || rc29err}`);
      }

      if (step % rc28CheckpointEvery === 0) {
        try {
          const cp = await createCheckpoint({ projectDir, fase: phaseBefore, seq: step, summary: `rc28_auto_step_${step}` });
          if (cp && cp.ok) {
            const patchCk = { checkpoints: [...(centralState.checkpoints || []), cp.checkpoint] };
            const ckm = await mergePatchCentralState({ projectDir, patch: patchCk });
            centralState = ckm.state;
          }
        } catch {}
      }
      continue;
    }

    // Ação desconhecida → segurança
    const patchUnknown = { faseGeral: 'BLOCKED', statusExecucao: 'blocked', blockedReason: `RC28 ação desconhecida: ${String(decide.action)}`, ..._mergeDecidePatchAndTrace(decide, step, phaseBefore, 'BLOCKED') };
    const mU = await mergePatchCentralState({ projectDir, patch: patchUnknown });
    centralState = mU.state;
    handledFinal = { handled: true, rc28: 'unknown_action', steps: step, state: centralState, reason: 'acao_desconhecida' };
    break;
  }

  if (!handledFinal || !handledFinal.steps) handledFinal = { ...handledFinal, steps: step };

  if (step >= maxCycles && (!handledFinal || !handledFinal.handled || handledFinal.rc28 === 'ok')) {
    const exceed = await mergePatchCentralState({ projectDir, patch: {
      faseGeral: 'BLOCKED', statusExecucao: 'blocked',
      blockedReason: `RC28 excedeu maxCycles=${maxCycles} ciclos (anti-loop §17).`,
      proximaAcao: 'AGUARDA_INTERVENCAO_HUMANA_RC28_MAX'
    }});
    centralState = exceed.state;
    _emitWs(ws, 'orch:human_intervention_needed', {
      taskId: null, level: 'error', step, maxCycles,
      finalReason: `maxCycles=${maxCycles} excedido.`,
      userMessage: `🧲 RC28 executou ${step}/${maxCycles} ciclos sem completar §19. Requer revisão humana.`
    });
    handledFinal = { handled: true, rc28: 'max_cycles', steps: step, state: centralState, reason: 'max_cycles_excedido' };
  }

  if (rc28ForceAfterPlan && !handledFinal.handled) {
    return { ...handledFinal, handled: true, rc28: handledFinal.rc28 || 'forced_after_plan', steps: step };
  }
  return handledFinal;
}

export async function _rc28RunSingleTask({ ws, session, projectDir, centralState, task, makeToolsFn, runLegacyAgentFn, maxCorrectionPasses, rc28Verbose, realVerifierFn }) {
  if (!task) return { ok: false, reason: 'tarefa_vazia', newState: centralState };

  try {
    const ctx = assignTaskContext(task, centralState);
    const userPrompt = buildTaskPrompt(task, ctx, centralState);

    if (typeof runLegacyAgentFn !== 'function') {
      // GAP 3 FIX: SEM runLegacyAgentFn, não podemos marcar completed como MOCK.
      // Retornar ok=false com explicação (cai no fallback de verificação real abaixo).
      if (rc28Verbose) console.log(`[RC28 task=${task.id}] sem runLegacyAgentFn; usar validação real (ver realVerifierFn)`);
    }

    let firstPass = { ok: false, reason: 'sem_legacy_e_sem_verificacao_real', detail: null };
    if (typeof runLegacyAgentFn === 'function') {
      firstPass = await _runTaskDirect({ ws, session, task, userPrompt, runLegacyAgentFn, makeToolsFn });
    }

    // GAP 3 FIX: executa VALIDAÇÃO REAL (HTTP / UI / DB / Teste) baseada no tipo da tarefa.
    // Se realVerifierFn existir, usa; senão usa _realVerificationForTask padrão abaixo.
    let realCheck = { ok: null, reason: 'nao_verificado', evidences: [] };
    try {
      if (typeof realVerifierFn === 'function') {
        realCheck = await Promise.resolve().then(() => realVerifierFn(task, centralState, projectDir));
      } else {
        realCheck = await _realVerificationForTask({ task, projectDir, stateBefore: centralState, rc28Verbose });
      }
    } catch (e) {
      realCheck = { ok: false, reason: 'exception_verifier: ' + String(e && e.message || e).slice(0,200), evidences: [] };
    }

    // Primeiro passo ser considerado ok:
    //  - Tarefas FUNCIONAIS (DEVELOPER/TEST) exigem obrigatoriamente realCheck.ok === true
    //  - Tarefas NÃO-funcionais (ANALYSIS/ARCHITECT_PLAN/SECURITY_AUDIT etc.) podem aceitar
    //    firstPass.ok=true desde que realCheck NÃO seja explicitamente false (ok=null é aceitável).
    const agent = String(task.agent || '').toUpperCase();
    const title = String(task.title || '').toLowerCase();
    const desc = String(task.description || '').toLowerCase();
    const isFunctionalTask = agent.includes('DEVELOPER') || agent.includes('TEST') ||
      /implement|criar|adicionar|construir|implementa|desenvolv|frontend|backend|banco|dados|teste|endpoint|api|ui|rota|páginas?|páginas/i.test(title + ' ' + desc);
    let okPrimeiro;
    if (isFunctionalTask) {
      okPrimeiro = realCheck.ok === true;
    } else {
      okPrimeiro = (firstPass.ok === true || realCheck.ok === true) && realCheck.ok !== false;
    }

    // Verifica se arquivo foi modificado nesta sessão
    const arquivosModSetNow = new Set(((centralState && centralState.arquivosModificados) || []).map(x => String(x || '').toLowerCase()));
    const _arquivoModSessao = (patterns) => {
      if (!patterns || !patterns.length) return arquivosModSetNow.size > 0;
      for (const p of patterns) {
        for (const m of arquivosModSetNow) {
          try {
            if (typeof p === 'string' ? m.includes(p.toLowerCase()) : p.test(m)) return true;
          } catch {}
        }
      }
      return false;
    };

    if (okPrimeiro) {
      const mm = await mergePatchCentralState({ projectDir, patch: {
        tentativasRealizadas: [...(centralState.tentativasRealizadas || []), {
          id: task.id, status: 'completed', at: Date.now(),
          detail: firstPass.detail || realCheck,
          realEvidences: realCheck && realCheck.evidences || []
        }]
      }});
      return {
        ok: true, newState: mm.state,
        detail: firstPass.detail || realCheck,
        realCheck, mock: false
      };
    }

    let corResult = null;
    try {
      corResult = await autoCorrectionLoop({
        maxPasses: Math.max(1, Math.min(8, parseInt(maxCorrectionPasses || 4, 10))),
        taskId: task.id, projectDir, ws,
        async executePass(passNumber, ctx) {
          const p = await _runTaskDirect({ ws, session, task, userPrompt: userPrompt + `\n\n# AUTO_CORRECTION PASSO ${passNumber}/${maxCorrectionPasses} — anterior: ${String(firstPass.reason||'').slice(0,200)}`, runLegacyAgentFn, makeToolsFn });
          // GAP 3 FIX: após cada passagem, também roda verificação real para não marcar OK com base só na execução do agente.
          let passReal;
          try {
            if (typeof realVerifierFn === 'function') passReal = await Promise.resolve().then(() => realVerifierFn(task, null, projectDir));
            else passReal = await _realVerificationForTask({ task, projectDir, stateBefore: centralState, rc28Verbose: false });
          } catch (e) { passReal = { ok: false, reason: String(e && e.message || e).slice(0, 180) }; }
          const okPass = (p && p.ok) || passReal.ok === true;
          return { ok: !!okPass, erroStack: p ? p.reason : (passReal.reason || 'sem_resultado'), erroMessage: passReal.reason || (p && p.reason) || '', writeFilesChangedCount: okPass ? 1 : 0, diagnostics: [{ agent: p && p.detail, verifier: passReal }] };
        }
      });
    } catch (e) {
      corResult = { ok: false, resolved: false, finalReason: e.message };
    }
    // GAP 3 FIX: após autoCorrectionLoop, rodar verificação real FINAL (se passar aqui é completed; senão failed).
    let finalReal;
    try {
      if (typeof realVerifierFn === 'function') finalReal = await Promise.resolve().then(() => realVerifierFn(task, centralState, projectDir));
      else finalReal = await _realVerificationForTask({ task, projectDir, stateBefore: centralState, rc28Verbose });
    } catch (e) { finalReal = { ok: false, reason: 'ex: ' + String(e && e.message || e).slice(0,200), evidences: [] }; }

    // GAP3 ETAPA6: taskOkFinal — NUNCA aceitar corResult.ok sozinho para tarefas funcionais.
    // Regra:
    //  - isFunctionalTask: exige finalReal.ok === true (implementação verificada)
    //    OU (finalReal.ok === null E corResult.ok E _arquivoModSessao() = true)
    //  - não-funcional: (corResult.ok || finalReal.ok === true) E finalReal.ok !== false
    let taskOkFinal;
    if (isFunctionalTask) {
      taskOkFinal = (finalReal.ok === true) ||
                    (finalReal.ok === null && corResult && corResult.ok && _arquivoModSessao());
    } else {
      taskOkFinal = ((corResult && corResult.ok) || finalReal.ok === true) && finalReal.ok !== false;
    }

    if (taskOkFinal) {
      const mm = await mergePatchCentralState({ projectDir, patch: {
        tentativasRealizadas: [...(centralState.tentativasRealizadas || []), {
          id: task.id, status: 'completed', autoCorrected: !!(corResult && corResult.ok),
          resolvedIn: (corResult && corResult.resolvedIn) || null,
          realEvidences: finalReal && finalReal.evidences || [],
          at: Date.now()
        }]
      }});
      return { ok: true, autoCorrected: !!(corResult && corResult.ok), newState: mm.state, detail: (corResult && corResult.resolvedIn) || finalReal, realCheck: finalReal, mock: false };
    }

    const mm = await mergePatchCentralState({ projectDir, patch: {
      tentativasRealizadas: [...(centralState.tentativasRealizadas || []), { id: task.id, status: 'failed', at: Date.now(), reason: firstPass.reason || (corResult && corResult.finalReason) || finalReal.reason, autoCorrectionFailed: true }],
      errosEncontrados: [...(centralState.errosEncontrados || []), {
        id: task.id, message: firstPass.reason || (corResult && corResult.finalReason) || finalReal.reason || 'verificacao_real_falhou',
        at: Date.now(), loop: 'RC28_RUN_SINGLE_TASK',
        realCheck: finalReal || null
      }]
    }});
    return { ok: false, reason: firstPass.reason || (corResult && corResult.finalReason) || finalReal.reason || 'falha_desconhecida', newState: mm.state, realCheck: finalReal, mock: false };
  } catch (e) {
    try {
      const mm = await mergePatchCentralState({ projectDir, patch: {
        errosEncontrados: [...(centralState.errosEncontrados || []), { id: task.id || 'UNKNOWN', message: e.message, stack: (e.stack || '').slice(0, 500), at: Date.now(), loop: 'RC28_RUN_SINGLE_TASK_CATCH' }]
      }});
      return { ok: false, reason: e.message, newState: mm.state, mock: false };
    } catch { return { ok: false, reason: e.message, newState: centralState, mock: false }; }
  }
}

// ============================================================
//  GAP 3 FIX: _realVerificationForTask — VERIFICAÇÃO REAL da tarefa.
//  Para cada tipo de tarefa (por agent/título) executa checagem apropriada.
//  - TEST agent: executa npm test REAL e checa exit code.
//  - DEVELOPER backend (contém "endpoints", "API", "backend"): inicia servidor e
//    testa endpoint por HTTP.
//  - DEVELOPER frontend: lê HTML e confere existência de elementos necessários.
//  - DEVELOPER DB: consulta SQLite real, verifica tabelas/linhas.
//  - ARCHITECT: verifica arquivos críticos existem.
//  - QA, SECURITY: verifica se score de segurança/testes foi armazenado no state.
//  - OUTROS: se acceptanceCriteria existir, tenta parsear e executar alguns deles.
//  NÃO retorna ok=true a menos que evidências tenham sido confirmadas.
// ============================================================
export async function _realVerificationForTask({ task, projectDir, stateBefore, rc28Verbose }) {
  if (!task) return { ok: null, reason: 'tarefa_nula', evidences: [] };
  const evidences = [];
  const pushEv = (kind, data) => evidences.push({ kind, data, at: Date.now() });

  const agent = String(task.agent || '').toUpperCase().trim();
  const title = String(task.title || '').toLowerCase();
  const desc = String(task.description || '').toLowerCase();
  const ac = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.map(x => String(x).toLowerCase()) : [];

  const objetivoAtual = (stateBefore && typeof stateBefore === 'object' && typeof stateBefore.objetivoAtual === 'string')
    ? stateBefore.objetivoAtual.toLowerCase()
    : '';
  const arquivosModificados = Array.isArray(stateBefore && stateBefore.arquivosModificados) ? stateBefore.arquivosModificados : [];
  const arquivosModSet = new Set(arquivosModificados.map(x => String(x || '').toLowerCase()));
  const arquivoFoiModificado = (patterns) => {
    if (!Array.isArray(patterns)) patterns = [String(patterns)];
    for (const raw of patterns) {
      const p = String(raw || '').toLowerCase();
      if (!p) continue;
      for (const f of arquivosModSet) {
        if (p.includes('/') || p.includes('*')) {
          try {
            const rx = new RegExp(p.replace(/\./g, '\\.').replace(/\*/g, '.*'));
            if (rx.test(f)) return true;
          } catch { /* ignore */ }
        } else if (f.includes(p) || p.includes(f)) {
          return true;
        }
      }
    }
    return false;
  };
  const fullContext = `${title} ${desc} ${ac.join(' ')} ${objetivoAtual}`;

  const isLikelyTestTask = agent === 'TEST' || title.includes('teste') || /executar testes|rodar testes|npm test|jest|vitest/i.test(fullContext);
  const isLikelyBackendTask = agent === 'DEVELOPER' && /backend|endpoint|api|rest|rota|servidor/i.test(fullContext);
  const isLikelyFrontendTask = agent === 'DEVELOPER' && /frontend|html|index|ui|interface|busca|pesquisa|search|input|tela|página/i.test(fullContext);
  const isLikelyDbTask = agent === 'DEVELOPER' && /banco|persistên|database|sqlite|migra|schema|tabela/i.test(fullContext);
  const isLikelyArchitectTask = agent === 'ARCHITECT';
  const isLikelySecTask = agent === 'SECURITY' || /segurança|security|vulnerab|auditoria/i.test(fullContext);
  const isLikelyQaTask = agent === 'QA' || /score|qa|qualidade/i.test(fullContext);
  const isLikelyOrchValTask = agent === 'ORCHESTRATOR' && (/validação final|relatório final|conclusão|concluir/i.test(fullContext));
  const isFunctionalTask = (agent === 'DEVELOPER' || agent === 'TEST') && !isLikelyArchitectTask;

  const precisaBusca = /busca|pesquisa|search|localizar|filtrar itens|filtro de itens|encontrar itens|consultar itens/i.test(fullContext);

  const fs = await import('node:fs');
  const path = await import('node:path');
  const child_p = await import('node:child_process');
  const NODE = process.env.TIAGENTE_NODE_PATH || process.execPath;

  // helper checkFileExists + includes
  const fileExists = (p) => fs.existsSync(path.join(projectDir, p));
  const readFileText = (p) => {
    try { return fs.readFileSync(path.join(projectDir, p), 'utf-8'); } catch { return ''; }
  };

  // --- Caso 1: TEST AGENTE (t_te_06) ---
  if (isLikelyTestTask) {
    try {
      // 1. Existe package.json com script test?
      const pkgPath = path.join(projectDir, 'package.json');
      if (!fs.existsSync(pkgPath)) { pushEv('skip', 'sem package.json'); return { ok: null, reason: 'sem_package_json', evidences }; }
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (!pkg.scripts || typeof pkg.scripts.test !== 'string') { pushEv('skip', 'sem_script_test'); return { ok: null, reason: 'sem_script_test', evidences }; }
      // 2. Executa npm test com timeout
      const npmPath = (await import('node:path')).join(path.dirname(NODE), 'npm');
      const testEnv = Object.assign({}, process.env, {
        PATH: `${path.dirname(NODE)}${path.delimiter}${process.env.PATH || ''}`
      });
      pushEv('run_tests', { script: pkg.scripts.test, cwd: projectDir });
      try {
        const out = child_p.spawnSync(npmPath, ['test'], { cwd: projectDir, timeout: 120000, encoding: 'utf-8', env: testEnv });
        pushEv('npm_status', { status: out.status, signal: out.signal, stdout_len: (out.stdout||'').length, stderr_len: (out.stderr||'').length });
        const tailStdout = (out.stdout || '').split(/\n/).slice(-12).join('\n').slice(0, 800);
        pushEv('npm_tail_stdout', tailStdout);
        const testsPassed = (out.status === 0) && /(tests?:\s*[0-9]+\s*passed|test suite passed|1 passed|ok\s+[0-9]+)/i.test(out.stdout || '') || out.status === 0;
        if (testsPassed) return { ok: true, reason: 'npm_test_exit_0_e_teste_passou', evidences };
        return { ok: false, reason: `npm_test_fail exit=${out.status || 'null'} signal=${out.signal || 'null'}`, evidences };
      } catch (e) {
        pushEv('npm_exception', String(e && e.message || e).slice(0, 300));
        return { ok: false, reason: 'npm_test_excecao: ' + String(e && e.message || e).slice(0,200), evidences };
      }
    } catch (e) {
      pushEv('test_exception', String(e && e.message || e).slice(0,300));
      return { ok: false, reason: 'verif_test_exc: ' + String(e && e.message || e).slice(0,200), evidences };
    }
  }

  // --- Caso 2: ARCHITECT (t_ar_02) ---
  if (isLikelyArchitectTask) {
    // Arquitetura é PLANEJAMENTO; "arquivo existe" NÃO prova implementação real.
    // Evidência aceitável de tarefa completed = arquitetura definida NO STATE (arquitetura.camadas / tecnologias / estruturasPastas preenchidas)
    // ou arquivoFoiModificado arquivos de estrutura (package.json / .env.example / src/routes etc.)
    const checks = [
      ['package.json', fileExists('package.json')],
      ['server.js OR index.js OR main.js', fileExists('server.js') || fileExists('index.js') || fileExists('main.js')],
      ['public/ existe', fileExists('public/') || fileExists('public/index.html')]
    ];
    for (const [c, ok] of checks) pushEv('arch_file', { check: c, ok });
    const arqDef = (stateBefore && typeof stateBefore === 'object' &&
                   Array.isArray(stateBefore.arquitetura?.camadas) &&
                   stateBefore.arquitetura.camadas.length > 0);
    const modArq = arquivoFoiModificado(['package.json','server.js','.env','.env.example','routes','src/routes','src/models','src/app','app/routes']);
    pushEv('arch_state_or_modified', { temArquiteturaDefinida: !!arqDef, arquivosModificados: modArq, arquivosModificadosSetSize: arquivosModSet.size });
    // "Completed architect tarefa" só é true com evidência de planejamento ou modificação.
    if (arqDef || modArq || (arquivosModSet.size > 0 && checks.filter(x => x[1]).length >= 2)) {
      return { ok: true, reason: 'arquitetura_definida_ou_arquivos_modificados', evidences };
    }
    return { ok: null, reason: 'arch_evidencia_insuficiente: planejamento_ou_modificacao_nao_detectada', evidences };
  }

  // --- Caso 3: DEVELOPER DB (t_db_03) ---
  if (isLikelyDbTask) {
    try {
      const dbCandidates = ['database.js','db.js','models/index.js','database.sqlite','data.db','db.sqlite','data/database.sqlite'];
      const found = dbCandidates.filter(p => fileExists(p));
      pushEv('db_files_found', found);
      if (found.length === 0) return { ok: null, reason: 'sem_arquivos_bd_localizados', evidences };
      const mod = arquivoFoiModificado(dbCandidates) || arquivoFoiModificado(['database.sqlite','database.js','.env','migrations','knexfile','sequelize']);
      let sqliteReal = null;
      for (const cand of found) {
        if (/\.sqlite$|\.db$/.test(cand)) {
          const sqlitePath = path.join(projectDir, cand);
          if (fs.existsSync(sqlitePath)) {
            const st = fs.statSync(sqlitePath);
            if (st && st.size > 0) {
              sqliteReal = { file: cand, size: st.size };
              pushEv('sqlite_touch_ok', sqliteReal);
            }
          }
        }
      }
      if (found.includes('database.js')) {
        const txt = readFileText('database.js');
        if (/sqlite3|new Database|createTable|sqlite/i.test(txt)) pushEv('database_js_uses_sqlite', true);
      }
      pushEv('db_modificada', mod);
      // DEVELOPER DB completed: precisa de modificação OU (agente escreveu algo) E resultado real visível.
      if (sqliteReal && mod) {
        return { ok: true, reason: 'db_arquivo_modificado_e_sqlite_populado', evidences };
      }
      if (sqliteReal || mod) return { ok: null, reason: sqliteReal ? 'db_existe_mas_nao_modificado_nesta_sessao' : 'db_modificacao_sem_evidencia_real', evidences };
      return { ok: null, reason: 'db_sem_verificacao_conclusiva_implementacao', evidences };
    } catch (e) {
      pushEv('db_verif_exc', String(e && e.message || e).slice(0,200));
      return { ok: null, reason: 'db_exc: ' + String(e.message || e).slice(0,150), evidences };
    }
  }

  // --- Caso 4: DEVELOPER FRONTEND (t_fe_05) ---
  if (isLikelyFrontendTask) {
    const htmlPaths = ['public/index.html','index.html','frontend/index.html','src/index.html','public/app.html'];
    const htmlPath = htmlPaths.find(p => fileExists(p));
    if (!htmlPath) return { ok: false, reason: 'frontend_sem_html_encontrado', evidences };
    const html = readFileText(htmlPath);
    if (!html.trim()) return { ok: false, reason: 'frontend_html_vazio', evidences };
    pushEv('fe_html_found', { path: htmlPath, len: html.length });
    const okBasico = /<!DOCTYPE html|<html\b|<body\b/i.test(html);
    pushEv('fe_basico_ok', okBasico);
    const modFrontend = arquivoFoiModificado(htmlPaths.concat(['public/', 'src/', 'index.html', 'frontend/', 'assets/', 'styles/', '*.js', '*.css']));
    pushEv('fe_arquivos_modificados', modFrontend);
    const precisaLoginAutentic = /login|autentica|cadastro|registro|auth/i.test(fullContext);
    const precisaCrud = /cadastro|editar|excluir|atualizar|create|update|delete|post|put/i.test(fullContext);

    // --- Critérios específicos para SEARCH/PESQUISA (5 pontos):
    if (precisaBusca) {
      const hasSearchInput = /<input[^>]+(id|name|class|placeholder|aria-label|type)[^>]*(search|busca|pesquisa|filtrar|query|pesquisar)[^>]*>/i.test(html) ||
                            /<input[^>]+type=["']search["']/i.test(html) ||
                            /(id|class|name)\s*=\s*["'][^"']*(search|busca|pesquisa|filter|pesquisar)[^"']*["']/i.test(html);
      const hasSearchLogic = /oninput=|onchange=|onsubmit=|addEventListener\(\s*['"](input|change|submit|click)/i.test(html);
      const hasSearchApiIntegration = /fetch\(\s*['"]?\s*\/api\/[^"']*\?[^"']*(search|q=|query=)|axios\.(get|post)\(\s*['"][^"']*\/api\/itens[^"']*(search|q)|searchParams\.(append|set)\(\s*['"](search|q|query)['"]|\/api\/[^'"]*\?(search|q)=[^'"]*['"`)]/i.test(html);
      const hasSearchResultsDisplay = /id\s*=\s*["'][^"']*(resultado|results|search-results|lista-produtos|product-list|products-grid|items-grid)[^"']*["']|class\s*=\s*["'][^"']*(search-results|results-container|resultado[s]?|lista-produtos|product-list|grid-items|product-grid)[^"']*["']|innerHTML\s*\+?=|\.map\(\s*\w+\s*=>\s*`?\s*<\s*(div|li|tr|card|article)\s/i.test(html);
      const hasTestsSearchTests = /(search|busca|pesquisa)/i.test(readFileText('test/itens.test.js'));
      const checks = { hasSearchInput, hasSearchLogic, hasSearchApiIntegration, hasSearchResultsDisplay, hasSearchTestsVer: hasTestsSearchTests };
      pushEv('fe_search_checks_v2', checks);
      const criticos = checks.hasSearchInput && checks.hasSearchLogic && checks.hasSearchApiIntegration && checks.hasSearchResultsDisplay;
      if (modFrontend && criticos) {
        return { ok: true, reason: 'fe_search_implementado (input+logic+api+display+modificado)', evidences };
      }
      if (criticos) return { ok: null, reason: 'fe_search_criterios_atendidos_sem_arquivo_modificado_nesta_sessao', evidences };
      const falhou = Object.entries(checks).filter(([,v]) => !v).map(([k]) => k).join(',');
      return { ok: false, reason: 'fe_search_criticos_faltando: ' + falhou, evidences };
    }

    // --- Casos específicos LOGIN/AUTH: precisa de formulário inputs submit integração
    if (precisaLoginAutentic) {
      const hasForm = /<form\b/i.test(html);
      const hasAuthInputPass = /<input[^>]+type=["'](text|email|tel|number)["'][^>]*>|<input[^>]+(id|name|class|placeholder)[^>]*(telefone|email|usuario|user|login|auth)[^>]*>|<input[^>]+type=["']password["']/i.test(html);
      const hasSubmitLogic = /onclick|onsubmit|addEventListener\(\s*['"]submit|fetch\(\s*['"][^"']*\/api\/auth|axios\.(post|get)\(\s*['"][^"']*\/auth/i.test(html);
      pushEv('fe_auth_checks', { hasForm, hasAuthInputPass, hasSubmitLogic });
      if (modFrontend && hasForm && hasAuthInputPass && hasSubmitLogic) return { ok: true, reason: 'fe_auth_implementado', evidences };
      return { ok: null, reason: 'fe_auth_criticos_faltando: ' + [!hasForm&&'form', !hasAuthInputPass&&'inputs', !hasSubmitLogic&&'submit'].filter(Boolean).join(', '), evidences };
    }

    // --- Casos específicos CRUD: precisa de formulário e ações (botões / API calls
    if (precisaCrud) {
      const hasAnyFormOrButtons = /<form\b|<button\b|onclick=/i.test(html);
      const hasApiCrud = /fetch\(|axios\.(post|put|delete|get)|\/api\/|addEventListener/i.test(html);
      pushEv('fe_crud_checks', { hasAnyFormOrButtons, hasApiCrud });
      if (modFrontend && hasAnyFormOrButtons && hasApiCrud) return { ok: true, reason: 'fe_crud_implementado', evidences };
    }

    // --- Caso frontend GENERICO: NÃO retorna ok=true por "html_basico_ok,
    // Só ok=true SE ostate com arquivos modificados (agente escreveu algo de fato ou tem algo dinâmico JS fetch etc.).
    if (modFrontend) {
      // Tem JS externo ou script ou style?
      const hasScripts = /<script\b|<style\b/i.test(html);
      if (hasScripts) return { ok: true, reason: 'frontend_generico_modificado_com_recursos', evidences };
      return { ok: null, reason: 'frontend_modificado_sem_recursos_dinamicos_detectados', evidences };
    }
    if (okBasico) return { ok: null, reason: 'fe_html_basico_existe_mas_nao_modificado', evidences };
    return { ok: false, reason: 'fe_html_invalido_sem_doctype_sem_body_sem_modificacao', evidences };
  }

  // --- Caso 5: DEVELOPER BACKEND (t_be_04) ---
  if (isLikelyBackendTask) {
    const filesToCheck = ['server.js','index.js','app.js','routes/itens.js','routes/index.js'];
    const content = filesToCheck.map(p => readFileText(p)).join('\n');
    const hasApp = /require\(['"]express['"]\)|from ['"]express['"]|express\(\)/.test(content);
    const hasGet = /app\.(get|post|put|delete)\s*\(\s*['"]\/api\//.test(content);
    const hasSearch = /search|pesquisa|busca|req\.query\.search|\/api\/itens.*search/.test(content);
    pushEv('be_checks', { hasApp, hasGet, hasSearch });
    const alsoFrontend = /(campo|input|tela|html|interface|ui|página|botão|front-end|frontend)/i.test(fullContext);
    if (alsoFrontend && !isLikelyBackendTask) return { ok: null, reason: 'also_frontend_pule', evidences };
    const modBackend = arquivoFoiModificado(filesToCheck.concat(['server.js','app.js','routes/','controllers/','models/','index.js','.env','database.js']));
    pushEv('be_arquivos_modificados', modBackend);
    let probeResult = null;
    if (hasApp) {
      try {
        const PORT_TESTE = 4567;
        const env = Object.assign({}, process.env, { PORT: String(PORT_TESTE), PATH: `${path.dirname(NODE)}${path.delimiter}${process.env.PATH || ''}` });
        const mainFile = filesToCheck.find(p => fileExists(p));
        if (mainFile) {
          pushEv('be_http_probe', { file: mainFile, port: PORT_TESTE });
          const child = child_p.spawn(NODE, [path.join(projectDir, mainFile)], { cwd: projectDir, env, stdio: ['ignore','pipe','pipe'] });
          let closed = false;
          await new Promise(r => setTimeout(r, 3500));
          try {
            const { default: htt } = await import('node:http');
            probeResult = await new Promise(resolve => {
              const req = htt.request({ hostname: '127.0.0.1', port: PORT_TESTE, path: '/api/itens', timeout: 4000, method: 'GET' }, (res) => {
                let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode, bodyLen: body.length, bodySnippet: body.slice(0, 200) }));
              });
              req.on('error', e => resolve({ status: -1, err: String(e.message || e).slice(0, 200) }));
              req.on('timeout', () => { req.destroy(); resolve({ status: -2, err: 'timeout' }); });
              req.end();
            });
            pushEv('be_http_probe_result', probeResult);
            if (!closed) { try { child.kill('SIGTERM'); } catch {} closed = true; }
          } catch (e) {
            pushEv('be_http_probe_exc', String(e && e.message || e).slice(0,200));
          } finally {
            if (!closed) try { child.kill('SIGKILL'); } catch {}
          }
        }
      } catch (e) { pushEv('be_spawn_exc', String(e && e.message || e).slice(0,200)); }
    }
    if (precisaBusca && hasApp && hasSearch && modBackend && probeResult && (probeResult.status >= 200 && probeResult.status < 500)) {
      return { ok: true, reason: 'backend_search_modificado_e_probe_http_ok', evidences };
    }
    if (probeResult && probeResult.status >= 200 && probeResult.status < 500 && modBackend) {
      return { ok: true, reason: 'backend_modificado_e_probe_http_2xx_4xx', evidences };
    }
    if (modBackend && hasApp && hasGet) {
      return { ok: null, reason: 'backend_modificado_sem_probe_http_sucesso', evidences };
    }
    if (hasApp && hasGet) return { ok: null, reason: 'backend_estrutura_existe_mas_nao_modificado_nesta_sessao', evidences };
    if (hasApp) return { ok: null, reason: 'backend_tem_express_mas_sem_endpoints_visiveis', evidences };
    return { ok: false, reason: 'backend_sem_express_nem_endpoints', evidences };
  }

  // --- Caso 6: SECURITY (t_se_08) ---
  if (isLikelySecTask) {
    const st = stateBefore && typeof stateBefore === 'object' ? stateBefore : {};
    const secScore = typeof st.securityScore === 'number' ? st.securityScore : null;
    const secReport = (st.securityReport && typeof st.securityReport === 'object' && st.securityReport) || null;
    pushEv('sec_state', { secScore, keysReport: secReport ? Object.keys(secReport).slice(0,8) : null });
    if (typeof secScore === 'number' && secScore >= 80) return { ok: true, reason: 'sec_score_maior_80', evidences };
    if (typeof secScore === 'number') return { ok: null, reason: 'sec_score_presente_' + secScore, evidences };
    return { ok: null, reason: 'sec_sem_score_ainda', evidences };
  }

  // --- Caso 7: QA (t_qa_07) ---
  if (isLikelyQaTask) {
    return { ok: null, reason: 'qa_verificacao_geral_nao_bloqueia', evidences };
  }

  // --- Caso 8: ORCHESTRATOR validação final (t_va_09) = OBJECTIVE_VERIFIED.
  if (isLikelyOrchValTask) {
    const total = Array.isArray(stateBefore?.tarefas) ? stateBefore.tarefas.length : 0;
    const done = Array.isArray(stateBefore?.tarefas) ? stateBefore.tarefas.filter(t => t && t.status === 'completed').length : 0;
    pushEv('val_task_completion', { done, total });
    const obj = await _verifyObjectiveReal({ state: stateBefore, projectDir });
    pushEv('val_objective_verified', obj);
    if (obj && obj.verified) {
      return { ok: true, reason: 'objective_verified: ' + (obj.reason || 'ok'), evidences };
    }
    return { ok: false, reason: 'objective_nao_verificado: ' + (obj && obj.reason ? obj.reason : 'criterios_objetivo_nao_atendidos'), evidences };
  }

  // --- Caso 9: OUTROS (Análise inicial) ---
  if (agent === 'ORCHESTRATOR' && /análise inicial|analise inicial/i.test(title + ' ' + desc)) {
    return { ok: true, reason: 'análise_inicial_nao_requer_comportamento_real', evidences };
  }

  // Caso genérico (não mapeado) → null.
  pushEv('verif_unhandled', { agent, title: title.slice(0,80) });
  return { ok: null, reason: `tarefa_nao_mapeada agent=${agent} title=${title.slice(0,60)}`, evidences };
}

// ============================================================
//  GAP3 ET6: OBJECTIVE_VERIFIED — verificação REAL do OBJETIVO completo.
//  Diferente de TASK_COMPLETED (por tarefa), OBJECTIVE_VERIFIED valida
//  que o objetivo macro foi realmente atingido com evidências concretas
//  (pesquisa UI+API+testes; ou equivalente para outros objetivos).
// ============================================================
export async function _verifyObjectiveReal({ state, projectDir }) {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const objetivo = (state && typeof state === 'object' && typeof state.objetivoAtual === 'string') ? state.objetivoAtual.toLowerCase() : '';
    const fileExists = (p) => fs.existsSync(path.join(projectDir, p));
    const readFileText = (p) => { try { return fs.readFileSync(path.join(projectDir, p), 'utf-8'); } catch { return ''; } };
    const evidences = [];
    const objetivosSearch = /pesquisa|busca|search|localizar itens|filtrar itens|encontrar itens/i.test(objetivo);
    const objetivosAuth = /login|autentica|cadastrar usuário|registro de usuário/i.test(objetivo);
    const objetivosCrud = /crud|create|read|update|delete|gerenciar itens|cadastrar itens/i.test(objetivo);
    // Pesquisa UI:
    if (objetivosSearch || objetivosSearch) {
      const htmlPaths = ['public/index.html','index.html'];
      const hp = htmlPaths.find(p=>fileExists(p));
      const html = hp ? readFileText(hp) : '';
      const hasSearchInput = /<input[^>]+(id|name|class|placeholder|aria-label|type)[^>]*(search|busca|pesquisa|filtrar|query|pesquisar)[^>]*>/i.test(html) || /<input[^>]+type=["']search["']/i.test(html);
      const hasSearchLogic = /oninput=|onchange=|onsubmit=|addEventListener\(['"](input|change|submit|click)/i.test(html);
      const hasSearchApi = /fetch\(\s*['"]?\s*\/api\/[^"']*\?[^"']*(search|q=)|axios\.(get|post)\(\s*['"][^"']*\/api\/itens[^"']*(search|q)|searchParams\.(append|set)\(\s*['"](search|q|query)['"]/i.test(html);
      const hasDisplay = /id\s*=\s*["'][^"']*(resultado|results|search-results|lista-produtos|product-list|items-grid|products-grid)[^"']*["']|innerHTML\s*\+?=|\.map\(\s*\w+\s*=>\s*`?\s*<\s*(div|li|tr|card|article)\s/i.test(html);
      evidences.push({ kind: 'obj_search_input', data: hasSearchInput });
      evidences.push({ kind: 'obj_search_logic', data: hasSearchLogic });
      evidences.push({ kind: 'obj_search_api', data: hasSearchApi });
      evidences.push({ kind: 'obj_search_display', data: hasDisplay });
      const criticos = hasSearchInput && hasSearchLogic && hasSearchApi && hasDisplay;
      const arquivos = Array.isArray(state && state.arquivosModificados) ? state.arquivosModificados.length > 0 : false;
      evidences.push({ kind: 'obj_arquivos_modificados', data: arquivos });
      // Testes npm:
      const tem = await (async () => {
        try {
          const pkg = JSON.parse(readFileText('package.json') || '{}');
          return !!(pkg && pkg.scripts && typeof pkg.scripts.test === 'string');
        } catch { return false; }
      })();
      evidences.push({ kind: 'obj_tem_script_test', data: tem });
      if (criticos && arquivos) return { verified: true, reason: 'search_ui_api_display_e_arquivos_modificados', evidences, criteria: { hasSearchInput, hasSearchLogic, hasSearchApi, hasSearchResultsDisplay: hasDisplay, arquivosModificados: arquivos } };
      const faltando = Object.entries({ hasSearchInput, hasSearchLogic, hasSearchApi, hasDisplay, arquivos }).filter(([, v]) => !v).map(([k]) => k).join(',');
      return { verified: false, reason: 'search_criticos_faltando: ' + faltando, evidences, criteria: { hasSearchInput, hasSearchLogic, hasSearchApi, hasDisplay, arquivos } };
    }
    // Caso auth:
    if (objetivosAuth) {
      const hp = ['server.js','index.js','routes/auth.js'].map(p => fileExists(p)).some(Boolean);
      evidences.push({ kind: 'obj_auth_server_exists', data: !!hp });
      if (hp) return { verified: true, reason: 'auth_estrutura_existe', evidences };
      return { verified: false, reason: 'auth_sem_estrutura_detectada', evidences };
    }
    // Caso CRUD genérico:
    if (objetivosCrud) {
      const temPkg = fileExists('package.json') && fileExists('server.js');
      evidences.push({ kind: 'obj_crud_estrutura', data: temPkg });
      return { verified: !!temPkg, reason: temPkg ? 'crud_estrutura_ok' : 'crud_sem_estrutura', evidences };
    }
    // Caso N: "mini site com pagina inicial + botao funcional + teste automatizado do botao"
    //   (objetivo do E2E atual do usuário)
    const objSiteBotaoTeste = /página inicial|pagina inicial|index\.html|botão funcional|botao funcional|teste automatizado|validar o funcionamento do botão|validar o funcionamento do botao/i.test(objetivo);
    if (objSiteBotaoTeste) {
      const htmlPaths = ['public/index.html','index.html'];
      const hp = htmlPaths.find(p=>fileExists(p));
      const html = hp ? readFileText(hp) : '';
      // 1) página inicial existe (index.html)
      const temPaginaInicial = !!hp;
      evidences.push({ kind: 'obj_e2e_pagina_inicial', data: temPaginaInicial, path: hp || null });
      // 2) existe pelo menos um <button> ou elemento com onClick/click handler que chama função
      const temBotaoHtml = /<button[ >]|<a[^>]+role="button"|<input[^>]+type=["']button["']/i.test(html) || /onclick\s*=\s*["']|addEventListener\(['"]click/i.test(html);
      evidences.push({ kind: 'obj_e2e_botao_html', data: temBotaoHtml });
      // 3) existe o comportamento real (script.js / inline JS) que executa algo no botão — evidência: existe script tag ou script.js
      const temJsPagina = /<script[^>]*>/i.test(html) || fileExists('script.js') || fileExists('public/script.js');
      evidences.push({ kind: 'obj_e2e_botao_js', data: temJsPagina });
      // 4) existe teste automatizado: arquivo *test*.{js,mjs,cjs} OU *spec*.{js,mjs,cjs} OU package.json tem "scripts.test" string
      let temTesteArquivo = false;
      try {
        const d = fs.readdirSync(projectDir || '.');
        temTesteArquivo = d.some(n => /(^|[-_/.])(test|spec)[-_.]?/i.test(n) && /\.(mjs|cjs|js)$/i.test(n));
      } catch {}
      let temTesteScriptPkg = false;
      try {
        const pkg = JSON.parse(readFileText('package.json') || '{}');
        temTesteScriptPkg = !!(pkg && pkg.scripts && typeof pkg.scripts.test === 'string');
      } catch {}
      const temTeste = temTesteArquivo || temTesteScriptPkg;
      evidences.push({ kind: 'obj_e2e_teste_automatizado', data: temTeste, arquivo: temTesteArquivo, script: temTesteScriptPkg });
      const arquivosMod = Array.isArray(state && state.arquivosModificados) ? state.arquivosModificados.length > 0 : false;
      evidences.push({ kind: 'obj_e2e_arquivos_modificados', data: arquivosMod });
      const criticos = temPaginaInicial && temBotaoHtml && temJsPagina && temTeste && arquivosMod;
      if (criticos) {
        return {
          verified: true,
          reason: 'site_botao_teste_aprovado: pagina_inicial+botao+js+teste_automatizado+arquivos_modificados',
          evidences,
          criteria: { temPaginaInicial, temBotaoHtml, temJsPagina, temTeste, arquivosModificados: arquivosMod }
        };
      }
      const faltando = Object.entries({ temPaginaInicial, temBotaoHtml, temJsPagina, temTeste, arquivosMod }).filter(([, v]) => !v).map(([k]) => k).join(',');
      return { verified: false, reason: 'site_botao_teste_faltando: ' + faltando, evidences, criteria: { temPaginaInicial, temBotaoHtml, temJsPagina, temTeste, arquivosModificados: arquivosMod } };
    }
    // Fallback: objetivo desconhecido.
    evidences.push({ kind: 'obj_unknown', data: true });
    return { verified: false, reason: 'objetivo_sem_tipo_detectado_verificacao_manual_necessaria', evidences };
  } catch (e) {
    return { verified: false, reason: 'ex: ' + String(e && e.message || e).slice(0, 200), evidences: [] };
  }
}

// ============================================================
//  GAP3 ET6: objectiveProgressPct = 3 eixos ponderados (33% cada).
//  1) tarefas REALMENTE completas (status=completed E realVerification
//     não é false) / total.
//  2) arquivos relevantes modificados (expected_min=4) / esperado 4 (UI+back+DB+teste)
//  3) OBJECTIVE critérios reais (de _verifyObjectiveReal convertido 0/100)
// ============================================================
export function _calcObjectiveProgressPct(state, objectiveRealResult) {
  const tarefas = Array.isArray(state?.tarefas) ? state.tarefas : [];
  const total = Math.max(1, tarefas.length);
  const tentativas = Array.isArray(state?.tentativasRealizadas) ? state.tentativasRealizadas : [];
  const completedReais = tarefas.filter(t => {
    if (!t || t.status !== 'completed') return false;
    const tent = tentativas.slice().reverse().find(x => x && x.id === t.id);
    // NÃO há tentativa registrada → considerar válido por padrão (sem evidência CONTRÁRIA)
    if (!tent) return true;
    // Se tem realEvidences E tem EVIDÊNCIA EXPLÍCITA de falha (fe_* com algum false) → invalida
    if (Array.isArray(tent.realEvidences) && tent.realEvidences.length>0) {
      const temFalha = tent.realEvidences.some(e => e && e.kind && (e.kind.startsWith('fe_') && typeof e.data==='object' && Object.values(e.data).some(v => v===false)));
      if (temFalha) return false;
    }
    return true;
  }).length;
  const eixo1 = Math.min(100, Math.round((completedReais / total) * 100));
  const arquivosMod = Array.isArray(state?.arquivosModificados) ? state.arquivosModificados.length : 0;
  const esperado = 4;
  const eixo2 = Math.min(100, Math.round((Math.min(arquivosMod, esperado) / esperado) * 100));
  let eixo3 = 0;
  if (objectiveRealResult && typeof objectiveRealResult === 'object') {
    if (objectiveRealResult.verified === true) eixo3 = 100;
    else if (objectiveRealResult.criteria && typeof objectiveRealResult.criteria === 'object') {
      const entries = Object.values(objectiveRealResult.criteria);
      const verdadeiros = entries.filter(v => v === true || v > 0).length;
      eixo3 = entries.length ? Math.round(verdadeiros / entries.length * 100) : 0;
    }
  } else if (state?.decisionEngine?.progressMetrics?.objectiveProgressPct != null && typeof objectiveRealResult !== 'object') {
    eixo3 = 0;
  }
  const weighted = Math.round((eixo1 + eixo2 + eixo3) / 3);
  return { eixo1_tarefas: eixo1, eixo2_arquivos: eixo2, eixo3_objetivo: eixo3, weighted };
}

function buildTaskPrompt(task, ctx, state) {
  const lines = [];
  lines.push(`# TiAgente · Execução Tarefa Individual (RC28)
- Tarefa ID: **${task.id}**
- Agente: ${task.agent || 'ORCHESTRATOR'}
- Título: ${task.title || ''}
- Descrição: ${task.description || ''}`);
  if (ctx && typeof ctx.context === 'string' && ctx.context) lines.push('\n' + ctx.context);
  if (task.instructions) lines.push(`\n## Instruções da Tarefa\n${task.instructions}`);
  lines.push('\n## Objetivo Geral do Projeto');
  lines.push(String(state.objetivoAtual || '').slice(0, 400));
  if (Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length) {
    lines.push('\n## Critérios de Aceite');
    for (const c of task.acceptanceCriteria) lines.push(`- ${c}`);
  }
  lines.push('\n## Ao concluir, certifique-se:');
  lines.push('1. Todos arquivos modificados são salvos via write_file.');
  lines.push('2. Rode os testes com run_tests antes de declarar conclusão.');
  lines.push('3. Se houver falhas em testes, corrija antes de finalizar.');
  lines.push('4. Não declare sucesso sem evidência (§19: NÃO MENTE).');
  return lines.join('\n');
}

async function _runTaskDirect({ ws, session, task, userPrompt, runLegacyAgentFn, makeToolsFn }) {
  try {
    const userParts = [{ role: 'user', text: userPrompt }];
    if (typeof runLegacyAgentFn === 'function') {
      const r = await Promise.resolve().then(() => runLegacyAgentFn(ws, session, userParts));
      // GAP 3 FIX: handled=!!r é muito permissivo. Precisa que r.handled === true ou
      // r.completed === true ou r.ok === true explicitamente.
      let handledExplicit = false;
      if (typeof r === 'object' && r !== null) {
        handledExplicit = (r.handled === true) || (r.ok === true) || (r.completed === true);
      }
      return {
        ok: handledExplicit,
        detail: typeof r === 'object' ? {
          handled: handledExplicit,
          keys: Object.keys(r||{}).slice(0, 12),
          rc28: typeof r.rc28 === 'object' ? r.rc28 : null,
          phase: r.phase || null
        } : { returnType: typeof r }
      };
    }
    return { ok: false, reason: 'runLegacyAgentFn ausente' };
  } catch (e) {
    return { ok: false, reason: e.message || 'runTaskDirect_exception' };
  }
}

export const RC28_LOOP_VER = RC28_LOOP_VERSION;
export default rc28RunDecisionLoop;

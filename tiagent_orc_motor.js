// ============================================================================
//  RC27 · tiagent_orc_motor.js — Motor do Orquestrador Autônomo
//  Implementa o loop de 9 fases do diagrama §2 do script, distribuindo tarefas
//  para os agentes existentes (Arquiteta/Desenvolvedora/QA/Security) sem
//  reescrevê-los. Coordena Estado Central, eventos WS e checkpoints.
//
//  IMPORTANTE: nesta fase inicial (antes da T4/T6), esta função NÃO executa
//  nenhuma LLM real — retorna {handled:false} para o gate T1 cair no legado
//  quando RC27 está ON mas o motor não tem todas as ferramentas/WS bindings.
//  Depois da T6 (gate final), substituímos o early return por execução real.
// ============================================================================

import * as Orch from './agent_orchestrator.js';
import {
  loadOrInitCentralState,
  atomicWriteCentralState,
  mergePatchCentralState,
  createCheckpoint,
  centralStatePath
} from './tiagent_orc_fs.js';
import { validateCentralState, RC27_FASES } from './tiagent_orc_state_schema.js';
// RC28 Engine (camada ACIMA do RC27, NÃO substitui)
import { rc28RunDecisionLoop, RC28_LOOP_VER } from './rc28_decision_loop.js';
// RC29 Autonomy Core (camada ACIMA do RC28, aditiva, NÃO substitui)
import * as RC29 from './rc29_autonomy_core.js';

const PHASE_SEQUENCE = [
  'ANALYSIS', 'PLANNING', 'ARCHITECTURE',
  'IMPLEMENTATION', 'TESTS', 'CORRECTIONS',
  'VALIDATION', 'COMPLETED'
];

export function phaseLabel(fase) {
  const map = {
    ANALYSIS: '🔍 Análise do Projeto',
    PLANNING: '📋 Planejamento Autônomo',
    ARCHITECTURE: '🏛️ Arquitetura Definida',
    IMPLEMENTATION: '⟳ Implementação',
    TESTS: '⏳ Testes',
    CORRECTIONS: '⏳ Correções',
    VALIDATION: '⏳ Validação',
    COMPLETED: '✅ Concluído',
    BLOCKED: '⛔ Bloqueado'
  };
  return map[fase] || String(fase);
}

function _emitWsOrLog(ws, type, data) {
  try {
    if (ws && typeof ws.send === 'function') {
      const msg = JSON.stringify({ type, data, ts: Date.now() });
      ws.send(msg);
    }
  } catch {}
}

function projectDirFromSession(session, fallbackRoot) {
  if (!session) return fallbackRoot || process.cwd();
  try {
    if (session.__projectDir) return session.__projectDir;
  } catch {}
  try {
    if (typeof session.project === 'string' && fallbackRoot) {
      const path = require('node:path');
      return path.join(fallbackRoot, session.project);
    }
  } catch {}
  return fallbackRoot || process.cwd();
}

function detectStackFromTree(tree) {
  const files = [];
  const walk = (node, depth = 0) => {
    if (!node || depth > 3) return;
    if (Array.isArray(node)) node.forEach(n => walk(n, depth + 1));
    else if (node && typeof node === 'object' && typeof node.name === 'string') {
      files.push(node.name);
      if (Array.isArray(node.children)) walk(node.children, depth + 1);
    }
  };
  walk(tree);
  const has = (p) => files.some(f => p.test(f));
  const lang = has(/\.py$/i) ? 'python' : has(/\.tsx?$|\.jsx?$/i) ? 'node' : has(/\.java$/) ? 'java' : 'desconhecido';
  const framework = has(/next\.config|app\//) ? 'next' : has(/vite\.config/) ? 'vite' : has(/package\.json/) ? 'express' : 'nenhum';
  const pkgManager = has(/package-lock\.json/) ? 'npm' : has(/yarn\.lock/) ? 'yarn' : has(/pnpm-lock\.yaml/) ? 'pnpm' : null;
  return { lang, framework, pkgManager, filesFound: files.length };
}

// ============================================================================
//  API PÚBLICA · usada pelo early gate em server.js:runAgentLoop (T1)
// ============================================================================
export async function runAutonomousOrchestrator({ ws, session, userParts, autonomyFlags }) {
  // --- RC29 FR-5 · autonomyFlags recebidas do Early Gate (vars LOCAIS, não globalThis)
  //    Default: false se não fornecido → não força RC27/RC28.
  const _autoFlags = autonomyFlags && typeof autonomyFlags === 'object' ? autonomyFlags : {};
  const _rc27AutoEnabled = Boolean(_autoFlags.rc27Enabled);
  const _rc28AutoEnabled = Boolean(_autoFlags.rc28Enabled);
  if (_autoFlags.autoSeededByIntent === true) {
    try { session.__rc29AutoSeeded = { autoSeededByIntent: true, atMs: Date.now(), flags: Object.assign({}, _autoFlags) }; } catch {}
  }
  // --- (a) Extrair objetivo do userParts ---
  const objetivo = (Array.isArray(userParts) ? userParts : [])
    .filter(p => p && typeof p === 'object' && typeof p.text === 'string')
    .map(p => p.text)
    .join('\n')
    .trim();

  if (!objetivo) {
    return { handled: false, reason: 'objetivo_vazio' };
  }

  // --- (b) Resolver diretório do projeto ---
  let projectDir = null;
  let projectSlug = 'default';
  try {
    if (session && session.project) projectSlug = String(session.project);
  } catch {}
  try {
    const path = await import('node:path');
    if (session && typeof session.__projectDir === 'string') projectDir = session.__projectDir;
    else if (typeof globalThis.__WORKSPACE_ROOT === 'string') projectDir = path.join(globalThis.__WORKSPACE_ROOT, projectSlug);
  } catch {}
  if (!projectDir) {
    // Não consegue resolver → fallback para legado
    return { handled: false, reason: 'project_dir_indefinido' };
  }

  // --- (c) Carregar / inicializar Estado Central ---
  const loaded = await loadOrInitCentralState({ projectDir, projectSlug, objetivo });
  let centralState = loaded.state;
  const isResume = loaded.isResume;

  // ==========================================================================
  //  ETAPA 7 · CORREÇÃO P0 · GATE DE INTENÇÃO ANTES DO FLUXO AUTÔNOMO RC27/28
  //  Classifica a mensagem atual. Se shouldBuild=false → early return handled:false
  //  → cai no RC22 legado (chat puro de LLM sem plano de build automático).
  //  Garantia REGRA FUNDAMENTAL: "pergunta casual NÃO gera write_file/plano".
  // ==========================================================================
  {
    const _cls = (typeof Orch.classifyUserIntent === 'function')
      ? Orch.classifyUserIntent(objetivo, centralState)
      : { intent: 'SOLICITACAO_EXECUCAO', confidence: 0, shouldBuild: true, reason: 'classificador_nao_disponivel' };
    if (session && typeof session === 'object') {
      try { session.__ti_etapa7 = Object.assign({}, _cls, { objetivoMensagem: String(objetivo||'').slice(0, 300), dt: Date.now() }); } catch {}
    }
    if (_cls.shouldBuild !== true) {
      return {
        handled: false,
        reason: 'ETAPA7_CHAT_ONLY__' + String(_cls.intent || 'INDEFINIDO') + '__' + String(_cls.reason || 'na'),
        intent: _cls,
        objetivoMensagem: objetivo,
        projectSlug,
        faseAnterior: centralState && centralState.faseGeral ? centralState.faseGeral : null,
        etapa7Isolated: true
      };
    }
  }

  // ==========================================================================
  //  ETAPA 7 · CORREÇÃO P1 · ISOLAMENTO DO OBJETIVO ATUAL
  //  Define se o patchAnalysis (que sobrescreve objetivoAtual) deve executar:
  //    - !isResume = sessão nova
  //    - fase terminal (COMPLETED / BLOCKED / FAILED / VERIFIED / CANCELLED) →
  //      a execução ANTERIOR terminou; esta mensagem é um objetivo NOVO,
  //      independente, NÃO É continuação de trabalho anterior.
  //  Apenas fase em ANDAMENTO (ANALYSIS/PLANNING/ARCHITECTURE/IMPLEMENTATION)
  //  ou AWAIT_WS* retorna isResume=true e skip reset → continuação natural.
  // ==========================================================================
  const _ETAPA7_FASES_NAO_TERMINAIS = new Set(['ANALYSIS','PLANNING','ARCHITECTURE','IMPLEMENTATION','AWAITING_INTERNET_AUTHORIZATION']);
  const _ETAPA7_execAnteriorEmAndamento = isResume && centralState && typeof centralState.faseGeral === 'string'
    && _ETAPA7_FASES_NAO_TERMINAIS.has(centralState.faseGeral);
  const _ETAPA7_deveAplicarPatchAnalysisReset = !_ETAPA7_execAnteriorEmAndamento;
  // Salva sinalizador no centralState para uso posterior (verificação gate §19)
  try {
    if (!_ETAPA7_execAnteriorEmAndamento && centralState) {
      // Não grava disco ainda; só runtime. MergePatch no patchAnalysis abaixo.
    }
  } catch {}

  // --- (d) Primeiro evento WS transparência §20 (stepper UI) ---
  _emitWsOrLog(ws, 'orch:phase', {
    fase: centralState.faseGeral,
    isResume,
    objetivo,
    label: phaseLabel(centralState.faseGeral),
    stateSummary: {
      tarefasConcluidas: centralState.tarefasConcluidas,
      tarefasPendentes: centralState.tarefasPendentes,
      proximaAcao: centralState.proximaAcao
    }
  });

  // ============================================================
  //  FASE 1 · ANÁLISE DO PROJETO (§2 diagrama)
  // ============================================================
  //  ETAPA 7 CORREÇÃO: condicional nova _ETAPA7_deveAplicarPatchAnalysisReset
  //  substitui a antiga "ANALYSIS || !isResume". A nova variável já considera
  //  reset quando fase anterior é TERMINAL (COMPLETED/BLOCKED/etc.) → garante
  //  isolamento do objetivo e NÃO contamina com build PetShop/Clínica antigo.
  if (_ETAPA7_deveAplicarPatchAnalysisReset) {
    // ================================================================
    //  RC29 · PONTO B · Inicializar autonomyRuntime (FR-1)
    //  → GARANTIDO: criado ANTES do patchAnalysis → objetivoAtual não
    //  fica sem correspondência no core RC29.
    //  ================================================================
    const rc29InitialRuntime = RC29.rc29InitRuntime({ objective: objetivo });
    const requirements = Orch.extractGoalRequirements({ objetivo });
    const needsPersistence = Boolean(requirements.detection.needsPersistence);
    const needsInternet = Boolean(requirements.detection.needsInternet);

    const patchAnalysis = {
      autonomyRuntime: rc29InitialRuntime,
      objetivoAtual: objetivo,
      objetivoUsuarioMensagem: objetivo,
      objetivoOrigem: _ETAPA7_execAnteriorEmAndamento ? 'CONTINUACAO' : 'NOVA_SOLICITACAO',
      requisitos: requirements,
      needsPersistence,
      proximaAcao: needsInternet ? 'PEDIR_AUTORIZACAO_INTERNET' : 'QUEBRAR_PLANO_TAREFAS',
      faseGeral: 'PLANNING',
      statusExecucao: 'running',
      arquitetura: {
        camadas: needsPersistence ? ['frontend','backend API','persistência','validações'] : ['frontend','backend API'],
        estruturaPastas: needsPersistence ? ['/public','/src','/src/routes','/src/models','/uploads'] : ['/public','/src'],
        padroes: ['MVC leve','REST JSON','validação server-side']
      },
      tecnologias: {
        lang: 'node',
        framework: 'express',
        banco: needsPersistence ? 'sqlite-better-sqlite3' : 'nenhum (dados em memória temporária para protótipo / JSON file)',
        libs: ['express','cors','dotenv']
      },
      decisoesTecnicas: [
        ...(centralState.decisoesTecnicas || []),
        { id: 'DEC_' + Date.now().toString(36), title: needsPersistence ? 'Persistência: SQLite via better-sqlite3' : 'Persistência: não necessária', rationale: needsPersistence ? 'Necessidade de cadastro/sessão detectada; SQLite é zero-conf e reversível' : 'Objetivo não menciona persistência/dados permanentes', alternatives: needsPersistence ? ['Postgres','JSON file','MongoDB'] : [], createdAt: Date.now() }
      ]
    };

    const analysisResult = await mergePatchCentralState({ projectDir, patch: patchAnalysis });
    if (!analysisResult.ok) {
      return { handled: false, reason: 'merge_patch_failed_analysis', detail: analysisResult.error };
    }
    centralState = analysisResult.state;

    // Checkpoint após análise
    const cp1 = await createCheckpoint({ projectDir, fase: 'ANALYSIS', seq: 1, summary: 'análise inicial + requisitos extraídos' });
    if (cp1.ok) {
      const upd = await mergePatchCentralState({ projectDir, patch: { checkpoints: [...(centralState.checkpoints || []), cp1.checkpoint] } });
      centralState = upd.state;
    }

    _emitWsOrLog(ws, 'orch:phase', { fase: 'PLANNING', label: phaseLabel('PLANNING'), objetivo });
  }

  // ============================================================
  //  FASE 2 · PLANEJAMENTO AUTÔNOMO + TOPOLÓGICO (§6 diagrama)
  // ============================================================
  if (centralState.faseGeral === 'PLANNING') {
    const tasksRaw = Orch.buildAutonomousTaskPlan({
      requirements: centralState.requisitos,
      needsPersistence: centralState.needsPersistence,
      projectSlug,
      stack: centralState.tecnologias,
      analysis: null
    });
    const topo = Orch.topoSortTasks(tasksRaw);

    let tasksPlano;
    let cicloDetectado = false;
    if (topo.ok) tasksPlano = topo.sorted;
    else {
      tasksPlano = tasksRaw;
      cicloDetectado = true;
    }

    const patchPlanejamento = {
      tarefas: tasksPlano,
      tarefasConcluidas: tasksPlano.filter(t => t.status === 'completed').length,
      tarefasPendentes: tasksPlano.filter(t => ['pending','in_progress','blocked'].includes(t.status)).length,
      proximaAcao: cicloDetectado ? 'QUEBRAR_CICLO_DEPENDENCIA' : 'CHAMAR_AGENTE_ARQUITETA',
      faseGeral: 'ARCHITECTURE',
      limitacoes: cicloDetectado ? [...(centralState.limitacoes || []), `Ciclo de dependência detectado no planejamento: nós ${topo.cycleNodes.join(', ')}. Ordem original usada.`] : centralState.limitacoes
    };
    const planResult = await mergePatchCentralState({ projectDir, patch: patchPlanejamento });
    centralState = planResult.state;

    const cp2 = await createCheckpoint({ projectDir, fase: 'PLANNING', seq: 2, summary: `plano com ${tasksPlano.length} tarefas; topoSort ok=${topo.ok}` });
    if (cp2.ok) {
      const upd = await mergePatchCentralState({ projectDir, patch: { checkpoints: [...(centralState.checkpoints || []), cp2.checkpoint] } });
      centralState = upd.state;
    }

    _emitWsOrLog(ws, 'orch:plan', {
      tasksCount: tasksPlano.length,
      hasCycle: cicloDetectado,
      tasksPreview: tasksPlano.slice(0, 6).map(t => ({ id: t.id, title: t.title, agent: t.agent, status: t.status, dependsOn: t.dependsOn }))
    });
    _emitWsOrLog(ws, 'orch:phase', { fase: 'ARCHITECTURE', label: phaseLabel('ARCHITECTURE') });
  }

  // ============================================================
  //  PEDIDO AUTORIZAÇÃO INTERNET (§9) — se detectou necessidade
  // ============================================================
  if (centralState.requisitos && centralState.requisitos.detection && centralState.requisitos.detection.needsInternet && !centralState.internetAuthorization) {
    const scopeId = 'scope_' + Date.now().toString(36);
    _emitWsOrLog(ws, 'orch:internet_authorization_requested', {
      scopeId,
      reason: [
        centralState.requisitos.detection.needsWhatsApp ? 'Consultar documentação oficial WhatsApp (WATI/Evolux) para integração real §22' : null,
        centralState.requisitos.detection.needsPayment ? 'Consultar documentação oficial de provedor de pagamentos PIX/cartão' : null,
        'Verificar versões compatíveis atuais de bibliotecas recomendadas'
      ].filter(Boolean).join(' + '),
      urls: [
        centralState.requisitos.detection.needsWhatsApp ? 'https://docs.wati.io/reference/getting-started-with-your-api' : null,
        'https://www.npmjs.com/package/express'
      ].filter(Boolean),
      estimatedScope: 'tarefa_atual'
    });
    // Marca tarefa INTERNET como blocked; orquestrador fica aguardando resposta do usuário
    // (nesta fase inicial antes do loop de WS listener completo, retorna handled=true
    //  para evitar que o legado inicie enquanto aguarda clique Sim/Não)
    return { handled: true, phase: 'AWAITING_INTERNET_AUTHORIZATION', scopeId, state: centralState };
  }

  // ============================================================
  //  FASES RESTANTES (ARCHITECTURE → VALIDATION)
  //  T4/T5/T6 irão preencher este bloco com integração real aos
  //  agentes existentes. Nesta fase T3, marcamos como handled=false
  //  para cair no legado SE usuário pediu execução IMEDIATA.
  //
  //  REGRA CRÍTICA: NÃO declarar tarefa concluída sem implementação
  //  e validação reais (§19). Aqui só guardamos o plano no Estado
  //  Central e deixamos o RC22/RC24 legado entregar código real.
  // ============================================================
  //
  // ============================================================
  //  RC28 · INJEÇÃO ADITIVA (camada ACIMA do RC27) — §3 plano
  //  Hook chamado APENAS após ARCHITECTURE (fase ≥ IMPLEMENTATION).
  //  NÃO toca ANALYSIS/PLANNING/INTERNET bloqueado existentes.
  //  Se RC28 off → early return dentro do loop, zero overhead.
  // ============================================================
  try {
    const RC28_ENABLED_FROM_ENV = typeof globalThis.__RC28_ENABLED === 'boolean'
      ? globalThis.__RC28_ENABLED
      : (typeof process !== 'undefined' && process.env && String(process.env.RC28_DECISION_ENGINE || 'off').trim().toLowerCase() === 'on');
    const RC27_ENABLED_FROM_ENV = typeof globalThis.__RC27_ENABLED === 'boolean'
      ? globalThis.__RC27_ENABLED
      : (typeof process !== 'undefined' && process.env && String(process.env.RC27_AUTONOMOUS_MODE || 'off').trim().toLowerCase() === 'on');
    if ((RC28_ENABLED_FROM_ENV || _rc28AutoEnabled) && (RC27_ENABLED_FROM_ENV || _rc27AutoEnabled)) {
      const MAX_C = typeof globalThis.__RC28_MAX_CYCLES === 'number' ? globalThis.__RC28_MAX_CYCLES : (parseInt(String((process.env||{}).RC28_MAX_CYCLES || '40'),10)||40);
      const CK_EVERY = typeof globalThis.__RC28_CHECKPOINT_EVERY === 'number' ? globalThis.__RC28_CHECKPOINT_EVERY : (parseInt(String((process.env||{}).RC28_CHECKPOINT_EVERY_CYCLES || '5'),10)||5);
      const VERBOSE = typeof globalThis.__RC28_VERBOSE === 'boolean' ? globalThis.__RC28_VERBOSE : (String((process.env||{}).RC28_VERBOSE_LOG || 'false').trim().toLowerCase()==='true');
      const FORCE_AFTER = typeof globalThis.__RC28_FORCE_AFTER === 'boolean' ? globalThis.__RC28_FORCE_AFTER : (String((process.env||{}).RC28_FORCE_RUN_AFTER_PLAN || 'false').trim().toLowerCase()==='true');
      const ENGINE_MODE = typeof globalThis.__RC28_ENGINE_MODE === 'string'
        ? globalThis.__RC28_ENGINE_MODE
        : (String((process.env||{}).RC28_ENGINE || 'heuristic').trim().toLowerCase() === 'adaptive' ? 'adaptive' : 'heuristic');
      const CONF_THRESH = typeof globalThis.__RC28_CONF_THRESHOLD === 'number'
        ? globalThis.__RC28_CONF_THRESHOLD
        : (parseFloat(String((process.env||{}).RC28_ENGINE_CONFIDENCE || '0.7')) || 0.7);
      // ================================================================
      //  RC29 · PONTO C(antes) · Garantir autonomyRuntime existe antes
      //  de entrar no RC28 (continuação/resume sem patchAnalysis).
      //  Evita NPE no RC28 patch de progresso.
      // ================================================================
      if (!centralState || !centralState.autonomyRuntime || typeof centralState.autonomyRuntime !== 'object' || centralState.autonomyRuntime.objective !== String(objetivo||'').slice(0,2000)) {
        const rc29Seed = RC29.rc29InitRuntime({ objective: objetivo });
        const pm = await mergePatchCentralState({ projectDir, patch: { autonomyRuntime: rc29Seed } });
        if (pm && pm.ok) centralState = pm.state;
      }
      const rc28Result = await rc28RunDecisionLoop({
        ws, session, projectDir, centralState,
        rc27Enabled: true, rc28Enabled: true,
        rc28MaxCycles: MAX_C,
        rc28CheckpointEvery: CK_EVERY,
        rc28Verbose: VERBOSE,
        rc28ForceAfterPlan: FORCE_AFTER,
        rc28EngineMode: ENGINE_MODE,
        rc28ConfidenceThreshold: CONF_THRESH,
        rc28LlmAnalyzeFn: typeof globalThis.__rc28LlmAnalyzeFn === 'function' ? globalThis.__rc28LlmAnalyzeFn : null,
        objetivoUsuario: objetivo,
        makeToolsFn: typeof globalThis.__rc28MakeToolsFn === 'function' ? globalThis.__rc28MakeToolsFn : null,
        runLegacyAgentFn: typeof globalThis.__rc28RunLegacyAgentFn === 'function' ? globalThis.__rc28RunLegacyAgentFn : null,
        rc24BridgeFn: typeof Orch.decideNextAction === 'function' ? (s, o) => Orch.decideNextAction(s && s.agentSpec || null, s && s.agentState || null, o || {}) : null,
      });
      // ================================================================
      //  RC29 · PONTO C(depois) · Emitir OBJETIVO VERIFICADO ou BLOQUEIO
      // ================================================================
      const rc29FinalRuntime = rc28Result && rc28Result.state && rc28Result.state.autonomyRuntime ? rc28Result.state.autonomyRuntime : null;
      if (rc29FinalRuntime && rc29FinalRuntime.objectiveVerified === true && rc28Result && rc28Result.rc28 === 'completed_gate_19') {
        _emitWsOrLog(ws, 'orch:phase', {
          fase: 'VERIFIED',
          label: '🎯 OBJETIVO VERIFICADO',
          info: `RC29 confirmou TASK_COMPLETED ≠ OBJECTIVE_VERIFIED passou · ${String(rc29FinalRuntime.lastVerificationReason || '').slice(0, 160)} · progresso=${rc29FinalRuntime.objectiveProgressPct}%`,
          objectiveProgressPct: rc29FinalRuntime.objectiveProgressPct,
          completedTaskIds: rc29FinalRuntime.completedTaskIds,
          loops: rc29FinalRuntime.loops,
        });
        if (rc29FinalRuntime.loops) {
          try { await mergePatchCentralState({ projectDir, patch: { autonomyRuntime: { ...rc29FinalRuntime, concludedAtMs: Date.now() } } }); } catch {}
        }
      } else if (rc29FinalRuntime && rc29FinalRuntime.blockingReason && typeof rc29FinalRuntime.blockingReason === 'object') {
        const br = rc29FinalRuntime.blockingReason;
        _emitWsOrLog(ws, 'orch:blocked', {
          kind: br.kind,
          title: br.title,
          detail: br.detail,
          userActionRequired: br.userActionRequired,
          blockedAtMs: br.blockedAtMs,
          phase: rc28Result && rc28Result.state && rc28Result.state.faseGeral ? rc28Result.state.faseGeral : 'IMPLEMENTATION',
          objectiveProgressPct: Number(rc29FinalRuntime.objectiveProgressPct || 0),
        });
        console.warn(`[RC29 BLOQUEIO] ${String(br.kind||'')} · ${String(br.title||'')} · userAction=${String(br.userActionRequired||'').slice(0,120)}`);
      }
      if (rc28Result && (rc28Result.handled === true || rc28Result.rc28 === 'completed_gate_19')) {
        return {
          handled: true,
          phase: (rc28Result.state && rc28Result.state.faseGeral) || 'COMPLETED',
          state: rc28Result.state,
          reason: rc28Result.reason,
          rc28: { steps: rc28Result.steps, engine: RC28_LOOP_VER, mode: rc28Result.rc28 },
          objectiveVerified: rc29FinalRuntime ? Boolean(rc29FinalRuntime.objectiveVerified) : false,
          objectiveProgressPct: rc29FinalRuntime ? Number(rc29FinalRuntime.objectiveProgressPct || 0) : null,
          blockingReason: rc29FinalRuntime && rc29FinalRuntime.blockingReason ? rc29FinalRuntime.blockingReason : null,
          resumeFrom: (rc28Result.state && rc28Result.state.faseGeral) || 'COMPLETED'
        };
      }
      if (rc28Result && (rc28Result.rc28 === 'AWAIT_WS_INTERNET' || rc28Result.paused === 'paused_awaiting_internet' || rc28Result.rc28 === 'AWAIT_WS_HUMAN')) {
        // Quem retoma é o handler WS resume (P6 server.js)
        const pausedIsInternet = rc28Result.paused === 'paused_awaiting_internet' || rc28Result.rc28 === 'AWAIT_WS_INTERNET';
        if (pausedIsInternet && (!rc29FinalRuntime || !rc29FinalRuntime.blockingReason)) {
          // Injetar bloqueio RC29 INTERNET_UNAUTHORIZED para consistência FR-4
          try {
            const block = RC29.rc29BuildBlockingReason({
              kind: 'INTERNET_UNAUTHORIZED',
              title: 'Aguardando autorização de internet do usuário',
              detail: 'O RC28 detectou necessidade de internet (AWAIT_WS_INTERNET). Aguardando o usuário autorizar através do modal /ws resume.',
              userActionRequired: 'Na janela do browser, clique em "Sim / Autorizar" para permitir internet neste objetivo. A execução será retomada automaticamente.',
            });
            const merged = RC29.rc29ApplyBlockingReason(rc29FinalRuntime || RC29.rc29InitRuntime({ objective: objetivo }), block);
            await mergePatchCentralState({ projectDir, patch: { autonomyRuntime: merged } });
          } catch {}
        }
        return {
          handled: true,
          phase: rc28Result.rc28 || (rc28Result.paused && rc28Result.paused.toUpperCase()) || 'AWAITING_INTERNET_AUTHORIZATION',
          state: rc28Result.state,
          reason: rc28Result.reason,
          rc28: { steps: rc28Result.steps, paused: rc28Result.paused, engine: RC28_LOOP_VER },
          paused: rc28Result.paused,
          blockingReason: rc28Result.state && rc28Result.state.autonomyRuntime && rc28Result.state.autonomyRuntime.blockingReason ? rc28Result.state.autonomyRuntime.blockingReason : null,
          projectDir
        };
      }
      // rc28 não tratou → fallback normal abaixo
    }
  } catch (rc28Err) {
    // RC28 com erro → NÃO quebra RC27. Fallback para legado c/ log.
    console.warn(`[RC27→RC28 hook] erro no loop RC28 (ignorado, fallback legado): ${rc28Err && rc28Err.message || rc28Err}`);
  }

  if (!RC27_MOTOR__RUN_LEGACY_AFTER_PLAN) {
    return { handled: true, phase: centralState.faseGeral, state: centralState, resumeFrom: 'IMPLEMENTATION' };
  }
  return { handled: false, reason: 'rc27_plan_saved_run_legacy_below', centralState };
}

// Variável global controlada pela Tarefa 6 (gate). Antes de T6, padrão = false
// (não roda legado depois do plano, espera o loop orquestrador completo T5+T6).
// T6 vai setar RC27_MOTOR__RUN_LEGACY_AFTER_PLAN = false também, pois é onde
// a integração real com runAgentLoopLegacyOriginal fica.
export const RC27_MOTOR__RUN_LEGACY_AFTER_PLAN = false;

// ============================================================================
//  RC27 · §17  Wrapper anti-loop infinito: autoCorrectionLoop
//  Protege contra mesma tentativa repetida, progresso ausente e regressão.
//  Máximo maxPasses iterações (padrão 4 conforme RC27_MAX_CORRECTION_PASSES).
//
//  Assinatura executePass (passNumber, ctx) → Promise<{
//    ok: boolean, erroStack?: string, writeFilesChangedCount: number,
//    erroMessage?: string, diagnostics?: any[]
//  }>
// ============================================================================
export function _rc27HashErrorStack(stackOrMessage) {
  const input = String(stackOrMessage || '').replace(/\s+at\s+.*\([^)]*\)\s*$/gm, '').replace(/(:\d+:\d+\)?)/g, ':LINE:COL').replace(/node:internal\/[^\n]+/g, '__NODE_INTERNAL__').trim().slice(0, 4000);
  let h1 = 0xdeadbeef ^ input.length; let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) { const ch = input.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
  return `sig_${hex}`;
}

export async function autoCorrectionLoop({ maxPasses = 4, taskId = null, projectDir, ws, executePass, ctx = {} }) {
  const maxP = Math.max(1, Math.min(8, parseInt(maxPasses || 4, 10)));
  const attempts = [];
  const erroSignatureCount = new Map();
  let noProgressStreak = 0;
  let lastSignature = null;

  for (let pass = 1; pass <= maxP; pass++) {
    let result;
    try {
      result = await Promise.resolve().then(() => executePass(pass, { ...ctx, _passNumber: pass, _totalPasses: maxP, _attempts: attempts }));
    } catch (e) {
      result = { ok: false, erroStack: e.stack || e.message, erroMessage: e.message, writeFilesChangedCount: 0 };
    }
    if (!result || typeof result !== 'object') result = { ok: !!result, writeFilesChangedCount: 0, erroMessage: 'executePass não retornou objeto' };
    const passInfo = {
      pass,
      ok: !!result.ok,
      erroMessage: result.erroMessage || null,
      signature: _rc27HashErrorStack(result.erroStack || result.erroMessage || (result.ok ? 'PASS_OK_' + pass : 'no_stack')),
      writeFilesChangedCount: Math.max(0, parseInt(result.writeFilesChangedCount || 0, 10)),
      diagnostics: Array.isArray(result.diagnostics) ? result.diagnostics.slice(0, 3) : [],
      atMs: Date.now(),
    };
    attempts.push(passInfo);

    if (passInfo.ok) {
      // Atualiza Estado Central: tarefa completada, tentativas logadas
      try {
        if (projectDir && typeof mergePatchCentralState === 'function') {
          await mergePatchCentralState({ projectDir, patch: { correcoesRealizadas: attempts.map(a => ({ ...a, diagnostics: undefined })), lastPassOk: pass } });
        }
      } catch {}
      return { ok: true, loopResult: 'RESOLVED', attempts, resolvedIn: pass, resolved: true };
    }

    // === Anti-loop: mesma assinatura + 0 writes 2x seguida = sem progresso real ===
    const signatureCount = (erroSignatureCount.get(passInfo.signature) || 0) + 1;
    erroSignatureCount.set(passInfo.signature, signatureCount);
    if (lastSignature === passInfo.signature && passInfo.writeFilesChangedCount === 0) {
      noProgressStreak++;
    } else {
      noProgressStreak = 0;
    }
    lastSignature = passInfo.signature;

    // Gatilhos de abort §17
    if (signatureCount >= 2 && passInfo.writeFilesChangedCount === 0) {
      const abortReason = 'MESMISSIMO_ERRO_SEM_WRITE';
      try {
        if (ws) _emitWsOrLog(ws, 'orch:correction_warning', { level: 'warn', reason: abortReason, signature: passInfo.signature, pass, taskId, attemptsCount: attempts.length, message: `2x mesma assinatura (${passInfo.signature.slice(0, 14)}…) sem write_file. Abortando estratégia e mudando abordagem §17.` });
      } catch {}
      // Não aborta o loop total ainda, só essa estratégia. Marca para mudar tática.
      attempts[attempts.length - 1].abortStrategy = true;
      attempts[attempts.length - 1].abortReason = abortReason;
      // Se já passou de maxP//2 → para para não gastar todas iterações na mesma abordagem
      if (pass >= Math.floor(maxP / 2) + 1) {
        return _rc27MarkBlockedHuman({ maxP, attempts, ws, projectDir, taskId, finalReason: `${abortReason} em pass=${pass}` });
      }
    }
    if (noProgressStreak >= 2) {
      return _rc27MarkBlockedHuman({ maxP, attempts, ws, projectDir, taskId, finalReason: '2+ iterações SEM write_file novo (tentou mesma abordagem 2x sem mudar nenhum arquivo §17)' });
    }
    if (signatureCount >= 3) {
      return _rc27MarkBlockedHuman({ maxP, attempts, ws, projectDir, taskId, finalReason: `MESMO stack trace 3x (sig=${passInfo.signature.slice(0, 14)}…); esgotadas abordagens razoáveis sem sucesso §17.` });
    }
  }

  // Excedeu maxPasses sem resolver
  return _rc27MarkBlockedHuman({ maxP, attempts, ws, projectDir, taskId, finalReason: `EXCEDEU maxPasses=${maxP} iterações de correção sem sucesso §17.` });
}

async function _rc27MarkBlockedHuman({ maxP, attempts, ws, projectDir, taskId, finalReason }) {
  try {
    if (projectDir && typeof mergePatchCentralState === 'function') {
      const patch = {
        correcoesRealizadas: attempts.map(a => ({ ...a, diagnostics: undefined })),
        statusExecucao: 'blocked',
        blockedReason: finalReason,
        blockedAtMs: Date.now(),
        proximaAcao: 'AGUARDA_INTERVENCAO_HUMANA',
      };
      if (taskId) {
        // Marca a tarefa individual como blocked também
        try {
          const st = await loadOrInitCentralState({ projectDir });
          const tarefas = Array.isArray(st.state?.tarefas) ? st.state.tarefas : [];
          const idx = tarefas.findIndex(t => String(t.id) === String(taskId));
          if (idx !== -1) { tarefas[idx].status = 'blocked'; tarefas[idx].motivoBloqueio = finalReason; tarefas[idx].updatedAtMs = Date.now(); patch.tarefas = tarefas; }
        } catch {}
      }
      await mergePatchCentralState({ projectDir, patch });
    }
  } catch {}
  try {
    if (ws) _emitWsOrLog(ws, 'orch:human_intervention_needed', {
      level: 'error', taskId, maxAttempts: maxP, attempts: attempts.length, finalReason,
      attemptsSummary: attempts.map(a => ({ pass: a.pass, ok: a.ok, signature: a.signature?.slice(0, 18), writes: a.writeFilesChangedCount, erro: (a.erroMessage || '').slice(0, 200) })),
      userMessage: `⚠️ Autocorreção travou após ${attempts.length} tentativas. Motivo: ${finalReason}. Por favor revise o problema manualmente ou autorize uma nova abordagem diferente.`,
      whenCanIContinueMyself: 'Forneça dicas do que tentar, ou clique em "Tentar novamente com abordagem alternativa" após corrigir manualmente.',
    });
  } catch {}
  return { ok: false, resolved: false, loopResult: 'BLOCKED', finalReason, attempts, needsHuman: true };
}

export { PHASE_SEQUENCE, detectStackFromTree };

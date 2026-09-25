// ============================================================================
//  rc28_llm_bridge.js · Camada fina RC28 → LLM REAL do TiAgente
//  - REUTILIZA 100% a infra runLLMTextOnly existente (NÃO cria cliente novo)
//  - NÃO lê ENV, NÃO lê keys, NÃO gerencia tokens → tudo via injeção de dependência
//  - ENVIA APENAS contexto operacional necessário (NUNCA keys/tokens/senhas/cookies)
//  - Qualquer erro: retorna null → Engine cai no heurístico (garantia de segurança)
// ============================================================================

export const RC28_LLM_BRIDGE_VERSION = 'rc28.1.llmbridge.v1';

export const STRATEGY_TYPES_ALLOWED = new Set([
  'HEURISTIC_DEFAULT',
  'PRIORITY_FIRST_UNBLOCKED',
  'PARALLEL_READY_BY_AGENT_TYPE',
  'CORRECT_FIRST_FAIL_FAST',
  'RESEARCH_THEN_EXECUTE',
  'SECURITY_AUDIT_FIRST',
  'TEST_DRIVEN_FIX',
  'MINI_STEP_BACKTRACK'
]);

export const ACTIONS_ALLOWED = new Set([
  'EXECUTE_TASK', 'AWAIT_TASK_TOOL', 'GOTO_PHASE', 'ASK_HUMAN_INPUT',
  'AWAIT_WS_INTERNET', 'RUN_SECURITY_AUDIT', 'FORCE_AUTOCORRECTION_PASS',
  'SKIP_TO_QA', 'RUN_TOOL_TESTS_NOW', 'STALL_ROLLBACK_CHECKPOINT', 'FINALIZE'
]);

const RISK_LEVELS_ALLOWED = new Set(['low', 'medium', 'high']);

export function rc28MakeLlmAnalyzeFn({ runLLMTextOnly, provider, model, tag = 'rc28_llm_bridge', temperature = 0.1, maxTokens = 1024 }) {
  if (typeof runLLMTextOnly !== 'function') {
    console.warn(`[${tag}] runLLMTextOnly ausente. Bridge inativo (null permanente). Engine usa heurística.`);
    return null;
  }
  const effectiveProvider = (provider || 'gemini').toString().trim().toLowerCase();
  const effectiveModel = (model || 'gemini-3.5-flash-lite').toString().trim();

  // A função que o Engine chama quando confiança heurística < threshold:
  async function rc28LlmAnalyzeAsync(decisionInput, scoredAlternatives) {
    try {
      const prompt = _buildPrompt(decisionInput, scoredAlternatives);
      if (!prompt) return null;

      const system = RC28_LLM_BRIDGE_SYSTEM_PROMPT;
      const resp = await runLLMTextOnly({
        provider: effectiveProvider,
        model: effectiveModel,
        system,
        user: prompt,
        temperature: Math.max(0, Math.min(1, parseFloat(temperature) || 0.1)),
        maxTokens: Math.max(256, Math.min(4096, parseInt(maxTokens, 10) || 1024)),
        tag
      });
      if (!resp || typeof resp.text !== 'string') return null;
      const parsed = _parseAndSanitizeLlmJson(resp.text);
      if (!parsed) return null;

      // Retorna no mesmo formato que o Engine espera de um "enriquecimento":
      // { selectedStrategy?, alternatives?, selectionReason?, confidenceBoost?, risks?, fallbackStrategy? }
      return _toEnginePatch(parsed, scoredAlternatives || []);
    } catch (err) {
      // Qualquer exceção (network, 429, 502, 503, key ausente) → null
      //   → cai no heurístico seguro, NÃO quebra o loop.
      if (typeof err?.message === 'string' && /429|5\d{2}|timeout|abort/i.test(err.message)) {
        console.log(`[${tag}] LLM indisponível (${String(err.message).slice(0,60)}). Fallback heurístico.`);
      } else {
        console.warn(`[${tag}] erro LLM (silêncio, fallback heurístico): ${String(err && err.message || err).slice(0,80)}`);
      }
      return null;
    }
  }

  rc28LlmAnalyzeAsync._version = RC28_LLM_BRIDGE_VERSION;
  rc28LlmAnalyzeAsync._provider = effectiveProvider;
  rc28LlmAnalyzeAsync._model = effectiveModel;
  return rc28LlmAnalyzeAsync;
}

// ================================================================
// Construção do prompt: SÓ contexto operacional, NENHUM segredo.
// ================================================================
function _buildPrompt(decisionInput, scoredAlternatives) {
  if (!decisionInput || typeof decisionInput !== 'object') return null;

  const objetivo = _truncate(String(decisionInput.objetivo || decisionInput.objetivoUsuario || ''), 400);
  if (!objetivo.length) return null;

  const state = decisionInput.estadoAtual || decisionInput.state || {};
  const faseGeral = String(state.faseGeral || '');
  const tarefasTotais = Array.isArray(state.tarefas) ? state.tarefas.length : 0;
  const tarefasConcluidas = Number(state.tarefasConcluidas || 0);
  const tarefasBloqueadas = Array.isArray(state.tarefas)
    ? state.tarefas.filter(t => t && t.status === 'blocked').length : 0;
  const erros = Array.isArray(state.errosEncontrados) ? state.errosEncontrados.length : 0;
  const pm = (state.decisionEngine && state.decisionEngine.progressMetrics) || {};
  const totalCiclos = Number(pm.totalCycles || 0);
  const noProgressStreak = Number(pm.noProgressStreak || 0);
  const objectiveProgressPct = Number(pm.objectiveProgressPct || 0);

  const restricoes = Array.isArray(decisionInput.restricoes)
    ? decisionInput.restricoes.map(r => '- ' + _truncate(String(r), 80)).slice(0, 8) : [];
  const ferramentas = Array.isArray(decisionInput.ferramentasDisponiveis)
    ? decisionInput.ferramentasDisponiveis.map(f => _truncate(String(f), 30)).slice(0, 12) : [];

  const hyps = (state.decisionEngine && Array.isArray(state.decisionEngine.hypotheses))
    ? state.decisionEngine.hypotheses : (Array.isArray(decisionInput.hipotesesExistentes) ? decisionInput.hipotesesExistentes : []);
  const hipotesesStr = hyps.slice(0, 6).map(h =>
    `- ${String(h && h.id || 'H?').toUpperCase()} (conf=${Math.round((Number(h && h.confidence)||0)*100)}%) ${_truncate(String(h && h.statement || ''), 120)}`
  ).join('\n');

  const inef = (state.decisionEngine && Array.isArray(state.decisionEngine.ineffectiveStrategies))
    ? state.decisionEngine.ineffectiveStrategies : [];
  const inefStr = inef.slice(0, 6).map(s =>
    `- ${String(s && s.strategyType || '?')} · motivo=${_truncate(String(s && s.reason || s && s.discardedBecause || ''), 80)}`
  ).join('\n');

  const scored = Array.isArray(scoredAlternatives) && scoredAlternatives.length ? scoredAlternatives : [];
  const alts = scored.slice(0, 8).map(a =>
    `- ${String(a.strategyType || a.alt && a.alt.strategyType || '?')} score=${Number(a.score||0).toFixed(3)} risk=${String(a.risk||(a.alt&&a.alt.riskLevel)||'?')}`
  ).join('\n');

  const step = Number(decisionInput.step || decisionInput.cycle || 0);
  const maxCycles = Number(decisionInput.maxCycles || 0);
  const threshold = Number(decisionInput.confidenceThreshold || decisionInput.threshold || 0.7);

  const out = {
    objetivo, faseGeral,
    progresso: { tarefasTotais, tarefasConcluidas, tarefasBloqueadas, erros, objectiveProgressPctPct: objectiveProgressPct, totalCiclos, noProgressStreak, step, maxCycles },
    restricoes, ferramentasDisponiveis: ferramentas,
    hipotesesAtuais: hipotesesStr ? hipotesesStr.split('\n') : [],
    estrategiasIneficazesAnteriores: inefStr ? inefStr.split('\n') : [],
    alternativasHeuristicas: alts ? alts.split('\n') : [],
    thresholdConfiancaHeuristica: Number((threshold * 100).toFixed(0)) + '%'
  };
  return JSON.stringify(out, null, 2).slice(0, 6000);
}

const RC28_LLM_BRIDGE_SYSTEM_PROMPT = `Você é o Componente de Análise Adaptativa do TiAgente-RC28 Decision Engine.
Seu trabalho NÃO é executar comandos, NÃO é gerar código, NÃO é acessar internet.
Seu trabalho ÚNICO: analisar o cenário operacional dado e devolver UM JSON EXATO (nada além de JSON válido), com os campos abaixo, para o Decision Engine escolher a melhor estratégia do próximo passo.

REGRAS OBRIGATÓRIAS (NÃO QUEBRE):
1. RESPONDA SOMENTE JSON. Nenhuma explicação, markdown, crase-crase-crase json, nota prévia, nada.
2. SELECIONE APENAS UM dos strategyType da lista BRANCA ABAIXO. NÃO invente nomes.
   strategyType permitidos: HEURISTIC_DEFAULT, PRIORITY_FIRST_UNBLOCKED, PARALLEL_READY_BY_AGENT_TYPE, CORRECT_FIRST_FAIL_FAST, RESEARCH_THEN_EXECUTE, SECURITY_AUDIT_FIRST, TEST_DRIVEN_FIX, MINI_STEP_BACKTRACK.
3. Campos obrigatórios no JSON de resposta:
{
  "analysis": "string curta ≤250 caracteres · resumo executivo da situação",
  "recommendedStrategyType": "UM dos tipos brancos acima",
  "recommendedReason": "string curta ≤350 caracteres · por que essa estratégia é melhor agora",
  "confidence": 0.0 a 1.0 · sua confiança (se inseguro, envie 0.4 → Engine volta ao heurístico)",
  "alternativeStrategyType": "tipo branco secundário p/ fallback OU null se não houver",
  "suggestedRisks": [
    { "id": "R1", "severity": "low|medium|high", "description": "string ≤100 caracteres", "mitigation": "string ≤100 caracteres" }
  ],
  "invalidHypothesesIds": ["H_STALL_DETECTADO", "..."] OU []
}
4. NÃO repita nenhum tipo em estrategiasIneficazesAnteriores. Se tudo foi tentado, escolha MINI_STEP_BACKTRACK.
5. Se noProgressStreak ≥ 2: priorize MINI_STEP_BACKTRACK ou CORRECT_FIRST_FAIL_FAST. NÃO escolha HEURISTIC_DEFAULT.
6. Se houver erros ≥ 2 repetidos: priorize CORRECT_FIRST_FAIL_FAST ou TEST_DRIVEN_FIX.
7. Se alternativasHeuristicas contiverem scores: use o score do topo mas pode rejeitar se a análise mostrar que vai falhar.
8. NUNCA retorne ações de execução (EXECUTE_TASK etc). Seu trabalho é só recomendar estratégia e riscos.
9. Se a pergunta parecer sem informação suficiente → confidence 0.30 e recommendedStrategyType = "HEURISTIC_DEFAULT".`;

function _parseAndSanitizeLlmJson(raw) {
  try {
    const text = String(raw || '').trim();
    if (!text) return null;
    // Tenta 1: JSON puro
    let obj = _tryParseJson(text);
    if (!obj) {
      // Tenta 2: extrai primeiro { ... }
      const i = text.indexOf('{'); const j = text.lastIndexOf('}');
      if (i >= 0 && j > i) obj = _tryParseJson(text.slice(i, j + 1));
    }
    if (!obj) return null;

    const strategyType = String(obj.recommendedStrategyType || obj.selectedStrategy || obj.strategyType || '').trim();
    if (!STRATEGY_TYPES_ALLOWED.has(strategyType)) return null;
    const conf = Math.max(0, Math.min(1, parseFloat(obj.confidence) || 0));
    if (conf < 0.25) return null;

    const fallbackType = String(obj.alternativeStrategyType || obj.fallbackStrategy || '').trim() || null;
    const safeFallback = fallbackType && STRATEGY_TYPES_ALLOWED.has(fallbackType) ? fallbackType : null;

    const risks = Array.isArray(obj.suggestedRisks) ? obj.suggestedRisks : [];
    const safeRisks = risks.slice(0, 5).map((r, idx) => ({
      id: String(r && r.id || `R${idx+1}`).slice(0, 8),
      severity: RISK_LEVELS_ALLOWED.has(String(r && r.severity || '').toLowerCase()) ? String(r.severity).toLowerCase() : 'low',
      description: _truncate(String(r && r.description || ''), 100),
      mitigation: _truncate(String(r && r.mitigation || r && r.strategy || ''), 100)
    })).filter(r => r.description.length > 0);

    const invalid = Array.isArray(obj.invalidHypothesesIds)
      ? obj.invalidHypothesesIds.map(x => String(x || '').trim().toUpperCase()).filter(Boolean).slice(0, 10) : [];

    return {
      analysis: _truncate(String(obj.analysis || ''), 250),
      recommendedStrategyType: strategyType,
      recommendedReason: _truncate(String(obj.recommendedReason || obj.selectionReason || ''), 350),
      confidence: Number(conf.toFixed(3)),
      fallbackStrategyType: safeFallback,
      safeRisks,
      invalidHypothesesIds: invalid
    };
  } catch {
    return null;
  }
}

function _toEnginePatch(parsed, scoredAlternatives) {
  // Converte resposta LLM sanitizada no formato de enriquecimento que o Engine espera:
  const top = (scoredAlternatives && scoredAlternatives.find(a =>
    String(a.strategyType || (a.alt && a.alt.strategyType) || '').toUpperCase() === parsed.recommendedStrategyType.toUpperCase()
  )) || null;
  return {
    selectedStrategy: top ? (top.alt || top) : {
      strategyType: parsed.recommendedStrategyType,
      description: parsed.recommendedReason,
      estimatedCost: 1,
      expectedROI: 0.6,
      riskLevel: (parsed.safeRisks[0] && parsed.safeRisks[0].severity) || 'low'
    },
    selectionReason: parsed.recommendedReason || 'Recomendado por análise LLM adaptativa',
    analysis: parsed.analysis || undefined,
    risks: parsed.safeRisks && parsed.safeRisks.length ? parsed.safeRisks : undefined,
    hypothesesInvalidateIds: parsed.invalidHypothesesIds && parsed.invalidHypothesesIds.length ? parsed.invalidHypothesesIds : undefined,
    fallbackStrategy: parsed.fallbackStrategyType ? { strategyType: parsed.fallbackStrategyType } : undefined,
    confidenceBoost: Number(((parsed.confidence - 0.5) * 0.15).toFixed(3)),
    llmEnhanced: true
  };
}

function _tryParseJson(s) { try { return JSON.parse(s); } catch { return null; } }
function _truncate(s, n) {
  const v = String(s || '');
  return v.length <= n ? v : (v.slice(0, n - 1) + '…');
}

export default { rc28MakeLlmAnalyzeFn, RC28_LLM_BRIDGE_VERSION, STRATEGY_TYPES_ALLOWED, ACTIONS_ALLOWED };

// ============================================================================
//  RC27 · tiagent_orc_state_schema.js
//  Validação do Estado Central Persistente por projeto (§4 do script).
//  Schema rígido com 23 campos mínimos. NENHUMA dependência externa.
//  Exporta validateCentralState(obj) => { ok, errors[], warnings[] }
// ============================================================================

const SCHEMA_VERSION = 'rc28.1';

const FASES_PERMITIDAS = [
  'ANALYSIS', 'PLANNING', 'ARCHITECTURE',
  'IMPLEMENTATION', 'TESTS', 'CORRECTIONS',
  'VALIDATION', 'COMPLETED', 'BLOCKED'
];

const TASK_STATUS = ['pending', 'in_progress', 'completed', 'cancelled', 'blocked'];
const TASK_AGENTS  = ['ARCHITECT', 'DEVELOPER', 'QA', 'SECURITY', 'INTERNET', 'TEST', 'ORCHESTRATOR'];
const STATUS_EXEC  = ['idle', 'running', 'blocked', 'completed'];

function isStr(v, minLen = 0) {
  return typeof v === 'string' && v.length >= minLen;
}
function isArr(v) { return Array.isArray(v); }
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function isBool(v) { return typeof v === 'boolean'; }
function isIntNonNeg(v) { return Number.isInteger(v) && v >= 0; }

function isValidTask(t, idx, errors) {
  const prefix = `tarefas[${idx}]`;
  if (!isObj(t)) { errors.push(`${prefix}: não é objeto`); return false; }
  if (!isStr(t.id, 1)) errors.push(`${prefix}.id: string não-vazia obrigatória`);
  if (!isStr(t.title, 1)) errors.push(`${prefix}.title: string não-vazia obrigatória`);
  if (!isStr(t.description || '', 0)) errors.push(`${prefix}.description: string`);
  if (!isArr(t.dependsOn)) errors.push(`${prefix}.dependsOn: array obrigatório`);
  else { for (const d of t.dependsOn) if (!isStr(d, 1)) errors.push(`${prefix}.dependsOn[]: string não-vazia`); }
  if (!TASK_AGENTS.includes(t.agent)) errors.push(`${prefix}.agent: deve ser um de ${TASK_AGENTS.join('/')} (recebi=${String(t.agent)})`);
  if (!TASK_STATUS.includes(t.status)) errors.push(`${prefix}.status: deve ser um de ${TASK_STATUS.join('/')}`);
  return errors.length === 0;
}

export function emptyCentralStateTemplate({ projectSlug = 'default', objetivo = '' } = {}) {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `orc_${projectSlug}_${now}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    objetivoAtual: objetivo || '',
    requisitos: { rf: [], rnfr: [], businessRules: [] },
    arquitetura: { camadas: [], estruturaPastas: [], padroes: [] },
    tecnologias: { lang: null, framework: null, banco: null, libs: [] },
    versoesRelevantes: {},
    agentesDisponiveis: {
      ARCHITECT: { ok: true }, DEVELOPER: { ok: true }, QA: { ok: true },
      SECURITY: { ok: true }, TEST: { ok: true }, INTERNET: { ok: false }
    },
    ferramentasDisponiveis: [
      'read_file','write_file','delete_file','run_command','list_dir',
      'state_get','state_patch','task_list','task_update',
      'web_request_ask_authorization','web_search_authorized','web_fetch_authorized',
      'run_tests','rollback_to_checkpoint','security_audit_and_autofix'
    ],
    tarefas: [],
    tarefasConcluidas: 0,
    tarefasPendentes: 0,
    tarefaEmExecucaoId: null,
    dependencias: [],
    arquivosRelevantes: {},
    arquivosModificados: [],
    decisoesTecnicas: [],
    pesquisasRealizadasFontes: [],
    errosEncontrados: [],
    tentativasRealizadas: [],
    correcoesRealizadas: [],
    testesExecutadosResultados: [],
    problemasConhecidos: [],
    limitacoes: [],
    proximaAcao: 'ANALISAR_PROJETO',
    faseGeral: 'ANALYSIS',
    needsPersistence: false,
    internetAuthorization: null,
    checkpoints: [],
    toolCallsSinceLastSave: 0,
    statusExecucao: 'idle',
    decisionTrace: [],
    decisionEngine: {
      engineVersion: 'rc28.decision.v1',
      mode: 'heuristic',
      hypotheses: [],
      strategiesTried: [],
      ineffectiveStrategies: [],
      alternativesHistory: [],
      progressMetrics: {
        totalCycles: 0,
        cyclesWithProgress: 0,
        lastProgressAtMs: 0,
        noProgressStreak: 0,
        objectiveProgressPct: 0
      },
      lastDecision: null,
      lastMeasuredResult: null,
      adaptiveConstraints: {
        maxCycles: null,
        maxStrategies: null,
        confidenceThreshold: 0.7
      }
    }
  };
}

export function validateCentralState(obj) {
  const errors = [];
  const warnings = [];

  if (!isObj(obj)) {
    errors.push('Estado Central: raiz não é um objeto JSON.');
    return { ok: false, errors, warnings };
  }

  // === 23 campos obrigatórios §4 do script (mantidos em inglês técnico por convenção) ===
  const required = [
    ['schemaVersion', 'string'], ['id', 'string'],
    ['createdAt', 'number'], ['updatedAt', 'number'],
    ['objetivoAtual', 'string'],
    ['requisitos', 'object'], ['arquitetura', 'object'],
    ['tecnologias', 'object'], ['versoesRelevantes', 'object'],
    ['agentesDisponiveis', 'object'], ['ferramentasDisponiveis', 'array'],
    ['tarefas', 'array'],
    ['tarefasConcluidas', 'number'], ['tarefasPendentes', 'number'],
    ['tarefaEmExecucaoId', 'any'],
    ['dependencias', 'array'], ['arquivosRelevantes', 'object'], ['arquivosModificados', 'array'],
    ['decisoesTecnicas', 'array'],
    ['pesquisasRealizadasFontes', 'array'], ['errosEncontrados', 'array'],
    ['tentativasRealizadas', 'array'], ['correcoesRealizadas', 'array'],
    ['testesExecutadosResultados', 'array'],
    ['problemasConhecidos', 'array'], ['limitacoes', 'array'],
    ['proximaAcao', 'any'], ['faseGeral', 'string'],
    ['needsPersistence', 'boolean'],
    ['internetAuthorization', 'any'], ['checkpoints', 'array'],
    ['toolCallsSinceLastSave', 'number'], ['statusExecucao', 'string'],
    ['decisionTrace', 'array']
  ];

  for (const [k, type] of required) {
    if (!(k in obj)) {
      errors.push(`campo obrigatório ausente: ${k}`);
      continue;
    }
    const v = obj[k];
    switch (type) {
      case 'string':  if (!isStr(v)) errors.push(`${k}: deve ser string`); break;
      case 'number':  if (!Number.isFinite(v)) errors.push(`${k}: deve ser número`); break;
      case 'boolean': if (!isBool(v)) errors.push(`${k}: deve ser boolean`); break;
      case 'array':   if (!isArr(v)) errors.push(`${k}: deve ser array`); break;
      case 'object':  if (!isObj(v)) errors.push(`${k}: deve ser objeto`); break;
      case 'any': default: break;
    }
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  // Valores semânticos
  if (obj.schemaVersion !== SCHEMA_VERSION) {
    warnings.push(`schemaVersion esperado=${SCHEMA_VERSION}, recebido=${String(obj.schemaVersion)} (migração pode ser necessária)`);
  }
  if (!FASES_PERMITIDAS.includes(obj.faseGeral)) {
    errors.push(`faseGeral inválida: "${String(obj.faseGeral)}". Esperado um de: ${FASES_PERMITIDAS.join(', ')}`);
  }
  if (!STATUS_EXEC.includes(obj.statusExecucao)) {
    errors.push(`statusExecucao inválido: "${String(obj.statusExecucao)}". Esperado um de: ${STATUS_EXEC.join(', ')}`);
  }
  if (!isIntNonNeg(obj.tarefasConcluidas)) errors.push('tarefasConcluidas deve ser inteiro >= 0');
  if (!isIntNonNeg(obj.tarefasPendentes)) errors.push('tarefasPendentes deve ser inteiro >= 0');
  if (!isIntNonNeg(obj.toolCallsSinceLastSave)) errors.push('toolCallsSinceLastSave deve ser inteiro >= 0');

  // Campos RC28 Decision Engine — opcionais para retrocompat com estados rc27 antigos
  if ('decisionEngine' in obj) {
    const de = obj.decisionEngine;
    if (!isObj(de)) warnings.push('decisionEngine: deve ser objeto, ignorando seções novas.');
    else {
      const _warn = (m) => warnings.push(`decisionEngine.${m}`);
      if (!Array.isArray(de.hypotheses)) _warn('hypotheses: esperado array');
      if (!Array.isArray(de.strategiesTried)) _warn('strategiesTried: esperado array');
      if (!Array.isArray(de.ineffectiveStrategies)) _warn('ineffectiveStrategies: esperado array');
      if (!Array.isArray(de.alternativesHistory)) _warn('alternativesHistory: esperado array');
      if (!isObj(de.progressMetrics)) _warn('progressMetrics: esperado objeto');
      if (!isObj(de.adaptiveConstraints)) _warn('adaptiveConstraints: esperado objeto');
    }
  }

  for (let i = 0; i < obj.tarefas.length; i++) isValidTask(obj.tarefas[i], i, errors);

  // Contadores bateram? (warning apenas, não é erro fatal)
  const completasReais = obj.tarefas.filter(t => t && t.status === 'completed').length;
  const pendentesReais = obj.tarefas.filter(t => t && (t.status === 'pending' || t.status === 'in_progress' || t.status === 'blocked')).length;
  if (completasReais !== obj.tarefasConcluidas) warnings.push(`tarefasConcluidas=${obj.tarefasConcluidas} vs tarefas[] real=${completasReais} (dessincronia)`);
  if (pendentesReais !== obj.tarefasPendentes) warnings.push(`tarefasPendentes=${obj.tarefasPendentes} vs tarefas[] real=${pendentesReais} (dessincronia)`);

  return { ok: errors.length === 0, errors, warnings };
}

export const RC27_FASES = Object.freeze(FASES_PERMITIDAS);
export const RC27_SCHEMA_VERSION = SCHEMA_VERSION;

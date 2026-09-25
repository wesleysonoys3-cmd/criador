/* eslint-disable */
'use strict';

/* =======================================================================
 *  RC24 · Agent Orchestrator — motor Puro (sem dependências de Express/WS)
 *  Uso: const Orch = require('./agent_orchestrator.js');
 *  Regras: funções puras recebem IO (env, fs, llm) por parâmetro.
 * ======================================================================= */

import path from 'node:path';
import crypto from 'node:crypto';

const SCHEMA_VERSION = 'rc24.1';

const DELIVERABLE_KINDS = ['node_express_app','static_site_with_backend_proxy','cli_agent'];
const CAPABILITY_TYPES = ['whatsapp_evolux','google_calendar','smtp_email','generic_rest_crm','custom_webhook'];
const STATES = ['rascunho','construindo','testando','pronto','bloqueado'];

/* -----------------------------------------------------------------------
 *  1. Capability Catalog (real, não inventado)
 * ---------------------------------------------------------------------*/
const AGENT_CAPABILITY_CATALOG = {
  whatsapp_evolux: {
    id: 'whatsapp_evolux',
    type: 'whatsapp_evolux',
    provider: 'Evolux',
    envVarsRequired: ['WHATSAPP_EVOLUX_API_KEY','WHATSAPP_EVOLUX_INSTANCE_ID'],
    docsUrl: 'https://ajuda.evolux.com.br/pt-BR/articles/6530902-api-de-mensagens-whatsapp-business',
    statusResolver: (env) => !!env.WHATSAPP_EVOLUX_API_KEY && !!env.WHATSAPP_EVOLUX_INSTANCE_ID,
    description: 'Receber/responder mensagens WhatsApp via Evolux API.',
  },
  google_calendar: {
    id: 'google_calendar',
    type: 'google_calendar',
    provider: 'Google Workspace (Service Account)',
    envVarsRequired: ['GOOGLE_CALENDAR_CLIENT_EMAIL','GOOGLE_CALENDAR_PRIVATE_KEY_BASE64'],
    docsUrl: 'https://developers.google.com/calendar/api/guides/overview',
    statusResolver: (env) => !!env.GOOGLE_CALENDAR_CLIENT_EMAIL && !!env.GOOGLE_CALENDAR_PRIVATE_KEY_BASE64,
    description: 'Buscar/criar horários na agenda de consultas.',
  },
  smtp_email: {
    id: 'smtp_email',
    type: 'smtp_email',
    provider: 'SMTP genérico (Gmail/Outlook/SendGrid/SES)',
    envVarsRequired: ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS'],
    docsUrl: 'https://nodemailer.com/smtp/',
    statusResolver: (env) => !!env.SMTP_HOST && !!env.SMTP_PORT && !!env.SMTP_USER && !!env.SMTP_PASS,
    description: 'Envio de e-mail de confirmação de consulta.',
  },
  generic_rest_crm: {
    id: 'generic_rest_crm',
    type: 'generic_rest_crm',
    provider: 'CRM REST genérico (Bearer/Header API Key)',
    envVarsRequired: ['CRM_BASE_URL','CRM_API_KEY'],
    docsUrl: 'https://en.wikipedia.org/wiki/Representational_state_transfer',
    statusResolver: (env) => !!env.CRM_BASE_URL && !!env.CRM_API_KEY,
    description: 'Cadastrar pacientes/negócios no CRM interno por REST.',
  },
  custom_webhook: {
    id: 'custom_webhook',
    type: 'custom_webhook',
    provider: 'Webhook custom (HTTP POST)',
    envVarsRequired: ['WEBHOOK_URL'],
    optional: true,
    docsUrl: 'https://en.wikipedia.org/wiki/Webhook',
    statusResolver: (env) => !!env.WEBHOOK_URL,
    description: 'Disparar eventos (nova consulta/lead) para webhook externo.',
  },
};

/* -----------------------------------------------------------------------
 *  2. Lifecycle / Transições de Estado (hard rules)
 * ---------------------------------------------------------------------*/
const TRANSITIONS_ALLOWED = {
  rascunho:   ['construindo','bloqueado'],
  construindo:['testando','rascunho','bloqueado'],
  testando:   ['pronto','construindo','rascunho','bloqueado'],
  pronto:     ['construindo','bloqueado'],
  bloqueado:  ['rascunho','construindo','testando','pronto'],
};

function isTransitionAllowed(from, to, { buildRun=false, qaScore=0, securityCritics=0, forceUnlock=false }={}) {
  const allowed = TRANSITIONS_ALLOWED[from] || [];
  if (forceUnlock) {
    return { ok: STATES.includes(to), reason: 'force unlock (--force --i-know-risk)' };
  }
  if (!allowed.includes(to)) {
    return { ok: false, reason: `Transição não permitida: ${from} → ${to}. Caminhos permitidos: ${allowed.join(', ')}` };
  }
  if (to === 'construindo' && from === 'rascunho' && !buildRun) {
    /* A própria ação de build já seta buildRun=true; aqui é só a transição em si. */
  }
  if (to === 'testando') {
    if (!buildRun) return { ok:false, reason: 'Transição construindo → testando requer build RC22 executado. Rode /build primeiro.' };
    if (qaScore != null && typeof qaScore === 'number' && qaScore < 60) {
      return { ok: false, reason: `QA score ${qaScore} < 60. Requer (1) ignorar e prosseguir via --ignore-qa-score, ou (2) re-build com foco nos issues do QA.` };
    }
  }
  if (to === 'pronto') {
    if (securityCritics > 0) {
      return { ok: false, reason: `Transição testando → pronto bloqueada: ${securityCritics} findings de severidade crítico sem aprovação manual. Marque "Aceito risco" individualmente no Security, ou desbloqueie com /estado pronto --force --i-know-risk.` };
    }
  }
  return { ok: true };
}

/* -----------------------------------------------------------------------
 *  3. Validação agent.json (schema estrito)
 * ---------------------------------------------------------------------*/
function _isNonEmptyString(s) { return typeof s === 'string' && s.trim().length > 0; }
function _isArrayOfStrings(a) { return Array.isArray(a) && a.every(_isNonEmptyString); }

function validateAgentSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') errors.push('spec deve ser objeto');
  if (spec.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion deve ser "${SCHEMA_VERSION}"`);
  for (const f of ['id','name','slug','version']) {
    if (!_isNonEmptyString(spec && spec[f])) errors.push(`campo obrigatório ausente: ${f}`);
  }
  if (spec && spec.version && !/^\d+\.\d+\.\d+$/.test(spec.version)) errors.push('version deve ser semver (ex.: 1.0.0)');
  if (!spec || !spec.company || typeof spec.company !== 'object') errors.push('company é obrigatório');
  else if (!_isNonEmptyString(spec.company.name) || !_isNonEmptyString(spec.company.slug)) errors.push('company.name e company.slug são obrigatórios');
  if (!_isNonEmptyString(spec && spec.problemStatement)) errors.push('problemStatement é obrigatório');
  if (!spec || !spec.requirements || typeof spec.requirements !== 'object') errors.push('requirements é obrigatório {functional,nonFunctional,businessRules}');
  else {
    if (!_isArrayOfStrings(spec.requirements.functional)) errors.push('requirements.functional deve ser string[]');
    if (!_isArrayOfStrings(spec.requirements.nonFunctional)) errors.push('requirements.nonFunctional deve ser string[]');
    if (!_isArrayOfStrings(spec.requirements.businessRules)) errors.push('requirements.businessRules deve ser string[]');
  }
  if (!Array.isArray(spec && spec.capabilities)) errors.push('capabilities deve ser array');
  else {
    for (const c of spec.capabilities) {
      if (!c || typeof c !== 'object') { errors.push('capability item não é objeto'); continue; }
      if (!CAPABILITY_TYPES.includes(c.type)) errors.push(`capability.type inválido: ${c.type}`);
      if (!_isNonEmptyString(c.id)) errors.push('capability.id ausente');
    }
  }
  if (!_isArrayOfStrings(spec && spec.tools_declared)) errors.push('tools_declared deve ser string[]');
  if (!_isArrayOfStrings(spec && spec.securityRules)) errors.push('securityRules deve ser string[]');
  if (!spec || !spec.deliverable || typeof spec.deliverable !== 'object' || !DELIVERABLE_KINDS.includes(spec.deliverable.kind)) {
    errors.push(`deliverable.kind deve ser um de: ${DELIVERABLE_KINDS.join(', ')}`);
  }
  for (const f of ['createdAt','updatedAt']) {
    if (spec && typeof spec[f] !== 'number') errors.push(`${f} ausente ou não numérico (timestamp ms)`);
  }
  return { ok: errors.length === 0, errors };
}

/* -----------------------------------------------------------------------
 *  4. Semver / versionamento
 * ---------------------------------------------------------------------*/
function bumpVersion(current, level='patch') {
  if (!/^\d+\.\d+\.\d+$/.test(current || '')) throw new Error('versão atual não é semver válida');
  const [ma,mi,pa] = current.split('.').map(Number);
  if (level === 'major') return `${ma+1}.0.0`;
  if (level === 'minor') return `${ma}.${mi+1}.0`;
  return `${ma}.${mi}.${pa+1}`;
}

/* -----------------------------------------------------------------------
 *  5. Diff de specs (deep simple)
 * ---------------------------------------------------------------------*/
function _flatten(obj, prefix='') {
  const out = {};
  if (obj === null || obj === undefined) { out[prefix || '.'] = String(obj); return out; }
  if (typeof obj !== 'object') { out[prefix || '.'] = obj; return out; }
  if (Array.isArray(obj)) {
    out[prefix || '.'] = JSON.stringify(obj);
    return out;
  }
  for (const k of Object.keys(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    Object.assign(out, _flatten(obj[k], p));
  }
  return out;
}

function diffAgentVersions(a, b) {
  const fa = _flatten(a || {}); const fb = _flatten(b || {});
  const added = []; const removed = []; const changed = [];
  for (const k of Object.keys(fa)) if (!(k in fb)) removed.push(k);
  for (const k of Object.keys(fb)) if (!(k in fa)) added.push(k);
  for (const k of Object.keys(fa)) if (k in fb && fa[k] !== fb[k]) changed.push(k);
  return { added, removed, changed, patches: changed.map(k => ({ path: k, from: fa[k], to: fb[k] })) };
}

/* -----------------------------------------------------------------------
 *  6. Forced Architect Plan a partir do agent.json (compatível RC22)
 * ---------------------------------------------------------------------*/
function buildForcedArchitectPlanFromSpec(spec) {
  const name = `${(spec && spec.company && spec.company.slug) || 'empresa'}-${(spec && spec.slug) || 'agente'}`;
  const palette = (spec && spec.palette) || {
    primary: '#0ea5e9', secondary: '#0f172a', accent: '#10b981', text: '#0f172a', background: '#ffffff',
  };
  palette.typography = palette.typography || { sans:'Inter', heading:'Inter', mono:'JetBrains Mono' };
  const baseFiles = [
    { path: 'server.js', purpose: 'Entrypoint Express: health + chat + integrations.', type: 'node' },
    { path: 'package.json', purpose: 'Dependências mínimas do agente final.', type: 'json' },
    { path: '.env.example', purpose: 'Placeholders das capabilities (SEM valores reais).', type: 'env' },
    { path: 'README.md', purpose: 'Como rodar, configurar capabilities, deploy no Render.', type: 'markdown' },
  ];
  const sections = [
    { title: 'Agent Health Check', order: 1, description: 'Endpoint GET /health.' },
    { title: 'Agent Chat API', order: 2, description: 'POST /api/v1/chat com histórico e tools.' },
    { title: 'Capability Handlers', order: 3, description: 'Endpoints para webhooks (WhatsApp etc.).' },
    { title: 'Config & Deploy', order: 4, description: '.env.example + README deploy Render.' },
  ];
  const toolsDeclared = (spec && spec.tools_declared && Array.isArray(spec.tools_declared)) ? spec.tools_declared : [];
  const interactions = toolsDeclared.map((t,i) => ({ id: t, type: 'tool_function', step: i+1, description: `Declarar função ${t} no agente.` }));
  const seo_accessibility = [
    'Nenhum SEO aplicável (API), mas README descreve endpoints e erros.',
  ];
  const functional = (spec && spec.requirements && Array.isArray(spec.requirements.functional)) ? spec.requirements.functional : [];
  const acceptanceCriteria = functional.slice(0, 20).map(x => ({ criterio: x, validado: false }));
  return {
    name,
    summary: `${spec && spec.problemStatement || 'Agente para '+name} | Capabilities: ${(spec && spec.capabilities && Array.isArray(spec.capabilities) ? spec.capabilities.map(c=>c.type).join(', ') : '')}`,
    palette,
    typography: palette.typography,
    sections,
    files: baseFiles,
    interactions,
    seo_accessibility,
    acceptanceCriteria,
    _sourceOrchestrator: true,
    _agentVersion: (spec && spec.version) || '0.1.0',
  };
}

/* -----------------------------------------------------------------------
 *  7. Whitelist Security apply (hard constraint SEC-HC-* only)
 * ---------------------------------------------------------------------*/
function securityApplyWhitelistOnly(finding) {
  if (Array.isArray(finding)) {
    // Recebe array de findings → devolve { ok, toApply: [SEC-HC-*], toManual: [outros] }
    const toApply = [];
    const toManual = [];
    for (const f of finding) {
      const id = f && (f.id || f.ruleId || f.findingId || '');
      if (/^SEC-HC-/i.test(id)) toApply.push(f);
      else toManual.push(f);
    }
    return { ok: true, toApply, toManual, whitelistRule: 'SOMENTE findings SEC-HC-* podem receber auto-fix. Outros (XSS/Path/CORS/etc) exigem aprovação manual individual + backup confirmado no Security :3400.' };
  }
  // Recebe 1 finding individual → {ok: true} se SEC-HC-*; senão ok:false + reason
  const id = finding && (finding.id || finding.ruleId || finding.findingId || '');
  if (/^SEC-HC-/i.test(id)) return { ok: true };
  return { ok: false, reason: 'blocked_hard_constraint: finding não é SEC-HC-* (XSS/Path/CORS/etc requerem aprovação manual individual no Security :3400 + backup confirmado). id=' + id };
}

/* -----------------------------------------------------------------------
 *  8. Decisão do Orchestrador (state machine de alto nível)
 * ---------------------------------------------------------------------*/
function decideNextAction(spec, state, ctx) {
  const currentState = state && state.currentState || 'rascunho';
  const hasSpec = !!(spec && validateAgentSpec(spec).ok);

  if (!hasSpec) {
    const missing = [];
    if (!ctx || !ctx.empresa || !ctx.empresa.name) missing.push('nome e segmento da empresa');
    if (!ctx || !ctx.problema) missing.push('problem statement / dor principal');
    if (!ctx || !ctx.requisitos || ctx.requisitos.length < 2) missing.push('>= 2 requisitos funcionais');
    if (missing.length) {
      return {
        decision: 'clarify',
        reason: `Campos estruturais faltantes para gerar agent.json: ${missing.join(', ')}.`,
        payload: { questions: missing.map(m => `Por favor, me informe ${m}.`) },
      };
    }
    return { decision: 'specify', reason: 'Contexto suficiente para gerar o agent.json v0.1.0.', payload: {} };
  }

  if (currentState === 'rascunho') {
    if (!state || !state.lastRc22Run) {
      return { decision: 'build_via_rc22', reason: 'agent.json OK, mas sem build RC22. Próximo passo: /build para gerar o código do agente final.', payload: {} };
    }
  }
  if (currentState === 'construindo') {
    if (!state || !state.lastQaRun) {
      return { decision: 'audit_via_security', reason: 'Build RC22 concluído. Rodar auditoria Security no código gerado + QA score.', payload: {} };
    }
    const qa = state.lastQaRun;
    if (qa && typeof qa.overallScore === 'number' && qa.overallScore < 60) {
      return { decision: 'clarify', reason: 'QA score < 60. Escolha: (1) Ignorar e ir p/ testando /estado testando --ignore-qa-score, (2) Refazer build com foco nos issues: ' + JSON.stringify((qa.issues||[]).slice(0,3).map(i=>i.category+'::'+i.title)).slice(0,180), payload: {} };
    }
    return { decision: 'goto_testando', reason: 'QA OK. Transição construindo → testando.', payload: {} };
  }
  if (currentState === 'testando') {
    const sec = state.lastSecurityRun || {};
    const critics = (sec.counts && sec.counts.critico) || 0;
    if (critics > 0) {
      return { decision: 'clarify', reason: `Security tem ${critics} findings críticos. Aprovação manual por finding necessária.`, payload: {} };
    }
    return { decision: 'deliver_final_agent', reason: 'Tudo OK. Pronto para entregar ao cliente.', payload: {} };
  }
  return { decision: 'idle', reason: 'Estado atual estável.', payload: {} };
}

/* -----------------------------------------------------------------------
 *  9. Extração de Contexto Estruturado via LLM text-only
 *  Recebe: llmTextOnly(fn) (provider, model, prompt) => { text, provider, model }
 *          lastMessages[] = [{role, text, ts}]
 *          currentSpec (opcional)
 * ---------------------------------------------------------------------*/
async function extractStructuredContext(llmTextOnlyFn, lastMessages, currentSpec, { preferredProvider='cerebras' }={}) {
  const prompt = `Você é o Agent Orchestrator do TiAgente (RC24). Extraia do histórico abaixo, com máxima fidelidade, um JSON com os campos:
{
  "empresa": { "name": "...", "slug": "slug-simplificado-minusculo-sem-acentos", "segmento": "...", "size": "pequena|media|grande|empresa", "notes": "..." },
  "problema": "1 parágrafo, dor principal a resolver",
  "requisitos_funcionais": ["..."],
  "requisitos_nao_funcionais": ["..."],
  "integracoes_desejadas": ["..."],
  "regras_negocio": ["..."],
  "tools_desejadas": ["..."],
  "missingInfoQuestions": ["perguntas adicionais para esclarecer ou [] se já tem info suficiente"]
}

Regras de extração:
- integracoes_desejadas NÃO PODEM inventar providers. Restrinja a este conjunto: whatsapp_evolux, google_calendar, smtp_email, generic_rest_crm, custom_webhook. Mencionar "WhatsApp" → whatsapp_evolux. "Calendário/agenda" → google_calendar. "E-mail/SMTP" → smtp_email. "CRM interno" → generic_rest_crm. "Webhook/integração genérica" → custom_webhook.
- tools_desejadas são funções do agente final (ex.: agenda_buscar_horarios, whatsapp_enviar_mensagem, crm_criar_paciente, email_confirmar_consulta). NÃO são tools do RC22 Dev (read_file/write_file).
- slug empresa só letras minúsculas, hífen, sem acentos. (Ex.: "Clínica Vida & Saúde" → "clinica-vida-saude".)
- SEMPRE retorne APENAS JSON válido no corpo da resposta. Sem markdown, sem \`\`\`json. Se faltar info, preencha com o que tiver e informe em missingInfoQuestions.

HISTÓRICO DE CONVERSA:
${(lastMessages||[]).slice(-20).map(m=>`[${m.role||'user'}] ${m.text||''}`).join('\n')}

Spec ATUAL (se existir, merge de campos):
${currentSpec ? JSON.stringify(currentSpec, null, 2).slice(0,6000) : 'NENHUM (vamos criar do zero)'}

RESPONDA SOMENTE JSON.
`;
  const res = await llmTextOnlyFn({
    provider: preferredProvider,
    fallbackProvider: 'gemini',
    model: null, // deixa a função resolveProvider escolher modelo default
    prompt,
    temperature: 0.1,
    maxTokens: 2500,
  });
  let parsed = null;
  try {
    const text = (res && res.text || '').trim();
    const first = text.indexOf('{'); const last = text.lastIndexOf('}');
    const jsonish = (first >= 0 && last > first) ? text.slice(first, last+1) : text;
    parsed = JSON.parse(jsonish);
  } catch (e) {
    parsed = {
      empresa: { name: '', slug: '', segmento: '', size: 'media', notes: '' },
      problema: '', requisitos_funcionais: [], requisitos_nao_funcionais: [],
      integracoes_desejadas: [], regras_negocio: [], tools_desejadas: [],
      missingInfoQuestions: ['⚠️ Não consegui extrair JSON limpo da resposta LLM. Por favor, descreva novamente com mais detalhes. Erro: '+e.message],
    };
  }
  return { structured: parsed, llm: { provider: res && res.provider, model: res && res.model } };
}

/* -----------------------------------------------------------------------
 * 10. Spec vazio inicial a partir de structured extraction
 * ---------------------------------------------------------------------*/
function buildInitialSpecFromStructured(structured, extra) {
  const now = Date.now();
  const empresaName = structured.empresa && structured.empresa.name ? structured.empresa.name.trim() : (extra && extra.empresaName) || 'empresa';
  const empresaSlug = structured.empresa && structured.empresa.slug ? structured.empresa.slug : slugify(empresaName);
  const agentName = (extra && extra.agentName) || 'recepcao';
  const agentSlug = slugify(agentName);
  const deliverable = (extra && extra.deliverable) || 'node_express_app';
  const integ = structured.integracoes_desejadas || [];
  const capabilities = integ
    .filter(t => CAPABILITY_TYPES.includes(t))
    .map((t, i) => ({ id: `${t}-${i+1}`, type: t, provider: AGENT_CAPABILITY_CATALOG[t].provider, status:'pending', envVarsRequired: AGENT_CAPABILITY_CATALOG[t].envVarsRequired, description: AGENT_CAPABILITY_CATALOG[t].description }));
  const spec = {
    schemaVersion: SCHEMA_VERSION,
    id: 'agent_' + crypto.randomBytes(6).toString('hex'),
    name: agentName,
    slug: agentSlug,
    version: '0.1.0',
    company: {
      name: empresaName,
      slug: empresaSlug,
      segmento: (structured.empresa && structured.empresa.segmento) || '',
      size: (structured.empresa && structured.empresa.size) || 'media',
      notes: (structured.empresa && structured.empresa.notes) || '',
    },
    persona: extra && extra.persona || '',
    problemStatement: structured.problema || 'Problema não identificado ainda — complete com /agente.',
    assumptions: [],
    requirements: {
      functional: structured.requisitos_funcionais || [],
      nonFunctional: structured.requisitos_nao_funcionais || [],
      businessRules: structured.regras_negocio || [],
    },
    capabilities,
    tools_declared: structured.tools_desejadas || [],
    securityRules: [
      'Nunca expor chaves de API (API_KEY, _PASS, TOKEN) no frontend, localStorage ou logs.',
      'Nunca servir dotfiles ou .env via static; Paths de arquivos devem validar base dir (path traversal).',
    ],
    deliverable: { kind: DELIVERABLE_KINDS.includes(deliverable) ? deliverable : 'node_express_app' },
    createdAt: now, updatedAt: now,
    author: 'orchestrator_rc24',
  };
  return spec;
}

/* -----------------------------------------------------------------------
 * 11. Helpers utilitários
 * ---------------------------------------------------------------------*/
function slugify(s) {
  return (s||'').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60) || 'slug';
}

function getAgentProjectSlug(specOrCompanySlug, agentSlug) {
  const cs = (typeof specOrCompanySlug === 'string')
    ? specOrCompanySlug
    : (specOrCompanySlug && specOrCompanySlug.company && specOrCompanySlug.company.slug) || 'empresa';
  return `agent__${cs}__${agentSlug}`;
}

function statusAllCapabilities(spec, env) {
  const out = {};
  for (const c of (spec && spec.capabilities) || []) {
    const def = AGENT_CAPABILITY_CATALOG[c.type];
    if (!def) { out[c.id] = { status:'erro', error:`capability type ${c.type} não existe no catálogo.` }; continue; }
    const missing = def.envVarsRequired.filter(v => !env[v]);
    const resolved = def.statusResolver(env);
    out[c.id] = {
      id: c.id, type: c.type, provider: def.provider,
      status: resolved ? 'disponivel' : 'pendente_config',
      missingEnvVars: missing,
      docsUrl: def.docsUrl,
      description: def.description,
    };
  }
  return out;
}

/* ============================================================================
 *  RC27 · 4 FUNÇÕES ADITIVAS NO FINAL (NÃO TOCA NAS 8 RC24 ACIMA)
 *  Funções puras: determinísticas, sem I/O, sem dependências externas novas.
 * ========================================================================== */

function _hashId(prefix, text) {
  let h = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${prefix}_${(h >>> 0).toString(36)}`;
}

export function extractGoalRequirements({ objetivo = '', analysisContext = null, existingStack = null }) {
  const text = String(objetivo || '').trim().toLowerCase();
  const words = text.split(/\s+/);

  const rf = [];
  const rnfr = [];
  const businessRules = [];

  const rfCandidates = [
    { match: ['cadastro', 'registrar', 'criar.*usuário', 'usuário.*novo'], id: 'RF_CADASTRO', title: 'Cadastro de usuários/entidades', description: 'Sistema deve permitir cadastro e listagem da entidade principal.' },
    { match: ['login', 'autenticar', 'senha', 'auth'], id: 'RF_AUTH', title: 'Autenticação e sessão', description: 'Sistema deve autenticar usuários e manter sessão.' },
    { match: ['whatsapp', 'zap', 'wpp', 'zapzap'], id: 'RF_WHATSAPP', title: 'Integração WhatsApp', description: 'Notificações e atendimento via canal WhatsApp.' },
    { match: ['pagamento', 'pix', 'cartão', 'stripe', 'mercado pago', 'pagseguro'], id: 'RF_PAGAMENTO', title: 'Integração de pagamentos', description: 'Receber pagamentos via PIX/cartão com confirmação real.' },
    { match: ['agenda', 'calendário', 'horário', 'marcar', 'agendar', 'consulta'], id: 'RF_AGENDA', title: 'Agenda e marcação de horários', description: 'Marcação, listagem e cancelamento de compromissos.' },
    { match: ['crm', 'cliente', 'histórico', 'ficha'], id: 'RF_CRM', title: 'CRM e ficha do cliente', description: 'Histórico completo de interações por cliente.' },
    { match: ['dashboard', 'relatório', 'métrica', 'gráfico', 'admin'], id: 'RF_DASHBOARD', title: 'Dashboard administrativo', description: 'Painel com métricas e relatórios.' },
    { match: ['upload', 'arquivo', 'imagem', 'anexo', 'foto'], id: 'RF_UPLOAD', title: 'Upload de arquivos/imagens', description: 'Upload seguro e armazenamento de anexos.' },
    { match: ['email', 'smtp', 'notificação', 'e-mail'], id: 'RF_EMAIL', title: 'Notificações por e-mail', description: 'Envio de e-mails transacionais.' },
    { match: ['api', 'endpoint', 'rest', 'integração'], id: 'RF_API', title: 'API REST para integrações externas', description: 'Endpoints HTTP documentados para integração.' }
  ];
  for (const cand of rfCandidates) {
    const hit = cand.match.some(m => new RegExp(m, 'i').test(text));
    if (hit) rf.push({ id: cand.id, title: cand.title, description: cand.description, source: 'heuristica_autonoma' });
  }
  if (rf.length === 0) rf.push({ id: 'RF_PADRAO', title: 'Aplicação funcional conforme objetivo', description: 'Entregar funcionalidade solicitada pelo objetivo de alto nível.', source: 'heuristica_autonoma' });

  const rnfrCandidates = [
    { id: 'RNF_PERF', title: 'Desempenho', description: 'Resposta < 3s nas telas principais.' },
    { id: 'RNF_SEG', title: 'Segurança', description: 'Validação de inputs, sanitização HTML, sem chaves hardcoded no código.' },
    { id: 'RNF_RESP', title: 'Responsividade', description: 'UI deve funcionar em desktop e mobile.' },
    { id: 'RNF_USAB', title: 'Usabilidade', description: 'Interface em português, feedback claro nas ações.' }
  ];
  for (const r of rnfrCandidates) rnfr.push(r);

  const brCandidates = [
    { id: 'BR_UNICO', match: ['email.*único', 'cpf.*único', 'único'], description: 'Campos chave (email/cpf) devem ser únicos.' },
    { id: 'BR_OBRIG', match: ['obrigatório', 'campo.*requerido', 'requerido'], description: 'Campos obrigatórios validados no frontend e backend.' },
    { id: 'BR_HOR', match: ['horário.*comercial', 'funcionamento', 'dias.*úteis'], description: 'Operação restrita aos horários de funcionamento definidos.' }
  ];
  for (const br of brCandidates) {
    if (br.match && br.match.some(m => new RegExp(m, 'i').test(text))) {
      businessRules.push({ id: br.id, description: br.description });
    }
  }
  if (businessRules.length === 0) {
    businessRules.push({ id: 'BR_PADRAO', description: 'Seguir as decisões do Estado Central; se dúvida técnica, preferir solução reversível e documentar.' });
  }

  return {
    rf, rnfr, businessRules,
    rawKeywords: words.filter(w => w.length >= 4).slice(0, 30),
    detection: {
      needsPersistence: /cadastro|usuário|cliente|pedido|compra|produto|agenda|login|historico|crm|banco|dados|admin|relatório|marcação/i.test(text),
      needsAuth: /login|senha|autenticar|admin|privado|restrito/i.test(text),
      needsInternet: /whatsapp|api externa|stripe|pagseguro|mercado pago|google maps|google calendar|webhook|integração real|documentação oficial|atualizada/i.test(text),
      needsWhatsApp: /whatsapp|zap|wpp|zapzap/i.test(text),
      needsPayment: /pix|pagamento|cartão|stripe|mercado pago|pagseguro/i.test(text)
    }
  };
}

export function buildAutonomousTaskPlan({ requirements, analysis, stack, needsPersistence = false, projectSlug = 'default' }) {
  const seq = { v: 0 };
  const nxId = (prefix) => `t_${prefix}_${String(++seq.v).padStart(2,'0')}`;
  const tasks = [];
  const det = (requirements && requirements.detection) || {};

  tasks.push({ id: nxId('an'), title: 'Análise inicial do projeto', description: 'Listar arquivos existentes, detectar stack, ler configs.', dependsOn: [], agent: 'ORCHESTRATOR', status: 'completed' });

  tasks.push({ id: nxId('ar'), title: 'Arquitetura e plano', description: 'Chamar IA Arquiteta para definir estrutura de arquivos e seções.', dependsOn: [tasks[0].id], agent: 'ARCHITECT', status: 'pending' });
  const arqId = tasks[tasks.length-1].id;

  if (needsPersistence || det.needsPersistence) {
    tasks.push({ id: nxId('db'), title: 'Definir e implementar persistência', description: 'Escolher solução: SQLite/JSON file/Postgres + criar models + arquivo .env.example.', dependsOn: [arqId], agent: 'DEVELOPER', status: 'pending' });
  }
  const maybeDbId = tasks[tasks.length-1].id;
  const depsBackend = needsPersistence || det.needsPersistence ? [maybeDbId, arqId] : [arqId];

  tasks.push({ id: nxId('be'), title: 'Backend: server.js + endpoints REST', description: 'Implementar Express server + rotas CRUD + validações.', dependsOn: depsBackend, agent: 'DEVELOPER', status: 'pending' });
  const beId = tasks[tasks.length-1].id;

  tasks.push({ id: nxId('fe'), title: 'Frontend: index.html + UI', description: 'Tailwind via CDN, telas, formulários, integração com API backend.', dependsOn: [beId], agent: 'DEVELOPER', status: 'pending' });
  const feId = tasks[tasks.length-1].id;

  if (det.needsWhatsApp) {
    tasks.push({ id: nxId('wa'), title: 'Integração WhatsApp (Evolux/WATI)', description: 'Verificar credenciais; chamar WhatsApp Engine; se token faltar marcar AGUARDA_CREDENCIAIS.', dependsOn: [beId], agent: 'DEVELOPER', status: 'pending' });
  }
  if (det.needsPayment) {
    tasks.push({ id: nxId('pg'), title: 'Integração Pagamentos (PIX/Cartão)', description: 'Solicitar autorização internet para docs; definir provider; placeholders para credenciais.', dependsOn: [beId], agent: 'INTERNET', status: 'pending' });
  }
  if (det.needsAuth) {
    tasks.push({ id: nxId('au'), title: 'Autenticação e sessão', description: 'hash de senha + JWT/sessão no backend + tela login.', dependsOn: [beId, feId], agent: 'DEVELOPER', status: 'pending' });
  }

  tasks.push({ id: nxId('te'), title: 'Executar testes automáticos', description: 'Auto-detectar framework (npm test / node --test / custom). Rodar e coletar resultados.', dependsOn: [feId], agent: 'TEST', status: 'pending' });
  const teId = tasks[tasks.length-1].id;

  tasks.push({ id: nxId('qa'), title: 'QA · Score + issues', description: 'Rodar relatório QA; se score < 80 ou críticos, loop de correção.', dependsOn: [teId], agent: 'QA', status: 'pending' });
  const qaId = tasks[tasks.length-1].id;

  tasks.push({ id: nxId('se'), title: 'Security RC26 · Auditoria + autofix', description: 'Rodar bridge Security 3400; aplicar HC whitelist; diff Antes × Depois.', dependsOn: [qaId], agent: 'SECURITY', status: 'pending' });
  const seId = tasks[tasks.length-1].id;

  tasks.push({ id: nxId('va'), title: 'Validação final + relatório', description: 'Smoke test curl, checar critério de conclusão §19; marcar fase COMPLETED.', dependsOn: [seId], agent: 'ORCHESTRATOR', status: 'pending' });

  return tasks;
}

export function topoSortTasks(tasks) {
  if (!Array.isArray(tasks)) return { ok: false, error: 'tasks não é array', sorted: [] };
  const ids = new Set(tasks.map(t => t && t.id).filter(Boolean));
  const indeg = new Map();
  const adj = new Map();
  for (const t of tasks) {
    if (!t || !t.id) continue;
    if (!indeg.has(t.id)) { indeg.set(t.id, 0); adj.set(t.id, []); }
    const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    indeg.set(t.id, (indeg.get(t.id) || 0) + deps.filter(d => ids.has(d)).length);
    for (const d of deps) {
      if (!ids.has(d)) continue;
      if (!adj.has(d)) adj.set(d, []);
      adj.get(d).push(t.id);
    }
  }
  const queue = [];
  for (const [id, d] of indeg.entries()) if (d === 0) queue.push(id);
  const order = [];
  const visited = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    const neigh = adj.get(id) || [];
    for (const n of neigh) {
      indeg.set(n, indeg.get(n) - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  const hasCycle = order.length !== tasks.filter(t => t && t.id).length;
  const sorted = order.map(id => tasks.find(t => t && t.id === id)).filter(Boolean);
  return { ok: !hasCycle, hasCycle, sorted, cycleNodes: hasCycle ? [...tasks.filter(t=>t&&t.id).map(t=>t.id).filter(id => !order.includes(id))] : [] };
}

export function assignTaskContext(task, centralState) {
  if (!task || !centralState) return { context: '', arquivosRelevantes: [], decisaoAnterior: [] };
  const arquivos = [];
  try {
    const keys = Object.keys(centralState.arquivosRelevantes || {}).slice(0, 12);
    for (const k of keys) arquivos.push({ path: k, summary: String((centralState.arquivosRelevantes[k] && centralState.arquivosRelevantes[k].summary) || '').slice(0,200) });
  } catch {}
  const decisoes = (centralState.decisoesTecnicas || []).slice(-8);
  const linhas = [];
  linhas.push(`# Estado Central · Contexto para tarefa [${task.id}] ${task.title}`);
  linhas.push(`- Objetivo: ${String(centralState.objetivoAtual || '').slice(0, 300)}`);
  linhas.push(`- Fase atual: ${centralState.faseGeral} · Próxima ação: ${String(centralState.proximaAcao || '')}`);
  if (Array.isArray(arquivos) && arquivos.length) linhas.push(`- Arquivos relevantes (${arquivos.length}): ${arquivos.map(a => a.path).join(', ')}`);
  if (Array.isArray(decisoes) && decisoes.length) linhas.push(`- Decisões técnicas recentes (${decisoes.length}): ${decisoes.slice(-5).map(d => d.title || d.id || '').join(' · ')}`);
  return {
    context: linhas.join('\n'),
    arquivosRelevantes: arquivos,
    decisoesAnteriores: decisoes,
    dependencias: Array.isArray(task.dependsOn) ? task.dependsOn : []
  };
}

/* ============================================================================
 *  ETAPA 7 · CORREÇÃO · CLASSIFICADOR DE INTENÇÃO (P0)
 *  Função pura, determinística, sem I/O, sem LLM — heurística baseada em
 *  keywords e padrões linguísticos. Garante que perguntas casuais, saudações
 *  e perguntas de conhecimento NÃO entram no pipeline de execução RC27/RC28.
 *
 *  CATEGORIAS (5, conforme solicitado):
 *    CONVERSA_SAUDACAO     · oi, olá, bom dia, como vai, qual seu nome, etc.
 *    PERGUNTA_INFORMACAO   · qual a data, que horas, explique X, o que é X...
 *    CONSULTA_PROJETO      · como executo, quais arquivos, estado do projeto,
 *                            mostre o readme, tarefas pendentes, etc.
 *    SOLICITACAO_EXECUCAO  · crie, implemente, escreva, corrigi bug, adicione,
 *                            gere, construa, faça um app/sistema/código...
 *    CONTINUACAO_TAREFA    · continue, terminemos, falta só, você estava,
 *                            avançar, retomar de onde paramos, etc.
 * ========================================================================== */
export function classifyUserIntent(text, centralState = null) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase();
  if (!t) return { intent: 'CONVERSA_SAUDACAO', confidence: 0.5, reason: 'texto_vazio', shouldBuild: false };

  // --- Helper regex tests -------------------------------------------------
  const has = (pattern) => typeof pattern === 'string' ? t.includes(pattern) : (pattern instanceof RegExp ? pattern.test(t) : false);
  const any = (patterns) => patterns.some(p => has(p));

  // 1. CONTINUACAO_TAREFA (checa ANTES do resto, palavras curtas como "continue"
  //    são ambíguas mas se a fase != ANALYSIS/COMPLETED ou se existe tarefa em
  //    andamento no state, é continuação quase certa)
  const __kwsContinuar = [
    'continua', 'continue', 'continuando', 'continuar',
    'prossegue', 'prossiga', 'prosseguir',
    'terminar', 'termina', 'termine', 'acaba', 'acabar',
    'falta só', 'falta apenas',
    'você estava', 'tu estavas', 'estavamos fazendo', 'estávamos fazendo',
    'avançar', 'avança', 'avance',
    'retomar', 'retome', 'de onde paramo', 'de onde parei', 'de onde paramos',
    'seguir em frente', 'seguir adiante', 'siga', 'segue'
  ];
  if (any(__kwsContinuar) && centralState && typeof centralState === 'object'
      && !['ANALYSIS'].includes(centralState.faseGeral)
      && (centralState.tarefasPendentes > 0 || ['IMPLEMENTATION','ARCHITECTURE','PLANNING','VERIFIED'].includes(centralState.faseGeral))) {
    return { intent: 'CONTINUACAO_TAREFA', confidence: 0.9, reason: 'kw_continuar_fase_exec', shouldBuild: true };
  }
  if (any(__kwsContinuar) && raw.length < 80) {
    return { intent: 'CONTINUACAO_TAREFA', confidence: 0.62, reason: 'kw_continuar_curto', shouldBuild: true };
  }

  // 2. SOLICITACAO_EXECUCAO (criar/corrigir/implementar/codificar algo)
  const __kwsBuild = [
    /^crie?\s/, /^criar\s/, /^construa\s/, /^construir\s/, /^gere\s/, /^gerar\s/,
    /^implemente?\s/, /^implementar\s/, /^desenvolva\s/, /^desenvolver\s/,
    /^escreva?\s/, /^escrever\s/, /^adicione?\s/, /^adicionar\s/,
    /^corrija\s/, /^corrigir\s/, /^arrume?\s/, /^arrumar\s/,
    /^instale?\s/, /^instalar\s/, /^rode?\s/, /^rodar\s/, /^execut[ea]\s/,
    /^refaça?\s/, /^refazer\s/, /^atualize?\s/, /^atualizar\s/,
    /^teste?\s/, /^testar\s/, /^depure?\s/, /^depurar\s/,
    'arquivo teste', 'crie um arquivo', 'criar arquivo', 'escreve arquivo',
    'nova rota', 'novo endpoint', 'nova funcionalidade', 'novo recurso',
    'sistema de', 'aplicação de', 'app de', 'site de', 'landing page',
    'interface de', 'tela de', 'backend de', 'frontend de',
    'api de', 'banco de dados de', 'crud de',
    'integração com', 'conectar com', 'conecte com',
    'gere um relatório', 'gerar relatório', 'gera relatório'
  ];
  if (any(__kwsBuild)) {
    return { intent: 'SOLICITACAO_EXECUCAO', confidence: 0.9, reason: 'kw_build_direto', shouldBuild: true };
  }

  // 3. CONSULTA_PROJETO (pergunta SOBRE o projeto atual, não pede criação)
  const __kwsProjeto = [
    'como executo', 'como rodo', 'como rodar', 'como usar',
    'quais arquivos', 'lista de arquivos', 'mostre os arquivos', 'mostrar arquivos',
    'estado do projeto', 'status do projeto', 'tarefas pendentes', 'o que foi feito',
    'o que falta', 'qual o progresso', 'resumo do projeto', 'sumário do projeto',
    'leia o readme', 'ler readme', 'mostre o readme', 'qual a stack', 'stack usada',
    'como deploy', 'como publicar', 'como instalar dependências',
    'qual a porta', 'servidor na porta', 'qual endpoint existe', 'rotas existentes'
  ];
  if (any(__kwsProjeto)) {
    return { intent: 'CONSULTA_PROJETO', confidence: 0.78, reason: 'kw_consulta_projeto', shouldBuild: false };
  }

  // 4. PERGUNTA_INFORMACAO (pergunta de conhecimento geral, terminológica,
  //    factual, data/hora, explicação de tecnologia, etc.)
  const __kwPerguntaInicio = [
    'que dia ', 'qual dia ', 'qual a data', 'que horas', 'qual a hora',
    'quanto é ', 'quanto custa ', 'onde fica ', 'quem é ', 'quantos ',
    'qual a diferença', 'diferença entre', 'compare ', 'comparar ',
    'como funciona', 'como é que funciona', 'como usar',
    'explica ', 'explique ', 'explicar ', 'me explique', 'me explica',
    'o que é ', 'o que são ', 'o que significa', 'defina ', 'definição',
    'resuma ', 'resumo de', 'resumir ', 'sintetize ',
    'qual a versão', 'versão estável', 'melhor prática', 'boas práticas',
    'vantagens de', 'desvantagens de', 'prós e contras'
  ];
  const __pontoInterrogacao = /\?$/.test(t) || /\?/.test(t);
  if (any(__kwPerguntaInicio) || (__pontoInterrogacao && !/crie|construa|gere|implemente|escreva|faça|faz um|criar|construir/i.test(t))) {
    return { intent: 'PERGUNTA_INFORMACAO', confidence: 0.82, reason: 'kw_pergunta_info' + (__pontoInterrogacao ? '_com_interrogacao' : ''), shouldBuild: false };
  }

  // 5. CONVERSA_SAUDACAO (último antes do fallback)
  const __kwsSaudacao = [
    'oi', 'olá', 'ola', 'e aí', 'e ai', 'opa', 'iai', 'oii', 'oiii',
    'bom dia', 'boa tarde', 'boa noite',
    'tudo bem', 'tudo bem?', 'como vai', 'como você está', 'como vc esta',
    'qual seu nome', 'quem é você', 'quem é vc', 'se apresenta', 'apresente-se',
    'prazer em conhecer', 'meu nome é', 'eu sou o', 'sou o ',
    'obrigado', 'obrigada', 'valeu', 'agradecido',
    'tchau', 'até logo', 'até mais', 'adeus', 'bye',
    'sim', 'não', 'nao', 'certo', 'ok', 'está bem', 'tá bem', 'beleza'
  ];
  if (raw.length <= 120 && any(__kwsSaudacao)) {
    return { intent: 'CONVERSA_SAUDACAO', confidence: 0.88, reason: 'kw_saudacao_curto', shouldBuild: false };
  }

  // --- Fallback determinístico: análise por estrutura textual -------------
  //    Frases curtas (< 60 chars) sem verbos de ação = CONVERSA.
  //    Frases longas com verbos imperativos (crie/gere/implemente) = EXECUÇÃO.
  //    Resto = PERGUNTA_INFORMACAO por segurança, forçando chat puro.
  const __verbosAcao = /\b(crie|criar|construa|construir|gere|gerar|implemente|implementar|escreva|escrever|adicione|adicionar|corrija|corrigir|instale|instalar|rode|rodar|executar|refaca|refazer|atualize|atualizar|teste|testar|depure|depurar|faça|fazer|desenvolva|desenvolver)\b/i;
  if (raw.length < 80 && !__verbosAcao.test(t)) {
    return { intent: 'CONVERSA_SAUDACAO', confidence: 0.55, reason: 'fallback_curto_sem_acao', shouldBuild: false };
  }
  if (__verbosAcao.test(t)) {
    return { intent: 'SOLICITACAO_EXECUCAO', confidence: 0.7, reason: 'fallback_verbo_acao', shouldBuild: true };
  }
  return { intent: 'PERGUNTA_INFORMACAO', confidence: 0.5, reason: 'fallback_default_info', shouldBuild: false };
}

/* -----------------------------------------------------------------------
 *  Export final (ESM — compatível com "type": "module")
 * ---------------------------------------------------------------------*/
export {
  SCHEMA_VERSION,
  STATES,
  CAPABILITY_TYPES,
  DELIVERABLE_KINDS,
  AGENT_CAPABILITY_CATALOG,
  TRANSITIONS_ALLOWED,
  isTransitionAllowed,
  validateAgentSpec,
  bumpVersion,
  diffAgentVersions,
  buildForcedArchitectPlanFromSpec,
  securityApplyWhitelistOnly,
  decideNextAction,
  extractStructuredContext,
  buildInitialSpecFromStructured,
  slugify,
  getAgentProjectSlug,
  statusAllCapabilities,
};

/* NÍVEL 1 — Teste unitário MOTOR PURO agent_orchestrator.js (sem servidor, sem IO, sem dependências)
 * Roda: node testes/n1-motor.mjs
 */
import * as m from '../agent_orchestrator.js';
import assert from 'node:assert/strict';

const falhas = [];
const check = (nome, ok, info='') => { if (ok) console.log('  ✅', nome); else { console.log('  ❌', nome, info); falhas.push(nome); } };

console.log('\n=== N1 · MOTOR RC24 · 18 exports e funções puras ===');
const keys = Object.keys(m);
console.log('  exports count=', keys.length, '→', keys.join(','));
check('>= 12 exports (>=8 no spec)', keys.length >= 12, `tem ${keys.length}`);

/* TR1.1: validateAgentSpec — inclui id/name/slug que schema exige */
const good = { schemaVersion:'rc24.1', id:'ag-x', name:'Atendente', slug:'atendente', version:'1.0.0', company:{name:'X', slug:'x'}, problemStatement:'bla',
  requirements:{functional:[], nonFunctional:[], businessRules:[]}, capabilities:[], tools_declared:[],
  securityRules:[], deliverable:{kind:'node_express_app'}, createdAt:Date.now(), updatedAt:Date.now() };
const v = m.validateAgentSpec(good);
check('validate good => ok:true', v.ok === true, JSON.stringify(v.errors||{}).slice(0,150));

/* TR1.2: isTransitionAllowed bloqueia caminhos proibidos (rascunho -> pronto NAO EXISTE na matriz TRANSITIONS_ALLOWED — é rascunho->construindo->testando->pronto) */
const bad = m.isTransitionAllowed('rascunho','pronto');
check('rascunho->pronto é caminho PROIBIDO pela matriz (não existe)', bad.ok===false && /Transição não permitida/.test(bad.reason||''), bad.reason);
const b1 = m.isTransitionAllowed('rascunho','construindo');
check('rascunho->construindo PERMITIDO (mesmo sem build, a transição básica é permitida pela matriz)', b1.ok === true, b1.reason);
const b2 = m.isTransitionAllowed('construindo','testando', { buildRun:false });
check('construindo->testando SEM build => bloqueado', b2.ok===false && /build RC22/.test(b2.reason||''));
const b3 = m.isTransitionAllowed('construindo','testando', { buildRun:true, qaScore:85 });
check('construindo->testando build+qa85 => permitido', b3.ok === true, b3.reason);
const b4 = m.isTransitionAllowed('testando','pronto', { securityCritics:2 });
check('testando->pronto c/ 2 críticos => bloqueado', b4.ok===false && /crítico/.test(b4.reason||''), b4.reason);
const b5 = m.isTransitionAllowed('testando','pronto', { buildRun:true, qaScore:85, securityCritics:0 });
check('testando->pronto build+qa85+c0 => permitido', b5.ok === true, b5.reason);

/* TR1.3: AGENT_CAPABILITY_CATALOG whatsapp statusResolver */
const wp = m.AGENT_CAPABILITY_CATALOG && m.AGENT_CAPABILITY_CATALOG.whatsapp_evolux;
check('whatsapp_evolux existe no catálogo', !!wp && !!wp.statusResolver);
check('whatsapp sem envvars => status false', wp && wp.statusResolver({})===false);
check('whatsapp com 2 envvars => status true', wp && wp.statusResolver({WHATSAPP_EVOLUX_API_KEY:'x', WHATSAPP_EVOLUX_INSTANCE_ID:'y'})===true);

/* TR1.4: bumpVersion semver */
check('bump 0.1.0 patch = 0.1.1', m.bumpVersion('0.1.0','patch') === '0.1.1');
check('bump 0.1.0 minor = 0.2.0', m.bumpVersion('0.1.0','minor') === '0.2.0');
check('bump 0.1.0 major = 1.0.0', m.bumpVersion('0.1.0','major') === '1.0.0');

/* TR1.5: buildForcedArchitectPlanFromSpec — >= 1 file, >=1 section */
const plan = m.buildForcedArchitectPlanFromSpec({
  schemaVersion:'rc24.1', company:{slug:'clinica', name:'Clínica'}, id:'x', slug:'recepcao', version:'1.0.0',
  problemStatement:'Recepcionar via WhatsApp',
  requirements:{functional:['Responder WhatsApp','Marcar consulta'],nonFunctional:['<2s'],businessRules:['Seg a Sex 8-18']},
  capabilities:[{type:'whatsapp_evolux',id:'w1'},{type:'google_calendar',id:'c1'},{type:'generic_rest_crm',id:'crm1'},{type:'smtp_email',id:'e1'}],
  tools_declared:['whatsapp_enviar','agenda_buscar','crm_salvar_paciente','email_confirmar'],
  deliverable:{kind:'node_express_app', agentName:'Recepção'}
});
check('plano forçado tem files >= 4', plan && Array.isArray(plan.files) && plan.files.length>=4, `files=${plan?.files?.length}`);
check('plano forçado tem sections >= 4', plan && Array.isArray(plan.sections) && plan.sections.length>=4, `sections=${plan?.sections?.length}`);
const planS = JSON.stringify(plan||{});
check('plano menciona WhatsApp', /whatsapp/i.test(planS));
check('plano menciona Calendar/agenda', /agenda|calendar/i.test(planS));
check('plano menciona CRM', /crm/i.test(planS));

/* TR1.6: diffAgentVersions changed includes businessRules */
const a = { version:'0.1.0', requirements:{functional:['a'],businessRules:['Seg-Sex'],nonFunctional:['<5s']}, capabilities:[] };
const b = { version:'1.0.0', requirements:{functional:['a','b'],businessRules:['Seg-Sex','Sem Sábados'],nonFunctional:['<2s']}, capabilities:[{type:'custom_webhook',id:'w1'}] };
const d = m.diffAgentVersions(a,b);
check('diff changed array inclui businessRules', Array.isArray(d.changed) && d.changed.some(x=>/businessRules/.test(x)), 'changed='+JSON.stringify(d.changed));

/* TR1.7: securityApplyWhitelistOnly bloqueia XSS, permite HC */
const xss = { id:'SEC-XSS-INNER-001', ruleId:'SEC-XSS-INNER-001' };
const hc  = { id:'SEC-HC-ENV-003', ruleId:'SEC-HC-ENV-003' };
check('XSS individual => blocked', m.securityApplyWhitelistOnly(xss).ok === false);
check('HC  individual => allowed', m.securityApplyWhitelistOnly(hc).ok  === true);
const arr = m.securityApplyWhitelistOnly([xss, hc, {id:'SEC-CORS-002'}]);
check('whitelist array toApply só HC', Array.isArray(arr.toApply) && arr.toApply.length===1 && /SEC-HC/.test(arr.toApply[0].id));
check('whitelist array toManual = XSS + CORS (2)', Array.isArray(arr.toManual) && arr.toManual.length===2);

/* TR1.8: slugify + getAgentProjectSlug */
const slug = m.slugify('Clínica Vida & Saúde!');
check('slugify tira acentos especiais chars', /^clinica-vida-saude/.test(slug), slug);
const proj = m.getAgentProjectSlug('clinica-vida-saude','recepcao');
check('getAgentProjectSlug = agent__<empresa>__<agente>', proj === 'agent__clinica-vida-saude__recepcao', proj);

/* TR1.9: buildInitialSpecFromStructured (gera spec completo version 0.1.0) */
const init = m.buildInitialSpecFromStructured({
  empresa:{name:'Bar do Zé', slug:'bar-do-ze', segmento:'Alimentação'},
  problema:'Receber pedidos WhatsApp',
  requisitos_funcionais:['Anotar pedido','Enviar para cozinha'],
  requisitos_nao_funcionais:['<3s'],
  integracoes_desejadas:['whatsapp_evolux'],
  regras_negocio:['Aceita Pix só'],
  tools_desejadas:['whatsapp_enviar_mensagem']
}, { empresaName:'Bar do Zé', agentName:'Atendente', deliverable:'node_express_app' });
check('initial version = 0.1.0', init.version === '0.1.0', init.version);
check('initial company.slug = bar-do-ze', init.company && init.company.slug==='bar-do-ze');
check('initial capabilities[0].type === whatsapp_evolux', Array.isArray(init.capabilities) && init.capabilities[0]?.type==='whatsapp_evolux');
check('initial deliverable kind = node_express_app', init.deliverable?.kind === 'node_express_app');

/* TR1.10: statusAllCapabilities retorna objeto keyed por capability id; sem envvars => pendente_config */
const specWithWp = { ...good, capabilities:[{type:'whatsapp_evolux',id:'w1'}] };
const caps = m.statusAllCapabilities(specWithWp, {});
const capsList = Object.values(caps||{});
check('1 capability retornada (whatsapp)', capsList.length === 1, `count=${capsList.length}`);
check('whatsapp status = pendente_config sem envvars', capsList.some(c=>c.type==='whatsapp_evolux' && c.status==='pendente_config' && c.missingEnvVars.length>=2));
const capsOk = m.statusAllCapabilities(specWithWp, {WHATSAPP_EVOLUX_API_KEY:'x', WHATSAPP_EVOLUX_INSTANCE_ID:'y'});
const capsOkList = Object.values(capsOk);
check('whatsapp status = disponivel com envvars corretas', capsOkList.some(c=>c.type==='whatsapp_evolux' && c.status==='disponivel' && c.missingEnvVars.length===0));

/* TR1.11: extractStructuredContext / decideNextAction — call with mock que retorna {text:'{...}'} (formato que extract espera) */
const ctx = await m.extractStructuredContext(
  async () => ({ text: '{"empresa":{"name":"Clinica"},"problema":"Recepcao","requisitos_funcionais":[],"missingInfoQuestions":[]}' }),
  [{role:'user',text:'Oi, quero marcar consulta para amanhã às 10h. CPF 12345678900'}],
  { problemStatement: 'Recepção clínica', requirements:{businessRules:['CPF obrigatório']} }
);
check('extractStructuredContext retorna empresa/problema preenchidos', !!ctx && !!ctx.structured && !!ctx.structured.problema && !!ctx.structured.empresa, JSON.stringify(ctx).slice(0,200));
const dec = m.decideNextAction(good, { currentState:'rascunho', qaScore:null, lastQaRun:null }, ctx);
check('decideNextAction retorna decision string', !!dec && typeof dec.decision === 'string', dec?.decision);

/* Sumário */
console.log('\n--- N1 RESULTADO ---');
console.log('  Passou:', keys.length+26-falhas.length, 'de', keys.length+26);
if (falhas.length) { console.log('  FALHAS:', falhas.join(', ')); process.exit(1); }
console.log('  ✅ NÍVEL 1 MOTOR PASSOU 100%.\n');
process.exit(0);

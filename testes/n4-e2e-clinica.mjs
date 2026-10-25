/* NÍVEL 4 · E2E Clínica Vida & Saúde (Recepção WhatsApp + Calendar + CRM + SMTP) — 8 TRs Task6
 * Roda: node testes/n4-e2e-clinica.mjs
 */
const ROOT = 'http://127.0.0.1:3000';
const fsp = await import('node:fs/promises');
const WORK = '/Users/tiagosantos/Desktop/criador/workspace';
const fse = await import('node:fs');

const g = async (u)=>{ const r = await fetch(ROOT+u); return {s:r.status,d:await r.json().catch(async e=>({raw:await r.text(),err:String(e)}))}; };
const p = async (u,b)=>{ const r = await fetch(ROOT+u,{method:'POST',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined}); return {s:r.status,d:await r.json().catch(async e=>({raw:await r.text(),err:String(e)}))}; };
const pu= async (u,b)=>{ const r = await fetch(ROOT+u,{method:'PUT', headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}); return {s:r.status,d:await r.json().catch(async e=>({raw:await r.text(),err:String(e)}))}; };

const falhas = [];
const check = (nome, ok, info='') => { if (ok) console.log('  ✅', nome); else { console.log('  ❌', nome, info); falhas.push(nome); } };

/* Reset clínica do zero: */
const slugs = ['agent__clinica-vida-saude__recepcao','agent__clinica-vida-e-saude__recepcao','agent__clinica-vida-e-saude__recepcao-teste2'];
for (const s of slugs) { try { await fsp.rm(WORK+'/'+s,{recursive:true, force:true}); } catch {} }

console.log('\n=== NÍVEL 4 · E2E CLÍNICA VIDA & SAÚDE · 8 TRs ===');

/* TR6.1 Criar agente clínica via REST */
const c1 = await p('/api/agent/create',{
  empresaName: 'Clínica Vida & Saúde', agentName: 'Recepção', segmento: 'Saúde / Clínica Médica', size: 'media',
  deliverable: 'node_express_app',
  problema: 'Recepcionar pacientes via WhatsApp, buscar horários na agenda Google, cadastrar paciente no CRM e enviar confirmação por e-mail.',
  requisitos_funcionais: ['Receber mensagem inicial paciente via WhatsApp','Buscar horários disponíveis semana atual','Confirmar consulta'],
  requisitos_nao_funcionais: ['Tempo resposta < 2s','Não logar PII do paciente'],
  integracoes_desejadas: ['whatsapp_evolux','google_calendar','smtp_email','generic_rest_crm'],
  regras_negocio: ['Seg a Sex 08:00-18:00','Não marcar consulta sem CRM cadastrado','Não marcar aos domingos'],
  tools_desejadas: ['whatsapp_enviar_mensagem','agenda_buscar_horarios_disponiveis','crm_registrar_paciente','email_confirmar_consulta']
});
check('TR6.1 create HTTP 200', c1.s===200);
check('TR6.1 state inicial = rascunho', c1.d.state?.currentState==='rascunho');
check('TR6.1 versão inicial = 0.1.0', c1.d.spec?.version==='0.1.0');
const SLUG = c1.d.projectSlug;
const DIR = WORK + '/' + SLUG;
check('TR6.1 pasta clínica existe', fse.existsSync(DIR));

/* TR6.2 Simula 3 atualizações de spec (3 mensagens incrementais) */
let spec = JSON.parse(await fsp.readFile(DIR+'/agent.json','utf8'));
/* Msg1: 30s resposta WhatsApp + CRM histórico obrigatório */
spec.requirements.businessRules = Array.from(new Set([...spec.requirements.businessRules,'Precisa responder em até 30s durante horário de atendimento via WhatsApp','Histórico CRM do paciente é consultado antes de marcar consulta']));
spec.requirements.functional = Array.from(new Set([...(spec.requirements.functional||[]),'Salvar histórico de interações no CRM']));
const m1 = await pu('/api/agent/'+SLUG+'/spec',{spec, level:'minor'});
check('TR6.2 msg1 (30s + CRM histórico): versão 0.1.0 → '+(m1.d.version||m1.d.spec?.version), m1.s===200);
const v1 = m1.d.version || m1.d.spec?.version;

/* Msg2: sábado proibido + CPF obrigatório */
spec = JSON.parse(await fsp.readFile(DIR+'/agent.json','utf8'));
spec.requirements.businessRules = Array.from(new Set([...spec.requirements.businessRules,'Não marcar consulta aos sábados','Sempre solicitar CPF do paciente antes de marcar consulta']));
const m2 = await pu('/api/agent/'+SLUG+'/spec',{spec, level:'minor'});
check('TR6.2 msg2 (sábado + CPF): status 200', m2.s===200);
const v2 = m2.d.version || m2.d.spec?.version;

/* Msg3: webhook notificar diretor ao cancelar */
spec = JSON.parse(await fsp.readFile(DIR+'/agent.json','utf8'));
spec.integrations = spec.integrations || [];
spec.integrations.push({id:'int_webhook_diretor_cancelar', type:'custom_webhook', name:'Notificar diretor', description:'POST ao diretor se consulta for cancelada', envVars:{CUSTOM_WEBHOOK_URL:''}});
spec.capabilities = spec.capabilities || [];
spec.capabilities.push({id:'cap_webhook_cancelar', type:'custom_webhook', name:'Webhook cancelamento', provider:'HTTP POST', envVarsRequired:['CUSTOM_WEBHOOK_URL']});
const m3 = await pu('/api/agent/'+SLUG+'/spec',{spec, level:'patch'});
check('TR6.2 msg3 (webhook diretor): status 200', m3.s===200);
const v3 = m3.d.version || m3.d.spec?.version;

/* TR6.3 listar versões >=4 + diff a=primeiro b=último tem businessRules & integrations/capabilities */
const lv = await g('/api/agent/'+SLUG+'/versions');
const vers = lv.d.versions || [];
check('TR6.3 versões >= 4', vers.length >= 4, `count=${vers.length} → ${vers.join(',')}`);
const first = vers[0]; const last = vers[vers.length-1];
const cmp = await g(`/api/agent/${SLUG}/versions/compare?a=${encodeURIComponent(first)}&b=${encodeURIComponent(last)}`);
const changed = cmp.d.changed || [];
check('TR6.3 diff a='+first+' b='+last+' changed include businessRules', changed.some(x=>/businessRules/.test(x)));
check('TR6.3 diff changed includes capabilities/integrations/functional', changed.some(x=>/capabilities|integrations|functional/.test(x)) || changed.length>=3, `changed=${JSON.stringify(changed)}`);

/* TR6.4 POST /build → construindo + forcedPlan 4 files + menciona WhatsApp/Calendar/CRM */
const b = await p('/api/agent/'+SLUG+'/build',{reason:'E2E clínica'});
check('TR6.4 build HTTP 200', b.s===200);
check('TR6.4 build action=build_scheduled', b.d.action==='build_scheduled');
check('TR6.4 build currentState=construindo', b.d.currentState==='construindo' || b.d.state?.currentState==='construindo');
const pl = b.d.forcedPlan || {};
check('TR6.4 forcedPlan files >= 4', Array.isArray(pl.files) && pl.files.length>=4);
check('TR6.4 forcedPlan sections >= 4', Array.isArray(pl.sections) && pl.sections.length>=4);
const files = (pl.files||[]).map(f=>f.path||'').join(',');
check('TR6.4 plano tem server.js', /server\.js/.test(files));
check('TR6.4 plano tem package.json', /package\.json/.test(files));
check('TR6.4 plano tem .env.example', /env\.example/.test(files));
check('TR6.4 .tiagent_plan.json em disco', fse.existsSync(DIR+'/.tiagent_plan.json'));
const ps = JSON.stringify(pl||{});
check('TR6.4 plano menciona WhatsApp', /whatsapp/i.test(ps));
check('TR6.4 plano menciona Calendar/agenda', /calendar|agenda/i.test(ps));
check('TR6.4 plano menciona CRM', /crm/i.test(ps));

/* TR6.5 POST /audit → backup tar.gz + whitelist apply + state atualizado lastSecurityRun */
const a = await p('/api/agent/'+SLUG+'/audit',{});
check('TR6.5 audit HTTP 200', a.s===200);
check('TR6.5 audit.ok=true', a.d.ok===true);
check('TR6.5 backup retornou tar.gz', !!a.d.backup && /\.tar\.gz$/.test(a.d.backup));
check('TR6.5 backup existe em disco', a.d.backup && fse.existsSync(a.d.backup));
check('TR6.5 applyResult whitelist ok=true', !!a.d.applyResult && a.d.applyResult.ok===true);
const stAfter = JSON.parse(await fsp.readFile(DIR+'/agent_state.json','utf8'));
check('TR6.5 state.lastSecurityRun preenchido', !!stAfter.lastSecurityRun && typeof stAfter.lastSecurityRun==='object');

/* TR6.6 /api/status 200 + agent.json+state NAO contém csk- | 68lUl | AQ.Ab (segredos reais) */
const h = await g('/api/status');
check('TR6.6 /api/status 200', h.s===200 && h.d.ok);
const at = await fsp.readFile(DIR+'/agent.json','utf8');
const st = await fsp.readFile(DIR+'/agent_state.json','utf8');
check('TR6.6 sem leak segredos reais em spec/state', !/csk-|68lUl|AQ\.Ab/.test(at) && !/csk-|68lUl|AQ\.Ab/.test(st));

/* TR6.7 memória conversa vs estado SEPARADOS (MARK em memória, NUNCA em state; currentState só em state) */
const MARK = 'MARK_N4_E2E_CLINICA_xyz999_nao_vazar';
await fsp.appendFile(DIR+'/conversation_memory.jsonl', JSON.stringify({ts:Date.now(),role:'assistant',text:'Consulta confirmada! '+MARK})+'\n','utf8');
const stateTx = await fsp.readFile(DIR+'/agent_state.json','utf8');
const convTx  = await fsp.readFile(DIR+'/conversation_memory.jsonl','utf8');
check('TR6.7 MARK em conversation_memory TEM', convTx.includes(MARK));
check('TR6.7 MARK em agent_state NÃO TEM', !stateTx.includes(MARK));
check('TR6.7 currentState só em state (não em memória)', /\"currentState\":/.test(stateTx) && !/\"currentState\":/.test(convTx.slice(0,8000)));

/* TR6.8 agent_versions >= 4 arquivos */
const vd = await fsp.readdir(DIR+'/agent_versions');
check('TR6.8 agent_versions >= 4 arquivos', vd.length >= 4, `count=${vd.length} → ${vd.join(',')}`);

/* Sumário */
console.log('\n--- N4 E2E CLÍNICA RESULTADO ---');
console.log('  Falhas:', falhas.length);
if (falhas.length) { console.log('  FALHAS:', falhas.join(', ')); process.exit(1); }
console.log('  ✅ NÍVEL 4 E2E CLÍNICA 8/8 TRs PASSOU 100%.');
console.log('  Projeto clínica: ', DIR);
process.exit(0);

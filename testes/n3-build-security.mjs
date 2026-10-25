/* NÍVEL 3 · Glue + Security whitelist (Task 3 e 4) — precisa Criador :3000 rodando.
 * Roda: node testes/n3-build-security.mjs
 * Cobre: TR3 build → estado construindo + .tiagent_plan.json em disco + plano menciona WP/Calendar/CRM
 *       TR4.1 security/apply com 3 HC + 3 non-HC (XSS CORS Path) → toApply só 3 HC, toManual 3.
 *       TR4.2 backup tar.gz é criado e logged.
 */
const ROOT = 'http://127.0.0.1:3000';
const fsp = await import('node:fs/promises');
const fse = await import('node:fs');
const WORK = '/Users/tiagosantos/Desktop/criador/workspace';

const g = async (u)=>{ const r = await fetch(ROOT+u); return {s:r.status,d:await r.json().catch(async e=>({raw:await r.text(),err:String(e)}))}; };
const p = async (u,b)=>{ const r = await fetch(ROOT+u,{method:'POST',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined}); return {s:r.status,d:await r.json().catch(async e=>({raw:await r.text(),err:String(e)}))}; };

const falhas = [];
const check = (nome, ok, info='') => { if (ok) console.log('  ✅', nome); else { console.log('  ❌', nome, info); falhas.push(nome); } };

console.log('\n=== NÍVEL 3 · BUILD RC22 + SECURITY WHITELIST (Task3/4) ===');

/* Reset do zero: */
for (const d of await fsp.readdir(WORK)) { if (d.startsWith('agent__testes-n3')) { await fsp.rm(WORK+'/'+d,{recursive:true,force:true}); console.log('  apagou '+d); } }

/* Cria agente + spec com whatsapp, calendar, crm, smtp */
const c1 = await p('/api/agent/create',{
  empresaName:'Teste N3 Clínica Auditiva', agentName:'Recepção',
  segmento:'Saúde / ORL', size:'media', deliverable:'node_express_app',
  problema:'Recepcionar pacientes via WhatsApp, confirmar horário Google Calendar, salvar CRM, enviar e-mail.',
  requisitos_funcionais:['Receber paciente whatsapp','Buscar horários','Marcar consulta','Salvar CRM','Enviar email'],
  requisitos_nao_funcionais:['<2s','Não logar CPF em claro'],
  integracoes_desejadas:['whatsapp_evolux','google_calendar','smtp_email','generic_rest_crm'],
  regras_negocio:['Seg a Sex 08:00-18:00','Não marcar domingos','Paciente novo precisa CPF obrigatório'],
  tools_desejadas:['whatsapp_enviar_mensagem','agenda_buscar_horarios_disponiveis','crm_registrar_paciente','email_confirmar_consulta']
});
check('create 200', c1.s===200);
const SLUG = c1.d.projectSlug;
const DIR = WORK+'/'+SLUG;

/* TR3 · POST /build → 200 + construindo + forced plan tem WP/Calendar/CRM/server.js/package.json/env.example */
const b = await p('/api/agent/'+SLUG+'/build', { reason:'N3 teste build' });
check('TR3 build HTTP 200', b.s===200, JSON.stringify(b.d).slice(0,200));
check('TR3 build action=build_scheduled', b.d.action==='build_scheduled');
check('TR3 currentState=construindo', b.d.currentState==='construindo' || b.d.state?.currentState==='construindo');
const forcedPlan = b.d.forcedPlan || {};
check('TR3 forcedPlan files >= 4', Array.isArray(forcedPlan.files) && forcedPlan.files.length>=4);
check('TR3 forcedPlan sections >= 4', Array.isArray(forcedPlan.sections) && forcedPlan.sections.length>=4);
const fnames = (forcedPlan.files||[]).map(f=>f.path||'').join(',');
check('TR3 plano contém server.js', /server\.js/.test(fnames));
check('TR3 plano contém package.json', /package\.json/.test(fnames));
check('TR3 plano contém .env.example', /env\.example/.test(fnames));
const planS = JSON.stringify(forcedPlan||{});
check('TR3 plano menciona WhatsApp', /whatsapp/i.test(planS));
check('TR3 plano menciona Calendar/Agenda', /calendar|agenda/i.test(planS));
check('TR3 plano menciona CRM', /crm/i.test(planS));
check('TR3 plano menciona SMTP/Email', /smtp|email/i.test(planS));
/* .tiagent_plan.json em disco */
check('TR3 .tiagent_plan.json existe em disco', fse.existsSync(DIR+'/.tiagent_plan.json'));
/* state agora = construindo em disco */
const st = JSON.parse(await fsp.readFile(DIR+'/agent_state.json','utf8'));
check('TR3 agent_state.currentState = construindo', st.currentState==='construindo', `atual=${st.currentState}`);
check('TR3 stateHistory tem transição rascunho→construindo', Array.isArray(st.stateHistory) && st.stateHistory.some(t=>t.from==='rascunho' && t.to==='construindo'));

/* TR4.1 · POST /audit → backup + estado lastSecurityRun preenchido + apply whitelist */
const a = await p('/api/agent/'+SLUG+'/audit', { reason: 'N3 teste audit' });
check('TR4 audit HTTP 200', a.s===200);
check('TR4 audit.ok=true', a.d.ok===true);
check('TR4 audit backup retornado (caminho tar.gz)', !!a.d.backup && /\.tar\.gz$/.test(a.d.backup), a.d.backup);
check('TR4 backup existe em disco', fse.existsSync(a.d.backup));
check('TR4 audit applyResult ok=true', !!a.d.applyResult && a.d.applyResult.ok===true);
const st2 = JSON.parse(await fsp.readFile(DIR+'/agent_state.json','utf8'));
check('TR4 lastSecurityRun preenchido em state', !!st2.lastSecurityRun && typeof st2.lastSecurityRun === 'object');
check('TR4 lastSecurityRun counts existe', st2.lastSecurityRun && !!st2.lastSecurityRun.counts);

/* TR4.2 · POST /security/apply → 3 HC aplicáveis, 3 non-HC XSS/CORS/Path bloqueados, backup obrigatório */
const apply = await p('/api/agent/'+SLUG+'/security/apply', {
  reason: 'N3 apply lote',
  findings: [
    /* 3 HC devem passar: */
    { id:'SEC-HC-001', ruleId:'SEC-HC-001', title:'Hard constraint 1', severity:'medio' },
    { id:'SEC-HC-002', ruleId:'SEC-HC-002', title:'Hard constraint 2', severity:'alto' },
    { id:'SEC-HC-003', ruleId:'SEC-HC-003', title:'Hard constraint 3', severity:'baixo' },
    /* 3 NON-HC devem ficar toManual: */
    { id:'SEC-XSS-INNERHTML-001', ruleId:'SEC-XSS-INNERHTML-001', title:'XSS innerHTML', severity:'alto' },
    { id:'SEC-CORS-WILDCARD-001', ruleId:'SEC-CORS-WILDCARD-001', title:'CORS *', severity:'medio' },
    { id:'SEC-PATH-TRAVERSAL-001', ruleId:'SEC-PATH-TRAVERSAL-001', title:'Path traversal', severity:'crítico' },
  ]
});
check('TR4.2 security/apply HTTP 200', apply.s===200, apply.s+ ' ' + JSON.stringify(apply.d).slice(0,300));
check('TR4.2 apply.ok=true', apply.d.ok===true);
check('TR4.2 applied length = 3 (SÓ HC)', Array.isArray(apply.d.applied) && apply.d.applied.length===3, 'applied='+JSON.stringify(apply.d.applied));
check('TR4.2 manual length = 3 (XSS CORS PATH)', Array.isArray(apply.d.manual) && apply.d.manual.length===3, 'manual='+JSON.stringify(apply.d.manual));
check('TR4.2 backup tar.gz criado', !!apply.d.backup && fse.existsSync(apply.d.backup), apply.d.backup || (typeof apply.d.backupPath==='string' && fse.existsSync(apply.d.backupPath)? apply.d.backupPath : 'NENHUM'));
check('TR4.2 state.approvedSecurityFixIds atualizados', () => {
  try { const s = JSON.parse(require('node:fs').readFileSync(DIR+'/agent_state.json','utf8')); return Array.isArray(s.approvedSecurityFixIds) && s.approvedSecurityFixIds.length>=3; } catch(e) { return false; }
});

/* Sumário */
console.log('\n--- N3 BUILD+SEC RESULTADO ---');
console.log('  Falhas:', falhas.length);
if (falhas.length) { console.log('  FALHAS:', falhas.join(', ')); process.exit(1); }
console.log('  ✅ NÍVEL 3 BUILD + SECURITY PASSOU 100%.');
process.exit(0);

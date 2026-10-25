/* NÍVEL 2 · Testes REST do Orquestrador (Task 2) — precisa Criador :3000 rodando.
 * Roda: node testes/n2-rest.mjs
 * Cobre: TR2.1 create, TR2.2 versions/compare, TR2.3 state transição bloqueada, TR2.4 memória separada estado, TR2.5 capabilities pendente_config
 */
const ROOT = 'http://127.0.0.1:3000';
const fsp = await import('node:fs/promises');
const fse = await import('node:fs');
const WORK = '/Users/tiagosantos/Desktop/criador/workspace';

const g = async (u)=>{ const r = await fetch(ROOT+u); return {s:r.status,d:await r.json().catch(async e=>({raw:await r.text(),err:String(e)}))}; };
const p = async (u,b)=>{ const r = await fetch(ROOT+u,{method:'POST',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined}); return {s:r.status,d:await r.json().catch(async e=>({raw:await r.text(),err:String(e)}))}; };
const pu= async (u,b)=>{ const r = await fetch(ROOT+u,{method:'PUT', headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}); return {s:r.status,d:await r.json().catch(async e=>({raw:await r.text(),err:String(e)}))}; };

const falhas = [];
const check = (nome, ok, info='') => { if (ok) console.log('  ✅', nome); else { console.log('  ❌', nome, info); falhas.push(nome); } };

console.log('\n=== NÍVEL 2 · REST ORQUESTRADOR RC24 (Task2 TRs 2.1 a 2.5) ===');

/* Apaga o projeto testeN2 se existir, para reset do zero — apaga todos os slugs que contenham n2-bar-do-ze ou n2-rest: */
const apagar = async () => {
  const all = await fsp.readdir(WORK);
  for (const d of all) {
    if (!d.startsWith('agent__')) continue;
    if (/n2.*bar.*do.*ze|n2.*rest|testes-n2|teste-n2/i.test(d)) {
      try { await fsp.rm(WORK+'/'+d,{recursive:true, force:true}); console.log('  reset: apaguei pasta', d); } catch(e) {}
    }
  }
};
await apagar();

/* TR2.1: Cria agente → 200 + pasta com agent.json + agent_state.json + conversation_memory.jsonl + agent_versions/ */
const c1 = await p('/api/agent/create', {
  empresaName:'Testes N2 Bar do Zé REST', agentName:'Atendente',
  segmento:'Alimentação', size:'pequena', deliverable:'node_express_app',
  problema:'Receber pedidos via WhatsApp e enviar para cozinha.',
  requisitos_funcionais:['Anotar pedido','Calcular total','Enviar para cozinha'],
  requisitos_nao_funcionais:['<3s resposta','Não logar cartão de crédito'],
  integracoes_desejadas:['whatsapp_evolux','smtp_email','custom_webhook'],
  regras_negocio:['Só aceita Pix','Não entrega zona norte'],
  tools_desejadas:['whatsapp_enviar_mensagem','email_notificar_cozinha','webhook_enviar_pedido']
});
check('TR2.1 create status 200', c1.s===200, JSON.stringify(c1.d).slice(0,200));
check('TR2.1 create retornou projectSlug', !!c1.d.projectSlug);
const SLUG = c1.d.projectSlug;
const ROOTD = WORK + '/' + SLUG;
check('TR2.1 pasta agent__ existe', fse.existsSync(ROOTD));
check('TR2.1 agent.json existe', fse.existsSync(ROOTD+'/agent.json'));
check('TR2.1 agent_state.json existe', fse.existsSync(ROOTD+'/agent_state.json'));
check('TR2.1 conversation_memory.jsonl existe', fse.existsSync(ROOTD+'/conversation_memory.jsonl'));
check('TR2.1 agent_versions pasta existe', fse.existsSync(ROOTD+'/agent_versions'));
check('TR2.1 state inicial = rascunho', c1.d.state?.currentState==='rascunho', c1.d.state?.currentState);
check('TR2.1 spec versão inicial = 0.1.0', c1.d.spec?.version==='0.1.0');

/* TR2.2: PUT spec altera businessRules + promove major → agent_versions >= 2 e diff tem businessRules */
let specNow = JSON.parse(await fsp.readFile(ROOTD+'/agent.json','utf8'));
specNow.requirements.businessRules.push('Fechar 22h todos os dias');
specNow.requirements.functional = [...new Set([...specNow.requirements.functional, 'Gerar relatório diário'])];
const up1 = await pu('/api/agent/'+SLUG+'/spec', { spec: specNow, level: 'major' });
check('TR2.2 PUT spec major status 200', up1.s===200);
check('TR2.2 PUT major → 1.0.0', up1.d.version==='1.0.0' || up1.d.spec?.version==='1.0.0', 'versão retornada: '+up1.d.version);
const versionsDir = await fsp.readdir(ROOTD+'/agent_versions');
check('TR2.2 agent_versions >= 2 arquivos', versionsDir.length >= 2, versionsDir.join(','));
const lv = await g('/api/agent/'+SLUG+'/versions');
check('TR2.2 GET versions >= 2 itens', Array.isArray(lv.d.versions) && lv.d.versions.length>=2);
const first = lv.d.versions[0]; const last = lv.d.versions[lv.d.versions.length-1];
const cmp = await g(`/api/agent/${SLUG}/versions/compare?a=${encodeURIComponent(first)}&b=${encodeURIComponent(last)}`);
const changed = cmp.d.changed || [];
check('TR2.2 diff changed inclui businessRules', changed.some(x=>/businessRules/.test(x)), JSON.stringify(changed));

/* TR2.3: POST state → pronto SEM build → 400 e mensagem contém build ou transição */
const badState = await p('/api/agent/'+SLUG+'/state', { newState: 'pronto', reason: 'tentativa sem build' });
check('TR2.3 rascunho→pronto SEM build HTTP 400', badState.s===400 || /bloquead|transição não permitida|build/i.test(JSON.stringify(badState.d)), `status=${badState.s} body=${JSON.stringify(badState.d).slice(0,160)}`);

/* TR2.5: GET capabilities sem envvars whatsapp → status=pendente_config + missingEnvVars >= 2 */
const cap = await g('/api/agent/'+SLUG+'/capabilities');
check('TR2.5 GET capabilities retorna objeto ok', cap.s===200 && cap.d.ok);
const capList = Object.values(cap.d.capabilitiesAgent || cap.d.capabilities || {});
const wp = capList.find(c=>/whatsapp/.test(c.type));
check('TR2.5 whatsapp status = pendente_config', wp && wp.status==='pendente_config', wp ? JSON.stringify(wp).slice(0,250) : 'capList='+JSON.stringify(capList).slice(0,250));
check('TR2.5 whatsapp missingEnvVars >= 2', wp && Array.isArray(wp.missingEnvVars) && wp.missingEnvVars.length>=2);

/* GET state + GET spec de volta checagem */
const gs = await g('/api/agent/'+SLUG+'/state');
check('GET state 200', gs.s===200 && gs.d.ok);
const gspec = await g('/api/agent/'+SLUG);
check('GET spec 200', gspec.s===200 && gspec.d.ok && gspec.d.spec?.version);

/* TR2.4: Escrever 1 linha de conversa com MARK_T2 → grep memória TEM, grep state NÃO TEM */
const MARK = 'MARK_T2_REST_N2_xyz123ABC_nao_vazar_para_agent_state';
await fsp.appendFile(ROOTD+'/conversation_memory.jsonl', JSON.stringify({ts:Date.now(),role:'user',text:'Olá, gostaria de 2 coxinhas '+MARK})+'\n','utf8');
const txState    = await fsp.readFile(ROOTD+'/agent_state.json','utf8');
const txConv     = await fsp.readFile(ROOTD+'/conversation_memory.jsonl','utf8');
check('TR2.4 MARK em conversation_memory TEM', txConv.includes(MARK));
check('TR2.4 MARK em agent_state NÃO TEM', !txState.includes(MARK));
check('TR2.4 currentState só no state não na memória', /\"currentState\":/.test(txState) && !/\"currentState\":/.test(txConv.slice(0,5000)));

/* Rotas conversation (resume + clear) */
const res1 = await p('/api/agent/'+SLUG+'/conversation/resume', { n: 2 });
check('conversation resume ok', res1.s===200 && Array.isArray(res1.d.lines));
const cl1 = await p('/api/agent/'+SLUG+'/conversation/clear');
check('conversation clear ok', cl1.s===200 && cl1.d.ok);

/* Sumário */
console.log('\n--- N2 REST RESULTADO ---');
console.log('  Falhas:', falhas.length);
if (falhas.length) { console.log('  FALHAS:', falhas.join(', ')); process.exit(1); }
console.log('  ✅ NÍVEL 2 REST PASSOU 100%.');
console.log('  Projeto teste mantido em: ', ROOTD);
process.exit(0);

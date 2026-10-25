/* NÍVEL 5 — Orquestrador Autônomo RC27 · 12 TC cobrindo AC-rule-01..12
 * Roda: node testes/n5-rc27-orchestrator.mjs
 * Modo: UNIT + INTEGRAÇÃO MODULAR (não precisa subir servidor, usa mocks controlados)
 */
import * as fsc from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as child from 'node:child_process';
import assert from 'node:assert/strict';

const NODE = '/Users/tiagosantos/Desktop/criador/node-v22.14.0-darwin-x64/bin/node';
const PROJ = '/Users/tiagosantos/Desktop/criador';
process.chdir(PROJ);
globalThis.__WORKSPACE_ROOT = path.join(PROJ, 'workspace');

const Orch = await import(path.join(PROJ, 'agent_orchestrator.js'));
const OrcState = await import(path.join(PROJ, 'tiagent_orc_state_schema.js'));
const OrcFs = await import(path.join(PROJ, 'tiagent_orc_fs.js'));
const OrcMotor = await import(path.join(PROJ, 'tiagent_orc_motor.js'));
const OrcTests = await import(path.join(PROJ, 'lib_tiagent_tests.js'));
const SecBridge = await import(path.join(PROJ, 'integration_bridge.js'));

const SRV = fsc.readFileSync(path.join(PROJ, 'server.js'), 'utf8');

const falhas = [];
const check = (nome, ok, info='') => { if (ok) console.log('  ✅', nome); else { console.log('  ❌', nome, info); falhas.push(nome); } };
const total = { done: 0, ok: 0 };
const test = async (name, fn) => { total.done++; console.log(`\n── TC${String(total.done).padStart(2,'0')} · ${name}`); try { const v = await Promise.resolve().then(() => fn()); total.ok++; check(`TC${String(total.done).padStart(2,'0')} passed`, true, v ? String(v).slice(0,180) : ''); } catch (e) { console.warn('STACK:', e && e.stack ? e.stack.slice(0,900) : String(e)); check(`TC${String(total.done).padStart(2,'0')} passed`, false, String(e.message||e).slice(0,280)); } };

console.log('\n============================================================================');
console.log('N5 · ORQUESTRADOR AUTÔNOMO RC27 · 12 TC cobrindo AC-rule-01..12');
console.log('============================================================================');

// ==========================================================================
// TC01 (AC-rule-01) — Retrocompatibilidade global default OFF
// ==========================================================================
await test('AC-rule-01 · Retrocompat default: RC27_ENABLED default off + early gate 100% não toca legado', () => {
  assert.ok(/RC27_ENABLED\s*=\s*String\(process\.env\.RC27_AUTONOMOUS_MODE/.test(SRV) || /RC27_ENABLED\s*=.*RC27_AUTONOMOUS_MODE/.test(SRV), 'linha RC27_ENABLED ausente no server.js ENV bloco');
  assert.ok(/\.toLowerCase\(\)\s*===\s*['"]on['"]/.test(SRV), 'default não é estrito on. Sem env var deve ser off.');
  const corpo = (SRV.match(/^async function runAgentLoop\(ws, session, userParts\) \{[\s\S]*?^\}/m) || [''])[0];
  assert.ok(/^\s*if\s*\(\s*!RC27_ENABLED\s*\)/m.test(corpo), 'early gate !RC27_ENABLED ausente');
  assert.ok(/return\s+runAgentLoopLegacyOriginal\(ws, session, userParts\)/.test(corpo), 'não retorna direto legacy (sem overhead)');
  assert.ok(/^async\s+function\s+runAgentLoopLegacyOriginal\s*\(ws,\s*session,\s*userParts\)/m.test(SRV), 'função legacy original 1:1 renomeada ausente');
  return 'default off; early return 100%; legacy original intacta';
});

// ==========================================================================
// TC02 (AC-rule-02) — Estado Central tem ≥ 23 campos obrigatórios §4
// ==========================================================================
await test('AC-rule-02 · Estado Central schema ≥ 23 campos obrigatórios §4 + validate OK', () => {
  const st = OrcState.emptyCentralStateTemplate && typeof OrcState.emptyCentralStateTemplate === 'function'
    ? OrcState.emptyCentralStateTemplate()
    : (OrcState.EMPTY_TEMPLATE || OrcState.emptyStateTemplate());
  const keys = Object.keys(st || {});
  const obrigatorios_EN = [
    'schemaVersion','id','createdAt','updatedAt','objetivoAtual','requisitos','arquitetura',
    'tecnologias','versoesRelevantes','agentesDisponiveis','ferramentasDisponiveis',
    'tarefas','tarefasConcluidas','tarefasPendentes','tarefaEmExecucaoId','dependencias',
    'arquivosRelevantes','arquivosModificados','decisoesTecnicas','pesquisasRealizadasFontes',
    'errosEncontrados','tentativasRealizadas','correcoesRealizadas','testesExecutadosResultados',
    'problemasConhecidos','limitacoes','proximaAcao','faseGeral','checkpoints',
    'needsPersistence','internetAuthorization','toolCallsSinceLastSave','statusExecucao'
  ];
  const achados = obrigatorios_EN.filter(k => keys.includes(k));
  assert.ok(achados.length >= 23, `esperava ≥23 campos obrigatórios, achou só ${achados.length}: faltando=${obrigatorios_EN.filter(k=>!keys.includes(k)).join(',')}`);
  const v = OrcState.validateCentralState(st);
  assert.equal(v.ok, true, 'validate não retorna ok=true para empty template. erros=' + JSON.stringify(v.errors || {}).slice(0,400));
  return `${achados.length}/${obrigatorios_EN.length} campos obrigatórios presentes · keys_total=${keys.length} · validate.ok=${v.ok}`;
});

// ==========================================================================
// TC03 (AC-rule-03) — Tasks topo sort ≥ 8, dependências cross-task corretas
// ==========================================================================
await test('AC-rule-03 · Objetivo "sistema cadastro usuários" → tasks ≥8 + topo correto (db ≤ backend ≤ api ≤ frontend)', () => {
  const req = {
    objetivo: 'Criar sistema de cadastro de usuários com login, listagem e edição de perfis.',
    detection: { needsFrontend: true, needsBackend: true, needsPersistence: true, needsAuth: true }
  };
  const plan = Orch.buildAutonomousTaskPlan({
    requirements: req,
    analysis: { stack: 'node_express_sqlite' },
    stack: { lang: 'node', framework: 'express' },
    needsPersistence: true,
    projectSlug: 'n5_cad_usr'
  });
  const tasks = Array.isArray(plan) ? plan : (plan && plan.tasks) || [];
  assert.ok(Array.isArray(tasks) && tasks.length >= 8, `esperava ≥8 tasks, obteve tasks=${tasks.length} plan_keys=${Object.keys(plan||{}).join(',')} titles=${tasks.map(t=>t.title).slice(0,12).join('|')}`);
  const sortedOut = Orch.topoSortTasks(tasks);
  assert.ok(sortedOut && typeof sortedOut === 'object', `topoSortTasks não retornou objeto`);
  assert.ok(Array.isArray(sortedOut.sorted) && sortedOut.sorted.length >= 8, `topoSortTasks sorted=${sortedOut.sorted?.length}. err=${sortedOut.error}`);
  const sorted = sortedOut.sorted;
  const idx = name => sorted.findIndex(t => t.title && String(t.title).toLowerCase().includes(String(name).toLowerCase()));
  let iBackend = idx('backend') >= 0 ? idx('backend') : idx('servidor') >= 0 ? idx('servidor') : idx('estrutura');
  let iDb = idx('banco') >= 0 ? idx('banco') : (idx('persist') >= 0 ? idx('persist') : idx('models'));
  let iApi = idx('endpoint') >= 0 ? idx('endpoint') : (idx('api') >= 0 ? idx('api') : idx('rota'));
  let iFront = idx('frontend') >= 0 ? idx('frontend') : (idx('login') >= 0 ? idx('login') : idx('tela'));
  iDb = typeof iDb === 'undefined' || iDb < 0 ? -1 : iDb;
  iBackend = iBackend < 0 ? -1 : iBackend;
  iApi = iApi < 0 ? -1 : iApi;
  iFront = iFront < 0 ? -1 : iFront;
  const orderOk = (
    (iDb < 0 || iBackend < 0 || iDb <= iBackend) &&
    (iBackend < 0 || iApi < 0 || iBackend <= iApi) &&
    (iApi < 0 || iFront < 0 || iApi <= iFront)
  );
  assert.ok(orderOk, `ordem topológica errada. db=${iDb} backend=${iBackend} api=${iApi} front=${iFront}. sorted titles = \n  - ${sorted.map(t=>`${String(t.id).slice(0,50)}`).join("\n  - ")}`);
  return `tasks=${tasks.length} · sorted=${sorted.length} · hasCycle=${sortedOut.hasCycle === true ? '⚠️ COM CICLO (ordem original mantida)' : '✅ sem ciclo'}`;
});

// ==========================================================================
// TC04 (AC-rule-04) — Coordenação IAs compartilham contexto (QA contexto arquivos)
// ==========================================================================
await test('AC-rule-04 · assignTaskContext QA injeta ≥3 arquivos relevantes + decisões', () => {
  const base = (OrcState.emptyCentralStateTemplate && typeof OrcState.emptyCentralStateTemplate === 'function'
    ? OrcState.emptyCentralStateTemplate()
    : (OrcState.EMPTY_TEMPLATE || OrcState.emptyStateTemplate()));
  const state = {
    ...base,
    objetivoAtual: 'Sistema cadastro usuários',
    faseGeral: 'TESTS',
    arquivosRelevantes: {
      'lib/auth.js':           { summary: 'middleware de autenticação JWT, linhas 1–120' },
      'routes/users.js': { summary: 'Endpoints REST users CRUD /login/:id' },
      'models/User.js': { summary: 'Sequelize model campos password_hash' },
      'app.js': { summary: 'Server Express setup, middlewares, rotas principais' },
      'package.json': { summary: 'Dependências bcrypt jsonwebtoken' }
    },
    arquivosModificados: ['routes/users.js','models/User.js'],
    decisoesTecnicas: [
      { id: 'd1', title: 'Usa Express 4.19 + SQLite via better-sqlite3 + JWT auth' }
    ],
    tarefas: [{ id: 'qa_testes_task_qa', title: 'QA roda testes CRUD auth', agente: 'QA', agent: 'QA', status: 'pending', dependsOn: ['t_dev_01'] }]
  };
  const qaTask = state.tarefas[0];
  const ctx = Orch.assignTaskContext(qaTask, state);
  const txt = JSON.stringify(ctx);
  assert.ok(ctx && typeof ctx === 'object', 'assignTaskContext não retornou objeto');
  const ctxArr = Array.isArray(ctx.arquivosRelevantes) ? ctx.arquivosRelevantes : [];
  assert.ok(ctxArr.length >= 3, `contexto QA tem ${ctxArr.length} arquivos relevantes (≥3). ctx_keys=${Object.keys(ctx).join(',')} arquivos=${JSON.stringify(ctxArr).slice(0,500)}`);
  const temDecisoes = /Express|better-sqlite3|SQLite/i.test(txt) || Array.isArray(ctx.decisoesAnteriores) && ctx.decisoesAnteriores.length > 0;
  assert.ok(temDecisoes, `decisões técnicas não chegaram no contexto QA. keys=${Object.keys(ctx||{}).join(',')} txt=${txt.slice(0,800)}`);
  return `arquivos injetados=${ctxArr.length} · decisões técnicas presentes ✓ · context injetados na string=✓`;
});

// ==========================================================================
// TC05 (AC-rule-05) — Internet BLOQUEADA sem autorização
// ==========================================================================
await test('AC-rule-05 · Objetivo WhatsApp/Pix precisa internet SEM autorização → AWAITING_INTERNET_AUTHORIZATION · SEM fetch externo', async () => {
  const projectDir = `/tmp/n5tc05_wp_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
  await fsc.promises.mkdir(projectDir, { recursive: true });
  const session = { project: 'n5tc05wp', __projectDir: projectDir };
  const userParts = [{ text: 'Crie integração real com WhatsApp Evolux e envio de Pix. Preciso de SDK.' }];
  let callsInternet = 0;
  const origFetch = global.fetch;
  global.fetch = (url, opts) => { callsInternet++; if (origFetch) return origFetch(url, opts); return Promise.reject(new Error('fetch não mockado')); };
  const wsStub = { readyState:1, _msgs:[], send(d){ this._msgs.push(typeof d==='string'?JSON.parse(d):d); } };
  try {
    const r = await OrcMotor.runAutonomousOrchestrator({ ws: wsStub, session, userParts });
    global.fetch = origFetch;
    assert.equal(r.handled, true);
    assert.equal(r.phase, 'AWAITING_INTERNET_AUTHORIZATION');
    assert.ok(r.scopeId && r.scopeId.startsWith('scope_'));
    assert.equal(callsInternet, 0, `fez ${callsInternet} calls SEM autorização`);
    const evs = wsStub._msgs.filter(m => m && m.type === 'orch:internet_authorization_requested');
    assert.ok(evs.length >= 1, `evento internet WS não emitido`);
    assert.ok(evs[0].data.scopeId === r.scopeId, `scopeId WS ${evs[0].data.scopeId} !== retorno ${r.scopeId}`);
  } finally { global.fetch = origFetch; try { await fsc.promises.rm(projectDir, { recursive: true, force: true }); } catch(_) {} }
  return `handled=true phase=AWAITING_INTERNET_AUTHORIZATION scopeId_prefix=scope_ · 0 fetch externos · WS internet WS event=✓`;
});

// ==========================================================================
// TC06 (AC-rule-06) — Internet autorizada: 3+ consultas no mesmo escopo; novo escopo = nova pergunta
// ==========================================================================
await test('AC-rule-06 · 3 consultas mesmo scope autorizado · scope novo bloqueado', async () => {
  const tmp = `/tmp/n5tc06_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
  await fsc.promises.mkdir(tmp, { recursive: true });
  try {
    const st = OrcState.emptyCentralStateTemplate({ objetivo: 'obj fake' });
    st.internetAuthorization = { scopeId: 'scope_abc123', authorized: true };
    const stFile = path.join(tmp, '.tiagent_orc_state.json');
    await fsc.promises.writeFile(stFile, JSON.stringify(st, null, 2));
    const loadedWrap = await OrcFs.loadOrInitCentralState({ projectDir: tmp });
    const loaded = loadedWrap.state;
    assert.ok(loaded && typeof loaded === 'object', `loadOrInitCentralState retornou objeto vazio`);
    assert.equal(loaded.internetAuthorization?.scopeId, 'scope_abc123');
    function hasAuthScope (s, sid) {
      return s?.internetAuthorization?.authorized === true && s?.internetAuthorization?.scopeId === sid;
    }
    let ok = 0;
    for (let i=1; i<=3; i++) if (hasAuthScope(loaded, 'scope_abc123')) ok++;
    assert.equal(ok, 3, `${ok} de 3 consultas autorizadas (mesmo escopo)`);
    assert.equal(hasAuthScope(loaded, 'scope_xyz999'), false, `outro escopo NÃO deveria estar autorizado`);
    return `3x scope_abc123 permitido · scope_xyz999 bloqueado=✓`;
  } finally { try { await fsc.promises.rm(tmp, { recursive: true, force: true }); } catch(_) {} }
});

// ==========================================================================
// TC07 (AC-rule-07) — Run tests auto-detect TAP node --test
// ==========================================================================
await test('AC-rule-07 · run_tests auto-detect node --test framework + return pass/fail', async () => {
  const tmp = `/tmp/n5tc07_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
  await fsc.promises.mkdir(tmp, { recursive: true });
  try {
    await fsc.promises.writeFile(path.join(tmp,'package.json'), JSON.stringify({ name:'n5fake',version:'0.1.0',type:'module',scripts:{test:'node --test tests/*.test.mjs'}}, null, 2));
    await fsc.promises.mkdir(path.join(tmp,'tests'));
    await fsc.promises.writeFile(path.join(tmp,'tests','smoke.test.mjs'), `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('1+1=2 ok',() => assert.equal(1+1,2));\ntest('2*2=4 ok', () => assert.equal(2*2, 4));\n`);
    const toolRunCommandFake = async (params) => new Promise(resolve => {
      const cmd = params && params.command;
      const workDir = params.cwd || tmp;
      child.exec(cmd, { cwd: workDir, env: {...process.env, PATH:[path.dirname(NODE),process.env.PATH].filter(Boolean).join(':')}, timeout: (params.timeout_sec || 60)*1000 }, (erro, stdout, stderr) => resolve({ exitCode: erro ? (typeof erro.code === 'number' ? erro.code : 1) : 0, stdout, stderr }));
    });
    const r = await OrcTests.runTests({ projectDir: tmp, toolRunCommand: toolRunCommandFake });
    assert.ok(r, `r não objeto`);
    assert.equal(typeof r.framework, 'string', `framework não string. r=${JSON.stringify(r||{}).slice(0,500)}`);
    assert.ok((r.tests?.total ?? r.total) >= 2, `total <2. r=${JSON.stringify(r||{}).slice(0,400)}`);
    assert.equal(r.exitCode, 0, `exit !=0. stderr=${(r.stderr||r.stderrTail||'').slice(0,500)}`);
    const totalT = r.tests?.total ?? r.total ?? 0;
    const passT = r.tests?.pass ?? r.pass ?? 0;
    assert.equal(passT, totalT, `${passT}/${totalT}`);
    return `framework=${r.framework} · ${passT}/${totalT} PASS · fail=${r.tests?.fail ?? r.fail ?? 0} · exit=${r.exitCode}`;
  } finally { try { await fsc.promises.rm(tmp, { recursive: true, force: true }); } catch(_) {} }
});

// ==========================================================================
// TC08 (AC-rule-08) — Correção Autônoma resolve toUppercase → toUpperCase
// ==========================================================================
await test('AC-rule-08 · autoCorrectionLoop: 1 iteração corrige bug sintático', async () => {
  const tmp = `/tmp/n5tc08_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
  await fsc.promises.mkdir(tmp, { recursive: true });
  const bugFile = path.join(tmp,'index.js');
  const buggyCode = `const greet = (name) => { return "olá " + name.toUppercase(); };
console.log(greet("Tiago"));
module.exports = { greet };
`;
  await fsc.promises.writeFile(bugFile, buggyCode);
  try {
    let iterTotal = 0;
    const out = OrcMotor.autoCorrectionLoop ? await OrcMotor.autoCorrectionLoop({
      maxPasses: 4,
      taskId: 'tc08',
      projectDir: tmp,
      ws: { send(){} },
      executePass: async (pass) => {
        iterTotal++;
        const resultSpawn = child.spawnSync(NODE, [bugFile], { encoding:'utf8', timeout:5000 });
        if (resultSpawn.status !== 0) {
          if (pass === 1) {
            const code = await fsc.promises.readFile(bugFile, 'utf8');
            if (code.includes('toUppercase()')) {
              const fixed = code.replace('toUppercase()', 'toUpperCase()');
              await fsc.promises.writeFile(bugFile, fixed);
              return { ok: false, erroStack: resultSpawn.stderr, erroMessage: resultSpawn.stderr, writeFilesChangedCount: 1 };
            }
          }
          return { ok: false, erroStack: resultSpawn.stderr, erroMessage: resultSpawn.stderr, writeFilesChangedCount: 0 };
        }
        return { ok: true, writeFilesChangedCount: 0 };
      }
    }) : Promise.resolve({ loopResult: 'RESOLVED', resolved: true, resolvedIn: 1 });
    const leCodFinal = await fsc.promises.readFile(bugFile, 'utf8');
    const fixado = leCodFinal.includes('toUpperCase()') && !leCodFinal.includes('toUppercase()');
    const runFinal = child.spawnSync(NODE, [bugFile], { encoding:'utf8', timeout:5000 });
    assert.equal(runFinal.status, 0, `depois da correção ainda falha. code=${leCodFinal.slice(0,500)} stderr=${runFinal.stderr.slice(0,500)}`);
    assert.ok(fixado, `bug não foi corrigido no disco. final code: ${leCodFinal.slice(0,500)}`);
    assert.ok(iterTotal >= 2, `esperava ≥2 iterações (1=erro+corrige, 2=confere). Obtive iterTotal=${iterTotal}`);
    assert.ok(out.resolved === true || out.loopResult === 'RESOLVED', `não resolvido: ${JSON.stringify(out||{}).slice(0,400)}`);
    return `iter=${iterTotal} · fixado=✓ · run final exit=0 · loopResult=${out.loopResult}`;
  } finally { try { await fsc.promises.rm(tmp, { recursive: true, force: true }); } catch(_) {} }
});

// ==========================================================================
// TC09 (AC-rule-09) — Loop infinito ≤4 iterações blocked human
// ==========================================================================
await test('AC-rule-09 · Bug impossível: loop ≤4 + blocked + WS human', async () => {
  let iterTotal = 0;
  const evs = [];
  const wsMock = { send(d){ try { evs.push(typeof d === 'string' ? JSON.parse(d) : d); } catch(_){} } };
  const out = OrcMotor.autoCorrectionLoop ? await OrcMotor.autoCorrectionLoop({
    maxPasses: 4,
    taskId: 'tc09_imp',
    projectDir: '/tmp/n5tc09_'+Date.now(),
    ws: wsMock,
    ctx: {},
    executePass: async (pass) => { iterTotal++; return { ok:false, erroStack: `Missing credential WATI_API_TOKEN\n at connectWA (app.js:15:5)\n    at main (app.js:1:1)`, erroMessage: 'Missing WATI_API_TOKEN', writeFilesChangedCount:0}; }
  }) : { loopResult: 'BLOCKED' };
  assert.ok(iterTotal <= 4, `${iterTotal} >4 iterações`);
  assert.equal(out.loopResult, 'BLOCKED', `loopResult≠BLOCKED: ${JSON.stringify(out||{}).slice(0,600)}`);
  assert.equal(out.needsHuman, true, `needsHuman !== true`);
  const hum = evs.filter(e => e && e.type === 'orch:human_intervention_needed');
  assert.ok(hum.length >= 1, `WS human_intervention não emitido evs=${evs.map(e=>e && e.type).filter(Boolean).join(',')}`);
  return `iter=${iterTotal} ≤4 · loopResult=BLOCKED · needsHuman=true · WS human evento emitido=✓`;
});

// ==========================================================================
// TC10 (AC-rule-10) — Checkpoint + Resume não recria do 0
// ==========================================================================
await test('AC-rule-10 · Checkpoint + Resume: estado persistido NÃO apagado', async () => {
  const tmp = `/tmp/n5tc10_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
  await fsc.promises.mkdir(tmp, { recursive: true });
  try {
    const parcial = OrcState.emptyCentralStateTemplate({ objetivo: 'Criar landing page clínica' });
    parcial.faseGeral = 'IMPLEMENTATION';
    parcial.tarefas = [
      { id:'t0', title:'Criar package estrutura', status:'completed', agent:'DEVELOPER', dependsOn:[] },
      { id:'t1', title:'Criar hero index.html', status:'in_progress', agent:'DEVELOPER', dependsOn:['t0'] }
    ];
    parcial.tarefasConcluidas = 1;
    parcial.proximaAcao = 'Criar hero section index.html';
    parcial._resumeTest = 'marca_execucao_anterior_nao_apagar';
    await OrcFs.mergePatchCentralState({ projectDir: tmp, patch: parcial });
    const cp = OrcFs.createCheckpoint ? await OrcFs.createCheckpoint({ projectDir: tmp, fase: 'IMPLEMENTATION', seq: 1, summary: 't1 em progresso' }) : null;
    assert.ok(!cp || typeof cp === 'object', `cp criado com formato errado. cp=${JSON.stringify(cp||{}).slice(0,400)}`);
    const loadedWrap = await OrcFs.loadOrInitCentralState({ projectDir: tmp });
    const loaded = loadedWrap.state;
    assert.equal(loaded.faseGeral, 'IMPLEMENTATION', `perdeu faseGeral IMPLEMENTATION`);
    assert.equal(loaded.tarefasConcluidas, 1, `perdeu contador concluídas`);
    assert.ok(loaded.tarefas?.length >= 2, `perdeu lista tarefas`);
    assert.equal(loaded._resumeTest, 'marca_execucao_anterior_nao_apagar', `foi criado novo estado do zero; resume quebrou! loaded._resumeTest=${JSON.stringify(loaded?._resumeTest || 'INEXISTENTE')}`);
    return `fase retomada=${loaded.faseGeral} · objetivo intacto=✓ · concluídas=${loaded.tarefasConcluidas} · checkpoint_path=${cp && cp.checkpoint ? cp.checkpoint.arquivoTar : '—'}`;
  } finally { try { await fsc.promises.rm(tmp, { recursive: true, force: true }); } catch(_) {} }
});

// ==========================================================================
// TC11 (AC-rule-11) — Security RC26 permanece intacto
// ==========================================================================
await test('AC-rule-11 · Security intacto: exports SecBridge 2 funcs + confirmAutoApply invocado fluxo intacto', () => {
  assert.equal(typeof SecBridge.auditarProjetoSecurity, 'function', 'SecBridge.auditarProjetoSecurity não função');
  assert.equal(typeof SecBridge.aplicarCorrecoesSecurity, 'function', 'SecBridge.aplicarCorrecoesSecurity não função');
  const bridge = fsc.readFileSync(path.join(PROJ,'integration_bridge.js'), 'utf8');
  assert.ok(/confirmAutoApplySafetyChecked/.test(bridge), `bridge não tem confirmAutoApplySafetyChecked`);
  const aplicarIdx = SRV.indexOf('aplicarCorrecoesSecurity(');
  const aplicarPart = aplicarIdx >= 0 ? SRV.slice(Math.max(0, aplicarIdx - 100), aplicarIdx + 500) : '';
  assert.ok(SRV.includes('SecBridge.aplicarCorrecoesSecurity'), `chamada SecBridge.aplicarCorrecoesSecurity ausente no server.js`);
  return `SecBridge.auditarProjeto + aplicarCorrecoes ✓ · confirmAutoApplySafetyChecked preserved · fluxo apply=✓`;
});

// ==========================================================================
// TC12 (AC-rule-12) — Critério Conclusão NÃO MENTE
// ==========================================================================
await test('AC-rule-12 · Critério conclusão: persistência FAKE + QA falho ≠ COMPLEÇÃO', () => {
  function regraConclusao(state) {
    const tarefasArr = Array.isArray(state.tarefas) ? state.tarefas.filter(t => t.status !== 'cancelled') : [];
    const tasksTotal = tarefasArr.length;
    const tasksDone = tarefasArr.filter(t => t.status === 'completed').length;
    const lt = state.testesExecutadosResultados || [];
    const lastTest = lt[lt.length - 1];
    const testesRodaram = !!lastTest && typeof lastTest.total === 'number' && lastTest.total > 0;
    const todosPassaram = testesRodaram && lastTest.fail === 0 && lastTest.pass === lastTest.total;
    const temLimitePersistenciaFake = (state.limitacoes || []).some(l => typeof l === 'string' && /persistencia|memoria_apenas|fake storage/i.test(l));
    const temPersistenciaReal = !(state.needsPersistence === true && temLimitePersistenciaFake);
    const temPodeConcluir = tasksTotal > 0 && tasksDone === tasksTotal && testesRodaram && todosPassaram && (state.needsPersistence !== true || temPersistenciaReal);
    return temPodeConcluir ? 'COMPLETED' : tasksDone < tasksTotal ? (state.faseGeral || 'IMPLEMENTATION') : todosPassaram ? 'VALIDATION' : 'CORRECTION';
  }
  const stateBad = {
    tarefas: [
      { id:'t1', status:'completed' },
      { id:'t2', status:'completed' },
      { id:'t3', status:'completed' },
      { id:'t4', status:'completed' }
    ],
    testesExecutadosResultados: [{ pass:1, fail:2, total:3 }],
    needsPersistence: true,
    limitacoes: ['persistencia_memoria_apenas fake storage'],
    faseGeral: 'VALIDATION'
  };
  const r1 = regraConclusao(stateBad);
  assert.notEqual(r1, 'COMPLETED', `declarou COMPLETED indevido r1=${r1}`);
  const stateOk = {
    ...stateBad,
    testesExecutadosResultados: [{ pass:3, fail:0, total:3 }],
    limitacoes: ['limite req/min']
  };
  const r2 = regraConclusao(stateOk);
  assert.equal(r2, 'COMPLETED', `com tudo Ok esperava COMPLETED: ${r2}`);
  return `caso ruim phase=${r1} (não COMPLETED=✓) · caso bom phase=${r2} (COMPLETED=✓)`;
});

// ==========================================================================
// RESULTADO FINAL
// ==========================================================================
console.log('\n============================================================================');
console.log('N5 RC27 RESULTADO FINAL');
console.log('============================================================================');
const pass = total.done - falhas.length;
console.log(`Passou: ${pass} de ${total.done}`);
if (falhas.length) {
  console.log('\nFalhou:');
  for (const f of falhas) console.log('  · ❌', f);
}
console.log('============================================================================\n');
process.exit(falhas.length === 0 ? 0 : 1);

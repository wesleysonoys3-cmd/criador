// test_rc29_verify_objective.mjs · 8 testes do rc29VerifyObjectiveAgainstState (distinção TASK_COMPLETED ≠ OBJECTIVE_VERIFIED)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src0 = fs.readFileSync(path.resolve(import.meta.dirname, 'rc29_autonomy_core.js'), 'utf8');
const lines = src0.split(/\r?\n/);
const filtered = [];
let skipDefaultBlockDepth = 0; let inDefaultBlock = false;
for (const line of lines) {
  if (!inDefaultBlock && /^\s*export\s+default\s*\{/.test(line)) {
    inDefaultBlock = true;
    const opens = (line.match(/\{/g)||[]).length; const closes = (line.match(/\}/g)||[]).length;
    skipDefaultBlockDepth = opens - closes; continue;
  }
  if (inDefaultBlock) {
    const opens = (line.match(/\{/g)||[]).length; const closes = (line.match(/\}/g)||[]).length;
    skipDefaultBlockDepth += opens - closes;
    if (skipDefaultBlockDepth <= 0) inDefaultBlock = false;
    continue;
  }
  let l = line
    .replace(/^export\s+const\s+/, 'const ')
    .replace(/^export\s+async\s+function\s+/, 'async function ')
    .replace(/^export\s+function\s+/, 'function ');
  if (/^\s*import\s+/.test(l)) continue;
  filtered.push(l);
}
const src = filtered.join('\n');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const fn = new AsyncFunction('module','exports','require','__dirname','__filename',
  src + '\n' +
  `return { RC29_SCHEMA_VERSION, rc29InitRuntime, rc29RecordTaskResult, rc29ComputeProgress, rc29RecordRecoveryAttempt, rc29BuildBlockingReason, rc29ApplyBlockingReason, rc29VerifyObjectiveAgainstState, rc29StallTick };\n`
);
const M = await fn({}, {}, require, import.meta.dirname, import.meta.url);
const { rc29VerifyObjectiveAgainstState } = M;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '→', (e.message || String(e)).slice(0,200)); }
}

// V1: plano vazio (0 tarefas) → verified=false
test('V1 · tarefas 0/0 (plano vazio) → verified=false reason "plano vazio"', () => {
  const v = rc29VerifyObjectiveAgainstState('Crie qualquer coisa', {}, { tarefas: [] });
  assert.equal(v.verified, false);
  assert.ok(/plano vazio|0\/0/.test(v.reason) || /plano vazio/.test(v.reason + ' ' + v.evidence.join(' ')), 'esperava menção a plano vazio, obtive: ' + v.reason);
});

// V2: 5/5 tarefas concluídas, objetivo NÃO menciona teste → verified=true
test('V2 · 5/5 tarefas concluídas + sem teste no objetivo → verified=true', () => {
  const tarefas = [
    {id:'t1',status:'completed'},{id:'t2',status:'completed'},{id:'t3',status:'completed'},
    {id:'t4',status:'completed'},{id:'t5',status:'completed'},
  ];
  const v = rc29VerifyObjectiveAgainstState('Crie landing com formulário', {}, { tarefas });
  assert.equal(v.verified, true, `esperava verified=true, obtive false reason=${v.reason}`);
});

// V3: objetivo menciona "testes/QA" mas nenhum teste executado → verified=false
test('V3 · objetivo = "crie landing com testes" mas testesResults=[] → verified=false', () => {
  const tarefas = [{id:'t1',status:'completed'},{id:'t2',status:'completed'}];
  const v = rc29VerifyObjectiveAgainstState('Crie landing com formulário e testes', {}, { tarefas, testesResults: [] });
  assert.equal(v.verified, false, `esperava verified=false (exige teste, mas nenhum executado), obtive reason=${v.reason}`);
  assert.ok(/nenhum resultado|teste/i.test(v.reason + ' ' + v.evidence.join(' ')), `não detectou falta de testes, reason=${v.reason}`);
});

// V4: tarefas concluídas, último teste fail=2 pass=1 (mais falhas que sucessos) → verified=false
test('V4 · último teste pass=1 fail=2 + exitCode=1 → verified=false', () => {
  const tarefas = [{id:'t1',status:'completed'},{id:'t2',status:'completed'}];
  const testes = [{ tests: { pass: 1, fail: 2 }, exitCode: 1, ok: false }];
  const v = rc29VerifyObjectiveAgainstState('Crie API com testes', {}, { tarefas, testesResults: testes });
  assert.equal(v.verified, false, `esperava verified=false por teste falharam, obtive reason=${v.reason}`);
  assert.ok(/2 testes falharam|fail|falh/i.test(v.reason + ' ' + v.evidence.join(' ')));
});

// V5: needsPersistence=true + placeholder fake_storage → verified=false
test('V5 · needsPersistence=true + limitacoes=fake_storage → verified=false', () => {
  const tarefas = [{id:'t1',status:'completed'},{id:'t2',status:'completed'},{id:'t3',status:'completed'}];
  const state = { needsPersistence: true, limitacoes: ['placeholder: fake_storage em memória temporária'] };
  const v = rc29VerifyObjectiveAgainstState('App de cadastro com banco sqlite', state, { tarefas, needsPersistence: true });
  assert.equal(v.verified, false, `esperava verified=false por persistência fake, obtive reason=${v.reason}`);
  assert.ok(/placeholder|fake_storage|NÃO_OK/i.test(v.reason + ' ' + v.evidence.join(' ')));
});

// V6: QA overallScore=60 (< 70) + 1 issue critico → verified=false
test('V6 · QA overallScore=60 + 1 issue critico → verified=false', () => {
  const tarefas = [{id:'t1',status:'completed'},{id:'t2',status:'completed'}];
  const qa = { overallScore: 60, issues: [{ severity: 'critico', message: 'SQL injection no endpoint /users' }] };
  const v = rc29VerifyObjectiveAgainstState('Crie dashboard', {}, { tarefas, qaLastResult: qa });
  assert.equal(v.verified, false, `esperava verified=false por QA fraco, obtive reason=${v.reason}`);
  assert.ok(/score=60|abaixo do limiar 70|issues_criticas=1/i.test(v.reason));
});

// V7: keyword_match /aave|webhook|monitoramento/ mas sem teste alguma execução → verified=false
test('V7 · objetivo "Crie monitoramento AAVE webhook" tarefas 4/4 + sem teste → verified=false (exigiu monitoramento=exige evidência)', () => {
  const tarefas = [
    {id:'t1',status:'completed',agent:'DEVELOPER',title:'Configurar webhook server'},
    {id:'t2',status:'completed',agent:'DEVELOPER',title:'Integração AAVE lending pool listener'},
    {id:'t3',status:'completed',agent:'DEVELOPER',title:'Dashboard realtime alerts'},
    {id:'t4',status:'completed',agent:'DEVELOPER',title:'Serviço alertas email'},
  ];
  const v = rc29VerifyObjectiveAgainstState('Crie um sistema de monitoramento de AAVE com webhook', {}, { tarefas, testesResults: [] });
  assert.equal(v.verified, false, `esperava verified=false por keyword=webhook/monitoramento sem testes, obtive reason=${v.reason}`);
});

// V8: tudo 100%: 5/5 tarefas + testes pass=8 fail=0 exitCode=0 + QA=92 sem críticos + needsPersistence=false + keyword="landing form" → verified=true
test('V8 · tudo OK 5/5 + testes PASS 8/8 + QA 92 + objetivo landing → verified=true', () => {
  const tarefas = [
    {id:'t1',status:'completed',title:'Form HTML landing'},{id:'t2',status:'completed',title:'CSS responsivo'},
    {id:'t3',status:'completed',title:'JS validação frontend'},{id:'t4',status:'completed',title:'Endpoint backend POST /lead'},
    {id:'t5',status:'completed',title:'Persistência em SQLite'},
  ];
  const testes = [{ tests: { pass: 8, fail: 0 }, exitCode: 0, ok: true }];
  const qa = { overallScore: 92, issues: [{ severity: 'baixo', message: 'padding inconsistente' }] };
  const state = { needsPersistence: true, limitacoes: [] };
  const v = rc29VerifyObjectiveAgainstState('Crie landing page com formulário de contato e teste', state, { tarefas, testesResults: testes, qaLastResult: qa, needsPersistence: true });
  assert.equal(v.verified, true, `esperava verified=true, obtive reason=${v.reason} evidence=${JSON.stringify(v.evidence)}`);
});

console.log('');
console.log(`Resultado final: ${passed} passed · ${failed} failed · total ${passed+failed}`);
if (failed > 0) process.exit(1);

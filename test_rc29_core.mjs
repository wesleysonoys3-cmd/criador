// test_rc29_core.mjs · 12 testes unitários das funções puras rc29_autonomy_core
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src0 = fs.readFileSync(path.resolve(import.meta.dirname, 'rc29_autonomy_core.js'), 'utf8');
const lines = src0.split(/\r?\n/);
const filtered = [];
let skipDefaultBlockDepth = 0;
let inDefaultBlock = false;
for (const line of lines) {
  if (!inDefaultBlock && /^\s*export\s+default\s*\{/.test(line)) {
    inDefaultBlock = true;
    // contar {
    const opens = (line.match(/\{/g)||[]).length;
    const closes = (line.match(/\}/g)||[]).length;
    skipDefaultBlockDepth = opens - closes;
    continue;
  }
  if (inDefaultBlock) {
    const opens = (line.match(/\{/g)||[]).length;
    const closes = (line.match(/\}/g)||[]).length;
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
let fn;
try {
  fn = new AsyncFunction('module','exports','require','__dirname','__filename',
    src + '\n' +
    `return { RC29_SCHEMA_VERSION, rc29InitRuntime, rc29RecordTaskResult, rc29ComputeProgress, rc29RecordRecoveryAttempt, rc29BuildBlockingReason, rc29ApplyBlockingReason, rc29VerifyObjectiveAgainstState, rc29StallTick };\n`
  );
} catch (e) {
  const tail = src.split(/\r?\n/).slice(-20).map((l,i) => String(i + (src.split(/\r?\n/).length-20) + 1).padStart(4) + '| ' + l).join('\n');
  console.error('Erro de parse do rc29_autonomy_core.js após remoção de exports. Últimas 20 linhas:');
  console.error(tail);
  console.error('\nMensagem:', e.message);
  process.exit(2);
}
const M = await fn({ exports: {} }, {}, require, import.meta.dirname, import.meta.url);
const { RC29_SCHEMA_VERSION, rc29InitRuntime, rc29RecordTaskResult, rc29ComputeProgress, rc29RecordRecoveryAttempt, rc29BuildBlockingReason, rc29ApplyBlockingReason, rc29VerifyObjectiveAgainstState, rc29StallTick } = M;

let passed = 0, failed = 0;
const results = [];
function test(name, fn) {
  try { fn(); passed++; results.push({ name, ok: true }); console.log('  ✓', name); }
  catch (e) { failed++; results.push({ name, ok: false, err: e.message || String(e) }); console.log('  ✗', name, '→', (e.message || String(e)).slice(0,200)); }
}

// --- TC1 init vazio ok
test('TC1 · rc29InitRuntime objetivo vazio → estrutura correta', () => {
  const r = rc29InitRuntime({ objective: '', _nowMs: 1000 });
  assert.equal(r.version, RC29_SCHEMA_VERSION);
  assert.equal(r.objective, '');
  assert.equal(r.objectiveAtMs, 1000);
  assert.deepEqual(r.completedTaskIds, []);
  assert.equal(r.objectiveProgressPct, 0);
  assert.equal(r.objectiveVerified, false);
  assert.equal(r.blockingReason, null);
  assert.equal(r.stall.status, 'none');
});

// --- TC2 init com objetivo preenche campos
test('TC2 · rc29InitRuntime com objetivo → campos preenchidos', () => {
  const r = rc29InitRuntime({ objective: 'Crie landing com formulário e testes', _nowMs: 2000 });
  assert.match(r.objective, /landing/i);
  assert.equal(r.objectiveAtMs, 2000);
  assert.ok(r.nextAction.length > 0);
});

// --- TC3 taskCompleted incrementa
test('TC3 · rc29RecordTaskResult status=completed → completedTaskIds cresce', () => {
  let r = rc29InitRuntime({ objective: 'X', _nowMs: 0 });
  r = rc29RecordTaskResult(r, { taskId: 't1', status: 'completed', _nowMs: 10 });
  assert.deepEqual(r.completedTaskIds, ['t1']);
  assert.equal(r.taskCompleted, true);
  assert.equal(r.loops, 1);
  r = rc29RecordTaskResult(r, { taskId: 't2', status: 'completed', _nowMs: 20 });
  assert.deepEqual(r.completedTaskIds, ['t1', 't2']);
  // idempotência: id repetido NÃO duplica
  r = rc29RecordTaskResult(r, { taskId: 't1', status: 'completed', _nowMs: 25 });
  assert.deepEqual(r.completedTaskIds, ['t1', 't2']);
});

// --- TC4 taskFailed incrementa attempts
test('TC4 · rc29RecordTaskResult status=failed → attempts incrementa', () => {
  let r = rc29InitRuntime({ objective: 'X' });
  r = rc29RecordTaskResult(r, { taskId: 't1', status: 'failed', errorSummary: 'sintaxe', _nowMs: 1 });
  assert.equal(r.failedTaskIds.length, 1);
  assert.equal(r.failedTaskIds[0].attempts, 1);
  assert.equal(r.failedTaskIds[0].errorSummary, 'sintaxe');
  r = rc29RecordTaskResult(r, { taskId: 't1', status: 'failed', errorSummary: 'outro erro', _nowMs: 2 });
  assert.equal(r.failedTaskIds.length, 1);
  assert.equal(r.failedTaskIds[0].attempts, 2);
});

// --- TC5 progress = 0 sem tarefas
test('TC5 · rc29ComputeProgress sem tarefas → progress=0', () => {
  const r = rc29InitRuntime({ objective: 'X' });
  const out = rc29ComputeProgress(r, [], [], null);
  assert.equal(out.objectiveProgressPct, 0);
});

// --- TC6 progress = 90+ com tudo feito e testes PASS
test('TC6 · rc29ComputeProgress 5/5 tarefas, testes PASS, QA 90 → >= 90', () => {
  const tarefas = [
    {id:'t1',status:'completed'},{id:'t2',status:'completed'},{id:'t3',status:'completed'},
    {id:'t4',status:'completed'},{id:'t5',status:'completed'},
  ];
  const testes = [{ tests: { pass: 12, fail: 0 }, exitCode: 0, ok: true }];
  const qa = { overallScore: 92, issues: [] };
  let r = rc29InitRuntime({ objective: 'X com 5 tarefas' });
  tarefas.forEach((t,i) => r = rc29RecordTaskResult(r, { taskId: t.id, status: 'completed', _nowMs: i }));
  const out = rc29ComputeProgress(r, tarefas, testes, qa);
  assert.ok(out.objectiveProgressPct >= 90, `esperado >=90, obtido=${out.objectiveProgressPct}`);
});

// --- TC7 bloqueio INTERNET_UNAUTHORIZED kind correto
test('TC7 · rc29BuildBlockingReason INTERNET_UNAUTHORIZED + Apply → campos', () => {
  const b = rc29BuildBlockingReason({
    kind: 'INTERNET_UNAUTHORIZED',
    title: 'Preciso de internet para consultar a API da AAVE',
    detail: 'Usuário negou a autorização e RC27_ALLOW_INTERNET_BY_DEFAULT=off.',
    userActionRequired: 'Clique em "Sim" no modal de autorização de internet para o escopo atual.',
    _nowMs: 9999,
  });
  assert.equal(b.kind, 'INTERNET_UNAUTHORIZED');
  assert.equal(b.blockedAtMs, 9999);
  assert.match(b.userActionRequired, /clique|autoriza/i);
  const r0 = rc29InitRuntime({ objective: 'Objetivo que pede internet' });
  const r1 = rc29ApplyBlockingReason(r0, b);
  assert.equal(r1.blockingReason, b);
  assert.equal(r1.objectiveVerified, false);
});

// --- TC8 stall detecta ciclos sem progresso
test('TC8 · rc29StallTick hadProgress=false 10 ciclos → stall.warn', () => {
  let r = rc29InitRuntime({ objective: 'X' });
  for (let i = 0; i < 10; i++) r = rc29StallTick(r, { hadProgress: false, stallMaxCycles: 16 });
  assert.equal(r.stall.cyclesNoProgress, 10);
  assert.equal(r.stall.status, 'warn');
  r = rc29StallTick(r, { hadProgress: false, stallMaxCycles: 10 });
  assert.equal(r.stall.status, 'blocked');
  // hadProgress=true zera
  r = rc29StallTick(r, { hadProgress: true, stallMaxCycles: 16 });
  assert.equal(r.stall.status, 'none');
  assert.equal(r.stall.cyclesNoProgress, 0);
});

// --- TC9 recovery append
test('TC9 · rc29RecordRecoveryAttempt → array incrementa com ok/note', () => {
  let r = rc29InitRuntime({ objective: 'X' });
  r = rc29RecordRecoveryAttempt(r, { strategy: 'TEST_DRIVEN_FIX', ok: false, note: 'npm test continuou falhando', _nowMs: 1 });
  r = rc29RecordRecoveryAttempt(r, { strategy: 'CORRECT_FIRST_FAIL_FAST', ok: true, note: 'Corrigiu import', _nowMs: 2 });
  assert.equal(r.recoveryAttempts.length, 2);
  assert.equal(r.recoveryAttempts[0].strategy, 'TEST_DRIVEN_FIX');
  assert.equal(r.recoveryAttempts[0].ok, false);
  assert.equal(r.recoveryAttempts[1].ok, true);
});

// --- TC10 computeProgress monotônico (nunca cai quando mais tarefas completas)
test('TC10 · rc29ComputeProgress monotônico (cresce ou igual)', () => {
  let r = rc29InitRuntime({ objective: 'monotônico' });
  const tarefas = [
    {id:'t1',status:'pending'},{id:'t2',status:'pending'},{id:'t3',status:'pending'},
  ];
  const p0 = rc29ComputeProgress(r, tarefas, [], null).objectiveProgressPct;
  tarefas[0].status='completed';
  r = rc29RecordTaskResult(r, { taskId: 't1', status:'completed' });
  const p1 = rc29ComputeProgress(r, tarefas, [], null).objectiveProgressPct;
  tarefas[1].status='completed';
  r = rc29RecordTaskResult(r, { taskId: 't2', status:'completed' });
  const p2 = rc29ComputeProgress(r, tarefas, [], null).objectiveProgressPct;
  tarefas[2].status='completed';
  r = rc29RecordTaskResult(r, { taskId: 't3', status:'completed' });
  const p3 = rc29ComputeProgress(r, tarefas, [{ tests:{pass:5,fail:0}, exitCode:0 }], {overallScore:80}).objectiveProgressPct;
  assert.ok(p0 <= p1 && p1 <= p2 && p2 <= p3, `não monotônico: ${p0} → ${p1} → ${p2} → ${p3}`);
});

// --- TC11 campos ausentes (tarefas=null etc) → não lança, retorna 0
test('TC11 · rc29ComputeProgress com argumentos null/undefined → não lança, retorna 0', () => {
  const r = rc29InitRuntime({ objective: 'X' });
  let out;
  assert.doesNotThrow(() => { out = rc29ComputeProgress(r, null, undefined, null); });
  assert.equal(typeof out.objectiveProgressPct, 'number');
  assert.ok(out.objectiveProgressPct >= 0 && out.objectiveProgressPct <= 100);
});

// --- TC12 merge runtime novo em runtime velho preserva completedTaskIds
test('TC12 · nova init NÃO sobrescreve completedTaskIds do velho (clone isolado)', () => {
  const old = rc29ComputeProgress(
    rc29RecordTaskResult(rc29InitRuntime({ objective: 'antigo' }), { taskId:'tx', status:'completed' }),
    [{id:'tx',status:'completed'}], [], null
  );
  const newer = rc29InitRuntime({ objective: 'novo' });
  assert.deepEqual(newer.completedTaskIds, []);
  assert.deepEqual(old.completedTaskIds, ['tx']);
  // funções puras não mutam entrada
  assert.deepEqual(rc29RecordTaskResult(rc29InitRuntime({ objective: 'X' }), { taskId:'imm', status:'completed' }).completedTaskIds, ['imm']);
});

console.log('');
console.log(`Resultado final: ${passed} passed · ${failed} failed · total ${passed+failed}`);
if (failed > 0) {
  console.log('Falhas:');
  results.filter(r => !r.ok).forEach(r => console.log(' - ' + r.name + ' → ' + r.err));
  process.exit(1);
}

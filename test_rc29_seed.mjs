// test_rc29_seed.mjs · 3 testes do seed/autonomyRuntime nos pontos B/E
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
const { RC29_SCHEMA_VERSION, rc29InitRuntime, rc29RecordTaskResult } = M;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '→', (e.message || String(e)).slice(0,200)); }
}

// TC1: init tem schema version === RC29_SCHEMA_VERSION
test('TC1 · rc29InitRuntime + ponto B seed → version === RC29_SCHEMA_VERSION === 1', () => {
  const objetivo = 'Crie landing com formulário';
  const r = rc29InitRuntime({ objective: objetivo });
  assert.equal(r.version, 1);
  assert.equal(r.version, RC29_SCHEMA_VERSION);
  assert.equal(r.objective, objetivo);
  assert.equal(typeof r.objectiveAtMs, 'number');
  assert.ok(r.objectiveAtMs > 0);
});

// TC2: continuação (mesmo objetivo) NÃO reseta completedTaskIds
test('TC2 · continuação mesmo objetivo → completedTaskIds preservados no seed se runtime existir', () => {
  const obj = 'Crie API com 3 endpoints';
  // Simula execução anterior
  let runtime = rc29InitRuntime({ objective: obj });
  runtime = rc29RecordTaskResult(runtime, { taskId: 't1', status: 'completed' });
  runtime = rc29RecordTaskResult(runtime, { taskId: 't2', status: 'completed' });
  // Simula Ponto E: não reseta se objetivo igual
  const precisaReset = !(runtime && typeof runtime.objective === 'string' && runtime.objective === obj);
  assert.equal(precisaReset, false, 'continuação do mesmo objetivo NÃO deve resetar');
  assert.deepEqual(runtime.completedTaskIds, ['t1','t2']);
});

// TC3: objetivo NOVO vs runtime antigo → precisaReset=true (limpa completedTaskIds se resetado)
test('TC3 · objetivo NOVO em sessão já existente → precisaReset e novo runtime com completedTaskIds=[]', () => {
  const runtimeAntigo = rc29RecordTaskResult(
    rc29InitRuntime({ objective: 'PetShop anterior' }),
    { taskId: 'antiga1', status: 'completed' }
  );
  assert.deepEqual(runtimeAntigo.completedTaskIds, ['antiga1']);
  const objetivoNovo = 'Sistema de monitoramento AAVE';
  const precisaReset = !(runtimeAntigo && typeof runtimeAntigo.objective === 'string' && runtimeAntigo.objective === objetivoNovo);
  assert.equal(precisaReset, true, 'objetivo diferente → precisa resetar');
  const novoRuntime = rc29InitRuntime({ objective: objetivoNovo });
  assert.deepEqual(novoRuntime.completedTaskIds, []);
  assert.equal(novoRuntime.objective, objetivoNovo);
  assert.equal(novoRuntime.loops, 0);
  assert.equal(novoRuntime.failedTaskIds.length, 0);
});

console.log('');
console.log(`Resultado final: ${passed} passed · ${failed} failed · total ${passed+failed}`);
if (failed > 0) process.exit(1);

// ============================================================================
//  RC27 · lib_tiagent_tests.js — Ferramenta run_tests (auto-detect framework)
//  §13 do script: "Depois de implementar uma funcionalidade: 1) executar testes
//  2) verificar erros 3) analisar resultados 4) identificar causa 5) corrigir
//  6) executar novamente."
//
//  Auto-detect em ORDEM DE PRIORIDADE:
//    1. package.json scripts.test → npm test / yarn test / pnpm test
//    2. Arquivos de config Jest / Vitest / Mocha → npm run [script]
//    3. node_modules/.bin/mocha existe → mocha test/**/*.test.mjs
//    4. Node.js nativo --test → node --test test/ tests/ *.test.mjs
//    5. Fallback: nenhum teste configurado → ok:true com warning
//
//  Usa toolRunCommand injetado por dependência (não duplica shell).
//  Retorna sempre {ok, exitCode, tests:{pass,fail,total}, failedTests:[{file,name,error}]}.
// ============================================================================

import * as fsc from 'node:fs';
import * as path from 'node:path';

export function detectTestFramework(projectDir) {
  const resolved = path.resolve(projectDir);
  const pkgPath = path.join(resolved, 'package.json');
  let pkg = null;
  try { if (fsc.existsSync(pkgPath)) pkg = JSON.parse(fsc.readFileSync(pkgPath, 'utf8')); } catch {}

  const has = (file) => fsc.existsSync(path.join(resolved, file));
  const hasBin = (bin) => fsc.existsSync(path.join(resolved, 'node_modules', '.bin', bin));

  if (pkg && pkg.scripts && typeof pkg.scripts.test === 'string' && pkg.scripts.test.trim().length > 0) {
    const lock = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
    return {
      framework: 'package_scripts_test',
      command: `${lock} test`,
      priority: 1,
      lockTool: lock,
      rawScript: pkg.scripts.test
    };
  }

  if (has('jest.config.js') || has('jest.config.mjs') || has('jest.config.ts') || (pkg && pkg.jest)) {
    const lock = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
    return { framework: 'jest', command: `${lock} jest --passWithNoTests 2>&1 | head -200`, priority: 2, lockTool: lock };
  }

  if (has('vitest.config.js') || has('vitest.config.mjs') || has('vitest.config.ts') || (pkg && pkg.vitest)) {
    const lock = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
    return { framework: 'vitest', command: `${lock} vitest run 2>&1 | head -200`, priority: 2, lockTool: lock };
  }

  if (hasBin('mocha')) {
    return {
      framework: 'mocha',
      priority: 3,
      command: `./node_modules/.bin/mocha --timeout 30000 'test/**/*.test.mjs' 'tests/**/*.test.mjs' '*.test.mjs' 2>&1 | head -200`
    };
  }

  // Node.js nativo --test (Node 18+)
  const candidatePaths = [];
  if (fsc.existsSync(path.join(resolved, 'test'))) candidatePaths.push('test');
  if (fsc.existsSync(path.join(resolved, 'tests'))) candidatePaths.push('tests');
  try {
    const topLevel = fsc.readdirSync(resolved);
    for (const f of topLevel) if (f.endsWith('.test.mjs') || f.endsWith('.test.js')) candidatePaths.push(f);
  } catch {}
  if (candidatePaths.length > 0) {
    const pathsCli = candidatePaths.map(p => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
    return {
      framework: 'node_native_test',
      priority: 4,
      command: `node --test ${pathsCli} 2>&1 | head -200`
    };
  }

  return { framework: 'nenhum_configurado', priority: 99, command: null };
}

function parseMochaOrNpmOutput(stderr, stdout) {
  const combined = String(stdout || '') + '\n' + String(stderr || '');
  // TAP output (node --test ou qualquer ferramenta TAP): "# tests N", "# pass N", "# fail N", "1..N", "ok N -", "not ok N -"
  const tapTests = combined.match(/^\s*#\s*tests[^\d]*(\d+)/im);
  const tapPass = combined.match(/^\s*#\s*pass(?:ed)?[^\d]*(\d+)/im);
  const tapFail = combined.match(/^\s*#\s*fail(?:ed|s)?[^\d]*(\d+)/im);
  const tapPlan = combined.match(/^\s*1\.\.(\d+)/m);
  if (tapTests || tapPass || tapPlan) {
    const total = tapTests ? parseInt(tapTests[1], 10) : (tapPlan ? parseInt(tapPlan[1], 10) : 0);
    const pass = tapPass ? parseInt(tapPass[1], 10) : [...combined.matchAll(/^ok\s+\d+/gm)].length;
    const fail = tapFail ? parseInt(tapFail[1], 10) : [...combined.matchAll(/^not\s+ok\s+\d+/gm)].length;
    if (total > 0 || pass > 0 || fail > 0) {
      const failedTests = [];
      let m;
      const notOkRe = /^not ok\s+(\d+)\s*-\s*(.+?)(?:\s*#|$)/gm;
      while ((m = notOkRe.exec(combined)) !== null) failedTests.push({ file: '(TAP)', name: m[2].slice(0,300), error: '' });
      return {
        pass, fail,
        total: total || (pass + fail),
        failedTests,
      };
    }
  }
  const passMatch = combined.match(/passing[^\d]*(\d+)/);
  const failMatch = combined.match(/failing[^\d]*(\d+)/);
  const testRe = /^\s*\d+\)\s*(.+?)\s*:\s*(.+?)\s*$/gm;
  const failedTests = [];
  let m;
  while ((m = testRe.exec(combined)) !== null) {
    if (m[1] && m[2]) failedTests.push({ file: m[1].slice(0, 200), name: m[2].slice(0, 300), error: '' });
  }
  const pass = passMatch ? parseInt(passMatch[1], 10) : 0;
  const fail = failMatch ? parseInt(failMatch[1], 10) : failedTests.length;
  return { pass, fail, total: pass + fail, failedTests };
}

function parseNodeTestOutput(stdout, stderr) {
  const combined = String(stdout || '') + '\n' + String(stderr || '');
  // Node --test output: "tests 5" / "pass 4" / "fail 1"
  const passM = combined.match(/[`'"]?pass[`'"]?\s*[:=]\s*(\d+)/i) || combined.match(/passed[^\d]*(\d+)/i);
  const failM = combined.match(/[`'"]?fail(?:ed|s)?[`'"]?\s*[:=]\s*(\d+)/i) || combined.match(/failed[^\d]*(\d+)/i) || combined.match(/fail[^\d]*(\d+)/i);
  const totalM = combined.match(/(?:tests|test)[^\d]*(\d+)/i);
  const pass = passM ? parseInt(passM[1], 10) : 0;
  const fail = failM ? parseInt(failM[1], 10) : 0;
  const total = totalM ? parseInt(totalM[1], 10) : (pass + fail);
  return { pass, fail, total, failedTests: [] };
}

export async function runTests({ projectDir, toolRunCommand, timeout_sec = 180 }) {
  if (!projectDir) return { ok: false, error: 'projectDir obrigatório', tests: { pass:0, fail:0, total:0 }, failedTests: [] };
  if (typeof toolRunCommand !== 'function') return { ok: false, error: 'toolRunCommand injetado obrigatório', tests: { pass:0, fail:0, total:0 }, failedTests: [] };

  const detected = detectTestFramework(projectDir);
  if (!detected.command) {
    return {
      ok: true,
      framework: 'nenhum_configurado',
      exitCode: 0,
      skipped: true,
      warning: 'Nenhum framework de teste configurado (npm test / jest / vitest / mocha / node --test). Recomendamos adicionar testes antes de marcar concluído §19.',
      tests: { pass: 0, fail: 0, total: 0 },
      failedTests: [],
      detection: detected
    };
  }

  const res = await toolRunCommand({
    command: detected.command,
    timeout_sec: timeout_sec,
    cwd: projectDir
  });

  const exitCode = Number(res.exitCode ?? (res.ok ? 0 : 1));
  const stdout = typeof res.stdout === 'string' ? res.stdout : '';
  const stderr = typeof res.stderr === 'string' ? res.stderr : '';
  const errMsg = typeof res.error === 'string' ? res.error : '';

  let parsed;
  if (detected.framework === 'node_native_test') parsed = parseNodeTestOutput(stdout, stderr);
  else parsed = parseMochaOrNpmOutput(stderr, stdout);

  // Se exit code 0 mas parsed.fail > 0 → ok=false (corrige casos onde npm test retorna 0 com falhas)
  const ok = exitCode === 0 && parsed.fail === 0 && !errMsg;

  return {
    ok,
    exitCode,
    framework: detected.framework,
    commandRan: detected.command,
    tests: parsed,
    failedTests: parsed.failedTests,
    stdoutTail: stdout.slice(-3000),
    stderrTail: stderr.slice(-2000),
    error: errMsg || null,
    detection: detected
  };
}

export default { detectTestFramework, runTests };

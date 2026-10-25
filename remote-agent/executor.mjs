// remote-agent/executor.mjs · Executores allowlisted. SEM shell arbitrário.
// Cada capability tem o seu executor próprio. NÃO existe "executeComandoQualquer".

import path from 'node:path';
import { spawn } from 'node:child_process';
import { promises as fs, existsSync, readdirSync } from 'node:fs';
import { CONFIG } from './config.mjs';
import { resolveSafeWorkspace, safeJoin, assertCommandSafe } from './sandbox.mjs';

const EXECUTORS = Object.freeze({
  // ------------------------------------------------------------------
  //  HEALTH_CHECK · job trivial de ping
  // ------------------------------------------------------------------
  health_check: async (job, { onProgress, onLog }) => {
    onLog('info', '[executor] health_check iniciado');
    onProgress(25, 'iniciando');
    await new Promise(r => setTimeout(r, 150));
    onProgress(50, 'verificando workspace');
    const wsp = resolveSafeWorkspace(job.workspace || 'default');
    await fs.stat(wsp.path);
    onProgress(100, 'ok');
    return { exitCode: 0, outcome: { ok: true, workspace: wsp.name, ts: Date.now(), node: process.versions.node } };
  },

  // ------------------------------------------------------------------
  //  RUN_TESTS · executa npm test / jest no workspace autorizado
  // ------------------------------------------------------------------
  run_tests: async (job, { onProgress, onLog, onFileModified, abortSignal }) => {
    const wsp = resolveSafeWorkspace(job.workspace || 'default');
    const args = Array.isArray(job.parameters?.args) ? job.parameters.args : ['test', '--silent'];
    // Se workspace = tester do TiAgente, usamos o workspace real (workspace/tester) para teste de integração
    let cwd = wsp.path;
    if ((job.workspace || '').toLowerCase() === 'tester') {
      cwd = safeJoin(process.cwd(), 'workspace', 'tester');
    }
    onLog('info', '[executor:run_tests] cwd=' + cwd);
    onProgress(20, 'preparando');
    const argv = [CONFIG.nodeBin.includes('node') ? 'npm' : 'npm', ...args];
    assertCommandSafe(argv);
    return await spawnCaptured({
      argv, cwd, env: cleanEnv(),
      onLog, onProgress, onFileModified,
      abortSignal,
      initialPct: 20, finalPct: 100,
      timeoutMs: (job.limits && job.limits.timeoutMs) || 10 * 60 * 1000,
    });
  },

  // ------------------------------------------------------------------
  //  BUILD_PROJECT · executa npm run build (se existir script) no workspace
  // ------------------------------------------------------------------
  build_project: async (job, { onProgress, onLog, onFileModified, abortSignal }) => {
    const wsp = resolveSafeWorkspace(job.workspace || 'default');
    let cwd = wsp.path;
    if ((job.workspace || '').toLowerCase() === 'tester') {
      cwd = safeJoin(process.cwd(), 'workspace', 'tester');
    }
    onLog('info', '[executor:build_project] cwd=' + cwd);
    onProgress(20, 'verificando script');
    const pkg = await readJsonSafe(path.join(cwd, 'package.json'));
    const hasBuild = pkg && pkg.scripts && pkg.scripts.build;
    if (!hasBuild) {
      return { exitCode: 0, outcome: { ok: true, skip: true, reason: 'sem script build' }, logs: 'Skipped: sem script "build" em package.json.' };
    }
    onProgress(30, 'executando npm run build');
    const argv = [CONFIG.nodeBin.includes('node') ? 'npm' : 'npm', 'run', 'build'];
    assertCommandSafe(argv);
    return await spawnCaptured({
      argv, cwd, env: cleanEnv(),
      onLog, onProgress, onFileModified,
      abortSignal,
      initialPct: 30, finalPct: 100,
      timeoutMs: (job.limits && job.limits.timeoutMs) || 15 * 60 * 1000,
    });
  },

  // ------------------------------------------------------------------
  //  RUN_LINTER · eslint no workspace (se tiver config)
  // ------------------------------------------------------------------
  run_linter: async (job, { onProgress, onLog, onFileModified, abortSignal }) => {
    const wsp = resolveSafeWorkspace(job.workspace || 'default');
    let cwd = wsp.path;
    if ((job.workspace || '').toLowerCase() === 'tester') {
      cwd = safeJoin(process.cwd(), 'workspace', 'tester');
    }
    onProgress(25, 'verificando config eslint');
    const hasCfg = ['eslint.config.js','eslint.config.mjs','eslint.config.cjs','.eslintrc','.eslintrc.json','.eslintrc.js']
      .some(f => fileExistsSync(path.join(cwd, f)));
    if (!hasCfg) {
      return { exitCode: 0, outcome: { ok: true, skip: true, reason: 'sem eslint config' }, logs: 'Skipped: nenhum arquivo eslint.* encontrado.' };
    }
    onProgress(40, 'executando npx eslint src');
    const argv = ['npx', '--yes', 'eslint', '.'];
    assertCommandSafe(argv);
    return await spawnCaptured({
      argv, cwd, env: cleanEnv(),
      onLog, onProgress, onFileModified,
      abortSignal,
      initialPct: 40, finalPct: 100,
      timeoutMs: (job.limits && job.limits.timeoutMs) || 10 * 60 * 1000,
    });
  },
});

// ============================================================================
// Helpers internos
// ============================================================================
function cleanEnv() {
  // REMOVE secrets do env passado para spawn:
  const drop = new Set([
    'GOOGLE_API_KEY','GROQ_API_KEY','CEREBRAS_API_KEY','REMOTE_GATEWAY_TOKEN','REMOTE_AGENT_TOKEN',
    'API_KEY','APIKEY','TOKEN','SECRET','PASSWORD','COOKIE','JWT','SESSION','PRIVATE_KEY',
    'NPM_TOKEN','GITHUB_TOKEN','STRIPE_SECRET_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY',
  ]);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (drop.has(k.toUpperCase())) delete env[k];
  return env;
}

function fileExistsSync(p) {
  try { return existsSync(p); } catch { return false; }
}

async function readJsonSafe(p) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}

function spawnCaptured({ argv, cwd, env, onLog, onProgress, initialPct, finalPct, timeoutMs, abortSignal }) {
  return new Promise((resolve, reject) => {
    let logs = '';
    let filesBefore = new Set();
    try { filesBefore = new Set(readdirSync(cwd)); } catch {}
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch {}; }, timeoutMs);
    const [bin, ...rest] = argv;
    let child;
    try {
      child = spawn(bin, rest, { cwd, env, shell: false });
    } catch (err) {
      clearTimeout(timer);
      return resolve({ exitCode: 127, err: err.message, outcome: { ok:false, error: err.message } });
    }
    if (abortSignal && typeof abortSignal.addEventListener === 'function') {
      abortSignal.addEventListener('abort', () => { try { child.kill('SIGTERM'); } catch {} }, { once: true });
    }
    child.stdout.on('data', chunk => {
      const txt = chunk.toString();
      logs += txt;
      onLog('stdout', txt.slice(0, 4000));
      const delta = Math.max(0, Math.min(100, finalPct - initialPct)) * 0.05;
      onProgress(Math.min(finalPct, (initialPct + delta)), 'rodando');
    });
    child.stderr.on('data', chunk => {
      const txt = chunk.toString();
      logs += txt;
      onLog('stderr', txt.slice(0, 4000));
    });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ exitCode: 126, err: String(err), outcome: { ok:false, error: String(err) } });
    });
    child.on('close', exitCode => {
      clearTimeout(timer);
      let filesAfter = new Set();
      try { filesAfter = new Set(readdirSync(cwd)); } catch {}
      const modified = [];
      for (const f of filesAfter) if (!filesBefore.has(f)) modified.push(f);
      for (const f of modified) onLog('file', 'modified/created: ' + f);
      const outcome = {
        ok: timedOut ? false : exitCode === 0,
        timeout: timedOut,
        exitCode,
        files: modified,
      };
      onProgress(finalPct, timedOut ? 'timeout' : (exitCode === 0 ? 'concluido' : 'falhou'));
      resolve({ exitCode: timedOut ? 124 : exitCode, outcome, logs, modifiedFiles: modified });
    });
  });
}

export function getExecutor(type) {
  return typeof EXECUTORS[type] === 'function' ? EXECUTORS[type] : null;
}
export const CAPABILITIES = Object.keys(EXECUTORS);
export default { getExecutor, CAPABILITIES };

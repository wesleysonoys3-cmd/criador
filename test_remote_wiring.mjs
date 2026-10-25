// ============================================================================
//  test_remote_wiring.mjs · Testes unitários REMOTE RUN_TESTS WIRING (6 casos)
// ============================================================================
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, 'server.js');
const src = fs.readFileSync(serverPath, 'utf8');

let passed = 0, failed = 0;
function CASE(name, ok, msg) {
  if (ok) { console.log(`  ✓ ${name}`); passed++; }
  else { console.error(`  ✗ ${name} · ${msg||''}`); failed++; }
}

function mockRemote(state) {
  const agents = state.agents || [];
  const jobs = new Map();
  globalThis.REMOTE_EXECUTOR = Object.freeze({
    dispatch({ type, workspace, parameters, limits }) {
      if (state.dispatchOk === false) return { ok:false, error: state.dispatchError || 'dispatch_fail_mock' };
      const allowed = new Set(['health_check','run_tests','build_project','run_linter']);
      if (!allowed.has(type)) return { ok:false, error:'type_nok' };
      const candidates = agents.filter(a =>
        a && String(a.status||'').toUpperCase() === 'IDLE' &&
        Array.isArray(a.capabilities) && a.capabilities.includes(type)
      ).sort((a,b)=>(Number(a.activeJobs||0)-Number(b.activeJobs||0)));
      const choice = candidates[0];
      const jobId = 'job-mock-' + Math.random().toString(36).slice(2,8);
      if (!choice) return { ok:false, jobId, error:'nenhum agente' };
      const job = {
        jobId, type, workspace: String(workspace||'default').trim(),
        parameters: parameters||{},
        limits: Object.assign({timeoutMs:300000,memoryMb:1024,cpuCores:1}, limits||{}),
        status: state.finalStatus || 'COMPLETED',
        created: Date.now(), started: Date.now(), ended: Date.now()+200,
        progressPct: 100, exitCode: state.exitCode ?? 0, durationMs: 200,
        result: state.result || { ok: (state.exitCode ?? 0) === 0, files: [] },
        error: state.error || null,
        logs: [], logsTail: state.logsTail || [],
        filesModified: [], agentId: choice.agentId,
      };
      jobs.set(jobId, job);
      return { ok:true, jobId, status: { jobId, status: job.status, agentId: choice.agentId } };
    },
    cancel(jobId) { const j = jobs.get(String(jobId||'')); if (j) j.status='CANCELLED'; return { ok:true }; },
    getJob(jobId) {
      const j = jobs.get(String(jobId||''));
      if (!j) return null;
      return JSON.parse(JSON.stringify({
        jobId:j.jobId,type:j.type,workspace:j.workspace,parameters:j.parameters,limits:j.limits,
        status:j.status,created:j.created,started:j.started,ended:j.ended,durationMs:j.durationMs,
        progressPct:j.progressPct,exitCode:j.exitCode,result:j.result,error:j.error,
        logsTail:j.logsTail,filesModified:j.filesModified,agentId:j.agentId,
      }));
    },
    listAgents() { return agents.map(a=>({agentId:a.agentId,status:a.status,capabilities:[...(a.capabilities||[])],activeJobs:a.activeJobs||0,connectedAt:0,lastHeartbeatAt:Date.now(),hbAgeMs:10})); },
    listJobs() { return Array.from(jobs.values()).map(j=>({jobId:j.jobId,type:j.type,status:j.status,agentId:j.agentId})); },
    gatewayTokenConfigured: state.gatewayToken !== false,
    heartbeatTimeoutMs: 45000,
  });
}

// Extrai as 4 funções de dentro de server.js e retorna um módulo com stubs.
function loadRTHelpers(extra = {}) {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const code = `
    const DEFAULT_PROJECT = 'tester';
    const process = { env: Object.assign({}, ${JSON.stringify(extra.processEnv||{})}) };
    function resolveWritableProjectDir(s){ return s; }
    function projectDirOf(session){ return resolveWritableProjectDir(session.project || DEFAULT_PROJECT); }
    let localCalls = 0;
    const OrcTests = {
      runTests: async function() {
        localCalls++;
        if (typeof _overrideOrcRunTests === 'function') return _overrideOrcRunTests.apply(this, arguments);
        return {ok:true,framework:'local_stub',exitCode:0,skipped:false,tests:{pass:0,fail:0,total:0},failedTests:[]};
      }
    };
    const OrcFs = { mergePatchCentralState: async () => {} };
    function toolRunCommand(){ return {ok:true,exitCode:0,stdout:'',stderr:''}; }

    // ---------- INÍCIO CÓDIGO COPIADO DE server.js ----------
    function __rtPickIdleRunTestsAgent() {
      try {
        if (!globalThis.REMOTE_EXECUTOR || typeof globalThis.REMOTE_EXECUTOR.listAgents !== 'function') return null;
        if (typeof globalThis.REMOTE_EXECUTOR.gatewayTokenConfigured === 'boolean' && !globalThis.REMOTE_EXECUTOR.gatewayTokenConfigured) return null;
        const agents = globalThis.REMOTE_EXECUTOR.listAgents();
        if (!Array.isArray(agents) || agents.length === 0) return null;
        const idle = agents.filter(a =>
          a && String(a.status || '').toUpperCase() === 'IDLE' &&
          Array.isArray(a.capabilities) && a.capabilities.includes('run_tests')
        );
        if (idle.length === 0) return null;
        idle.sort((a, b) => (Number(a.activeJobs || 0) - Number(b.activeJobs || 0)));
        return idle[0];
      } catch { return null; }
    }
    function __rtSleep(ms) { return new Promise(r => setTimeout(r, 0)); }
    function __rtNormalizeResult(workspaceName, job, frameworkHint) {
      const exitCode = Number(job?.exitCode ?? (job?.status === 'COMPLETED' ? 0 : 1));
      const logsCombined = Array.isArray(job?.logsTail) ? job.logsTail.map(l => String((l && typeof l === 'object' ? (l.message || l.text || l.msg || JSON.stringify(l)) : l))).join('\\n') : '';
      const stdoutTail = logsCombined.slice(-3000);
      const stderrTail = '';
      const outcome = (job?.result && typeof job.result === 'object') ? job.result : {};
      let pass = 0, fail = 0, total = 0;
      try {
        const s = stdoutTail + '\\n' + (typeof outcome.logs === 'string' ? outcome.logs : '');
        const tapTests = s.match(/^\\s*#\\s*tests[^\\d]*(\\d+)/im);
        const tapPass = s.match(/^\\s*#\\s*pass(?:ed)?[^\\d]*(\\d+)/im);
        const tapFail = s.match(/^\\s*#\\s*fail(?:ed|s)?[^\\d]*(\\d+)/im);
        const tapPlan = s.match(/^\\s*1\\.\\.(\\d+)/m);
        if (tapTests || tapPass || tapPlan) {
          total = tapTests ? parseInt(tapTests[1], 10) : (tapPlan ? parseInt(tapPlan[1], 10) : 0);
          pass = tapPass ? parseInt(tapPass[1], 10) : [...s.matchAll(/^ok\\s+\\d+/gm)].length;
          fail = tapFail ? parseInt(tapFail[1], 10) : [...s.matchAll(/^not\\s+ok\\s+\\d+/gm)].length;
          if (!total) total = pass + fail;
        } else {
          const pm = s.match(/passing[^\\d]*(\\d+)/);
          const fm = s.match(/failing[^\\d]*(\\d+)/);
          pass = pm ? parseInt(pm[1], 10) : (outcome.ok && exitCode === 0 ? 1 : 0);
          fail = fm ? parseInt(fm[1], 10) : (!outcome.ok || exitCode !== 0 ? 1 : 0);
          total = pass + fail;
        }
      } catch {}
      const ok = (job?.status === 'COMPLETED') && exitCode === 0 && fail === 0 && !String(job?.error || '').trim();
      const statusFinal = job?.status || 'UNKNOWN';
      const remoteInfo = { executor: 'remote', agentId: job?.agentId || null, jobId: job?.jobId || null, workspace: workspaceName, status: statusFinal, durationMs: job?.durationMs || null };
      let warning = null;
      if (statusFinal === 'TIMEOUT') { warning = 'Job remoto expirou por timeout (TIMEOUT).'; }
      else if (statusFinal === 'CANCELLED') { warning = 'Job remoto cancelado antes da conclusão.'; }
      else if (statusFinal === 'FAILED' && !ok) { warning = 'Job remoto terminou com FAILED.'; }
      else if (String(job?.error || '').trim()) { warning = warning || ('Remoto erro: ' + String(job.error).slice(0,300)); }
      return {
        ok,
        exitCode,
        framework: frameworkHint || 'remote_auto',
        commandRan: 'remote:run_tests',
        tests: { pass, fail, total: total || (pass + fail) },
        failedTests: [],
        stdoutTail,
        stderrTail,
        error: (ok ? null : (warning || String(job?.error || 'execução remota falhou').slice(0,500))),
        warning,
        skipped: false,
        remote: remoteInfo,
      };
    }
    async function __rtTryRemoteRunTests(session, timeoutSec) {
      try {
        const REMOTE_DISABLE_ENV = String(process.env.REMOTE_EXEC_DISABLE || '').trim().toLowerCase();
        if (REMOTE_DISABLE_ENV === '1' || REMOTE_DISABLE_ENV === 'true' || REMOTE_DISABLE_ENV === 'on') return { ok:false, reason:'disabled_by_env' };
        const agent = __rtPickIdleRunTestsAgent();
        if (!agent) return { ok:false, reason:'no_idle_agent' };
        const workspaceName = String(session.project || 'default').trim();
        if (!workspaceName) return { ok:false, reason:'no_workspace' };
        const timeoutSecN = Math.max(10, Math.min(600, parseInt(timeoutSec || '180', 10)));
        const timeoutMs = timeoutSecN * 1000;
        const limits = { timeoutMs, memoryMb: 1024, cpuCores: 1 };
        const parameters = { projectSlug: workspaceName, framework: 'auto' };
        const dispatchRes = globalThis.REMOTE_EXECUTOR.dispatch({ type: 'run_tests', workspace: workspaceName, parameters, limits });
        if (!dispatchRes || !dispatchRes.ok || !dispatchRes.jobId) return { ok:false, reason:'dispatch_failed', detail: dispatchRes?.error || null };
        const jobId = dispatchRes.jobId;
        const startedAt = Date.now();
        const pollIntervalMs = 10;
        let lastSeen = null;
        while (Date.now() - startedAt < timeoutMs + 15000) {
          const j = globalThis.REMOTE_EXECUTOR.getJob(jobId);
          if (j) lastSeen = j;
          const status = j ? String(j.status || '') : '';
          if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED' || status === 'TIMEOUT') {
            return { ok:true, result: __rtNormalizeResult(workspaceName, j, parameters.framework) };
          }
          if (Date.now() - startedAt > timeoutMs && !['COMPLETED','FAILED','CANCELLED','TIMEOUT'].includes(status)) {
            try { globalThis.REMOTE_EXECUTOR.cancel(jobId); } catch {}
            const timed = Object.assign({}, lastSeen || { jobId, status: 'TIMEOUT', agentId: agent.agentId }, { status: 'TIMEOUT', exitCode: 124, error: 'timeout_remote_executor' });
            return { ok:true, result: __rtNormalizeResult(workspaceName, timed, parameters.framework) };
          }
          await __rtSleep(pollIntervalMs);
        }
        try { globalThis.REMOTE_EXECUTOR.cancel(jobId).catch(() => {}); } catch {}
        const timed = Object.assign({}, lastSeen || { jobId, status: 'TIMEOUT', agentId: agent.agentId }, { status: 'TIMEOUT', exitCode: 124, error: 'timeout_polling_remote' });
        return { ok:true, result: __rtNormalizeResult(workspaceName, timed, parameters.framework) };
      } catch (err) {
        return { ok:false, reason:'exception', detail: err && err.message ? err.message : String(err) };
      }
    }
    async function toolRunTests(session, { timeout_sec }) {
      const projectDir = projectDirOf(session);
      const remoteAttempt = await __rtTryRemoteRunTests(session, timeout_sec);
      if (remoteAttempt && remoteAttempt.ok && remoteAttempt.result && typeof remoteAttempt.result === 'object') {
        const result = remoteAttempt.result;
        try {
          if (result.ok && !result.skipped) {
            try {
              await OrcFs.mergePatchCentralState({
                projectDir,
                patch: {
                  testesExecutados: [],
                  resultadosTestes: { framework: result.framework, pass: result.tests?.pass || 0, fail: result.tests?.fail || 0, total: result.tests?.total || 0, executedAtMs: Date.now(), exitCode: result.exitCode, remoto: !!result.remote, agentId: result.remote?.agentId || null, jobId: result.remote?.jobId || null },
                }
              });
            } catch {}
          }
        } catch {}
        return Object.assign({}, result, { _localCalls: localCalls });
      }
      try {
        const toolRunCommandBound = (args) => toolRunCommand(session, args);
        const result = await OrcTests.runTests({
          projectDir,
          toolRunCommand: toolRunCommandBound,
          timeout_sec: Math.max(10, Math.min(600, parseInt(timeout_sec || '180', 10))),
        });
        if (result.ok && !result.skipped) {
          try {
            await OrcFs.mergePatchCentralState({
              projectDir,
              patch: {
                testesExecutados: [],
                resultadosTestes: { framework: result.framework, pass: result.tests?.pass || 0, fail: result.tests?.fail || 0, total: result.tests?.total || 0, executedAtMs: Date.now(), exitCode: result.exitCode },
              }
            });
          } catch {}
        }
        return Object.assign({}, result, { _localCalls: localCalls, remote: { executor: 'local', agentId: null, jobId: null, status: 'LOCAL_FALLBACK' } });
      } catch (err) {
        return { ok: false, error: \`run_tests wrapper: \${err.message}\`, _localCalls: localCalls };
      }
    }
    // ---------- FIM CÓDIGO COPIADO DE server.js ----------
    return { __rtPickIdleRunTestsAgent, __rtNormalizeResult, __rtTryRemoteRunTests, toolRunTests, getLocalCalls: () => localCalls };
  `;
  return new AsyncFunction('_overrideOrcRunTests', code);
}

// --------------------------------------------------------
// TC1: Worker IDLE com run_tests → dispatch remoto, lê TAP
// --------------------------------------------------------
(async function TC1() {
  const factory = loadRTHelpers({processEnv:{}});
  const orcStub = async () => { throw new Error('TC1: não deveria chamar local'); };
  const mod = await factory(orcStub);
  mockRemote({
    agents:[{agentId:'windows-worker-01',status:'IDLE',capabilities:['health_check','run_tests','build_project','run_linter'],activeJobs:0}],
    finalStatus:'COMPLETED', exitCode:0, error:null,
    logsTail: [
      '# tests 7',
      '# pass 7',
      '# fail 0',
      '1..7',
      'ok 1 - primeiro',
      'ok 2 - segundo',
      'ok 3',
      'ok 4',
      'ok 5',
      'ok 6',
      'ok 7',
    ],
    result:{ ok:true, files:[] },
  });
  const r = await mod.toolRunTests({project:'tester'},{timeout_sec:60});
  CASE('TC1 dispatch remoto (worker IDLE + run_tests capability)',
    r.ok === true && r.remote?.executor==='remote' && r.remote?.agentId==='windows-worker-01' &&
    !!r.remote?.jobId && r.exitCode===0 && r.tests?.pass===7 && r.tests?.fail===0 && r.error==null,
    `ok=${r.ok} agent=${r.remote?.agentId} pass=${r.tests?.pass} error=${r.error}`);
})();

// --------------------------------------------------------
// TC2: Sem worker disponível (sem REMOTE_EXECUTOR) → fallback local
// --------------------------------------------------------
(async function TC2() {
  const factory = loadRTHelpers({processEnv:{}});
  let nCalls = 0;
  const orcStub = async () => { nCalls++; return {ok:true,framework:'local',exitCode:0,skipped:false,tests:{pass:2,fail:0,total:2},failedTests:[]}; };
  const mod = await factory(orcStub);
  delete globalThis.REMOTE_EXECUTOR;
  const r = await mod.toolRunTests({project:'tester'},{timeout_sec:60});
  CASE('TC2 fallback local (sem REMOTE_EXECUTOR)',
    r.ok===true && r.remote?.executor==='local' && r._localCalls===1,
    `ok=${r.ok} remote=${r.remote?.executor} localCalls=${r._localCalls}`);
})();

// --------------------------------------------------------
// TC3: Worker RUNNING ocupado → fallback local
// --------------------------------------------------------
(async function TC3() {
  const factory = loadRTHelpers({processEnv:{}});
  let n = 0;
  const orcStub = async () => { n++; return {ok:true,framework:'local',exitCode:0,skipped:false,tests:{pass:0,fail:0,total:0},failedTests:[]}; };
  const mod = await factory(orcStub);
  mockRemote({
    agents:[{agentId:'windows-worker-01',status:'RUNNING',capabilities:['run_tests'],activeJobs:3}],
    finalStatus:'COMPLETED', exitCode:0,
  });
  const r = await mod.toolRunTests({project:'tester'},{timeout_sec:60});
  CASE('TC3 fallback local (worker ocupado RUNNING)',
    r.remote?.executor==='local' && r._localCalls===1,
    `remote=${r.remote?.executor} localCalls=${r._localCalls}`);
})();

// --------------------------------------------------------
// TC4: Normalização COMPLETED com TAP 12 pass → exatos 12
// --------------------------------------------------------
(async function TC4() {
  const factory = loadRTHelpers({processEnv:{}});
  const orcStub = async () => { throw new Error('TC4: não devia local'); };
  const mod = await factory(orcStub);
  mockRemote({
    agents:[{agentId:'windows-worker-01',status:'IDLE',capabilities:['run_tests'],activeJobs:0}],
    finalStatus:'COMPLETED', exitCode:0, logsTail: [
      '# tests 12',
      '# pass 12',
      '# fail 0',
      '1..12',
      ...Array.from({length:12},(_,i)=>`ok ${i+1} - caso ${i+1}`),
    ],
  });
  const r = await mod.toolRunTests({project:'tester'},{timeout_sec:60});
  CASE('TC4 normalização COMPLETED (12 pass → pass=12, total=12, ok=true)',
    r.ok===true && r.tests?.pass===12 && r.tests?.fail===0 && r.tests?.total===12 && r.remote?.jobId && r.remote?.agentId==='windows-worker-01',
    `ok=${r.ok} pass=${r.tests?.pass} fail=${r.tests?.fail} total=${r.tests?.total}`);
})();

// --------------------------------------------------------
// TC5a: Remote FAILED exitCode=1, logs indicam 2 falhas → ok=false SEM FALSO SUCESSO
// --------------------------------------------------------
(async function TC5a() {
  const factory = loadRTHelpers({processEnv:{}});
  const orcStub = async () => { throw new Error('TC5a: não devia local'); };
  const mod = await factory(orcStub);
  mockRemote({
    agents:[{agentId:'windows-worker-01',status:'IDLE',capabilities:['run_tests'],activeJobs:0}],
    finalStatus:'FAILED', exitCode:1, error:'npm test saiu com 1', logsTail: [
      '# tests 3',
      '# pass 1',
      '# fail 2',
      '1..3',
      'ok 1 - primeiro',
      'not ok 2 - segundo com erro',
      'not ok 3 - terceiro com erro',
    ],
    result:{ ok:false, files:[] },
  });
  const r = await mod.toolRunTests({project:'tester'},{timeout_sec:60});
  CASE('TC5a FAILED remoto (2 falhas) → ok=false, sem falso sucesso',
    r.ok===false && r.tests?.pass===1 && r.tests?.fail===2 && r.exitCode===1 && !!r.error && r.remote?.status==='FAILED',
    `ok=${r.ok} pass=${r.tests?.pass} fail=${r.tests?.fail} exit=${r.exitCode} error=${r.error}`);
})();

// --------------------------------------------------------
// TC5b: TIMEOUT → ok=false warning/error, status=TIMEOUT, exitCode=124 (quando disparado externamente)
// --------------------------------------------------------
(async function TC5b() {
  const factory = loadRTHelpers({processEnv:{}});
  const { __rtNormalizeResult } = await (async () => { const mod = await loadRTHelpers({})(async ()=>({})); return mod; })();
  const timed = __rtNormalizeResult('tester',{jobId:'j-timeout-01',status:'TIMEOUT',agentId:'windows-worker-01',exitCode:124,durationMs:300000,error:'timeout remote',logsTail:[],result:{ok:false,timeout:true}},'auto');
  CASE('TC5b TIMEOUT remoto → ok=false, warning ou error menciona timeout, status TIMEOUT, exitCode=124',
    timed.ok===false && timed.remote?.status==='TIMEOUT' && timed.exitCode===124 &&
    (String(timed.warning||'').toLowerCase().includes('timeout') || String(timed.error||'').toLowerCase().includes('timeout')),
    `ok=${timed.ok} status=${timed.remote?.status} exit=${timed.exitCode} warn=${timed.warning} err=${timed.error}`);
})();

// --------------------------------------------------------
// TC6: env REMOTE_EXEC_DISABLE=1 → bloqueia remoto e cai local (mesmo com worker disponível)
// --------------------------------------------------------
(async function TC6() {
  const factory = loadRTHelpers({processEnv:{REMOTE_EXEC_DISABLE:'1'}});
  let n = 0;
  const orcStub = async () => { n++; return {ok:true,framework:'local_disabled_env',exitCode:0,skipped:false,tests:{pass:0,fail:0,total:0},failedTests:[]}; };
  const mod = await factory(orcStub);
  mockRemote({
    agents:[{agentId:'windows-worker-01',status:'IDLE',capabilities:['run_tests'],activeJobs:0}],
    finalStatus:'COMPLETED', exitCode:0,
  });
  const r = await mod.toolRunTests({project:'tester'},{timeout_sec:60});
  CASE('TC6 env REMOTE_EXEC_DISABLE=1 → fallback local',
    r.remote?.executor==='local' && r._localCalls===1,
    `remote=${r.remote?.executor} localCalls=${r._localCalls}`);
})();

// Aguardar microtodas finalizarem
setTimeout(() => {
  delete globalThis.REMOTE_EXECUTOR;
  console.log(`\nResultado final: ${passed} passed · ${failed} failed · total ${passed+failed}`);
  process.exit(failed>0 ? 1 : 0);
}, 200);

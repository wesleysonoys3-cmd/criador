import WebSocket from 'ws';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';

const WS_URL = 'ws://127.0.0.1:3000/ws';
const PROJECT = 'e2e_rc29_resilience_' + randomBytes(4).toString('hex');
const OBJECTIVE = 'Crie um pequeno sistema web com uma página inicial, um botão funcional e um teste automatizado que valide o funcionamento do botão. Execute os testes e confirme se o objetivo inteiro foi concluído.';
const TIMEOUT_MS = 300_000;
const OUT = '/tmp/tiagent_e2e_result.json';

console.log('PROJECT=', PROJECT);

const result = {
  project: PROJECT,
  objective: OBJECTIVE,
  startedAt: new Date().toISOString(),
  events: [],
  aiDeltaCount: 0,
  agentStates: [],
  filesCreated: [],
  tasks: { completed: 0, total: 0, ids: new Set() },
  testResults: [],
  objectiveVerified: null,
  lastVerificationReason: null,
  finalAgentState: null,
  finalError: null,
  finishedAt: null,
};

const ws = new WebSocket(WS_URL, { handshakeTimeout: 10_000 });
const killTimer = setTimeout(() => finish('TIMEOUT'), TIMEOUT_MS);
let done = false;
let sessionId = null;

function finish(reason) {
  if (done) return;
  done = true;
  clearTimeout(killTimer);
  result.finishedAt = new Date().toISOString();
  result.finishReason = reason;
  result.tasks.ids = Array.from(result.tasks.ids);
  try { ws.close(); } catch {}
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log('\n=== FINISH:', reason, '===');
  console.log('objectiveVerified =', result.objectiveVerified);
  console.log('tasks =', result.tasks.completed + '/' + result.tasks.total);
  console.log('OUT =', OUT);
  process.exit(0);
}

ws.on('open', () => {
  console.log('WS_OPEN');
  ws.send(JSON.stringify({ type: 'session:new', project: PROJECT }));
});

ws.on('error', (e) => {
  console.log('WS_ERROR', e.message);
  result.finalError = String(e?.message || e);
  finish('WS_ERROR');
});

ws.on('message', (raw) => {
  let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
  const t = msg.type || msg.event || 'unknown';
  if (t !== 'message:ai:delta') {
    result.events.push({ t, dataSnippet: JSON.stringify(msg).slice(0, 300) });
  }

  switch (t) {
    case 'session:ready':
      sessionId = msg.sessionId || msg.id;
      console.log('SESSION_READY sid=', sessionId);
      ws.send(JSON.stringify({ type: 'chat:send', text: OBJECTIVE, sessionId }));
      console.log('CHAT_SEND objective (len=' + OBJECTIVE.length + ')');
      break;
    case 'message:ai:delta':
      result.aiDeltaCount++;
      break;
    case 'agent:state': {
      const s = msg.state || msg;
      result.agentStates.push({
        state: s.state || s,
        taskId: msg.taskId || null,
        phase: msg.phase || null,
        at: new Date().toISOString(),
      });
      if (s?.state) result.finalAgentState = s.state;
      if (msg.objectiveVerified !== undefined) result.objectiveVerified = !!msg.objectiveVerified;
      if (msg.lastVerificationReason) result.lastVerificationReason = String(msg.lastVerificationReason);
      const taskId = msg.taskId;
      if (taskId) {
        if (!result.tasks.ids.has(taskId)) {
          result.tasks.ids.add(taskId);
          result.tasks.total++;
        }
        if (/^(done|completed|finished|verified|success)$/i.test(String(msg.state || ''))) {
          // nothing, count on agent:done
        }
      }
      break;
    }
    case 'agent:done': {
      const taskId = msg.taskId;
      if (taskId && result.tasks.ids.has(taskId)) {
        // count completed once per id: track via obj
        if (!msg._e2eCounted) {
          result.tasks.completed++;
          msg._e2eCounted = true;
        }
      }
      if (msg.objectiveVerified !== undefined) result.objectiveVerified = !!msg.objectiveVerified;
      if (msg.lastVerificationReason) result.lastVerificationReason = String(msg.lastVerificationReason);
      if (msg.finalState) result.finalAgentState = String(msg.finalState);
      result.finalError = msg.error ? String(msg.error) : (result.finalError || null);
      break;
    }
    case 'error': {
      const err = msg.error || msg.message || String(msg);
      result.finalError = String(err).slice(0, 500);
      if (/all.*provider.*fail|todas.*tentativas|exceeded max/i.test(err)) {
        // keep going, can still recover on later iterations? no, per-task error means this task died.
      }
      break;
    }
    case 'agent:tool_call_result':
    case 'tool:result':
    case 'tool:call': {
      try {
        const str = JSON.stringify(msg);
        if (/created file|writeFile|arquivo criado|criando arquivo|salvo em/i.test(str)) {
          const m1 = str.match(/["']([^"']{3,120}\.(html|css|js|mjs|json|test\.(js|mjs)|spec\.(js|mjs)))["']/i);
          if (m1) result.filesCreated.push(m1[1]);
        }
        if (/test.*(pass|fail|result|execut|npx|mocha|jest|node .*test)/i.test(str)) {
          result.testResults.push({ snippet: str.slice(0, 400) });
        }
        if (/objectiveVerified|verificação objetiva|verificação de objetivo/i.test(str)) {
          const m2 = str.match(/objectiveVerified["']?\s*[:=]\s*(true|false)/i);
          if (m2) result.objectiveVerified = m2[1].toLowerCase() === 'true';
          const m3 = str.match(/lastVerificationReason["']?\s*[:=]\s*["']([^"']{1,300})/);
          if (m3) result.lastVerificationReason = m3[1];
        }
      } catch {}
      break;
    }
    default:
      try {
        const str = JSON.stringify(msg);
        if (/objectiveVerified/i.test(str)) {
          const m2 = str.match(/objectiveVerified["']?\s*[:=]\s*(true|false)/i);
          if (m2) result.objectiveVerified = m2[1].toLowerCase() === 'true';
        }
        if (/lastVerificationReason/i.test(str)) {
          const m3 = str.match(/lastVerificationReason["']?\s*[:=]\s*["']([^"']{1,300})/);
          if (m3) result.lastVerificationReason = m3[1];
        }
      } catch {}
      break;
  }

  if (result.objectiveVerified === true && !done) {
    setTimeout(() => finish('OBJECTIVE_VERIFIED_TRUE'), 3000);
  }
});

ws.on('close', (code, reason) => {
  console.log('WS_CLOSE code=', code, 'reason=', String(reason || ''));
  if (!done) finish('WS_CLOSE');
});

process.on('uncaughtException', (e) => {
  result.finalError = 'uncaught: ' + String(e?.message || e);
  finish('UNCAUGHT');
});

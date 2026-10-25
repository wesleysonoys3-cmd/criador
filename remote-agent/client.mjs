// remote-agent/client.mjs · Conexão Gateway + heartbeat + reconexão exponencial
// Responsável por: conectar, autenticar, registrar capabilities/resources,
//                  receber jobs do gateway, despachar p/ jobs.mjs, enviar progresso/resultado/logs.

import { WebSocket } from 'ws';
import { setTimeout as wait } from 'node:timers/promises';
import { CONFIG, sanitizeSecrets } from './config.mjs';
import { detectResources, workerStatus } from './resources.mjs';
import { CAPABILITIES } from './executor.mjs';
import { dispatchJob, cancelJob, getJob } from './jobs.mjs';

// =================================================================
// SINGLETON MODULE-LEVEL (FORA de createRemoteAgentClient).
// Esta é a FONTE DA VERDADE ÚNICA para TODO o processo Node.
// Mesmo que alguém crie 2+ instâncias de createRemoteAgentClient,
// ou que o mesmo closure tenha chamadas duplicadas, NÓS GARANTIMOS
// no momento EXATO de instanciar o WebSocket que só exista 1 ativo.
// =================================================================
const MODULE_SINGLETON = Object.seal({
  activeWs: null,
  activeConnId: 0,
  inFlightConnectOnce: false,
  reconnectTimer: null,
});
function _singletonClearReconnectTimer() {
  if (MODULE_SINGLETON.reconnectTimer) {
    clearTimeout(MODULE_SINGLETON.reconnectTimer);
    MODULE_SINGLETON.reconnectTimer = null;
  }
}
function _singletonIsActiveReady() {
  const a = MODULE_SINGLETON.activeWs;
  if (!a) return false;
  return a.readyState === 0 || a.readyState === 1;
}

export function createRemoteAgentClient(opts = {}) {
  const override = opts.overrideConfig || {};
  const runtimeCfg = Object.freeze({
    gatewayUrl:          typeof override.gatewayUrl === 'string' ? override.gatewayUrl : CONFIG.gatewayUrl,
    agentId:             typeof override.agentId === 'string' ? override.agentId : CONFIG.agentId,
    agentToken:          typeof override.agentToken === 'string' ? override.agentToken : CONFIG.agentToken,
    heartbeatIntervalMs: Number.isFinite(override.heartbeatIntervalMs) ? override.heartbeatIntervalMs : CONFIG.heartbeatIntervalMs,
    reconnectBaseMs:     Number.isFinite(override.reconnectBaseMs) ? override.reconnectBaseMs : CONFIG.reconnectBaseMs,
    reconnectMaxMs:      Number.isFinite(override.reconnectMaxMs) ? override.reconnectMaxMs : CONFIG.reconnectMaxMs,
    maxJobTimeoutMs:     CONFIG.maxJobTimeoutMs,
    maxMemoryMb:         CONFIG.maxMemoryMb,
    nodeBin:             CONFIG.nodeBin,
    workspaceRoot:       typeof override.workspaceRoot === 'string' ? override.workspaceRoot : CONFIG.workspaceRoot,
    allowedCapabilities: CONFIG.allowedCapabilities,
    allowedWorkspaces:   CONFIG.allowedWorkspaces,
    logLevel:            CONFIG.logLevel,
  });
  let ws = null;
  let closing = false;
  let heartbeatTimer = null;
  let reconnectDelayMs = runtimeCfg.reconnectBaseMs;
  let runningJobs = 0;
  let _connSeq = 0;
  let _startSeq = 0;
  let _loopSeq = 0;

  function send(type, payload = {}, opts = {}) {
    if (!ws || ws.readyState !== 1) return false;
    try {
      const safe = opts.skipSanitize === true ? payload : sanitizeSecrets(payload);
      ws.send(JSON.stringify({ type, data: safe, ts: Date.now() }));
      return true;
    } catch { return false; }
  }

  function doAuth() {
    // auth NÃO passa por sanitize (precisa enviar token real p/ o gateway validar)
    return send('ra:auth', {
      agentId:   runtimeCfg.agentId,
      token:     runtimeCfg.agentToken,
      version:   '1.0.0',
      node:      process.versions.node,
    }, { skipSanitize: true });
  }
  function doAnnounce() {
    return send('ra:announce', {
      agentId:       runtimeCfg.agentId,
      capabilities:  CAPABILITIES.slice(),
      resources:     detectResources(),
      status:        workerStatus(runningJobs),
      activeJobs:    runningJobs,
    });
  }
  function doHeartbeat() {
    return send('ra:heartbeat', {
      agentId:     runtimeCfg.agentId,
      status:      workerStatus(runningJobs),
      activeJobs:  runningJobs,
      resources:   detectResources(),
    });
  }

  function setupTimers() {
    if (heartbeatTimer) console.log(`[ra.client][diag] setupTimers() · limpa heartbeat anterior (${heartbeatTimer ? 'sim' : 'não'}). Próximo heartbeat em ${runtimeCfg.heartbeatIntervalMs}ms.`);
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === 1) {
        const sent = doHeartbeat();
        console.log(`[ra.client][diag] heartbeat · ts=${Date.now()} · enviado=${sent ? 'SIM (readyState=1 OK)' : 'NÃO (ws nulo ou readyState!==1)'}`);
      }
    }, runtimeCfg.heartbeatIntervalMs);
  }

  async function connectLoop() {
    const loopId = ++_loopSeq;
    if (loopId > 1 && !closing) {
      console.log(`[ra.client][diag] connectLoop(${loopId}) ABORTADO · loop duplicado detectado. Usa singleton para bloqueio.`);
      return;
    }
    console.log(`[ra.client][diag] connectLoop iniciando · loopId=${loopId} · closing=${closing} · agentId=${runtimeCfg.agentId}`);
    let iterCount = 0;
    while (!closing) {
      iterCount++;
      try {
        // -----------------------------------------------------------------
        // PONTO ÚNICO de garantia: antes de chamar connectOnce, verificamos
        // o singleton module-level. Se já houver ws ativo (OPEN/CONNECTING),
        // NÃO criamos outra conexão. Esperamos passivamente até close/error.
        // Esta é a trava final NÃO-DERROTÁVEL por múltiplas instâncias.
        // -----------------------------------------------------------------
        if (_singletonIsActiveReady()) {
          const s = MODULE_SINGLETON.activeWs;
          const rsName = ['CONNECTING','OPEN','CLOSING','CLOSED'][s.readyState] || '?';
          console.log(`[ra.client][diag] connectLoop(${loopId}) iteração #${iterCount} · 🟢 SINGLETON já tem conexão ativa activeConnId=${MODULE_SINGLETON.activeConnId} readyState=${s.readyState} (${rsName}). NÃO faremos nova conexão. Esperando close/error real.`);
          // Espera passiva (não busy-loop). Quando a conexão singleton fechar,
          // a próxima iteração vai falhar neste if e reconectar.
          await wait(Math.min(3000, reconnectDelayMs));
          continue;
        }

        console.log(`[ra.client][diag] connectLoop(${loopId}) iteração #${iterCount} VAI CHAMAR connectOnce() · reconnectDelayMs=${reconnectDelayMs} · singletonIsActiveReady=${_singletonIsActiveReady()}`);
        await connectOnce();
        console.log(`[ra.client][diag] connectLoop(${loopId}) iteração #${iterCount} · connectOnce() resolveu. singletonIsActiveReady agora=${_singletonIsActiveReady()}`);
      } catch (err) {
        console.log('[ra.client] conexão falhou / perdida: ' + String(err && err.message || err));
        console.log(`[ra.client][diag] connectLoop(${loopId}) iteração #${iterCount} · 🔴 connectOnce() REJEITOU com erro: ${String(err && err.message || err)} · stack=${err && err.stack ? String(err.stack).slice(0,500) : 'n/a'}`);
      }
      if (closing) { console.log(`[ra.client][diag] connectLoop(${loopId}) iteração #${iterCount} · closing=true — saindo do loop.`); break; }

      // Se a conexão singleton ainda estiver ativa, não agenda reconnect.
      if (_singletonIsActiveReady()) {
        console.log(`[ra.client][diag] connectLoop(${loopId}) iteração #${iterCount} · 🟢 SINGLETON ativo após iteração. PULA reconnect delay.`);
        continue;
      }

      console.log(`[ra.client][diag] connectLoop(${loopId}) iteração #${iterCount} · aguardando ${reconnectDelayMs}ms para UMA tentativa de reconnect. singletonIsActiveReady=${_singletonIsActiveReady()}`);
      // Garante UMA só tentativa via singleton reconnectTimer. Se o timer
      // já existia de outra instância/loop, limpa para não acumular.
      _singletonClearReconnectTimer();
      await new Promise((res) => {
        MODULE_SINGLETON.reconnectTimer = setTimeout(() => {
          MODULE_SINGLETON.reconnectTimer = null;
          res();
        }, reconnectDelayMs);
      });
      reconnectDelayMs = Math.min(runtimeCfg.reconnectMaxMs, reconnectDelayMs * 2);
    }
    console.log(`[ra.client][diag] connectLoop(${loopId}) · loop encerrado após ${iterCount} iterações.`);
  }

  function connectOnce() {
    // GUARDA singleton: se outra instância já tem connectOnce em andamento, saia.
    if (MODULE_SINGLETON.inFlightConnectOnce) {
      console.log(`[ra.client][diag] connectOnce() IGNORADO · MODULE_SINGLETON.inFlightConnectOnce=true (outra instância já tenta conectar).`);
      return Promise.resolve();
    }
    // GUARDA singleton: se o singleton já tem ws OPEN/CONNECTING, não cria outro.
    if (_singletonIsActiveReady()) {
      const s = MODULE_SINGLETON.activeWs;
      const rsName = ['CONNECTING','OPEN','CLOSING','CLOSED'][s.readyState] || '?';
      console.log(`[ra.client][diag] connectOnce() IGNORADO · SINGLETON activeConnId=${MODULE_SINGLETON.activeConnId} readyState=${s.readyState} (${rsName}). Nenhuma nova conexão aberta.`);
      return Promise.resolve();
    }
    MODULE_SINGLETON.inFlightConnectOnce = true;

    const connId = ++_connSeq;
    // Se já existia um activeWs fechado/órfão, e a Guarda singleton passou,
    // significa que readyState não era 0/1. Limpa listeners por segurança.
    if (MODULE_SINGLETON.activeWs) {
      try { MODULE_SINGLETON.activeWs.removeAllListeners && MODULE_SINGLETON.activeWs.removeAllListeners(); } catch {}
      try { MODULE_SINGLETON.activeWs.close(); } catch {}
    }

    const callerStack = (new Error(`connectOnce caller stack (connId=${connId})`)).stack || '';
    console.log(`[ra.client][diag] connectOnce() chamado · connId=${connId} · ts=${Date.now()} · url=${runtimeCfg.gatewayUrl}`);
    console.log(`[ra.client][diag] connectOnce(${connId}) · origem da chamada (stack curta):\n${callerStack.split('\n').slice(1,5).map(s=>'      '+s).join('\n')}`);

    return new Promise((resolve, reject) => {
      let settled = false;
      let authenticated = false;
      let localWs = null;
      const settleReject = (e) => {
        if (settled) return;
        settled = true;
        // LIBERA singleton SOMENTE SE esta conexão AINDA é a que está registrada.
        // Se outra conexão tomou o singleton (impossível pelas guardas, mas por segurança),
        // não limpamos a outra.
        if (localWs && MODULE_SINGLETON.activeWs === localWs) {
          MODULE_SINGLETON.activeWs = null;
          MODULE_SINGLETON.activeConnId = 0;
        }
        MODULE_SINGLETON.inFlightConnectOnce = false;
        try { clearInterval(heartbeatTimer); } catch {}
        reject(e);
      };

      console.log('[ra.client] conectando em ' + runtimeCfg.gatewayUrl);
      try {
        localWs = new WebSocket(runtimeCfg.gatewayUrl);
        // REGISTRO SINGLETON NO MESMO INSTANTE DO CONSTRUTOR.
        // A PARTIR DAQUI, QUALQUER outra chamada (mesmo que multipla instância)
        // vai bater na Guarda singletonIsActiveReady e NÃO criará novo socket.
        MODULE_SINGLETON.activeWs = localWs;
        MODULE_SINGLETON.activeConnId = connId;
        ws = localWs;
      } catch (err) {
        console.log(`[ra.client][diag] connectOnce(${connId}) · Erro new WebSocket (construtor lançou): ${String(err && err.message || err)}`);
        MODULE_SINGLETON.inFlightConnectOnce = false;
        return reject(err);
      }

      const authTimeout = setTimeout(() => {
        if (!authenticated) {
          console.log(`[ra.client][diag] connectOnce(${connId}) · ⏰ gw:auth_timeout · 10s sem gw:auth_ok após open.`);
          settleReject(new Error('gw:auth_timeout'));
        }
      }, 10000);

      localWs.once('error', (err) => {
        console.log(`[ra.client][diag] connectOnce(${connId}) · ⚠️ ws event: ERROR · mensagem=${String(err && err.message || err)} · wasAuthenticated=${authenticated ? 'SIM' : 'NÃO'}`);
        settleReject(err);
      });

      localWs.once('close', (code, reasonBuf) => {
        const reason = (reasonBuf && typeof reasonBuf.toString === 'function') ? reasonBuf.toString('utf8') : (typeof reasonBuf === 'string' ? reasonBuf : '');
        console.log(`[ra.client][diag] connectOnce(${connId}) · 🚪 ws event: CLOSE · code=${code === undefined ? 'undefined' : code} · reason="${reason}" · wasAuthenticated=${authenticated ? 'SIM' : 'NÃO'} · settled=${settled ? 'SIM' : 'NÃO (libera singleton e reconecta)'}`);
        settleReject(new Error('ws close code=' + (code === undefined ? 'undefined' : String(code)) + ' reason="' + reason + '"'));
      });

      localWs.once('open', () => {
        console.log(`[ra.client][diag] connectOnce(${connId}) · 🟢 ws event: OPEN · pronto para enviar ra:auth`);
        const onAuth = (raw) => {
          try {
            const m = JSON.parse(raw.toString());
            if (m.type === 'gw:auth_ok') {
              clearTimeout(authTimeout);
              localWs.removeListener('message', onAuth);
              authenticated = true;
              const serverAgentId = m.data && m.data.agentId ? String(m.data.agentId) : 'n/a';
              console.log(`[ra.client][diag] connectOnce(${connId}) · ✅ AUTHENTICATED (gw:auth_ok) · serverAgentId=${serverAgentId} · Promise connectOnce continua PENDENTE até close/error. singleton ativo agora é este connId=${connId}.`);
              reconnectDelayMs = runtimeCfg.reconnectBaseMs;
              setupTimers();
              doAnnounce();
              emitEvent('connected', { agentId: runtimeCfg.agentId, connId, ts: Date.now() });
              // ⚠️ NÃO resolve() NEM reject() AQUI. Promise fica pendente.
              // Quando a conexão fechar, o once('close') acima chama settleReject()
              // → libera singleton → loop aguarda delay → reconecta UMA vez.
            } else if (m.type === 'gw:auth_fail') {
              clearTimeout(authTimeout);
              localWs.removeListener('message', onAuth);
              const reason = m.data && m.data.reason ? String(m.data.reason) : '';
              console.log(`[ra.client][diag] connectOnce(${connId}) · ❌ AUTH_FAILED (gw:auth_fail) · reason="${reason}"`);
              try { localWs.close(); } catch {}
              settleReject(new Error('gw:auth_fail: ' + reason));
            } else {
              console.log(`[ra.client][diag] connectOnce(${connId}) · onAuth ignora msg type=${m.type}`);
            }
          } catch (e) {
            console.log(`[ra.client][diag] connectOnce(${connId}) · onAuth JSON/catch: ${String(e && e.message || e)}`);
          }
        };
        localWs.on('message', onAuth);
        doAuth();
      });

      localWs.on('message', (raw) => {
        try {
          const m = JSON.parse(raw.toString());
          if (m && typeof m.type === 'string') {
            console.log(`[ra.client][diag] connId=${connId} · 📥 msg type=${m.type}`);
          }
        } catch {}
      });
      localWs.on('message', onMessage);
    });
  }

  async function onMessage(raw) {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    const data = m.data || {};
    switch (m.type) {
      case 'gw:ping':
        send('ra:pong', { agentId: runtimeCfg.agentId, serverTs: data.ts || null });
        break;
      case 'gw:job_assign':
        handleJobAssign(data);
        break;
      case 'gw:job_cancel':
        handleJobCancel(data);
        break;
      case 'gw:resource_request':
        send('ra:resource_update', { agentId: runtimeCfg.agentId, resources: detectResources() });
        break;
      case 'gw:capabilities_request':
        send('ra:capabilities_update', { agentId: runtimeCfg.agentId, capabilities: CAPABILITIES.slice() });
        break;
      // Não tratamos outros tipos por segurança.
    }
  }

  async function handleJobAssign(job) {
    if (!job || typeof job.jobId !== 'string') return;
    runningJobs++;
    send('ra:job_accepted', { jobId: job.jobId, agentId: runtimeCfg.agentId, ts: Date.now() });
    const res = await dispatchJob(job, {
      sendProgress: (jobId, pct, status, note) =>
        send('ra:job_progress', { jobId, agentId: runtimeCfg.agentId, progressPct: pct, status, note }),
      sendResult: (jobId, status, err, state) => {
        runningJobs = Math.max(0, runningJobs - 1);
        const safe = {
          jobId, agentId: runtimeCfg.agentId, status,
          progressPct: state ? state.progressPct : 0,
          exitCode: state ? state.exitCode : null,
          durationMs: state ? state.durationMs : null,
          filesModified: state ? (state.filesModified || []) : [],
          result: state ? state.result : null,
          error: err ? String(err).slice(0, 2000) : null,
          summary: state && state.logs ? lastLogs(state.logs, 60) : [],
        };
        send('ra:job_result', safe);
      },
      sendLog: (jobId, stream, text) =>
        send('ra:job_log', { jobId, agentId: runtimeCfg.agentId, stream, text: String(text || '').slice(0, 4000) }),
    });
    if (res && !res.ok) {
      runningJobs = Math.max(0, runningJobs - 1);
      send('ra:job_result', {
        jobId: job.jobId, agentId: runtimeCfg.agentId,
        status: res.status && res.status.status || 'FAILED',
        error: res.reason, summary: [],
      });
    }
  }

  function handleJobCancel(data) {
    if (!data || typeof data.jobId !== 'string') return;
    const r = cancelJob(data.jobId);
    send('ra:job_cancelled_ack', {
      jobId: data.jobId, agentId: runtimeCfg.agentId, ok: !!r.ok,
      reason: r.reason || null,
      status: r.status && r.status.status || null,
    });
  }

  function lastLogs(logs, n = 50) {
    if (!Array.isArray(logs)) return [];
    return logs.slice(-n).map(l => ({ ts: l.ts, stream: l.stream, text: String(l.text || '').slice(0, 500) }));
  }

  // Event bus leve interno (não exporta EventEmitter p/ manter leveza)
  const listeners = new Map();
  function emitEvent(name, payload) { const arr = listeners.get(name); if (arr) arr.forEach(fn => { try { fn(payload); } catch {} }); }
  function onEvent(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); }

  function start() {
    const startId = ++_startSeq;
    const startStack = (new Error(`start() caller stack (startId=${startId})`)).stack || '';
    console.log(`[ra.client][diag] start() chamado · startId=${startId} · ts=${Date.now()} · closing anterior=${closing} · chamadas start() já feitas=${_startSeq}`);
    console.log(`[ra.client][diag] start(${startId}) · stack curta:\n${startStack.split('\n').slice(1,5).map(s=>'      '+s).join('\n')}`);
    // GUARDA singleton: se já há conexão ativa e loop rodando, noop.
    if (_loopSeq > 0 && !closing && _singletonIsActiveReady()) {
      console.log(`[ra.client][diag] start(${startId}) IGNORADO · SINGLETON já tem ws ativo activeConnId=${MODULE_SINGLETON.activeConnId}. Operação noop.`);
      return { stop };
    }
    closing = false;
    // Cancela reconnect timer singleton pendente para não haver timers duplos.
    _singletonClearReconnectTimer();
    connectLoop().catch((e) => { console.log(`[ra.client][diag] start(${startId}) · connectLoop.catch: ${String(e && e.message || e)}`); });
    return { stop };
  }
  function stop()  {
    console.log(`[ra.client][diag] stop() chamado · ts=${Date.now()} · closing passando de ${closing}→true · singleton.activeConnId=${MODULE_SINGLETON.activeConnId} · singleton.reconnectTimer=${MODULE_SINGLETON.reconnectTimer?'sim':'não'}`);
    closing = true;
    _singletonClearReconnectTimer();
    try {
      const active = MODULE_SINGLETON.activeWs;
      if (active) active.close();
    } catch {}
    try { if (ws) ws.close(); } catch {};
    clearInterval(heartbeatTimer);
  }

  function getInternalState() {
    return {
      connected: !!(ws && ws.readyState === 1),
      readyState: ws ? ws.readyState : 0,
      agentId: runtimeCfg.agentId,
      runningJobs,
      capabilities: CAPABILITIES.slice(),
      reconnectDelayMs,
      heartbeatIntervalMs: runtimeCfg.heartbeatIntervalMs,
    };
  }

  return Object.freeze({ start, stop, on: onEvent, getInternalState,
    _dispatchJob: (job) => handleJobAssign(job),
    _cancelJob: (d) => handleJobCancel(d),
    _getJob: getJob,
  });
}

export default { createRemoteAgentClient };

// remote-agent/config.mjs · Configuração segura via variáveis de ambiente
// NÃO há secrets hardcoded. Tudo via process.env.
import os from 'node:os';

const env = (k, fallback = '') => {
  const v = (typeof process !== 'undefined' && process && process.env) ? process.env[k] : null;
  return (typeof v === 'string' && v.length > 0) ? v : fallback;
};

export const CONFIG = Object.freeze({
  gatewayUrl:            env('REMOTE_GATEWAY_URL', 'ws://127.0.0.1:3000/gw'),
  agentId:               env('REMOTE_AGENT_ID',   ('agent-' + (Math.random().toString(36).slice(2, 10)))),
  agentToken:            env('REMOTE_GATEWAY_TOKEN', env('REMOTE_AGENT_TOKEN', '')),
  heartbeatIntervalMs:   Number(env('REMOTE_HEARTBEAT_MS', '15000')) || 15000,
  reconnectBaseMs:       Number(env('REMOTE_RECONNECT_BASE_MS', '1000')) || 1000,
  reconnectMaxMs:        Number(env('REMOTE_RECONNECT_MAX_MS',  '60000')) || 60000,
  // Isolamento forte: o agente SÓ pode operar DENTRO desta pasta raiz
  workspaceRoot:         env('REMOTE_WORKSPACE_ROOT',
                             (typeof process !== 'undefined' ? process.cwd() : '.') + '/remote-workspace'),
  // Policy allowlist de capabilities e workspaces autorizados
  allowedCapabilities:   new Set(env('REMOTE_ALLOWED_CAPS', 'run_tests,build_project,run_linter,health_check')
                                    .split(',').map(s => s.trim()).filter(Boolean)),
  allowedWorkspaces:     new Set(env('REMOTE_ALLOWED_WORKSPACES', 'tester,default').split(',').map(s => s.trim()).filter(Boolean)),
  // Limites padrão (valores mínimos de segurança; Gateway pode reduzir, nunca aumentar)
  maxJobTimeoutMs:       Number(env('REMOTE_MAX_TIMEOUT_MS', String(15 * 60 * 1000))) || (15 * 60 * 1000),
  maxMemoryMb:           Number(env('REMOTE_MAX_MEMORY_MB', '4096')) || 4096,
  maxCpuCores:           Number(env('REMOTE_MAX_CPU_CORES', String(os.cpus ? os.cpus().length : 0))) || 0,
  nodeBin:               env('REMOTE_NODE_BIN', process.argv0 || 'node'),
  logLevel:              env('REMOTE_LOG_LEVEL', 'info'),
});

export function sanitizeSecrets(obj, redact = '***') {
  if (!obj || typeof obj !== 'object') return obj;
  const SENSITIVE = new Set([
    'token','apikey','api_key','secret','password','passwd','pwd','authorization',
    'cookie','session','jwt','privatekey','private_key','access_token','refresh_token',
    'gatewaytoken','gateway_token','agenttoken','agent_token'
  ]);
  const clone = Array.isArray(obj) ? obj.slice() : { ...obj };
  for (const k of Object.keys(clone)) {
    if (typeof clone[k] === 'string' && SENSITIVE.has(String(k).toLowerCase())) {
      clone[k] = redact;
    } else if (clone[k] && typeof clone[k] === 'object') {
      clone[k] = sanitizeSecrets(clone[k], redact);
    }
  }
  return clone;
}

export default CONFIG;

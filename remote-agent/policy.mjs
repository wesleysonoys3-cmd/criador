// remote-agent/policy.mjs · Validação jobs SEMPRE ANTES de execução
// Retorna { ok:true } ou { ok:false, reason:string }

import { CONFIG } from './config.mjs';
import { resolveSafeWorkspace } from './sandbox.mjs';
import { detectResources } from './resources.mjs';

export function validateJob(job) {
  if (!job || typeof job !== 'object') return fail('job inválido (não é objeto)');
  if (typeof job.jobId !== 'string' || !job.jobId.trim()) return fail('jobId ausente');
  if (typeof job.type  !== 'string' || !job.type.trim())  return fail('job.type ausente');
  if (!CONFIG.allowedCapabilities.has(job.type)) return fail(`job.type não autorizado pela allowlist: ${job.type}`);
  try { resolveSafeWorkspace(job.workspace || 'default'); }
  catch (e) { return fail(e.message || 'workspace inválido'); }
  // Limits sempre existem; não permitimos valores superiores aos TETOS do agente (hard cap).
  const limits = Object.assign({ timeoutMs: 5 * 60 * 1000, memoryMb: 1024, cpuCores: 1 }, job.limits || {});
  if (typeof limits.timeoutMs !== 'number' || limits.timeoutMs <= 0) return fail('limits.timeoutMs inválido');
  if (limits.timeoutMs > CONFIG.maxJobTimeoutMs) return fail('limits.timeoutMs excede máximo do agente (' + CONFIG.maxJobTimeoutMs + ')');
  if (typeof limits.memoryMb !== 'number' || limits.memoryMb <= 0) return fail('limits.memoryMb inválido');
  if (limits.memoryMb > CONFIG.maxMemoryMb) return fail('limits.memoryMb excede máximo do agente (' + CONFIG.maxMemoryMb + ')');
  // Verificação de recursos MOMENTÂNEOS é apenas SOFT WARN (não bloqueia):
  //  - Sistemas tipo macOS reportam freemem baixo por cache de arquivos;
  //  - O bloqueio real é apenas pelo CONFIG.maxMemoryMb (hard cap).
  //  Se availableMb < pedido E availableMb < 256MB (realmente baixo), bloqueia.
  //  Caso contrário, permite (o sistema operacional paginará cache se necessário).
  const res = detectResources();
  if (res.memory.availableMb != null &&
      Number(res.memory.availableMb) < 256 &&
      limits.memoryMb > Number(res.memory.availableMb)) {
    return fail('memória crítica: pedido=' + limits.memoryMb + 'MB disponível=' + res.memory.availableMb + 'MB');
  }
  return { ok: true, limits };
}

function fail(reason) { return { ok:false, reason }; }

// Sanitização de job antes de entrar no executor (remover secrets passados por engano)
export function prepareJob(job) {
  if (!job || typeof job !== 'object') return job;
  const clone = JSON.parse(JSON.stringify(job));
  for (const k of Object.keys(clone)) {
    const low = String(k).toLowerCase();
    if (low.includes('token') || low.includes('secret') || low.includes('password') || low.includes('apikey') || low.includes('cookie')) {
      delete clone[k];
    }
  }
  return clone;
}

export default { validateJob, prepareJob };

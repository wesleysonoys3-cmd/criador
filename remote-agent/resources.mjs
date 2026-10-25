// remote-agent/resources.mjs · Detecção CPU/RAM/armazenamento/GPU
// Não inventa dados: se a métrica não for detectável, retorna available=false / null.

import os from 'node:os';
import fs from 'node:fs';

function cpuUsageSnapshot() {
  const cpus = os.cpus();
  let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
  for (const cpu of cpus) {
    user += cpu.times.user; nice += cpu.times.nice; sys += cpu.times.sys;
    idle += cpu.times.idle; irq += cpu.times.irq;
  }
  return { user, nice, sys, idle, irq, total: user + nice + sys + idle + irq };
}

let prevSnapshot = cpuUsageSnapshot();

export function detectResources() {
  const now = cpuUsageSnapshot();
  const deltaTotal = now.total - prevSnapshot.total || 1;
  const deltaIdle  = now.idle  - prevSnapshot.idle;
  prevSnapshot = now;
  const usagePct = Math.max(0, Math.min(100, Math.round((1 - deltaIdle / deltaTotal) * 100)));
  const mem = {
    totalMb:     Math.round(os.totalmem() / (1024 * 1024)),
    availableMb: Math.round(os.freemem() / (1024 * 1024)),
  };
  // Armazenamento disponível: tenta ler tmpdir / cwd via statfs (se disponível)
  let storage = { availableMb: null, totalMb: null, mount: null };
  try {
    const statvfs = (fs.statvfsSync || fs.statfsSync);
    if (typeof statvfs === 'function') {
      const s = statvfs(os.tmpdir());
      storage = {
        mount: os.tmpdir(),
        totalMb:     Math.round((s.blocks    * s.bsize) / (1024 * 1024)),
        availableMb: Math.round((s.bavail    * s.bsize) / (1024 * 1024)),
      };
    }
  } catch { /* Node < 19 / sistema sem statfs: deixe null */ }
  // GPU: não detectamos automaticamente (evita bibliotecas / spawn nvidia-smi)
  // Mantemos available=false explicitamente para não fingir que temos.
  const gpu = {
    available: false,
    name:      null,
    vramMb:    null,
    note:      'Detecção automática de GPU não implementada na primeira versão.',
  };
  return {
    cpu: {
      cores:    os.cpus().length,
      model:    (os.cpus()[0] && os.cpus()[0].model) || null,
      usagePct,
      loadAvg:  os.loadavg ? os.loadavg().map(v => Math.round(v * 100) / 100) : null,
    },
    memory: mem,
    storage,
    gpu,
    platform: {
      os:       os.platform(),
      arch:     os.arch(),
      hostname: os.hostname(),
      node:     process.versions.node,
      uptimeSecs: Math.round(os.uptime()),
    },
  };
}

export function workerStatus(runningJobsCount = 0) {
  return runningJobsCount > 0 ? 'BUSY' : 'IDLE';
}

export default { detectResources, workerStatus };

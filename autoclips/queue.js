/* =========================================================
 * autoclips/queue.js — Fila de processamento assíncrona (7.8)
 * ---------------------------------------------------------
 * Processa as tarefas em sequência, uma por vez, reportando o
 * progresso. É resiliente: as tarefas em andamento são retomadas
 * após reinício do servidor, tentativas são limitadas e arquivos
 * parciais são removidos quando uma tarefa falha.
 * =======================================================*/
import fs from 'node:fs/promises';
import path from 'node:path';

const _log = (...a) => console.log('[AUTOCLIPS][queue]', ...a);

export const MAX_ATTEMPTS = 3;

class JobQueue {
  constructor() {
    this.pending = [];
    this.running = false;
    this.current = null;
    this.runner = null;      // async (jobId) => void  (implementado pelo service)
    this.dirFor = null;      // (jobId) => string  (pasta de saída, para limpeza)
    this._listeners = [];
  }

  init({ runner, dirFor = null } = {}) {
    if (typeof runner === 'function') this.runner = runner;
    if (typeof dirFor === 'function') this.dirFor = dirFor;
    return { ok: true };
  }

  onChange(fn) { if (typeof fn === 'function') this._listeners.push(fn); }
  _emit() { for (const fn of this._listeners) { try { fn(this.status()); } catch { /* ok */ } } }

  isQueued(id) { const s = String(id || ''); return this.current === s || this.pending.indexOf(s) >= 0; }

  enqueue(jobId) {
    const id = String(jobId || '');
    if (!id) return { ok: false, reason: 'Tarefa inválida.' };
    if (this.isQueued(id)) return { ok: true, alreadyQueued: true };
    this.pending.push(id);
    this._emit();
    this._kick();
    return { ok: true, position: this.pending.length };
  }

  /* Recoloca a tarefa na fila mesmo que ela seja a que está em execução
     (usado pela nova tentativa disparada pelo próprio runner). */
  requeue(jobId) {
    const id = String(jobId || '');
    if (!id) return { ok: false, reason: 'Tarefa inválida.' };
    if (this.pending.indexOf(id) >= 0) return { ok: true, alreadyQueued: true };
    this.pending.push(id);
    this._emit();
    this._kick();
    return { ok: true, position: this.pending.length };
  }

  cancel(jobId) {
    const id = String(jobId || '');
    const i = this.pending.indexOf(id);
    if (i >= 0) { this.pending.splice(i, 1); this._emit(); return { ok: true, cancelled: true }; }
    if (this.current === id) return { ok: false, reason: 'A tarefa já está em execução.' };
    return { ok: false, reason: 'A tarefa não está na fila.' };
  }

  /* Retoma tarefas pendentes após reinício (chamado pelo service.init). */
  resume(ids) {
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    let added = 0;
    for (const id of list) {
      const s = String(id);
      if (!this.isQueued(s)) { this.pending.push(s); added++; }
    }
    if (added) { _log('resume: ' + added + ' tarefa(s) retomada(s)'); this._emit(); this._kick(); }
    return { ok: true, resumed: added };
  }

  _kick() {
    if (this.running) return;
    if (!this.runner) return;
    this.running = true;
    this._loop();
  }

  async _loop() {
    while (this.pending.length) {
      const id = this.pending.shift();
      this.current = id;
      this._emit();
      try {
        await this.runner(id);
      } catch (e) {
        _log('erro ao processar ' + id + ': ' + String((e && e.message) || e));
        await this._cleanup(id);
      }
    }
    this.current = null;
    this.running = false;
    this._emit();
  }

  /* Remove arquivos parciais de uma tarefa que falhou. */
  async _cleanup(jobId) {
    if (!this.dirFor) return;
    let dir = null;
    try { dir = this.dirFor(jobId); } catch { dir = null; }
    if (!dir) return;
    try { await fs.rm(dir, { recursive: true, force: true }); _log('limpeza parcial: ' + path.basename(dir)); }
    catch { /* ok */ }
  }

  status() {
    return {
      ok: true,
      running: this.running,
      current: this.current,
      pending: this.pending.slice(),
      pendingCount: this.pending.length,
      maxAttempts: MAX_ATTEMPTS,
    };
  }
}

const queue = new JobQueue();
export default queue;

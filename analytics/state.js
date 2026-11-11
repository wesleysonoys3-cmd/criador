/* =========================================================
 * analytics/state.js — Persistência do Histórico/Analytics (PARTE 9)
 * ---------------------------------------------------------
 * Cache das estatísticas oficiais dos vídeos publicados + um
 * histórico de medições (série temporal) para acompanhar a evolução.
 * Um único arquivo de cache (an_metrics.json) e um log de medições
 * (an_history.jsonl), com escrita atômica e serializada — sem banco.
 * =======================================================*/
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCHEMA = 'analytics_v1';
export const MAX_SNAPSHOTS = 3000;

const _log = (...a) => console.log('[ANALYTICS][state]', ...a);

class AnalyticsState {
  constructor() {
    this.dataDir = path.resolve(process.cwd(), 'analytics/data');
    this.metrics = new Map();   // videoId -> { videoId, views, likes, comments, fetchedAt, ... }
    this.snapshots = [];        // [{ at, videoId, views, likes, comments }]
    this._chain = Promise.resolve();
  }

  setDataDir(dir) { if (dir) this.dataDir = dir; }
  metricsPath() { return path.join(this.dataDir, 'an_metrics.json'); }
  historyPath() { return path.join(this.dataDir, 'an_history.jsonl'); }

  async _ensureDir() { try { await fs.mkdir(this.dataDir, { recursive: true }); } catch { /* ok */ } }

  _enqueueWrite(fn) {
    const run = this._chain.then(fn, fn);
    this._chain = run.catch(() => {});
    return run;
  }

  async _writeJson(target, obj) {
    await this._ensureDir();
    const snapshot = JSON.stringify(obj, null, 2);
    return this._enqueueWrite(async () => {
      const tmp = target + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, target);
      return true;
    });
  }

  async loadAll() {
    await this._ensureDir();
    this.metrics.clear();

    try {
      const raw = JSON.parse(await fs.readFile(this.metricsPath(), 'utf8'));
      const vids = (raw && raw.videos) || {};
      for (const k of Object.keys(vids)) this.metrics.set(k, vids[k]);
    } catch { /* ainda não há cache */ }

    try {
      const raw = await fs.readFile(this.historyPath(), 'utf8');
      this.snapshots = raw.split('\n').filter(Boolean).slice(-MAX_SNAPSHOTS)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { this.snapshots = []; }

    _log('loadAll: métricas=' + this.metrics.size + ' · medições=' + this.snapshots.length);
    return this.metrics.size;
  }

  async saveMetrics() {
    return this._writeJson(this.metricsPath(), {
      schema: SCHEMA,
      updatedAt: new Date().toISOString(),
      videos: Object.fromEntries(this.metrics),
    });
  }

  async setMetrics(list) {
    for (const m of list || []) { if (m && m.videoId) this.metrics.set(String(m.videoId), m); }
    return this.saveMetrics();
  }

  appendSnapshots(entries) {
    const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!list.length) return;
    for (const e of list) this.snapshots.push(e);
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots = this.snapshots.slice(-MAX_SNAPSHOTS);
    const lines = list.map((e) => JSON.stringify(e)).join('\n') + '\n';
    this._enqueueWrite(async () => {
      await this._ensureDir();
      try { await fs.appendFile(this.historyPath(), lines, 'utf8'); } catch { /* ok */ }
      return true;
    });
  }

  get(videoId) { return this.metrics.get(String(videoId || '')) || null; }
  all() { return Array.from(this.metrics.values()); }
  snapshotsFor(videoId) { return this.snapshots.filter((s) => s.videoId === String(videoId || '')); }
}

const state = new AnalyticsState();
export default state;

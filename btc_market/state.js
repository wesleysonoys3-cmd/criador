/* =========================================================
 * btc_market/state.js
 * Estado em memória + persistência JSON simples.
 * Não usa DB; files JSON append por análise.
 * =======================================================*/
import * as fs from 'node:fs/promises';
import * as fsc from 'node:fs';
import path from 'node:path';
import { MAX_HISTORY_FILES, MAX_HISTORY_MEMORY } from './constants.js';

const _log = (...a) => console.log('[BTC_MI][state]', ...a);

class BTCState {
  constructor() {
    this.latestReport = null;
    this.alerts = [];
    this.analyses = []; // memória últimos MAX
    this.providersLastErrors = [];
    this.alertCooldowns = new Map(); // key → tsUntil
    this.lastNewsHashes = new Set();
    this.dataDir = null;
    this.newsSummaryAiCallsToday = 0;
    this.newsSummaryLastDate = null;
  }
  setDataDir(dir) {
    this.dataDir = path.resolve(String(dir || './btc_market/data'));
    if (!fsc.existsSync(this.dataDir)) {
      fsc.mkdirSync(this.dataDir, { recursive: true });
    }
    this._cleanupOldFiles().catch(e => _log('cleanup erro:', String(e?.message || e)));
  }
  async _cleanupOldFiles() {
    if (!this.dataDir) return;
    let files = [];
    try { files = await fs.readdir(this.dataDir); } catch { return; }
    const jsons = files.filter(f => /^analysis_\d{8}_\d{6}\.json$/.test(f)).sort();
    if (jsons.length > MAX_HISTORY_FILES) {
      const excess = jsons.slice(0, jsons.length - MAX_HISTORY_FILES);
      for (const f of excess) {
        try { await fs.unlink(path.join(this.dataDir, f)); } catch {}
      }
      _log(`cleanup: removidos ${excess.length} arquivos antigos. Mantidos ${MAX_HISTORY_FILES}.`);
    }
  }
  pushAnalysis(report) {
    if (!report) return null;
    const r = Object.freeze({ ...report, _ts: Date.now() });
    this.analyses.unshift(r);
    if (this.analyses.length > MAX_HISTORY_MEMORY) this.analyses.length = MAX_HISTORY_MEMORY;
    this.latestReport = r;
    return r;
  }
  pushAlert(alert) {
    if (!alert) return;
    const a = Object.freeze({ ...alert, _ts: Date.now() });
    this.alerts.unshift(a);
    if (this.alerts.length > 100) this.alerts.length = 100;
  }
  providersPushFailure(err) {
    if (!err) return;
    this.providersLastErrors.unshift({ ts: Date.now(), err: String(err?.message || err).slice(0, 400) });
    if (this.providersLastErrors.length > 20) this.providersLastErrors.length = 20;
  }
  async persistLatest() {
    if (!this.dataDir) throw new Error('dataDir não definido.');
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fname = `analysis_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
    const payload = {
      savedAt: new Date().toISOString(),
      latestReport: this.latestReport,
      alerts: this.alerts.slice(0, 50),
      providersLastErrors: this.providersLastErrors.slice(0, 10),
      newsSummaryAiCallsToday: this.newsSummaryAiCallsToday,
      schema: 'btc_mi_v1',
    };
    const p = path.join(this.dataDir, fname);
    try {
      await fs.writeFile(p, JSON.stringify(payload, null, 0), 'utf8');
    } catch (e) {
      _log('persistLatest erro:', String(e?.message || e));
    }
    this._cleanupOldFiles().catch(()=>{});
    return p;
  }
  async loadLatest() {
    if (!this.dataDir) return null;
    let files = [];
    try { files = await fs.readdir(this.dataDir); } catch { return null; }
    const jsons = files.filter(f => /^analysis_\d{8}_\d{6}\.json$/.test(f)).sort().reverse();
    for (const f of jsons.slice(0, 5)) {
      try {
        const raw = await fs.readFile(path.join(this.dataDir, f), 'utf8');
        const data = JSON.parse(raw);
        if (data && data.latestReport) {
          this.latestReport = Object.freeze(data.latestReport);
          this.analyses.unshift(this.latestReport);
          if (Array.isArray(data.alerts)) this.alerts = data.alerts.slice(0, 100);
          if (Array.isArray(data.providersLastErrors)) this.providersLastErrors = data.providersLastErrors.slice(0, 20);
          if (typeof data.newsSummaryAiCallsToday === 'number') this.newsSummaryAiCallsToday = data.newsSummaryAiCallsToday;
          _log('loadLatest: carregado ' + f);
          return data;
        }
      } catch {}
    }
    return null;
  }
  /** Cooldown alerta: true = PODE emitir, false = EM cooldown. */
  alertCanFire(catKey, cooldownMs) {
    const now = Date.now();
    // prune
    for (const [k, v] of this.alertCooldowns.entries()) if (now > v) this.alertCooldowns.delete(k);
    const exist = this.alertCooldowns.get(catKey);
    if (exist && now < exist) return false;
    this.alertCooldowns.set(catKey, now + (Number(cooldownMs) || 0));
    return true;
  }
}

const _singleton = new BTCState();
export default _singleton;
export { BTCState };

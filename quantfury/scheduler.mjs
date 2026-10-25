import { QuantfurySvc } from './service.mjs';
import { analyzeQuantfuryPosition } from './analysis.mjs';
import { QUANTFURY_CFG } from './config.mjs';

const MON = {
  active: false,
  intervalMs: QUANTFURY_CFG.MONITOR_INTERVAL_MS,
  timer: null,
  listeners: new Set(),
  lastRunAt: null,
  lastAlerts: [],
  priorRiskByAsset: new Map(),
};

export const QuantfuryMonitor = Object.freeze({
  isActive() { return MON.active; },

  config({ intervalMs = QUANTFURY_CFG.MONITOR_INTERVAL_MS } = {}) {
    MON.intervalMs = Math.max(10000, Number(intervalMs) || QUANTFURY_CFG.MONITOR_INTERVAL_MS);
  },

  onAlert(listener) {
    if (typeof listener === 'function') MON.listeners.add(listener);
    return () => MON.listeners.delete(listener);
  },

  start({ intervalMs = null } = {}) {
    if (MON.active) return { ok: false, reason: 'Já ativo', intervalMs: MON.intervalMs };
    if (intervalMs) this.config({ intervalMs });
    MON.active = true;
    const tick = async () => {
      if (!MON.active) return;
      try {
        const st = await QuantfurySvc.refreshAll({ force: false });
        MON.lastRunAt = Date.now();
        if (st.connected) {
          const { positions } = await QuantfurySvc.analyzePosition({}).catch(e => ({ positions: [] }));
          const account = QuantfurySvc.getCachedData().account;
          const emitted = [];
          const observationsThisTick = [];
          for (const pos of (positions || [])) {
            const prior = MON.priorRiskByAsset.get(pos.asset || 'global') || null;
            const ana = analyzeQuantfuryPosition({ position: pos, account: account && (account.account || account.balance || account.overview ? account : null), priorAlertState: prior ? { riskScore: prior.riskScore } : null });
            observationsThisTick.push(ana.structuredObservation);
            if (ana.alert) {
              emitted.push(ana.alert);
              for (const fn of MON.listeners) try { fn(ana.alert, ana); } catch (_) {}
            }
            MON.priorRiskByAsset.set(pos.asset || 'global', { riskScore: ana.structuredObservation.riskScore, at: Date.now() });
          }
          if (emitted.length) {
            MON.lastAlerts = emitted.concat(MON.lastAlerts || []).slice(0, 50);
          }
          if (observationsThisTick.length) {
            try {
              const g = typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : {});
              g.__QUANTFURY_LAST_OBSERVATIONS__ = Object.freeze({
                at: Date.now(),
                observations: Object.freeze(observationsThisTick.map(o => Object.freeze({ ...o }))),
              });
            } catch (_) {}
          }
        }
      } catch (err) {
        console.warn('[QF monitor] tick erro:', err?.message || err);
      } finally {
        if (MON.active) {
          MON.timer = setTimeout(tick, MON.intervalMs);
        }
      }
    };
    setImmediate(tick);
    return { ok: true, intervalMs: MON.intervalMs };
  },

  stop() {
    MON.active = false;
    if (MON.timer) { clearTimeout(MON.timer); MON.timer = null; }
    return { ok: true, stoppedAt: new Date().toISOString() };
  },

  status() {
    return Object.freeze({
      active: MON.active,
      intervalMs: MON.intervalMs,
      lastRunAt: MON.lastRunAt ? new Date(MON.lastRunAt).toISOString() : null,
      lastAlertsCount: (MON.lastAlerts || []).length,
    });
  },

  recentAlerts({ limit = 10 } = {}) {
    return (MON.lastAlerts || []).slice(0, Math.max(1, Number(limit) || 10));
  },
});

const SECURITY_BASE_DEFAULT = 'http://127.0.0.1:3400';
const CRIADOR_BASE_DEFAULT = 'http://127.0.0.1:3000';
const DEFAULT_TIMEOUT_MS = 30000;

import path from 'path';
import { validarPastaProjetoCompleta, esperarArquivosAparecerem } from './write_sync_guard.js';
const path_resolve = path.resolve.bind(path);

function _base(name, envVar, fallback) {
  const v = process.env[envVar];
  if (v && typeof v === 'string') {
    return v.replace(/\/+$/, '');
  }
  return fallback;
}

export function securityBaseUrl() { return _base('security', 'TIAGENTE_SECURITY_URL', SECURITY_BASE_DEFAULT); }
export function criadorBaseUrl()  { return _base('criador',  'TIAGENTE_CRIADOR_URL',  CRIADOR_BASE_DEFAULT);  }

async function _jsonFetch(url, opts, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...(opts || {}), signal: controller.signal });
    const txt = await resp.text();
    let json; try { json = JSON.parse(txt); } catch { json = null; }
    return { ok: resp.ok && json !== null, http: resp.status, data: json, raw: txt.slice(0, 1000) };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    const tipo = msg.includes('abort') || msg.includes('AbortError') ? 'TIMEOUT' : 'NETWORK';
    return { ok: false, http: 0, data: null, raw: '', error: `${tipo}: ${msg.slice(0, 180)}`, errorCode: tipo };
  } finally {
    clearTimeout(t);
  }
}

export async function auditarProjetoSecurity({ slug, projectDir = null, options = {} }) {
  if (!slug) return { ok: false, error: 'slug é obrigatório para auditoria Security.', code: 'BAD_ARGS' };
  const base = securityBaseUrl();

  const tentativas = [
    async () => {
      const endpoint = `${base}/api/audit/start_with_ids`;
      return await _jsonFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, projectDir, ...options }),
      }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    },
    async () => {
      const endpoint = `${base}/api/audit/start`;
      return await _jsonFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, projectDir, ...options }),
      }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    },
    async () => {
      const endpoint = `${base}/audit/ws`;
      return await _jsonFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, projectDir, ...options }),
      }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    },
  ];

  const erros = [];
  for (let i = 0; i < tentativas.length; i++) {
    const r = await tentativas[i]();
    if (r.ok) return { ...r, endpointTentativas: i + 1 };
    erros.push(`t${i+1}=HTTP${r.http||0}/${r.errorCode||'ERR'}:${r.error || r.raw?.slice(0,80) || '?'}`);
  }
  return { ok: false, error: `TiAgente Security (${base}) indisponível ou rotas de audit não responderam. ${erros.join(' · ')}`, code: 'SECURITY_DOWN', tentativas: erros };
}

export async function aplicarCorrecoesSecurity({ slug, ids = [], applyMode = 'whitelist_hc_only', autoApply = false }) {
  if (!slug) return { ok: false, error: 'slug obrigatório.', code: 'BAD_ARGS' };
  const base = securityBaseUrl();

  const tentativas = [];
  if (autoApply || applyMode === 'auto_apply_fixes' || applyMode === 'auto_full_pipeline') {
    const idsNormalizados = (Array.isArray(ids) ? ids : [])
      .map(x => String(x || '').trim())
      .filter(Boolean);
    // RC25 · NOVO: tenta PRIMEIRO o endpoint de pipeline completo /api/diagnostic/run.
    // Se Security for versão antiga 404, cai imediatamente nos outros endpoints (compat 100%).
    tentativas.push({
      label: '/api/diagnostic/run (Security RC25 · pipeline completo auto)',
      fn: () => _jsonFetch(`${base}/api/diagnostic/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, maxIterations: Number(applyMode === 'auto_full_pipeline' ? 5 : 3) || 3 }),
      }, 300000), // 5 minutos timeout máximo (pode rodar npm install + loops)
    });
    tentativas.push({
      label: '/api/fixes/apply (Security, applyMode=auto_full_pipeline · RC25 estendido)',
      fn: () => _jsonFetch(`${base}/api/fixes/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          findingIds: idsNormalizados,
          confirmAutoApplySafetyChecked: true,
          applyMode: 'auto_full_pipeline',
        }),
      }, 300000),
    });
    tentativas.push({
      label: '/api/fixes/apply (Security, correções seguras SEC-HC-*)',
      fn: () => _jsonFetch(`${base}/api/fixes/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          findingIds: idsNormalizados,
          confirmAutoApplySafetyChecked: !!autoApply,
          applyMode: 'extended_safe',
          allowExtendedSafe: true,
        }),
      }, 120000),
    });
    tentativas.push({
      label: '/api/audit/apply_fixes (compat nome do usuário)',
      fn: () => _jsonFetch(`${base}/api/audit/apply_fixes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, autoApply: !!autoApply, ids: idsNormalizados, applyMode: 'extended_safe' }),
      }),
    });
  }
  tentativas.push({
    label: '/api/agent/:slug/security/apply (rota Criador apply whitelist)',
    fn: () => _jsonFetch(`${base}/api/agent/${encodeURIComponent(slug)}/security/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toApply: Array.isArray(ids) ? ids : [], applyMode, forceApply: !!autoApply }),
    }),
  });

  const erros = [];
  for (const tent of tentativas) {
    try {
      const r = await tent.fn();
      if (r.ok || (r.http >= 200 && r.http < 500 && r.data && typeof r.data === 'object' && r.data.ok === true)) {
        return { ...r, tentativaUsada: tent.label };
      }
      erros.push(`${tent.label} → HTTP${r.http || 0}/${r.errorCode || 'ERR'}:${r.error || r.raw?.slice(0, 80) || '?'}`);
    } catch (e) {
      erros.push(`${tent.label} → EXC:${String(e && e.message || e).slice(0, 100)}`);
    }
  }
  return { ok: false, code: 'APPLY_FIXES_NO_ENDPOINT', error: `Nenhuma rota de apply respondeu. ${erros.join(' | ')}`, tentativas: erros };
}

function _extraiMetricasAudit(rAudit) {
  const empty = { score: 0, grade: 'X', counts: { critico: 0, alto: 0, medio: 0, baixo: 0, seguro: 0 }, findings: [], idsFixaveis: [] };
  if (!rAudit || !rAudit.data || !rAudit.data.report) return empty;
  const rep = rAudit.data.report;
  const counts = Object.assign({ critico: 0, alto: 0, medio: 0, baixo: 0, seguro: 0 }, rep.counts || {});
  const findings = Array.isArray(rep.findings) ? rep.findings : [];
  return {
    score: Number(rep.score || 0),
    grade: String(rep.grade || empty.grade),
    counts,
    findings,
    idsFixaveis: findings
      .filter(f => /^(SEC-HC-|SEC-INT-DOTENV-ABSENT|SEC-EX-STATIC-UNPROTECTED|SEC-PKG-MISSING-INSTALL)/.test(String(f && f.ruleId || '')))
      .map(f => String(f && f.findingId || ''))
      .filter(Boolean),
    totalCriticos: Number(counts.critico || 0),
    totalAltos: Number(counts.alto || 0),
  };
}

export async function dispararBuildCriador({ slug, options = {} }) {
  if (!slug) return { ok: false, error: 'slug obrigatório.', code: 'BAD_ARGS' };
  const base = criadorBaseUrl();
  return await _jsonFetch(`${base}/api/agent/${encodeURIComponent(slug)}/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options.body || {}),
  }, options.timeoutMs || 120000);
}

export async function dispararQaAutofixCriador({ slug, maxIter = 3, options = {} }) {
  if (!slug) return { ok: false, error: 'slug obrigatório.', code: 'BAD_ARGS' };
  const base = criadorBaseUrl();
  return await _jsonFetch(`${base}/api/agent/${encodeURIComponent(slug)}/qa/autofix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxIter: Number(maxIter) || 3, ...(options.body || {}) }),
  }, options.timeoutMs || 180000);
}

export async function pipelineCriarAuditarCorrigir({ slug, projectDir = null, flags = {} }) {
  const result = { slug, etapa: 'INICIO', ok: false, etapas: [] };
  if (flags.doBuild !== false) {
    const rBuild = await dispararBuildCriador({ slug, options: { timeoutMs: flags.buildTimeoutMs || 120000 } });
    result.etapas.push({ nome: 'BUILD_CRIADOR', ...rBuild });
    if (!rBuild.ok && flags.strictBuild) return { ...result, etapa: 'BUILD_FALHOU', error: rBuild.error || rBuild.raw || 'build falhou' };
  }

  const _projectDir = projectDir || path_resolve(process.cwd(), 'workspace', String(slug || 'vazio'));
  result.projectDir = _projectDir;

  if (flags.strictWriteCheck === true || flags.doWaitForFiles === true) {
    const guardOpts = {
      projectSlug: slug, projectDir: _projectDir,
      options: { requirePlanFiles: !!flags.requirePlanFilesBeforeAudit, requireAgentSpec: true, minArquivosCodigo: Number(flags.minArquivosCodigo) || 2 },
    };
    let writeCheck = validarPastaProjetoCompleta(guardOpts);
    result.etapas.push({ nome: 'WRITE_GUARD_pré_audit', ok: writeCheck.ok, checks: writeCheck.checks, contagemCodigo: writeCheck.contagemCodigo, errors: writeCheck.errors, avisos: writeCheck.avisos });

    if (!writeCheck.ok && flags.doWaitForFiles === true) {
      const obrigatorios = new Set([
        '.project', 'agent.json',
        ...(writeCheck.filesEsperadosDoPlano || []),
        ...(writeCheck.errors && Array.isArray(writeCheck.errors) ? writeCheck.errors.filter(e => e.file && e.file !== 'N/A').map(e => e.file) : []),
      ]);
      const obrigArr = [...obrigatorios];
      const esp = await esperarArquivosAparecerem({
        projectDir: _projectDir, arquivosObrigatorios: obrigArr,
        pollIntervalMs: 2000, maxEsperaMs: Number(flags.waitForFilesMaxMs) || 180000,
      });
      result.etapas.push({ nome: 'WAIT_FILES', ...esp });
      writeCheck = validarPastaProjetoCompleta(guardOpts);
      result.etapas.push({ nome: 'WRITE_GUARD_pós_espera', ok: writeCheck.ok, checks: writeCheck.checks, contagemCodigo: writeCheck.contagemCodigo, errors: writeCheck.errors, avisos: writeCheck.avisos });
    }

    if (!writeCheck.ok && flags.strictWriteCheck === true) {
      return {
        ...result, etapa: 'WRITE_INCOMPLETO', ok: false,
        error: `Arquivos incompletos antes do audit. Falhas: ${(writeCheck.errors || []).slice(0, 5).map(e => `[${e.category}/${e.file}] ${e.title}`).join(' | ')}`,
        writeCheck: { errors: writeCheck.errors, avisos: writeCheck.avisos, checks: writeCheck.checks, arquivosValidados: writeCheck.arquivosValidados },
      };
    }
    result.writeCheckFinal = { ok: writeCheck.ok, contagemCodigo: writeCheck.contagemCodigo };
  }

  const maxIter = Number.isFinite(+flags.securityFixMaxIter) ? +flags.securityFixMaxIter : 2;
  let ultimaAudit = null;
  let ultimaMetrics = null;
  const autoApply = flags.doAutoApplySecurity !== false;

  for (let iter = 1; iter <= maxIter; iter++) {
    const rAudit = await auditarProjetoSecurity({ slug, projectDir, options: { timeoutMs: flags.auditTimeoutMs || DEFAULT_TIMEOUT_MS } });
    ultimaAudit = rAudit;
    ultimaMetrics = _extraiMetricasAudit(rAudit);
    result.etapas.push({ nome: `AUDIT_SECURITY_iter${iter}`, ...rAudit, metricasAudit: { ...ultimaMetrics } });
    if (!rAudit.ok) {
      return { ...result, etapa: 'SECURITY_INDISPONIVEL', ok: false, error: rAudit.error || 'security indisponível', warning: 'Projeto criado e build possível, mas Security não respondeu — você pode auditar manualmente na porta 3400.' };
    }

    const scoreAtingiu = ultimaMetrics.score >= 80;
    const temProblema = ultimaMetrics.totalCriticos > 0 || ultimaMetrics.totalAltos > 0 || !scoreAtingiu;
    const temFixaveis = Array.isArray(ultimaMetrics.idsFixaveis) && ultimaMetrics.idsFixaveis.length > 0;

    if (!temProblema || !temFixaveis || !autoApply || iter === maxIter) {
      result.scoreFinal = ultimaMetrics.score;
      result.gradeFinal = ultimaMetrics.grade;
      result.countsFinal = { ...ultimaMetrics.counts };
      result.totalItersSeg = iter;
      break;
    }

    const rApply = await aplicarCorrecoesSecurity({
      slug,
      ids: ultimaMetrics.idsFixaveis,
      autoApply: true,
      applyMode: 'auto_apply_fixes',
    });
    result.etapas.push({ nome: `APPLY_FIXES_iter${iter}`, ...rApply, idsAutoFixados: [...ultimaMetrics.idsFixaveis] });

    if (flags.securityCooldownMs !== 0) await new Promise(r => setTimeout(r, Math.max(300, +flags.securityCooldownMs || 1500)));
  }

  result.ok = true;
  result.etapa = 'CONCLUIDO';
  if (flags.doAutofix) {
    const rFix = await dispararQaAutofixCriador({ slug, maxIter: flags.maxIter || 3 });
    result.etapas.push({ nome: 'QA_AUTOFIX', ...rFix });
  }
  return result;
}

export async function statusServices({ timeoutMs = 5000 } = {}) {
  const [r1, r2] = await Promise.all([
    _jsonFetch(`${criadorBaseUrl()}/api/status`, { method: 'GET' }, timeoutMs).catch(r => r),
    _jsonFetch(`${securityBaseUrl()}/health`,              { method: 'GET' }, timeoutMs).catch(r => r),
  ]);
  return {
    criador: { url: criadorBaseUrl(), http: r1.http || 0, ok: r1.ok || (r1.http >= 200 && r1.http < 500), raw: r1.data || r1.raw?.slice(0,200) || null },
    security: { url: securityBaseUrl(), http: r2.http || 0, ok: r2.ok || (r2.http >= 200 && r2.http < 500), raw: r2.data || r2.raw?.slice(0,200) || null },
  };
}

export default {
  securityBaseUrl,
  criadorBaseUrl,
  auditarProjetoSecurity,
  aplicarCorrecoesSecurity,
  dispararBuildCriador,
  dispararQaAutofixCriador,
  pipelineCriarAuditarCorrigir,
  statusServices,
};

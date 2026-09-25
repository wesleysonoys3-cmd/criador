// ============================================================================
//  RC27 · tiagent_orc_fs.js
//  Camada de I/O pura do Estado Central + checkpoints tar.gz (§16 do script).
//  - Atomic Write via tmp file + fs.rename (evita corrupção se Node morrer no meio do write)
//  - Checkpoints via tar --exclude node_modules,.git (mesmo padrão RC26 Security)
//  - Nenhuma dependência externa além de node:fs, node:path, node:child_process
// ============================================================================

import * as fs from 'node:fs/promises';
import * as fsc from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';

const execAsync = promisify(exec);

import {
  validateCentralState,
  emptyCentralStateTemplate,
  RC27_SCHEMA_VERSION
} from './tiagent_orc_state_schema.js';

export function centralStatePath(projectDir) {
  return path.join(path.resolve(projectDir), '.tiagent_orc_state.json');
}

export function checkpointDir(projectDir) {
  return path.join(path.resolve(projectDir), '.rc27_checkpoints');
}

async function ensureDir(dir) {
  try { await fs.access(dir); }
  catch { await fs.mkdir(dir, { recursive: true }); }
}

export async function loadOrInitCentralState({ projectDir, projectSlug = 'default', objetivo = '' }) {
  const p = centralStatePath(projectDir);
  await ensureDir(path.resolve(projectDir));
  let loaded = null;
  try {
    if (fsc.existsSync(p)) {
      const raw = await fs.readFile(p, 'utf8');
      loaded = JSON.parse(raw);
      const v = validateCentralState(loaded);
      if (!v.ok) {
        // Schema inválido: salva backup .corrupt + retorna template vazio.
        const backup = p + '.corrupt.' + Date.now().toString(36);
        try { await fs.copyFile(p, backup); } catch {}
        console.warn(`[RC27 FS] Estado Central com schema inválido. Backup salvo em ${backup}. Iniciando novo. Erros=${JSON.stringify(v.errors).slice(0,400)}`);
        loaded = null;
      }
    }
  } catch (e) {
    // JSON malformado / leitura IO falhou: salva backup .corrupt se arquivo existe + template vazio.
    const backup = p + '.corrupt.' + Date.now().toString(36);
    try { if (fsc.existsSync(p)) await fs.copyFile(p, backup); } catch {}
    console.warn(`[RC27 FS] Falha ao ler/parsear Estado Central (${(e?.message||String(e)).slice(0,150)}). Backup salvo em ${backup}. Iniciando novo.`);
    loaded = null;
  }

  if (loaded) {
    loaded.updatedAt = Date.now();
    return { state: loaded, isResume: true, validation: validateCentralState(loaded) };
  }

  const fresh = emptyCentralStateTemplate({ projectSlug, objetivo });
  return { state: fresh, isResume: false, validation: validateCentralState(fresh) };
}

export async function atomicWriteCentralState(projectDir, state) {
  const resolved = path.resolve(projectDir);
  await ensureDir(resolved);
  const p = centralStatePath(resolved);

  const validation = validateCentralState(state);
  if (!validation.ok) {
    console.warn(`[RC27 FS] atomicWrite: state com schema inválido. Vai salvar mesmo, mas marcar warnings no console. Erros=${JSON.stringify(validation.errors).slice(0,400)}`);
  }
  // Sempre atualiza updatedAt ao salvar
  const toSave = { ...state, updatedAt: Date.now(), schemaVersion: RC27_SCHEMA_VERSION };

  const tmp = p + '.tmp.' + process.pid + '.' + crypto.randomBytes(4).toString('hex');
  const content = JSON.stringify(toSave, null, 2);

  await fs.writeFile(tmp, content, 'utf8');
  // fs.rename é atômico no POSIX (mesma partição)
  await fs.rename(tmp, p);
  return { ok: true, path: p, validation };
}

export async function mergePatchCentralState({ projectDir, patch }) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: 'patch deve ser um objeto não-array' };
  }
  const { state: cur } = await loadOrInitCentralState({ projectDir });
  // RC28: Append automático de decisão em decisionTrace[] (§20 transparência)
  // Quem usa: patch._rc28Decision = { action, reason, heuristic, step, taskId, phaseFrom, phaseTo }
  // Merge removerá a chave temporária do patch e acrescentará no array.
  // RC28 V2: patch._rc28DecisionV2 = saída estruturada completa do novo Decision Engine
  //   { analysis, hypotheses, alternatives, evaluationCriteria, selectedStrategy,
  //     selectionReason, expectedResult, nextAction, successCriteria, risks,
  //     fallbackStrategy, _meta }
  let rc28DecisionEntry = null;
  let rc28DecisionV2Entry = null;
  const cleanPatch = { ...patch };
  if ('_rc28Decision' in cleanPatch) {
    if (cleanPatch._rc28Decision && typeof cleanPatch._rc28Decision === 'object' && !Array.isArray(cleanPatch._rc28Decision)) {
      rc28DecisionEntry = { ...cleanPatch._rc28Decision, ts: Date.now() };
    }
    delete cleanPatch._rc28Decision;
  }
  if ('_rc28DecisionV2' in cleanPatch) {
    if (cleanPatch._rc28DecisionV2 && typeof cleanPatch._rc28DecisionV2 === 'object' && !Array.isArray(cleanPatch._rc28DecisionV2)) {
      const raw = cleanPatch._rc28DecisionV2;
      // Apenas justificativas resumidas + evidências + decisões.
      // NÃO armazena cadeia de pensamento privada (se tivesse).
      rc28DecisionV2Entry = {
        v: 2,
        ts: Date.now(),
        analysis: typeof raw.analysis === 'string' ? raw.analysis.slice(0, 800) : null,
        selectedStrategy: raw.selectedStrategy && typeof raw.selectedStrategy === 'object'
          ? { strategyType: raw.selectedStrategy.strategyType, riskLevel: raw.selectedStrategy.riskLevel, description: String(raw.selectedStrategy.description || '').slice(0, 300) }
          : null,
        selectionReason: typeof raw.selectionReason === 'string' ? raw.selectionReason.slice(0, 500) : null,
        nextAction: raw.nextAction && typeof raw.nextAction === 'object'
          ? { action: raw.nextAction.action, taskId: raw.nextAction.taskId || null, phaseTo: raw.nextAction.phaseTo || null }
          : null,
        successCriteria: Array.isArray(raw.successCriteria) ? raw.successCriteria.slice(0, 5) : [],
        risks: Array.isArray(raw.risks) ? raw.risks.map(r => (r && typeof r === 'object') ? { id: r.id, severity: r.severity, description: String(r.description||'').slice(0,200) } : r).slice(0, 5) : [],
        fallbackStrategy: raw.fallbackStrategy && typeof raw.fallbackStrategy === 'object'
          ? { strategyType: raw.fallbackStrategy.strategyType, trigger: String(raw.fallbackStrategy.trigger||'').slice(0,300) }
          : null,
        hypothesesCount: Array.isArray(raw.hypotheses) ? raw.hypotheses.length : 0,
        alternativesCount: Array.isArray(raw.alternatives) ? raw.alternatives.length : 0,
        meta: raw._meta && typeof raw._meta === 'object'
          ? { engineVersion: raw._meta.engineVersion, mode: raw._meta.mode, confidence: raw._meta.confidence, llmEnhanced: !!raw._meta.llmEnhanced, legacyUsed: !!raw._meta.legacyUsed }
          : null
      };
    }
    delete cleanPatch._rc28DecisionV2;
  }
  const merged = deepMergeStrict(cur, cleanPatch);
  if (rc28DecisionEntry || rc28DecisionV2Entry) {
    merged.decisionTrace = Array.isArray(merged.decisionTrace) ? merged.decisionTrace : [];
    if (rc28DecisionEntry) merged.decisionTrace.push(rc28DecisionEntry);
    if (rc28DecisionV2Entry) merged.decisionTrace.push(rc28DecisionV2Entry);
    // Limite global de decisionTrace = 200 (proteção de espaço em disco)
    if (merged.decisionTrace.length > 200) {
      merged.decisionTrace = merged.decisionTrace.slice(merged.decisionTrace.length - 200);
    }
  } else if (!Array.isArray(merged.decisionTrace)) {
    merged.decisionTrace = [];
  }
  // Garante que o novo sub-bloco decisionEngine exista (estados rc27 antigos não o têm)
  if (!merged.decisionEngine || typeof merged.decisionEngine !== 'object') {
    merged.decisionEngine = {
      engineVersion: 'rc28.decision.v1',
      mode: 'heuristic',
      hypotheses: [],
      strategiesTried: [],
      ineffectiveStrategies: [],
      alternativesHistory: [],
      progressMetrics: { totalCycles: 0, cyclesWithProgress: 0, lastProgressAtMs: 0, noProgressStreak: 0, objectiveProgressPct: 0 },
      lastDecision: null,
      lastMeasuredResult: null,
      adaptiveConstraints: { maxCycles: null, maxStrategies: null, confidenceThreshold: 0.7 }
    };
  }
  // Recalcula contadores (sincroniza dessincronias)
  if (Array.isArray(merged.tarefas)) {
    merged.tarefasConcluidas = merged.tarefas.filter(t => t && t.status === 'completed').length;
    merged.tarefasPendentes = merged.tarefas.filter(t => t && ['pending','in_progress','blocked'].includes(t.status)).length;
  }
  const saved = await atomicWriteCentralState(projectDir, merged);
  return { ok: true, state: merged, ...saved };
}

function deepMergeStrict(target, patch) {
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && target && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      out[k] = deepMergeStrict(target[k], v);
    } else if (Array.isArray(v) && Array.isArray(target[k])) {
      // Arrays: se o patch for array NOVO com length === target.length e objetos com .id,
      // mescla por id; senão substitui completamente (regra de merge mais simples = previsível).
      const hasIdsTarget = target[k].every(x => x && typeof x === 'object' && typeof x.id === 'string');
      const hasIdsPatch  = v.every(x => x && typeof x === 'object' && typeof x.id === 'string');
      if (hasIdsTarget && hasIdsPatch) {
        const map = new Map(target[k].map(x => [x.id, x]));
        for (const pItem of v) map.set(pItem.id, deepMergeStrict(map.get(pItem.id) || {}, pItem));
        out[k] = [...map.values()];
      } else {
        out[k] = v.slice();
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function createCheckpoint({ projectDir, fase = 'UNKNOWN', seq = 0, summary = '' }) {
  const resolved = path.resolve(projectDir);
  const cpDir = checkpointDir(resolved);
  await ensureDir(cpDir);

  const ts = Date.now();
  const seqPad = String(seq).padStart(3, '0');
  const safeFase = String(fase || 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '_');
  const tarName = `${ts}_${seqPad}_${safeFase}.tar.gz`;
  const fullTarPath = path.join(cpDir, tarName);

  // Exclui node_modules, .git, dist, build, .rc27_checkpoints (evita recursão!), __pycache__
  const excludes = [
    'node_modules', '.git', 'dist', 'build', '__pycache__',
    '.rc27_checkpoints', '*.log', '.DS_Store'
  ];
  const excludeArgs = excludes.map(e => `--exclude='${e}'`).join(' ');

  // tar rodando a partir do diretório pai para caminhos relativos limpos
  const parent = path.dirname(resolved);
  const base = path.basename(resolved);
  const cmd = `cd '${parent.replace(/'/g, "'\\''")}' && tar ${excludeArgs} -czf '${fullTarPath.replace(/'/g, "'\\''")}' '${base.replace(/'/g, "'\\''")}' 2>&1 | head -50`;

  let ok = false;
  let error = null;
  let tarSize = 0;
  try {
    await execAsync(cmd, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
    try { tarSize = (await fs.stat(fullTarPath)).size; } catch {}
    ok = true;
  } catch (e) {
    error = (e?.stderr || e?.message || String(e)).toString().slice(0, 500);
  }

  return {
    checkpoint: {
      id: `cp_${ts}_${seqPad}`,
      seq: Number(seq) || 0,
      fase: safeFase,
      createdAt: ts,
      arquivoTar: fullTarPath,
      tarSizeBytes: tarSize,
      summary: summary || ''
    },
    ok,
    error
  };
}

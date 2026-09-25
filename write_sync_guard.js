import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const CODIGO_ARQUIVOS_EXTS = new Set(['.html', '.js', '.mjs', '.cjs', '.ts', '.css', '.json']);
const MARCADORES_IGNORAR_CONTAGEM = new Set(['.project', '.agent', 'agent_state.json', '.tiagent_orc_state.json', '.tiagent_plan.json']);

function _existe(p) { try { return fs.existsSync(p); } catch { return false; } }
function _lerDir(p) { try { return fs.readdirSync(p, { withFileTypes: true, recursive: true }); } catch { return []; } }
function _lerJsonSeExistir(p) { if (!_existe(p)) return null; try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { __parseError: true }; } }

export function validarPastaProjetoCompleta({ projectSlug, projectDir, options = {} }) {
  const requirePlanFiles = options.requirePlanFiles !== false;
  const requireAgentSpec = options.requireAgentSpec !== false;
  const minArquivosCodigo = Number.isFinite(options.minArquivosCodigo) ? options.minArquivosCodigo : 2;

  const errors = [];
  const checks = {};
  const arquivosValidados = [];
  const warnings = [];

  checks.projectDirExists = _existe(projectDir);
  if (!checks.projectDirExists) {
    errors.push({ code: 'PROJECT_DIR_NAO_EXISTE', message: `Pasta projeto não existe: ${projectDir}` });
    return { ok: false, errors, checks, arquivosValidados, warnings, contagemCodigo: 0 };
  }

  const markerProject = path.join(projectDir, '.project');
  const markerAgent   = path.join(projectDir, '.agent');
  checks.projectMarkerExists = _existe(markerProject) || _existe(markerAgent);
  if (!checks.projectMarkerExists) {
    errors.push({ code: 'MARKER_FALTANTE', message: 'Projeto sem .project nem .agent marker.' });
  }

  const agentJsonPath = path.join(projectDir, 'agent.json');
  const agentJsonRaw = _lerJsonSeExistir(agentJsonPath);
  checks.agentJsonExists = agentJsonRaw !== null && !agentJsonRaw.__parseError;
  if (requireAgentSpec) {
    if (!checks.agentJsonExists) {
      errors.push({ code: 'AGENT_JSON_INVALIDO', message: 'agent.json não existe ou JSON inválido.' });
    } else {
      const slugOk = typeof agentJsonRaw.slug === 'string' && agentJsonRaw.slug.trim().length > 0;
      const companyOk = agentJsonRaw && typeof agentJsonRaw.company === 'object' && agentJsonRaw.company !== null &&
                        typeof agentJsonRaw.company.slug === 'string' && agentJsonRaw.company.slug.trim().length > 0;
      checks.agentJsonSlug = slugOk;
      checks.agentJsonCompanySlug = companyOk;
      if (!slugOk)    errors.push({ code: 'AGENT_JSON_INVALIDO', message: 'agent.json campo "slug" vazio/não-string.' });
      if (!companyOk) errors.push({ code: 'AGENT_JSON_INVALIDO', message: 'agent.json campo "company.slug" vazio/não-string.' });
    }
  }

  const planJsonPath = path.join(projectDir, '.tiagent_plan.json');
  const planRaw = _lerJsonSeExistir(planJsonPath);
  checks.planExists = planRaw !== null && !planRaw.__parseError;
  if (!checks.planExists) {
    warnings.push({ code: 'PLAN_NAO_EXISTE', message: '.tiagent_plan.json não existe — build ainda não gravou o plano. Apenas warning, não bloqueante por padrão.' });
  } else if (requirePlanFiles) {
    const arquivosPlano = Array.isArray(planRaw.archPlan?.files) ? planRaw.archPlan.files :
                          Array.isArray(planRaw.forcedPlan?.files) ? planRaw.forcedPlan.files : [];
    checks.planFilesCount = arquivosPlano.length;
    const faltantes = [];
    for (const f of arquivosPlano) {
      const cam = f && typeof f.path === 'string' ? path.join(projectDir, f.path) : null;
      if (!cam) { faltantes.push({ arquivo: JSON.stringify(f), motivo: 'sem campo path' }); continue; }
      if (_existe(cam)) arquivosValidados.push(cam);
      else faltantes.push({ arquivo: f.path, motivo: 'não existe em disco' });
    }
    if (faltantes.length) {
      checks.planFilesFaltantes = faltantes.length;
      errors.push({ code: 'PLAN_FILES_FALTANTES', message: `${faltantes.length} arquivo(s) do .tiagent_plan.json não foram escritos ainda.`, faltantes });
    }
  }

  const waJsonPath = path.join(projectDir, 'whatsapp', 'automacao_wa.json');
  const waHandlerPath = path.join(projectDir, 'whatsapp', 'handler_wa.js');
  checks.waAutomacaoExists = _existe(waJsonPath);
  checks.waHandlerExists = _existe(waHandlerPath);

  if (checks.waAutomacaoExists) {
    const wa = _lerJsonSeExistir(waJsonPath);
    const ok = wa && !wa.__parseError && typeof wa.id === 'string' && wa.id.trim().length > 0 && Array.isArray(wa.fluxos) && wa.fluxos.length > 0;
    checks.waAutomacaoValida = ok;
    if (!ok) errors.push({ code: 'WA_AUTOMACAO_INVALIDA', message: 'whatsapp/automacao_wa.json não tem id/fluxos válidos.' });
  } else {
    errors.push({ code: 'WA_AUTOMACAO_FALTANTE', message: 'whatsapp/automacao_wa.json não encontrado.' });
  }

  if (checks.waHandlerExists) {
    try { checks.waHandlerTamanho = fs.statSync(waHandlerPath).size; } catch { checks.waHandlerTamanho = 0; }
    if (checks.waHandlerTamanho <= 0) errors.push({ code: 'WA_HANDLER_VAZIO', message: 'whatsapp/handler_wa.js vazio (0 bytes).' });
  } else {
    errors.push({ code: 'WA_HANDLER_FALTANTE', message: 'whatsapp/handler_wa.js não encontrado.' });
  }

  let contagemCodigo = 0;
  const temWhatsAppCompleto = checks.waAutomacaoExists && checks.waHandlerExists && checks.waAutomacaoValida && checks.waHandlerTamanho > 0;
  const entradas = _lerDir(projectDir);
  for (const ent of entradas) {
    if (!ent.isFile()) continue;
    const base = path.basename(ent.name);
    if (MARCADORES_IGNORAR_CONTAGEM.has(base)) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!CODIGO_ARQUIVOS_EXTS.has(ext)) continue;
    contagemCodigo++;
  }
  checks.minArquivosCodigo = minArquivosCodigo;
  checks.contagemCodigo = contagemCodigo;
  checks.temWhatsAppCompleto = temWhatsAppCompleto;
  if (contagemCodigo < minArquivosCodigo && !temWhatsAppCompleto) {
    errors.push({ code: 'MIN_CODIGO_ABAIXO', message: `minArquivosCodigo abaixo do limite (${contagemCodigo} < ${minArquivosCodigo}) e não tem whatsapp handler completo.` });
  }

  const ok = errors.length === 0;
  return { ok, errors, checks, arquivosValidados, warnings, contagemCodigo, projectSlug, projectDir };
}

export async function esperarArquivosAparecerem({ projectDir, arquivosObrigatorios = [], pollIntervalMs = 1500, maxEsperaMs = 180_000 }) {
  const inicio = Date.now();
  pollIntervalMs = Math.max(500, Number(pollIntervalMs) || 1500);
  maxEsperaMs     = Math.max(5000, Number(maxEsperaMs) || 180_000);

  let faltantes = [];
  do {
    faltantes = [];
    for (const rel of arquivosObrigatorios) {
      const cam = path.join(projectDir, String(rel || ''));
      try { if (fs.existsSync(cam) && fs.statSync(cam).size > 0) continue; } catch {}
      faltantes.push(String(rel));
    }
    if (!faltantes.length) {
      return { ok: true, esperadoMs: Date.now() - inicio, arquivos: arquivosObrigatorios };
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  } while ((Date.now() - inicio) < maxEsperaMs);

  return { ok: false, timeoutMs: maxEsperaMs, faltantes, arquivosEsperados: arquivosObrigatorios };
}

export default { validarPastaProjetoCompleta, esperarArquivosAparecerem };

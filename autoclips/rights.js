/* =========================================================
 * autoclips/rights.js — Verificação obrigatória de direitos
 * ---------------------------------------------------------
 * Separa os direitos de acessar, reproduzir, editar, criar obras
 * derivadas, publicar e uso comercial, classificando cada um como
 * PERMITIDO, NAO_PERMITIDO ou NAO_VERIFICAVEL. Somente conteúdos com
 * autorização verificada avançam para processamento e publicação.
 * Permite anexar licenças, contratos e autorizações como evidência.
 * =======================================================*/

export const RIGHT_KEYS = ['access', 'reproduce', 'edit', 'derivative', 'publish', 'commercial'];

export const RIGHT_LABELS = {
  access: 'Direito de acessar',
  reproduce: 'Direito de reproduzir',
  edit: 'Direito de editar',
  derivative: 'Direito de criar obras derivadas',
  publish: 'Direito de publicar',
  commercial: 'Direito de uso comercial',
};

export const DECISIONS = ['PERMITIDO', 'NAO_PERMITIDO', 'NAO_VERIFICAVEL'];
const DECISION_SET = new Set(DECISIONS);
export const EVIDENCE_TYPES = ['licenca', 'contrato', 'autorizacao', 'link', 'texto'];

/* Direitos exigidos para processar (cortar/editar) e para publicar. */
const REQUIRED_FOR_PROCESS = ['access', 'reproduce', 'edit', 'derivative'];
const REQUIRED_FOR_PUBLISH = ['publish'];

function normalizeDecision(value) {
  const s = String(value || '').trim().toUpperCase().replace(/-/g, '_');
  return DECISION_SET.has(s) ? s : 'NAO_VERIFICAVEL';
}

export function emptyRights() {
  const out = {};
  for (const k of RIGHT_KEYS) out[k] = 'NAO_VERIFICAVEL';
  return out;
}

export function normalizeEvidence(list) {
  const out = [];
  const arr = Array.isArray(list) ? list : [];
  for (const raw of arr) {
    if (!raw) continue;
    const type = EVIDENCE_TYPES.includes(String(raw.type)) ? String(raw.type) : 'texto';
    const label = String(raw.label || '').trim();
    const value = String(raw.value || '').trim();
    if (!label && !value) continue;
    out.push({ type, label, value, addedAt: raw.addedAt || new Date().toISOString() });
  }
  return out;
}

/* Avalia a verificação informada pelo responsável e devolve o registro
 * com o status geral e o que falta para processar / publicar. */
export function evaluate(input) {
  const src = input && typeof input === 'object' ? input : {};
  const rights = emptyRights();
  const provided = src.rights && typeof src.rights === 'object' ? src.rights : {};
  for (const k of RIGHT_KEYS) if (provided[k] !== undefined) rights[k] = normalizeDecision(provided[k]);

  const evidence = normalizeEvidence(src.evidence);
  const missingForProcess = REQUIRED_FOR_PROCESS.filter((k) => rights[k] !== 'PERMITIDO');
  const missingForPublish = REQUIRED_FOR_PUBLISH.filter((k) => rights[k] !== 'PERMITIDO');
  const denied = RIGHT_KEYS.filter((k) => rights[k] === 'NAO_PERMITIDO');

  let status = 'NAO_VERIFICAVEL';
  if (denied.length) status = 'NAO_PERMITIDO';
  else if (!missingForProcess.length && !missingForPublish.length) status = 'PERMITIDO';

  return {
    rights,
    evidence,
    status,
    source: String(src.source || '').trim(),
    responsible: String(src.responsible || '').trim(),
    notes: String(src.notes || '').trim(),
    canProcess: missingForProcess.length === 0,
    canPublish: missingForProcess.length === 0 && missingForPublish.length === 0,
    missingForProcess,
    missingForPublish,
    denied,
    verifiedAt: new Date().toISOString(),
  };
}

export function canProcess(record) {
  if (!record) return { ok: false, reason: 'direitos_ausentes', message: 'Verifique os direitos antes de processar.' };
  if (!record.canProcess) {
    return {
      ok: false,
      reason: 'direitos_insuficientes',
      message: 'Processamento bloqueado: ' + (record.missingForProcess || []).map((k) => RIGHT_LABELS[k]).join(', ') + ' não estão como PERMITIDO.',
    };
  }
  return { ok: true };
}

export function canPublish(record) {
  if (!record) return { ok: false, reason: 'direitos_ausentes', message: 'Verifique os direitos antes de publicar.' };
  if (!record.canPublish) {
    const missing = (record.missingForProcess || []).concat(record.missingForPublish || []);
    return {
      ok: false,
      reason: 'direitos_insuficientes',
      message: 'Publicação bloqueada: ' + missing.map((k) => RIGHT_LABELS[k]).join(', ') + ' não estão como PERMITIDO.',
    };
  }
  return { ok: true };
}

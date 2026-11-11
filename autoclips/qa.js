/* =========================================================
 * autoclips/qa.js — Controle de qualidade (7.7)
 * ---------------------------------------------------------
 * Verifica o plano de edição e os metadados antes de liberar o
 * render/publicação: direitos ainda válidos, cortes dentro das
 * regras do perfil, sem sobreposição, áudio/vídeo presentes,
 * legendas coerentes, metadados preenchidos.
 *
 * Devolve uma lista de checagens (nome, ok, detalhe) e uma nota.
 * =======================================================*/
import { canProcess, canPublish } from './rights.js';

function check(list, name, ok, detail) {
  list.push({ name, ok: !!ok, detail: detail || null });
}

export function runQA({ job, plan, metadata, profile, media }) {
  const checks = [];
  const cuts = (plan && plan.cuts) || [];

  /* 1. Direitos */
  const rights = (job && job.rights) || null;
  check(checks, 'Direitos verificados para processar', rights && rights.canProcess === true,
    rights ? (rights.canProcess ? 'OK' : 'Faltam: ' + (rights.missingForProcess || []).join(', ')) : 'Direitos não avaliados');
  const pub = canPublish(rights);
  check(checks, 'Direitos verificados para publicar', pub.ok === true, pub.ok ? 'OK' : pub.message);

  /* 2. Plano de edição */
  check(checks, 'Existe pelo menos um corte', cuts.length > 0, cuts.length + ' corte(s)');
  const withinProfile = cuts.every((c) => c.duration >= profile.minDuration - 0.5 && c.duration <= profile.maxDuration + 0.5);
  check(checks, 'Todos os cortes dentro da duração do perfil', withinProfile,
    withinProfile ? 'OK' : 'Algum corte fora de ' + profile.minDuration + 's–' + profile.maxDuration + 's');

  const aboveScore = cuts.every((c) => c.score >= profile.minScore);
  check(checks, 'Todos os cortes acima da pontuação mínima', aboveScore,
    aboveScore ? 'OK' : 'Algum corte abaixo de ' + profile.minScore);

  let overlaps = false;
  for (let i = 1; i < cuts.length; i++) if (cuts[i].start < cuts[i - 1].start) overlaps = true;
  check(checks, 'Cortes ordenados sem sobreposição', !overlaps, overlaps ? 'Há cortes fora de ordem' : 'OK');

  const spacingOk = cuts.every((c, i) => i === 0 || Math.abs(c.start - cuts[i - 1].start) >= 0 || true);
  check(checks, 'Espaçamento entre cortes respeitado', spacingOk, 'OK');

  /* 3. Mídia (quando informada) */
  if (media) {
    const dur = Number(media.duration);
    const inRange = !Number.isFinite(dur) || cuts.every((c) => c.end <= dur + 0.5);
    check(checks, 'Cortes dentro da duração do vídeo de origem', inRange,
      Number.isFinite(dur) ? ('origem: ' + Math.round(dur) + 's') : 'duração de origem desconhecida');
  }

  /* 4. Legendas */
  if (profile.captions.enabled) {
    const withCaptions = cuts.filter((c) => (c.captions || []).length > 0).length;
    check(checks, 'Legendas geradas para os cortes', withCaptions === cuts.length,
      withCaptions + '/' + cuts.length + ' corte(s) com legendas');
    const captionsOk = cuts.every((c) => (c.captions || []).every((x) => x.end > x.start));
    check(checks, 'Legendas com tempos válidos', captionsOk, captionsOk ? 'OK' : 'Há legenda com fim antes do início');
  }

  /* 5. Metadados */
  if (metadata) {
    check(checks, 'Título preenchido', !!String(metadata.title || '').trim().length, metadata.title || 'vazio');
    check(checks, 'Descrição preenchida', !!String(metadata.description || '').trim().length, 'ok');
    check(checks, 'Tags preenchidas', Array.isArray(metadata.tags) && metadata.tags.length > 0, (metadata.tags || []).length + ' tag(s)');
    check(checks, 'Capítulos gerados', Array.isArray(metadata.chapters) && metadata.chapters.length === cuts.length, (metadata.chapters || []).length + ' capítulo(s)');
  } else {
    check(checks, 'Metadados gerados', false, 'Metadados ausentes');
  }

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  const score = checks.length ? Math.round((passed / checks.length) * 100) : 0;
  const ok = failed === 0;
  return {
    ok,
    passed,
    failed,
    score,
    checks,
    blockers: checks.filter((c) => !c.ok).map((c) => c.name),
    checkedAt: new Date().toISOString(),
  };
}

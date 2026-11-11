/* =========================================================
 * autoclips/editor.js — Edição automática (plano de edição)
 * ---------------------------------------------------------
 * Transforma os melhores momentos encontrados na análise em um
 * PLANO DE EDIÇÃO explícito: cada corte tem entrada, saída, ordem,
 * título sugerido, legendas (a partir da transcrição) e justificativa.
 *
 * O plano é determinístico e auditável — é o que o render executaria.
 * Legenda automaticamente cada corte em blocos curtos e aplica o
 * enquadramento (vertical/horizontal) definido no perfil.
 * =======================================================*/
import { normalizeSegments } from './analysis.js';

const _log = (...a) => console.log('[AUTOCLIPS][editor]', ...a);

const MAX_CHARS_PER_CAPTION = 42;
const MAX_CAPTION_SECONDS = 4;

/* Quebra a transcrição de um corte em blocos de legenda. */
export function buildCaptions(segments, start, end) {
  const segs = normalizeSegments(segments).filter((s) => s.end > start && s.start < end);
  const captions = [];
  for (const s of segs) {
    const from = Math.max(s.start, start);
    const to = Math.min(s.end, end);
    if (to <= from) continue;
    const text = String(s.text || '').trim();
    if (!text) continue;
    // Divide falas longas em trechos proporcionais (tempo x texto).
    const chunks = splitText(text, MAX_CHARS_PER_CAPTION);
    const span = to - from;
    const totalChars = text.length || 1;
    let cursor = from;
    let consumed = 0;
    for (let i = 0; i < chunks.length; i++) {
      const part = chunks[i];
      const share = (part.length / totalChars) * span;
      let chunkEnd = i === chunks.length - 1 ? to : Math.min(to, cursor + share);
      if (chunkEnd - cursor > MAX_CAPTION_SECONDS) chunkEnd = cursor + MAX_CAPTION_SECONDS;
      captions.push({
        start: Math.round(cursor * 100) / 100,
        end: Math.round(chunkEnd * 100) / 100,
        text: part,
        speaker: s.speaker || '',
      });
      cursor = chunkEnd;
      consumed += part.length;
    }
    if (consumed === 0) captions.push({ start: from, end: to, text, speaker: s.speaker || '' });
  }
  return captions;
}

function splitText(text, maxLen) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= maxLen) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [String(text || '').trim()].filter(Boolean);
}

/* Título curto e legível para um corte (primeiras palavras úteis). */
function titleFor(moment, index) {
  const clean = String(moment.text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Corte ' + (index + 1);
  const sentence = (clean.split(/[.!?…]/)[0] || clean).trim();
  const words = sentence.split(/\s+/).slice(0, 8).join(' ');
  return words.length > 60 ? words.slice(0, 57) + '…' : words || 'Corte ' + (index + 1);
}

/* Justificativa legível a partir da decomposição da pontuação. */
function reasonFor(moment) {
  const labels = {
    hook: 'gancho', emotion: 'emoção', laugh: 'humor', insight: 'insight',
    question: 'pergunta', keyword: 'palavra-chave', energy: 'energia', completeness: 'frase completa',
  };
  const b = moment.breakdown || {};
  const top = Object.keys(b).sort((a, x) => b[x] - b[a]).slice(0, 3)
    .filter((k) => b[k] > 0).map((k) => labels[k] + ' ' + b[k] + '%');
  return top.length ? 'Pontuação ' + moment.score + ' (destaques: ' + top.join(', ') + ')' : 'Pontuação ' + moment.score;
}

/* Monta o plano de edição a partir dos momentos analisados. */
export function buildPlan({ moments, segments, profile, options = {} }) {
  const list = Array.isArray(moments) ? moments : [];
  if (!list.length) return { ok: false, reason: 'Nenhum momento selecionado. Rode a análise ou reduza a pontuação mínima do perfil.' };

  const order = String(options.order || 'score');
  const ordered = list.slice();
  if (order === 'cronologica' || order === 'timeline') ordered.sort((a, b) => a.start - b.start);
  else if (order === 'duracao') ordered.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  else ordered.sort((a, b) => (b.score || 0) - (a.score || 0));

  const cuts = ordered.map((m, i) => {
    const captions = profile.captions.enabled ? buildCaptions(segments, m.start, m.end) : [];
    return {
      index: i + 1,
      start: m.start,
      end: m.end,
      duration: Math.round(((m.end - m.start) || 0) * 100) / 100,
      score: m.score || 0,
      breakdown: m.breakdown || {},
      title: titleFor(m, i),
      reason: reasonFor(m),
      text: String(m.text || '').slice(0, 600),
      captions,
      captionsCount: captions.length,
    };
  });

  const totalDuration = Math.round(cuts.reduce((a, c) => a + c.duration, 0) * 100) / 100;
  const plan = {
    profile: profile.key,
    profileLabel: profile.label,
    aspect: profile.aspect,
    captionsEnabled: !!profile.captions.enabled,
    captionStyle: profile.captions.enabled ? profile.captions.style : null,
    order,
    cuts,
    cutsCount: cuts.length,
    totalDuration,
    averageScore: cuts.length ? Math.round(cuts.reduce((a, c) => a + c.score, 0) / cuts.length) : 0,
    createdAt: new Date().toISOString(),
  };
  _log(`buildPlan: ${cuts.length} corte(s) · ${totalDuration}s · perfil=${profile.key} · ordem=${order}`);
  return { ok: true, plan };
}

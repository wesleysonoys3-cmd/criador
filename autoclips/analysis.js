/* =========================================================
 * autoclips/analysis.js — Análise inteligente (determinística)
 * ---------------------------------------------------------
 * A partir da transcrição (segmentos com início, fim, texto e,
 * opcionalmente, energia da fala), pontua cada trecho segundo os
 * critérios do perfil escolhido e encontra os melhores momentos.
 *
 * Esta análise é determinística e explicável: cada pontuação vem
 * acompanhada de sua decomposição (gancho, emoção, humor, insight,
 * pergunta, palavras-chave, energia e frase completa). Não depende
 * de IA externa nem de binários de mídia.
 * =======================================================*/
import { CRITERIA } from './profiles.js';

const _log = (...a) => console.log('[AUTOCLIPS][analysis]', ...a);

/* Marcadores de sinal detectados no texto da fala. */
const HOOK_WORDS = ['segredo', 'ninguém', 'ninguem', 'descobri', 'olha isso', 'presta atenção', 'presta atencao', 'você não vai acreditar', 'voce nao vai acreditar', 'no começo', 'a verdade'];
const INSIGHT_WORDS = ['porque', 'por isso', 'então', 'entao', 'portanto', 'a chave', 'lição', 'licao', 'aprendi', 'dica', 'a ideia é', 'o ponto é'];
const QUESTION_WORDS = ['por quê', 'por que', 'como', 'o que', 'qual', 'quando', 'quem', 'será que'];
const LAUGH_RE = /(haha+|hehe+|kkk+|rsrs+|\[risos\]|\[rindo\]|risada)/i;
const EXCLAIM_RE = /[!]{1,}/;
const INTENSIFIER_RE = /\b(muito|demais|absurdo|incrível|incrivel|inacreditável|inacreditavel|terrível|terrivel|perfeito|horrível|horrivel|melhor|pior|nunca|sempre)\b/i;

export function normalizeSegments(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  for (const raw of arr) {
    if (!raw) continue;
    const start = Number(raw.start);
    let end = Number(raw.end);
    if (!Number.isFinite(start)) continue;
    if (!Number.isFinite(end) || end <= start) end = start + 5;
    const text = String(raw.text || raw.content || '').trim();
    const energy = Number.isFinite(Number(raw.energy)) ? Math.max(0, Math.min(1, Number(raw.energy))) : null;
    out.push({ start, end, text, speaker: String(raw.speaker || '').trim(), energy });
  }
  return out.sort((a, b) => a.start - b.start);
}

/* Decompõe o texto em sinais 0..1 (ou bruto, para energia). */
function signalsOf(seg) {
  const t = String(seg.text || '');
  const low = t.toLowerCase();
  const words = low.split(/\s+/).filter(Boolean).length;

  const hook = HOOK_WORDS.some((w) => low.indexOf(w) >= 0) ? 1 : 0;
  const insight = INSIGHT_WORDS.some((w) => low.indexOf(w) >= 0) ? 1 : 0;
  const laugh = LAUGH_RE.test(t) ? 1 : 0;
  const question = (t.indexOf('?') >= 0 || QUESTION_WORDS.some((w) => low.indexOf(w) >= 0)) ? 1 : 0;

  let emotion = 0;
  if (EXCLAIM_RE.test(t)) emotion += 0.5;
  if (INTENSIFIER_RE.test(t)) emotion += 0.4;
  if (/\b[A-ZÀ-Ú]{3,}\b/.test(t)) emotion += 0.2;
  emotion = Math.min(1, emotion);

  let energy = seg.energy;
  if (energy === null) {
    // estimativa simples quando não há medição: frases curtas e com pontuação soam mais dinâmicas
    const density = words > 0 ? Math.min(1, words / 18) : 0;
    energy = Math.min(1, 0.35 + density * 0.4 + (emotion ? 0.2 : 0) + (question ? 0.1 : 0));
  }

  const complete = /[.!?…]$/.test(t.trim()) ? 1 : 0;

  return { hook, emotion, laugh, insight, question, energy, complete };
}

function keywordScore(text, keywords) {
  if (!keywords || !keywords.length) return 0;
  const low = String(text || '').toLowerCase();
  let hits = 0;
  for (const k of keywords) if (k && low.indexOf(k) >= 0) hits++;
  if (!hits) return 0;
  return Math.min(1, hits / Math.max(1, Math.min(3, keywords.length)));
}

/* Pontuação 0..100 de um único segmento, conforme o perfil. */
export function scoreSegment(seg, profile) {
  const s = signalsOf(seg);
  const kw = keywordScore(seg.text, profile.keywords);
  const values = {
    hook: s.hook, emotion: s.emotion, laugh: s.laugh, insight: s.insight,
    question: s.question, keyword: kw, energy: s.energy, completeness: s.complete,
  };
  let weighted = 0;
  let totalWeight = 0;
  const breakdown = {};
  for (const c of CRITERIA) {
    const w = Number(profile.criteria[c]) || 0;
    const v = Number(values[c]) || 0;
    weighted += w * v;
    totalWeight += w;
    breakdown[c] = Math.round(v * 100);
  }
  const score = totalWeight > 0 ? Math.round((weighted / totalWeight) * 100) : 0;
  return { score, breakdown };
}

/* Encontra janelas (momentos) que respeitam a duração do perfil. */
export function findCandidates(segments, profile) {
  const segs = normalizeSegments(segments);
  const candidates = [];
  for (let i = 0; i < segs.length; i++) {
    // Agrupa segmentos consecutivos até atingir a janela mínima.
    let j = i;
    let start = segs[i].start;
    let end = segs[i].end;
    while (end - start < profile.minDuration && j + 1 < segs.length) {
      j++;
      end = segs[j].end;
    }
    const duration = end - start;
    if (duration < profile.minDuration) continue;
    // Corta a janela ao limite máximo do perfil.
    let winEnd = end;
    if (duration > profile.maxDuration) winEnd = start + profile.maxDuration;
    const text = segs.slice(i, j + 1).map((x) => x.text).filter(Boolean).join(' ');
    const scored = scoreSegment({ start, end: winEnd, text, energy: avgEnergy(segs.slice(i, j + 1)) }, profile);
    candidates.push({
      start: Math.round(start * 100) / 100,
      end: Math.round(winEnd * 100) / 100,
      duration: Math.round((winEnd - start) * 100) / 100,
      text,
      segmentRange: [i, j],
      score: scored.score,
      breakdown: scored.breakdown,
    });
  }
  return candidates;
}

function avgEnergy(segs) {
  const vals = segs.map((s) => s.energy).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/* Seleciona os melhores momentos: acima da pontuação mínima, sem
 * sobreposição e respeitando a distância mínima entre cortes. */
export function selectMoments(candidates, profile) {
  const ranked = candidates.slice().sort((a, b) => b.score - a.score || a.start - b.start);
  const chosen = [];
  for (const c of ranked) {
    if (c.score < profile.minScore) continue;
    const overlaps = chosen.some((x) => !(c.end <= x.start || c.start >= x.end));
    if (overlaps) continue;
    const tooClose = chosen.some((x) => Math.abs(c.start - x.start) < profile.minSpacing);
    if (tooClose) continue;
    chosen.push(c);
    if (chosen.length >= profile.maxCuts) break;
  }
  return chosen.sort((a, b) => a.start - b.start);
}

/* Análise completa de uma tarefa. */
export function analyze({ segments, profile }) {
  const segs = normalizeSegments(segments);
  if (!segs.length) {
    return { ok: false, reason: 'Sem transcrição para analisar. Envie os segmentos (início, fim e texto).' };
  }
  const totalAnalyzed = segs.length;
  const candidates = findCandidates(segs, profile);
  const moments = selectMoments(candidates, profile);
  const avg = moments.length ? Math.round(moments.reduce((a, m) => a + m.score, 0) / moments.length) : 0;
  _log(`analyze: ${totalAnalyzed} segmento(s) → ${candidates.length} candidato(s) → ${moments.length} momento(s), média ${avg}`);
  return {
    ok: true,
    result: {
      totalAnalyzed,
      candidatesCount: candidates.length,
      averageScore: avg,
      minScore: profile.minScore,
      profile: profile.key,
      moments: moments.map((m) => ({
        start: m.start, end: m.end, duration: m.duration, score: m.score,
        breakdown: m.breakdown, text: m.text.slice(0, 400),
      })),
    },
  };
}

/* =========================================================
 * autoclips/metadata.js — Metadados do vídeo (7.6)
 * ---------------------------------------------------------
 * Gera título, descrição, tags, hashtags, capítulos e texto de
 * miniatura a partir do plano de edição e do perfil escolhido.
 * É determinístico (sem IA): usa os trechos selecionados e as
 * palavras-chave do perfil.
 * =======================================================*/

const STOPWORDS = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'que', 'é', 'em',
  'um', 'uma', 'para', 'com', 'no', 'na', 'nos', 'nas', 'por', 'se', 'ao', 'à', 'como', 'mais', 'mas',
  'já', 'não', 'nao', 'eu', 'você', 'voce', 'ele', 'ela', 'isso', 'aqui', 'pra', 'tem', 'vai', 'the', 'a']);

function freqWords(text, limit) {
  const counts = new Map();
  const words = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/);
  for (const w of words) {
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map((x) => x[0]);
}

function titleCase(s) {
  return String(s || '').replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

function formatTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? pad(h) + ':' + pad(m) + ':' + pad(r) : pad(m) + ':' + pad(r);
}

/* Capítulos (marcações de tempo) a partir dos cortes do plano. */
export function buildChapters(plan) {
  const cuts = (plan && plan.cuts) || [];
  let acc = 0;
  const chapters = [];
  for (const c of cuts) {
    chapters.push({ at: Math.round(acc * 100) / 100, time: formatTime(acc), title: c.title || ('Corte ' + c.index) });
    acc += c.duration || 0;
  }
  return chapters;
}

/* Gera os metadados completos. */
export function buildMetadata({ plan, job, profile, options = {} }) {
  const cuts = (plan && plan.cuts) || [];
  if (!cuts.length) return { ok: false, reason: 'Plano de edição vazio. Nada para descrever.' };

  const allText = cuts.map((c) => c.text).join(' ');
  const keywords = freqWords(allText, 12);
  const profileWords = (profile && profile.keywords) || [];
  const merged = Array.from(new Set(profileWords.concat(keywords))).slice(0, 15);

  const baseName = String((job && (job.title || job.name)) || options.title || 'Vídeo').trim();
  const theme = merged.slice(0, 3).map(titleCase).join(' · ') || 'Melhores momentos';
  const first = cuts[0].title || theme;
  const hook = cuts.slice().sort((a, b) => b.score - a.score)[0];

  const title = String(options.title || (first + ' — ' + theme)).slice(0, 100);

  const chapters = buildChapters(plan);
  const descLines = [
    String(options.description || '').trim() || (hook ? hook.title + '.' : theme + '.'),
    '',
    'Neste vídeo (' + (profile ? profile.label : 'AutoClips') + '):',
  ];
  for (const ch of chapters) descLines.push(ch.time + '  ' + ch.title);
  descLines.push('');
  descLines.push('Gerado com AutoClips AI.');
  const description = descLines.join('\n').slice(0, 4800);

  const tags = merged.map((t) => t.toLowerCase()).slice(0, 15);
  const hashtags = merged.slice(0, 5).map((t) => '#' + t.replace(/\s+/g, '')).concat(['#shorts', '#autoclips']).slice(0, 7);

  const thumbnailText = (hook ? (hook.title || '') : theme).split(/\s+/).slice(0, 4).join(' ').slice(0, 40);

  const metadata = {
    title,
    description,
    tags,
    hashtags,
    chapters,
    thumbnailText,
    language: String(options.language || 'pt-BR'),
    aspect: plan.aspect,
    cutsCount: cuts.length,
    totalDuration: plan.totalDuration,
    profile: plan.profile,
    generatedAt: new Date().toISOString(),
  };
  return { ok: true, metadata };
}

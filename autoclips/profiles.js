/* =========================================================
 * autoclips/profiles.js — Perfis de edição reutilizáveis
 * ---------------------------------------------------------
 * Cada perfil descreve COMO o AutoClips deve escolher e montar os
 * cortes: critérios (com pesos), pontuação mínima, quantidade de
 * cortes, duração mínima/máxima, distância mínima entre cortes,
 * proporção (vertical/horizontal) e estilo de legendas.
 *
 * Perfis prontos: Podcast, Humor, Educativo, Entrevistas, Reações,
 * Debates, Melhores Momentos e Personalizado. O perfil Personalizado
 * parte dos padrões e é ajustável pelo usuário.
 * =======================================================*/

export const CRITERIA = ['hook', 'emotion', 'laugh', 'insight', 'question', 'keyword', 'energy', 'completeness'];

export const CRITERIA_LABELS = {
  hook: 'Gancho (prende atenção)',
  emotion: 'Emoção / intensidade',
  laugh: 'Humor / risadas',
  insight: 'Insight / informação útil',
  question: 'Pergunta / curiosidade',
  keyword: 'Palavras-chave do tema',
  energy: 'Energia / dinâmica da fala',
  completeness: 'Frase completa (começo e fim)',
};

export const ASPECTS = ['9:16', '1:1', '16:9'];

const baseCriteria = {
  hook: 1, emotion: 1, laugh: 0, insight: 1, question: 0.5, keyword: 1, energy: 0.7, completeness: 1,
};

/* Perfis prontos. Cada um é apenas configuração — nada de código. */
const PRESETS = [
  {
    key: 'podcast',
    label: 'Podcast',
    description: 'Trechos de conversa longa com ideias fortes e frases completas.',
    criteria: { hook: 1.2, emotion: 0.8, laugh: 0.4, insight: 1.4, question: 0.8, keyword: 1, energy: 0.6, completeness: 1.2 },
    keywords: ['segredo', 'história', 'importante', 'aprendi', 'na prática', 'conselho', 'carreira'],
    minScore: 55,
    maxCuts: 6,
    minDuration: 35,
    maxDuration: 90,
    minSpacing: 20,
    aspect: '9:16',
    captions: { enabled: true, style: 'podcast' },
    tone: 'conversa',
  },
  {
    key: 'humor',
    label: 'Humor',
    description: 'Momentos engraçados, piadas e reações rápidas.',
    criteria: { hook: 1.1, emotion: 1.2, laugh: 2, insight: 0.3, question: 0.4, keyword: 0.6, energy: 1.2, completeness: 0.8 },
    keywords: ['gente', 'sério', 'não acredito', 'haha', 'engraçado', 'piada', 'ridículo'],
    minScore: 50,
    maxCuts: 8,
    minDuration: 12,
    maxDuration: 45,
    minSpacing: 8,
    aspect: '9:16',
    captions: { enabled: true, style: 'impacto' },
    tone: 'divertido',
  },
  {
    key: 'educativo',
    label: 'Educativo',
    description: 'Explicações e dicas com informação útil e clara.',
    criteria: { hook: 1, emotion: 0.5, laugh: 0, insight: 2, question: 0.8, keyword: 1.4, energy: 0.5, completeness: 1.4 },
    keywords: ['como', 'passo', 'dica', 'porque', 'exemplo', 'conceito', 'aprender', 'aula'],
    minScore: 60,
    maxCuts: 5,
    minDuration: 45,
    maxDuration: 120,
    minSpacing: 30,
    aspect: '9:16',
    captions: { enabled: true, style: 'didatico' },
    tone: 'didático',
  },
  {
    key: 'entrevistas',
    label: 'Entrevistas',
    description: 'Perguntas e respostas com respostas marcantes.',
    criteria: { hook: 1, emotion: 1, laugh: 0.3, insight: 1.3, question: 1.2, keyword: 1, energy: 0.7, completeness: 1.3 },
    keywords: ['você', 'por quê', 'conte', 'explique', 'na sua opinião', 'experiência'],
    minScore: 55,
    maxCuts: 6,
    minDuration: 30,
    maxDuration: 90,
    minSpacing: 20,
    aspect: '9:16',
    captions: { enabled: true, style: 'entrevista' },
    tone: 'entrevista',
  },
  {
    key: 'reacoes',
    label: 'Reações',
    description: 'Reações intensas a vídeos, jogos ou situações.',
    criteria: { hook: 1.1, emotion: 2, laugh: 1.2, insight: 0.3, question: 0.4, keyword: 0.7, energy: 1.6, completeness: 0.7 },
    keywords: ['olha isso', 'não pode', 'meu deus', 'que isso', 'impossível', 'chocante'],
    minScore: 52,
    maxCuts: 8,
    minDuration: 10,
    maxDuration: 40,
    minSpacing: 8,
    aspect: '9:16',
    captions: { enabled: true, style: 'impacto' },
    tone: 'empolgado',
  },
  {
    key: 'debates',
    label: 'Debates',
    description: 'Confronto de ideias, argumentos e réplicas.',
    criteria: { hook: 1.1, emotion: 1.3, laugh: 0.4, insight: 1.2, question: 1, keyword: 1.1, energy: 1.2, completeness: 1 },
    keywords: ['discordo', 'concordo', 'por outro lado', 'argumento', 'na verdade', 'prova'],
    minScore: 55,
    maxCuts: 6,
    minDuration: 25,
    maxDuration: 80,
    minSpacing: 15,
    aspect: '9:16',
    captions: { enabled: true, style: 'debate' },
    tone: 'debate',
  },
  {
    key: 'melhores-momentos',
    label: 'Melhores Momentos',
    description: 'Compilado dos melhores trechos de um vídeo longo.',
    criteria: { hook: 1.3, emotion: 1.2, laugh: 1, insight: 1.3, question: 0.7, keyword: 1, energy: 1.1, completeness: 0.9 },
    keywords: ['melhor', 'incrível', 'importante', 'top', 'inesquecível', 'prêmio'],
    minScore: 65,
    maxCuts: 10,
    minDuration: 15,
    maxDuration: 60,
    minSpacing: 12,
    aspect: '9:16',
    captions: { enabled: true, style: 'impacto' },
    tone: 'destaque',
  },
  {
    key: 'personalizado',
    label: 'Personalizado',
    description: 'Ajuste livre dos critérios, quantidades e durações.',
    criteria: Object.assign({}, baseCriteria),
    keywords: [],
    minScore: 50,
    maxCuts: 6,
    minDuration: 20,
    maxDuration: 60,
    minSpacing: 10,
    aspect: '9:16',
    captions: { enabled: true, style: 'padrao' },
    tone: 'neutro',
  },
];

export const PROFILES = PRESETS;

export function profileByKey(key) {
  const k = String(key || '').trim().toLowerCase();
  return PRESETS.find((p) => p.key === k) || null;
}

function num(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/* Normaliza um perfil (pronto ou informado pelo usuário). */
export function normalizeProfile(input) {
  const base = profileByKey(input && (input.key || input.profile)) || PRESETS[0];
  const src = input && typeof input === 'object' ? input : {};
  const criteria = Object.assign({}, base.criteria);
  if (src.criteria && typeof src.criteria === 'object') {
    for (const k of CRITERIA) if (src.criteria[k] !== undefined) criteria[k] = num(src.criteria[k], criteria[k], 0, 3);
  }
  const keywords = Array.isArray(src.keywords)
    ? src.keywords.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean).slice(0, 40)
    : base.keywords.slice();

  const minDuration = num(src.minDuration, base.minDuration, 5, 600);
  const maxDuration = Math.max(minDuration, num(src.maxDuration, base.maxDuration, minDuration, 900));

  return {
    key: base.key,
    label: String(src.label || base.label).slice(0, 60),
    description: String(src.description || base.description).slice(0, 240),
    criteria,
    keywords,
    minScore: num(src.minScore, base.minScore, 0, 100),
    maxCuts: Math.round(num(src.maxCuts, base.maxCuts, 1, 50)),
    minDuration,
    maxDuration,
    minSpacing: num(src.minSpacing, base.minSpacing, 0, 300),
    aspect: ASPECTS.includes(src.aspect) ? src.aspect : base.aspect,
    captions: {
      enabled: src.captions && src.captions.enabled !== undefined ? src.captions.enabled !== false : base.captions.enabled,
      style: String((src.captions && src.captions.style) || base.captions.style).slice(0, 30),
    },
    tone: String(src.tone || base.tone).slice(0, 30),
  };
}

/* Lista de perfis exposta à interface. */
export function listProfiles() {
  return PROFILES.map((p) => ({
    key: p.key,
    label: p.label,
    description: p.description,
    criteria: p.criteria,
    keywords: p.keywords,
    minScore: p.minScore,
    maxCuts: p.maxCuts,
    minDuration: p.minDuration,
    maxDuration: p.maxDuration,
    minSpacing: p.minSpacing,
    aspect: p.aspect,
    captions: p.captions,
    tone: p.tone,
  }));
}

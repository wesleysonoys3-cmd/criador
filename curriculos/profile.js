/* =========================================================
 * curriculos/profile.js — Modelo do currículo + guarda anti-invenção
 * ---------------------------------------------------------
 * Funções PURAS (sem I/O). O perfil guarda SOMENTE dados fornecidos
 * pelo usuário. A IA pode reescrever/organizar, nunca criar fatos.
 * =======================================================*/

/** Seções canônicas (a ordem pode variar por template/perfil). */
export const SECTION_DEFS = [
  { id: 'resumo', title: 'Resumo Profissional' },
  { id: 'objetivo', title: 'Objetivo' },
  { id: 'experiencia', title: 'Experiência Profissional' },
  { id: 'projetos', title: 'Projetos' },
  { id: 'formacao', title: 'Formação Acadêmica' },
  { id: 'cursos', title: 'Cursos e Certificações' },
  { id: 'competencias', title: 'Competências Técnicas' },
  { id: 'comportamentais', title: 'Habilidades Comportamentais' },
  { id: 'idiomas', title: 'Idiomas' },
  { id: 'resultados', title: 'Resultados e Conquistas' },
];

export const TEMPLATES = [
  { id: 'moderno', name: 'Profissional Moderno', desc: 'Coluna única com cabeçalho destacado. Equilibrado e compatível com ATS.', bestFor: ['tecnologia', 'marketing', 'administracao'] },
  { id: 'executivo', name: 'Executivo', desc: 'Foco em resultados, liderança e trajetória. Sóbrio e direto.', bestFor: ['administracao', 'engenharia', 'vendas', 'rh'] },
  { id: 'minimalista', name: 'Minimalista', desc: 'Texto puro, sem elementos gráficos. Máxima legibilidade por ATS.', bestFor: ['primeiro-emprego', 'servicos-gerais', 'logistica'] },
  { id: 'primeiro-emprego', name: 'Primeiro Emprego', desc: 'Valoriza formação, cursos, projetos e potencial.', bestFor: ['primeiro-emprego'] },
  { id: 'tecnico', name: 'Técnico', desc: 'Destaca ferramentas, competências técnicas e atividades.', bestFor: ['tecnologia', 'construcao', 'logistica', 'engenharia'] },
  { id: 'academico', name: 'Acadêmico', desc: 'Formação, projetos, publicações e cursos em destaque.', bestFor: ['educacao', 'saude'] },
  { id: 'criativo', name: 'Criativo', desc: 'Cabeçalho marcante com acentos de cor, mantendo estrutura legível.', bestFor: ['marketing'] },
];

export function emptyProfile() {
  return {
    fullName: '', headline: '', objective: '',
    email: '', phone: '', city: '', state: '', country: 'Brasil',
    links: [],
    summary: '',
    experiences: [], education: [], courses: [], certifications: [],
    skills: { technical: [], behavioral: [], tools: [] },
    languages: [], projects: [], achievements: [],
  };
}

const s = (v) => String(v === null || v === undefined ? '' : v).trim();
const arr = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
const arrStr = (v) => arr(v).map(x => s(typeof x === 'object' && x ? (x.text || x.valor || x.value || x.name || '') : x)).filter(Boolean);

/** Normaliza qualquer entrada (inclusive rascunho da IA) para o perfil canônico. */
export function normalizeProfile(raw) {
  const p = emptyProfile();
  const r = raw && typeof raw === 'object' ? raw : {};

  p.fullName = s(r.fullName || r.nome || r.name);
  p.headline = s(r.headline || r.titulo || r.cargo || r.profissao);
  p.objective = s(r.objective || r.objetivo);
  p.email = s(r.email);
  p.phone = s(r.phone || r.telefone || r.celular);
  p.city = s(r.city || r.cidade);
  p.state = s(r.state || r.estado || r.uf);
  p.country = s(r.country || r.pais) || 'Brasil';
  p.summary = s(r.summary || r.resumo);

  p.links = arr(r.links).map(l => {
    if (typeof l === 'string') return { label: 'Link', url: s(l) };
    return { label: s(l?.label || l?.rotulo) || 'Link', url: s(l?.url || l?.link) };
  }).filter(l => l.url);

  p.experiences = arr(r.experiences || r.experiencias).map(e => ({
    company: s(e?.company || e?.empresa),
    role: s(e?.role || e?.cargo || e?.funcao),
    start: s(e?.start || e?.inicio),
    end: s(e?.end || e?.fim),
    current: !!(e?.current || e?.atual),
    location: s(e?.location || e?.local),
    bullets: arrStr(e?.bullets || e?.atividades || e?.activities || e?.descricao),
    results: arrStr(e?.results || e?.resultados),
    technologies: arrStr(e?.technologies || e?.tecnologias),
  })).filter(e => e.company || e.role || e.bullets.length);

  p.education = arr(r.education || r.formacao).map(e => ({
    institution: s(e?.institution || e?.instituicao),
    course: s(e?.course || e?.curso),
    level: s(e?.level || e?.nivel),
    start: s(e?.start || e?.inicio),
    end: s(e?.end || e?.fim || e?.conclusao),
    status: s(e?.status),
  })).filter(e => e.institution || e.course);

  p.courses = arr(r.courses || r.cursos).map(c => ({
    name: s(c?.name || c?.nome || c),
    institution: s(c?.institution || c?.instituicao),
    year: s(c?.year || c?.ano),
    hours: s(c?.hours || c?.carga),
  })).filter(c => c.name);

  p.certifications = arr(r.certifications || r.certificacoes).map(c => ({
    name: s(c?.name || c?.nome || c),
    issuer: s(c?.issuer || c?.emissor),
    year: s(c?.year || c?.ano),
  })).filter(c => c.name);

  const sk = r.skills || {};
  p.skills = {
    technical: arrStr(sk.technical || sk.tecnicas || r.competencias || r.technical),
    behavioral: arrStr(sk.behavioral || sk.comportamentais || sk.soft),
    tools: arrStr(sk.tools || sk.ferramentas),
  };

  p.languages = arr(r.languages || r.idiomas).map(l => {
    if (typeof l === 'string') return { name: s(l), level: '' };
    return { name: s(l?.name || l?.idioma), level: s(l?.level || l?.nivel) };
  }).filter(l => l.name);

  p.projects = arr(r.projects || r.projetos).map(pr => ({
    name: s(pr?.name || pr?.nome),
    description: s(pr?.description || pr?.descricao),
    link: s(pr?.link),
    bullets: arrStr(pr?.bullets || pr?.resultados || pr?.results),
  })).filter(pr => pr.name || pr.description);

  p.achievements = arrStr(r.achievements || r.conquistas || r.resultados);

  return p;
}

/** Entidades factuais citadas pelo usuário (usadas na guarda anti-invenção). */
export function knownEntities(profile) {
  const p = normalizeProfile(profile);
  const set = new Set();
  const add = (v) => { const x = s(v).toLowerCase(); if (x) set.add(x); };
  for (const e of p.experiences) { add(e.company); }
  for (const e of p.education) { add(e.institution); add(e.course); }
  for (const c of p.courses) { add(c.name); add(c.institution); }
  for (const c of p.certifications) { add(c.name); add(c.issuer); }
  for (const l of p.languages) { add(l.name); }
  for (const pr of p.projects) { add(pr.name); }
  return set;
}

function isKnown(value, set) {
  const v = s(value).toLowerCase();
  if (!v) return true; // vazio não é invenção
  if (set.has(v)) return true;
  // aceita correspondência parcial quando o nome do usuário está contido (ex.: "Google Brasil" vs "Google")
  for (const k of set) {
    if (!k) continue;
    if (v.includes(k) || k.includes(v)) return true;
  }
  return false;
}

/**
 * Remove do currículo gerado tudo que NÃO existe nos dados originais do usuário.
 * Nunca inventar empresas, cursos, instituições, certificações, idiomas ou projetos.
 * @returns {{profile:object, removed:Array<{kind:string,value:string}>}}
 */
export function guardNoFabrication(candidate, source) {
  const src = normalizeProfile(source);
  const known = knownEntities(src);
  const cand = normalizeProfile(candidate);
  const removed = [];

  cand.experiences = cand.experiences.filter(e => {
    if (isKnown(e.company, known)) return true;
    removed.push({ kind: 'empresa', value: e.company });
    return false;
  });
  cand.education = cand.education.filter(e => {
    const okInst = isKnown(e.institution, known);
    const okCourse = isKnown(e.course, known);
    if (okInst && okCourse) return true;
    removed.push({ kind: 'formação', value: e.institution || e.course });
    return false;
  });
  cand.courses = cand.courses.filter(c => {
    if (isKnown(c.name, known)) return true;
    removed.push({ kind: 'curso', value: c.name });
    return false;
  });
  cand.certifications = cand.certifications.filter(c => {
    if (isKnown(c.name, known)) return true;
    removed.push({ kind: 'certificação', value: c.name });
    return false;
  });
  cand.languages = cand.languages.filter(l => {
    if (isKnown(l.name, known)) return true;
    removed.push({ kind: 'idioma', value: l.name });
    return false;
  });
  cand.projects = cand.projects.filter(pr => {
    if (isKnown(pr.name, known)) return true;
    removed.push({ kind: 'projeto', value: pr.name });
    return false;
  });

  // Campos de identidade nunca podem ser alterados pela IA.
  cand.fullName = src.fullName || cand.fullName;
  cand.email = src.email || '';
  cand.phone = src.phone || '';
  cand.city = src.city || '';
  cand.state = src.state || '';
  cand.country = src.country || 'Brasil';
  cand.links = src.links;

  return { profile: cand, removed };
}

/** Deriva a ordem de seções a ser exibida, conforme perfil e template. */
export function resolveSectionOrder(profile, templateId) {
  const p = normalizeProfile(profile);
  const hasExp = p.experiences.length > 0;
  const base = templateId === 'primeiro-emprego' || (!hasExp)
    ? ['objetivo', 'formacao', 'cursos', 'competencias', 'projetos', 'comportamentais', 'idiomas', 'experiencia', 'resultados']
    : templateId === 'academico'
      ? ['resumo', 'formacao', 'projetos', 'cursos', 'competencias', 'experiencia', 'idiomas', 'comportamentais', 'resultados']
      : ['resumo', 'competencias', 'experiencia', 'projetos', 'formacao', 'cursos', 'resultados', 'idiomas', 'comportamentais', 'objetivo'];
  return base.filter(id => {
    if (id === 'experiencia') return p.experiences.length > 0 || hasExp;
    if (id === 'formacao') return p.education.length > 0;
    if (id === 'cursos') return p.courses.length > 0 || p.certifications.length > 0;
    if (id === 'competencias') return (p.skills.technical.length + p.skills.tools.length) > 0;
    if (id === 'comportamentais') return p.skills.behavioral.length > 0;
    if (id === 'idiomas') return p.languages.length > 0;
    if (id === 'projetos') return p.projects.length > 0;
    if (id === 'resultados') return p.achievements.length > 0;
    if (id === 'resumo') return !!p.summary;
    if (id === 'objetivo') return !!p.objective;
    return false;
  });
}

/** Sugere o template mais adequado ao perfil (o usuário sempre pode trocar). */
export function suggestTemplate(profile, areaId) {
  const p = normalizeProfile(profile);
  if (!p.experiences.length) return 'primeiro-emprego';
  const byArea = TEMPLATES.find(t => (t.bestFor || []).includes(areaId));
  return byArea ? byArea.id : 'moderno';
}

export default {
  SECTION_DEFS, TEMPLATES, emptyProfile, normalizeProfile, knownEntities,
  guardNoFabrication, resolveSectionOrder, suggestTemplate,
};

/* =========================================================
 * curriculos/ats.js — Análise ATS e pontuação de qualidade (0–100)
 * ---------------------------------------------------------
 * 100% determinístico (sem IA): o resultado é reproduzível e auditável.
 * A pontuação mede QUALIDADE DOCUMENTAL, nunca probabilidade de contratação.
 * =======================================================*/
import { normalizeProfile, SECTION_DEFS } from './profile.js';
import { getArea } from './areas.js';

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'as', 'os', 'para', 'por', 'com', 'sem', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'que', 'se', 'ao', 'aos', 'à', 'às', 'como', 'mais', 'menos', 'sobre', 'entre', 'ou', 'ser', 'são', 'ter', 'tem', 'terá', 'seu', 'sua', 'seus', 'suas', 'nossa', 'nosso', 'this', 'the', 'and', 'for', 'with', 'you', 'will', 'are']);

/** Extrai termos relevantes de uma descrição de vaga. */
export function extractKeywords(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return [];
  const cleaned = t.replace(/[^a-z0-9à-úçãõáéíóêôü\s+-]/gi, ' ');
  const words = cleaned.split(/\s+/).map(w => w.trim()).filter(Boolean);
  const freq = new Map();
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  // termos compostos curtos também contam (ex.: "power bi", "contas a pagar")
  for (const term of ['power bi', 'contas a pagar', 'contas a receber', 'atendimento ao cliente', 'trabalho em equipe', 'pacote office', 'excel avançado', 'tráfego pago', 'mídias sociais', 'departamento pessoal', 'segurança do trabalho', 'customer success', 'machine learning', 'análise de dados']) {
    if (t.includes(term)) freq.set(term, (freq.get(term) || 0) + 3);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w]) => w);
}

const ACTION_VERBS = ['desenvolvi', 'implementei', 'criei', 'elaborei', 'organizei', 'reduzi', 'aumentei', 'otimizei', 'automatizei', 'coordenei', 'liderei', 'gerenciei', 'atendi', 'realizei', 'executei', 'acompanhei', 'controlei', 'implantei', 'treinei', 'analisei', 'melhorei', 'negociei', 'planejei', 'supervisionei', 'conduzi', 'estruturei', 'geri', 'responsável por'];

function textOfProfile(p) {
  const parts = [];
  const push = (v) => { if (v) parts.push(String(v)); };
  push(p.headline); push(p.summary); push(p.objective);
  p.experiences.forEach(e => { push(e.role); push(e.company); e.bullets.forEach(push); e.results.forEach(push); e.technologies.forEach(push); });
  p.education.forEach(e => { push(e.course); push(e.institution); });
  p.courses.forEach(c => { push(c.name); });
  p.certifications.forEach(c => { push(c.name); });
  [...p.skills.technical, ...p.skills.behavioral, ...p.skills.tools].forEach(push);
  p.languages.forEach(l => push(l.name));
  p.projects.forEach(pr => { push(pr.name); push(pr.description); pr.bullets.forEach(push); });
  p.achievements.forEach(push);
  return parts.join(' \n ');
}

function allBullets(p) {
  const out = [];
  p.experiences.forEach(e => { out.push(...e.bullets); out.push(...e.results); });
  p.projects.forEach(pr => out.push(...pr.bullets));
  return out;
}

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)));

/** Compatibilidade entre requisitos da vaga e o perfil real. */
export function atsReport(profile, jobDescription, areaId) {
  const p = normalizeProfile(profile);
  const area = getArea(areaId);
  const hasJob = !!String(jobDescription || '').trim();
  const jobKw = hasJob ? extractKeywords(jobDescription) : [];
  const corpus = textOfProfile(p).toLowerCase();

  const targetKw = hasJob
    ? jobKw
    : (area ? [...area.atsTerms.map(t => t.toLowerCase()), ...area.competencies.map(c => c.toLowerCase())] : []);

  const atendidos = [];
  const parciais = [];
  const ausentes = [];
  for (const kw of targetKw) {
    const k = String(kw).toLowerCase();
    if (!k) continue;
    if (corpus.includes(k)) atendidos.push(kw);
    else {
      const stem = k.slice(0, Math.max(4, k.length - 2));
      if (stem && corpus.includes(stem)) parciais.push(kw);
      else ausentes.push(kw);
    }
  }

  const sugestoes = [];
  for (const kw of ausentes.slice(0, 12)) {
    sugestoes.push(`Se você realmente tem experiência com "${kw}", inclua esse termo em uma atividade ou competência. Se não tem, não adicione.`);
  }

  return {
    base: hasJob ? 'vaga' : 'area',
    baseLabel: hasJob ? 'Descrição da vaga informada' : (area ? `Termos típicos da área: ${area.name}` : 'Sem referência'),
    keywords: targetKw,
    atendidos, parciais, ausentes, sugestoes,
    cobertura: targetKw.length ? Math.round((atendidos.length / targetKw.length) * 100) : null,
  };
}

/** Pontuação de qualidade 0–100 em 7 dimensões + total ponderado. */
export function scoreResume(profile, jobDescription, areaId) {
  const p = normalizeProfile(profile);
  const area = getArea(areaId);
  const bullets = allBullets(p);
  const dims = [];

  /* 1. Organização */
  const presentSections = SECTION_DEFS.filter(def => {
    if (def.id === 'experiencia') return p.experiences.length > 0;
    if (def.id === 'formacao') return p.education.length > 0;
    if (def.id === 'cursos') return p.courses.length > 0 || p.certifications.length > 0;
    if (def.id === 'competencias') return (p.skills.technical.length + p.skills.tools.length) > 0;
    if (def.id === 'comportamentais') return p.skills.behavioral.length > 0;
    if (def.id === 'idiomas') return p.languages.length > 0;
    if (def.id === 'resumo') return !!p.summary;
    return false;
  }).length;
  const contactComplete = [p.fullName, p.email || p.phone, p.city || p.state].filter(Boolean).length;
  let organizacao = clamp(30 + presentSections * 8 + contactComplete * 8);
  if (p.experiences.some(e => !e.start)) organizacao -= 8;
  dims.push({
    id: 'organizacao', label: 'Organização', score: organizacao,
    why: `${presentSections} seção(ões) com conteúdo e ${contactComplete}/3 dados de contato essenciais.`,
    how: presentSections < 4 ? 'Adicione seções que você realmente tem (formação, competências, cursos) para dar estrutura ao documento.' : 'Estrutura adequada. Mantenha as seções na ordem padrão.',
  });

  /* 2. Clareza */
  const avgLen = bullets.length ? bullets.reduce((a, b) => a + String(b).length, 0) / bullets.length : 0;
  let clareza = 40;
  if (bullets.length) {
    clareza = 100;
    if (avgLen < 35) clareza -= 25;
    if (avgLen > 240) clareza -= 25;
    const tooLong = bullets.filter(b => String(b).length > 320).length;
    clareza -= Math.min(25, tooLong * 5);
    const caps = bullets.filter(b => String(b) === String(b).toUpperCase() && String(b).length > 25).length;
    clareza -= Math.min(20, caps * 6);
  }
  clareza = clamp(clareza);
  dims.push({
    id: 'clareza', label: 'Clareza', score: clareza,
    why: bullets.length ? `Média de ${Math.round(avgLen)} caracteres por item (ideal entre 60 e 200).` : 'Nenhuma descrição de atividade registrada ainda.',
    how: bullets.length ? (avgLen < 35 ? 'Detalhe melhor cada atividade: ação + contexto + resultado.' : avgLen > 240 ? 'Reduza itens muito longos; prefira frases diretas de até 2 linhas.' : 'Boa extensão. Mantenha frases curtas e diretas.')
      : 'Descreva suas atividades em itens curtos, começando com um verbo de ação.',
  });

  /* 3. Qualidade da escrita */
  let escrita = 50;
  if (bullets.length) {
    const startingVerb = bullets.filter(b => ACTION_VERBS.some(v => String(b).toLowerCase().trim().startsWith(v))).length;
    const withPunct = bullets.filter(b => /[.!]$/.test(String(b).trim())).length;
    const doubleSpaces = bullets.filter(b => /\s{2,}/.test(String(b))).length;
    escrita = 45 + (startingVerb / bullets.length) * 35 + (withPunct / bullets.length) * 20;
    escrita -= Math.min(20, doubleSpaces * 4);
  }
  escrita = clamp(escrita);
  dims.push({
    id: 'escrita', label: 'Qualidade da escrita', score: escrita,
    why: bullets.length ? `${bullets.filter(b => ACTION_VERBS.some(v => String(b).toLowerCase().trim().startsWith(v))).length}/${bullets.length} itens iniciam com verbo de ação.` : 'Sem textos para avaliar.',
    how: 'Comece cada item com um verbo no passado (Desenvolvi, Organizei, Reduzi) e encerre com ponto final.',
  });

  /* 4. Relevância profissional */
  const competencyHits = area ? area.competencies.filter(c => textOfProfile(p).toLowerCase().includes(c.toLowerCase().slice(0, 12))).length : 0;
  const filledAreas = [p.experiences.length > 0, p.education.length > 0, (p.skills.technical.length + p.skills.behavioral.length) > 0, p.courses.length > 0].filter(Boolean).length;
  const relevancia = clamp(30 + filledAreas * 12 + (area ? Math.min(24, competencyHits * 6) : 0));
  dims.push({
    id: 'relevancia', label: 'Relevância profissional', score: relevancia,
    why: area ? `${competencyHits} competência(s) típicas de ${area.name} identificadas no seu texto.` : 'Área profissional não definida.',
    how: 'Deixe explícitas as competências da sua área que você realmente domina.',
  });

  /* 5. Evidências de competências */
  const withNumbers = bullets.filter(b => /\d/.test(String(b))).length;
  const evidencias = bullets.length ? clamp(35 + (withNumbers / bullets.length) * 65) : 20;
  dims.push({
    id: 'evidencias', label: 'Evidências de competências', score: evidencias,
    why: bullets.length ? `${withNumbers} de ${bullets.length} itens trazem números/resultados.` : 'Sem itens para medir evidências.',
    how: 'Inclua números reais: quantidade, percentual, prazo, valor economizado, tamanho da equipe.',
  });

  /* 6. Compatibilidade com a vaga */
  const rep = atsReport(p, jobDescription, areaId);
  const compat = rep.cobertura === null ? clamp(relevancia * 0.7) : clamp(rep.cobertura);
  dims.push({
    id: 'compatibilidade', label: 'Compatibilidade com a vaga', score: compat,
    why: rep.cobertura === null
      ? 'Sem descrição de vaga informada — avaliação baseada apenas na área profissional.'
      : `${rep.atendidos.length} de ${rep.keywords.length} termos da referência aparecem no seu currículo.`,
    how: rep.cobertura === null ? 'Cole a descrição de uma vaga para medir aderência real.' : (rep.ausentes.length ? `Verifique se você realmente tem: ${rep.ausentes.slice(0, 6).join(', ')}.` : 'Boa aderência aos termos da referência.'),
  });

  /* 7. Legibilidade ATS */
  const txt = textOfProfile(p);
  let ats = 60;
  if (p.fullName) ats += 10;
  if (p.email || p.phone) ats += 10;
  if (txt.length > 400) ats += 10;
  if (txt.length > 1500) ats += 5;
  if ((txt.match(/[•|►◆▪]/g) || []).length === 0) ats += 5; // sem símbolos gráficos no texto
  if (/[^\x20-\x7E\u00A0-\u024F\n]/.test(txt)) ats -= 8;    // caracteres exóticos atrapalham extração
  ats = clamp(ats);
  dims.push({
    id: 'ats', label: 'Legibilidade ATS', score: ats,
    why: `${txt.length} caracteres de texto extraível, contato ${(p.email || p.phone) ? 'presente' : 'ausente'} em texto simples.`,
    how: 'Use títulos de seção padrão, sem tabelas, imagens, colunas ou ícones no lugar de texto.',
  });

  const weights = { organizacao: 0.15, clareza: 0.15, escrita: 0.12, relevancia: 0.18, evidencias: 0.15, compatibilidade: 0.15, ats: 0.10 };
  const total = clamp(dims.reduce((acc, d) => acc + d.score * (weights[d.id] || 0), 0));

  const improvements = dims.slice().sort((a, b) => a.score - b.score).slice(0, 4)
    .map(d => ({ dimension: d.label, score: d.score, how: d.how }));

  return {
    total,
    dimensions: dims,
    improvements,
    disclaimer: 'A pontuação mede a QUALIDADE DOCUMENTAL do currículo. Não é probabilidade de aprovação, contratação ou entrevista.',
  };
}

export default { extractKeywords, atsReport, scoreResume };

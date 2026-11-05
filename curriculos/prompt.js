/* =========================================================
 * curriculos/prompt.js — Prompts da IA (recrutamento e seleção)
 * ---------------------------------------------------------
 * Regra central em todos os prompts: NUNCA inventar fato.
 * A IA só reescreve, organiza e pergunta o que falta.
 * =======================================================*/
import { getArea } from './areas.js';
import { normalizeProfile, TEMPLATES, SECTION_DEFS } from './profile.js';

const PROFILE_SHAPE = `{
  "fullName": "", "headline": "", "objective": "", "email": "", "phone": "", "city": "", "state": "", "country": "",
  "summary": "",
  "experiences": [{ "company": "", "role": "", "start": "", "end": "", "current": false, "location": "", "bullets": ["atividade/resultado reescrito"], "results": [], "technologies": [] }],
  "education": [{ "institution": "", "course": "", "level": "", "start": "", "end": "", "status": "" }],
  "courses": [{ "name": "", "institution": "", "year": "", "hours": "" }],
  "certifications": [{ "name": "", "issuer": "", "year": "" }],
  "skills": { "technical": [], "behavioral": [], "tools": [] },
  "languages": [{ "name": "", "level": "" }],
  "projects": [{ "name": "", "description": "", "link": "", "bullets": [] }],
  "achievements": []
}`;

export const SYSTEM_RECRUITER = [
  'Você é um especialista sênior em Recrutamento e Seleção e em otimização de currículos para sistemas ATS no Brasil.',
  'Você escreve em português do Brasil, com linguagem profissional, objetiva e sem exageros.',
  '',
  'REGRAS ABSOLUTAS (violá-las invalida a resposta):',
  '1) NUNCA invente empresa, cargo, período, formação, curso, certificação, idioma, projeto, tecnologia, número ou resultado.',
  '2) Use SOMENTE informações fornecidas pelo candidato. Você pode reescrever, resumir, corrigir gramática e organizar.',
  '3) Se faltar informação essencial, faça uma PERGUNTA em vez de preencher por conta própria.',
  '4) Nunca prometa emprego, aprovação em processo seletivo ou entrevista.',
  '5) Não invente métricas. Só use números que o candidato informou.',
  '6) Responda SEMPRE e SOMENTE com JSON válido, sem comentários e sem texto fora do JSON.',
].join('\n');

function areaBlock(areaId) {
  const a = getArea(areaId);
  if (!a) return 'Área profissional: não informada.';
  return [
    `Área profissional: ${a.name}`,
    `Competências típicas da área (use APENAS como referência de linguagem, não como fato do candidato): ${a.competencies.join('; ')}`,
    `Atividades típicas (referência): ${a.activities.join('; ')}`,
    `Termos que ATS costumam buscar: ${a.atsTerms.join(', ')}`,
    `Exemplos de resultados quantificáveis (apenas para orientar perguntas): ${a.resultHints.join('; ')}`,
  ].join('\n');
}

/** Mensagem inicial de boas-vindas + primeiras perguntas. */
export function buildInterviewPrompt({ profile, areaId, areaHint, firstMessage }) {
  const p = normalizeProfile(profile);
  const missing = missingFields(p);
  const user = [
    areaBlock(areaId),
    areaHint ? `Indicação do usuário sobre a profissão/vaga desejada: ${areaHint}` : '',
    '',
    'DADOS JÁ CONHECIDOS DO CANDIDATO (JSON):',
    JSON.stringify(p).slice(0, 6000),
    '',
    `CAMPOS AINDA VAZIOS: ${missing.join(', ') || 'nenhum'}`,
    firstMessage ? `\nMENSAGEM DO CANDIDATO AGORA: "${firstMessage}"` : '',
    '',
    'TAREFA: conduza a entrevista para montar o currículo.',
    '- Se houver mensagem do candidato, extraia dela todos os dados reais e coloque no "patch".',
    '- Faça no máximo 4 perguntas, priorizando o que falta e o que mais melhora o currículo.',
    '- Cada pergunta precisa de um EXEMPLO de resposta pronto para o usuário se basear.',
    '- Se o candidato não tiver experiência, conduza para primeiro emprego/estágio (formação, cursos, projetos, voluntariado).',
    '- Não pergunte o que já está preenchido.',
    '',
    'RESPONDA SOMENTE COM ESTE JSON:',
    '{',
    '  "reply": "texto curto e acolhedor em português, dizendo o próximo passo",',
    '  "patch": { "apenas os campos que o candidato informou agora, no formato do perfil" },',
    '  "questions": [ { "field": "campo do perfil", "label": "pergunta", "example": "Ex.: ...", "why": "por que isso importa" } ],',
    '  "done": false',
    '}',
    '',
    'FORMATO DO PERFIL (para o "patch"):',
    PROFILE_SHAPE,
  ].filter(Boolean).join('\n');
  return { system: SYSTEM_RECRUITER, user };
}

/** Geração do currículo completo a partir dos dados coletados. */
export function buildGeneratePrompt({ profile, areaId, targetJob, templateId, onlyJson = true }) {
  const p = normalizeProfile(profile);
  const area = getArea(areaId);
  const tpl = TEMPLATES.find(t => t.id === templateId);
  const user = [
    areaBlock(areaId),
    targetJob && (targetJob.title || targetJob.description)
      ? `VAGA-ALVO: ${targetJob.title || '(sem título)'} ${targetJob.company ? '— ' + targetJob.company : ''}\nDESCRIÇÃO DA VAGA:\n${String(targetJob.description || '').slice(0, 4000)}`
      : 'VAGA-ALVO: não informada.',
    tpl ? `MODELO ESCOLHIDO: ${tpl.name} — ${tpl.desc}` : '',
    '',
    'DADOS REAIS DO CANDIDATO (única fonte permitida):',
    JSON.stringify(p).slice(0, 12000),
    '',
    'TAREFA: produzir a MELHOR versão do currículo usando SOMENTE os dados acima.',
    '- Reescreva atividades como itens iniciados por verbo de ação, no passado, com foco em responsabilidade e resultado.',
    '- Corrija gramática e ortografia.',
    '- Escreva um "summary" de 3 a 5 linhas específico para o perfil e a vaga (sem adjetivos vazios).',
    '- Organize competências em technical/behavioral/tools apenas com o que foi informado.',
    '- Se o candidato não tem experiência, valorize formação, cursos, projetos e potencial.',
    '- Se houver vaga-alvo, priorize no texto as competências que o candidato REALMENTE tem e que aparecem na vaga.',
    '- Aponte em "missingInfo" o que ficou faltando e em "recommendations" como melhorar.',
    onlyJson ? '- Responda SOMENTE com JSON válido.' : '',
    '',
    'RESPONDA SOMENTE COM ESTE JSON:',
    '{',
    '  "profile": ' + PROFILE_SHAPE + ',',
    '  "sectionOrder": ["ordem das seções"],',
    '  "templateId": "' + (templateId || 'moderno') + '",',
    '  "highlights": ["pontos fortes reais do candidato"],',
    '  "missingInfo": ["informação que falta e que o candidato deveria fornecer"],',
    '  "recommendations": ["como melhorar o currículo"]',
    '}',
    '',
    `Seções disponíveis: ${SECTION_DEFS.map(d => d.id).join(', ')}`,
    area ? `Área detectada: ${area.name}` : '',
  ].filter(Boolean).join('\n');
  return { system: SYSTEM_RECRUITER, user };
}

/** Ajuste/edição do currículo por conversa. */
export function buildEditPrompt({ profile, message }) {
  const p = normalizeProfile(profile);
  const user = [
    'CURRÍCULO ATUAL (JSON, dados reais do candidato):',
    JSON.stringify(p).slice(0, 12000),
    '',
    `PEDIDO DO CANDIDATO: "${String(message || '').slice(0, 1500)}"`,
    '',
    'TAREFA: aplicar o pedido editando o currículo.',
    '- Se o pedido acrescentar informação nova, use exatamente o que o candidato escreveu.',
    '- Se o pedido for ambíguo ou faltar dado, NÃO invente: faça uma pergunta em "reply" e devolva o perfil sem alteração inventada.',
    '- Nunca crie fatos que o candidato não forneceu.',
    '',
    'RESPONDA SOMENTE COM ESTE JSON:',
    '{',
    '  "reply": "o que foi feito, ou a pergunta que você precisa fazer",',
    '  "profile": ' + PROFILE_SHAPE + ',',
    '  "changed": true',
    '}',
  ].join('\n');
  return { system: SYSTEM_RECRUITER, user };
}

/** Análise qualitativa complementar (a nota numérica é sempre determinística). */
export function buildAnalysisPrompt({ profile, areaId, targetJob, ats }) {
  const p = normalizeProfile(profile);
  const user = [
    areaBlock(areaId),
    targetJob && targetJob.description ? `VAGA-ALVO:\n${String(targetJob.description).slice(0, 3000)}` : 'VAGA-ALVO: não informada.',
    '',
    'CURRÍCULO ATUAL (JSON):',
    JSON.stringify(p).slice(0, 10000),
    '',
    'ANÁLISE DETERMINÍSTICA JÁ CALCULADA (não recalcule, apenas complemente):',
    JSON.stringify({ cobertura: ats?.cobertura, atendidos: ats?.atendidos?.slice(0, 20), ausentes: ats?.ausentes?.slice(0, 20) }).slice(0, 2500),
    '',
    'TAREFA: pense como recrutador e produza uma leitura qualitativa HONESTA.',
    '- Liste pontos fortes reais (sustentados pelos dados).',
    '- Liste lacunas e o que falta informar.',
    '- Sugira melhorias concretas de escrita e organização.',
    '- Não prometa contratação. Não invente fatos.',
    '',
    'RESPONDA SOMENTE COM ESTE JSON:',
    '{',
    '  "pontosFortes": ["..."],',
    '  "lacunas": ["..."],',
    '  "sugestoes": ["..."],',
    '  "leituraRecrutador": "parágrafo curto e honesto sobre como esse currículo é lido"',
    '}',
  ].join('\n');
  return { system: SYSTEM_RECRUITER, user };
}

/** Campos essenciais ainda vazios (orienta a entrevista). */
export function missingFields(profile) {
  const p = normalizeProfile(profile);
  const missing = [];
  if (!p.fullName) missing.push('fullName');
  if (!p.email) missing.push('email');
  if (!p.phone) missing.push('phone');
  if (!p.city && !p.state) missing.push('cidade/estado');
  if (!p.headline) missing.push('headline (profissão/cargo desejado)');
  if (!p.objective) missing.push('objective');
  if (!p.experiences.length) missing.push('experiences');
  if (!p.education.length) missing.push('education');
  if (!p.skills.technical.length && !p.skills.behavioral.length) missing.push('skills');
  if (!p.languages.length) missing.push('languages');
  if (!p.courses.length && !p.certifications.length) missing.push('courses');
  return missing;
}

/** Perguntas de exemplo por área (fallback quando a IA não está disponível). */
export function fallbackQuestions(profile, areaId) {
  const p = normalizeProfile(profile);
  const area = getArea(areaId);
  const qs = [];
  const push = (field, label, example, why) => { if (qs.length < 4) qs.push({ field, label, example, why }); };
  if (!p.fullName) push('fullName', 'Qual é o seu nome completo?', 'Ex.: Maria Souza Oliveira', 'Identifica o currículo.');
  if (!p.email || !p.phone) push('email/phone', 'Quais são seus contatos?', 'Ex.: maria@email.com · (11) 91234-5678', 'É como o recrutador fala com você.');
  if (!p.headline) push('headline', 'Qual profissão ou cargo você busca?', `Ex.: ${area ? area.name : 'Auxiliar Administrativo'}`, 'Direciona o currículo.');
  if (!p.experiences.length) push('experiences', 'Você já trabalhou? Conte empresa, cargo e período.', 'Ex.: Vendedora na Loja Beta, 2022 a 2024', 'Forma a seção de experiência. Se nunca trabalhou, diga "primeiro emprego".');
  if (!p.education.length) push('education', 'Qual sua formação?', 'Ex.: Ensino Médio completo — EE São Paulo (2019)', 'Mostra escolaridade.');
  if (!p.skills.technical.length) push('skills', 'Quais conhecimentos técnicos você tem?', 'Ex.: Excel intermediário, atendimento ao cliente', 'Alimenta as competências.');
  return qs;
}

export default {
  SYSTEM_RECRUITER, buildInterviewPrompt, buildGeneratePrompt, buildEditPrompt,
  buildAnalysisPrompt, missingFields, fallbackQuestions,
};

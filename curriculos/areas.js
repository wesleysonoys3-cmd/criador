/* =========================================================
 * curriculos/areas.js — Base de conhecimento profissional EXTENSÍVEL
 * ---------------------------------------------------------
 * Estrutura aberta: para adicionar uma nova profissão/área basta
 * acrescentar um objeto em AREAS ou chamar registerArea(obj).
 * Nenhum outro arquivo precisa ser alterado (arquitetura extensível).
 *
 * Campos:
 *   id            identificador estável (usado na persistência)
 *   name          rótulo exibido
 *   keywords      termos que sugerem a área no texto do usuário
 *   competencies  competências típicas (usadas como sugestão, nunca inventadas no CV)
 *   activities    atividades típicas (exemplos para orientar a entrevista)
 *   resultHints   exemplos de resultados quantificáveis (orientação, não conteúdo)
 *   atsTerms      termos que sistemas ATS costumam procurar
 * =======================================================*/

export const AREAS = [
  {
    id: 'tecnologia',
    name: 'Tecnologia e Informática',
    keywords: ['desenvolvedor', 'programador', 'analista de sistemas', 'suporte técnico', 'infraestrutura', 'dados', 'ti', 'software', 'frontend', 'backend', 'devops', 'qa', 'teste', 'rede'],
    competencies: ['Lógica de programação', 'Versionamento com Git', 'Bancos de dados relacionais/NoSQL', 'APIs REST', 'Metodologias ágeis (Scrum/Kanban)', 'Testes automatizados', 'Linux e servidores', 'Cloud (AWS/Azure/GCP)'],
    activities: ['Desenvolvimento de funcionalidades em sistemas', 'Correção de bugs e melhoria de estabilidade', 'Revisão de código (code review)', 'Automação de tarefas repetitivas', 'Modelagem e consultas de banco de dados', 'Implantação (deploy) e monitoramento', 'Atendimento e resolução de chamados técnicos'],
    resultHints: ['Reduzi o tempo de resposta de X para Y', 'Diminuí os erros em produção em X%', 'Automatizei uma rotina que consumia X horas por semana', 'Entreguei X sistemas/módulos dentro do prazo'],
    atsTerms: ['JavaScript', 'Python', 'SQL', 'Git', 'Docker', 'API', 'Scrum', 'Linux', 'AWS', 'REST', 'Testes'],
  },
  {
    id: 'administracao',
    name: 'Administração',
    keywords: ['administrativo', 'assistente administrativo', 'auxiliar administrativo', 'backoffice', 'escritório', 'financeiro', 'contas'],
    competencies: ['Organização de documentos', 'Excel e planilhas de controle', 'Rotinas financeiras e contas a pagar/receber', 'Atendimento telefônico', 'Controle de estoque e materiais', 'Elaboração de relatórios'],
    activities: ['Organização e arquivamento de documentos', 'Lançamento de dados em sistemas internos', 'Controle de contas a pagar e a receber', 'Emissão de relatórios gerenciais', 'Controle de estoque e compras', 'Agendamento e apoio à gestão'],
    resultHints: ['Reduzi o tempo de fechamento de relatórios de X para Y dias', 'Organizei um arquivo com X documentos', 'Identifiquei economia de R$ X em compras'],
    atsTerms: ['Excel', 'ERP', 'Rotinas administrativas', 'Relatórios', 'Contas a pagar', 'Atendimento', 'Organização'],
  },
  {
    id: 'vendas',
    name: 'Vendas e Comércio',
    keywords: ['vendedor', 'vendas', 'comercial', 'consultor de vendas', 'representante', 'loja', 'balconista', 'negociação'],
    competencies: ['Negociação', 'Prospecção de clientes', 'Pós-venda', 'Metas e indicadores', 'CRM', 'Atendimento ao cliente em loja'],
    activities: ['Prospecção ativa de novos clientes', 'Atendimento e demonstração de produtos', 'Negociação de preços e condições', 'Acompanhamento de pós-venda', 'Bater metas mensais de vendas', 'Registro de oportunidades no CRM'],
    resultHints: ['Atingi X% da meta em X meses', 'Aumentei as vendas em X%', 'Conquistei X novos clientes no período'],
    atsTerms: ['Metas', 'CRM', 'Prospecção', 'Negociação', 'Funil', 'Ticket médio', 'Pós-venda'],
  },
  {
    id: 'atendimento',
    name: 'Atendimento ao Cliente',
    keywords: ['atendimento', 'recepção', 'sac', 'suporte ao cliente', 'telemarketing', 'call center', 'atendente'],
    competencies: ['Comunicação clara', 'Escuta ativa', 'Resolução de problemas', 'Paciência e empatia', 'Uso de sistemas de atendimento', 'Registro de protocolos'],
    activities: ['Atendimento presencial, telefônico e por chat', 'Registro e acompanhamento de solicitações', 'Resolução de reclamações e dúvidas', 'Encaminhamento de casos aos setores responsáveis', 'Controle de filas e tempo de espera'],
    resultHints: ['Mantive uma avaliação média de X de satisfação', 'Reduzi o tempo médio de espera de X para Y minutos', 'Atendi cerca de X clientes por dia'],
    atsTerms: ['SAC', 'Protocolo', 'SLA', 'Atendimento', 'CRM', 'Reclamações', 'Satisfação'],
  },
  {
    id: 'engenharia',
    name: 'Engenharia',
    keywords: ['engenheiro', 'engenharia', 'projetos', 'projetista', 'manutenção industrial', 'automação industrial'],
    competencies: ['Leitura e interpretação de projetos', 'AutoCAD/SolidWorks', 'Gestão de projetos', 'Normas técnicas (ABNT/NBR)', 'Controle de qualidade', 'Análise de custos'],
    activities: ['Elaboração e revisão de projetos técnicos', 'Acompanhamento de obra ou linha de produção', 'Análise de falhas e melhoria de processos', 'Especificação de materiais e equipamentos', 'Controle de cronograma e orçamento'],
    resultHints: ['Reduzi o desperdício de material em X%', 'Concluí um projeto X dias antes do prazo', 'Reduzi paradas de máquina em X horas/mês'],
    atsTerms: ['AutoCAD', 'NBR', 'Projetos', 'Orçamento', 'Cronograma', 'Qualidade', 'Lean'],
  },
  {
    id: 'construcao',
    name: 'Construção Civil',
    keywords: ['obra', 'construção', 'pedreiro', 'mestre de obras', 'encarregado', 'eletricista predial', 'pintor', 'reforma'],
    competencies: ['Execução de serviços conforme projeto', 'Leitura de planta', 'Segurança do trabalho (NR-18/NR-35)', 'Controle de materiais', 'Gestão de equipe em canteiro'],
    activities: ['Execução de alvenaria, acabamento e instalações conforme projeto', 'Organização e limpeza do canteiro', 'Controle de entrada e consumo de materiais', 'Orientação de equipe e aprendizes', 'Cumprimento de prazos e normas de segurança'],
    resultHints: ['Entreguei X m² de obra no prazo', 'Mantive X dias sem acidente', 'Reduzi perdas de material em X%'],
    atsTerms: ['NR-18', 'Planta', 'Cronograma', 'EPI', 'Acabamento', 'Alvenaria', 'Segurança'],
  },
  {
    id: 'saude',
    name: 'Saúde',
    keywords: ['enfermagem', 'técnico de enfermagem', 'cuidador', 'recepcionista de clínica', 'farmácia', 'laboratório', 'saúde'],
    competencies: ['Atenção ao paciente', 'Biossegurança e higienização', 'Registro em prontuário', 'Trabalho em equipe multiprofissional', 'Rotinas de clínica/consultório'],
    activities: ['Acolhimento e orientação de pacientes', 'Apoio em procedimentos sob supervisão', 'Organização de materiais e esterilização', 'Registro de informações em prontuário', 'Agendamento e organização de atendimentos'],
    resultHints: ['Atendi em média X pacientes por turno', 'Mantive os registros com X% de conformidade', 'Reduzi o tempo de espera do setor'],
    atsTerms: ['Prontuário', 'Biossegurança', 'Acolhimento', 'Esterilização', 'Protocolos', 'Paciente'],
  },
  {
    id: 'educacao',
    name: 'Educação',
    keywords: ['professor', 'professora', 'educador', 'monitor', 'pedagogo', 'aula', 'ensino', 'instrutor'],
    competencies: ['Planejamento de aulas', 'Didática e comunicação', 'Avaliação de aprendizagem', 'Gestão de sala de aula', 'Material didático'],
    activities: ['Planejamento e ministração de aulas', 'Elaboração de atividades e provas', 'Acompanhamento individual de alunos', 'Reuniões com responsáveis', 'Organização de projetos pedagógicos'],
    resultHints: ['Elevuei a média da turma de X para Y', 'Elaborei X materiais didáticos', 'Acompanhei X alunos em reforço'],
    atsTerms: ['Plano de aula', 'BNCC', 'Avaliação', 'Didática', 'Turma', 'Pedagógico'],
  },
  {
    id: 'logistica',
    name: 'Logística',
    keywords: ['logística', 'estoque', 'almoxarife', 'operador de empilhadeira', 'expedição', 'separador', 'transporte', 'conferente'],
    competencies: ['Controle de estoque', 'Conferência e separação de pedidos', 'WMS/ERP', 'Organização de armazém', 'Segurança na operação'],
    activities: ['Recebimento e conferência de mercadorias', 'Separação e expedição de pedidos', 'Controle de inventário e acuracidade', 'Operação de empilhadeira/transpaleteira', 'Organização e endereçamento do armazém'],
    resultHints: ['Mantive acuracidade de estoque de X%', 'Separei X pedidos por dia', 'Reduzi avarias em X%'],
    atsTerms: ['WMS', 'Estoque', 'Inventário', 'Expedição', 'Empilhadeira', 'Conferência', 'Acuracidade'],
  },
  {
    id: 'rh',
    name: 'Recursos Humanos',
    keywords: ['recursos humanos', 'rh', 'departamento pessoal', 'recrutamento', 'dp', 'folha de pagamento'],
    competencies: ['Recrutamento e seleção', 'Rotinas de departamento pessoal', 'Legislação trabalhista (CLT)', 'Onboarding', 'Indicadores de RH'],
    activities: ['Triagem e entrevistas de candidatos', 'Admissão, demissão e documentação', 'Controle de ponto e férias', 'Apoio na folha de pagamento', 'Ações de integração e clima'],
    resultHints: ['Reduzi o tempo médio de contratação de X para Y dias', 'Conduzi X processos seletivos', 'Estruturei o onboarding da empresa'],
    atsTerms: ['CLT', 'Recrutamento', 'Folha de pagamento', 'eSocial', 'Onboarding', 'Ponto'],
  },
  {
    id: 'marketing',
    name: 'Marketing',
    keywords: ['marketing', 'social media', 'design', 'conteúdo', 'comunicação', 'trafego pago', 'publicidade', 'criador'],
    competencies: ['Criação de conteúdo', 'Gestão de redes sociais', 'Análise de métricas', 'Copywriting', 'Tráfego pago', 'Ferramentas de design'],
    activities: ['Planejamento editorial e criação de posts', 'Gestão de campanhas e anúncios', 'Análise de resultados e relatórios', 'Produção de peças gráficas e vídeos', 'Atendimento de demanda de comunicação interna'],
    resultHints: ['Aumentei o engajamento em X%', 'Cresci a base de seguidores de X para Y', 'Reduzi o custo por lead para R$ X'],
    atsTerms: ['SEO', 'Meta Ads', 'Google Ads', 'Instagram', 'Copywriting', 'Métricas', 'Canva'],
  },
  {
    id: 'servicos-gerais',
    name: 'Serviços Gerais',
    keywords: ['serviços gerais', 'auxiliar de limpeza', 'zelador', 'jardineiro', 'copeiro', 'porteiro', 'manutenção predial'],
    competencies: ['Zeladoria e conservação', 'Uso correto de produtos de limpeza', 'Segurança do trabalho', 'Manutenção básica predial', 'Organização de rotinas'],
    activities: ['Limpeza e conservação de ambientes', 'Pequenos reparos e manutenção', 'Controle de materiais de limpeza', 'Apoio em eventos e mudanças internas', 'Cumprimento de cronogramas de rotina'],
    resultHints: ['Mantive X ambientes em conformidade', 'Zerei reclamações de limpeza no período', 'Implantei uma rotina de checklist diário'],
    atsTerms: ['Conservação', 'EPI', 'Rotina', 'Zeladoria', 'Manutenção', 'Higienização'],
  },
  {
    id: 'primeiro-emprego',
    name: 'Primeiro Emprego e Estágio',
    keywords: ['primeiro emprego', 'estágio', 'estagiário', 'aprendiz', 'jovem aprendiz', 'sem experiência', 'nunca trabalhei'],
    competencies: ['Vontade de aprender', 'Comprometimento e pontualidade', 'Trabalho em equipe', 'Organização', 'Comunicação', 'Informática básica'],
    activities: ['Participação em projetos escolares e acadêmicos', 'Trabalhos voluntários e eventos', 'Apoio em atividades de comunidade ou igreja', 'Cursos livres e certificações', 'Atividades escolares de liderança'],
    resultHints: ['Concluí X cursos na área', 'Organizei X eventos na escola/faculdade', 'Participei de projeto de X com resultado Y'],
    atsTerms: ['Aprendiz', 'Estágio', 'Organização', 'Informática', 'Proatividade', 'Trabalho em equipe'],
  },
];

const _byId = new Map(AREAS.map(a => [a.id, a]));

/** Registra (ou substitui) uma área — permite crescer sem alterar o módulo. */
export function registerArea(area) {
  if (!area || !area.id) return { ok: false, reason: 'Área precisa de id.' };
  const normalized = {
    id: String(area.id),
    name: String(area.name || area.id),
    keywords: Array.isArray(area.keywords) ? area.keywords.map(String) : [],
    competencies: Array.isArray(area.competencies) ? area.competencies.map(String) : [],
    activities: Array.isArray(area.activities) ? area.activities.map(String) : [],
    resultHints: Array.isArray(area.resultHints) ? area.resultHints.map(String) : [],
    atsTerms: Array.isArray(area.atsTerms) ? area.atsTerms.map(String) : [],
  };
  _byId.set(normalized.id, normalized);
  return { ok: true, area: normalized };
}

export function getArea(id) {
  return _byId.get(String(id || '')) || null;
}

export function listAreas() {
  return [..._byId.values()].map(a => ({ id: a.id, name: a.name }));
}

/** Detecta a área mais provável a partir de um texto livre (pontuação por palavra-chave). */
export function detectArea(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  let best = null, bestScore = 0;
  for (const area of _byId.values()) {
    let score = 0;
    for (const kw of area.keywords) {
      if (!kw) continue;
      const re = new RegExp(`(^|[^a-z0-9à-ú])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9à-ú]|$)`, 'i');
      if (re.test(t)) score += kw.includes(' ') ? 3 : 2;
    }
    if (score > bestScore) { bestScore = score; best = area; }
  }
  return best ? { id: best.id, name: best.name, score: bestScore } : null;
}

export default { AREAS, registerArea, getArea, listAreas, detectArea };

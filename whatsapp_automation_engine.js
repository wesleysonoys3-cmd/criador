import fs from 'fs/promises';
import path from 'path';

const DEFAULT_NICHOS = {
  barbearia: {
    label: 'Barbearia',
    servicos: [
      { id: 'corte_masculino', nome: 'Corte Masculino', preco: 45, duracaoMin: 30 },
      { id: 'barba', nome: 'Barba', preco: 30, duracaoMin: 20 },
      { id: 'combo', nome: 'Corte + Barba', preco: 65, duracaoMin: 50 },
    ],
    fluxoAgendamento: true,
    fluxoCatalogo: true,
    fluxoFAQ: [
      { q: 'Quais horários de funcionamento?', a: 'Seg a Sex das 9h às 19h · Sáb das 8h às 14h · Dom fechado.' },
      { q: 'Aceitam qual forma de pagamento?', a: 'Dinheiro, Pix, Cartão de crédito e débito. Link de pagamento via WhatsApp.' },
      { q: 'Como cancelar um agendamento?', a: 'Basta responder esta conversa com "cancelar" com até 2h de antecedência.' },
    ],
    capturaCampos: ['nome', 'servico', 'data', 'hora', 'telefone'],
  },
  clinica: {
    label: 'Clínica / Consultório',
    servicos: [
      { id: 'consulta', nome: 'Consulta Geral', preco: 150, duracaoMin: 30 },
      { id: 'retorno', nome: 'Consulta Retorno', preco: 80, duracaoMin: 20 },
      { id: 'exame', nome: 'Exame Laboratorial', preco: 0, duracaoMin: 15 },
    ],
    fluxoAgendamento: true,
    fluxoCatalogo: true,
    fluxoFAQ: [
      { q: 'Como marcar consulta?', a: 'Basta responder com "agendar" que envio os horários disponíveis para hoje e amanhã.' },
      { q: 'Qual o endereço?', a: 'Informamos endereço completo e mapa assim que seu agendamento é confirmado.' },
      { q: 'Aceitam convênio?', a: 'Sim, trabalhamos com os principais convênios. Pergunte sobre o seu no atendimento humano.' },
    ],
    capturaCampos: ['nome', 'cpf_4ult', 'especialidade', 'data', 'hora', 'telefone'],
  },
  loja: {
    label: 'Loja / E-commerce',
    servicos: [],
    fluxoCatalogo: true,
    fluxoPagamentoLink: true,
    fluxoFAQ: [
      { q: 'Quanto tempo para entrega?', a: 'Despache em até 24h úteis. Prazo de correios 2 a 7 dias úteis para Brasil.' },
      { q: 'Tem troca?', a: 'Política 7 dias após recebimento para troca de peças com defeito.' },
    ],
    capturaCampos: ['nome', 'interesse_produto', 'tamanho_cor', 'cep', 'telefone'],
  },
  restaurante: {
    label: 'Restaurante / Pizzaria',
    servicos: [
      { id: 'reserva', nome: 'Reserva de Mesa', preco: 0, duracaoMin: 60 },
      { id: 'delivery', nome: 'Pedido Delivery', preco: 0, duracaoMin: 45 },
    ],
    fluxoAgendamento: true,
    fluxoCatalogo: true,
    fluxoFAQ: [
      { q: 'Qual o cardápio?', a: 'Envio cardápio em PDF. Se preferir digite "cardapio" e listo os principais pratos.' },
      { q: 'Taxa de delivery?', a: 'Taxa fixa R$ 8,00 para bairros centrais. Grátis acima de R$ 80,00.' },
    ],
    capturaCampos: ['nome', 'pessoas', 'data', 'hora', 'endereco', 'telefone'],
  },
  imobiliaria: {
    label: 'Imobiliária',
    servicos: [],
    fluxoCatalogo: true,
    fluxoFAQ: [
      { q: 'Tem imóveis para alugar?', a: 'Sim, vários! Responda "aluguel" + bairro desejado que listo os melhores.' },
      { q: 'Tem imóveis à venda?', a: 'Responda "venda" + faixa de preço que separo opções para você.' },
    ],
    capturaCampos: ['nome', 'tipo_imovel', 'alugar_ou_vender', 'faixa_preco', 'bairro', 'telefone'],
  },
  padrao: {
    label: 'Prestador de Serviços / Outros',
    servicos: [],
    fluxoFAQ: [
      { q: 'Quais serviços?', a: 'Responda o que você precisa e encaminho para o responsável.' },
      { q: 'Formas de contato?', a: 'Atendimento via WhatsApp. Se preferir me diga seu melhor horário para retorno.' },
    ],
    capturaCampos: ['nome', 'tipo_servico', 'cidade', 'telefone'],
  },
};

export function detectarNicho(texto) {
  const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/barbe|cabel|barba/.test(t)) return 'barbearia';
  if (/clini|consult|medic|veterin|odont|dental|estetic/.test(t)) return 'clinica';
  if (/loja|venda|e-commerce|ecommerce|produto|roup|calc|moda|shop/.test(t)) return 'loja';
  if (/restaur|pizzar|lanch|hambur|comida|delivery|pedido/.test(t)) return 'restaurante';
  if (/imobili|imovel|casa|apartamento|aluguel|venda imovel/.test(t)) return 'imobiliaria';
  return 'padrao';
}

export function gerarAutomacaoWhatsApp({ nicho, empresaSlug, agenteSlug, customizacoes = {} }) {
  const base = DEFAULT_NICHOS[nicho] || DEFAULT_NICHOS.padrao;
  const cfg = { ...base, ...customizacoes };
  return {
    id: `wa_${empresaSlug}_${agenteSlug}_${Date.now()}`,
    nicho: cfg.label,
    provider: 'evolux',
    envVars: [
      { name: 'WHATSAPP_EVOLUX_API_KEY', label: 'Chave API Evolux', required: true, mask: true },
      { name: 'WHATSAPP_EVOLUX_INSTANCE_ID', label: 'ID Instância WhatsApp Evolux', required: true, mask: true },
      { name: 'WHATSAPP_EVOLUX_WEBHOOK_SECRET', label: 'Segredo Webhook Evolux (opcional)', required: false, mask: true },
    ],
    fluxos: {
      boasVindas: _fazerBoasVindas(cfg, empresaSlug, agenteSlug),
      agendamento: cfg.fluxoAgendamento ? _fazerFluxoAgendamento(cfg) : null,
      catalogo: cfg.fluxoCatalogo ? _fazerFluxoCatalogo(cfg, customizacoes.catalogo || cfg.servicos || []) : null,
      faq: cfg.fluxoFAQ && cfg.fluxoFAQ.length ? _fazerFluxoFAQ(cfg.fluxoFAQ) : null,
      pagamentoLink: cfg.fluxoPagamentoLink ? _fazerFluxoPagamento(cfg) : null,
      capturaDados: _fazerFluxoCaptura(cfg.capturaCampos || []),
    },
    webhooks: [
      { path: '/webhook/evolux/message', method: 'POST', handler: 'handler_evolux_incoming' },
      { path: '/webhook/evolux/status', method: 'POST', handler: 'handler_evolux_status' },
    ],
    codigo: _gerarCodigoHandler({ cfg, empresaSlug, agenteSlug }),
  };
}

export async function enviarMensagemEvolux({ numero, mensagem, tipo = 'text', midiaUrl = null }) {
  const apiKey = process.env.WHATSAPP_EVOLUX_API_KEY;
  const instanceId = process.env.WHATSAPP_EVOLUX_INSTANCE_ID;
  if (!apiKey || !instanceId) {
    return { ok: false, error: 'WHATSAPP_EVOLUX_API_KEY ou WHATSAPP_EVOLUX_INSTANCE_ID não configurado no .env.', code: 'ENV_MISSING' };
  }
  const numeroLimpo = String(numero || '').replace(/\D/g, '');
  if (!numeroLimpo || numeroLimpo.length < 10) {
    return { ok: false, error: 'Número de WhatsApp inválido (precisa ter DD + dígitos).', code: 'INVALID_NUMBER' };
  }
  try {
    const endpoint = `https://api.evolux.com.br/v1/instances/${instanceId}/messages/send`;
    const body = {
      number: numeroLimpo,
      type: tipo,
      text: tipo === 'text' ? String(mensagem || '') : undefined,
      media_url: (tipo === 'image' || tipo === 'document' || tipo === 'audio') ? (midiaUrl || undefined) : undefined,
    };
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-Instance-Id': instanceId,
      },
      body: JSON.stringify(body),
    });
    const txt = await resp.text();
    let json;
    try { json = JSON.parse(txt); } catch { json = { raw: txt.slice(0, 500) }; }
    if (!resp.ok) {
      return { ok: false, error: `Evolux HTTP ${resp.status}: ${String(json?.message || json?.error || txt || '').slice(0, 200)}`, code: 'EVOLUX_HTTP_' + resp.status, raw: json };
    }
    return { ok: true, id: json?.id || json?.messageId || null, raw: json };
  } catch (e) {
    return { ok: false, error: `Falha rede/chamada Evolux: ${String(e.message || e).slice(0, 200)}`, code: 'NETWORK', raw: null };
  }
}

function _fazerBoasVindas(cfg, empresaSlug, agenteSlug) {
  return {
    keywords: ['start', 'inicio', 'oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'menu'],
    mensagem:
`🤝 Olá! Seja bem-vindo(a) ao atendimento automático da *${empresaSlug}* (${cfg.label}).
Eu sou o agente ${agenteSlug} e posso te ajudar com:
⏰ ${cfg.fluxoAgendamento ? '• Agendar horário / Reserva (digite AGENDAR)' : '• Encaminhar atendimento'}
${cfg.fluxoCatalogo ? '📋 • Ver cardápio / Serviços / Preços (digite CATALOGO)' : ''}
${cfg.fluxoPagamentoLink ? '💳 • Pagar via Pix/Cartão (digite PAGAR)' : ''}
❓ • Dúvidas frequentes
👤 • Falar com atendente humano (digite ATENDENTE)
Responda com a opção que melhor se encaixa!`,
  };
}

function _fazerFluxoAgendamento(cfg) {
  return {
    keywords: ['agendar', 'agendamento', 'reserva', 'horario', 'horário', 'marcar', 'consulta'],
    steps: [
      { id: 'servico', pergunta: 'Qual serviço você deseja?\n' + (cfg.servicos || []).map((s, i) => `${i+1}. ${s.nome}${s.preco ? ' — R$ ' + Number(s.preco).toFixed(2).replace('.',',') : ''}`).join('\n'), extrai: 'servico_escolhido' },
      { id: 'data', pergunta: 'Qual a data? (DD/MM/AAAA)', extrai: 'data' },
      { id: 'hora', pergunta: 'Qual horário? (HH:MM)', extrai: 'hora' },
      { id: 'nome', pergunta: 'Seu nome completo:', extrai: 'nome' },
      { id: 'confirmacao', templateResposta: '✅ *Agendamento confirmado!*\n📌 Serviço: {{servico_escolhido}}\n📅 Data: {{data}}\n🕑 Horário: {{hora}}\n👤 Cliente: {{nome}}\n\nAté lá! Responda CANCELAR se precisar desmarcar.' },
    ],
  };
}

function _fazerFluxoCatalogo(cfg, itens) {
  const linhas = (itens && itens.length ? itens : cfg.servicos || []).map(i =>
    `▪ *${i.nome || i.titulo || 'Item'}*${i.preco ? ' — R$ ' + Number(i.preco).toFixed(2).replace('.',',') : ''}${i.duracaoMin ? ' · ' + i.duracaoMin + ' min' : ''}${i.descricao ? '\n  ' + i.descricao : ''}`
  ).join('\n') || 'Responda com o que você procura que listo opções.';
  return {
    keywords: ['catalogo', 'cardapio', 'cardápio', 'preço', 'preco', 'precos', 'produto', 'produtos', 'serviço', 'servicos', 'menu'],
    mensagem: `📋 Nosso *Catálogo / Serviços*:\n\n${linhas}\n\nSe interessou? Responda o nome do item ou *COMPRAR / PAGAR*.`,
  };
}

function _fazerFluxoFAQ(faq) {
  return {
    keywords: ['duvida', 'dúvida', 'pergunta', 'faq', 'ajuda', 'socorro'],
    items: faq.map(f => ({ q: f.q, a: f.a })),
  };
}

function _fazerFluxoPagamento(cfg) {
  return {
    keywords: ['pagar', 'pagamento', 'pix', 'cartao', 'cartão', 'boleto', 'comprar'],
    mensagem: `💳 Para pagamento:\n• *Pix:* geramos QRCode instantâneo (99% de aprovação).\n• *Cartão:* link seguro com até 12x.\nResponda com *PIX* ou *CARTAO* e o valor do pedido/serviço.`,
  };
}

function _fazerFluxoCaptura(campos) {
  return { campos, integrarComPlanilha: true };
}

function _gerarCodigoHandler({ cfg, empresaSlug, agenteSlug }) {
  return `/* =============================================================
   WHATSAPP HANDLER — ${cfg.label} · ${empresaSlug}/${agenteSlug}
   Gerado automaticamente pela Fábrica Multi-Empresas TiAgente.
   Integração: Evolux API
   ============================================================= */
export async function handler_evolux_incoming(req, res) {
  try {
    const payload = req.body || {};
    const from = payload.from || payload.who || '';
    const text = String(payload.text?.message || payload.text || payload.body || '').trim();
    if (!from || !text) return res.status(400).json({ ok:false, error:'missing from/text' });
    const state = (global.__waState = global.__waState || new Map());
    let ctx = state.get(from) || { step:null, buffer:{}, fluxo:null };
    const up = text.toLowerCase();

    // BOAS-VINDAS
    if (/^(oi|ola|olá|start|inicio|oi tudo bem|bom dia|boa tarde|boa noite|menu|0)$/i.test(up) || up.length < 2) {
      return res.json({ ok:true, reply: BOAS_VINDAS });
    }

    // ATENDENTE HUMANO
    if (up === 'atendente') {
      return res.json({ ok:true, reply: '👤 Encaminhando para atendente humano. Aguarde 30 segundos, por favor.' });
    }

    // TODO: fluxos específicos aqui (agendamento, catálogo, pagto, FAQ)
    return res.json({ ok:true, reply: 'Entendi! Vou anotar seus dados e chamar o atendente responsável.' });
  } catch (e) {
    console.error('WA handler erro:', e);
    return res.status(500).json({ ok:false, error: String(e.message || e).slice(0,120) });
  }
}

export async function handler_evolux_status(req, res) {
  return res.json({ ok:true, received: true, at: new Date().toISOString() });
}

const BOAS_VINDAS = ${JSON.stringify(_fazerBoasVindas(cfg, empresaSlug, agenteSlug).mensagem)};
`;
}

export async function salvarAutomacaoDisco({ dirProjeto, automacao }) {
  const waDir = path.join(dirProjeto, 'whatsapp');
  await fs.mkdir(waDir, { recursive: true });
  await fs.writeFile(path.join(waDir, 'automacao_wa.json'), JSON.stringify(automacao, null, 2), 'utf8');
  await fs.writeFile(path.join(waDir, 'handler_wa.js'), automacao.codigo || '// handler não gerado', 'utf8');
  return { jsonPath: path.join(waDir, 'automacao_wa.json'), handlerPath: path.join(waDir, 'handler_wa.js') };
}

export default {
  DEFAULT_NICHOS,
  detectarNicho,
  gerarAutomacaoWhatsApp,
  enviarMensagemEvolux,
  salvarAutomacaoDisco,
};

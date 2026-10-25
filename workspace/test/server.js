const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Banco de dados em memória robusto
let agendamentos = [
  { id: 1, cliente: "Carlos Silva", servico: "Corte Degradê + Barba", horario: "Hoje às 14:30", status: "Confirmado", telefone: "(11) 98765-4321" },
  { id: 2, cliente: "Marcos Oliveira", servico: "Corte Social", horario: "Amanhã às 10:00", status: "Confirmado", telefone: "(11) 91234-5678" }
];

const servicosBarbearia = [
  { id: 1, nome: "Corte Degradê / Moderno", preco: "R$ 45,00", duracao: "30 min" },
  { id: 2, nome: "Corte Social / Tesoura", preco: "R$ 40,00", duracao: "30 min" },
  { id: 3, nome: "Barba Completa (Toalha Quente)", preco: "R$ 35,00", duracao: "25 min" },
  { id: 4, nome: "Combo Corte + Barba", preco: "R$ 70,00", duracao: "50 min" },
  { id: 5, nome: "Sobrancelha na Navalha", preco: "R$ 15,00", duracao: "10 min" }
];

const horariosDisponiveis = [
  "Hoje às 16:00",
  "Hoje às 17:30",
  "Amanhã às 09:00",
  "Amanhã às 11:00",
  "Amanhã às 15:00"
];

// Motor de IA Conversacional Super Inteligente para Barbearia
function processarMensagemIA(mensagem) {
  if (!mensagem || typeof mensagem !== 'string') {
    return {
      resposta: "Fala, meu nobre! 💈 Como posso te ajudar hoje?",
      sugestoes: ["Ver Serviços", "Quero Agendar", "Endereço"]
    };
  }

  const msg = mensagem.toLowerCase().trim();

  // Saudações
  if (msg.match(/(oi|olá|boa tarde|bom dia|boa noite|e aí|opa|fala|hi|hello)/)) {
    return {
      resposta: "Fala, meu nobre! 💈 Seja bem-vindo à **Barbearia Navalha de Ouro**. Sou o assistente virtual autônomo. Como posso te dar aquela moral hoje? Quer dar uma olhada nos serviços, ver horários ou agendar um trato no visual?",
      sugestoes: ["Ver Serviços e Preços", "Quero Agendar", "Horários Disponíveis", "Endereço e Contato"]
    };
  }

  // Preços / Serviços
  if (msg.includes('preço') || msg.includes('valor') || msg.includes('serviço') || msg.includes('quanto') || msg.includes('corte') || msg.includes('barba')) {
    let listaServicos = servicosBarbearia.map(s => `• **${s.nome}** — ${s.preco} (${s.duracao})`).join('\n');
    return {
      resposta: `📋 **Nossos Serviços & Tabela de Preços:**\n\n${listaServicos}\n\nQual desses você curte mandar ver hoje?`,
      sugestoes: ["Quero Agendar Combo", "Agendar só Corte", "Agendar Barba"]
    };
  }

  // Horários
  if (msg.includes('horário') || msg.includes('hora') || msg.includes('agenda') || msg.includes('disponível') || msg.includes('vaga')) {
    let listaHorarios = horariosDisponiveis.map(h => `🕒 ${h}`).join('\n');
    return {
      resposta: `📅 **Horários livres para esta semana:**\n\n${listaHorarios}\n\nQual desses horários fica melhor para você? Basta clicar ou digitar.`,
      sugestoes: horariosDisponiveis
    };
  }

  // Intenção de Agendamento
  if (msg.includes('agendar') || msg.includes('marcar') || msg.includes('quero') || msg.includes('reserva')) {
    return {
      resposta: `📅 Show de bola! Para realizarmos o seu agendamento rapidinho, me informe por favor:\n\n1️⃣ **Seu Nome**\n2️⃣ **Serviço** (ex: Corte + Barba)\n3️⃣ **Horário** (ex: Amanhã às 11:00)\n\nOu escolha um horário direto abaixo:`,
      sugestoes: horariosDisponiveis
    };
  }

  // Endereço / Contato
  if (msg.includes('endereço') || msg.includes('onde') || msg.includes('local') || msg.includes('contato') || msg.includes('telefone') || msg.includes('zap') || msg.includes('whatsapp')) {
    return {
      resposta: `📍 **Onde estamos:**\nRua dos Barbeiros, 123 - Centro (Próximo à Praça Principal).\n\n📞 **WhatsApp:** (11) 99888-7766\n⏰ **Funcionamento:** Terça a Sábado: 09h às 20h.`,
      sugestoes: ["Quero Agendar", "Ver Serviços"]
    };
  }

  // Fallback Inteligente Contextual
  return {
    resposta: `Entendi! Na **Barbearia Navalha de Ouro** nosso compromisso é deixar seu visual impecável. Posso te ajudar a agendar um horário, verificar preços ou tirar dúvidas sobre localização. O que prefere?`,
    sugestoes: ["Ver Serviços e Preços", "Agendar Horário", "Falar com Barbeiro"]
  };
}

// Endpoints da API
app.get('/api/servicos', (req, res) => {
  res.json(servicosBarbearia);
});

app.get('/api/agendamentos', (req, res) => {
  res.json(agendamentos);
});

app.post('/api/chat', (req, res) => {
  const { mensagem } = req.body;
  const respostaIA = processarMensagemIA(mensagem);
  res.json(respostaIA);
});

app.post('/api/agendar', (req, res) => {
  const { cliente, servico, horario } = req.body;
  const novo = {
    id: agendamentos.length + 1,
    cliente: cliente || "Cliente Web",
    servico: servico || "Corte Degradê",
    horario: horario || "Hoje às 16:00",
    status: "Confirmado",
    telefone: "(11) 99999-9999"
  };
  agendamentos.push(novo);
  res.json({ success: true, agendamento: novo });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 BarberBot AI rodando perfeitamente na porta ${PORT}`);
});

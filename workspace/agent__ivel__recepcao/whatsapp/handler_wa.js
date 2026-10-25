/* =============================================================
   WHATSAPP HANDLER — Prestador de Serviços / Outros · ivel/recepcao
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

const BOAS_VINDAS = "🤝 Olá! Seja bem-vindo(a) ao atendimento automático da *ivel* (Prestador de Serviços / Outros).\nEu sou o agente recepcao e posso te ajudar com:\n⏰ • Encaminhar atendimento\n\n\n❓ • Dúvidas frequentes\n👤 • Falar com atendente humano (digite ATENDENTE)\nResponda com a opção que melhor se encaixa!";

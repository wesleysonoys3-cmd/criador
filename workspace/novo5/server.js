require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const {
  admin,
  db,
  storage,
  isFirebaseConnected,
  isAdmin,
  getClientConfig
} = require('./firebaseConfig');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = (process.env.NODE_ENV || 'production') === 'production';

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}
}
app.use('/uploads', express.static(UPLOAD_DIR));

const ALLOWED_LOGO_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
]);
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.png';
    const id = crypto.randomUUID().replace(/-/g, '');
    cb(null, `partner_${Date.now()}_${id}${safeExt}`);
  }
});
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mimeOk = ALLOWED_LOGO_MIME.has((file.mimetype || '').toLowerCase());
    const ext = path.extname(file.originalname || '').toLowerCase();
    const extOk = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
    if (mimeOk && extOk) return cb(null, true);
    return cb(new Error('Formato de arquivo inválido. Use JPG, PNG ou WEBP.'));
  }
});

const DB_FILE = path.join(__dirname, 'database.json');

const initialDb = {
  equipment: [
    { id: 'EQ-101', name: 'Cadeira Ergonômica Executive Pro', category: 'Mobiliário', stockTotal: 150, stockAvailable: 88, pricePerDay: 15.00, status: 'Disponível' },
    { id: 'EQ-102', name: 'Mesa de Reunião Modular 8 Lugares', category: 'Mobiliário', stockTotal: 25, stockAvailable: 12, pricePerDay: 65.00, status: 'Disponível' },
    { id: 'EQ-103', name: 'Painel LED Corporativo P3 3x2m', category: 'Audiovisual', stockTotal: 10, stockAvailable: 4, pricePerDay: 250.00, status: 'Disponível' },
    { id: 'EQ-104', name: 'Sistema de Som Integrado Bose Pro', category: 'Audiovisual', stockTotal: 20, stockAvailable: 15, pricePerDay: 90.00, status: 'Disponível' },
    { id: 'EQ-105', name: 'Divisória Acústica Modular ModularWall', category: 'Estruturas', stockTotal: 80, stockAvailable: 35, pricePerDay: 25.00, status: 'Disponível' },
    { id: 'EQ-106', name: 'Luminária Pendente Designer Minimal', category: 'Iluminação', stockTotal: 120, stockAvailable: 70, pricePerDay: 12.50, status: 'Disponível' },
    { id: 'EQ-107', name: 'Balcão de Atendimento Reception VIP', category: 'Mobiliário', stockTotal: 15, stockAvailable: 6, pricePerDay: 110.00, status: 'Disponível' }
  ],
  contracts: [
    { id: 'CTR-501', clientName: 'Construtora Horizonte SA', eventName: 'Stand Feira Construção 2025', startDate: '2025-04-10', endDate: '2025-04-18', totalValue: 4320.00, status: 'Ativo', items: [{ id: 'EQ-101', qty: 20 }, { id: 'EQ-103', qty: 1 }] },
    { id: 'CTR-502', clientName: 'TechCorp Eventos Globais', eventName: 'Convenção Anual de Inovação', startDate: '2025-04-22', endDate: '2025-04-25', totalValue: 7850.00, status: 'Confirmado', items: [{ id: 'EQ-102', qty: 5 }, { id: 'EQ-104', qty: 2 }, { id: 'EQ-106', qty: 30 }] }
  ],
  automations: [
    { id: 'AUT-01', title: 'Verificação Automática de Estoque', trigger: 'Novo pedido recebido', status: 'Ativo', executions: 142, lastRun: 'Há 5 minutos' },
    { id: 'AUT-02', title: 'Lembrete de Recolha de Material', trigger: '24h antes do fim do contrato', status: 'Ativo', executions: 89, lastRun: 'Há 1 hora' },
    { id: 'AUT-03', title: 'Geração e Envio de Proposta PDF', trigger: 'Lead qualificado pelo Chat IA', status: 'Ativo', executions: 210, lastRun: 'Há 12 minutos' },
    { id: 'AUT-04', title: 'Alerta de Manutenção Pós-Locação', trigger: 'Equipamento devolvido ao armazém', status: 'Ativo', executions: 320, lastRun: 'Há 45 minutos' }
  ],
  partnerApplications: [],
  partners: [],
  meta: { adminUids: [] }
};

let localDb = initialDb;
if (fs.existsSync(DB_FILE)) {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(data);
    localDb = Object.assign({}, initialDb, parsed);
    if (!Array.isArray(localDb.partnerApplications)) localDb.partnerApplications = [];
    if (!Array.isArray(localDb.partners)) localDb.partners = [];
    if (!localDb.meta || typeof localDb.meta !== 'object') localDb.meta = { adminUids: [] };
    if (!Array.isArray(localDb.meta.adminUids)) localDb.meta.adminUids = [];
  } catch (e) {
    console.error('Erro ao ler banco local. Usando valores iniciais.');
    localDb = initialDb;
  }
} else {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), 'utf8'); } catch (_) {}
}

function saveDb() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(localDb, null, 2), 'utf8'); } catch (_) {}
}

function safeErr(_err, userMsg) {
  const msg = userMsg || 'Ocorreu um erro. Tente novamente.';
  return { success: false, error: msg };
}

function sanitizeStr(v, max = 300) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001F]/g, '').slice(0, max);
}
function sanitizeEmail(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
  return s;
}
function sanitizeDigits(v, max = 30) {
  if (typeof v !== 'string') return '';
  return v.replace(/\D/g, '').slice(0, max);
}
function randomId(prefix = 'ID') {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function publicPartnerFields(p) {
  return {
    id: p.id,
    companyName: p.companyName,
    logoUrl: p.logoUrl,
    category: p.category,
    description: p.description,
    city: p.city,
    state: p.state,
    phone: p.phone,
    whatsapp: p.whatsapp,
    instagram: p.instagram,
    facebook: p.facebook,
    website: p.website,
    address: p.address
  };
}

async function verifyAdminToken(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const idToken = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!idToken) return res.status(401).json(safeErr(null, 'Autenticação necessária.'));
    let uid = null, email = null;
    if (isFirebaseConnected && admin) {
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
      email = decoded.email || null;
    } else {
      const t = idToken.split('.');
      if (t.length < 2) return res.status(401).json(safeErr(null, 'Credenciais inválidas.'));
      try {
        const payload = JSON.parse(Buffer.from(t[1], 'base64').toString('utf8'));
        uid = payload.uid || payload.sub || null;
        email = payload.email || null;
      } catch (_) { return res.status(401).json(safeErr(null, 'Credenciais inválidas.')); }
    }
    if (!uid) return res.status(401).json(safeErr(null, 'Credenciais inválidas.'));
    const ok = await isAdmin(uid);
    if (!ok) return res.status(403).json(safeErr(null, 'Acesso restrito.'));
    req.adminUid = uid;
    req.adminEmail = email;
    return next();
  } catch (err) {
    return res.status(401).json(safeErr(err, 'Credenciais inválidas ou sessão expirada.'));
  }
}

// ------------------------------------------------------------------
//  Endpoints públicos — config & dados básicos
// ------------------------------------------------------------------
app.get('/api/client-config', (_req, res) => {
  res.json({ success: true, config: getClientConfig() });
});

app.get('/api/stats', (_req, res) => {
  try {
    const activeContracts = localDb.contracts.filter(c => c.status === 'Ativo' || c.status === 'Confirmado').length;
    const totalRevenue = localDb.contracts.reduce((acc, c) => acc + (Number(c.totalValue) || 0), 0);
    const totalEquipment = localDb.equipment.reduce((acc, e) => acc + (Number(e.stockTotal) || 0), 0);
    const availableEquipment = localDb.equipment.reduce((acc, e) => acc + (Number(e.stockAvailable) || 0), 0);
    res.json({
      success: true,
      activeContracts,
      totalRevenue,
      totalEquipment,
      availableEquipment,
      automationsActive: localDb.automations.filter(a => a.status === 'Ativo').length,
      partnersCount: localDb.partners.length
    });
  } catch (err) {
    res.status(500).json(safeErr(err, 'Não foi possível carregar os dados gerais.'));
  }
});

app.get('/api/equipment', (_req, res) => {
  try { res.json({ success: true, items: localDb.equipment }); }
  catch (err) { res.status(500).json(safeErr(err, 'Não foi possível carregar o inventário.')); }
});

app.post('/api/equipment', async (req, res) => {
  try {
    const { name, category, stockTotal, pricePerDay } = req.body || {};
    const newItem = {
      id: randomId('EQ'),
      name: sanitizeStr(name, 150) || 'Novo Material',
      category: sanitizeStr(category, 80) || 'Mobiliário',
      stockTotal: Math.max(0, parseInt(stockTotal) || 10),
      stockAvailable: Math.max(0, parseInt(stockTotal) || 10),
      pricePerDay: Math.max(0, parseFloat(pricePerDay) || 20.00),
      status: 'Disponível'
    };
    localDb.equipment.unshift(newItem);
    localDb.automations.unshift({
      id: randomId('AUT'),
      title: `Novo material armazenado: ${newItem.name}`,
      trigger: 'Armazenamento Central',
      status: 'Ativo',
      executions: 1,
      lastRun: 'Agora mesmo'
    });
    saveDb();
    if (isFirebaseConnected && db) {
      try { await db.collection('equipment').doc(newItem.id).set(newItem); } catch (_) {}
    }
    res.json({ success: true, message: 'Material adicionado com sucesso!' });
  } catch (err) {
    res.status(500).json(safeErr(err, 'Não foi possível adicionar o material.'));
  }
});

app.get('/api/contracts', (_req, res) => {
  try { res.json({ success: true, items: localDb.contracts }); }
  catch (err) { res.status(500).json(safeErr(err, 'Não foi possível carregar os contratos.')); }
});

app.get('/api/automations', (_req, res) => {
  try { res.json({ success: true, items: localDb.automations }); }
  catch (err) { res.status(500).json(safeErr(err, 'Não foi possível carregar as automações.')); }
});

app.post('/api/ai/chat', (req, res) => {
  try {
    const { message } = req.body || {};
    const lowerMsg = (sanitizeStr(message, 800) || '').toLowerCase();
    let reply = "Olá! Sou o agente de automação da Ajeita AI. Posso verificar disponibilidade de materiais, calcular orçamentos, agendar entregas ou gerar contratos automaticamente. Como posso ajudar?";
    let actionTaken = null;
    if (lowerMsg.includes('cadeira') || lowerMsg.includes('mesa') || lowerMsg.includes('mobiliário') || lowerMsg.includes('preço') || lowerMsg.includes('orçamento')) {
      const eq = localDb.equipment.filter(e => e.category === 'Mobiliário' || (e.name || '').toLowerCase().includes('cadeira') || (e.name || '').toLowerCase().includes('mesa'));
      reply = `Com base no nosso inventário atual, temos os seguintes itens de mobiliário disponíveis:\n` +
        eq.map(e => `• ${e.name} (${e.stockAvailable} disp. / R$${e.pricePerDay.toFixed(2)}/dia)`).join('\n') +
        `\n\nDeseja que calcule um orçamento para quantas unidades e dias?`;
      actionTaken = 'Inventário de Mobiliário Consultado';
    } else if (lowerMsg.includes('audiovisual') || lowerMsg.includes('led') || lowerMsg.includes('som')) {
      const eq = localDb.equipment.filter(e => e.category === 'Audiovisual');
      reply = `Equipamentos audiovisuais disponíveis:\n` +
        eq.map(e => `• ${e.name} (${e.stockAvailable} disp. / R$${e.pricePerDay.toFixed(2)}/dia)`).join('\n') +
        `\n\nPosso reservar estes itens para o seu evento?`;
      actionTaken = 'Consulta Audiovisual';
    } else if (lowerMsg.includes('contrato') || lowerMsg.includes('reserva') || lowerMsg.includes('alugar')) {
      reply = `Perfeito! Para criar o contrato automatizado, preciso apenas de:\n1. Nome da Empresa / Evento\n2. Datas de Início e Fim\n3. Lista de itens e quantidades.\n\nPode indicar estes dados ou criar diretamente no painel de contratos.`;
      actionTaken = 'Assistente de Contrato Iniciado';
    } else if (lowerMsg.includes('parceiro') || lowerMsg.includes('empresa') || lowerMsg.includes('divulgar')) {
      reply = `Quer divulgar sua empresa na Ajeita AI? Acesse a aba "Seja Parceiro" e envie sua solicitação. Nossa equipe analisará rapidamente!`;
      actionTaken = 'Encaminhado para Seja Parceiro';
    } else if (lowerMsg.includes('status') || lowerMsg.includes('entrega') || lowerMsg.includes('recolha')) {
      reply = `Todos os agendamentos de entrega e recolha estão sendo geridos automaticamente pela nossa frota parceira.`;
      actionTaken = 'Logística verificada';
    } else if (lowerMsg.includes('olá') || lowerMsg.includes('bom dia') || lowerMsg.includes('boa tarde') || lowerMsg.includes('oi')) {
      reply = `Olá! A Ajeita AI está a postos. Posso ajudar a consultar o inventário de ${localDb.equipment.length} materiais cadastrados, emitir propostas, gerir contratos ou conectar você com nossos parceiros.`;
      actionTaken = 'Saudação do Agente';
    } else if (lowerMsg.length > 0) {
      reply = `Compreendi a sua solicitação. Posso gerar uma proposta formal ou agendar uma reunião com nosso gestor de contas.`;
      actionTaken = 'Consulta Geral IA Processada';
    }
    res.json({ success: true, reply, actionTaken, timestamp: new Date().toLocaleTimeString() });
  } catch (err) {
    res.status(500).json({ success: false, reply: 'Desculpe, ocorreu um erro temporário. Tente novamente.', actionTaken: 'Erro' });
  }
});

app.post('/api/contracts', async (req, res) => {
  try {
    const { clientName, eventName, startDate, endDate, items } = req.body || {};
    let totalValue = 0;
    const itemsSafe = (Array.isArray(items) ? items : []).map(i => ({
      id: sanitizeStr(i && i.id, 60),
      qty: Math.max(0, parseInt(i && i.qty) || 0)
    })).filter(i => i.id && i.qty > 0);
    itemsSafe.forEach(i => {
      const eq = localDb.equipment.find(e => e.id === i.id);
      if (eq) {
        const days = Math.max(1, Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)));
        totalValue += (eq.pricePerDay || 0) * i.qty * days;
        eq.stockAvailable = Math.max(0, (eq.stockAvailable || 0) - i.qty);
      }
    });
    const newContract = {
      id: randomId('CTR'),
      clientName: sanitizeStr(clientName, 180) || 'Novo Cliente',
      eventName: sanitizeStr(eventName, 180) || 'Evento',
      startDate: sanitizeStr(startDate, 20) || new Date().toISOString().split('T')[0],
      endDate: sanitizeStr(endDate, 20) || new Date().toISOString().split('T')[0],
      totalValue: Number(totalValue.toFixed(2)) || 1500.00,
      status: 'Confirmado',
      items: itemsSafe
    };
    localDb.contracts.unshift(newContract);
    localDb.automations.unshift({
      id: randomId('AUT'),
      title: `Contrato ${newContract.id} gerado e armazenado`,
      trigger: `Novo pedido de ${newContract.clientName}`,
      status: 'Ativo',
      executions: 1,
      lastRun: 'Agora mesmo'
    });
    saveDb();
    if (isFirebaseConnected && db) {
      try { await db.collection('contracts').doc(newContract.id).set(newContract); } catch (_) {}
    }
    res.json({ success: true, message: 'Contrato gerado com sucesso!' });
  } catch (err) {
    res.status(500).json(safeErr(err, 'Não foi possível criar o contrato.'));
  }
});

// ------------------------------------------------------------------
//  Parceiros — Upload de logo (público)
// ------------------------------------------------------------------
app.post('/api/partner/logo-upload', (req, res) => {
  uploadLogo.single('logo')(req, res, async (err) => {
    if (err) {
      const msg = err && (err.code === 'LIMIT_FILE_SIZE' || /tamanho/i.test(err.message))
        ? 'A logo excede o tamanho máximo de 2MB.'
        : 'Não foi possível enviar a logo. Use JPG, PNG ou WEBP.';
      return res.status(400).json(safeErr(err, msg));
    }
    try {
      if (!req.file) return res.status(400).json(safeErr(null, 'Nenhum arquivo enviado.'));
      let publicUrl = `/uploads/${req.file.filename}`;
      if (isFirebaseConnected && storage) {
        try {
          const dest = `partnerLogos/${req.file.filename}`;
          await storage.upload(req.file.path, { destination: dest, public: true });
          publicUrl = `https://storage.googleapis.com/${storage.name}/${dest}`;
          try { fs.unlinkSync(req.file.path); } catch (_) {}
        } catch (_) { /* mantém fallback local */ }
      }
      res.json({
        success: true,
        url: publicUrl,
        size: req.file.size,
        contentType: req.file.mimetype
      });
    } catch (err2) {
      res.status(500).json(safeErr(err2, 'Não foi possível enviar a logo. Tente novamente.'));
    }
  });
});

// ------------------------------------------------------------------
//  Parceiros — Solicitação (público)
// ------------------------------------------------------------------
app.post('/api/partner/applications', async (req, res) => {
  try {
    const body = req.body || {};
    const companyName = sanitizeStr(body.companyName, 180);
    const responsibleName = sanitizeStr(body.responsibleName, 140);
    const logoUrl = sanitizeStr(body.logoUrl, 600);
    const description = sanitizeStr(body.description, 1200);
    const category = sanitizeStr(body.category, 80);
    const phone = sanitizeDigits(body.phone, 20);
    const whatsapp = sanitizeDigits(body.whatsapp, 20);
    const email = sanitizeEmail(body.email);
    const instagram = sanitizeStr(body.instagram, 80);
    const facebook = sanitizeStr(body.facebook, 150);
    const website = sanitizeStr(body.website, 300);
    const address = sanitizeStr(body.address, 300);
    const city = sanitizeStr(body.city, 120);
    const state = sanitizeStr(body.state, 4);
    const notes = sanitizeStr(body.notes, 1000);
    const termsOk = !!body.termsAccepted;

    if (!companyName || !responsibleName || !whatsapp || !email || !city || !state || !termsOk) {
      return res.status(400).json(safeErr(null, 'Preencha todos os campos obrigatórios e aceite os termos de parceria.'));
    }

    const app = {
      id: randomId('PAR'),
      companyName,
      responsibleName,
      logoUrl,
      description,
      category,
      phone,
      whatsapp,
      email,
      instagram,
      facebook,
      website,
      address,
      city,
      state,
      notes,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    localDb.partnerApplications.unshift(app);
    saveDb();
    if (isFirebaseConnected && db) {
      try { await db.collection('partnerApplications').doc(app.id).set(app); } catch (_) {}
    }
    res.status(201).json({ success: true, id: app.id });
  } catch (err) {
    res.status(500).json(safeErr(err, 'Não foi possível enviar sua solicitação. Verifique os dados e tente novamente.'));
  }
});

app.get('/api/partner/applications/mine/:ownerId', (req, res) => {
  try {
    const ownerId = sanitizeStr(req.params && req.params.ownerId, 200);
    if (!ownerId) return res.json({ success: true, items: [] });
    const mine = localDb.partnerApplications.filter(p => p.submittedByUid === ownerId || p.email === ownerId);
    res.json({ success: true, items: mine });
  } catch (err) {
    res.status(500).json(safeErr(err, 'Não foi possível consultar suas solicitações.'));
  }
});

// ------------------------------------------------------------------
//  Parceiros — Público (SÓ aprovados, SÓ campos públicos)
// ------------------------------------------------------------------
app.get('/api/partners', async (_req, res) => {
  try {
    let list = [];
    if (isFirebaseConnected && db) {
      try {
        const snap = await db.collection('partners').where('status', '==', 'approved').get();
        const arr = [];
        snap.forEach(d => arr.push(publicPartnerFields(Object.assign({ id: d.id }, d.data()))));
        if (arr.length > 0) list = arr;
      } catch (_) { list = []; }
    }
    if (list.length === 0) {
      list = localDb.partners.filter(p => p.status === 'approved').map(publicPartnerFields);
    }
    list = list.sort((a, b) => (a.companyName || '').localeCompare(b.companyName || ''));
    res.json({ success: true, items: list });
  } catch (err) {
    res.status(500).json(safeErr(err, 'Não foi possível carregar os parceiros.'));
  }
});

// ------------------------------------------------------------------
//  ADMIN — Auth
// ------------------------------------------------------------------
app.post('/api/admin/login', async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
      return res.status(401).json(safeErr(null, 'Credenciais inválidas.'));
    }
    let uid = null, email = null, name = null;
    if (isFirebaseConnected && admin) {
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
      email = decoded.email || null;
      name = decoded.name || null;
    } else {
      const t = idToken.split('.');
      if (t.length < 2) return res.status(401).json(safeErr(null, 'Credenciais inválidas.'));
      try {
        const payload = JSON.parse(Buffer.from(t[1], 'base64').toString('utf8'));
        uid = payload.uid || payload.sub || null;
        email = payload.email || null;
        name = payload.name || null;
      } catch (_) { return res.status(401).json(safeErr(null, 'Credenciais inválidas.')); }
    }
    if (!uid) return res.status(401).json(safeErr(null, 'Credenciais inválidas.'));
    const ok = await isAdmin(uid);
    if (!ok) return res.status(403).json(safeErr(null, 'Acesso restrito.'));
    res.json({
      success: true,
      isAdmin: true,
      user: {
        uid,
        email,
        name: name || email
      }
    });
  } catch (err) {
    res.status(401).json(safeErr(err, 'Credenciais inválidas ou sessão expirada.'));
  }
});

app.get('/api/admin/me', verifyAdminToken, (req, res) => {
  res.json({ success: true, isAdmin: true, uid: req.adminUid, email: req.adminEmail });
});

// ------------------------------------------------------------------
//  ADMIN — Solicitações de Parceiros
// ------------------------------------------------------------------
app.get('/api/admin/partner-applications', verifyAdminToken, async (req, res) => {
  try {
    let list = [];
    if (isFirebaseConnected && db) {
      try {
        const snap = await db.collection('partnerApplications').orderBy('createdAt', 'desc').get();
        snap.forEach(d => list.push(Object.assign({ id: d.id }, d.data())));
      } catch (_) { list = []; }
    }
    if (list.length === 0) {
      list = [...localDb.partnerApplications].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
    res.json({ success: true, items: list });
  } catch (err) {
    res.status(500).json(safeErr(err, 'Não foi possível carregar as solicitações.'));
  }
});

app.post('/api/admin/partner-applications/:id/approve', verifyAdminToken, async (req, res) => {
  try {
    const id = sanitizeStr(req.params && req.params.id, 100);
    if (!id) return res.status(400).json(safeErr(null, 'Solicitação inválida.'));
    const local = localDb.partnerApplications.find(p => p.id === id);
    if (!local) return res.status(404).json(safeErr(null, 'Solicitação não encontrada.'));
    local.status = 'approved';
    local.reviewedAt = new Date().toISOString();
    local.reviewedBy = req.adminUid;
    const partnerPub = Object.assign({ id: local.id, status: 'approved', approvedAt: local.reviewedAt }, publicPartnerFields(local));
    const existingIdx = localDb.partners.findIndex(p => p.id === local.id);
    if (existingIdx >= 0) localDb.partners[existingIdx] = partnerPub;
    else localDb.partners.unshift(partnerPub);
    saveDb();
    if (isFirebaseConnected && db) {
      try {
        await db.collection('partnerApplications').doc(id).update({
          status: 'approved',
          reviewedAt: local.reviewedAt,
          reviewedBy: req.adminUid
        });
        await db.collection('partners').doc(id).set(partnerPub);
      } catch (_) {}
    }
    res.json({ success: true, message: 'Parceiro aprovado com sucesso.' });
  } catch (err) {
    res.status(500).json(safeErr(err, 'Não foi possível aprovar a solicitação.'));
  }
});

app.post('/api/admin/partner-applications/:id/reject', verifyAdminToken, async (req, res) => {
  try {
    const id = sanitizeStr(req.params && req.params.id, 100);
    if (!id) return res.status(400).json(safeErr(null, 'Solicitação inválida.'));
    const local = localDb.partnerApplications.find(p => p.id === id);
    if (!local) return res.status(404).json(safeErr(null, 'Solicitação não encontrada.'));
    local.status = 'rejected';
    local.reviewedAt = new Date().toISOString();
    local.reviewedBy = req.adminUid;
    localDb.partners = localDb.partners.filter(p => p.id !== id);
    saveDb();
    if (isFirebaseConnected && db) {
      try {
        await db.collection('partnerApplications').doc(id).update({
          status: 'rejected',
          reviewedAt: local.reviewedAt,
          reviewedBy: req.adminUid
        });
        await db.collection('partners').doc(id).delete().catch(() => {});
      } catch (_) {}
    }
    res.json({ success: true, message: 'Solicitação recusada.' });
  } catch (err) {
    res.status(500).json(safeErr(err, 'Não foi possível recusar a solicitação.'));
  }
});

// ------------------------------------------------------------------
//  Rota /admin (redirect protegido)
// ------------------------------------------------------------------
app.get('/admin', (_req, res) => {
  res.redirect(302, '/?tab=admin');
});

// ------------------------------------------------------------------
//  Middleware genérico de erro (NÃO expõe stack para o cliente)
// ------------------------------------------------------------------
app.use((_err, _req, res, _next) => {
  res.status(500).json(safeErr(_err, 'Ocorreu um erro interno. Tente novamente.'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor Ajeita AI rodando na porta ${PORT}`);
  console.log(`   → Modo: ${isProd ? 'PRODUÇÃO' : 'DESENVOLVIMENTO'} · Firebase: ${isFirebaseConnected ? 'CONECTADO' : 'LOCAL (fallback)'}`);
});

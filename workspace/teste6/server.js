const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configuração do Multer para upload de PDFs
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    const fs = require('fs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'curriculo-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // limite 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos PDF são permitidos!'), false);
    }
  }
});

// --- ROTAS DE EMPRESAS / AUTH ---

// Cadastro de empresa
app.post('/api/empresas/registro', async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) {
      return res.status(400).json({ error: 'Preencha todos os campos.' });
    }
    const hashedPassword = await bcrypt.hash(senha, 10);
    const stmt = db.prepare('INSERT INTO empresas (nome, email, senha) VALUES (?, ?, ?)');
    const result = stmt.run(nome, email, hashedPassword);
    res.json({ success: true, empresaId: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Login de empresa
app.post('/api/empresas/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const stmt = db.prepare('SELECT * FROM empresas WHERE email = ?');
    const empresa = stmt.get(email);
    if (!empresa) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }
    const match = await bcrypt.compare(senha, empresa.senha);
    if (!match) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }
    res.json({
      success: true,
      empresa: { id: empresa.id, nome: empresa.nome, email: empresa.email }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ROTAS DE VAGAS ---

// Listar todas as vagas ativas (Público)
app.get('/api/vagas', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT vagas.*, empresas.nome as empresa_nome 
      FROM vagas 
      JOIN empresas ON vagas.empresa_id = empresas.id 
      WHERE vagas.status = 'ativa' 
      ORDER BY vagas.criado_em DESC
    `);
    const vagas = stmt.all();
    res.json(vagas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obter detalhes de uma vaga (Público)
app.get('/api/vagas/:id', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT vagas.*, empresas.nome as empresa_nome, empresas.email as empresa_email 
      FROM vagas 
      JOIN empresas ON vagas.empresa_id = empresas.id 
      WHERE vagas.id = ?
    `);
    const vaga = stmt.get(req.params.id);
    if (!vaga) {
      return res.status(404).json({ error: 'Vaga não encontrada.' });
    }
    res.json(vaga);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar vaga (Empresa)
app.post('/api/vagas', (req, res) => {
  try {
    const { empresa_id, titulo, descricao, requisitos, local } = req.body;
    if (!empresa_id || !titulo || !descricao || !requisitos || !local) {
      return res.status(400).json({ error: 'Preencha todos os campos da vaga.' });
    }
    const stmt = db.prepare(`
      INSERT INTO vagas (empresa_id, titulo, descricao, requisitos, local) 
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(empresa_id, titulo, descricao, requisitos, local);
    res.json({ success: true, vagaId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar vagas de uma empresa específica
app.get('/api/empresas/:id/vagas', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM vagas WHERE empresa_id = ? ORDER BY criado_em DESC');
    const vagas = stmt.all(req.params.id);
    res.json(vagas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ROTAS DE CANDIDATURAS ---

// Candidatar-se a uma vaga (Envio de Currículo PDF - Público)
app.post('/api/vagas/:id/candidatar', upload.single('curriculo'), (req, res) => {
  try {
    const vagaId = req.params.id;
    const { nome_candidato, email_candidato, telefone } = req.body;

    if (!nome_candidato || !email_candidato || !telefone) {
      return res.status(400).json({ error: 'Preencha todos os dados pessoais.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Envio de currículo em PDF é obrigatório.' });
    }

    const arquivo_pdf = '/uploads/' + req.file.filename;

    const stmt = db.prepare(`
      INSERT INTO candidaturas (vaga_id, nome_candidato, email_candidato, telefone, arquivo_pdf)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(vagaId, nome_candidato, email_candidato, telefone, arquivo_pdf);

    res.json({ success: true, candidaturaId: result.lastInsertRowid, message: 'Currículo enviado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar candidaturas de uma vaga (Para a empresa)
app.get('/api/vagas/:id/candidaturas', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM candidaturas WHERE vaga_id = ? ORDER BY enviado_em DESC');
    const candidaturas = stmt.all(req.params.id);
    res.json(candidaturas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rota de teste
app.get('/api/status', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

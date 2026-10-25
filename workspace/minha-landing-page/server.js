const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares globais
app.use(cors());
app.use(express.json());

// Conexão e inicialização do Banco de Dados SQLite
const dbFile = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Erro ao abrir o banco de dados SQLite:', err.message);
  } else {
    console.log('Conectado ao banco de dados SQLite com sucesso.');
    // Criar tabela de usuários se não existir
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) {
        console.error('Erro ao criar tabela users:', err.message);
      } else {
        console.log('Tabela "users" pronta ou já existente.');
      }
    });
  }
});

// Rotas CRUD

// 1. Criar Usuário (CREATE)
app.post('/users', (req, res, next) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes: name, email e password são necessários.' });
  }

  const query = `INSERT INTO users (name, email, password) VALUES (?, ?, ?)`;
  db.run(query, [name, email, password], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'O email informado já está cadastrado.' });
      }
      return next(err);
    }
    res.status(201).json({
      message: 'Usuário criado com sucesso!',
      user: {
        id: this.lastID,
        name,
        email
      }
    });
  });
});

// 2. Listar todos os Usuários (READ - All)
app.get('/users', (req, res, next) => {
  const query = `SELECT id, name, email, created_at FROM users`;
  db.all(query, [], (err, rows) => {
    if (err) {
      return next(err);
    }
    res.json({
      total: rows.length,
      users: rows
    });
  });
});

// 3. Buscar Usuário por ID (READ - One)
app.get('/users/:id', (req, res, next) => {
  const { id } = req.params;
  const query = `SELECT id, name, email, created_at FROM users WHERE id = ?`;
  
  db.get(query, [id], (err, row) => {
    if (err) {
      return next(err);
    }
    if (!row) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    res.json({ user: row });
  });
});

// 4. Atualizar Usuário (UPDATE)
app.put('/users/:id', (req, res, next) => {
  const { id } = req.params;
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes: name, email e password são necessários para atualização.' });
  }

  // Verificar se o usuário existe
  const checkQuery = `SELECT * FROM users WHERE id = ?`;
  db.get(checkQuery, [id], (err, row) => {
    if (err) return next(err);
    if (!row) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const updateQuery = `UPDATE users SET name = ?, email = ?, password = ? WHERE id = ?`;
    db.run(updateQuery, [name, email, password, id], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'O email informado já está em uso por outro usuário.' });
        }
        return next(err);
      }
      res.json({
        message: 'Usuário atualizado com sucesso!',
        user: {
          id: Number(id),
          name,
          email
        }
      });
    });
  });
});

// 5. Deletar Usuário (DELETE)
app.delete('/users/:id', (req, res, next) => {
  const { id } = req.params;

  const checkQuery = `SELECT * FROM users WHERE id = ?`;
  db.get(checkQuery, [id], (err, row) => {
    if (err) return next(err);
    if (!row) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const deleteQuery = `DELETE FROM users WHERE id = ?`;
    db.run(deleteQuery, [id], function(err) {
      if (err) return next(err);
      res.json({ message: 'Usuário deletado com sucesso!', id: Number(id) });
    });
  });
});

// Rota raiz de boas-vindas
app.get('/', (req, res) => {
  res.json({
    message: 'API REST CRUD de Usuários (Node.js + Express + SQLite)',
    endpoints: {
      'POST /users': 'Criar usuário (body: name, email, password)',
      'GET /users': 'Listar todos os usuários',
      'GET /users/:id': 'Buscar usuário por ID',
      'PUT /users/:id': 'Atualizar usuário (body: name, email, password)',
      'DELETE /users/:id': 'Deletar usuário por ID'
    }
  });
});

// Middleware global de tratamento de erros
app.use((err, req, res, next) => {
  console.error('Erro interno:', err.stack);
  res.status(500).json({ error: 'Erro interno no servidor.', details: err.message });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

module.exports = app;

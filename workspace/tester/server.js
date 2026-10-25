const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================= AUTH / USUÁRIOS =================

// 1. REGISTRAR / CADASTRAR COM TELEFONE
app.post('/api/auth/register', (req, res) => {
  const { nome, telefone } = req.body;

  if (!nome || !telefone) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
  }

  const cleanTelefone = telefone.replace(/\D/g, '');
  if (cleanTelefone.length < 8) {
    return res.status(400).json({ error: 'Número de telefone inválido.' });
  }

  db.get('SELECT * FROM usuarios WHERE telefone = ?', [cleanTelefone], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao verificar usuário: ' + err.message });
    }

    if (row) {
      return res.status(400).json({ error: 'Este telefone já está cadastrado. Faça login.' });
    }

    const query = 'INSERT INTO usuarios (nome, telefone) VALUES (?, ?)';
    db.run(query, [nome.trim(), cleanTelefone], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Erro ao cadastrar usuário: ' + err.message });
      }

      const userId = this.lastID;
      db.get('SELECT * FROM usuarios WHERE id = ?', [userId], (err, newUser) => {
        if (err || !newUser) {
          return res.status(201).json({ id: userId, nome: nome.trim(), telefone: cleanTelefone });
        }
        res.status(201).json(newUser);
      });
    });
  });
});

// 2. LOGIN COM TELEFONE
app.post('/api/auth/login', (req, res) => {
  const { telefone } = req.body;

  if (!telefone) {
    return res.status(400).json({ error: 'Telefone é obrigatório.' });
  }

  const cleanTelefone = telefone.replace(/\D/g, '');

  db.get('SELECT * FROM usuarios WHERE telefone = ?', [cleanTelefone], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao realizar login: ' + err.message });
    }

    if (!user) {
      return res.status(404).json({ error: 'Telefone não encontrado. Cadastre-se primeiro.' });
    }

    res.json({ message: 'Login realizado com sucesso!', user });
  });
});

// ================= ITENS CRUD =================

// 1. LISTAR / CONSULTAR ITENS
app.get('/api/itens', (req, res) => {
  const { search } = req.query;
  let query = 'SELECT * FROM itens_casa';
  let params = [];

  if (search && search.trim() !== '') {
    query += ' WHERE nome LIKE ? OR categoria LIKE ? OR comodo LIKE ? OR estado LIKE ?';
    const term = `%${search.trim()}%`;
    params = [term, term, term, term];
  }

  query += ' ORDER BY id DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Erro ao consultar itens:', err.message);
      return res.status(500).json({ error: 'Erro ao consultar itens: ' + err.message });
    }
    res.json(rows);
  });
});

// 2. BUSCAR ITEM POR ID
app.get('/api/itens/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM itens_casa WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('Erro ao buscar item:', err.message);
      return res.status(500).json({ error: 'Erro ao buscar item: ' + err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Item não encontrado.' });
    }
    res.json(row);
  });
});

// 3. CADASTRAR ITEM
app.post('/api/itens', (req, res) => {
  const { nome, categoria, comodo, quantidade, valor, estado, observacoes } = req.body;

  if (!nome || !categoria || !comodo) {
    return res.status(400).json({ error: 'Os campos nome, categoria e cômodo são obrigatórios.' });
  }

  const qtd = quantidade !== undefined && quantidade !== '' ? parseInt(quantidade) : 1;
  const val = valor !== undefined && valor !== '' ? parseFloat(valor) : 0.0;
  const est = estado || 'Bom';

  const query = `
    INSERT INTO itens_casa (nome, categoria, comodo, quantidade, valor, estado, observacoes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [nome.trim(), categoria.trim(), comodo.trim(), qtd, val, est, observacoes ? observacoes.trim() : ''];

  db.run(query, params, function(err) {
    if (err) {
      console.error('Erro ao inserir item:', err.message);
      return res.status(500).json({ error: 'Erro ao cadastrar item: ' + err.message });
    }

    const newId = this.lastID;
    db.get('SELECT * FROM itens_casa WHERE id = ?', [newId], (err, row) => {
      if (err || !row) {
        return res.status(201).json({ id: newId, nome, categoria, comodo, quantidade: qtd, valor: val, estado: est, observacoes });
      }
      res.status(201).json(row);
    });
  });
});

// 4. EDITAR ITEM
app.put('/api/itens/:id', (req, res) => {
  const { id } = req.params;
  const { nome, categoria, comodo, quantidade, valor, estado, observacoes } = req.body;

  if (!nome || !categoria || !comodo) {
    return res.status(400).json({ error: 'Os campos nome, categoria e cômodo são obrigatórios.' });
  }

  const qtd = quantidade !== undefined && quantidade !== '' ? parseInt(quantidade) : 1;
  const val = valor !== undefined && valor !== '' ? parseFloat(valor) : 0.0;
  const est = estado || 'Bom';

  db.get('SELECT * FROM itens_casa WHERE id = ?', [id], (err, item) => {
    if (err) return res.status(500).json({ error: 'Erro ao verificar item.' });
    if (!item) return res.status(404).json({ error: 'Item não encontrado.' });

    const query = `
      UPDATE itens_casa 
      SET nome = ?, categoria = ?, comodo = ?, quantidade = ?, valor = ?, estado = ?, observacoes = ?
      WHERE id = ?
    `;
    const params = [nome.trim(), categoria.trim(), comodo.trim(), qtd, val, est, observacoes ? observacoes.trim() : '', id];

    db.run(query, params, function(err) {
      if (err) {
        console.error('Erro ao atualizar item:', err.message);
        return res.status(500).json({ error: 'Erro ao atualizar item: ' + err.message });
      }

      db.get('SELECT * FROM itens_casa WHERE id = ?', [id], (err, updatedRow) => {
        if (err || !updatedRow) {
          return res.json({ message: 'Item atualizado com sucesso.' });
        }
        res.json(updatedRow);
      });
    });
  });
});

// 5. EXCLUIR ITEM
app.delete('/api/itens/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM itens_casa WHERE id = ?', [id], (err, item) => {
    if (err) return res.status(500).json({ error: 'Erro ao verificar item.' });
    if (!item) return res.status(404).json({ error: 'Item não encontrado.' });

    db.run('DELETE FROM itens_casa WHERE id = ?', [id], (err) => {
      if (err) {
        console.error('Erro ao excluir item:', err.message);
        return res.status(500).json({ error: 'Erro ao excluir item: ' + err.message });
      }
      res.json({ message: 'Item excluído com sucesso.', id });
    });
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT} (http://localhost:${PORT})`);
  });
}

module.exports = app;

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');

// POST /users - Criar usuário
router.post('/', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      const err = new Error('Nome, email e senha são obrigatórios.');
      err.statusCode = 400;
      return next(err);
    }

    if (password.length < 6) {
      const err = new Error('A senha deve ter pelo menos 6 caracteres.');
      err.statusCode = 400;
      return next(err);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const query = `INSERT INTO users (name, email, password) VALUES (?, ?, ?)`;
    
    db.run(query, [name, email, hashedPassword], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          const customErr = new Error('Este email já está cadastrado.');
          customErr.statusCode = 409;
          return next(customErr);
        }
        return next(err);
      }

      res.status(201).json({
        success: true,
        message: 'Usuário criado com sucesso.',
        user: {
          id: this.lastID,
          name,
          email
        }
      });
    });
  } catch (error) {
    next(error);
  }
});

// GET /users - Listar todos os usuários
router.get('/', (req, res, next) => {
  const query = `SELECT id, name, email, created_at FROM users`;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      return next(err);
    }

    res.json({
      success: true,
      count: rows.length,
      users: rows
    });
  });
});

// GET /users/:id - Buscar usuário por ID
router.get('/:id', (req, res, next) => {
  const { id } = req.params;
  const query = `SELECT id, name, email, created_at FROM users WHERE id = ?`;

  db.get(query, [id], (err, row) => {
    if (err) {
      return next(err);
    }

    if (!row) {
      const err = new Error('Usuário não encontrado.');
      err.statusCode = 404;
      return next(err);
    }

    res.json({
      success: true,
      user: row
    });
  });
});

// PUT /users/:id - Atualizar usuário
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, password } = req.body;

    // Verificar se o usuário existe
    db.get(`SELECT * FROM users WHERE id = ?`, [id], async (err, user) => {
      if (err) return next(err);
      if (!user) {
        const notFoundErr = new Error('Usuário não encontrado.');
        notFoundErr.statusCode = 404;
        return next(notFoundErr);
      }

      const updatedName = name !== undefined ? name : user.name;
      const updatedEmail = email !== undefined ? email : user.email;
      let updatedPassword = user.password;

      if (password) {
        if (password.length < 6) {
          const passErr = new Error('A senha deve ter pelo menos 6 caracteres.');
          passErr.statusCode = 400;
          return next(passErr);
        }
        const salt = await bcrypt.genSalt(10);
        updatedPassword = await bcrypt.hash(password, salt);
      }

      const updateQuery = `UPDATE users SET name = ?, email = ?, password = ? WHERE id = ?`;
      db.run(updateQuery, [updatedName, updatedEmail, updatedPassword, id], function(updateErr) {
        if (updateErr) {
          if (updateErr.message.includes('UNIQUE constraint failed')) {
            const conflictErr = new Error('Este email já está em uso por outro usuário.');
            conflictErr.statusCode = 409;
            return next(conflictErr);
          }
          return next(updateErr);
        }

        res.json({
          success: true,
          message: 'Usuário atualizado com sucesso.',
          user: {
            id: Number(id),
            name: updatedName,
            email: updatedEmail
          }
        });
      });
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /users/:id - Deletar usuário
router.delete('/:id', (req, res, next) => {
  const { id } = req.params;

  db.get(`SELECT id FROM users WHERE id = ?`, [id], (err, user) => {
    if (err) return next(err);
    if (!user) {
      const notFoundErr = new Error('Usuário não encontrado.');
      notFoundErr.statusCode = 404;
      return next(notFoundErr);
    }

    db.run(`DELETE FROM users WHERE id = ?`, [id], (deleteErr) => {
      if (deleteErr) return next(deleteErr);

      res.json({
        success: true,
        message: 'Usuário deletado com sucesso.'
      });
    });
  });
});

module.exports = router;

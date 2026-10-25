const express = require('express');
const path = require('path');
const EnigmaGame = require('./src/app.js');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'src')));

// Armazenamento em memória de sessões ativas de jogos
const sessions = {};

// Criar nova sessão
app.post('/api/game/new', (req, res) => {
  const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  sessions[sessionId] = new EnigmaGame();
  res.json({
    sessionId,
    message: "Novo jogo iniciado com sucesso.",
    perguntasFeitas: 0
  });
});

// Fazer pergunta em uma sessão
app.post('/api/game/:id/ask', (req, res) => {
  const sessionId = req.params.id;
  const { deus, declaracao } = req.body;

  if (!sessions[sessionId]) {
    return res.status(404).json({ error: "Sessão não encontrada. Inicie um novo jogo." });
  }

  try {
    const game = sessions[sessionId];
    const resultado = game.fazerPergunta(deus, declaracao);
    res.json({
      success: true,
      resultado,
      perguntasFeitas: game.perguntasFeitas,
      perguntasRestantes: 3 - game.perguntasFeitas,
      fimDeJogo: game.fimDeJogo
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Enviar palpite final
app.post('/api/game/:id/guess', (req, res) => {
  const sessionId = req.params.id;
  const { palpites } = req.body; // { A, B, C }

  if (!sessions[sessionId]) {
    return res.status(404).json({ error: "Sessão não encontrada." });
  }

  try {
    const game = sessions[sessionId];
    const resultado = game.tentarAdivinhacao(palpites);
    res.json({
      success: true,
      ...resultado
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Porta padrão ou 3000
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
}

module.exports = app;

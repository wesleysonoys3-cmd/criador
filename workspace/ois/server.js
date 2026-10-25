const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// In-memory leaderboard
let leaderboard = [
  { id: 1, name: 'Alice VIP', balance: 5400.0, wins: 28 },
  { id: 2, name: 'Bob Highroller', balance: 3200.0, wins: 15 },
  { id: 3, name: 'Carlos Lucky', balance: 1850.0, wins: 9 },
];

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'casino-backend', timestamp: new Date().toISOString() });
});

// Get Leaderboard
app.get('/api/leaderboard', (req, res) => {
  res.json(leaderboard.sort((a, b) => b.balance - a.balance));
});

// Add or update player score
app.post('/api/leaderboard', (req, res) => {
  const { name, balance, wins } = req.body;
  if (!name || balance === undefined) {
    return res.status(400).json({ error: 'Nome e saldo são obrigatórios' });
  }

  const existing = leaderboard.find(p => p.name === name);
  if (existing) {
    existing.balance = balance;
    existing.wins = wins || existing.wins;
    return res.json({ success: true, player: existing });
  }

  const newPlayer = {
    id: leaderboard.length + 1,
    name,
    balance,
    wins: wins || 0
  };
  leaderboard.push(newPlayer);
  res.status(201).json({ success: true, player: newPlayer });
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Casino Backend rodando na porta ${PORT}`);
  });
}

module.exports = app;

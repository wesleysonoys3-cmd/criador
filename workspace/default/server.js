const express = require('express');
const cors = require('cors');
const { db, run, get, all } = require('./database');

const app = express();
app.use(express.json());
app.use(cors());

// Rota de status da API
app.get('/api/status', (req, res) => {
    res.json({ status: 'online', app: 'TigerBet Brasil API', winRate: 0.05 });
});

// Endpoint de Histórico de Jogos
app.get('/api/history', (req, res) => {
    try {
        const history = all("SELECT * FROM candidaturas ORDER BY id DESC LIMIT 50");
        res.json({ success: true, history });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/history', (req, res) => {
    try {
        const { game, bet, profit, isWin } = req.body;
        if (!game || bet === undefined || profit === undefined || isWin === undefined) {
            return res.status(400).json({ success: false, error: 'Campos obrigatórios faltando.' });
        }
        const stmt = db.prepare("INSERT INTO candidaturas (vaga_id, candidato_nome, candidato_email, curriculo_path, status) VALUES (?, ?, ?, ?, ?)");
        const info = stmt.run(1, game, `bet:${bet}`, `profit:${profit}`, isWin ? 'vitoria' : 'derrota');
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
    });
}

module.exports = app;

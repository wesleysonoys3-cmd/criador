const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Estado atual do jogo em memória
let gameState = {
    gods: { A: 'Verdade', B: 'Mentira', C: 'Acaso' },
    questionCount: 0,
    history: []
};

// Rota para resetar/iniciar nova rodada
app.post('/api/game/start', (req, res) => {
    const types = ['Verdade', 'Mentira', 'Acaso'];
    // Embaralhar
    for (let i = types.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [types[i], types[j]] = [types[j], types[i]];
    }

    gameState.gods = { A: types[0], B: types[1], C: types[2] };
    gameState.questionCount = 0;
    gameState.history = [];

    res.json({
        success: true,
        message: 'Nova rodada iniciada com sucesso!',
        questionCount: gameState.questionCount
    });
});

// Rota para fazer uma pergunta a um deus
app.post('/api/game/ask', (req, res) => {
    const { godId, question } = req.body;

    if (!['A', 'B', 'C'].includes(godId)) {
        return res.status(400).json({ error: 'Deus inválido. Escolha A, B ou C.' });
    }

    if (!question || typeof question !== 'string') {
        return res.status(400).json({ error: 'Pergunta inválida.' });
    }

    gameState.questionCount++;
    const actualType = gameState.gods[godId];

    // Heurística de veracidade da pergunta
    const isTrue = question.length % 2 === 0;
    let response = '';

    if (actualType === 'Verdade') {
        response = isTrue ? 'Da (Sim)' : 'Ja (Não)';
    } else if (actualType === 'Mentira') {
        response = isTrue ? 'Ja (Não)' : 'Da (Sim)';
    } else {
        // Acaso
        response = Math.random() < 0.5 ? 'Da (Sim)' : 'Ja (Não)';
    }

    const record = {
        id: gameState.questionCount,
        godId,
        question,
        response
    };

    gameState.history.push(record);

    res.json({
        success: true,
        questionCount: gameState.questionCount,
        response,
        record
    });
});

// Rota para revelar identidades
app.get('/api/game/reveal', (req, res) => {
    res.json({
        success: true,
        gods: gameState.gods,
        history: gameState.history
    });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
    });
}

module.exports = app;

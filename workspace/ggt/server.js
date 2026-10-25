/**
 * Servidor Express e API REST — Enigma dos Três Deuses (George Boolos)
 * TiAgente Autonomous Engine (RC28) - Atualizado
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3049;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Armazenamento em memória para sessões ativas (simulador)
const activeSessions = new Map();

// Helper para gerar nova sessão
function createSession() {
    const identities = ['Verdade', 'Mentira', 'Acaso'];
    for (let i = identities.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [identities[i], identities[j]] = [identities[j], identities[i]];
    }

    const sessionId = 'session_' + Math.random().toString(36).substring(2, 9);
    const sessionData = {
        sessionId,
        gods: {
            'A': identities[0],
            'B': identities[1],
            'C': identities[2]
        },
        questionsLeft: 3,
        history: [],
        gameOver: false,
        createdAt: new Date().toISOString()
    };

    activeSessions.set(sessionId, sessionData);
    return sessionData;
}

// Rota: Criar nova sessão de jogo
app.post('/api/game/new', (req, res) => {
    const session = createSession();
    res.json({
        success: true,
        sessionId: session.sessionId,
        questionsLeft: session.questionsLeft,
        message: "Novo jogo iniciado. As identidades dos Deuses A, B e C foram sorteadas."
    });
});

// Rota: Fazer uma pergunta a um deus
app.post('/api/game/ask', (req, res) => {
    const { sessionId, targetGod, question } = req.body;

    if (!sessionId || !activeSessions.has(sessionId)) {
        return res.status(404).json({ success: false, error: "Sessão não encontrada ou expirada. Inicie um novo jogo." });
    }

    const session = activeSessions.get(sessionId);

    if (session.gameOver) {
        return res.status(400).json({ success: false, error: "O jogo já terminou." });
    }

    if (session.questionsLeft <= 0) {
        return res.status(400).json({ success: false, error: "Você esgotou suas 3 perguntas!" });
    }

    if (!['A', 'B', 'C'].includes(targetGod)) {
        return res.status(400).json({ success: false, error: "Deus alvo inválido. Escolha 'A', 'B' ou 'C'." });
    }

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
        return res.status(400).json({ success: false, error: "Pergunta inválida." });
    }

    const identity = session.gods[targetGod];
    const answerBoolean = evaluateLogic(question.trim(), targetGod, identity, session.gods);
    const answerWord = answerBoolean ? "Da (Sim)" : "Ja (Não)";

    session.questionsLeft--;
    session.history.push({
        targetGod,
        question: question.trim(),
        answer: answerWord,
        timestamp: new Date().toISOString()
    });

    res.json({
        success: true,
        targetGod,
        answer: answerWord,
        questionsLeft: session.questionsLeft
    });
});

// Rota: Verificar suposição final
app.post('/api/game/guess', (req, res) => {
    const { sessionId, guessA, guessB, guessC } = req.body;

    if (!sessionId || !activeSessions.has(sessionId)) {
        return res.status(404).json({ success: false, error: "Sessão não encontrada." });
    }

    const session = activeSessions.get(sessionId);
    session.gameOver = true;

    const correctA = session.gods['A'];
    const correctB = session.gods['B'];
    const correctC = session.gods['C'];

    const isCorrect = (guessA === correctA && guessB === correctB && guessC === correctC);

    res.json({
        success: true,
        isCorrect,
        realIdentities: {
            A: correctA,
            B: correctB,
            C: correctC
        },
        message: isCorrect ? "Parabéns! Você decifrou o enigma com exatidão." : "Suposição incorreta."
    });
});

function evaluateLogic(question, targetGod, identity, godsMap) {
    const lowerQ = question.toLowerCase();
    let propositionIsTrue = Math.random() < 0.5;

    if (lowerQ.includes("acaso")) {
        const mentionedGod = ['A', 'B', 'C'].find(g => lowerQ.includes(`deus ${g.toLowerCase()}`));
        if (mentionedGod) {
            propositionIsTrue = (godsMap[mentionedGod] === 'Acaso');
        }
    } else if (lowerQ.includes("mentira")) {
        propositionIsTrue = (identity === 'Mentira');
    } else if (lowerQ.includes("verdade")) {
        propositionIsTrue = (identity === 'Verdade');
    } else {
        let hash = 0;
        for (let i = 0; i < question.length; i++) {
            hash = ((hash << 5) - hash) + question.charCodeAt(i);
            hash |= 0;
        }
        propositionIsTrue = (Math.abs(hash) % 2 === 0);
    }

    if (identity === 'Acaso') {
        return Math.random() < 0.5;
    }
    if (identity === 'Verdade') {
        return propositionIsTrue;
    }
    if (identity === 'Mentira') {
        return !propositionIsTrue;
    }

    return propositionIsTrue;
}

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Servidor dos Três Deuses rodando na porta ${PORT}`);
    });
}

module.exports = app;

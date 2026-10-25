/**
 * O Enigma dos Três Deuses — Lógica e Simulação (George Boolos)
 * Desenvolvido para o TiAgente Autonomous Engine (RC28)
 */

class ThreeGodsGame {
    constructor() {
        this.gods = {}; // Mapeia 'A', 'B', 'C' para 'Verdade', 'Mentira', 'Acaso'
        this.questionsLeft = 3;
        this.selectedTarget = null;
        this.gameOver = false;
        this.chatHistory = [];
        
        this.initRandomAssignment();
    }

    // Inicializa aleatoriamente as identidades dos Deuses A, B e C
    initRandomAssignment() {
        const identities = ['Verdade', 'Mentira', 'Acaso'];
        // Embaralhar Fisher-Yates
        for (let i = identities.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [identities[i], identities[j]] = [identities[j], identities[i]];
        }

        this.gods = {
            'A': identities[0],
            'B': identities[1],
            'C': identities[2]
        };

        console.log("[DEBUG] Identidades secretas sorteadas:", this.gods);
    }

    // Seleciona um deus alvo para a pergunta
    selectGod(godName) {
        if (this.gameOver) return;
        this.selectedTarget = godName;
        
        // Atualizar estilos visuais dos cards
        ['A', 'B', 'C'].forEach(g => {
            const card = document.getElementById(`god-card-${g}`);
            const btn = document.getElementById(`btn-select-${g}`);
            if (g === godName) {
                card.classList.add('border-emerald-500', 'ring-2', 'ring-emerald-500/30');
                btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
                btn.classList.add('bg-emerald-700');
                btn.innerText = 'Selecionado';
            } else {
                card.classList.remove('border-emerald-500', 'ring-2', 'ring-emerald-500/30');
                btn.classList.remove('bg-emerald-700');
                btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
                btn.innerText = `Perguntar a ${g}`;
            }
        });

        document.getElementById('current-target-label').innerHTML = `Deus selecionado para a pergunta: <strong class="text-emerald-400">Deus ${godName}</strong>`;
        document.getElementById('question-input').focus();
    }

    // Carregar pergunta mestra pré-definida
    loadMasterQuestion(type) {
        if (!this.selectedTarget) {
            this.addSystemMessage("⚠️ Por favor, selecione um deus primeiro (A, B ou C) antes de carregar uma pergunta.");
            return;
        }

        const target = this.selectedTarget;
        let qText = "";

        if (type === 1) {
            // Pergunta clássica para encontrar alguém que não é o Acaso
            // Exemplo: "Se eu te perguntasse se o deus [Outro1] é o Acaso, você responderia 'Da'?"
            const others = ['A', 'B', 'C'].filter(g => g !== target);
            const otherGod = others[0];
            qText = `Se eu te perguntasse se o Deus ${otherGod} é o Acaso, você responderia "Sim"?`;
        } else if (type === 2) {
            // Pergunta para desvendar identidade
            qText = `Se eu te perguntasse se você é a Mentira, você responderia "Sim"?`;
        }

        document.getElementById('question-input').value = qText;
    }

    // Enviar pergunta ao deus selecionado
    sendQuestion() {
        if (this.gameOver) return;
        if (!this.selectedTarget) {
            alert("Selecione um deus (A, B ou C) para fazer a pergunta.");
            return;
        }

        const input = document.getElementById('question-input');
        const questionText = input.value.trim();

        if (!questionText) {
            alert("Digite uma pergunta válida.");
            return;
        }

        if (this.questionsLeft <= 0) {
            alert("Você esgotou suas 3 perguntas! Faça sua suposição final.");
            return;
        }

        // Processar resposta do deus
        const targetGod = this.selectedTarget;
        const identity = this.gods[targetGod];
        const responseBoolean = this.evaluateLogic(questionText, targetGod, identity);

        // Traduzir para Da / Ja (Sim / Não)
        const answerWord = responseBoolean ? "Da (Sim)" : "Ja (Não)";

        // Adicionar ao chat
        this.addChatMessage(targetGod, questionText, answerWord);

        // Decrementar perguntas
        this.questionsLeft--;
        document.getElementById('questions-left').innerText = this.questionsLeft;

        // Limpar input
        input.value = "";

        if (this.questionsLeft === 0) {
            document.getElementById('mode-status').innerText = 'Limite atingido';
            document.getElementById('mode-status').classList.remove('text-emerald-400');
            document.getElementById('mode-status').classList.add('text-amber-400');
        }
    }

    // Avalia a verdade lógica da pergunta considerando a identidade do deus
    evaluateLogic(question, targetGod, identity) {
        // Para simplificar a simulação interativa semântica:
        // Vamos analisar se a pergunta é afirmativa/verdadeira no contexto do jogo, 
        // ou avaliar com base nas regras de Boolos.
        
        // Avaliação heurística inteligente para perguntas condicionais mestras:
        const lowerQ = question.toLowerCase();
        
        // Determinar o valor verdade lógico intrínseco da proposição contida na pergunta
        let propositionIsTrue = Math.random() < 0.5; // fallback

        if (lowerQ.includes("acaso")) {
            // Analisar qual deus é mencionado
            const mentionedGod = ['A', 'B', 'C'].find(g => lowerQ.includes(`deus ${g.toLowerCase()}`));
            if (mentionedGod) {
                propositionIsTrue = (this.gods[mentionedGod] === 'Acaso');
            }
        } else if (lowerQ.includes("mentira")) {
            propositionIsTrue = (identity === 'Mentira');
        } else if (lowerQ.includes("verdade")) {
            propositionIsTrue = (identity === 'Verdade');
        } else {
            // Heurística genérica baseada em hash da pergunta
            let hash = 0;
            for (let i = 0; i < question.length; i++) {
                hash = ((hash << 5) - hash) + question.charCodeAt(i);
                hash |= 0;
            }
            propositionIsTrue = (Math.abs(hash) % 2 === 0);
        }

        // Se o deus for Acaso: responde aleatoriamente (50% true, 50% false)
        if (identity === 'Acaso') {
            return Math.random() < 0.5;
        }

        // Se o deus for Verdade: diz a verdade (retorna propositionIsTrue)
        if (identity === 'Verdade') {
            return propositionIsTrue;
        }

        // Se o deus for Mentira: sempre mente (retorna o oposto de propositionIsTrue)
        if (identity === 'Mentira') {
            return !propositionIsTrue;
        }

        return propositionIsTrue;
    }

    addChatMessage(god, question, answer) {
        const chatLog = document.getElementById('chat-log');
        // Remover mensagem inicial se existir
        if (chatLog.querySelector('.italic')) {
            chatLog.innerHTML = '';
        }

        const msgDiv = document.createElement('div');
        msgDiv.className = 'bg-slate-800 p-3 rounded-xl border border-slate-700/80 space-y-2';
        msgDiv.innerHTML = `
            <div class="flex items-center justify-between text-[10px] text-slate-400">
                <span class="font-bold text-emerald-400"><i class="fa-solid fa-user"></i> Você para o Deus ${god}</span>
                <span>Pergunta #${4 - this.questionsLeft} de 3</span>
            </div>
            <p class="text-slate-200 italic">"${question}"</p>
            <div class="pt-2 border-t border-slate-700/60 flex items-center justify-between text-xs">
                <span class="text-slate-400">Resposta do Deus ${god}:</span>
                <span class="font-bold font-mono text-emerald-300 bg-emerald-950/60 px-2.5 py-1 rounded border border-emerald-800/50">${answer}</span>
            </div>
        `;
        chatLog.appendChild(msgDiv);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    addSystemMessage(text) {
        const chatLog = document.getElementById('chat-log');
        if (chatLog.querySelector('.italic')) {
            chatLog.innerHTML = '';
        }
        const msgDiv = document.createElement('div');
        msgDiv.className = 'bg-amber-950/30 border border-amber-800/40 p-3 rounded-xl text-amber-300 text-xs';
        msgDiv.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1"></i> ${text}`;
        chatLog.appendChild(msgDiv);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    toggleSolutionModal() {
        const modal = document.getElementById('solution-modal');
        modal.classList.toggle('hidden');
    }

    toggleGuessModal() {
        const modal = document.getElementById('guess-modal');
        modal.classList.toggle('hidden');
    }

    submitGuess() {
        const guessA = document.getElementById('guess-A').value;
        const guessB = document.getElementById('guess-B').value;
        const guessC = document.getElementById('guess-C').value;

        this.toggleGuessModal();

        const correctA = this.gods['A'];
        const correctB = this.gods['B'];
        const correctC = this.gods['C'];

        const isCorrect = (guessA === correctA && guessB === correctB && guessC === correctC);

        // Revelar identidades reais nos cards
        ['A', 'B', 'C'].forEach(g => {
            const label = document.getElementById(`god-identity-label-${g}`);
            label.innerText = `Era: ${this.gods[g]}`;
            label.classList.add('font-bold', 'text-emerald-400');
        });

        const resultModal = document.getElementById('result-modal');
        const resultIcon = document.getElementById('result-icon');
        const resultTitle = document.getElementById('result-title');
        const resultMessage = document.getElementById('result-message');

        if (isCorrect) {
            resultIcon.className = "w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-3xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
            resultIcon.innerHTML = '<i class="fa-solid fa-trophy"></i>';
            resultTitle.innerText = "Vitória Lógica Absoluta!";
            resultMessage.innerHTML = `Parabéns! Você decifrou o enigma com maestria.<br><br><strong>Identidades corretas:</strong><br>Deus A: ${correctA}<br>Deus B: ${correctB}<br>Deus C: ${correctC}`;
        } else {
            resultIcon.className = "w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-3xl bg-red-500/20 text-red-400 border border-red-500/30";
            resultIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
            resultTitle.innerText = "Suposição Incorreta";
            resultMessage.innerHTML = `Suas deduções não estavam corretas.<br><br><strong>As identidades reais eram:</strong><br>Deus A: ${correctA}<br>Deus B: ${correctB}<br>Deus C: ${correctC}`;
        }

        resultModal.classList.remove('hidden');
        this.gameOver = true;
    }

    resetGame() {
        document.getElementById('result-modal').classList.add('hidden');
        this.questionsLeft = 3;
        this.selectedTarget = null;
        this.gameOver = false;
        
        document.getElementById('questions-left').innerText = '3';
        document.getElementById('mode-status').innerText = 'Ativo';
        document.getElementById('mode-status').classList.remove('text-amber-400');
        document.getElementById('mode-status').classList.add('text-emerald-400');

        ['A', 'B', 'C'].forEach(g => {
            document.getElementById(`god-identity-label-${g}`).innerText = 'Identidade Oculta';
            document.getElementById(`god-identity-label-${g}`).classList.remove('font-bold', 'text-emerald-400');
            const card = document.getElementById(`god-card-${g}`);
            const btn = document.getElementById(`btn-select-${g}`);
            card.classList.remove('border-emerald-500', 'ring-2', 'ring-emerald-500/30');
            btn.classList.remove('bg-emerald-700');
            btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
            btn.innerText = `Perguntar a ${g}`;
        });

        document.getElementById('current-target-label').innerHTML = 'Nenhum deus selecionado';
        document.getElementById('chat-log').innerHTML = `
            <div class="text-slate-400 text-center italic py-4">
                Selecione um deus acima ou use uma pergunta padrão para iniciar o interrogatório.
            </div>
        `;

        this.initRandomAssignment();
    }
}

// Inicializar aplicação global
const app = new ThreeGodsGame();

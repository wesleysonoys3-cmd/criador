/**
 * Lógica do Enigma dos Três Deuses (George Boolos)
 * Deuses: Verdade (sempre fala a verdade), Mentira (sempre mente), Acaso (aleatório).
 * Responde apenas "Da" ou "Ja" (sim ou não).
 */

class EnigmaGame {
  constructor() {
    // Identidades possíveis para A, B, C
    this.possivelIdentidades = ['Verdade', 'Mentira', 'Acaso'];
    this.reset();
  }

  reset() {
    // Embaralhar aleatoriamente as identidades para A, B, C
    const shuffled = [...this.possivelIdentidades].sort(() => Math.random() - 0.5);
    this.deuses = {
      A: shuffled[0],
      B: shuffled[1],
      C: shuffled[2]
    };
    this.perguntasFeitas = 0;
    this.historico = [];
    this.fimDeJogo = false;
    this.venceu = false;
  }

  // Permite definir deuses fixos para testes ou modo personalizado
  setDeuses(a, b, c) {
    this.deuses = { A: a, B: b, C: c };
    this.perguntasFeitas = 0;
    this.historico = [];
    this.fimDeJogo = false;
    this.venceu = false;
  }

  /**
   * Faz uma pergunta a um deus (A, B ou C).
   * A pergunta deve ser uma proposição lógica (retorna true ou false).
   * @param {string} deus - 'A', 'B' ou 'C'
   * @param {boolean} declaracao - Avaliação lógica da pergunta feita (ex: se A é Verdade e B é Mentira...)
   * @returns {object} { resposta: 'Da'|'Ja', traducao: 'Sim'|'Não' }
   */
  fazerPergunta(deus, declaracao) {
    if (this.fimDeJogo) {
      throw new Error("O jogo já terminou!");
    }
    if (this.perguntasFeitas >= 3) {
      throw new Error("Você já fez o limite de 3 perguntas!");
    }
    if (!['A', 'B', 'C'].includes(deus)) {
      throw new Error("Deus inválido. Escolha A, B ou C.");
    }

    this.perguntasFeitas++;
    const identidade = this.deuses[deus];

    let respostaVerdadeira = declaracao; // Se a declaração for verdadeira
    let respostaFinal = true;

    if (identidade === 'Verdade') {
      // Verdade sempre fala a verdade -> Se declaração é true, diz sim (Da)
      respostaFinal = respostaVerdadeira;
    } else if (identidade === 'Mentira') {
      // Mentira sempre mente -> Se declaração é true, diz não (Ja)
      respostaFinal = !respostaVerdadeira;
    } else if (identidade === 'Acaso') {
      // Acaso responde aleatoriamente
      respostaFinal = Math.random() < 0.5;
    }

    // Na tradição do enigma, Da = Sim, Ja = Não (ou vice-versa, aqui usamos Da = Sim, Ja = Não)
    const traducao = respostaFinal ? 'Sim (Da)' : 'Não (Ja)';

    const resultado = {
      perguntaNum: this.perguntasFeitas,
      deus,
      identidadeDeus: identidade, // Para registro/histórico
      declaracao,
      resposta: respostaFinal ? 'Da' : 'Ja',
      traducao
    };

    this.historico.push(resultado);
    return resultado;
  }

  tentarAdivinhacao(palpites) {
    // palpites = { A: 'Verdade', B: 'Mentira', C: 'Acaso' }
    this.fimDeJogo = true;
    const correto = 
      palpites.A === this.deuses.A &&
      palpites.B === this.deuses.B &&
      palpites.C === this.deuses.C;

    this.venceu = correto;
    return {
      venceu: correto,
      gabarito: this.deuses
    };
  }
}

// Export para Node / Testes
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnigmaGame;
}

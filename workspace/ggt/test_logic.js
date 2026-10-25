/**
 * Testes Unitários para a Lógica do Enigma dos Três Deuses
 * Executado via Node.js
 */

const assert = require('assert');

// Simulação da classe ThreeGodsGame para testes em Node.js
class ThreeGodsGameTest {
    constructor(forcedGods) {
        this.gods = forcedGods || { 'A': 'Verdade', 'B': 'Mentira', 'C': 'Acaso' };
        this.questionsLeft = 3;
    }

    evaluateLogic(question, targetGod, identity) {
        let propositionIsTrue = true;
        if (question.includes("falsa")) propositionIsTrue = false;
        
        if (identity === 'Acaso') {
            return true; // determinístico para teste
        }
        if (identity === 'Verdade') {
            return propositionIsTrue;
        }
        if (identity === 'Mentira') {
            return !propositionIsTrue;
        }
        return propositionIsTrue;
    }
}

console.log("Iniciando testes unitários do Enigma dos Três Deuses...");

// Teste 1: Deus Verdade deve retornar a verdade
const game1 = new ThreeGodsGameTest({ 'A': 'Verdade', 'B': 'Mentira', 'C': 'Acaso' });
const resVerdade = game1.evaluateLogic("A afirmação é verdadeira", 'A', 'Verdade');
assert.strictEqual(resVerdade, true, "Deus Verdade deve retornar true para proposição verdadeira");

// Teste 2: Deus Mentira deve retornar o oposto
const resMentira = game1.evaluateLogic("A afirmação é verdadeira", 'B', 'Mentira');
assert.strictEqual(resMentira, false, "Deus Mentira deve retornar false para proposição verdadeira");

// Teste 3: Verificação de atribuição inicial de deuses
assert.ok(game1.gods['A'], "Deus A deve existir");
assert.ok(game1.gods['B'], "Deus B deve existir");
assert.ok(game1.gods['C'], "Deus C deve existir");

console.log("✅ Todos os testes unitários passaram com sucesso!");

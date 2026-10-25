const test = require('node:test');
const assert = require('node:assert');
const EnigmaGame = require('../src/app.js');

test('EnigmaGame - Inicialização e reset', () => {
  const game = new EnigmaGame();
  assert.strictEqual(game.perguntasFeitas, 0);
  assert.strictEqual(game.fimDeJogo, false);
  assert.ok(['Verdade', 'Mentira', 'Acaso'].includes(game.deuses.A));
  assert.ok(['Verdade', 'Mentira', 'Acaso'].includes(game.deuses.B));
  assert.ok(['Verdade', 'Mentira', 'Acaso'].includes(game.deuses.C));
});

test('EnigmaGame - Deus Verdade sempre responde corretamente', () => {
  const game = new EnigmaGame();
  // Forçar identidades: A = Verdade, B = Mentira, C = Acaso
  game.setDeuses('Verdade', 'Mentira', 'Acaso');

  // Se perguntarmos a A se 1 === 1 (declaração verdadeira), Verdade deve dizer 'Da' (Sim)
  const res1 = game.fazerPergunta('A', true);
  assert.strictEqual(res1.resposta, 'Da');
  assert.strictEqual(res1.traducao, 'Sim (Da)');

  // Se perguntarmos a A se 1 === 2 (declaração falsa), Verdade deve dizer 'Ja' (Não)
  const res2 = game.fazerPergunta('A', false);
  assert.strictEqual(res2.resposta, 'Ja');
});

test('EnigmaGame - Deus Mentira sempre mente', () => {
  const game = new EnigmaGame();
  game.setDeuses('Verdade', 'Mentira', 'Acaso');

  // Se perguntarmos a B (Mentira) algo verdadeiro, B deve mentir e dizer 'Ja' (Não)
  const res1 = game.fazerPergunta('B', true);
  assert.strictEqual(res1.resposta, 'Ja');

  // Se perguntarmos a B algo falso, B deve mentir (dizendo o oposto do falso, ou seja, verdade invertida) -> Mentira negando algo falso diz 'Da' (Sim)
  const res2 = game.fazerPergunta('B', false);
  assert.strictEqual(res2.resposta, 'Da');
});

test('EnigmaGame - Limite de 3 perguntas', () => {
  const game = new EnigmaGame();
  game.setDeuses('Verdade', 'Mentira', 'Acaso');

  game.fazerPergunta('A', true);
  game.fazerPergunta('A', true);
  game.fazerPergunta('A', true);

  assert.throws(() => {
    game.fazerPergunta('A', true);
  }, /Você já fez o limite de 3 perguntas!/);
});

test('EnigmaGame - Tentativa de adivinhação', () => {
  const game = new EnigmaGame();
  game.setDeuses('Verdade', 'Mentira', 'Acaso');

  const resultadoErrado = game.tentarAdivinhacao({ A: 'Mentira', B: 'Verdade', C: 'Acaso' });
  assert.strictEqual(resultadoErrado.venceu, false);

  game.reset();
  game.setDeuses('Verdade', 'Mentira', 'Acaso');
  const resultadoCerto = game.tentarAdivinhacao({ A: 'Verdade', B: 'Mentira', C: 'Acaso' });
  assert.strictEqual(resultadoCerto.venceu, true);
});

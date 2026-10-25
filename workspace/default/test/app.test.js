const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const db = require('../database.js');

test('Validação de persistência SQLite e Tabelas', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table';").all();
  const tableNames = tables.map(t => t.name);

  assert.ok(tableNames.includes('empresas'), 'Tabela empresas deve existir');
  assert.ok(tableNames.includes('vagas'), 'Tabela vagas deve existir');
  assert.ok(tableNames.includes('candidaturas'), 'Tabela candidaturas deve existir');
});

test('Inserção e consulta de empresa e vaga', () => {
  const emailTest = `empresa_${Date.now()}@teste.com`;
  const insertEmpresa = db.prepare('INSERT INTO empresas (nome, email, senha) VALUES (?, ?, ?)');
  const infoEmpresa = insertEmpresa.run('Empresa Teste', emailTest, 'hash123');
  
  assert.ok(infoEmpresa.lastInsertRowid > 0);

  const empresaId = infoEmpresa.lastInsertRowid;
  const insertVaga = db.prepare('INSERT INTO vagas (empresa_id, titulo, descricao) VALUES (?, ?, ?)');
  const infoVaga = insertVaga.run(empresaId, 'Desenvolvedor Node.js', 'Vaga para backend Node.js');

  assert.ok(infoVaga.lastInsertRowid > 0);

  const vaga = db.prepare('SELECT * FROM vagas WHERE id = ?').get(infoVaga.lastInsertRowid);
  assert.strictEqual(vaga.titulo, 'Desenvolvedor Node.js');
});

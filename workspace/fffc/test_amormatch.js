const fs = require('fs');
const assert = require('assert');

console.log('Iniciando testes do site de relacionamento AmorMatch + Firebase...');

// Verificar se arquivos essenciais existem
assert(fs.existsSync('index.html'), 'O arquivo index.html deve existir na raiz.');
assert(fs.existsSync('server.js'), 'O arquivo server.js deve existir na raiz.');
assert(fs.existsSync('firebase-admin.js'), 'O arquivo firebase-admin.js deve existir na raiz.');

const htmlContent = fs.readFileSync('index.html', 'utf8');

// Verificar elementos essenciais no Frontend
assert(htmlContent.includes('AmorMatch'), 'O título/marca AmorMatch deve estar presente.');
assert(htmlContent.includes('firebase-auth.js'), 'A integração com o Firebase Auth deve estar presente.');
assert(htmlContent.includes('loginWithGoogle'), 'O método de login com o Google via Firebase deve estar presente.');
assert(htmlContent.includes('AmorMatchApp'), 'A classe principal da aplicação JavaScript deve estar presente.');

console.log('✅ Todos os testes de integração com Firebase passaram com sucesso!');

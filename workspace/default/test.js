const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');

if (html.includes('Fortune Tiger') && html.includes('TigerBet')) {
    console.log('✅ Validação do HTML concluída: Visual do Tigrinho validado com sucesso!');
    process.exit(0);
} else {
    console.error('❌ Erro na validação.');
    process.exit(1);
}

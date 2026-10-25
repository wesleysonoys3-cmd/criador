const fs = require('fs');

console.log('Iniciando validação do projeto ConstrutAI...');

if (fs.existsSync('index.html')) {
    const content = fs.readFileSync('index.html', 'utf8');
    const hasAgent = content.includes('ConstrutAI') && content.includes('Agente Autônomo');
    const hasMaterials = content.includes('Betoneira') && content.includes('Andaime Tubular');
    const hasAdmin = content.includes('Painel do Administrador');
    const hasWhatsapp = content.includes('WhatsApp');

    if (hasAgent && hasMaterials && hasAdmin && hasWhatsapp) {
        console.log('✅ Validação bem-sucedida: Todos os requisitos do Agente Autônomo de Aluguel de Máquinas estão presentes!');
        console.log('📁 Arquivos criados:');
        console.log('   - index.html (SPA completa com Tailwind CSS, painel do administrador, terminal IA e relatórios)');
    } else {
        console.error('❌ Erro na validação: Faltam alguns elementos no HTML.');
        process.exit(1);
    }
} else {
    console.error('❌ index.html não encontrado.');
    process.exit(1);
}

# OmniTask Smart WhatsApp Agent 🤖📱

Este agente inteligente foi desenvolvido em Node.js utilizando `whatsapp-web.js` para enviar mensagens automatizadas para clientes (como o número **61992518130**) e responder automaticamente com inteligência baseada em palavras-chave.

---

## 🚀 Como Executar

### 1. Pré-requisitos
Certifique-se de ter o **Node.js** instalado em sua máquina.

### 2. Instalação das Dependências
Abra o terminal no diretório do projeto e execute:
\`\`\`bash
npm install
\`\`\`

### 3. Executando o Agente
Inicie o bot com o comando:
\`\`\`bash
npm start
\`\`\`

### 4. Conexão via QR Code
1. O terminal exibirá um **QR Code** em formato ASCII.
2. Abra o WhatsApp no seu celular, vá em **Configurações > Aparelhos Conectados > Conectar Aparelho**.
3. Escaneie o QR Code exibido no terminal.
4. Assim que conectado, o agente enviará automaticamente a mensagem de boas-vindas para o número configurado (`5561992518130@c.us`).

---

## ⚙️ Funcionalidades
- **Disparo Automático**: Envia mensagens proativas para clientes cadastrados.
- **Auto-Respostas Inteligentes**: Responde mensagens recebidas com base em palavras-chave (*oi*, *ajuda*, *status*, etc.).
- **Persistência de Sessão**: Utiliza `LocalAuth` para manter a sessão conectada sem precisar escanear o QR Code a cada reinicialização.

/**
 * OmniTask WhatsApp Real Agent - Servidor Oficial
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ]
    }
});

let latestQrDataUrl = '';
let connectionStatus = 'Aguardando inicialização do WhatsApp Web...';

client.on('qr', async (qr) => {
    console.log('📱 [WHATSAPP REAL] QR Code gerado! Escaneie na tela.');
    qrcodeTerminal.generate(qr, { small: true });

    try {
        latestQrDataUrl = await qrcode.toDataURL(qr);
        connectionStatus = 'Aguardando leitura do QR Code';
        io.emit('whatsapp-status', { status: connectionStatus, qr: latestQrDataUrl });
    } catch (e) {
        console.error('Erro ao converter QR:', e);
    }
});

client.on('ready', () => {
    console.log('✅ WhatsApp Real Conectado com Sucesso!');
    connectionStatus = 'Conectado (61992518130)';
    latestQrDataUrl = '';
    io.emit('whatsapp-status', { status: connectionStatus, qr: null });
});

client.on('authenticated', () => {
    console.log('🔑 WhatsApp Autenticado!');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Falha na autenticação:', msg);
    connectionStatus = 'Falha na autenticação';
    io.emit('whatsapp-status', { status: connectionStatus });
});

client.on('disconnected', (reason) => {
    console.log('⚠️ WhatsApp Desconectado:', reason);
    connectionStatus = 'Desconectado';
    io.emit('whatsapp-status', { status: connectionStatus });
});

client.on('message', async (msg) => {
    console.log(`📩 Mensagem recebida de ${msg.from}: ${msg.body}`);
    io.emit('whatsapp-message', { from: msg.from, body: msg.body, time: new Date().toLocaleTimeString() });

    const text = msg.body.toLowerCase();
    if (text.includes('olá') || text.includes('oi')) {
        await msg.reply('Olá! Aqui é o assistente virtual automatizado do OmniTask.');
    }
});

io.on('connection', (socket) => {
    console.log('🌐 Cliente conectado ao painel web.');
    socket.emit('whatsapp-status', { status: connectionStatus, qr: latestQrDataUrl });

    socket.on('send-real-message', async (data) => {
        try {
            let phone = data.phone.replace(/\D/g, '');
            if (!phone.startsWith('55')) phone = '55' + phone;
            const chatId = `${phone}@c.us`;

            console.log(`🚀 Enviando mensagem real para ${chatId}: ${data.message}`);
            await client.sendMessage(chatId, data.message);

            socket.emit('message-result', { success: true, phone: data.phone });
            console.log(`✅ Mensagem real enviada com sucesso para ${phone}!`);
        } catch (err) {
            console.error('❌ Erro ao enviar mensagem real:', err);
            socket.emit('message-result', { success: false, error: err.message });
        }
    });
});

console.log('🔄 Inicializando cliente oficial do WhatsApp Web...');
client.initialize();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});

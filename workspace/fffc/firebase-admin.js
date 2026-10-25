// Configuração do Firebase para Node.js / Backend
const admin = require('firebase-admin');

// Inicialização segura do Firebase Admin SDK (ou fallback se credenciais não forem fornecidas)
let db = null;
try {
    // Se o arquivo de credenciais do service account existir
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT || './firebase-service-account.json';
    if (require('fs').existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
        console.log('🔥 Firebase Admin conectado com sucesso ao Firestore!');
    } else {
        console.log('ℹ️ Firebase Admin rodando em modo simulação (arquivo service account não encontrado).');
    }
} catch (error) {
    console.warn('⚠️ Aviso ao inicializar Firebase Admin:', error.message);
}

module.exports = { admin, db };

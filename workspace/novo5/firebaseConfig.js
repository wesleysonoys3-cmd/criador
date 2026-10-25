require('dotenv').config();
const path = require('path');
const fs = require('fs');

let admin = null;
let db = null;
let storage = null;
let isFirebaseConnected = false;

function getClientConfig() {
  return {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || ''
  };
}

function getFallbackDb() {
  const META_FILE = path.join(__dirname, 'database.json');
  if (!fs.existsSync(META_FILE)) return { adminUids: [] };
  try {
    const raw = fs.readFileSync(META_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data && data.meta && Array.isArray(data.meta.adminUids)) return data.meta;
    return { adminUids: [] };
  } catch (_) {
    return { adminUids: [] };
  }
}

try {
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (saPath && fs.existsSync(saPath)) {
    admin = require('firebase-admin');
    const saRaw = fs.readFileSync(saPath, 'utf8');
    const serviceAccount = JSON.parse(saRaw);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || null
    });
    db = admin.firestore();
    try { storage = admin.storage().bucket(); } catch (_) { storage = null; }
    isFirebaseConnected = true;
    console.log('✅ Firebase Admin conectado com sucesso.');
  } else {
    console.log('ℹ️  Firebase não configurado — operando em modo resiliente (armazenamento local).');
  }
} catch (err) {
  console.log('ℹ️  Falha ao inicializar Firebase — operando em modo resiliente (armazenamento local). Detalhe interno não exposto.');
  isFirebaseConnected = false;
  admin = null;
  db = null;
  storage = null;
}

async function isAdmin(uid) {
  if (!uid) return false;
  if (isFirebaseConnected && db) {
    try {
      const snap = await db.collection('config').doc('admin').get();
      if (snap.exists) {
        const data = snap.data() || {};
        const list = Array.isArray(data.adminUids) ? data.adminUids : [];
        return list.includes(uid);
      }
    } catch (_) { /* silent — fallback local */ }
  }
  const envUids = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const localUids = (getFallbackDb().adminUids || []);
  const all = new Set([...envUids, ...localUids]);
  return all.has(uid);
}

module.exports = {
  admin,
  db,
  storage,
  isFirebaseConnected,
  isAdmin,
  getClientConfig,
  getFallbackDb
};

import 'dotenv/config';  // adicionado automaticamente TiAgente Security RC25
const express = require('express');
const path = require('path');
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;  // TIAGENTE_SECURITY_FIXED: SEC-HC-GOOGLEKEY · valor movido para .env (chave GOOGLE_API_KEY).
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;  // TIAGENTE_SECURITY_FIXED: SEC-HC-ANYKEY · valor movido para .env (chave OPENROUTER_API_KEY).
const app = express();

app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: ['index.html'] }));

app.get('/', (req, res) => {
  res.send('hello mundo');
});

app.listen(4100, () => {
  console.log('server on :4100');
});




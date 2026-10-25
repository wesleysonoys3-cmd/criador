import 'dotenv/config';  // adicionado automaticamente TiAgente Security RC25
const path = require('path');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 4444;

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;  // TIAGENTE_SECURITY_FIXED: SEC-HC-GOOGLEKEY · valor movido para .env (chave GOOGLE_API_KEY).
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;  // TIAGENTE_SECURITY_FIXED: SEC-HC-ANYKEY · valor movido para .env (chave OPENROUTER_API_KEY).

const config = {
  debug: true,
// TIAGENTE_SECURITY_FIXED: SEC-HC-GOOGLEKEY · RISCO removido (linha comentada) · original:   GOOGLE_MAPS_KEY: "AQ.AbMapsKeyDemo_987654321qwertyuiop",
};

app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: ['index.html'] }));

app.get('/', (req, res) => {
  res.json({ ok: true, mapsKey: config.GOOGLE_MAPS_KEY });
});

app.listen(PORT, () => console.log(`Server on ${PORT}`));





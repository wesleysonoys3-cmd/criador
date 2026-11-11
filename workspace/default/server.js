const express = require('express');
const cors = require('cors');
const path = require('path');
const { execSync } = require('child_process');
const { db, run, get, all } = require('./database');

const app = express();
app.use(express.json());
app.use(cors());

// Servir arquivos estáticos do diretório raiz
app.use(express.static(__dirname));

// Rota de status da API
app.get('/api/status', (req, res) => {
    res.json({ status: 'online', app: 'TigerBet Brasil API', winRate: 0.05 });
});

// Endpoint de Temperatura da CPU e dados térmicos do macOS
app.get('/api/cpu-temp', (req, res) => {
    let cpuThermalLevel = 60;
    let gpuThermalLevel = 10;
    let estimatedTemp = 48.5;

    try {
        const sysctlOut = execSync('sysctl machdep.xcpm.cpu_thermal_level machdep.xcpm.gpu_thermal_level 2>/dev/null').toString();
        const cpuMatch = sysctlOut.match(/machdep\.xcpm\.cpu_thermal_level:\s*(\d+)/);
        const gpuMatch = sysctlOut.match(/machdep\.xcpm\.gpu_thermal_level:\s*(\d+)/);
        if (cpuMatch) cpuThermalLevel = parseInt(cpuMatch[1], 10);
        if (gpuMatch) gpuThermalLevel = parseInt(gpuMatch[1], 10);
        
        // Mapear o nível de carga térmica do XCPM em estimativa em °C (ex: nível 60 = ~48-52°C)
        estimatedTemp = 35 + (cpuThermalLevel * 0.25) + (Math.random() * 2 - 1);
    } catch (e) {}

    res.json({
        success: true,
        tempCelsius: parseFloat(estimatedTemp.toFixed(1)),
        cpuThermalLevel,
        gpuThermalLevel,
        hardware: "MacBook Pro (15-inch) Intel Core i9",
        timestamp: new Date().toISOString()
    });
});

// Endpoint de Histórico de Jogos
app.get('/api/history', (req, res) => {
    try {
        const history = all("SELECT * FROM candidaturas ORDER BY id DESC LIMIT 50");
        res.json({ success: true, history });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/history', (req, res) => {
    try {
        const { game, bet, profit, isWin } = req.body;
        if (!game || bet === undefined || profit === undefined || isWin === undefined) {
            return res.status(400).json({ success: false, error: 'Campos obrigatórios faltando.' });
        }
        const stmt = db.prepare("INSERT INTO candidaturas (vaga_id, candidato_nome, candidato_email, curriculo_path, status) VALUES (?, ?, ?, ?, ?)");
        const info = stmt.run(1, game, `bet:${bet}`, `profit:${profit}`, isWin ? 'vitoria' : 'derrota');
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
    });
}

module.exports = app;

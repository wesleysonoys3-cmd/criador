const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { db } = require('./firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'users.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Garantir diretório de dados local (fallback)
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
}

// Rotas API REST integradas com Firestore (se disponível) ou LocalJSON
app.get('/api/profiles', async (req, res) => {
    try {
        if (db) {
            const snapshot = await db.collection('profiles').get();
            const profiles = [];
            snapshot.forEach(doc => profiles.push({ id: doc.id, ...doc.data() }));
            return res.json(profiles);
        }
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao ler perfis', details: err.message });
    }
});

app.post('/api/profiles', async (req, res) => {
    try {
        const { id, name, age, gender, photo, bio } = req.body;
        if (!name || !age || !photo) {
            return res.status(400).json({ error: 'Nome, idade e foto são obrigatórios.' });
        }

        const profileId = id || ('user_' + Date.now());
        const newProfile = {
            id: profileId,
            name,
            age: parseInt(age),
            gender: gender || 'Outro',
            photo,
            bio: bio || ''
        };

        if (db) {
            await db.collection('profiles').doc(profileId).set(newProfile);
            return res.status(201).json(newProfile);
        }

        const profiles = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const index = profiles.findIndex(p => p.id === profileId);
        if (index !== -1) {
            profiles[index] = newProfile;
        } else {
            profiles.push(newProfile);
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(profiles, null, 2));
        res.status(201).json(newProfile);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao criar perfil', details: err.message });
    }
});

app.put('/api/profiles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, age, gender, photo, bio } = req.body;

        if (db) {
            const docRef = db.collection('profiles').doc(id);
            const doc = await docRef.get();
            if (!doc.exists) {
                return res.status(404).json({ error: 'Perfil não encontrado.' });
            }
            const updated = {
                name: name || doc.data().name,
                age: age ? parseInt(age) : doc.data().age,
                gender: gender || doc.data().gender,
                photo: photo || doc.data().photo,
                bio: bio !== undefined ? bio : doc.data().bio
            };
            await docRef.update(updated);
            return res.json({ id, ...updated });
        }

        const profiles = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const index = profiles.findIndex(p => p.id === id);
        if (index === -1) {
            return res.status(404).json({ error: 'Perfil não encontrado.' });
        }

        profiles[index] = {
            id,
            name: name || profiles[index].name,
            age: age ? parseInt(age) : profiles[index].age,
            gender: gender || profiles[index].gender,
            photo: photo || profiles[index].photo,
            bio: bio !== undefined ? bio : profiles[index].bio
        };

        fs.writeFileSync(DATA_FILE, JSON.stringify(profiles, null, 2));
        res.json(profiles[index]);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar perfil', details: err.message });
    }
});

app.delete('/api/profiles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (db) {
            await db.collection('profiles').doc(id).delete();
            return res.json({ message: 'Perfil deletado com sucesso.' });
        }

        let profiles = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const initialLength = profiles.length;
        profiles = profiles.filter(p => p.id !== id);

        if (profiles.length === initialLength) {
            return res.status(404).json({ error: 'Perfil não encontrado.' });
        }

        fs.writeFileSync(DATA_FILE, JSON.stringify(profiles, null, 2));
        res.json({ message: 'Perfil deletado com sucesso.' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao deletar perfil', details: err.message });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Servidor AmorMatch + Firebase rodando na porta ${PORT}`);
    });
}

module.exports = app;

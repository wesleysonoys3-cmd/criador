const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const app = require('./server');

const PORT = 3005;
let server;

test('API REST Endpoints Test', async () => {
    await new Promise(resolve => {
        server = app.listen(PORT, resolve);
    });

    try {
        // Test GET
        await new Promise((resolve, reject) => {
            http.get(`http://localhost:${PORT}/api/profiles`, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    assert.strictEqual(res.statusCode, 200);
                    const profiles = JSON.parse(data);
                    assert(Array.isArray(profiles));
                    resolve();
                });
            }).on('error', reject);
        });

        // Test POST
        const newProfile = JSON.stringify({
            name: 'Teste Silva',
            age: 26,
            gender: 'Feminino',
            photo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
            bio: 'Perfil de teste'
        });

        await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost',
                port: PORT,
                path: '/api/profiles',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(newProfile)
                }
            }, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    assert.strictEqual(res.statusCode, 201);
                    const created = JSON.parse(data);
                    assert.strictEqual(created.name, 'Teste Silva');
                    resolve();
                });
            });
            req.on('error', reject);
            req.write(newProfile);
            req.end();
        });

    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});

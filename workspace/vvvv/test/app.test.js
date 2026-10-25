const request = require('supertest');
const app = require('../server');

describe('YouTube Clone - Testes Automatizados', () => {
  test('GET / deve retornar a página HTML do YouTube com status 200', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.text).toContain('YouTube');
    expect(response.text).toContain('Pesquisar');
  });

  test('GET /api/test deve retornar sucesso e mensagem em JSON', async () => {
    const response = await request(app).get('/api/test');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('API do YouTube');
  });
});

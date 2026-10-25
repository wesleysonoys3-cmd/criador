const request = require('supertest');
const app = require('../server');

describe('API de Inventário e Autenticação por Telefone', () => {
  const uniquePhone = '119' + Math.floor(10000000 + Math.random() * 90000000);
  const testName = 'Teste Usuário';

  test('POST /api/auth/register - Deve cadastrar um novo usuário com telefone', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ nome: testName, telefone: uniquePhone });
    
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.nome).toEqual(testName);
    expect(res.body.telefone).toEqual(uniquePhone);
  });

  test('POST /api/auth/register - Deve falhar ao cadastrar telefone duplicado', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Outro Nome', telefone: uniquePhone });
    
    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /api/auth/login - Deve realizar login com telefone cadastrado', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ telefone: uniquePhone });
    
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.telefone).toEqual(uniquePhone);
  });

  test('POST /api/auth/login - Deve retornar 404 para telefone não cadastrado', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ telefone: '11000000000' });
    
    expect(res.statusCode).toEqual(404);
    expect(res.body).toHaveProperty('error');
  });

  let createdItemId;

  test('GET /api/itens - Deve retornar lista de itens (array)', async () => {
    const res = await request(app).get('/api/itens');
    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /api/itens - Deve cadastrar um novo item com sucesso', async () => {
    const res = await request(app)
      .post('/api/itens')
      .send({
        nome: 'Geladeira Inox',
        categoria: 'Eletrodomésticos',
        comodo: 'Cozinha',
        quantidade: 1,
        valor: 3500.00,
        estado: 'Novo',
        observacoes: 'Frost Free 400L'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.nome).toEqual('Geladeira Inox');
    createdItemId = res.body.id;
  });

  test('GET /api/itens/:id - Deve buscar item pelo ID', async () => {
    const res = await request(app).get(`/api/itens/${createdItemId}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body.id).toEqual(createdItemId);
  });

  test('PUT /api/itens/:id - Deve atualizar o item com sucesso', async () => {
    const res = await request(app)
      .put(`/api/itens/${createdItemId}`)
      .send({
        nome: 'Geladeira Inox Duplex',
        categoria: 'Eletrodomésticos',
        comodo: 'Cozinha',
        quantidade: 1,
        valor: 3800.00,
        estado: 'Novo',
        observacoes: 'Atualizada'
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.nome).toEqual('Geladeira Inox Duplex');
    expect(res.body.valor).toEqual(3800.00);
  });

  test('DELETE /api/itens/:id - Deve excluir o item com sucesso', async () => {
    const res = await request(app).delete(`/api/itens/${createdItemId}`);
    expect(res.statusCode).toEqual(200);
  });
});

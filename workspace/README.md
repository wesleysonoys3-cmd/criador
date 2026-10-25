# API REST de Usuários com Node.js, Express e SQLite

API REST completa para gerenciamento de usuários (CRUD) utilizando Node.js, Express e banco de dados SQLite.

## Funcionalidades
- **Criar usuário** (`POST /users`): com criptografia de senha (`bcryptjs`) e validação de email único.
- **Listar usuários** (`GET /users`): retorna todos os usuários cadastrados (sem expor senhas).
- **Buscar usuário por ID** (`GET /users/:id`): retorna os dados de um usuário específico.
- **Atualizar usuário** (`PUT /users/:id`): atualiza nome, email ou senha.
- **Deletar usuário** (`DELETE /users/:id`): remove um usuário do banco de dados.
- **Tratamento de Erros**: Middleware centralizado para respostas padronizadas.

---

## Requisitos
- Node.js (versão 14 ou superior recomendada)

---

## Instalação

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Inicie o servidor:
   ```bash
   npm start
   ```
   O servidor rodará em `http://localhost:3000`.

---

## Testando com `curl`

### 1. Testar rota raiz
```bash
curl -i http://localhost:3000/
```

### 2. Criar um novo usuário (`POST /users`)
```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Ana Souza", "email": "ana@email.com", "senha": "123456"}'
```
*(Nota: O campo no JSON pode ser `"password"` ou `"senha"`, ajuste conforme preferir. Nosso código usa `password`: `{"name": "Ana Souza", "email": "ana@email.com", "password": "123456"}`)*

Exemplo corrigido:
```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Ana Souza", "email": "ana@email.com", "password": "123456"}'
```

### 3. Listar todos os usuários (`GET /users`)
```bash
curl -i http://localhost:3000/users
```

### 4. Buscar usuário por ID (`GET /users/1`)
```bash
curl -i http://localhost:3000/users/1
```

### 5. Atualizar usuário (`PUT /users/1`)
```bash
curl -X PUT http://localhost:3000/users/1 \
  -H "Content-Type: application/json" \
  -d '{"name": "Ana Souza Atualizada", "email": "ana.novo@email.com"}'
```

### 6. Deletar usuário (`DELETE /users/1`)
```bash
curl -X DELETE http://localhost:3000/users/1
```

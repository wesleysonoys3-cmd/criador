# API REST CRUD de Usuários

API desenvolvida em **Node.js**, **Express** e **SQLite** para gerenciamento completo de usuários.

## 🚀 Como Executar

1. Instalar as dependências:
   ```bash
   npm install
   ```

2. Iniciar o servidor:
   ```bash
   npm start
   ```

O servidor rodará por padrão na porta `3000`.

---

## 📡 Endpoints da API

| Método | Rota | Descrição | Corpo da Requisição (JSON) |
|---|---|---|---|
| `GET` | `/` | Informações e rotas disponíveis | - |
| `POST` | `/users` | Criar novo usuário | `{ "name": "...", "email": "...", "password": "..." }` |
| `GET` | `/users` | Listar todos os usuários | - |
| `GET` | `/users/:id` | Buscar usuário por ID | - |
| `PUT` | `/users/:id` | Atualizar usuário existente | `{ "name": "...", "email": "...", "password": "..." }` |
| `DELETE` | `/users/:id` | Remover usuário por ID | - |

---

## 🧪 Testando com `curl`

### 1. Criar um usuário
```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Ana Souza", "email": "ana@email.com", "password": "123"}'
```

### 2. Listar todos os usuários
```bash
curl http://localhost:3000/users
```

### 3. Buscar usuário por ID (ex: ID 1)
```bash
curl http://localhost:3000/users/1
```

### 4. Atualizar usuário (ex: ID 1)
```bash
curl -X PUT http://localhost:3000/users/1 \
  -H "Content-Type: application/json" \
  -d '{"name": "Ana Souza Silva", "email": "ana.silva@email.com", "password": "nova_senha"}'
```

### 5. Deletar usuário (ex: ID 1)
```bash
curl -X DELETE http://localhost:3000/users/1
```

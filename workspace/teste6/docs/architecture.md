# Arquitetura do Sistema de Currículos e Vagas

## 1. Visão Geral
Sistema web para publicação de vagas por empresas e envio de currículos em formato PDF por candidatos.
- **Candidatos**: Acesso livre às vagas sem obrigatoriedade de cadastro prévio.
- **Empresas**: Cadastro e autenticação (Login/Senha) para gerenciar vagas e visualizar candidatos inscritos.
- **Administrador**: Controle geral do sistema, usuários e vagas.

## 2. Pilha Tecnológica (Tech Stack)
- **Backend**: Node.js com Express.js
- **Banco de Dados**: SQLite via `better-sqlite3` (leve, embutido, transacional)
- **Autenticação**: Sessões Express com cookies seguros ou JWT (usaremos tokens simples ou sessão com bcrypt)
- **Upload de Arquivos**: `multer` para armazenamento seguro de arquivos PDF na pasta `uploads/`
- **Frontend**: HTML5, Tailwind CSS via CDN e Vanilla JavaScript (Single Page / Multi-page intuitivo)

## 3. Estrutura de Pastas e Arquivos
```
/
├── server.js              # Ponto de entrada da aplicação Express
├── package.json           # Dependências e scripts
├── database.js            # Inicialização do SQLite e tabelas
├── public/                # Arquivos estáticos do frontend
│   ├── index.html         # Lista pública de vagas para candidatos
│   ├── vaga.html          # Detalhes da vaga + formulário de envio de currículo PDF
│   ├── login.html         # Login/Registro para empresas
│   ├── dashboard.html     # Painel da empresa (criar vaga, ver candidatos)
│   └── admin.html         # Painel administrativo
├── uploads/               # Pasta de armazenamento dos PDFs de currículos
└── docs/
    └── architecture.md    # Este documento
```

## 4. Modelo de Dados (SQLite)
- **Tabela `empresas`**:
  - `id` (INTEGER PRIMARY KEY)
  - `nome` (TEXT)
  - `email` (TEXT UNIQUE)
  - `senha` (TEXT hash bcrypt)
  - `criado_em` (DATETIME)

- **Tabela `vagas`**:
  - `id` (INTEGER PRIMARY KEY)
  - `empresa_id` (INTEGER FOREIGN KEY)
  - `titulo` (TEXT)
  - `descricao` (TEXT)
  - `requisitos` (TEXT)
  - `local` (TEXT)
  - `status` (TEXT: 'ativa', 'encerrada')
  - `criado_em` (DATETIME)

- **Tabela `candidaturas`**:
  - `id` (INTEGER PRIMARY KEY)
  - `vaga_id` (INTEGER FOREIGN KEY)
  - `nome_candidato` (TEXT)
  - `email_candidato` (TEXT)
  - `telefone` (TEXT)
  - `arquivo_pdf` (TEXT)
  - `enviado_em` (DATETIME)

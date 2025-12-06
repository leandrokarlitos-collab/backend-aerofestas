# Sistema Operante - Aero Festas

Sistema completo de gestão com autenticação e controle de acesso.

## 🚀 Instalação

### 1. Instalar Dependências

```bash
npm install
```

### 2. Configurar Variáveis de Ambiente

Copie o arquivo `.env.example` para `.env` e configure as variáveis:

```bash
cp .env.example .env
```

Edite o arquivo `.env` e configure:

- `PORT`: Porta do servidor (padrão: 3000)
- `JWT_SECRET`: Chave secreta para assinar tokens JWT (gere uma string aleatória segura)
- `FIREBASE_EMAIL_FUNCTION_URL`: URL da Cloud Function do Firebase para envio de emails
- `BASE_URL`: URL base da aplicação (ex: http://localhost:3000)

### 3. Configurar Firebase Cloud Functions para Envio de Emails

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/)
2. Configure Firebase Cloud Functions no seu projeto
3. Crie uma Cloud Function que receba requisições POST com o seguinte formato:
   ```json
   {
     "email": "usuario@example.com",
     "token": "token-de-confirmacao",
     "name": "Nome do Usuário",
     "confirmationUrl": "https://...",
     "subject": "Confirme seu cadastro - Aero Festas",
     "html": "<html>...</html>",
     "text": "texto plano..."
   }
   ```
4. A função deve enviar o email usando o serviço de email do Firebase (ex: Firebase Extensions para Email ou integração com SendGrid/outro serviço)
5. Copie a URL da Cloud Function e cole no arquivo `.env` como `FIREBASE_EMAIL_FUNCTION_URL`

**Nota**: Se não configurar a URL da Cloud Function, o sistema funcionará em modo simulação, exibindo os links de confirmação no console.

### 4. Criar Primeiro Usuário Administrador

Use o script fornecido para criar o primeiro usuário administrador:

```bash
npm run create-admin "Nome do Admin" "admin@aerofestas.com" "senha123"
```

**Alternativa**: Se preferir criar manualmente, após iniciar o servidor pela primeira vez, edite `data/users.json` e adicione um usuário admin (veja o README completo para mais detalhes)

## 📋 Como Usar

### Iniciar o Servidor

```bash
npm start
```

Para desenvolvimento com auto-reload:

```bash
npm run dev
```

### Acessar o Sistema

1. Abra o navegador em `http://localhost:3000`
2. Você será redirecionado para a página de login
3. Se for primeiro acesso, clique em "Primeiro acesso? Cadastre-se aqui"
4. Preencha o formulário de cadastro
5. Verifique seu email e clique no link de confirmação
6. Faça login com suas credenciais

### Painel Administrativo

Usuários administradores podem:

- Acessar `/admin.html` para gerenciar usuários
- Adicionar novos usuários
- Remover usuários
- Criar usuários sem confirmação de email
- Definir usuários como administradores

## 🔒 Funcionalidades de Segurança

- ✅ Senhas criptografadas com bcrypt
- ✅ Tokens JWT para autenticação
- ✅ Confirmação de email obrigatória
- ✅ Tokens de confirmação expiram em 24 horas
- ✅ Proteção de rotas administrativas
- ✅ Validação de dados de entrada

## 📁 Estrutura do Projeto

```
.
├── server.js                 # Servidor Express principal
├── routes/
│   ├── auth.js              # Rotas de autenticação
│   └── admin.js             # Rotas administrativas
├── middleware/
│   └── auth.js              # Middleware de autenticação
├── utils/
│   ├── crypto.js            # Funções de criptografia
│   └── email.js             # Integração com Firebase Cloud Functions
├── data/
│   ├── users.json           # Armazenamento de usuários
│   └── tokens.json          # Tokens de confirmação
├── js/
│   ├── auth.js              # Funções JavaScript de autenticação
│   └── protect.js           # Script de proteção de páginas
├── login.html               # Página de login
├── register.html            # Página de cadastro
├── confirm-email.html       # Página de confirmação
├── admin.html               # Painel administrativo
└── [outras páginas HTML]    # Páginas protegidas do sistema
```

## 🔧 API Endpoints

### Autenticação

- `POST /api/auth/register` - Registrar novo usuário
- `POST /api/auth/login` - Fazer login
- `POST /api/auth/confirm-email` - Confirmar email
- `GET /api/auth/me` - Obter informações do usuário autenticado

### Administração (requer autenticação admin)

- `GET /api/admin/users` - Listar todos os usuários
- `POST /api/admin/users` - Adicionar novo usuário
- `DELETE /api/admin/users/:id` - Remover usuário
- `PUT /api/admin/users/:id` - Atualizar usuário

## ⚠️ Notas Importantes

1. **Produção**: Em produção, use um banco de dados real (PostgreSQL, MongoDB, etc.) ao invés de arquivos JSON
2. **JWT_SECRET**: Use uma chave secreta forte e única em produção
3. **HTTPS**: Use HTTPS em produção para proteger tokens e senhas
4. **Rate Limiting**: Considere adicionar rate limiting para prevenir ataques de força bruta
5. **Backup**: Faça backup regular dos arquivos em `data/`

## 🐛 Solução de Problemas

### Email não está sendo enviado

- Verifique se a URL da Cloud Function do Firebase está configurada corretamente no `.env`
- Verifique se a Cloud Function está implantada e funcionando
- Verifique os logs do servidor e da Cloud Function para mensagens de erro
- Em desenvolvimento, o sistema exibirá o link no console se a URL não estiver configurada
- Verifique se a Cloud Function está acessível publicamente (sem autenticação) ou configure autenticação adequada

### Não consigo fazer login

- Verifique se o email foi confirmado
- Verifique se a senha está correta
- Verifique se o servidor está rodando
- Limpe o localStorage do navegador e tente novamente

### Erro ao acessar páginas protegidas

- Verifique se está logado
- Verifique se o token não expirou (tokens expiram em 7 dias)
- Verifique os logs do servidor para erros

## 📝 Licença

Este projeto é de uso interno da Aero Festas.


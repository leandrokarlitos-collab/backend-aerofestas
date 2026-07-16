# 🎉 Sistema Operante — Aero Festas

[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-black.svg)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5.10-informational.svg)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue.svg)](https://www.postgresql.org/)
[![PWA](https://img.shields.io/badge/PWA-instalável-purple.svg)](#-pwa--atualização-forçada)
[![IA](https://img.shields.io/badge/IA-Claude%20Haiku%204.5-orange.svg)](#-inteligência-artificial)

Plataforma de gestão empresarial para **locadoras de brinquedos infláveis e equipamentos para festas** (Aero Festas / ABC Festas). Cobre a operação de ponta a ponta: agenda de eventos, propostas comerciais públicas, estoque, CRM, financeiro, RH, escala de monitores com app próprio, notificações, auditoria e backup automático.

> ℹ️ **Estado do sistema:** em produção, versão **1.0.2** (service worker `v3.15.0`). Backend API-only. Frontend PWA servido pelo Firebase Hosting.

---

## 📋 Índice

- [Visão Geral](#-visão-geral)
- [Arquitetura](#-arquitetura)
- [Módulos e Funcionalidades](#-módulos-e-funcionalidades)
- [Stack Tecnológica](#-stack-tecnológica)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Variáveis de Ambiente](#-variáveis-de-ambiente)
- [Instalação e Execução](#-instalação-e-execução)
- [Deploy](#-deploy)
- [Referência da API](#-referência-da-api)
- [Modelo de Dados](#-modelo-de-dados)
- [Scripts Utilitários](#-scripts-utilitários)
- [Segurança](#-segurança)
- [Roadmap](#-roadmap)
- [Licença e Autor](#-licença-e-autor)

---

## 🎯 Visão Geral

O **Sistema Operante** é um ERP vertical, feito sob medida para a rotina de uma locadora de infláveis/eventos. Diferente de um sistema de locação genérico, ele modela o vocabulário e os fluxos reais do negócio: **eventos** com múltiplos brinquedos, **monitores/motoristas** com escala e diária, **propostas** enviadas por link para o cliente, **fechamento financeiro por evento** com rateio de custos, e integração com **WhatsApp** e **IA**.

Principais capacidades:

- 📅 **Agenda de eventos** multi-dia com detecção de conflito e link público de confirmação/assinatura
- 📄 **Propostas comerciais** com página pública (`/p/<slug>`), templates e analytics de visualização
- 🎪 **Estoque** com unidades individuais, manutenção e galeria de fotos
- 👥 **CRM** com funil de estágios, notas e follow-ups
- 💰 **Financeiro** completo: transações, contas bancárias, contas fixas, categorias, custos por evento e venda por ficha/ingresso
- 🧑‍🤝‍🧑 **Monitores e escala** com **app próprio (PWA)**, login, aprovação e disponibilidade em tempo real (estilo Uber)
- 🤖 **IA** (Claude Haiku 4.5) para análise de cliente e geração de conteúdo
- 🔔 **Notificações push** (Web Push/VAPID) para vencimentos e escala
- 🧾 **Auditoria** de todas as ações e **backup automático diário** com disaster recovery

---

## 🏗️ Arquitetura

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Frontend (Firebase Hosting)│        │   Backend API (Railway)       │
│  PWA — HTML/CSS/JS vanilla   │  HTTPS │   Node 20 + Express 4         │
│  • Painel administrativo     │ ─────► │   • Somente /api (sem static) │
│  • App do Monitor (/app)     │        │   • JWT + bcrypt + Helmet     │
│  • Propostas públicas (/p/*) │        │   • Rate limit no /auth       │
│  Service Worker + cache      │        │   • node-cron (backup/alertas)│
└─────────────────────────────┘        └───────────────┬──────────────┘
                                                        │ Prisma 5
                                       ┌────────────────▼──────────────┐
                                       │   PostgreSQL (Railway)         │
                                       └────────────────────────────────┘
        Serviços externos: Firebase Storage (contratos/backup/uploads),
        Anthropic Claude (IA), Gmail/Nodemailer (e-mail), Web Push (VAPID)
```

- **Backend** expõe **apenas** rotas `/api` — o frontend estático é servido pelo **Firebase Hosting** (projeto `agenda-aero-festas`), não pelo Express. Isso foi endurecido por segurança para não expor arquivos/segredos do repositório.
- **Frontend**: HTML/CSS/JavaScript vanilla (sem framework), com **Chart.js**, **jsPDF** e **Font Awesome** via CDN. É um **PWA** instalável com service worker e atualização forçada sincronizada com a versão.
- **App do Monitor**: PWA separada (`app-monitor/`) com autenticação própria, escala "meus eventos" e toggle de disponibilidade.
- **Propostas públicas**: cada proposta tem página em `/p/<slug>` (rewrites no Firebase), com rastreamento anônimo de visualização.

---

## 🧩 Módulos e Funcionalidades

### 📅 Agenda e Eventos
- Eventos de dia único ou **multi-dia** com `endDate`, dias excluídos e horários custom por dia
- Vínculo com **empresa** (Aero/ABC), cliente **PF ou PJ**, endereço com **pin de geolocalização** (lat/lng)
- **Detecção de conflito** de agendamento e checagem de disponibilidade de estoque
- **Link público de confirmação** (`/e/**`): o cliente revisa, informa dados e **assina** (carimbo de tempo, IP e user-agent registrados)
- **Sinal/entrada via PIX** exibido ao cliente; upload de **contrato** (PDF/imagem) para o Firebase Storage
- Locações de **equipamentos de terceiros** (custo repassado) e **venda por ficha/ingresso** (líquido + % repasse à escola)
- Registro de **fotos por evento** na conclusão; tipo `event` ou `meeting` (reunião)

### 📄 Propostas Comerciais
- CRUD de propostas com **itens**, desconto, subtotal/total e toggle de exibição de preços
- **Templates** reutilizáveis (hero, cards "por quê", FAQ, "como funciona", número/mensagem de WhatsApp com variáveis `{{clientName}}` etc.)
- Página **pública** por slug com snapshot anti-deleção (nome/foto do brinquedo preservados)
- **Analytics** (`PropostaTrack`): abertura, profundidade de rolagem, cliques, tempo na página, cidade/país — visíveis no painel *Proposta-Analytics*

### 🎪 Estoque de Brinquedos
- Catálogo com foto, quantidade e **preço sugerido** para propostas
- **Unidades individuais** (`ToyUnit`) com condição e histórico
- **Manutenções** por brinquedo/unidade (data, descrição, custo, responsável)
- **Galeria de fotos** com foto principal e ordenação

### 👥 CRM
- Base de clientes com **funil de estágios** (`novo → contato → proposta → negociação → fechado → pós-venda / perdido`)
- **Notas** e **follow-ups** com data de vencimento e pendências
- Origem, tags, redes sociais e último contato; importação do localStorage legado

### 💰 Financeiro
- **Dashboard** com KPIs e gráficos (Chart.js)
- **Transações** (receita/despesa) com categoria, forma de pagamento, conta bancária e vínculo a evento
- **Contas bancárias**, **contas fixas** (permanentes ou parceladas) e **categorias** personalizáveis
- **Custos por evento** (`/event-costs/:eventId`) e **rateio** para fechamento financeiro
- Detalhamento de gasto (combustível, alimentação) e contas "não declaradas"

### 🧑‍🤝‍🧑 Monitores, Escala e App do Monitor
- **Cadastro rico** do monitor (dados pessoais, saúde/segurança, habilidades, CNH, contato de emergência, redes)
- **Pagamentos**: diária base, **horas extras** (jornada configurável, padrão 11h), **adicional de motorista** (R$ 20 por evento), indicações e pagamentos "diversos"
- **Avaliação de desempenho** e status (`ativo/reserva/alerta/desqualificado`) com ocorrências
- **Escala estruturada** (`EventAssignment`) por evento e papel (monitor/motorista), com **horário individual de galpão** — em tabela própria, imune a saves parciais do evento
- **App do Monitor (PWA)**: login por CPF+senha, **aprovação pelo gestor**, "meus eventos" e **disponibilidade em tempo real** (estilo Uber)

### 🧾 RH
- **Funcionários** (salário fixo, VA, VT) e **faixas de comissão** por faturamento

### 🤖 Inteligência Artificial
- Integração com **Anthropic Claude (`claude-haiku-4-5`)** via `@anthropic-ai/sdk`
- **Análise de cliente** e geração de conteúdo (ex.: posts de Instagram)
- Requer `ANTHROPIC_API_KEY`; degrada com mensagem clara se ausente

### 🔔 Notificações Push
- **Web Push (VAPID)** para dispositivos logados, com push direcionado (app do monitor)
- Job a cada 12h avisa **contas fixas vencendo** hoje/amanhã; limpeza automática de inscrições expiradas

### 🧾 Auditoria
- `AuditLog` registra CREATE/UPDATE/DELETE com autor, diff de campos e snapshot da entidade

### 💾 Backup e Disaster Recovery
- **Backup diário automático** (cron 03:00) + backup no startup, persistido no **Firebase Storage** com checksum SHA-256 e verificação de integridade
- **Watchdog** diário (12:00 UTC): alerta admins por e-mail/push se o último backup tiver +26h
- **Restore drills** e relatório de restauração (ver `docs/RESTORE-DRILL.md`)

### 💬 WhatsApp — ⚠️ *desativado no momento*
- O schema e as rotas (`routes/whatsapp.js`) de integração via **Evolution API** existem (instâncias, conversas, mensagens, atalhos, status, catálogo, grupos), **mas o módulo está desconectado no `server.js`** ("será desenvolvido em sistema paralelo"). Requer `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` quando reativado.

### 📱 PWA e Atualização Forçada
- Manifesto + service worker (`sw.js`, cache `aero-festas-v3.15.0`) com cache offline e atalhos
- Sistema de **atualização automática** sincronizado com a versão do sistema

---

## 🛠️ Stack Tecnológica

### Backend
- **Node.js 20.x** + **Express 4**
- **Prisma ORM 5.10** + **PostgreSQL 15+**
- **jsonwebtoken** + **bcryptjs** (auth), **Helmet**, **express-rate-limit**, **CORS** restrito
- **node-cron** (backup/alertas), **web-push** (VAPID), **firebase-admin** (Storage/serviços)
- **nodemailer** (Gmail) para e-mail, **multer** (uploads)
- **@anthropic-ai/sdk** (IA)

### Frontend
- **HTML5 + CSS3 + JavaScript ES6+** (vanilla, sem framework)
- **Chart.js** (gráficos), **jsPDF** + AutoTable (PDFs), **Font Awesome**
- **PWA** (manifest + service worker)

### Infraestrutura
- **Railway** — backend + PostgreSQL
- **Firebase Hosting** — frontend/PWA e páginas públicas de proposta
- **Firebase Storage** — contratos, uploads e backups

---

## 📁 Estrutura do Projeto

```
backend-aerofestas/
├── server.js                 # Entry point: middlewares, rotas, cron, push
├── prisma/
│   ├── schema.prisma         # ~35 modelos (estoque, eventos, propostas, financeiro, RH, WhatsApp…)
│   └── client.js             # Prisma client compartilhado
├── routes/                   # 19 routers Express
│   ├── auth.js  monitorAuth.js  monitor.js
│   ├── admin.js  events.js  propostas.js  proposta-templates.js
│   ├── toys.js  clients.js  companies.js
│   ├── finance.js  profile.js  history.js  tasks.js  dailyPlans.js
│   ├── ai.js  audit.js  backup.js
│   └── whatsapp.js           # (desativado no server.js)
├── services/                 # Regras de negócio (Event, Client, Toy, Proposta, AI, Backup, Alert, Firebase…)
├── middleware/               # auth.js (authenticate/isAdmin), errorHandler.js
├── config/                   # webpush.js (VAPID)
├── utils/                    # crypto.js, email.js
├── scripts/                  # create-admin, restore, seeds, sanity-checks, update-version
├── app-monitor/              # PWA do monitor (login.html, home.html)
├── propostas/                # Páginas públicas de proposta por cliente + view.html
├── *.html                    # Painel: Dashboard, Agenda, Financeiro, CRM, Equipamentos, Equipe…
├── sw.js  manifest.json      # PWA
├── firebase.json  .firebaserc# Hosting + rewrites (/e/**, /p/<slug>)
└── docs/                     # Notas técnicas, planos e relatórios de bugs
```

---

## 🔐 Variáveis de Ambiente

O servidor **aborta na inicialização** se `JWT_SECRET` não estiver definido.

| Variável | Obrigatória | Descrição |
|----------|:-----------:|-----------|
| `DATABASE_URL` | ✅ | String de conexão PostgreSQL |
| `JWT_SECRET` | ✅ | Chave de assinatura dos tokens JWT |
| `PORT` | — | Porta do servidor (padrão `3000`) |
| `NODE_ENV` | — | `development` / `production` |
| `ANTHROPIC_API_KEY` | IA | Chave da API Claude (módulo de IA) |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | E-mail | Conta Gmail p/ envio via Nodemailer |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Storage | Credencial de service account (JSON) |
| `FIREBASE_STORAGE_BUCKET` | Storage | Bucket p/ contratos, uploads e backups |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push | Chaves Web Push (VAPID) |
| `BACKUP_ENCRYPTION_KEY` | Backup | Chave de criptografia do backup |
| `BASE_URL` / `PUBLIC_BASE_URL` / `BACKEND_URL` | — | URLs base p/ links gerados |
| `FIREBASE_EMAIL_FUNCTION_URL` | — | Endpoint de function p/ e-mail (opcional) |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` | WhatsApp | Evolution API (módulo desativado) |

> O arquivo `.env.example` está desatualizado (menciona SendGrid). Use a tabela acima como referência.

---

## 🚀 Instalação e Execução

```bash
# 1. Clonar e instalar
git clone <repo>
cd backend-aerofestas
npm install

# 2. Configurar .env (ver tabela acima) — no mínimo DATABASE_URL e JWT_SECRET

# 3. Preparar o banco
npx prisma generate
npx prisma db push          # ou: npx prisma migrate deploy

# 4. Criar um usuário administrador
npm run create-admin

# 5. Rodar
npm run dev                 # desenvolvimento (nodemon)
npm start                   # produção
```

Servidor em `http://localhost:3000` (apenas `/api`; o frontend roda via Firebase Hosting ou `npx serve` na raiz).

> ⚠️ **Cadastro público desativado.** `POST /api/auth/register` retorna `403` — novas contas são criadas pelo administrador (`npm run create-admin`).

---

## ☁️ Deploy

- **Backend + PostgreSQL → Railway.** `npm run build` roda `prisma generate` + `migrate deploy`. Configure as variáveis de ambiente no painel do Railway.
- **Frontend/PWA → Firebase Hosting** (projeto `agenda-aero-festas`): `firebase deploy --only hosting`. Os rewrites servem `/e/**` (link de evento) e `/p/<slug>` (propostas).

---

## 🔌 Referência da API

Todas as rotas usam prefixo `/api`. Salvo indicação, exigem **JWT** (header `Authorization`). Rotas `/api/public/*` e a view de proposta são abertas.

### Autenticação — `/api/auth` *(rate-limited)*
```
POST /register        # 403 — cadastro desativado
POST /login
POST /forgot-password
POST /reset-password
POST /confirm-email
GET  /me
```

### App do Monitor — `/api/monitor`
```
POST /auth/login              # login por CPF+senha (rate-limited)
GET  /auth/me
GET  /events                  # "meus eventos" (escala do monitor)
PATCH /disponibilidade        # toggle disponível agora
```

### Eventos — `/api/admin` e `/api/public`
```
GET    /admin/events-full
POST   /admin/events
GET    /admin/events/:id
PUT    /admin/events/:id
DELETE /admin/events/:id
PUT    /admin/events/:id/assignments      # escala estruturada
POST   /admin/events/:id/contract         # upload de contrato
DELETE /admin/events/:id/contract
GET    /public/events/:id                 # link público do cliente
PUT    /public/events/:id                 # cliente preenche/assina
PATCH  /public/events/:id/draft
GET    /public/toys, /public/availability
```

### Propostas — `/api/admin` e `/api/public`
```
GET/POST/PUT/DELETE /admin/propostas[/:id]
POST   /admin/propostas/:id/duplicate
GET    /admin/propostas/:slug/analytics
GET    /public/propostas/:slug            # view pública
POST   /public/track                      # telemetria anônima
GET/POST/PUT/DELETE /admin/proposta-templates[/:id]
POST   /admin/proposta-templates/:id/set-default
```

### Estoque, CRM e Empresas — `/api/admin/*`
```
/admin/toys        # CRUD + /:toyId/units, /photos, /maintenances
/admin/clients     # CRUD + /notes, /follow-ups (+ /follow-ups/pending)
/admin/companies   # CRUD
/admin/users       # gestão de usuários (admin)
/admin/ai          # POST /analyze-client, /instagram-posts
```

### Financeiro — `/api/finance`
```
GET  /dashboard
GET/POST/PUT/DELETE /transactions
GET/POST/PUT /accounts, /fixed-expenses
GET/POST/PUT /categories/{expenses,fixed}
GET/POST/PUT/PATCH/DELETE /monitores        # + /acesso, /status, /reset-senha, /confirmar-cpf
GET  /event-costs/:eventId
GET/POST/PUT/DELETE /pagamentos-monitores    # + /transferir
GET/POST/PUT/DELETE /funcionarios, /faixas-comissao
POST /desempenho
```

### Plataforma — auditoria, backup, tarefas, perfil
```
GET  /audit/recent, /audit/entity/:type/:id
GET  /backup/status, /history, /files, /download, /diag   POST /backup/run
GET/POST/PUT/DELETE /tasks
GET/POST /daily-plans[/:date]
GET/PUT  /profile   PUT /profile/password
POST /notifications/subscribe
POST /send-email
POST /migrar-completo    # migração de dados legados (admin)
```

---

## 🗄️ Modelo de Dados

~35 modelos Prisma, agrupados:

- **Estoque & Eventos:** `Toy`, `ToyUnit`, `ToyMaintenance`, `ToyPhoto`, `Event`, `EventItem`, `EventAssignment`, `EventExternalRental`, `Company`
- **Propostas:** `Proposta`, `PropostaItem`, `PropostaTemplate`, `PropostaTrack`
- **CRM:** `Client`, `ClientNote`, `ClientFollowUp`
- **Monitores & RH:** `Monitor`, `Desempenho`, `PagamentoMonitor`, `Funcionario`, `FaixaComissao`
- **Financeiro:** `Transaction`, `BankAccount`, `FixedExpense`, `ExpenseCategory`, `FixedExpenseCategory`
- **Usuários & Produtividade:** `User`, `Task`, `DailyPlan`, `PushSubscription`
- **Plataforma:** `AuditLog`, `BackupRun`
- **WhatsApp (desativado):** `WhatsAppInstance`, `WhatsAppConversation`, `WhatsAppMessage`, `WhatsAppShortcut`, `WhatsAppStatus`

O schema completo está em [`prisma/schema.prisma`](prisma/schema.prisma).

---

## 🧰 Scripts Utilitários

```bash
npm run create-admin        # cria usuário administrador
npm run build               # prisma generate + migrate deploy
npm run version             # atualiza version.json

node scripts/restore.js             # restauração de backup
node scripts/check-db-counts.js     # contagem de registros por tabela
node scripts/sanity-check-models.js # sanidade dos modelos
node scripts/seed-proposta-template.js
```

---

## 🔒 Segurança

- **Somente `/api`** exposto pelo backend — nada de arquivos estáticos/segredos servidos pelo Express
- **Helmet** (cabeçalhos), **CORS restrito** às origens do sistema, **rate limit** nas rotas de auth
- **JWT** com abort na ausência de `JWT_SECRET`; senhas com **bcrypt**
- **Cadastro público desativado**; autenticação separada para o app do monitor com **aprovação do gestor**
- **Auditoria** de ações sensíveis e **backup criptografado** com verificação de integridade
- Rotação de chaves **VAPID** tratada (limpeza de inscrições inválidas)

---

## 🗺️ Roadmap

- [x] PWA instalável + atualização forçada
- [x] Notificações push (vencimentos e escala)
- [x] Escala de monitores + app do monitor
- [x] Propostas públicas com analytics
- [x] Backup automático + disaster recovery
- [ ] Reativar módulo **WhatsApp** (Evolution API) em produção
- [ ] Assinatura digital avançada de contratos
- [ ] App mobile nativo dos monitores
- [ ] Relatórios financeiros personalizáveis / exportação avançada

---

## 📝 Licença e Autor

- **Licença:** `ISC` (declarada em `package.json`). Não há arquivo `LICENSE`; projeto de **uso interno** da Aero Festas / ABC Festas.
- **Autor:** Leandro Karlitos — [@leandrokarlitos-collab](https://github.com/leandrokarlitos-collab)

---

**Desenvolvido com ❤️ para a Aero Festas.**

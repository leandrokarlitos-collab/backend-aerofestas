# 🎉 Sistema Operante - Aero Festas

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue.svg)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.10-informational.svg)](https://www.prisma.io/)

Sistema completo de gestão empresarial para locadoras de brinquedos e equipamentos para festas, desenvolvido para Aero Festas e ABC Festas. Gerencia eventos, clientes, estoque, finanças, CRM e equipe de monitores com interface moderna e intuitiva.

---

## 📋 Índice

- [Visão Geral](#-visão-geral)
- [Funcionalidades](#-funcionalidades)
- [Stack Tecnológica](#-stack-tecnológica)
- [Pré-requisitos](#-pré-requisitos)
- [Instalação](#-instalação)
- [Configuração](#-configuração)
- [Uso](#-uso)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [API Endpoints](#-api-endpoints)
- [Fluxo de Trabalho](#-fluxo-de-trabalho)
- [Contribuindo](#-contribuindo)
- [Licença](#-licença)

---

## 🎯 Visão Geral

O **Sistema Operante - Aero Festas** é uma plataforma web full-stack desenvolvida para otimizar a operação completa de empresas de locação de brinquedos infláveis e equipamentos para eventos. O sistema oferece:

- 📅 **Gestão de Agenda**: Controle completo de eventos, disponibilidade e conflitos de horários
- 💰 **Sistema Financeiro**: Dashboard de receitas, despesas, fluxo de caixa e análises gráficas
- 👥 **CRM Integrado**: Gestão de clientes, histórico de eventos e comunicação
- 🎪 **Controle de Estoque**: Gerenciamento de brinquedos, status e manutenção
- 🚛 **Gestão de Monitores**: Pagamentos, avaliações, horas extras e adicional de motorista
- 📊 **Relatórios e Analytics**: Gráficos interativos e exportação de relatórios em PDF
- 🤖 **IA Integrada**: Assistente com Google Gemini para insights e automações

---

## ✨ Funcionalidades

### 🗓️ Agenda de Eventos
- ✅ Calendário visual com visualização diária, semanal e mensal
- ✅ Cadastro completo de eventos com múltiplos itens
- ✅ Sistema de cores por empresa (Aero/ABC)
- ✅ Detecção automática de conflitos de agendamento
- ✅ Geração de contratos e orçamentos em PDF
- ✅ Sincronização em tempo real com backend

### 💰 Sistema Financeiro
- ✅ Dashboard com 4 KPIs principais: Receitas, Despesas, Saldo e IA
- ✅ 6 Gráficos interativos (Chart.js):
  - Receita por Empresa
  - Distribuição de Despesas (inclui Monitores)
  - Contas Fixas
  - Pagamentos de Monitores
  - Fluxo de Caixa Diário
- ✅ Gestão de gastos com categorias personalizáveis
- ✅ Sistema de contas fixas (permanentes e parceladas)
- ✅ Comparação automática com mês anterior
- ✅ Exportação de relatórios financeiros em PDF

### 👥 Gestão de Monitores
- ✅ Cadastro completo com foto de perfil
- ✅ Sistema de pagamentos com:
  - Valor base da diária
  - Cálculo automático de horas extras (base 11h, R$/hora = diária/11)
  - **Adicional de motorista** (R$ 20,00 por evento entregue)
  - Aceita valores decimais para eventos parciais
- ✅ Avaliação por critérios:
  - Proatividade
  - Cordialidade
  - Pontualidade
  - Liderança
- ✅ Status de pagamento com toggle Pago/Pendente
- ✅ Subtotal mensal automático
- ✅ Histórico completo de pagamentos

### 🎪 Gestão de Brinquedos
- ✅ Catálogo completo com fotos
- ✅ Status de disponibilidade em tempo real
- ✅ Controle de manutenção e reservas
- ✅ Preços diferenciados por empresa

### 👤 CRM
- ✅ Base de clientes com histórico completo
- ✅ Registro de preferências e observações
- ✅ Histórico de eventos por cliente
- ✅ Busca e filtros avançados

### 🤖 Inteligência Artificial
- ✅ Integração com Google Gemini API
- ✅ Geração de insights financeiros
- ✅ Análise de padrões e tendências
- ✅ Sugestões de otimização

---

## 🛠️ Stack Tecnológica

### Frontend
- **HTML5** + **CSS3** (Vanilla, sem frameworks CSS)
- **JavaScript ES6+** (Vanilla, modular)
- **Chart.js 4.4.0** - Visualizações interativas
- **Font Awesome 6.5.1** - Ícones
- **jsPDF** + **jsPDF-AutoTable** - Geração de PDFs

### Backend
- **Node.js** 18+
- **Express.js** 4.x - Framework web
- **Prisma ORM** 5.10 - Mapeamento objeto-relacional
- **PostgreSQL** 15+ - Banco de dados
- **Railway** - Deploy e hosting

### APIs Externas
- **Google Gemini API** - IA para insights e automações
- **Railway PostgreSQL** - Banco de dados em nuvem

### DevOps
- **Git** - Controle de versão
- **Railway** - CI/CD e deploy automático
- **dotenv** - Gestão de variáveis de ambiente

---

## 📦 Pré-requisitos

- **Node.js** >= 18.0.0
- **PostgreSQL** >= 15.0
- **npm** ou **yarn**
- Conta no [Railway](https://railway.app/) (para deploy)
- Google Gemini API Key (opcional, para IA)

---

## 🚀 Instalação

### 1. Clone o repositório

```bash
git clone https://github.com/seu-usuario/sistema-aero-festas.git
cd sistema-aero-festas
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure o banco de dados

Crie um arquivo `.env` na raiz do projeto:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/aerofestas"
PORT=3000
JWT_SECRET="seu-secret-aqui"
NODE_ENV="development"
```

### 4. Execute as migrations do Prisma

```bash
npx prisma generate
npx prisma db push
```

### 5. (Opcional) Popule o banco com dados de exemplo

```bash
npm run seed
```

### 6. Inicie o servidor

```bash
npm start
```

O servidor estará rodando em `http://localhost:3000`

---

## ⚙️ Configuração

### Variáveis de Ambiente

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | URL de conexão PostgreSQL | `postgresql://...` |
| `PORT` | Porta do servidor | `3000` |
| `JWT_SECRET` | Chave secreta para JWT | `minha-chave-secreta` |
| `NODE_ENV` | Ambiente de execução | `development` / `production` |

### Configuração do Google Gemini

1. Acesse [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Gere sua API Key
3. No sistema, acesse **Configurações** (ícone de engrenagem)
4. Cole sua API Key e salve

---

## 💻 Uso

### Acessar o Sistema

1. Abra o navegador em `http://localhost:3000`
2. Faça login com suas credenciais
3. Navegue entre os módulos:
   - 🏠 **Dashboard** - Visão geral da empresa
   - 💰 **Gestão Financeira** - Controle completo de finanças
   - 📅 **Agenda de Eventos** - Calendário e agendamentos
   - 👥 **CRM** - Gestão de clientes

### Fluxo Típico de Uso

#### Registrar um Novo Evento
1. Acesse **Agenda de Eventos**
2. Clique em **+ Novo Evento**
3. Preencha: Data, Cliente, Empresa, Local
4. Adicione brinquedos à lista
5. Confirme (sistema calcula total automaticamente)
6. Evento aparece no calendário e nas finanças

#### Lançar Pagamento de Monitor
1. Acesse **Gestão Financeira** > **Monitores**
2. Clique em **Lançar Pagamento & Avaliação**
3. Selecione data do evento, monitor e valor da diária
4. Informe horário de entrada e saída (HE calculadas automaticamente)
5. **Se foi motorista:**
   - Marque o checkbox ✅
   - Informe quantos eventos entregou (ex: 3.5)
   - Sistema calcula: eventos × R$ 20,00
6. Avalie o monitor nos 4 critérios
7. Confirme - total incluído nas despesas automaticamente

#### Visualizar Dashboard Financeiro
1. Acesse **Gestão Financeira** > **Dashboard**
2. Veja os cards de KPI atualizados em tempo real
3. Analise os 6 gráficos interativos
4. Compare com mês anterior (% de variação)
5. Use o filtro de mês para histórico

---

## 📁 Estrutura do Projeto

```
sistema-aero-festas/
├── prisma/
│   ├── schema.prisma          # Schema do banco de dados
│   └── migrations/             # Histórico de migrations
├── routes/
│   ├── finance.js             # Rotas financeiras e monitores
│   ├── admin.js               # Rotas administrativas
│   └── auth.js                # Autenticação e autorização
├── js/
│   ├── api.js                 # Módulo de API (frontend)
│   ├── auth.js                # Autenticação (frontend)
│   ├── charts-financeiro.js   # Configuração dos gráficos
│   ├── charts-init.js         # Inicialização de gráficos
│   └── protect.js             # Middleware de proteção
├── public/
│   └── assets/                # Imagens e recursos estáticos
├── Dashboard.html             # Página principal
├── Sistema Gestão Financeira.html  # Módulo financeiro
├── Agenda de eventos.html     # Calendário de eventos
├── Sistema de CRM.html        # Gestão de clientes
├── index.js                   # Entry point do servidor
├── package.json               # Dependências e scripts
├── .env                       # Variáveis de ambiente (não versionado)
└── README.md                  # Este arquivo
```

---

## 🔌 API Endpoints

### Autenticação
```
POST   /api/auth/register      # Registrar novo usuário
POST   /api/auth/login         # Login
POST   /api/auth/logout        # Logout
```

### Eventos
```
GET    /api/admin/events-full  # Listar todos os eventos
POST   /api/admin/events       # Criar evento
PUT    /api/admin/events/:id   # Atualizar evento
DELETE /api/admin/events/:id   # Deletar evento
```

### Finanças
```
GET    /api/finance/dashboard           # KPIs do dashboard
GET    /api/finance/transactions        # Listar transações
POST   /api/finance/transactions        # Criar transação
DELETE /api/finance/transactions/:id    # Deletar transação
```

### Monitores
```
GET    /api/finance/monitores                  # Listar monitores
POST   /api/finance/monitores                  # Criar monitor
PUT    /api/finance/monitores/:id              # Atualizar monitor
DELETE /api/finance/monitores/:id              # Deletar monitor
GET    /api/finance/pagamentos-monitores       # Listar pagamentos
POST   /api/finance/pagamentos-monitores       # Criar pagamento
PUT    /api/finance/pagamentos-monitores/:id   # Atualizar pagamento (status)
DELETE /api/finance/pagamentos-monitores/:id   # Deletar pagamento
```

### Contas Fixas
```
GET    /api/finance/contas-fixas        # Listar contas fixas
POST   /api/finance/contas-fixas        # Criar conta fixa
PUT    /api/finance/contas-fixas/:id    # Atualizar conta fixa
DELETE /api/finance/contas-fixas/:id    # Deletar conta fixa
```

### Brinquedos
```
GET    /api/admin/toys                  # Listar brinquedos
POST   /api/admin/toys                  # Criar brinquedo
PUT    /api/admin/toys/:id              # Atualizar brinquedo
DELETE /api/admin/toys/:id              # Deletar brinquedo
```

### Clientes (CRM)
```
GET    /api/admin/clients               # Listar clientes
POST   /api/admin/clients               # Criar cliente
PUT    /api/admin/clients/:id           # Atualizar cliente
DELETE /api/admin/clients/:id           # Deletar cliente
```

---

## 🔄 Fluxo de Trabalho

### Deploy no Railway

1. **Conecte o repositório:**
   ```bash
   railway link
   ```

2. **Configure as variáveis de ambiente no Railway:**
   - `DATABASE_URL` (PostgreSQL provisionado automaticamente)
   - `JWT_SECRET`
   - `NODE_ENV=production`

3. **Deploy:**
   ```bash
   git push origin main
   # Railway detecta e faz deploy automaticamente
   ```

### Desenvolvimento Local

1. **Branch de feature:**
   ```bash
   git checkout -b feature/nova-funcionalidade
   ```

2. **Desenvolva e teste localmente:**
   ```bash
   npm run dev
   ```

3. **Commit e push:**
   ```bash
   git add .
   git commit -m "feat: adicionar nova funcionalidade"
   git push origin feature/nova-funcionalidade
   ```

4. **Abra um Pull Request no GitHub**

---

## 🎨 Customização

### Adicionar Nova Categoria de Gasto

1. Acesse **Gestão Financeira** > **Gastos** > ⚙️ **Categorias**
2. Clique em **Adicionar Categoria**
3. Digite o nome (ex: "Marketing")
4. A categoria estará disponível imediatamente

### Modificar Valor do Adicional de Motorista

No arquivo `Sistema Gestão Financeira.html`, linha ~1088:

```javascript
const calcularAdicionalMotorista = () => {
    const numEventos = parseFloat(eventosInput.value) || 0;
    const valorPorEvento = 20.00; // ← ALTERE AQUI
    const adicional = numEventos * valorPorEvento;
    // ...
};
```

### Alterar Base de Horas para Hora Extra

No arquivo `Sistema Gestão Financeira.html`, linha ~1050:

```javascript
// Diária base cobre 11 horas. Valor da hora = Diária / 11
const valorHora = valorDiaria / 11; // ← ALTERE AQUI
const horasExtras = Math.max(0, totalHoras - 11); // ← E AQUI
```

---

## 📊 Schema do Banco de Dados

### Principais Modelos

**Event** - Eventos/Locações
- `id`, `date`, `clientName`, `local`, `company`, `price`, `items`

**Monitor** - Equipe de Monitores
- `id`, `nome`, `telefone`, `email`, `cnh`, `fotoPerfil`

**PagamentoMonitor** - Pagamentos de Monitores
- `id`, `data`, `monitorId`, `valorBase`, `adicional`, `horasExtras`, `pagamento`
- `foiMotorista`, `numEventos`, `statusPagamento`

**Transaction** - Transações Financeiras
- `id`, `type` (REVENUE/EXPENSE), `amount`, `date`, `category`

**FixedBill** - Contas Fixas
- `id`, `description`, `amount`, `dueDay`, `category`, `recurrenceType`

**Toy** - Brinquedos
- `id`, `name`, `category`, `status`, `price`

**Client** - Clientes
- `id`, `name`, `phone`, `email`, `address`

---

## 🧪 Testes

```bash
# Executar testes
npm test

# Testes com coverage
npm run test:coverage

# Testes e2e
npm run test:e2e
```

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Para contribuir:

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'feat: adicionar AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

### Convenção de Commits

Utilizamos [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` Nova funcionalidade
- `fix:` Correção de bug
- `docs:` Documentação
- `style:` Formatação (sem mudança de código)
- `refactor:` Refatoração
- `test:` Adição de testes
- `chore:` Manutenção

---

## 📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

---

## 👨‍💻 Autores

- **Leandro Karlitos** - *Desenvolvimento Principal* - [@leandrokarlitos](https://github.com/leandrokarlitos-collab)

---

## 🙏 Agradecimentos

- Equipe Aero Festas pelo feedback constante
- Comunidade open source
- Google Gemini AI pelo suporte de IA

---

## 📞 Suporte

- 📧 Email: suporte@aerofestas.com.br
- 💬 Issues: [GitHub Issues](https://github.com/seu-usuario/sistema-aero-festas/issues)
- 📚 Wiki: [Documentação Completa](https://github.com/seu-usuario/sistema-aero-festas/wiki)

---

## 🗺️ Roadmap

- [ ] App Mobile (React Native)
- [ ] Integração com WhatsApp Business API
- [ ] Sistema de notificações push
- [ ] Controle de estoque avançado
- [ ] Assinatura digital de contratos
- [ ] Dashboard para clientes
- [ ] Relatórios personalizáveis
- [ ] Modo offline com sync

---

## 📈 Estatísticas

![GitHub repo size](https://img.shields.io/github/repo-size/seu-usuario/sistema-aero-festas)
![GitHub contributors](https://img.shields.io/github/contributors/seu-usuario/sistema-aero-festas)
![GitHub stars](https://img.shields.io/github/stars/seu-usuario/sistema-aero-festas?style=social)
![GitHub forks](https://img.shields.io/github/forks/seu-usuario/sistema-aero-festas?style=social)

---

**Desenvolvido com ❤️ para Aero Festas**

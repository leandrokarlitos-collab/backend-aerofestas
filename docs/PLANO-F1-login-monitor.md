# Plano de Execução — F1: Papel de Monitor + Login

> **Projeto:** Sistema Operante – Aero Festas
> **Fase:** F1 do "app do monitor" (a fundação de autenticação). Depende da **F0 (segurança)**, que já está **deployada e verificada em produção** (commit `f7e5a2c`).
> **Objetivo da F1:** dar a cada monitor um login próprio, com acesso restrito ao app dele, provisionado de forma segura. **Não** implementa ainda as telas de ponto/escala/gastos (isso é F3+).

---

## 0. Como usar este documento

Este plano é autossuficiente, mas o código pode ter mudado desde que foi escrito (2026-07-09). **Antes de editar cada arquivo, confirme os fatos abaixo com uma leitura rápida do código real** (os `arquivo:linha` são âncoras, não garantias). Regra de ouro do projeto: **nunca resetar/apagar dados do Prisma**; migrações só **adicionam** colunas nulas.

O executor deve, ao final, **fornecer a mensagem de commit em pt-br** no padrão `tipo: descrição` (ver §12).

---

## 1. Contexto e decisões travadas

O dono quer um "app paralelo" para monitores (funcionários de eventos). A F1 entrega **apenas o alicerce de acesso**. Duas decisões já foram tomadas pelo dono:

1. **Provisionamento = cadastro cria conta PENDENTE, o gestor aprova.**
   O formulário `cadastro-monitor.html` é **público**. O candidato preenche e **define a senha dele**, mas a conta nasce **bloqueada (pendente)**. O gestor aprova na tela de equipe e **só então** o monitor recebe o link do app e consegue entrar. Isso preserva a ideia de auto-cadastro sem deixar qualquer um entrar.

2. **Login do monitor = CPF + senha.**
   O CPF já é campo único do cadastro (`Monitor.cpf @unique`). A senha é definida pelo próprio monitor no formulário. (O dono comentou que "monitores são seres com amnésia" — por isso o gestor também poderá **resetar a senha** de um monitor pela ficha dele.)

### Decisão de arquitetura recomendada (credenciais no próprio `Monitor`)
Em vez de criar contas na tabela `User` (que é toda baseada em e-mail único e feita para gestores), **as credenciais do monitor ficam no próprio model `Monitor`** (colunas novas: `senhaHash`, `acessoStatus`, etc.). Motivos:
- O login é por **CPF**, não e-mail; muitos monitores não têm e-mail confiável.
- Evita poluir `User` com e-mails falsos e não mistura sessões de gestor e monitor.
- `Monitor` já é uma entidade rica e já está no backup (`BackupService.TABLES`) — **não criamos model novo**, só adicionamos colunas (mais seguro para o disaster-recovery).

O token do monitor é um JWT separado com `role: 'monitor'`, e o middleware garante que **um token de monitor não acessa nenhuma rota de gestor** (fecha o risco "tudo-ou-nada").

---

## 2. Estado atual do código (fatos com arquivo:linha)

**Autenticação (gestores):**
- `User` — `prisma/schema.prisma:472-493`. Campos: `id` uuid, `name`, `email @unique`, `password` (bcrypt), `phone?`, `photoUrl?`, `isAdmin Boolean @default(false)`, `emailConfirmed`, `verificationToken?`, `resetPasswordToken?`, `resetPasswordExpires?`. Única noção de papel = `isAdmin`. Relações: `Task`, `DailyPlan`, `PushSubscription`.
- `middleware/auth.js` — expõe `authenticate`, `isAuthenticated`, `isAdmin`. **Pós-F0: `JWT_SECRET` é obrigatório (sem fallback).**
- `routes/auth.js` — `POST /login` emite JWT `{ id, email, name, isAdmin }`, `expiresIn: '7d'`. **Pós-F0: `POST /register` desativado (403); `FRONTEND_URL = 'https://agenda-aero-festas.web.app'`; fluxo forgot/reset-password existe e funciona.**
- `routes/admin.js:50-121` — `POST /api/admin/users` (protegido por `isAdmin`): provisiona User, pode gerar senha aleatória (`crypto.randomBytes`), `skipEmailConfirmation`, grava `logAudit`.
- `js/auth.js` — `getToken()` → `localStorage.getItem('authToken')`; `login/register/getMe/logout`.
- `js/protect.js` — guard das páginas do **gestor**: valida `GET /api/auth/me`, salva `userData`, redireciona para `login.html` se sem token. **Este guard é do gestor — o app do monitor terá o próprio.**

**Monitores:**
- `Monitor` — `prisma/schema.prisma:376-420`. `id String` (sem `@default`; hoje o cliente manda `Date.now()`), `nome`, `cpf String? @unique`, `nascimento`, `telefone`, `email`, `endereco`, `disponibilidade` (JSON), `status @default("reserva")` (`ativo|reserva|alerta|desqualificado`), `statusMotivo`, `cnh Boolean` + `cnhCategoria`, `fotoPerfil`/`fotoDocumento` (base64 ou URL), campos de saúde, contato de emergência. **Sem senha, sem relação com `User`.** Relações: `desempenho[]`, `pagamentos[]`, `manutencoes[]`.
- `cadastro-monitor.html` — formulário **público** (NÃO inclui `js/protect.js`). Fotos vão para **Cloudinary** (preset unsigned hardcoded em `cadastro-monitor.html:764-765`), com fallback base64.
- `routes/finance.js:104-114` — **4 rotas de monitor SEM token** (exceções ao `authenticate` de `/api/finance`): `POST /monitores`, `POST /monitores/verificar` (dedupe CPF/e-mail), `GET /monitores/:id`, `PUT /monitores/:id`. O código admite que endurecer isso é "melhoria futura". **⚠️ Endereçar na F1 (§5.6).**
- `routes/finance.js:546-571, 790-808, 813-821` — classificação disciplinar (`status`/`statusMotivo`) só de requisições autenticadas; `PATCH /monitores/:id/status`; `DELETE /monitores/:id` com `authenticate`.
- `equipe.html` — tela autenticada de gestão (tem `js/protect.js`), abas `monitores | pagamentos | desempenho | fixa`.

**Infra:**
- `AuditLog` — `prisma/schema.prisma:590-605`: `entityType, entityId, action, userId, userName, userEmail, changes(JSON), snapshot(JSON)`. `services/audit.js` (`logAudit`, fire-and-forget) espera um objeto `user {id,name,email}`.
- `services/BackupService.js:40-76` — `TABLES` topológico; **`Monitor` já está incluído** → colunas novas entram no backup automaticamente. **Não** criar model novo evita mexer aqui.
- Pós-F0: backend serve **somente `/api`** (frontend é Firebase Hosting). `PushSubscription` agora grava `userId`. VAPID rotacionada. `firebase.json` tem rewrites `/e/**` → `cadastro-evento.html`, `/p/<slug>` → propostas, `/p/**` → `propostas/view.html`. `sw.js` (v3.12.0) cacheia a origem inteira com escopo único.

---

## 3. Escopo da F1

**ENTRA:**
- Colunas de credencial no `Monitor` (+ migração aditiva).
- Middleware de papéis: token de monitor ⇎ token de gestor isolados.
- Rota de login do monitor (CPF + senha) + `GET /me` do monitor.
- Cadastro com senha criando conta **pendente**.
- Aprovação / bloqueio / reset de senha pelo gestor (na `equipe.html`).
- Endurecimento das rotas públicas de monitor (não vazar `senhaHash`/dados sensíveis; não deixar público alterar acesso).
- **Shell mínimo do app do monitor**: página de login + home "Olá, <nome>" com logout (prova o fluxo ponta a ponta). As telas de ponto/escala/gastos são F3+.
- Envio do link do app ao aprovar (e-mail via nodemailer; fallback: gestor copia o link).
- Auditoria de todas as ações de acesso.

**NÃO ENTRA (fases seguintes):**
- Ponto eletrônico / geofence / prévia de pagamento (F3).
- Escala estruturada e "motorista do dia" (F2).
- Gastos com foto/OCR (F4).
- PWA do monitor com service worker/escopo próprio e push direcionado (F3/F6). Na F1 as páginas do monitor são arquivos simples servidos pelo Firebase.

---

## 4. Modelo de dados (Prisma)

Adicionar ao model `Monitor` em `prisma/schema.prisma` (todas as colunas **nulas ou com default** — migração aditiva, sem perda de dados):

```prisma
// --- Acesso ao app do monitor (F1) ---
senhaHash          String?    // bcrypt; null = ainda não definiu senha
acessoStatus       String     @default("sem_acesso") // sem_acesso | pendente | ativo | bloqueado
acessoAprovadoPor  String?    // id do User (gestor) que aprovou
acessoAprovadoEm   DateTime?
ultimoLoginApp     DateTime?
resetSenhaToken    String?
resetSenhaExpira   DateTime?
```

Estados de `acessoStatus`:
- `sem_acesso` — nunca definiu senha (default; monitores legados ficam assim).
- `pendente` — preencheu o cadastro com senha, aguardando aprovação do gestor.
- `ativo` — aprovado; pode logar no app.
- `bloqueado` — acesso revogado (ex.: desligado).

**Migração:** criar migração aditiva (ver §8). Nome sugerido: `add_monitor_credenciais`.

---

## 5. Backend

### 5.1 Middleware de papéis (`middleware/auth.js`)

O JWT do **gestor** hoje não tem `role`. O JWT do **monitor** terá `role: 'monitor'`. Regras:

1. **`authenticate` (existente — usado por TODAS as rotas de gestor): passar a rejeitar tokens de monitor.**
   Depois de `jwt.verify`, se `decoded.role === 'monitor'` → `403 { error: 'Acesso restrito.' }`. Tokens sem `role` (gestores atuais) continuam passando (retrocompatível). Isso impede que um token de monitor acesse eventos/finanças/auditoria.
   - Aplicar a mesma exclusão em `isAuthenticated(req)` (retornar `false` se `role === 'monitor'`).

2. **`authenticateMonitor` (NOVO): guard das rotas `/api/monitor/*`.**
   - `jwt.verify` com `process.env.JWT_SECRET`.
   - Exigir `decoded.role === 'monitor'`; senão `403`.
   - Buscar `Monitor` por `decoded.monitorId`; se não existe → `401`.
   - Exigir `monitor.acessoStatus === 'ativo'`; senão `403 { error: 'Acesso não liberado.' }` (isso dá **revogação instantânea**: basta o gestor bloquear que o próximo request cai, mesmo com JWT válido).
   - Injetar `req.monitor = monitor`.

Exportar `authenticateMonitor` junto de `authenticate/isAuthenticated/isAdmin`.

### 5.2 Autenticação do monitor (`routes/monitorAuth.js` — NOVO, montar em `/api/monitor/auth`)

- `POST /login` — body `{ cpf, senha }`.
  - Normalizar CPF (só dígitos).
  - `findFirst` `Monitor` por `cpf`.
  - Se não achar, ou `acessoStatus !== 'ativo'`, ou `senhaHash` nulo → `401 { error: 'CPF ou senha inválidos, ou acesso não liberado.' }` (mensagem genérica; se for `pendente`, pode devolver um código próprio p/ a tela dizer "aguardando aprovação").
  - `bcrypt.compare(senha, monitor.senhaHash)`. Se ok, emitir JWT: `{ monitorId: monitor.id, role: 'monitor', nome: monitor.nome }`, `expiresIn: '30d'`.
  - Atualizar `ultimoLoginApp`. `logAudit` (ação `LOGIN`, ator = o próprio monitor — ver §7).
  - Responder `{ token, monitor: { id, nome } }` (nunca `senhaHash`).
- `GET /me` — `authenticateMonitor`; retorna **apenas** `{ id, nome, telefone, acessoStatus }` (sem senha, sem campos de saúde/documento).
- (Opcional F1) `POST /forgot` / `POST /reset` por CPF, reaproveitando o padrão de `routes/auth.js`. Se preferir simplicidade, deixar o reset **só pelo gestor** (§5.5) e não expor forgot público agora.

Montar em `server.js`: `app.use('/api/monitor/auth', authLimiter, monitorAuthRoutes);` (reutilizar o `authLimiter` criado na F0 para conter brute-force de CPF).

### 5.3 Cadastro com senha (pendente) — alterar `POST /monitores` em `routes/finance.js`

- Aceitar `senha` no body. Se presente:
  - Validar comprimento (mín. 6).
  - `senhaHash = await bcrypt.hash(senha, 10)`.
  - `acessoStatus = 'pendente'`.
- Manter a rota **pública** (candidatos usam), pois conta `pendente` é inócua até aprovação.
- **Nunca** retornar `senhaHash` na resposta.
- `POST /monitores/verificar` (dedupe CPF/e-mail) continua igual.

### 5.4 Aprovação / bloqueio pelo gestor — `routes/finance.js` (protegido por `authenticate`)

- `PATCH /monitores/:id/acesso` — body `{ action }`:
  - `aprovar` → `acessoStatus='ativo'`, `acessoAprovadoPor=req.user.id`, `acessoAprovadoEm=now`. Disparar e-mail com o link do app (se `monitor.email`); `logAudit` (ator = gestor `req.user`).
  - `bloquear` → `acessoStatus='bloqueado'`. `logAudit`.
  - `reativar` → `acessoStatus='ativo'`. `logAudit`.
- Retornar o monitor **sem** `senhaHash`.

E-mail de aprovação: reutilizar o `transporter` (nodemailer/Gmail) já usado em `routes/auth.js`. Link do app: `https://agenda-aero-festas.web.app/app-monitor/login.html` (ver §6.3/§6.4). Se o monitor não tiver e-mail, a UI mostra o link para o gestor copiar.

### 5.5 Reset de senha pelo gestor — `routes/finance.js` (protegido por `authenticate`)

- `POST /monitores/:id/reset-senha` — gera uma senha temporária (`crypto.randomBytes(4).toString('hex')`), grava `senhaHash`, mantém `acessoStatus` como está (ou volta para `ativo` se estava sem senha). Retornar a senha temporária **uma única vez** para o gestor repassar ao monitor (e/ou enviar por e-mail). `logAudit`.

### 5.6 Endurecimento das rotas públicas de monitor (segurança — pendência herdada da F0)

- `GET /monitores/:id` (público): **remover `senhaHash`** sempre; se o chamador não estiver autenticado, **omitir também** campos sensíveis (saúde, `fotoDocumento`, CPF completo). Se já houver o link de edição por `?id=`, considerar exigir um token assinado curto no futuro (anotar, não obrigatório na F1).
- `PUT /monitores/:id` (público): **whitelist** de campos que o público pode alterar (dados de contato/formulário). **Nunca** permitir alterar `acessoStatus`, `senhaHash`, `status` disciplinar por essa rota pública.

---

## 6. Frontend

### 6.1 `cadastro-monitor.html`
- Adicionar campos **Senha** e **Confirmar senha** (mín. 6, validação de igualdade no cliente).
- Incluir `senha` no corpo do `POST /monitores`.
- Ao enviar com sucesso, mensagem: *"Cadastro enviado! Seu acesso será liberado pelo gestor. Você receberá o link do app quando aprovado."*

### 6.2 `equipe.html` (aba monitores)
- Exibir um **badge de acesso** por monitor: `sem_acesso` / `pendente` / `ativo` / `bloqueado`.
- Botões conforme o estado: **Aprovar** (quando `pendente`), **Bloquear** / **Reativar**, **Resetar senha**.
- Chamar as rotas `PATCH /monitores/:id/acesso` e `POST /monitores/:id/reset-senha`.
- Mostrar o **link do app do monitor** para copiar, e o resultado do reset (senha temporária) num toast.

### 6.3 App do monitor — shell mínimo (NOVO, pasta `app-monitor/`)
Arquivos reais servidos pelo Firebase (não usar `js/protect.js`, que é do gestor):
- `app-monitor/login.html` — formulário **CPF + senha** → `POST /api/monitor/auth/login`; salva o token em `localStorage` numa chave **separada** (ex.: `monitorToken`, **não** `authToken`) para não misturar sessões. Redireciona para `home.html`.
- `app-monitor/home.html` — guard próprio (`js/monitor-protect.js`): valida `GET /api/monitor/auth/me`; se falhar, volta para `login.html`. Conteúdo F1: *"Olá, <nome> 👋 Seu acesso está ativo. As funções (ponto, escala, gastos) chegam nas próximas atualizações."* + botão **Sair** (limpa `monitorToken`).
- `js/monitor-protect.js` — guard mínimo descrito acima.
- Tela de "aguardando aprovação": se o login responder que a conta está `pendente`, mostrar *"Seu acesso ainda não foi liberado pelo gestor."*

> **Observação de PWA:** na F1 as páginas do monitor são simples. O `sw.js` do gestor cacheia a origem inteira; para F1 isso é tolerável. **F3/F6** dará ao app do monitor service worker/escopo próprio (ou site Firebase separado) e push direcionado. Não adicionar as páginas do monitor ao precache do `sw.js`.

### 6.4 Firebase Hosting (`firebase.json`)
- Arquivos reais em `app-monitor/` já são servidos diretamente (o Firebase serve arquivo real antes de qualquer rewrite), então **não há colisão** com os catch-alls `/p/**` e `/e/**`. Se quiser uma URL curta (ex.: `/monitor`), adicionar um rewrite **ANTES** dos catch-alls `/p/**` e `/e/**` no array de `rewrites`.
- Deploy: `firebase deploy --only hosting`. Lembrar de **bumpar `CACHE_NAME` no `sw.js`** e a versão em `js/pwa-init.js` (fluxo PWA do projeto).

---

## 7. Auditoria

- **Ações do gestor** (aprovar/bloquear/reset): `logAudit` com o ator = `req.user` (gestor), `entityType: 'MonitorAcesso'`, `entityId: monitor.id`, `action: 'APROVAR'|'BLOQUEAR'|'RESET_SENHA'`, `changes` com estado antigo→novo.
- **Ações do monitor** (login): como `logAudit` espera `{id,name,email}`, usar a convenção de ator não-User: `{ id: 'monitor:' + monitor.id, name: monitor.nome, email: monitor.cpf }`. `entityType: 'MonitorAcesso'`, `action: 'LOGIN'`.
- (Requisito "tudo auditado" do dono se completa nas fases seguintes, quando ponto/gastos forem instrumentados — na F1 auditar o ciclo de acesso já é o esperado.)

---

## 8. Migração e backup

- **Criar migração aditiva** (só `ADD COLUMN` nulos/com default). Fluxo local: `npx prisma migrate dev --name add_monitor_credenciais`. **Cuidado:** se o `migrate dev` acusar *drift* e ameaçar resetar, **NÃO confirmar reset** (regra do projeto). Nesse caso, gerar o SQL manualmente em `prisma/migrations/<timestamp>_add_monitor_credenciais/migration.sql` com os `ALTER TABLE "Monitor" ADD COLUMN ...` e rodar `prisma migrate deploy`.
- **Railway** aplica migrações no deploy (`prisma migrate deploy` no processo de build/start — confirmar no `package.json`/config do Railway).
- **Backup:** como **não** há model novo, `services/BackupService.js` `TABLES` **não muda** (`Monitor` já está lá; colunas novas entram no snapshot de linha automaticamente). Confirmar que o backup roda após o deploy.
- **Node pinado em 20.x no Railway** — não alterar a versão (quebra OAuth do googleapis/firebase-admin).

---

## 9. Ordem de execução passo a passo

1. **Schema + migração** (§4, §8): adicionar colunas ao `Monitor`, gerar migração aditiva, aplicar local sem resetar dados.
2. **Middleware** (§5.1): `authenticate` rejeita `role='monitor'`; criar `authenticateMonitor`.
3. **Rota de login do monitor** (§5.2): `routes/monitorAuth.js`, montar em `server.js` com `authLimiter`.
4. **Cadastro com senha** (§5.3): alterar `POST /monitores`.
5. **Aprovação/bloqueio/reset** (§5.4, §5.5): novas rotas em `routes/finance.js`.
6. **Endurecer rotas públicas** (§5.6).
7. **Frontend cadastro** (§6.1) e **gestão/aprovação** (§6.2).
8. **Shell do app do monitor** (§6.3) + hosting (§6.4).
9. **Auditoria** (§7) plugada nas rotas novas.
10. **Testes** (§10).
11. **Deploy** na ordem segura da F0: `firebase deploy --only hosting` **antes** do `git push` (Railway redeploya o backend). Verificar em produção.
12. **Commit** com mensagem pt-br (§12).

---

## 10. Checklist de testes (local, antes do deploy)

Subir o backend local (`node server.js`, porta 3000) e testar com `node -e` (para acentos/UTF-8 corretos — **não** usar PowerShell/curl para corpos com acento):

- [ ] Cadastro com senha cria monitor `acessoStatus='pendente'`; resposta **não** contém `senhaHash`.
- [ ] Login do monitor **pendente** → 401/mensagem "aguardando aprovação".
- [ ] Aprovar (gestor) muda para `ativo` e grava `AuditLog`.
- [ ] Login do monitor **ativo** → recebe JWT `role='monitor'`.
- [ ] Token de **monitor** em rota de gestor (`GET /api/admin/events-full`, `/api/finance/dashboard`) → **403** (isolamento).
- [ ] Token de **gestor** continua acessando as rotas de gestor normalmente (retrocompatível).
- [ ] `authenticateMonitor` rejeita monitor **bloqueado** mesmo com JWT válido (revogação instantânea).
- [ ] `GET /monitores/:id` sem token **não** vaza `senhaHash` nem dados de saúde.
- [ ] `PUT /monitores/:id` público **não** consegue alterar `acessoStatus`/`senhaHash`.
- [ ] Reset de senha (gestor) permite o monitor logar com a senha nova.
- [ ] Shell do app: login por CPF+senha → home "Olá, <nome>" → logout limpa `monitorToken`.
- [ ] Rate limit do `authLimiter` responde nas tentativas repetidas de login do monitor.

---

## 11. Armadilhas do projeto (não ignorar)

- **Nunca resetar/apagar dados do Prisma.** Migração só aditiva.
- **UTF-8:** corpos HTTP com acentos só via `node -e`; PowerShell/curl locais corrompem "ã"→�. (Escrever arquivos `.md`/`.js` pelo editor é seguro.)
- **`JWT_SECRET` é obrigatório** (pós-F0, sem fallback) — o monitor usa o **mesmo** secret.
- **Node 20.x pinado no Railway** — não atualizar.
- **Deploy PWA:** bump `CACHE_NAME` no `sw.js` + versão no `js/pwa-init.js`; deploy `firebase deploy --only hosting`; ordem segura = hosting antes do push.
- **Não reusar `js/protect.js`** no app do monitor (é o guard do gestor). Usar `monitorToken` separado de `authToken`.
- **Sessões separadas:** token do gestor e do monitor não podem se misturar no mesmo `localStorage` key.
- **Há mudanças não relacionadas já pendentes no repo** (ex.: `Proposta-Analytics.html`, migração `proposta_track`, `propostas/jardins-florenca`). **Commitar a F1 com pathspec** (só os arquivos da F1), não `git add -A`.
- **`custoPagamentoMonitor` duplicado** em vários arquivos — não é da F1, mas cuidado ao tocar em finance.
- **Cloudinary unsigned** no cadastro é um débito de segurança conhecido (não é escopo da F1; anotado para depois).

---

## 12. Mensagem de commit (fornecer ao dono)

```
feat: F1 login do monitor — papel 'monitor', cadastro com senha e aprovação pelo gestor

- Monitor ganha credenciais (senhaHash, acessoStatus) e login próprio por CPF+senha
- Cadastro público cria conta 'pendente'; gestor aprova/bloqueia/reseta na equipe.html
- Middleware isola token de monitor das rotas de gestor; revogação instantânea por acessoStatus
- Rotas públicas de monitor endurecidas (não vazam senhaHash/dados sensíveis)
- Shell mínimo do app do monitor (login + home) e auditoria do ciclo de acesso
```

---

## Referência rápida — memória do projeto

Notas relacionadas na memória (`~/.claude/.../memory/`): `project_app_monitor_estudo.md` (estudo completo e roadmap F0–F6), `project_security_exposures_producao.md` (F0, status deployado), `project_app_monitor_f1_autocadastro.md` (esta decisão do auto-cadastro com aprovação). Regras críticas em `feedback_no_prisma_reset.md`, `feedback_utf8_api_writes.md`, `feedback_always_provide_commit_text.md`, `project_railway_node_pin.md`.

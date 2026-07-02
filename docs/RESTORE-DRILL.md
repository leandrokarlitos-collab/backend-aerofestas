# Drill de Restauração — Procedimento Trimestral (~15 min)

> **Por que fazer isso?** Backup que nunca foi restaurado é só uma *esperança*. Este drill
> prova, a cada trimestre, que conseguimos reconstruir o sistema inteiro a partir do
> Firebase Storage — antes de precisar de verdade.
>
> **Regra de ouro: NUNCA rode `prisma migrate reset` nem qualquer DELETE/TRUNCATE.**
> O drill acontece num banco descartável, nunca no de produção.

## Pré-requisitos

- Node.js + dependências do projeto instaladas (`npm install`).
- Credenciais do Firebase no ambiente (mesmas do backend no Railway):
  `FIREBASE_SERVICE_ACCOUNT_JSON` e `FIREBASE_STORAGE_BUCKET`.
- Se os backups estiverem criptografados (`.enc`): `BACKUP_ENCRYPTION_KEY` (64 hex chars).
- Docker Desktop (opção A) **ou** um segundo environment no Railway (opção B).

---

## Passo a passo

### 1. Suba um Postgres descartável

**Opção A — Docker local (recomendada):**

```powershell
docker run --name aero-drill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=aerodrill -p 5433:5432 -d postgres:16
```

> Porta **5433** para não colidir com um Postgres local existente.
> Ao final do drill: `docker rm -f aero-drill` (destrói só o banco descartável).

**Opção B — Railway:** crie um segundo environment (ex.: `drill`) no projeto, adicione um
Postgres novo nele e copie a `DATABASE_URL` pública desse banco.

### 2. Aponte a DATABASE_URL para o banco drill e crie o schema

**PowerShell** (só vale para a janela atual do terminal):

```powershell
$env:DATABASE_URL = "postgresql://postgres:drill@localhost:5433/aerodrill"
npx prisma migrate deploy
```

**cmd.exe:**

```cmd
set DATABASE_URL=postgresql://postgres:drill@localhost:5433/aerodrill
npx prisma migrate deploy
```

> `migrate deploy` só APLICA migrations pendentes — nunca apaga nada.
> **JAMAIS use `migrate reset`** (ele dropa o banco inteiro).

### 3. Dry-run do restore a partir do Storage

```powershell
node scripts/restore.js --from-storage latest
```

Sem `--mode`, o dry-run é o comportamento padrão: mostra uma tabela
`arquivo | banco | ação prevista` sem escrever **nada**. Confira:

- Formato detectado `v2 (flat)` e ✅ checksum verificado;
- Todas as tabelas com dados no arquivo aparecem como `inserir N` (banco vazio).

### 4. Restore real (empty-only)

```powershell
node scripts/restore.js --from-storage latest --mode empty-only --yes
```

- `empty-only` verifica ANTES que todas as tabelas-alvo estão vazias — se algo tiver
  dado, aborta sem escrever uma linha.
- Ao final: relatório por tabela (inseridos/pulados/erros), sequences realinhadas e um
  registro `BackupRun {type:'restore'}` gravado no banco drill.

### 5. Validação

```powershell
node scripts/check-db-counts.js
```

Compare os números com os `counts` exibidos no restore (ou com o Dashboard de produção).

Depois, suba o backend local apontando para o banco drill e navegue no sistema:

```powershell
# na MESMA janela (DATABASE_URL ainda aponta pro drill)
node server.js
```

Abra o sistema local e confira por amostragem: Agenda com eventos, Financeiro com
transações, Clientes, Estoque. Se tudo bate → drill aprovado.

### 6. Registre o drill (no banco de PRODUÇÃO)

O registro do drill fica no histórico de produção (aba de backups do Dashboard). Para
isso, **troque a DATABASE_URL de volta para a de produção antes** — o jeito mais simples
é abrir uma **janela nova do terminal** (a variável do passo 2 só vale na janela antiga),
onde o `.env` do projeto já aponta para produção:

```powershell
node scripts/restore.js --record-drill "Drill trimestral OK — 517 registros restaurados e validados"
```

Isso grava apenas um `BackupRun {type:'drill', success:true}` — nenhum outro dado é tocado.

### 7. Limpeza

```powershell
docker rm -f aero-drill
```

---

## Camada 2 — Backups nativos do Railway

Independente do nosso backup lógico, habilite o snapshot nativo do Postgres no Railway
(proteção contra corrupção do volume):

1. Dashboard do Railway → projeto → serviço **Postgres**;
2. Aba **Backups**;
3. Habilite os backups automáticos (diários) e confira a retenção.

> **Nota:** esse recurso pode exigir plano pago (Hobby/Pro). Se não estiver disponível
> no plano atual, a Camada 3 abaixo cobre a lacuna.

## Camada 3 — pg_dump manual mensal (opcional)

Uma vez por mês, gere um dump físico completo e guarde fora do Railway/Firebase
(ex.: HD externo ou outro cloud):

```powershell
# usa a DATABASE_URL de produção; -Fc = formato custom comprimido (restaurável com pg_restore)
pg_dump -Fc "$env:DATABASE_URL" -f "aero-pgdump-2026-07.dump"
```

Para restaurar um dump desses (em banco NOVO, nunca por cima de produção):

```powershell
pg_restore --no-owner -d "postgresql://postgres:drill@localhost:5433/aerodrill" "aero-pgdump-2026-07.dump"
```

---

## Recuperação de desastre real (o banco de produção sumiu)

Ordem exata — não pule etapas:

1. **Calma. Não rode nada destrutivo.** O backup mais recente está no Firebase Storage
   (`backups/daily/`) — verifique no Dashboard (status do último backup) ou no console do Firebase.
2. **Crie um Postgres novo no Railway** (no mesmo projeto). NÃO reutilize/reinicialize o volume antigo
   se ele ainda existir — ele pode ser recuperável e é evidência.
3. **Aplique o schema no banco novo** (na sua máquina, com a `DATABASE_URL` do banco novo):
   ```powershell
   $env:DATABASE_URL = "<URL do Postgres novo>"
   npx prisma migrate deploy
   ```
4. **Restaure o último backup:**
   ```powershell
   node scripts/restore.js --from-storage latest --mode empty-only --allow-production
   ```
   Como o host é Railway, o script vai exigir digitar o nome do database para confirmar.
   (Se preferir validar antes: rode primeiro sem `--mode` para o dry-run.)
5. **Valide:** `node scripts/check-db-counts.js` + navegação por amostragem no sistema.
6. **Aponte o backend para o banco novo:** no Railway, serviço do backend → Variables →
   atualize `DATABASE_URL` com a URL do Postgres novo.
7. **Redeploy do backend** (o Railway redeploya ao salvar a variável; senão, force um redeploy).
8. **Confira o sistema em produção** e rode um backup manual imediatamente para reiniciar
   o ciclo (endpoint de backup manual ou aguarde o cron diário).

---

## Registro de drills executados

| Data | Executor | Backup usado | Registros | Resultado |
|------|----------|--------------|-----------|-----------|
| _preencher a cada trimestre_ | | | | |

## Nota sobre backups antigos (formato v1)

Os JSONs diarios antigos (`backup-YYYY-MM-DD.json`, formato v1) cobrem apenas 14 grupos de dados
e **nao contem** `User`, `Task`, propostas, unidades/fotos de brinquedos nem dados de WhatsApp.
Num restore `empty-only` a partir de um v1:

- E preciso passar `--skip-checksum` (v1 nao tem checksum);
- `Task` sera pulada com erro contado (FK obrigatoria para `User`, que nao existe no arquivo) — comportamento seguro e esperado;
- Apos restaurar, crie o usuario admin com `node criar-admin.js` (ou registre-se de novo).

Prefira sempre o backup v2 mais recente (`aero-backup-*.json.gz`), que cobre as 31 tabelas.

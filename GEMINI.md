# Regras Permanentes do Projeto — Sistema Operante (Aero Festas)

## 1. Idioma Obrigatório (`pt-br`)
- **Sempre pense (raciocínio interno) e responda exclusivamente em português brasileiro (`pt-br`)** em todas as interações, planos, explicações e revisões.

## 2. Integridade Absoluta do Prisma e do Banco em Produção
O banco PostgreSQL está em plena atividade e operação na empresa. Toda alteração envolvendo banco de dados ou Prisma deve seguir rigorosamente estas travas:

- **Comandos estritamente proibidos:** JAMAIS execute `prisma migrate dev`, `prisma db push`, `prisma migrate reset` ou comandos SQL destrutivos (`DROP`, `TRUNCATE`, `DELETE` sem escopo explícito e autorizado) contra o banco configurado.
- **Migrações seguras e aditivas:** Qualquer mudança em `prisma/schema.prisma` deve vir acompanhada de um arquivo `prisma/migrations/<timestamp>_<descricao>/migration.sql` **puramente aditivo, não destrutivo e retrocompatível**, pensado para rodar via `npx prisma migrate deploy` no pipeline de build sem downtime nem perda de dados.
- **Validação apenas offline:** Localmente, valide alterações de schema apenas com comandos que não modificam o banco (`npx prisma validate` e `npx prisma generate`).
- **Compatibilidade com Backup e Restore:** Garanta que novas colunas ou tabelas mantenham total compatibilidade com `services/BackupService.js` e `scripts/restore.js` (ex.: colunas novas opcionais ou com preenchimento seguro para não quebrar restauração de backups anteriores).

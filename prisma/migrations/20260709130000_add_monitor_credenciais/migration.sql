-- Acesso ao app do monitor (F1): colunas aditivas, todas nulas ou com default.
-- Monitores existentes ficam em 'sem_acesso' (nunca definiram senha).
ALTER TABLE "Monitor" ADD COLUMN "senhaHash" TEXT;
ALTER TABLE "Monitor" ADD COLUMN "acessoStatus" TEXT NOT NULL DEFAULT 'sem_acesso';
ALTER TABLE "Monitor" ADD COLUMN "acessoAprovadoPor" TEXT;
ALTER TABLE "Monitor" ADD COLUMN "acessoAprovadoEm" TIMESTAMP(3);
ALTER TABLE "Monitor" ADD COLUMN "ultimoLoginApp" TIMESTAMP(3);
ALTER TABLE "Monitor" ADD COLUMN "resetSenhaToken" TEXT;
ALTER TABLE "Monitor" ADD COLUMN "resetSenhaExpira" TIMESTAMP(3);

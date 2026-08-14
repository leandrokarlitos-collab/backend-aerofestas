-- Palavras-chave da varredura de licitação, editáveis pela tela de Prospecção.
--
-- Antes, os termos ("inflável", "pula-pula", "brinquedo", "parque"...) eram
-- constantes dentro de services/PncpService.js: acrescentar "colchão inflável"
-- ou "festa junina" exigia deploy. Agora vivem aqui; os termos de fábrica são
-- semeados na subida do servidor (idempotente) e só podem ser DESATIVADOS,
-- nunca apagados — zerar a lista faria a varredura parar de achar qualquer
-- coisa parecendo estar funcionando normalmente.
--
-- Migração puramente ADITIVA: uma tabela nova, nada existente é tocado.

-- CreateTable
CREATE TABLE "LicitacaoTermo" (
    "id" TEXT NOT NULL,
    "termo" TEXT NOT NULL,
    "forca" TEXT NOT NULL DEFAULT 'forte',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "padrao" TEXT,
    "deFabrica" BOOLEAN NOT NULL DEFAULT false,
    "criadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicitacaoTermo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LicitacaoTermo_termo_key" ON "LicitacaoTermo"("termo");

-- CreateIndex
CREATE INDEX "LicitacaoTermo_ativo_idx" ON "LicitacaoTermo"("ativo");

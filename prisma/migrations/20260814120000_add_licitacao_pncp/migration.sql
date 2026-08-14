-- Monitoramento diário de licitações no PNCP para os municípios do Tier A/B da prospecção.
--
-- Antes, os editais eram um snapshot congelado dentro de js/data/prospeccao-municipios.js:
-- edital vencido continuava aparecendo como aberto e nada novo entrava sozinho. Agora:
--   LicitacaoPncp      = cada edital com proposta em aberto capturado da API oficial;
--                        "aberto agora" é DERIVADO de dataEncerramentoProposta, não gravado.
--   LicitacaoVarredura = log de cada varredura, para a tela mostrar a data do último SUCESSO
--                        (o PNCP vive respondendo 504/429 — silêncio não pode parecer "sem edital").
--
-- Migração puramente ADITIVA: duas tabelas novas, nenhuma coluna ou dado existente é tocado.

-- CreateTable
CREATE TABLE "LicitacaoPncp" (
    "id" TEXT NOT NULL,
    "numeroControlePNCP" TEXT NOT NULL,
    "codMunicipio" TEXT NOT NULL,
    "municipioNome" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "orgaoCnpj" TEXT,
    "orgaoNome" TEXT,
    "unidadeNome" TEXT,
    "esfera" TEXT,
    "modalidadeId" INTEGER,
    "modalidadeNome" TEXT,
    "objeto" TEXT NOT NULL,
    "informacao" TEXT,
    "valorEstimado" DOUBLE PRECISION,
    "situacaoNome" TEXT,
    "srp" BOOLEAN NOT NULL DEFAULT false,
    "dataPublicacao" TIMESTAMP(3),
    "dataAberturaProposta" TIMESTAMP(3),
    "dataEncerramentoProposta" TIMESTAMP(3),
    "anoCompra" INTEGER,
    "sequencialCompra" INTEGER,
    "numeroCompra" TEXT,
    "processo" TEXT,
    "linkSistemaOrigem" TEXT,
    "linkPncp" TEXT,
    "termos" TEXT,
    "forca" TEXT NOT NULL DEFAULT 'fraco',
    "descartado" BOOLEAN NOT NULL DEFAULT false,
    "descartadoPor" TEXT,
    "notificadoEm" TIMESTAMP(3),
    "vistoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sumiuEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicitacaoPncp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicitacaoVarredura" (
    "id" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'executando',
    "municipiosAlvo" INTEGER NOT NULL DEFAULT 0,
    "municipiosOk" INTEGER NOT NULL DEFAULT 0,
    "municipiosFalha" INTEGER NOT NULL DEFAULT 0,
    "consultas" INTEGER NOT NULL DEFAULT 0,
    "itensLidos" INTEGER NOT NULL DEFAULT 0,
    "novos" INTEGER NOT NULL DEFAULT 0,
    "atualizados" INTEGER NOT NULL DEFAULT 0,
    "sumidos" INTEGER NOT NULL DEFAULT 0,
    "notificados" INTEGER NOT NULL DEFAULT 0,
    "municipioAtual" TEXT,
    "erro" TEXT,
    "iniciadoPor" TEXT,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),
    "duracaoMs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LicitacaoVarredura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LicitacaoPncp_numeroControlePNCP_key" ON "LicitacaoPncp"("numeroControlePNCP");

-- CreateIndex
CREATE INDEX "LicitacaoPncp_codMunicipio_idx" ON "LicitacaoPncp"("codMunicipio");

-- CreateIndex
CREATE INDEX "LicitacaoPncp_descartado_dataEncerramentoProposta_idx" ON "LicitacaoPncp"("descartado", "dataEncerramentoProposta");

-- CreateIndex
CREATE INDEX "LicitacaoPncp_dataEncerramentoProposta_idx" ON "LicitacaoPncp"("dataEncerramentoProposta");

-- CreateIndex
CREATE INDEX "LicitacaoVarredura_status_concluidoEm_idx" ON "LicitacaoVarredura"("status", "concluidoEm");

-- CreateIndex
CREATE INDEX "LicitacaoVarredura_iniciadoEm_idx" ON "LicitacaoVarredura"("iniciadoEm");

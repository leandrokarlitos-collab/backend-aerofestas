-- Funil de prospecção das prefeituras de GO (secretarias de assistência social).
-- Só o ANDAMENTO do contato vive no banco; os dados-base dos 246 municípios
-- (população, distância, orçamento, contatos) são snapshot estático no frontend
-- (js/data/prospeccao-go.js).
-- Migração puramente ADITIVA (tabela nova) — não toca em nenhum dado existente.

-- CreateTable
CREATE TABLE "ProspeccaoPrefeitura" (
    "cod" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'nao_contatado',
    "nota" TEXT,
    "canais" TEXT,
    "contatosEdit" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspeccaoPrefeitura_pkey" PRIMARY KEY ("cod")
);

-- Valor do contrato fechado na prospecção de prefeituras.
-- O funil tinha o status "fechado" mas não registrava QUANTO o contrato rendeu —
-- sem isso não há como medir o retorno do módulo. Migração puramente ADITIVA.

-- AlterTable
ALTER TABLE "ProspeccaoPrefeitura" ADD COLUMN "valorFechado" DOUBLE PRECISION;

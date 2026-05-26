-- Aditivo: adiciona array de estados simultâneos por unidade.
-- A coluna "condition" (string) é PRESERVADA por compatibilidade — continuará
-- recebendo o "pior estado" do array via aplicação.

-- 1) Adiciona a nova coluna com default vazio
ALTER TABLE "ToyUnit"
    ADD COLUMN IF NOT EXISTS "conditions" TEXT[] NOT NULL DEFAULT '{}';

-- 2) Backfill: copia o valor atual de "condition" para "conditions"
--    Apenas para linhas em que "conditions" ainda está vazio (idempotente).
UPDATE "ToyUnit"
SET "conditions" = ARRAY["condition"]
WHERE ("conditions" IS NULL OR cardinality("conditions") = 0)
  AND "condition" IS NOT NULL
  AND "condition" <> '';

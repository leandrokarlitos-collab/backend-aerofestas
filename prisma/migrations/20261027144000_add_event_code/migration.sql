-- AlterTable
ALTER TABLE "Event" ADD COLUMN "code" INTEGER;

-- Preenche códigos sequenciais (a partir de 1001) nos eventos existentes em ordem cronológica (exceto reuniões)
WITH ordered AS (
    SELECT "id", (1000 + ROW_NUMBER() OVER (ORDER BY "date" ASC, "id" ASC))::INTEGER AS next_code
    FROM "Event"
    WHERE "code" IS NULL AND COALESCE("eventType", 'event') <> 'meeting'
)
UPDATE "Event" AS e
SET "code" = ordered.next_code
FROM ordered
WHERE e."id" = ordered."id";

-- CreateIndex
CREATE UNIQUE INDEX "Event_code_key" ON "Event"("code");

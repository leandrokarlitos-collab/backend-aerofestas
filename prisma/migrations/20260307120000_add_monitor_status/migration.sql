-- AlterTable
ALTER TABLE "Monitor" ADD COLUMN "status" TEXT DEFAULT 'reserva';

-- Set existing monitors to 'ativo' (retrocompatibilidade)
UPDATE "Monitor" SET "status" = 'ativo' WHERE "status" IS NULL;

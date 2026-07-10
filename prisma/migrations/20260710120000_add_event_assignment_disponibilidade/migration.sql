-- F2: escala estruturada de monitores (EventAssignment) + disponibilidade em tempo real.
-- Migração puramente ADITIVA (nova tabela + colunas nulas/com default) — sem perda de dados.

-- CreateTable
CREATE TABLE "EventAssignment" (
    "id" SERIAL NOT NULL,
    "eventId" DOUBLE PRECISION NOT NULL,
    "monitorId" TEXT NOT NULL,
    "papel" TEXT NOT NULL DEFAULT 'monitor',
    "dia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventAssignment_eventId_idx" ON "EventAssignment"("eventId");

-- CreateIndex
CREATE INDEX "EventAssignment_monitorId_idx" ON "EventAssignment"("monitorId");

-- AddForeignKey
ALTER TABLE "EventAssignment" ADD CONSTRAINT "EventAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAssignment" ADD CONSTRAINT "EventAssignment_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Monitor" ADD COLUMN "disponivelAgora" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Monitor" ADD COLUMN "disponivelDesde" TIMESTAMP(3);

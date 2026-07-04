-- CRM v3 (F5) — migração ADITIVA: só ADD COLUMN e CREATE TABLE, nada é alterado/removido

-- AlterTable: campos ricos do Client (antes só no localStorage do navegador)
ALTER TABLE "Client" ADD COLUMN "email" TEXT;
ALTER TABLE "Client" ADD COLUMN "instagram" TEXT;
ALTER TABLE "Client" ADD COLUMN "birthday" TEXT;
ALTER TABLE "Client" ADD COLUMN "stage" TEXT DEFAULT 'novo';
ALTER TABLE "Client" ADD COLUMN "source" TEXT;
ALTER TABLE "Client" ADD COLUMN "tags" TEXT;
ALTER TABLE "Client" ADD COLUMN "lastContactAt" TIMESTAMP(3);

-- CreateTable: notas do cliente
CREATE TABLE "ClientNote" (
    "id" TEXT NOT NULL,
    "clientId" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable: follow-ups do cliente
CREATE TABLE "ClientFollowUp" (
    "id" TEXT NOT NULL,
    "clientId" DOUBLE PRECISION NOT NULL,
    "dueDate" TEXT NOT NULL,
    "note" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientNote_clientId_idx" ON "ClientNote"("clientId");
CREATE INDEX "ClientFollowUp_clientId_done_idx" ON "ClientFollowUp"("clientId", "done");
CREATE INDEX "ClientFollowUp_done_dueDate_idx" ON "ClientFollowUp"("done", "dueDate");

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientFollowUp" ADD CONSTRAINT "ClientFollowUp_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

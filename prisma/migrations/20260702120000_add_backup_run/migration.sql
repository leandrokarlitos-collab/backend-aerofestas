-- CreateTable (aditiva — não toca em nenhuma tabela existente)
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'backup',
    "source" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "message" TEXT,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "counts" TEXT,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "storagePath" TEXT,
    "durable" BOOLEAN NOT NULL DEFAULT false,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRun_createdAt_idx" ON "BackupRun"("createdAt");

-- CreateIndex
CREATE INDEX "BackupRun_type_createdAt_idx" ON "BackupRun"("type", "createdAt");

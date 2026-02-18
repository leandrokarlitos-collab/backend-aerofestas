-- CreateTable
CREATE TABLE "WhatsAppStatus" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "participant" TEXT,
    "pushName" TEXT,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "content" TEXT,
    "mediaUrl" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppStatus_instanceId_timestamp_idx" ON "WhatsAppStatus"("instanceId", "timestamp");

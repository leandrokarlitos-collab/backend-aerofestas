-- AlterTable
ALTER TABLE "WhatsAppMessage" ADD COLUMN "mediaName" TEXT,
ADD COLUMN "mediaMimetype" TEXT;

-- CreateTable
CREATE TABLE "WhatsAppShortcut" (
    "id" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "instanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppShortcut_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppShortcut_command_key" ON "WhatsAppShortcut"("command");

-- AddForeignKey
ALTER TABLE "WhatsAppShortcut" ADD CONSTRAINT "WhatsAppShortcut_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsAppInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: WhatsAppConversation - add mute/group fields
ALTER TABLE "WhatsAppConversation" ADD COLUMN "isMuted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WhatsAppConversation" ADD COLUMN "mutedUntil" TIMESTAMP(3);
ALTER TABLE "WhatsAppConversation" ADD COLUMN "isGroup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WhatsAppConversation" ADD COLUMN "groupMetadata" TEXT;

-- AlterTable: WhatsAppMessage - add pushName for group messages
ALTER TABLE "WhatsAppMessage" ADD COLUMN "pushName" TEXT;

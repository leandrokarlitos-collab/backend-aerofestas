-- AlterTable
ALTER TABLE "Event" ADD COLUMN "signedAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN "signedName" TEXT;
ALTER TABLE "Event" ADD COLUMN "signedIp" TEXT;
ALTER TABLE "Event" ADD COLUMN "signedUserAgent" TEXT;

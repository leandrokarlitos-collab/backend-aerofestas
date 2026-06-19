-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "signalReceiptUrl" TEXT;
ALTER TABLE "Event" ADD COLUMN     "finalReceiptUrl" TEXT;
ALTER TABLE "Event" ADD COLUMN     "paymentScheduled" BOOLEAN DEFAULT false;
ALTER TABLE "Event" ADD COLUMN     "scheduledPaymentDate" TEXT;
ALTER TABLE "Event" ADD COLUMN     "scheduledPaymentReason" TEXT;
ALTER TABLE "Event" ADD COLUMN     "scheduledPaymentNotified" BOOLEAN DEFAULT false;

-- AlterTable
ALTER TABLE "ToyPhoto" ADD COLUMN "eventId" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "ToyPhoto_eventId_idx" ON "ToyPhoto"("eventId");

-- AddForeignKey
ALTER TABLE "ToyPhoto" ADD CONSTRAINT "ToyPhoto_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

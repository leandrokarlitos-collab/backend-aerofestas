-- CreateTable
CREATE TABLE "EventExternalRental" (
    "id" SERIAL NOT NULL,
    "eventId" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "supplier" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "cost" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventExternalRental_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventExternalRental_eventId_idx" ON "EventExternalRental"("eventId");

-- AddForeignKey
ALTER TABLE "EventExternalRental" ADD CONSTRAINT "EventExternalRental_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

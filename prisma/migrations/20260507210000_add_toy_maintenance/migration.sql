-- CreateTable
CREATE TABLE "ToyMaintenance" (
    "id" SERIAL NOT NULL,
    "toyId" DOUBLE PRECISION NOT NULL,
    "unitNumber" INTEGER,
    "date" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cost" DOUBLE PRECISION,
    "monitorId" TEXT,
    "monitorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ToyMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToyMaintenance_toyId_idx" ON "ToyMaintenance"("toyId");

-- CreateIndex
CREATE INDEX "ToyMaintenance_date_idx" ON "ToyMaintenance"("date");

-- AddForeignKey
ALTER TABLE "ToyMaintenance" ADD CONSTRAINT "ToyMaintenance_toyId_fkey" FOREIGN KEY ("toyId") REFERENCES "Toy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToyMaintenance" ADD CONSTRAINT "ToyMaintenance_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

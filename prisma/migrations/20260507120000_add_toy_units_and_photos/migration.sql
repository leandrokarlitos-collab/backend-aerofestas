-- CreateTable
CREATE TABLE "ToyUnit" (
    "id" SERIAL NOT NULL,
    "toyId" DOUBLE PRECISION NOT NULL,
    "unitNumber" INTEGER NOT NULL,
    "condition" TEXT NOT NULL DEFAULT 'OK',
    "conditionDetails" TEXT,
    "conditionUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conditionUpdatedBy" TEXT,

    CONSTRAINT "ToyUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToyPhoto" (
    "id" SERIAL NOT NULL,
    "toyId" DOUBLE PRECISION NOT NULL,
    "url" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToyPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToyUnit_toyId_idx" ON "ToyUnit"("toyId");

-- CreateIndex
CREATE UNIQUE INDEX "ToyUnit_toyId_unitNumber_key" ON "ToyUnit"("toyId", "unitNumber");

-- CreateIndex
CREATE INDEX "ToyPhoto_toyId_idx" ON "ToyPhoto"("toyId");

-- AddForeignKey
ALTER TABLE "ToyUnit" ADD CONSTRAINT "ToyUnit_toyId_fkey" FOREIGN KEY ("toyId") REFERENCES "Toy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToyPhoto" ADD CONSTRAINT "ToyPhoto_toyId_fkey" FOREIGN KEY ("toyId") REFERENCES "Toy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

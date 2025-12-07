-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "price" DOUBLE PRECISION,
ADD COLUMN     "startTime" TEXT,
ADD COLUMN     "status" TEXT,
ADD COLUMN     "yourCompanyId" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Company" (
    "id" DOUBLE PRECISION NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "paymentInfo" TEXT,
    "repName" TEXT,
    "repDoc" TEXT,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_yourCompanyId_fkey" FOREIGN KEY ("yourCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

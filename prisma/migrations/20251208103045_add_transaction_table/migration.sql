-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "category" TEXT,
    "paymentMethod" TEXT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

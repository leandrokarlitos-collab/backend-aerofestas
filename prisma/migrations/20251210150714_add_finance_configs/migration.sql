-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "agency" TEXT,
    "number" TEXT,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedExpense" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "recurrenceType" TEXT NOT NULL DEFAULT 'permanente',
    "startDate" TEXT,
    "installments" INTEGER,
    "attachments" TEXT,

    CONSTRAINT "FixedExpense_pkey" PRIMARY KEY ("id")
);

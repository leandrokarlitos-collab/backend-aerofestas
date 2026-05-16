-- AlterTable
ALTER TABLE "Toy" ADD COLUMN "defaultPrice" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PropostaTemplate" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "heroEyebrow" TEXT NOT NULL,
    "heroTitle" TEXT NOT NULL,
    "heroSubtitle" TEXT NOT NULL,
    "brandPillText" TEXT,
    "whyCards" TEXT NOT NULL,
    "faq" TEXT,
    "howItWorks" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "whatsappMessage" TEXT NOT NULL,
    "ogImageUrl" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropostaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposta" (
    "id" DOUBLE PRECISION NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT DEFAULT 'draft',
    "clientName" TEXT NOT NULL,
    "clientId" DOUBLE PRECISION,
    "clientPhone" TEXT,
    "eventTitle" TEXT,
    "eventDate" TEXT,
    "eventTime" TEXT,
    "eventLocation" TEXT,
    "eventDetails" TEXT,
    "showPrices" BOOLEAN NOT NULL DEFAULT false,
    "discountType" TEXT,
    "discountValue" DOUBLE PRECISION,
    "subtotal" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "observacoes" TEXT,
    "templateId" TEXT,
    "heroEyebrow" TEXT,
    "heroTitle" TEXT,
    "heroSubtitle" TEXT,
    "whatsappNumber" TEXT,
    "whatsappMessage" TEXT,
    "brandPillText" TEXT,
    "whyCards" TEXT,
    "faq" TEXT,
    "howItWorks" TEXT,
    "ogImageUrl" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "viewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Proposta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropostaItem" (
    "id" SERIAL NOT NULL,
    "propostaId" DOUBLE PRECISION NOT NULL,
    "toyId" DOUBLE PRECISION,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION,
    "order" INTEGER NOT NULL DEFAULT 0,
    "toyNameSnapshot" TEXT,
    "toyImageSnapshot" TEXT,

    CONSTRAINT "PropostaItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropostaTemplate_isDefault_idx" ON "PropostaTemplate"("isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "Proposta_slug_key" ON "Proposta"("slug");

-- CreateIndex
CREATE INDEX "Proposta_slug_idx" ON "Proposta"("slug");

-- CreateIndex
CREATE INDEX "Proposta_createdAt_idx" ON "Proposta"("createdAt");

-- CreateIndex
CREATE INDEX "Proposta_clientId_idx" ON "Proposta"("clientId");

-- CreateIndex
CREATE INDEX "PropostaItem_propostaId_idx" ON "PropostaItem"("propostaId");

-- AddForeignKey
ALTER TABLE "Proposta" ADD CONSTRAINT "Proposta_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposta" ADD CONSTRAINT "Proposta_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PropostaTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropostaItem" ADD CONSTRAINT "PropostaItem_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "Proposta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropostaItem" ADD CONSTRAINT "PropostaItem_toyId_fkey" FOREIGN KEY ("toyId") REFERENCES "Toy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

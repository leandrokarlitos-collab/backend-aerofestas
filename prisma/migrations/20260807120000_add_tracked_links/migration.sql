-- Encurtador próprio e rastreável (substitui o Bitly): links /r/<slug>, histórico de
-- trocas de destino e um registro por acesso/scan do QR.
-- Migração puramente ADITIVA (3 tabelas novas) — sem perda de dados.

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedLinkChange" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "fromUrl" TEXT,
    "toUrl" TEXT NOT NULL,
    "changedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedLinkChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedLinkHit" (
    "id" SERIAL NOT NULL,
    "linkId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "visitorId" TEXT,
    "isReturning" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "ipVersion" TEXT,
    "asn" TEXT,
    "network" TEXT,
    "country" TEXT,
    "countryName" TEXT,
    "region" TEXT,
    "city" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geoTimezone" TEXT,
    "userAgent" TEXT,
    "deviceType" TEXT,
    "os" TEXT,
    "osVersion" TEXT,
    "browser" TEXT,
    "browserVersion" TEXT,
    "inApp" TEXT,
    "screenW" INTEGER,
    "screenH" INTEGER,
    "dpr" DOUBLE PRECISION,
    "language" TEXT,
    "tzName" TEXT,
    "tzOffsetMin" INTEGER,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "destination" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedLinkHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_slug_key" ON "TrackedLink"("slug");

-- CreateIndex
CREATE INDEX "TrackedLink_slug_idx" ON "TrackedLink"("slug");

-- CreateIndex
CREATE INDEX "TrackedLinkChange_linkId_createdAt_idx" ON "TrackedLinkChange"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackedLinkHit_linkId_createdAt_idx" ON "TrackedLinkHit"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackedLinkHit_slug_createdAt_idx" ON "TrackedLinkHit"("slug", "createdAt");

-- CreateIndex
CREATE INDEX "TrackedLinkHit_visitorId_idx" ON "TrackedLinkHit"("visitorId");

-- AddForeignKey
ALTER TABLE "TrackedLinkChange" ADD CONSTRAINT "TrackedLinkChange_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "TrackedLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedLinkHit" ADD CONSTRAINT "TrackedLinkHit_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "TrackedLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

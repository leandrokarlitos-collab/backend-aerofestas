-- CreateTable
CREATE TABLE "PropostaTrack" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "visitor" TEXT,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "scrollPct" INTEGER,
    "durationMs" INTEGER,
    "referrer" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "city" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropostaTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropostaTrack_slug_createdAt_idx" ON "PropostaTrack"("slug", "createdAt");

-- CreateIndex
CREATE INDEX "PropostaTrack_slug_sessionId_idx" ON "PropostaTrack"("slug", "sessionId");

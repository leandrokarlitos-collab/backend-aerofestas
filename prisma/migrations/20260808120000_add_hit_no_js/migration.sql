-- Pixel do <noscript> do r.html: marca os acessos registrados por visitantes
-- com JavaScript desligado (o POST de telemetria nunca dispara nesses casos).
-- Migração puramente ADITIVA (1 coluna nova com DEFAULT) — sem perda de dados.

-- AlterTable
ALTER TABLE "TrackedLinkHit" ADD COLUMN "noJs" BOOLEAN NOT NULL DEFAULT false;

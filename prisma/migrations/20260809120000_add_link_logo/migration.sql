-- Logo editável no centro do QR: cada link pode guardar a própria logo como
-- data URL base64 (PNG/JPEG/WebP, redimensionada no cliente para até 512x512).
-- NULL = usa a logo padrão do sistema (./icons/icon-512.png).
-- Migração puramente ADITIVA (1 coluna nova, opcional) — sem perda de dados.

-- AlterTable
ALTER TABLE "TrackedLink" ADD COLUMN "logoDataUrl" TEXT;

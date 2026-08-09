-- Estilo visual do QR de cada link (formato dos pontos/cantos, cores e cartão),
-- gravado como JSON canônico re-serializado pelo backend a partir de uma
-- whitelist estrita — nunca o texto cru do cliente.
-- NULL = QR padrão (pontos pretos quadrados sobre fundo branco).
-- Migração puramente ADITIVA (1 coluna nova, opcional) — sem perda de dados.

-- AlterTable
ALTER TABLE "TrackedLink" ADD COLUMN "qrStyle" TEXT;

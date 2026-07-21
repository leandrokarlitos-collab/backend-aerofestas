-- Pedido de alteração de data/horário feito pelo cliente no link público de cadastro.
-- Guarda o "de → para" em texto para o vendedor conferir antes de aceitar. Aditivo.
ALTER TABLE "Event" ADD COLUMN "clientChangeNote" TEXT;

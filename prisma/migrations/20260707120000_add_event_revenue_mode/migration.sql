-- Aditiva: modo de recebimento do evento multi-dia.
-- 'perDay' (rateio por dia entre os meses, padrão) | 'upfront' (valor inteiro no mês de início).
-- NULL é tratado como 'perDay' pela aplicação (compatível com o comportamento atual).
ALTER TABLE "Event" ADD COLUMN "revenueMode" TEXT;

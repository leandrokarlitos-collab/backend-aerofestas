-- Monitor: origem do cadastro ("como chegou") e quem indicou; PagamentoMonitor: nº de indicações

-- Como o monitor chegou até nós: "indicacao" | "outro" (nulo nos cadastros antigos).
ALTER TABLE "Monitor" ADD COLUMN "comoChegou" TEXT;

-- Nome de quem indicou (preenchido apenas quando comoChegou = "indicacao").
ALTER TABLE "Monitor" ADD COLUMN "indicadoPor" TEXT;

-- Dias e turnos disponíveis para trabalhar. JSON: { dias: [...], turnos: [...] }.
ALTER TABLE "Monitor" ADD COLUMN "disponibilidade" TEXT;

-- Nº de indicações pagas neste lançamento (R$ 20,00 por indicação, somado ao total).
-- Coluna NOT NULL com DEFAULT: linhas existentes recebem 0 automaticamente.
ALTER TABLE "PagamentoMonitor" ADD COLUMN "indicacoes" INTEGER NOT NULL DEFAULT 0;

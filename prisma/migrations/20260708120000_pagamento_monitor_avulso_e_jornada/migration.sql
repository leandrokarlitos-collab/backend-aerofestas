-- PagamentoMonitor: permitir lançamento avulso (monitor não-cadastrado) e jornada configurável

-- monitorId passa a ser opcional (null = monitor avulso, sem cadastro).
-- A FK existente (ON DELETE CASCADE) continua válida e simplesmente ignora valores NULL.
ALTER TABLE "PagamentoMonitor" ALTER COLUMN "monitorId" DROP NOT NULL;

-- Tamanho da jornada (horas) coberta pela diária, usada no cálculo de hora extra (padrão 11h).
ALTER TABLE "PagamentoMonitor" ADD COLUMN "horasDiaria" DOUBLE PRECISION DEFAULT 11;

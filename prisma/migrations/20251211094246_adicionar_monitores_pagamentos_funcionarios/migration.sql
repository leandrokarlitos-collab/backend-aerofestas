-- DropForeignKey
ALTER TABLE "Desempenho" DROP CONSTRAINT "Desempenho_monitorId_fkey";

-- AlterTable
ALTER TABLE "Desempenho" ADD COLUMN     "pagamentoId" TEXT;

-- AlterTable
ALTER TABLE "Monitor" ADD COLUMN     "fotoDocumento" TEXT,
ADD COLUMN     "habilidades" TEXT,
ADD COLUMN     "observacoes" TEXT;

-- CreateTable
CREATE TABLE "PagamentoMonitor" (
    "id" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "valorBase" DOUBLE PRECISION NOT NULL,
    "adicional" DOUBLE PRECISION NOT NULL,
    "horasExtras" DOUBLE PRECISION NOT NULL,
    "pagamento" DOUBLE PRECISION NOT NULL,
    "statusPagamento" TEXT NOT NULL DEFAULT 'Executado',
    "horaEntrada" TEXT,
    "horaSaida" TEXT,
    "numEventos" DOUBLE PRECISION,

    CONSTRAINT "PagamentoMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Funcionario" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "salarioFixo" DOUBLE PRECISION NOT NULL,
    "va" DOUBLE PRECISION NOT NULL,
    "vt" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Funcionario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaixaComissao" (
    "id" TEXT NOT NULL,
    "ateValor" DOUBLE PRECISION NOT NULL,
    "percentual" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "FaixaComissao_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Desempenho" ADD CONSTRAINT "Desempenho_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoMonitor" ADD CONSTRAINT "PagamentoMonitor_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

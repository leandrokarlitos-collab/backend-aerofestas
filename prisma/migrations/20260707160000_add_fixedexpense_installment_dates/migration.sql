-- Aditiva: datas de vencimento por parcela de uma conta fixa parcelada.
-- JSON com ["YYYY-MM-DD", ...]. NULL = comportamento antigo (mesmo dia todo mês via startDate/dueDay).
ALTER TABLE "FixedExpense" ADD COLUMN "installmentDates" TEXT;

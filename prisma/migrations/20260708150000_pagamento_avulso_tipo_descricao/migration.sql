-- PagamentoMonitor: pagamentos avulsos (não-diária) com descrição

-- tipo do pagamento: 'diaria' (padrão, retrocompatível) ou 'avulso' (não corresponde a uma diária).
-- Coluna NOT NULL com DEFAULT: linhas existentes são preenchidas automaticamente com 'diaria'.
ALTER TABLE "PagamentoMonitor" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'diaria';

-- Descrição livre do pagamento (do que se trata). Usada principalmente em pagamentos avulsos.
ALTER TABLE "PagamentoMonitor" ADD COLUMN "descricao" TEXT;

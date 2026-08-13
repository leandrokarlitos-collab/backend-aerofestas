-- Acompanhamento do funil de prospecção:
--   problemas       = por que não alcançamos a prefeitura (telefone morto, não atende,
--                     WhatsApp sem resposta...) — distingue "não liguei" de "liguei e não deu"
--   proximoContato  = data de retorno combinada; alimenta o painel "vence hoje / atrasados"
--   jaAtendemos     = marcação manual de prefeitura que já foi cliente (histórico fora do CRM)
-- Migração puramente ADITIVA (3 colunas opcionais) — sem perda de dados.

-- AlterTable
ALTER TABLE "ProspeccaoPrefeitura" ADD COLUMN "problemas" TEXT;
ALTER TABLE "ProspeccaoPrefeitura" ADD COLUMN "proximoContato" TIMESTAMP(3);
ALTER TABLE "ProspeccaoPrefeitura" ADD COLUMN "jaAtendemos" BOOLEAN NOT NULL DEFAULT false;

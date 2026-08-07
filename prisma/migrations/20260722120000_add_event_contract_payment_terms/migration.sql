-- Condições de pagamento que o vendedor escreve no link de cadastro (ou na edição do evento).
-- Texto PÚBLICO: entra na CLÁUSULA QUARTA do contrato que o cliente lê e assina.
-- Coluna nova de propósito: "paymentDetails" continua sendo recado interno (O.S./card) e o
-- que já está gravado lá não pode vazar para dentro de um contrato. Aditivo.
ALTER TABLE "Event" ADD COLUMN "contractPaymentTerms" TEXT;

-- Versão da redação do contrato. Propositalmente SEM default: as linhas existentes ficam NULL e
-- continuam renderizando o texto antigo, para que nenhum contrato já assinado mude de teor.
-- Eventos novos são carimbados com a versão vigente pelo EventService.
ALTER TABLE "Event" ADD COLUMN "contractTemplateVersion" INTEGER;

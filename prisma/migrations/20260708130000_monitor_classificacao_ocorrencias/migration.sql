-- Monitor: classificação avançada (status Alerta/Desqualificado) e ocorrências

-- Observação da classificação, evidenciada no card para status alerta/desqualificado.
ALTER TABLE "Monitor" ADD COLUMN "statusMotivo" TEXT;

-- JSON array com tags de ocorrência (atraso, celular, proatividade, etc.).
ALTER TABLE "Monitor" ADD COLUMN "ocorrencias" TEXT;

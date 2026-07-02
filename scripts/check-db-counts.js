// Lê o estado atual do banco. NÃO altera nada (somente leitura).
// Cobre os 31 modelos do backup v2, na mesma ordem topológica de TABLES.
// Uso: node scripts/check-db-counts.js
// Funciona com qualquer DATABASE_URL (produção ou banco de drill):
//   - variável de ambiente do shell tem precedência; senão, usa o .env da raiz.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = require('../prisma/client');
const { TABLES } = require('../services/BackupService');

(async () => {
    // Conta SEQUENCIALMENTE com 1 retry por tabela: o pool do Prisma é pequeno
    // (connection_limit=5) e 31 counts em paralelo contra o proxy do Railway
    // geram falhas transitórias que assustariam o operador num drill.
    const counts = [];
    for (const { delegate } of TABLES) {
        let resultado;
        try {
            resultado = await prisma[delegate].count();
        } catch (err1) {
            try {
                resultado = await prisma[delegate].count();
            } catch (err2) {
                resultado = { erro: err2.message };
            }
        }
        counts.push(resultado);
    }

    const larguraModelo = Math.max(...TABLES.map(t => t.model.length), 'Modelo'.length);
    const larguraNum = 12;

    const linhaSep = '-'.repeat(larguraModelo) + '-+-' + '-'.repeat(larguraNum);
    console.log('Modelo'.padEnd(larguraModelo) + ' | ' + 'Registros'.padStart(larguraNum));
    console.log(linhaSep);

    let total = 0;
    let falhas = 0;

    TABLES.forEach(({ model }, i) => {
        const resultado = counts[i];
        let texto;
        if (typeof resultado === 'number') {
            total += resultado;
            texto = resultado.toLocaleString('pt-BR').padStart(larguraNum);
        } else {
            falhas++;
            texto = ('ERRO: ' + resultado.erro).slice(0, 60);
        }
        console.log(model.padEnd(larguraModelo) + ' | ' + texto);
    });

    console.log(linhaSep);
    console.log('TOTAL'.padEnd(larguraModelo) + ' | ' + total.toLocaleString('pt-BR').padStart(larguraNum));
    if (falhas > 0) {
        console.log(`\nAtenção: ${falhas} tabela(s) com erro de contagem (schema divergente?).`);
    }
    console.log(`\n${TABLES.length} modelos verificados.`);

    await prisma.$disconnect();
    if (falhas > 0) process.exit(2);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

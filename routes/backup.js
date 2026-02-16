const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

// Status do último backup (mantido em memória)
let lastBackupStatus = {
    success: null,
    timestamp: null,
    message: null,
    recordCount: 0
};

// Diretório de backups no servidor
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const MAX_BACKUPS = 7;

// Garante que o diretório de backups existe
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Coleta todos os dados do banco para backup
 */
async function collectAllData() {
    const [
        eventos,
        clientes,
        empresas,
        brinquedos,
        monitores,
        transacoes,
        contasBancarias,
        contasFixas,
        funcionarios,
        faixasComissao,
        tarefas,
        planosDiarios,
        categoriasGastos,
        categoriasFixas
    ] = await Promise.all([
        prisma.event.findMany({ include: { items: { include: { toy: true } }, company: true }, orderBy: { date: 'desc' } }),
        prisma.client.findMany({ orderBy: { name: 'asc' } }),
        prisma.company.findMany({ orderBy: { name: 'asc' } }),
        prisma.toy.findMany({ orderBy: { name: 'asc' } }),
        prisma.monitor.findMany({ include: { desempenho: true, pagamentos: true } }),
        prisma.transaction.findMany({ orderBy: { date: 'desc' } }),
        prisma.bankAccount.findMany({ orderBy: { name: 'asc' } }),
        prisma.fixedExpense.findMany({ orderBy: { dueDay: 'asc' } }),
        prisma.funcionario.findMany(),
        prisma.faixaComissao.findMany(),
        prisma.task.findMany(),
        prisma.dailyPlan.findMany({ orderBy: { date: 'desc' } }),
        prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } }),
        prisma.fixedExpenseCategory.findMany({ orderBy: { name: 'asc' } })
    ]);

    const totalRecords = eventos.length + clientes.length + empresas.length +
        brinquedos.length + monitores.length + transacoes.length +
        contasBancarias.length + contasFixas.length + funcionarios.length +
        faixasComissao.length + tarefas.length + planosDiarios.length +
        categoriasGastos.length + categoriasFixas.length;

    return {
        metadata: {
            version: '1.0',
            timestamp: new Date().toISOString(),
            source: 'backup-sistema-operante',
            totalRecords
        },
        eventos,
        clientes,
        empresas,
        brinquedos,
        monitores,
        transacoes,
        contasBancarias,
        contasFixas,
        funcionarios,
        faixasComissao,
        tarefas,
        planosDiarios,
        categoriasGastos,
        categoriasFixas
    };
}

/**
 * Salva backup no filesystem do servidor e limpa backups antigos
 */
async function saveBackupToServer(data) {
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `backup-${dateStr}.json`;
    const filepath = path.join(BACKUP_DIR, filename);

    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');

    // Limpar backups antigos (manter apenas MAX_BACKUPS)
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
        .sort()
        .reverse();

    if (files.length > MAX_BACKUPS) {
        for (const old of files.slice(MAX_BACKUPS)) {
            fs.unlinkSync(path.join(BACKUP_DIR, old));
        }
    }

    return { filename, filepath, size: fs.statSync(filepath).size };
}

/**
 * Executa o backup completo (usado pelo cron e pela rota manual)
 */
async function runBackup(source = 'manual') {
    try {
        console.log(`📦 Iniciando backup (${source})...`);
        const data = await collectAllData();
        const result = await saveBackupToServer(data);

        lastBackupStatus = {
            success: true,
            timestamp: new Date().toISOString(),
            message: `Backup salvo: ${result.filename} (${(result.size / 1024).toFixed(1)} KB)`,
            recordCount: data.metadata.totalRecords
        };

        console.log(`✅ Backup concluído: ${result.filename} — ${data.metadata.totalRecords} registros`);
        return lastBackupStatus;
    } catch (error) {
        lastBackupStatus = {
            success: false,
            timestamp: new Date().toISOString(),
            message: `Erro no backup: ${error.message}`,
            recordCount: 0
        };
        console.error('❌ Erro no backup:', error);
        return lastBackupStatus;
    }
}

// --- ROTAS ---

// GET /api/backup/full — Download completo do backup em JSON
router.get('/full', authenticate, async (req, res) => {
    try {
        const data = await collectAllData();
        const dateStr = new Date().toISOString().split('T')[0];

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="backup-aero-festas-${dateStr}.json"`);
        res.json(data);
    } catch (error) {
        console.error('Erro ao gerar backup:', error);
        res.status(500).json({ error: 'Erro ao gerar backup', details: error.message });
    }
});

// POST /api/backup/run — Executa backup no servidor manualmente
router.post('/run', authenticate, async (req, res) => {
    try {
        const result = await runBackup('manual');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao executar backup', details: error.message });
    }
});

// GET /api/backup/status — Retorna status do último backup
router.get('/status', authenticate, async (req, res) => {
    res.json(lastBackupStatus);
});

module.exports = { router, runBackup };

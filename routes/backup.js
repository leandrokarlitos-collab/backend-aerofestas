/**
 * Rotas de backup — camada HTTP FINA sobre services/BackupService.js
 * (Sistema de Segurança de Dados v3 — Aero Festas)
 *
 * Toda a lógica (coleta, gzip, criptografia, upload, verificação, retenção,
 * status persistido) vive no BackupService. Aqui só: auth admin, parse de
 * query e tradução de erros para HTTP.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../prisma/client');
const { isAdmin } = require('../middleware/auth');
const BackupService = require('../services/BackupService');

// GET /api/backup/full — backup completo em JSON PURO via res.json.
// O Dashboard re-serializa a resposta para gerar o download local no browser —
// por isso NÃO servir gzip nem Content-Disposition de anexo aqui.
router.get('/full', isAdmin, async (req, res) => {
    try {
        res.json(await BackupService.collectAllData({ source: 'download' }));
    } catch (err) {
        console.error('[backup] Erro em GET /full:', err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// POST /api/backup/run — executa backup manual no servidor
router.post('/run', isAdmin, async (req, res) => {
    try {
        res.json(await BackupService.runBackup('manual'));
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/backup/status — status do último backup (persistido em BackupRun)
router.get('/status', isAdmin, async (req, res) => {
    try {
        res.json(await BackupService.getStatus());
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/backup/history?limit=30 — histórico de execuções (backup/restore/drill)
router.get('/history', isAdmin, async (req, res) => {
    try {
        res.json(await BackupService.getHistory(req.query.limit || 30));
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/backup/files — lista os arquivos de backup no bucket (daily/monthly/yearly)
router.get('/files', isAdmin, async (req, res) => {
    try {
        res.json(await BackupService.listBackups());
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/backup/download?path=... — signed URL de 15 minutos para o arquivo
router.get('/download', isAdmin, async (req, res) => {
    try {
        res.json({ url: await BackupService.getDownloadUrl(req.query.path) });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/backup/restore-report?path=... — relatório READ-ONLY que compara
// as contagens do arquivo de backup com o banco atual, tabela a tabela.
// NÃO escreve NADA no banco. Aceita path=latest para o daily mais recente.
router.get('/restore-report', isAdmin, async (req, res) => {
    try {
        let storagePath = req.query.path;
        if (!storagePath) {
            const e = new Error('Parâmetro path é obrigatório (ou use path=latest)');
            e.status = 400;
            throw e;
        }
        if (storagePath === 'latest') {
            storagePath = await BackupService.resolveLatestPath();
        }

        const backup = await BackupService.downloadBackup(storagePath);
        const counts = (backup.metadata && backup.metadata.counts) || {};

        const rows = [];
        for (const { model, delegate } of BackupService.TABLES) {
            // arquivo: contagem do metadata (v2); fallback para o array da tabela;
            // null se o arquivo não tem essa tabela (ex.: backup legado v1)
            let arquivo = null;
            if (counts[model] !== undefined) {
                arquivo = counts[model];
            } else if (backup.tables && Array.isArray(backup.tables[model])) {
                arquivo = backup.tables[model].length;
            }
            rows.push({
                tabela: model,
                arquivo,
                banco: await prisma[delegate].count()
            });
        }

        res.json({ path: storagePath, generatedAt: new Date().toISOString(), rows });
    } catch (err) {
        console.error('[backup] Erro em GET /restore-report:', err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/backup/diag — diagnóstico TEMPORÁRIO da conectividade com o Google
// (investigação do "Premature close" no token OAuth). Remover quando resolvido.
router.get('/diag', isAdmin, async (req, res) => {
    const https = require('https');
    const diag = {
        nodeVersion: process.version,
        proxyEnv: {
            HTTP_PROXY: process.env.HTTP_PROXY || null,
            HTTPS_PROXY: process.env.HTTPS_PROXY || null,
            http_proxy: process.env.http_proxy || null,
            https_proxy: process.env.https_proxy || null,
            NO_PROXY: process.env.NO_PROXY || null,
        },
        rawHttps: null,
        bucketExists: null,
    };

    // Teste 1: https cru (módulo nativo) até o host do token OAuth
    diag.rawHttps = await new Promise((resolve) => {
        const req2 = https.request(
            { host: 'www.googleapis.com', path: '/discovery/v1/apis', method: 'GET', timeout: 10000, family: 4 },
            (r) => {
                let bytes = 0;
                r.on('data', (c) => { bytes += c.length; });
                r.on('end', () => resolve({ ok: true, status: r.statusCode, bodyBytes: bytes }));
                r.on('error', (e) => resolve({ ok: false, fase: 'body', erro: e.message }));
            }
        );
        req2.on('timeout', () => { req2.destroy(); resolve({ ok: false, fase: 'timeout' }); });
        req2.on('error', (e) => resolve({ ok: false, fase: 'request', erro: e.message }));
        req2.end();
    });

    // Teste 2: SDK (token OAuth + metadata do bucket)
    try {
        const firebaseAdmin = require('../services/firebaseAdmin');
        const [exists] = await firebaseAdmin.getBucket().exists();
        diag.bucketExists = { ok: true, exists };
    } catch (err) {
        diag.bucketExists = { ok: false, erro: err.message };
    }

    res.json(diag);
});

// server.js (linha 18) importa { router, runBackup } daqui — reexporta o do service
module.exports = { router, runBackup: BackupService.runBackup };

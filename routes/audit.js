const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const prisma = require('../prisma/client');

/**
 * GET /api/audit/entity/:type/:id
 * Histórico completo de uma entidade específica
 */
router.get('/entity/:type/:id', authenticate, async (req, res) => {
    try {
        const { type, id } = req.params;

        const logs = await prisma.auditLog.findMany({
            where: { entityType: type, entityId: id },
            orderBy: { createdAt: 'desc' }
        });

        const formatted = logs.map(entry => {
            let changes = null;
            let snapshot = null;
            try { if (entry.changes) changes = JSON.parse(entry.changes); } catch (e) {}
            try { if (entry.snapshot) snapshot = JSON.parse(entry.snapshot); } catch (e) {}

            return {
                id: entry.id,
                action: entry.action,
                userName: entry.userName,
                userEmail: entry.userEmail,
                changes,
                snapshot,
                createdAt: entry.createdAt.toISOString()
            };
        });

        res.json(formatted);
    } catch (error) {
        console.error('Erro ao buscar histórico da entidade:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
});

/**
 * GET /api/audit/recent
 * Atividade recente com paginação
 */
router.get('/recent', authenticate, async (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;

        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                orderBy: { createdAt: 'desc' },
                skip: parseInt(offset),
                take: parseInt(limit)
            }),
            prisma.auditLog.count()
        ]);

        const formatted = logs.map(entry => {
            let snapshot = null;
            try { if (entry.snapshot) snapshot = JSON.parse(entry.snapshot); } catch (e) {}

            return {
                id: entry.id,
                entityType: entry.entityType,
                entityId: entry.entityId,
                action: entry.action,
                userName: entry.userName,
                snapshot,
                createdAt: entry.createdAt.toISOString()
            };
        });

        res.json({ logs: formatted, total, hasMore: parseInt(offset) + parseInt(limit) < total });
    } catch (error) {
        console.error('Erro ao buscar atividade recente:', error);
        res.status(500).json({ error: 'Erro ao buscar atividade' });
    }
});

module.exports = router;

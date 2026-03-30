const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/auth');
const prisma = require('../prisma/client');

/**
 * GET /api/admin/history
 * Listar histórico de auditoria com filtros e estatísticas
 * Agora lê do AuditLog (Prisma) em vez de JSON file
 */
router.get('/', isAdmin, async (req, res) => {
    try {
        const { userId, action, entityType, startDate, endDate, limit = 100, offset = 0 } = req.query;

        const where = {};
        if (userId) where.userId = userId;
        if (action) where.action = action.toUpperCase();
        if (entityType) where.entityType = entityType;
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                where.createdAt.lte = end;
            }
        }

        const [history, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: parseInt(offset),
                take: parseInt(limit)
            }),
            prisma.auditLog.count({ where })
        ]);

        // Estatísticas
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);

        const [todayCount, weekCount, createCount, updateCount, deleteCount] = await Promise.all([
            prisma.auditLog.count({ where: { ...where, createdAt: { gte: today } } }),
            prisma.auditLog.count({ where: { ...where, createdAt: { gte: weekAgo } } }),
            prisma.auditLog.count({ where: { ...where, action: 'CREATE' } }),
            prisma.auditLog.count({ where: { ...where, action: 'UPDATE' } }),
            prisma.auditLog.count({ where: { ...where, action: 'DELETE' } }),
        ]);

        // Formata para compatibilidade com o frontend existente
        const enrichedHistory = history.map(entry => {
            let parsedChanges = null;
            if (entry.changes) {
                try { parsedChanges = JSON.parse(entry.changes); } catch (e) {}
            }
            let parsedSnapshot = null;
            if (entry.snapshot) {
                try { parsedSnapshot = JSON.parse(entry.snapshot); } catch (e) {}
            }

            return {
                id: entry.id,
                timestamp: entry.createdAt.toISOString(),
                action: entry.action,
                entityType: entry.entityType,
                entityId: entry.entityId,
                details: parsedChanges || parsedSnapshot,
                targetUserInfo: {
                    id: entry.entityId,
                    name: parsedSnapshot?.name || parsedSnapshot?.clientName || parsedSnapshot?.nome || parsedSnapshot?.description || entry.entityId,
                    email: parsedSnapshot?.email || ''
                },
                changedByInfo: {
                    id: entry.userId,
                    name: entry.userName,
                    email: entry.userEmail
                }
            };
        });

        res.json({
            history: enrichedHistory,
            stats: {
                total,
                today: todayCount,
                thisWeek: weekCount,
                byAction: { create: createCount, update: updateCount, delete: deleteCount },
                mostActiveUsers: []
            },
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: parseInt(offset) + parseInt(limit) < total
            }
        });
    } catch (error) {
        console.error('Erro ao buscar histórico:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
});

module.exports = router;

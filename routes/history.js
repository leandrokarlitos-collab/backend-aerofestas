const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/auth');
const prisma = require('../prisma/client');

/**
 * GET /api/admin/history
 * Retorna lista de usuários com datas de criação como histórico básico
 */
router.get('/', isAdmin, async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                isAdmin: true,
                emailConfirmed: true,
                createdAt: true,
                updatedAt: true
            },
            orderBy: { updatedAt: 'desc' }
        });

        const history = users.map(u => ({
            id: u.id,
            userId: u.id,
            userName: u.name,
            userEmail: u.email,
            action: 'info',
            timestamp: u.updatedAt || u.createdAt,
            changes: {
                isAdmin: u.isAdmin,
                emailConfirmed: u.emailConfirmed
            }
        }));

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);

        const stats = {
            total: history.length,
            today: history.filter(h => new Date(h.timestamp) >= today).length,
            thisWeek: history.filter(h => new Date(h.timestamp) >= weekAgo).length,
            byAction: { create: history.length, update: 0, delete: 0 },
            mostActiveUsers: []
        };

        const { limit = 100, offset = 0 } = req.query;

        res.json({
            history: history.slice(parseInt(offset), parseInt(offset) + parseInt(limit)),
            stats,
            pagination: {
                total: history.length,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: parseInt(offset) + parseInt(limit) < history.length
            }
        });
    } catch (error) {
        console.error('Erro ao buscar histórico:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
});

module.exports = router;

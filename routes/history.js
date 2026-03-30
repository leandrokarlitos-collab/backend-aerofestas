const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/auth');
const fs = require('fs').promises;
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'user_history.json');

async function loadHistory() {
    try {
        const data = await fs.readFile(HISTORY_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

/**
 * GET /api/admin/history
 * Listar histórico de alterações com filtros e estatísticas
 */
router.get('/', isAdmin, async (req, res) => {
    try {
        const { userId, action, startDate, endDate, limit = 100, offset = 0 } = req.query;

        let history = await loadHistory();

        if (userId) {
            history = history.filter(h => h.targetUserId === userId || h.userId === userId);
        }
        if (action) {
            history = history.filter(h => h.action === action);
        }
        if (startDate) {
            history = history.filter(h => new Date(h.timestamp) >= new Date(startDate));
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            history = history.filter(h => new Date(h.timestamp) <= end);
        }

        // Ordena por data (mais recente primeiro)
        history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Estatísticas
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);

        const stats = {
            total: history.length,
            today: history.filter(h => new Date(h.timestamp) >= today).length,
            thisWeek: history.filter(h => new Date(h.timestamp) >= weekAgo).length,
            byAction: {
                create: history.filter(h => h.action === 'create').length,
                update: history.filter(h => h.action === 'update').length,
                delete: history.filter(h => h.action === 'delete').length
            },
            mostActiveUsers: []
        };

        // Enriquece com targetUserInfo e changedByInfo para o frontend
        const enrichedHistory = history.slice(parseInt(offset), parseInt(offset) + parseInt(limit)).map(entry => ({
            ...entry,
            targetUserInfo: {
                id: entry.targetUserId || entry.userId,
                name: entry.targetUserName || entry.userName || 'Desconhecido',
                email: entry.targetUserEmail || entry.userEmail || 'N/A'
            },
            changedByInfo: {
                id: entry.adminId || entry.changedBy,
                name: entry.adminName || entry.changedByName || 'Sistema',
                email: entry.adminEmail || ''
            }
        }));

        res.json({
            history: enrichedHistory,
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

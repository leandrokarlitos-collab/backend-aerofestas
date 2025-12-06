const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/auth');
const fs = require('fs').promises;
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'user_history.json');
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

// Carrega histórico do arquivo
async function loadHistory() {
    try {
        const data = await fs.readFile(HISTORY_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

// Carrega usuários do arquivo
async function loadUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
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
        const users = await loadUsers();

        // Aplica filtros
        if (userId) {
            history = history.filter(h => h.userId === userId);
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

        // Calcula estatísticas
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
            mostActiveUsers: {}
        };

        // Calcula usuários mais ativos
        history.forEach(entry => {
            if (entry.changedBy && entry.changedBy !== 'system') {
                const user = users.find(u => u.id === entry.changedBy);
                const userName = user ? user.name : 'Desconhecido';
                if (!stats.mostActiveUsers[entry.changedBy]) {
                    stats.mostActiveUsers[entry.changedBy] = {
                        id: entry.changedBy,
                        name: userName,
                        count: 0
                    };
                }
                stats.mostActiveUsers[entry.changedBy].count++;
            }
        });

        // Converte para array e ordena
        stats.mostActiveUsers = Object.values(stats.mostActiveUsers)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // Enriquece histórico com informações dos usuários
        const enrichedHistory = history.slice(parseInt(offset), parseInt(offset) + parseInt(limit)).map(entry => {
            const changedByUser = entry.changedBy && entry.changedBy !== 'system' 
                ? users.find(u => u.id === entry.changedBy)
                : null;
            
            const targetUser = users.find(u => u.id === entry.userId);

            return {
                ...entry,
                changedByInfo: changedByUser ? {
                    id: changedByUser.id,
                    name: changedByUser.name,
                    email: changedByUser.email
                } : null,
                targetUserInfo: targetUser ? {
                    id: targetUser.id,
                    name: targetUser.name,
                    email: targetUser.email
                } : { id: entry.userId, name: entry.userName || 'Usuário removido', email: entry.userEmail || 'N/A' }
            };
        });

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


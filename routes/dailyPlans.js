const express = require('express');
const router = express.Router();
const prisma = require('../prisma/client');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/daily-plans/:date
 * Busca o plano diário de uma data específica (YYYY-MM-DD)
 */
router.get('/:date', authenticate, async (req, res) => {
    try {
        const { date } = req.params;
        const plan = await prisma.dailyPlan.findUnique({
            where: {
                userId_date: {
                    userId: req.user.id,
                    date: date
                }
            }
        });

        if (!plan) return res.json(null);

        res.json(JSON.parse(plan.content));
    } catch (error) {
        console.error("Erro ao buscar plano diário:", error);
        res.status(500).json({ error: 'Erro ao buscar plano diário.' });
    }
});

/**
 * POST /api/daily-plans
 * Salva ou atualiza um plano diário
 */
router.post('/', authenticate, async (req, res) => {
    try {
        const { date, content } = req.body;
        if (!date || !content) return res.status(400).json({ error: 'Data e conteúdo são obrigatórios.' });

        const updatedPlan = await prisma.dailyPlan.upsert({
            where: {
                userId_date: {
                    userId: req.user.id,
                    date: date
                }
            },
            update: {
                content: JSON.stringify(content)
            },
            create: {
                userId: req.user.id,
                date: date,
                content: JSON.stringify(content)
            }
        });

        res.json(JSON.parse(updatedPlan.content));
    } catch (error) {
        console.error("Erro ao salvar plano diário:", error);
        res.status(500).json({ error: 'Erro ao salvar plano diário.' });
    }
});

/**
 * GET /api/daily-plans/history/all
 * Busca todos os planos diários do usuário (para histórico)
 */
router.get('/history/all', authenticate, async (req, res) => {
    try {
        const plans = await prisma.dailyPlan.findMany({
            where: { userId: req.user.id },
            orderBy: { date: 'desc' },
            select: { date: true, content: true }
        });

        // Formata para { "YYYY-MM-DD": content, ... }
        const history = {};
        plans.forEach(p => {
            history[p.date] = JSON.parse(p.content);
        });

        res.json(history);
    } catch (error) {
        console.error("Erro ao buscar histórico de planos:", error);
        res.status(500).json({ error: 'Erro ao buscar histórico.' });
    }
});

module.exports = router;

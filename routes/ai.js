const express = require('express');
const { authenticate } = require('../middleware/auth');
const AIService = require('../services/AIService');

const router = express.Router();

router.post('/instagram-posts', authenticate, async (req, res, next) => {
    try {
        if (!process.env.ANTHROPIC_API_KEY) {
            return res.status(503).json({
                error: 'IA não configurada. Defina ANTHROPIC_API_KEY no servidor.',
            });
        }

        const result = await AIService.generateInstagramPosts(req.body || {});
        res.json({ success: true, data: result });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ error: err.message });
        }
        if (err.status === 401 || err.name === 'AuthenticationError') {
            return res.status(503).json({ error: 'Chave da IA inválida no servidor.' });
        }
        if (err.status === 429) {
            return res.status(429).json({ error: 'Limite da IA atingido. Tente em alguns minutos.' });
        }
        console.error('[AI] Erro generate-instagram-posts:', err);
        next(err);
    }
});

module.exports = router;

const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');
const prisma = require('../prisma/client');

/**
 * Middleware para verificar autenticação JWT (gestores).
 * Tokens de monitor (role 'monitor') são rejeitados: o app do monitor
 * usa apenas /api/monitor/* — nenhuma rota de gestor pode aceitá-los.
 */
async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Token não fornecido' });
        }

        const token = authHeader.substring(7);

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded.role === 'monitor') {
                return res.status(403).json({ error: 'Acesso restrito.' });
            }
            req.user = decoded;
            next();
        } catch (error) {
            return res.status(401).json({ error: 'Token inválido ou expirado' });
        }
    } catch (error) {
        return res.status(500).json({ error: 'Erro na autenticação' });
    }
}

/**
 * Verifica (sem bloquear) se a requisição traz um token JWT válido de GESTOR.
 * Usado em rotas públicas que precisam liberar campos administrativos
 * apenas quando o chamador está autenticado. Token de monitor não conta.
 * Retorna boolean.
 */
function isAuthenticated(req) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return decoded.role !== 'monitor';
    } catch (error) {
        return false;
    }
}

/**
 * Guard das rotas /api/monitor/*: exige JWT com role 'monitor' e monitor
 * com acesso 'ativo' no banco. Checar o status a cada request dá revogação
 * instantânea: o gestor bloqueia e o próximo request cai, mesmo com JWT válido.
 */
async function authenticateMonitor(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Token não fornecido' });
        }

        let decoded;
        try {
            decoded = jwt.verify(authHeader.substring(7), process.env.JWT_SECRET);
        } catch (error) {
            return res.status(401).json({ error: 'Token inválido ou expirado' });
        }
        if (decoded.role !== 'monitor' || !decoded.monitorId) {
            return res.status(403).json({ error: 'Acesso restrito.' });
        }

        const monitor = await prisma.monitor.findUnique({ where: { id: String(decoded.monitorId) } });
        if (!monitor) {
            return res.status(401).json({ error: 'Token inválido ou expirado' });
        }
        if (monitor.acessoStatus !== 'ativo') {
            return res.status(403).json({ error: 'Acesso não liberado.' });
        }

        req.monitor = monitor;
        next();
    } catch (error) {
        return res.status(500).json({ error: 'Erro na autenticação' });
    }
}

/**
 * Middleware para verificar se o usuário é administrador
 */
function isAdmin(req, res, next) {
    // Primeiro verifica autenticação
    authenticate(req, res, () => {
        // Se chegou aqui, está autenticado
        // Verifica se é admin
        if (!req.user || !req.user.isAdmin) {
            return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
        }
        next();
    });
}

module.exports = {
    authenticate,
    isAuthenticated,
    isAdmin,
    authenticateMonitor
};


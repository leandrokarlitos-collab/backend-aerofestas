const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');

/**
 * Middleware para verificar autenticação JWT
 */
async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Token não fornecido' });
        }

        const token = authHeader.substring(7);
        
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
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
    isAdmin
};


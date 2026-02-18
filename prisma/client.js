/**
 * Singleton do PrismaClient — compartilhado por todas as rotas.
 * Evita criar múltiplos pools de conexão que esgotam o limite do PostgreSQL.
 *
 * connection_limit=20 → até 20 conexões simultâneas (plano Hobby Railway)
 * pool_timeout=20     → aguarda até 20s por uma conexão livre antes de falhar
 */
const { PrismaClient } = require('@prisma/client');

const DATABASE_URL = process.env.DATABASE_URL;

// Garante URL com parâmetros de pool mesmo se a env não tiver
function buildUrl(url) {
    if (!url) return url;
    try {
        const u = new URL(url);
        // Plano Hobby Railway: ~100 conexões disponíveis, 20 é seguro e eficiente
        if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '20');
        if (!u.searchParams.has('pool_timeout'))     u.searchParams.set('pool_timeout', '20');
        return u.toString();
    } catch {
        return url;
    }
}

const prisma = new PrismaClient({
    datasources: {
        db: { url: buildUrl(DATABASE_URL) }
    },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
});

module.exports = prisma;

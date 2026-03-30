const prisma = require('../prisma/client');
const { v4: uuidv4 } = require('uuid');

/**
 * Registra uma acao no log de auditoria.
 * Fire-and-forget: nunca quebra a operacao principal.
 */
async function logAudit({ entityType, entityId, action, user, changes, snapshot }) {
    try {
        await prisma.auditLog.create({
            data: {
                id: uuidv4(),
                entityType,
                entityId: String(entityId),
                action,
                userId: user.id,
                userName: user.name || 'Desconhecido',
                userEmail: user.email || '',
                changes: changes ? JSON.stringify(changes) : null,
                snapshot: snapshot ? JSON.stringify(snapshot) : null,
            }
        });
    } catch (err) {
        console.error('Erro ao registrar auditoria:', err);
    }
}

/**
 * Compara dois objetos e retorna as diferencas.
 * Retorna null se nao houver mudancas.
 */
function computeChanges(oldObj, newObj, fieldsToTrack) {
    const changes = {};
    for (const field of fieldsToTrack) {
        const oldVal = oldObj[field] ?? null;
        const newVal = newObj[field] ?? null;
        if (String(oldVal) !== String(newVal)) {
            changes[field] = { old: oldVal, new: newVal };
        }
    }
    return Object.keys(changes).length > 0 ? changes : null;
}

module.exports = { logAudit, computeChanges };

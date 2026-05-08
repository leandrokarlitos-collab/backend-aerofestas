const prisma = require('../prisma/client');
const { logAudit, computeChanges } = require('./audit');

const VALID_CONDITIONS = ['OK', 'DESCONHECIDO', 'MOLHADO', 'UMIDO', 'SUJO', 'MOFADO', 'DANIFICADO', 'EM_MANUTENCAO', 'OUTROS'];
const TRACKED_FIELDS = ['condition', 'conditionDetails'];

function safeAudit(payload) {
    try {
        Promise.resolve(logAudit(payload)).catch(err =>
            console.error('[audit] falha silenciosa:', err)
        );
    } catch (err) {
        console.error('[audit] falha sincrona silenciosa:', err);
    }
}

/**
 * Garante que ToyUnit.count >= qty. Se houver menos, cria as faltantes.
 * NUNCA apaga unidades existentes (preserva histórico de auditoria).
 * Se qty diminuir, as unidades com unitNumber > qty ficam "inativas" (filtradas no list).
 */
async function syncUnitsToQuantity(toyId, qty) {
    const id = parseFloat(toyId);
    if (isNaN(id)) throw new Error('toyId inválido');
    const targetQty = Math.max(0, parseInt(qty) || 0);

    const existing = await prisma.toyUnit.findMany({
        where: { toyId: id },
        orderBy: { unitNumber: 'asc' }
    });

    const currentMax = existing.reduce((max, u) => Math.max(max, u.unitNumber), 0);
    const currentCount = existing.length;

    if (currentCount >= targetQty) return existing;

    const toCreate = [];
    let next = currentMax + 1;
    for (let i = currentCount; i < targetQty; i++) {
        toCreate.push({
            toyId: id,
            unitNumber: next++,
            condition: 'OK',
            conditionDetails: null
        });
    }

    if (toCreate.length) {
        await prisma.toyUnit.createMany({ data: toCreate });
    }

    return prisma.toyUnit.findMany({
        where: { toyId: id },
        orderBy: { unitNumber: 'asc' }
    });
}

/**
 * Lista unidades ativas (unitNumber <= toy.quantity) ordenadas.
 */
async function listUnitsByToy(toyId) {
    const id = parseFloat(toyId);
    if (isNaN(id)) throw new Error('toyId inválido');

    const toy = await prisma.toy.findUnique({ where: { id } });
    if (!toy) return [];

    const units = await prisma.toyUnit.findMany({
        where: { toyId: id, unitNumber: { lte: toy.quantity } },
        orderBy: { unitNumber: 'asc' }
    });
    return units;
}

/**
 * Atualiza condição de uma unidade.
 * Valida estado e exige conditionDetails quando 'OUTROS'.
 */
async function updateCondition(toyId, unitId, payload, user) {
    const id = parseInt(unitId);
    const tId = parseFloat(toyId);
    if (isNaN(id) || isNaN(tId)) {
        const err = new Error('IDs inválidos');
        err.status = 400;
        throw err;
    }

    const condition = String(payload.condition || '').toUpperCase().trim();
    const conditionDetails = payload.conditionDetails != null
        ? String(payload.conditionDetails).trim()
        : null;

    if (!VALID_CONDITIONS.includes(condition)) {
        const err = new Error(`Estado inválido. Valores aceitos: ${VALID_CONDITIONS.join(', ')}`);
        err.status = 400;
        throw err;
    }

    if (condition === 'OUTROS' && !conditionDetails) {
        const err = new Error('Quando o estado é "OUTROS", o campo "Mais detalhes" é obrigatório.');
        err.status = 400;
        throw err;
    }

    const existing = await prisma.toyUnit.findUnique({ where: { id } });
    if (!existing || existing.toyId !== tId) {
        const err = new Error('Unidade não encontrada');
        err.status = 404;
        throw err;
    }

    const saved = await prisma.toyUnit.update({
        where: { id },
        data: {
            condition,
            conditionDetails: conditionDetails || null,
            conditionUpdatedBy: user?.name || user?.email || null
        }
    });

    const changes = computeChanges(existing, saved, TRACKED_FIELDS);
    if (changes) {
        safeAudit({
            entityType: 'ToyUnit',
            entityId: id,
            action: 'UPDATE',
            user,
            changes,
            snapshot: {
                toyId: saved.toyId,
                unitNumber: saved.unitNumber,
                condition: saved.condition,
                conditionDetails: saved.conditionDetails
            }
        });
    }

    return saved;
}

module.exports = {
    syncUnitsToQuantity,
    listUnitsByToy,
    updateCondition,
    VALID_CONDITIONS
};

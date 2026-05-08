const prisma = require('../prisma/client');
const { logAudit } = require('./audit');

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
 * Lista todas as manutenções de um brinquedo, mais recentes primeiro.
 * Inclui dados do Monitor (id, nome) quando vinculado.
 */
async function listByToy(toyId) {
    const id = parseFloat(toyId);
    if (isNaN(id)) throw new Error('toyId inválido');

    return prisma.toyMaintenance.findMany({
        where: { toyId: id },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: {
            monitor: { select: { id: true, nome: true } }
        }
    });
}

/**
 * Cria um registro de manutenção.
 * - description é obrigatória
 * - date default = hoje (YYYY-MM-DD) se não vier
 * - monitorId é resolvido em monitorName (denormalizado) pra preservar nome
 */
async function create(toyId, payload, user) {
    const id = parseFloat(toyId);
    if (isNaN(id)) {
        const err = new Error('toyId inválido');
        err.status = 400;
        throw err;
    }

    const description = String(payload?.description || '').trim();
    if (!description) {
        const err = new Error('Descrição da manutenção é obrigatória');
        err.status = 400;
        throw err;
    }

    const toy = await prisma.toy.findUnique({ where: { id } });
    if (!toy) {
        const err = new Error('Brinquedo não encontrado');
        err.status = 404;
        throw err;
    }

    const date = payload?.date && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
        ? payload.date
        : new Date().toISOString().slice(0, 10);

    let unitNumber = null;
    if (payload?.unitNumber != null && payload.unitNumber !== '') {
        const n = parseInt(payload.unitNumber);
        if (!isNaN(n) && n > 0 && n <= toy.quantity) unitNumber = n;
    }

    let cost = null;
    if (payload?.cost != null && payload.cost !== '') {
        const c = parseFloat(payload.cost);
        if (!isNaN(c) && c >= 0) cost = c;
    }

    let monitorId = null;
    let monitorName = null;
    if (payload?.monitorId) {
        const m = await prisma.monitor.findUnique({
            where: { id: String(payload.monitorId) },
            select: { id: true, nome: true }
        });
        if (m) {
            monitorId = m.id;
            monitorName = m.nome;
        }
    }
    // Permite passar só monitorName (free text) caso quem fez não esteja na lista
    if (!monitorId && payload?.monitorName) {
        monitorName = String(payload.monitorName).trim() || null;
    }

    const created = await prisma.toyMaintenance.create({
        data: {
            toyId: id,
            unitNumber,
            date,
            description,
            cost,
            monitorId,
            monitorName,
            createdBy: user?.name || user?.email || null
        },
        include: {
            monitor: { select: { id: true, nome: true } }
        }
    });

    safeAudit({
        entityType: 'ToyMaintenance',
        entityId: created.id,
        action: 'CREATE',
        user,
        snapshot: {
            toyId: id, unitNumber, date, description, cost,
            monitorId, monitorName
        }
    });

    return created;
}

/**
 * Apaga um registro de manutenção. Apenas se pertencer ao toy informado.
 */
async function remove(toyId, maintenanceId, user) {
    const tId = parseFloat(toyId);
    const mId = parseInt(maintenanceId);
    if (isNaN(tId) || isNaN(mId)) {
        const err = new Error('IDs inválidos');
        err.status = 400;
        throw err;
    }

    const existing = await prisma.toyMaintenance.findUnique({ where: { id: mId } });
    if (!existing || existing.toyId !== tId) {
        const err = new Error('Registro não encontrado');
        err.status = 404;
        throw err;
    }

    await prisma.toyMaintenance.delete({ where: { id: mId } });

    safeAudit({
        entityType: 'ToyMaintenance',
        entityId: mId,
        action: 'DELETE',
        user,
        snapshot: { toyId: tId, ...existing }
    });

    return { success: true };
}

module.exports = {
    listByToy,
    create,
    remove
};

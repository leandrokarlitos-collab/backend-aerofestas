const prisma = require('../prisma/client');
const { logAudit, computeChanges } = require('./audit');

const TRACKED_FIELDS = ['name', 'quantity'];

// Fire-and-forget: auditoria nunca deve quebrar o fluxo principal.
function safeAudit(payload) {
    try {
        Promise.resolve(logAudit(payload)).catch(err =>
            console.error('[audit] falha silenciosa:', err)
        );
    } catch (err) {
        console.error('[audit] falha síncrona silenciosa:', err);
    }
}

async function listToys() {
    return prisma.toy.findMany({ orderBy: { name: 'asc' } });
}

async function createToy({ name, quantity }, user) {
    const id = Date.now();
    const saved = await prisma.toy.create({
        data: { id, name, quantity: parseInt(quantity) || 1 }
    });

    safeAudit({
        entityType: 'Toy',
        entityId: id,
        action: 'CREATE',
        user,
        snapshot: { name: saved.name, quantity: saved.quantity }
    });

    return saved;
}

async function updateToy(id, { name, quantity }, user) {
    const toyId = parseFloat(id);
    if (isNaN(toyId)) {
        const err = new Error('ID inválido');
        err.status = 400;
        throw err;
    }

    const existing = await prisma.toy.findUnique({ where: { id: toyId } });
    if (!existing) {
        const err = new Error('Brinquedo não encontrado');
        err.status = 404;
        throw err;
    }

    const saved = await prisma.toy.update({
        where: { id: toyId },
        data: { name, quantity: parseInt(quantity) || 1 }
    });

    const changes = computeChanges(existing, saved, TRACKED_FIELDS);
    safeAudit({
        entityType: 'Toy',
        entityId: toyId,
        action: 'UPDATE',
        user,
        changes,
        snapshot: { name: saved.name, quantity: saved.quantity }
    });

    return saved;
}

async function deleteToy(id, user) {
    const toyId = parseFloat(id);
    if (isNaN(toyId)) {
        const err = new Error('ID inválido');
        err.status = 400;
        throw err;
    }

    const existing = await prisma.toy.findUnique({ where: { id: toyId } });
    await prisma.eventItem.deleteMany({ where: { toyId } });
    await prisma.toy.delete({ where: { id: toyId } });

    if (existing) {
        safeAudit({
            entityType: 'Toy',
            entityId: toyId,
            action: 'DELETE',
            user,
            snapshot: { name: existing.name, quantity: existing.quantity }
        });
    }
}

module.exports = {
    listToys,
    createToy,
    updateToy,
    deleteToy
};

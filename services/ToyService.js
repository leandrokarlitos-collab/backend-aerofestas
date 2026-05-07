const prisma = require('../prisma/client');
const { logAudit, computeChanges } = require('./audit');
const ToyUnitService = require('./ToyUnitService');

const TRACKED_FIELDS = ['name', 'quantity', 'imageUrl'];

// Fire-and-forget: auditoria nunca deve quebrar o fluxo principal.
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
 * Lista os brinquedos com units, photos, lastRental e nextRental computados.
 * Faz backfill lazy de ToyUnit quando a quantidade subiu sem ter passado por
 * createToy/updateToy (ex.: brinquedos legados criados antes do modelo ToyUnit).
 */
async function listToys() {
    const today = new Date().toISOString().slice(0, 10);

    let toys = await prisma.toy.findMany({
        orderBy: { name: 'asc' },
        include: {
            units: { orderBy: { unitNumber: 'asc' } },
            photos: { orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }] },
            eventItems: {
                include: {
                    event: {
                        select: { id: true, date: true, endDate: true, clientName: true }
                    }
                }
            }
        }
    });

    // Backfill lazy: garante que cada toy tenha pelo menos `quantity` ToyUnits
    const toysNeedingBackfill = toys.filter(t => t.units.length < t.quantity);
    if (toysNeedingBackfill.length) {
        await Promise.all(
            toysNeedingBackfill.map(t => ToyUnitService.syncUnitsToQuantity(t.id, t.quantity))
        );
        toys = await prisma.toy.findMany({
            orderBy: { name: 'asc' },
            include: {
                units: { orderBy: { unitNumber: 'asc' } },
                photos: { orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }] },
                eventItems: {
                    include: {
                        event: {
                            select: { id: true, date: true, endDate: true, clientName: true }
                        }
                    }
                }
            }
        });
    }

    // Pós-processamento: calcula lastRental, nextRental e filtra unidades ativas
    return toys.map(toy => {
        const dates = toy.eventItems
            .filter(ei => ei.event && ei.event.date)
            .map(ei => ({
                date: ei.event.date,
                endDate: ei.event.endDate,
                eventId: ei.event.id,
                clientName: ei.event.clientName,
                quantity: ei.quantity
            }));

        const past = dates
            .filter(d => d.date <= today)
            .sort((a, b) => b.date.localeCompare(a.date));
        const future = dates
            .filter(d => d.date > today)
            .sort((a, b) => a.date.localeCompare(b.date));

        const activeUnits = toy.units.filter(u => u.unitNumber <= toy.quantity);

        return {
            id: toy.id,
            name: toy.name,
            quantity: toy.quantity,
            imageUrl: toy.imageUrl,
            units: activeUnits,
            photos: toy.photos,
            lastRental: past[0] || null,
            nextRental: future[0] || null
        };
    });
}

async function createToy({ name, quantity, imageUrl }, user) {
    const id = Date.now();
    const qty = parseInt(quantity) || 1;

    const saved = await prisma.toy.create({
        data: {
            id,
            name,
            quantity: qty,
            imageUrl: imageUrl || null
        }
    });

    // Cria N ToyUnits (1..qty) já com condition='OK'
    await ToyUnitService.syncUnitsToQuantity(id, qty);

    safeAudit({
        entityType: 'Toy',
        entityId: id,
        action: 'CREATE',
        user,
        snapshot: { name: saved.name, quantity: saved.quantity, imageUrl: saved.imageUrl }
    });

    return saved;
}

async function updateToy(id, { name, quantity, imageUrl }, user) {
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

    const data = { name, quantity: parseInt(quantity) || 1 };
    if (imageUrl !== undefined) {
        data.imageUrl = imageUrl || null;
    }

    const saved = await prisma.toy.update({
        where: { id: toyId },
        data
    });

    // Sincroniza ToyUnits com a nova quantity (cria as faltantes; nunca apaga)
    await ToyUnitService.syncUnitsToQuantity(toyId, saved.quantity);

    const changes = computeChanges(existing, saved, TRACKED_FIELDS);
    safeAudit({
        entityType: 'Toy',
        entityId: toyId,
        action: 'UPDATE',
        user,
        changes,
        snapshot: { name: saved.name, quantity: saved.quantity, imageUrl: saved.imageUrl }
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
    // ToyUnit e ToyPhoto têm onDelete: Cascade no schema, então caem juntos.
    await prisma.toy.delete({ where: { id: toyId } });

    if (existing) {
        safeAudit({
            entityType: 'Toy',
            entityId: toyId,
            action: 'DELETE',
            user,
            snapshot: { name: existing.name, quantity: existing.quantity, imageUrl: existing.imageUrl }
        });
    }
}

module.exports = {
    listToys,
    createToy,
    updateToy,
    deleteToy
};

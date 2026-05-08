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
            photos: {
                orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
                include: { event: { select: { id: true, date: true, clientName: true } } }
            },
            maintenances: {
                orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
                take: 30,
                include: { monitor: { select: { id: true, nome: true } } }
            },
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
                photos: {
                orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
                include: { event: { select: { id: true, date: true, clientName: true } } }
            },
            maintenances: {
                orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
                take: 30,
                include: { monitor: { select: { id: true, nome: true } } }
            },
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

    // Pós-processamento: calcula lastRental, nextRental, totalEvents, history e filtra unidades ativas
    return toys.map(toy => {
        const events = toy.eventItems
            .filter(ei => ei.event && ei.event.date)
            .map(ei => ({
                date: ei.event.date,
                endDate: ei.event.endDate,
                eventId: ei.event.id,
                clientName: ei.event.clientName,
                quantity: ei.quantity
            }));

        const past = events
            .filter(d => d.date <= today)
            .sort((a, b) => b.date.localeCompare(a.date));
        const future = events
            .filter(d => d.date > today)
            .sort((a, b) => a.date.localeCompare(b.date));

        const activeUnits = toy.units.filter(u => u.unitNumber <= toy.quantity);

        // Limita o histórico para não inchar a resposta — 30 mais recentes (passados + futuros)
        const recentHistory = [...future.slice(0, 10), ...past.slice(0, 30)]
            .sort((a, b) => b.date.localeCompare(a.date));

        return {
            id: toy.id,
            name: toy.name,
            quantity: toy.quantity,
            imageUrl: toy.imageUrl,
            units: activeUnits,
            photos: toy.photos,
            maintenances: toy.maintenances || [],
            lastRental: past[0] || null,
            nextRental: future[0] || null,
            totalEvents: events.length,
            history: recentHistory
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
    if (!existing) {
        const err = new Error('Brinquedo não encontrado');
        err.status = 404;
        throw err;
    }

    // BLOQUEIO: não permite excluir se houver evento agendado (data >= hoje) usando este brinquedo.
    // Eventos passados são liberados — apaga em cascata pra permitir aposentar equipamentos antigos.
    const today = new Date().toISOString().slice(0, 10);
    const scheduledItems = await prisma.eventItem.findMany({
        where: {
            toyId,
            event: { date: { gte: today } }
        },
        include: { event: { select: { id: true, date: true, clientName: true } } },
        orderBy: { event: { date: 'asc' } },
        take: 5
    });

    if (scheduledItems.length > 0) {
        const sample = scheduledItems.map(i => ({
            eventId: i.event.id,
            date: i.event.date,
            clientName: i.event.clientName
        }));
        const err = new Error(
            `Este equipamento está em ${scheduledItems.length} evento(s) agendado(s). Remova-o dos eventos antes de excluir.`
        );
        err.status = 409;
        err.details = { scheduledEvents: sample };
        throw err;
    }

    await prisma.eventItem.deleteMany({ where: { toyId } });
    // ToyUnit e ToyPhoto têm onDelete: Cascade no schema, então caem juntos.
    // Fotos no Storage NÃO são apagadas — admin pode limpar manualmente se quiser (caminho toys/{id}/).
    await prisma.toy.delete({ where: { id: toyId } });

    safeAudit({
        entityType: 'Toy',
        entityId: toyId,
        action: 'DELETE',
        user,
        snapshot: { name: existing.name, quantity: existing.quantity, imageUrl: existing.imageUrl }
    });
}

module.exports = {
    listToys,
    createToy,
    updateToy,
    deleteToy
};

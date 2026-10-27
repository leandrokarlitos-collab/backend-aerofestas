const prisma = require('../prisma/client');
const reservations = require('../js/eventReservations');
const { logAudit } = require('./audit');

function safeAudit(payload) {
    try {
        Promise.resolve(logAudit(payload)).catch(err =>
            console.error('[audit] falha silenciosa (EventRoute):', err)
        );
    } catch (err) {
        console.error('[audit] falha síncrona silenciosa (EventRoute):', err);
    }
}

function isValidLocalDateTime(v) {
    return /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(v || '') &&
        Number.isFinite(Date.parse(v + ':00Z')) &&
        new Date(v + ':00Z').toISOString().slice(0, 16) === v;
}

function validateRouteWindow(departureAt, availableAt) {
    if (!isValidLocalDateTime(departureAt) || !isValidLocalDateTime(availableAt)) {
        const err = new Error('Informe a data e a hora de saída e de liberação da rota.');
        err.status = 400;
        throw err;
    }
    if (departureAt >= availableAt) {
        const err = new Error('A liberação no galpão deve ocorrer depois da saída.');
        err.status = 400;
        throw err;
    }
    if (reservations.days(departureAt.slice(0, 10), availableAt.slice(0, 10)).length >= 3700) {
        const err = new Error('Período da rota muito longo.');
        err.status = 400;
        throw err;
    }
}

function parseLengthMeters(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const normalized = String(raw).trim().replace(',', '.');
    if (!normalized) return null;
    const val = parseFloat(normalized);
    if (!Number.isFinite(val) || val <= 0 || val > 50) {
        const err = new Error('Informe um tamanho válido em metros para a carreta (ex.: 4,5).');
        err.status = 400;
        throw err;
    }
    return Math.round(val * 100) / 100;
}

async function normalizeRouteVehicles(rawVehicles) {
    if (!Array.isArray(rawVehicles) || rawVehicles.length === 0) return [];

    const requestedIds = rawVehicles
        .map(v => (v && v.vehicleId != null && v.vehicleId !== '' ? parseInt(v.vehicleId, 10) : null))
        .filter(id => Number.isInteger(id) && id > 0);

    const catalogMap = new Map();
    if (requestedIds.length > 0) {
        const found = await prisma.vehicle.findMany({
            where: { id: { in: requestedIds } }
        });
        for (const veh of found) catalogMap.set(veh.id, veh);
    }

    const result = [];
    for (let idx = 0; idx < rawVehicles.length; idx++) {
        const item = rawVehicles[idx];
        if (!item) continue;

        const parsedId = item.vehicleId != null && item.vehicleId !== '' ? parseInt(item.vehicleId, 10) : null;
        const catalogVeh = (parsedId && catalogMap.has(parsedId)) ? catalogMap.get(parsedId) : null;

        const vehicleId = catalogVeh ? catalogVeh.id : null;
        const vehicleName = catalogVeh
            ? catalogVeh.name
            : String(item.vehicleName || '').trim();
        const vehiclePlate = catalogVeh
            ? (catalogVeh.plate || null)
            : (String(item.vehiclePlate || '').trim().toUpperCase() || null);

        // Permite deixar em branco: linhas vazias sem veículo selecionado são ignoradas
        if (!vehicleName) continue;

        const hasTrailer = Boolean(item.hasTrailer);
        const trailerTrucada = hasTrailer ? Boolean(item.trailerTrucada) : false;
        const trailerLengthMeters = hasTrailer ? parseLengthMeters(item.trailerLengthMeters) : null;

        result.push({
            vehicleId,
            vehicleName,
            vehiclePlate,
            hasTrailer,
            trailerTrucada,
            trailerLengthMeters,
            order: idx
        });
    }
    return result;
}

const ROUTE_INCLUDE = {
    vehicles: { orderBy: [{ order: 'asc' }, { id: 'asc' }] },
    events: {
        select: {
            id: true,
            code: true,
            date: true,
            endDate: true,
            startTime: true,
            endTime: true,
            departureAt: true,
            availableAt: true,
            clientName: true,
            cidade: true,
            uf: true,
            status: true,
            paymentStatus: true,
            municipalityStatus: true,
            eventType: true
        },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
    }
};

async function listEventRoutes() {
    return prisma.eventRoute.findMany({
        include: ROUTE_INCLUDE,
        orderBy: [{ departureAt: 'desc' }, { id: 'desc' }]
    });
}

async function getEventRoute(id) {
    const routeId = parseInt(id, 10);
    if (!Number.isInteger(routeId) || routeId <= 0) return null;
    return prisma.eventRoute.findUnique({
        where: { id: routeId },
        include: ROUTE_INCLUDE
    });
}

async function createEventRoute(payload, user) {
    const departureAt = String(payload?.departureAt || '').trim();
    const availableAt = String(payload?.availableAt || '').trim();
    validateRouteWindow(departureAt, availableAt);

    const baseCity = String(payload?.baseCity || '').trim() || 'Anápolis-GO';
    const notes = payload?.notes ? String(payload.notes).trim() || null : null;
    const vehiclesData = await normalizeRouteVehicles(payload?.vehicles);

    const created = await prisma.eventRoute.create({
        data: {
            baseCity,
            departureAt,
            availableAt,
            notes,
            createdBy: user?.id ? String(user.id) : null,
            updatedBy: user?.id ? String(user.id) : null,
            ...(vehiclesData.length ? { vehicles: { create: vehiclesData } } : {})
        },
        include: ROUTE_INCLUDE
    });

    safeAudit({
        entityType: 'EventRoute',
        entityId: String(created.id),
        action: 'CREATE',
        user,
        snapshot: {
            baseCity: created.baseCity,
            departureAt: created.departureAt,
            availableAt: created.availableAt,
            vehicles: created.vehicles.length
        }
    });

    return created;
}

async function updateEventRoute(id, payload, user) {
    const routeId = parseInt(id, 10);
    if (!Number.isInteger(routeId) || routeId <= 0) {
        const err = new Error('ID de rota inválido.');
        err.status = 400;
        throw err;
    }

    const existing = await prisma.eventRoute.findUnique({
        where: { id: routeId },
        include: {
            vehicles: true,
            events: { include: { items: true } }
        }
    });
    if (!existing) {
        const err = new Error('Rota não encontrada.');
        err.status = 404;
        throw err;
    }

    const nextDepartureAt = payload?.departureAt !== undefined
        ? String(payload.departureAt || '').trim()
        : existing.departureAt;
    const nextAvailableAt = payload?.availableAt !== undefined
        ? String(payload.availableAt || '').trim()
        : existing.availableAt;
    validateRouteWindow(nextDepartureAt, nextAvailableAt);

    const nextBaseCity = payload?.baseCity !== undefined
        ? (String(payload.baseCity || '').trim() || 'Anápolis-GO')
        : existing.baseCity;
    const nextNotes = payload?.notes !== undefined
        ? (String(payload.notes || '').trim() || null)
        : existing.notes;

    const windowChanged = nextDepartureAt !== existing.departureAt || nextAvailableAt !== existing.availableAt;

    if (windowChanged && existing.events.length > 0) {
        for (const ev of existing.events) {
            if (ev.status === 'cancelado' || ev.paymentStatus === 'Cancelado' || ev.eventType === 'meeting') continue;
            const valErr = reservations.validate({
                ...ev,
                departureAt: nextDepartureAt,
                availableAt: nextAvailableAt
            });
            if (valErr) {
                const err = new Error(`${valErr} (Parada: ${ev.clientName || ev.cidade || '#' + (ev.code || ev.id)})`);
                err.status = 400;
                throw err;
            }
        }

        const [externalEvents, inventory] = await Promise.all([
            prisma.event.findMany({
                where: {
                    status: { not: 'cancelado' },
                    OR: [{ routeId: null }, { routeId: { not: routeId } }]
                },
                include: { items: true }
            }),
            prisma.toy.findMany({ select: { id: true, name: true, quantity: true } })
        ]);

        const updatedRouteEvents = existing.events.map(ev => ({
            ...ev,
            routeId,
            departureAt: nextDepartureAt,
            availableAt: nextAvailableAt
        }));
        const firstActive = updatedRouteEvents.find(ev => ev.status !== 'cancelado' && ev.paymentStatus !== 'Cancelado' && ev.eventType !== 'meeting');
        if (firstActive) {
            const siblings = updatedRouteEvents.filter(ev => ev.id !== firstActive.id);
            const stockErr = reservations.conflict(firstActive, [...siblings, ...externalEvents], inventory);
            if (stockErr) {
                const err = new Error(stockErr);
                err.status = 409;
                throw err;
            }
        }
    }

    let vehiclesData = null;
    if (payload?.vehicles !== undefined) {
        vehiclesData = await normalizeRouteVehicles(payload.vehicles);
    }

    await prisma.$transaction(async (tx) => {
        if (vehiclesData !== null) {
            await tx.eventRouteVehicle.deleteMany({ where: { routeId } });
            if (vehiclesData.length > 0) {
                await tx.eventRouteVehicle.createMany({
                    data: vehiclesData.map(v => ({ ...v, routeId }))
                });
            }
        }

        await tx.eventRoute.update({
            where: { id: routeId },
            data: {
                baseCity: nextBaseCity,
                departureAt: nextDepartureAt,
                availableAt: nextAvailableAt,
                notes: nextNotes,
                updatedBy: user?.id ? String(user.id) : null
            }
        });

        if (windowChanged) {
            await tx.event.updateMany({
                where: { routeId },
                data: {
                    departureAt: nextDepartureAt,
                    availableAt: nextAvailableAt
                }
            });
        }
    });

    const updated = await getEventRoute(routeId);
    safeAudit({
        entityType: 'EventRoute',
        entityId: String(routeId),
        action: 'UPDATE',
        user,
        snapshot: {
            baseCity: updated.baseCity,
            departureAt: updated.departureAt,
            availableAt: updated.availableAt,
            vehicles: updated.vehicles.length
        }
    });
    return updated;
}

async function deleteEventRoute(id, user, options = {}) {
    const routeId = parseInt(id, 10);
    if (!Number.isInteger(routeId) || routeId <= 0) {
        const err = new Error('ID de rota inválido.');
        err.status = 400;
        throw err;
    }

    const existing = await prisma.eventRoute.findUnique({ where: { id: routeId } });
    if (!existing) {
        const err = new Error('Rota não encontrada.');
        err.status = 404;
        throw err;
    }

    const clearTravel = options.clearTravel !== false;
    await prisma.$transaction(async (tx) => {
        await tx.event.updateMany({
            where: { routeId },
            data: {
                routeId: null,
                ...(clearTravel ? { departureAt: null, availableAt: null } : {})
            }
        });
        await tx.eventRoute.delete({ where: { id: routeId } });
    });

    safeAudit({
        entityType: 'EventRoute',
        entityId: String(routeId),
        action: 'DELETE',
        user,
        snapshot: {
            baseCity: existing.baseCity,
            departureAt: existing.departureAt,
            availableAt: existing.availableAt
        }
    });
}

module.exports = {
    ROUTE_INCLUDE,
    validateRouteWindow,
    normalizeRouteVehicles,
    listEventRoutes,
    getEventRoute,
    createEventRoute,
    updateEventRoute,
    deleteEventRoute
};

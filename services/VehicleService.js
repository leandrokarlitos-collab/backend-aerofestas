const prisma = require('../prisma/client');
const { logAudit, computeChanges } = require('./audit');

const TRACKED_FIELDS = ['name', 'plate', 'notes', 'active'];

function safeAudit(payload) {
    try {
        Promise.resolve(logAudit(payload)).catch(err =>
            console.error('[audit] falha silenciosa (Vehicle):', err)
        );
    } catch (err) {
        console.error('[audit] falha síncrona silenciosa (Vehicle):', err);
    }
}

function normalizePlate(raw) {
    if (raw === undefined || raw === null) return null;
    const cleaned = String(raw).trim().toUpperCase().replace(/\s+/g, '');
    if (!cleaned) return null;
    if (cleaned.length > 20) {
        const err = new Error('Placa muito longa (máximo de 20 caracteres).');
        err.status = 400;
        throw err;
    }
    return cleaned;
}

function validateAndBuildFields(payload, userId) {
    const name = String(payload?.name || '').trim();
    if (!name) {
        const err = new Error('Informe o nome do veículo.');
        err.status = 400;
        throw err;
    }
    if (name.length > 120) {
        const err = new Error('Nome do veículo muito longo (máximo de 120 caracteres).');
        err.status = 400;
        throw err;
    }
    const plate = normalizePlate(payload?.plate);
    const notesRaw = payload?.notes !== undefined && payload?.notes !== null
        ? String(payload.notes).trim()
        : '';
    if (notesRaw.length > 500) {
        const err = new Error('Observação muito longa (máximo de 500 caracteres).');
        err.status = 400;
        throw err;
    }
    const active = payload?.active === undefined ? true : Boolean(payload.active);

    return {
        name,
        plate,
        notes: notesRaw || null,
        active,
        updatedBy: userId ? String(userId) : null
    };
}

async function listVehicles() {
    return prisma.vehicle.findMany({
        orderBy: [{ active: 'desc' }, { name: 'asc' }]
    });
}

async function upsertVehicle(payload, user) {
    const idRaw = payload?.id;
    const vehicleId = idRaw !== undefined && idRaw !== null && idRaw !== '' ? parseInt(idRaw, 10) : null;
    const fields = validateAndBuildFields(payload, user?.id);

    if (vehicleId && Number.isInteger(vehicleId) && vehicleId > 0) {
        const existing = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
        if (!existing) {
            const err = new Error('Veículo não encontrado.');
            err.status = 404;
            throw err;
        }
        const saved = await prisma.vehicle.update({
            where: { id: vehicleId },
            data: fields
        });
        // Mantém nome/placa sincronizados nas rotas em que este veículo está vinculado
        await prisma.eventRouteVehicle.updateMany({
            where: { vehicleId },
            data: { vehicleName: saved.name, vehiclePlate: saved.plate }
        });
        const changes = computeChanges(existing, saved, TRACKED_FIELDS);
        safeAudit({
            entityType: 'Vehicle',
            entityId: String(saved.id),
            action: 'UPDATE',
            user,
            changes,
            snapshot: { name: saved.name, plate: saved.plate, active: saved.active }
        });
        return saved;
    }

    const created = await prisma.vehicle.create({
        data: {
            ...fields,
            createdBy: user?.id ? String(user.id) : null
        }
    });
    safeAudit({
        entityType: 'Vehicle',
        entityId: String(created.id),
        action: 'CREATE',
        user,
        snapshot: { name: created.name, plate: created.plate, active: created.active }
    });
    return created;
}

async function updateVehicle(id, payload, user) {
    const vehicleId = parseInt(id, 10);
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
        const err = new Error('ID de veículo inválido.');
        err.status = 400;
        throw err;
    }
    return upsertVehicle({ ...payload, id: vehicleId }, user);
}

async function deleteVehicle(id, user) {
    const vehicleId = parseInt(id, 10);
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
        const err = new Error('ID de veículo inválido.');
        err.status = 400;
        throw err;
    }
    const existing = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!existing) {
        const err = new Error('Veículo não encontrado.');
        err.status = 404;
        throw err;
    }
    await prisma.vehicle.delete({ where: { id: vehicleId } });
    safeAudit({
        entityType: 'Vehicle',
        entityId: String(vehicleId),
        action: 'DELETE',
        user,
        snapshot: { name: existing.name, plate: existing.plate }
    });
}

module.exports = {
    listVehicles,
    upsertVehicle,
    updateVehicle,
    deleteVehicle
};

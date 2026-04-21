const prisma = require('../prisma/client');
const { logAudit, computeChanges } = require('./audit');

const TRACKED_FIELDS = ['name', 'phone', 'address', 'cpf'];

function safeAudit(payload) {
    try {
        Promise.resolve(logAudit(payload)).catch(err =>
            console.error('[audit] falha silenciosa:', err)
        );
    } catch (err) {
        console.error('[audit] falha síncrona silenciosa:', err);
    }
}

function sanitize({ name, phone, address, cpf }) {
    return {
        name,
        phone: phone || null,
        address: address || null,
        cpf: cpf || null
    };
}

async function listClients() {
    return prisma.client.findMany({ orderBy: { name: 'asc' } });
}

async function createClient(payload, user) {
    const id = Date.now();
    const saved = await prisma.client.create({
        data: { id, ...sanitize(payload) }
    });

    safeAudit({
        entityType: 'Client',
        entityId: id,
        action: 'CREATE',
        user,
        snapshot: { name: saved.name, phone: saved.phone, cpf: saved.cpf }
    });

    return saved;
}

async function updateClient(id, payload, user) {
    const clientId = parseFloat(id);
    if (isNaN(clientId)) {
        const err = new Error('ID inválido');
        err.status = 400;
        throw err;
    }

    const existing = await prisma.client.findUnique({ where: { id: clientId } });
    if (!existing) {
        const err = new Error('Cliente não encontrado');
        err.status = 404;
        throw err;
    }

    const saved = await prisma.client.update({
        where: { id: clientId },
        data: sanitize(payload)
    });

    const changes = computeChanges(existing, saved, TRACKED_FIELDS);
    safeAudit({
        entityType: 'Client',
        entityId: clientId,
        action: 'UPDATE',
        user,
        changes,
        snapshot: { name: saved.name, phone: saved.phone, cpf: saved.cpf }
    });

    return saved;
}

async function deleteClient(id, user) {
    const clientId = parseFloat(id);
    if (isNaN(clientId)) {
        const err = new Error('ID inválido');
        err.status = 400;
        throw err;
    }

    const existing = await prisma.client.findUnique({ where: { id: clientId } });
    if (!existing) {
        const err = new Error('Cliente não encontrado');
        err.status = 404;
        throw err;
    }

    // FK-guard: não deixar apagar cliente com conversas WhatsApp associadas
    const convCount = await prisma.whatsAppConversation.count({ where: { clientId } });
    if (convCount > 0) {
        const err = new Error('Cliente possui conversas WhatsApp associadas e não pode ser excluído');
        err.status = 400;
        throw err;
    }

    await prisma.client.delete({ where: { id: clientId } });

    safeAudit({
        entityType: 'Client',
        entityId: clientId,
        action: 'DELETE',
        user,
        snapshot: { name: existing.name, phone: existing.phone, cpf: existing.cpf }
    });
}

module.exports = {
    listClients,
    createClient,
    updateClient,
    deleteClient
};

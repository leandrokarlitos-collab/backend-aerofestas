const prisma = require('../prisma/client');
const { logAudit, computeChanges } = require('./audit');

const TRACKED_FIELDS = [
    'name', 'cnpj', 'address', 'phone', 'email',
    'paymentInfo', 'repName', 'repDoc'
];

function safeAudit(payload) {
    try {
        Promise.resolve(logAudit(payload)).catch(err =>
            console.error('[audit] falha silenciosa:', err)
        );
    } catch (err) {
        console.error('[audit] falha síncrona silenciosa:', err);
    }
}

function sanitize({ name, cnpj, address, phone, email, paymentInfo, repName, repDoc }) {
    return {
        name: name || '',
        cnpj: cnpj || null,
        address: address || null,
        phone: phone || null,
        email: email || null,
        paymentInfo: paymentInfo || null,
        repName: repName || null,
        repDoc: repDoc || null
    };
}

async function listCompanies() {
    return prisma.company.findMany({ orderBy: { name: 'asc' } });
}

async function createCompany(payload, user) {
    const id = Date.now();
    const saved = await prisma.company.create({
        data: { id, ...sanitize(payload) }
    });

    safeAudit({
        entityType: 'Company',
        entityId: id,
        action: 'CREATE',
        user,
        snapshot: { name: saved.name, cnpj: saved.cnpj, email: saved.email }
    });

    return saved;
}

async function updateCompany(id, payload, user) {
    const companyId = parseFloat(id);
    if (isNaN(companyId)) {
        const err = new Error('ID inválido');
        err.status = 400;
        throw err;
    }

    const existing = await prisma.company.findUnique({ where: { id: companyId } });
    if (!existing) {
        const err = new Error('Empresa não encontrada');
        err.status = 404;
        throw err;
    }

    const saved = await prisma.company.update({
        where: { id: companyId },
        data: sanitize(payload)
    });

    const changes = computeChanges(existing, saved, TRACKED_FIELDS);
    safeAudit({
        entityType: 'Company',
        entityId: companyId,
        action: 'UPDATE',
        user,
        changes,
        snapshot: { name: saved.name, cnpj: saved.cnpj, email: saved.email }
    });

    return saved;
}

// Backward-compat: POST / mantém semântica upsert usada por `salvarEmpresa`
async function upsertCompany(payload, user) {
    const incomingId = payload.id;
    return incomingId
        ? updateCompany(incomingId, payload, user)
        : createCompany(payload, user);
}

async function deleteCompany(id, user) {
    const companyId = parseFloat(id);
    if (isNaN(companyId)) {
        const err = new Error('ID inválido');
        err.status = 400;
        throw err;
    }

    const existing = await prisma.company.findUnique({ where: { id: companyId } });
    if (!existing) {
        const err = new Error('Empresa não encontrada');
        err.status = 404;
        throw err;
    }

    // FK-guard mantido do código original
    const eventsUsingCompany = await prisma.event.count({ where: { yourCompanyId: companyId } });
    if (eventsUsingCompany > 0) {
        const err = new Error('Empresa em uso por eventos, não pode ser excluída');
        err.status = 400;
        throw err;
    }

    await prisma.company.delete({ where: { id: companyId } });

    safeAudit({
        entityType: 'Company',
        entityId: companyId,
        action: 'DELETE',
        user,
        snapshot: { name: existing.name, cnpj: existing.cnpj, email: existing.email }
    });
}

module.exports = {
    listCompanies,
    createCompany,
    updateCompany,
    upsertCompany,
    deleteCompany
};

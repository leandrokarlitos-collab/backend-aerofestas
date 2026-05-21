const prisma = require('../prisma/client');
const { logAudit, computeChanges } = require('./audit');
const webpush = require('../config/webpush');

const TRACKED_FIELDS = [
    'date', 'endDate', 'clientName', 'price', 'subtotal', 'paymentStatus',
    'monitor', 'clientAddress', 'cidade', 'uf', 'status', 'eventObservations',
    'discountValue', 'deliveryFee', 'signalAmount', 'signalReceived', 'eventType'
];

const toFloatOr = (v, fallback) =>
    (v !== undefined && v !== null) ? parseFloat(v) : fallback;

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

function normalizeItems(rawItems) {
    return (rawItems || [])
        .map(item => ({
            quantity: parseInt(item.quantity) || 1,
            price: toFloatOr(item.price, toFloatOr(item.valor, 0)),
            toyId: item.id ? parseFloat(item.id) : (item.toyId ? parseFloat(item.toyId) : null)
        }))
        .filter(i => i.toyId !== null);
}

function normalizeExternalRentals(rawList) {
    return (rawList || [])
        .map(r => ({
            description: String(r.description || '').trim(),
            supplier: r.supplier ? String(r.supplier).trim() : null,
            quantity: parseInt(r.quantity) || 1,
            cost: toFloatOr(r.cost, 0)
        }))
        .filter(r => r.description.length > 0 && r.cost >= 0);
}

function buildEventFields(evt, userId) {
    return {
        date: evt.date,
        endDate: evt.endDate || null,
        clientName: evt.clientName,
        yourCompanyId: evt.yourCompanyId ? parseFloat(evt.yourCompanyId) : null,
        startTime: evt.startTime,
        endTime: evt.endTime,
        price: toFloatOr(evt.price, 0),

        clientType: evt.clientType,
        clientCpf: evt.clientCpf,
        clientRg: evt.clientRg,
        clientDob: evt.clientDob,
        clientPhone: evt.clientPhone,
        clientPhoneBackup: evt.clientPhoneBackup,

        cnpj: evt.cnpj,
        companyAddress: evt.companyAddress,
        repName: evt.repName,
        repCpf: evt.repCpf,
        repPhone: evt.repPhone,
        repPhoneBackup: evt.repPhoneBackup,

        clientAddress: evt.clientAddress,
        contractAddress: evt.contractAddress,
        cep: evt.cep,
        complemento: evt.complemento,
        referencia: evt.referencia,
        bairro: evt.bairro,
        cidade: evt.cidade,
        uf: evt.uf,

        subtotal: toFloatOr(evt.subtotal, 0),
        discountType: evt.discountType,
        discountValue: toFloatOr(evt.discountValue, 0),
        deliveryFee: toFloatOr(evt.deliveryFee, 0),
        paymentStatus: evt.paymentStatus,
        signalAmount: toFloatOr(evt.signalAmount, 0),
        signalReceived: evt.signalReceived || false,
        paymentDetails: evt.paymentDetails,

        monitor: evt.monitor,
        eventObservations: evt.eventObservations,
        isBirthday: evt.isBirthday || false,
        birthdayPersonName: evt.birthdayPersonName,
        birthdayPersonDob: evt.birthdayPersonDob,

        status: evt.status,

        eventType: evt.eventType === 'meeting' ? 'meeting' : 'event',

        updatedBy: userId
    };
}

async function upsertEvent(evt, user) {
    const eventId = evt.id ? parseFloat(evt.id) : Date.now();
    const isUpdate = !!evt.id;

    const existingEvent = isUpdate
        ? await prisma.event.findUnique({ where: { id: eventId } })
        : null;

    const items = normalizeItems(evt.items || evt.toys);
    const externalRentals = normalizeExternalRentals(evt.externalRentals);
    if (isUpdate) {
        await prisma.eventItem.deleteMany({ where: { eventId } });
        await prisma.eventExternalRental.deleteMany({ where: { eventId } });
    }

    const fields = buildEventFields(evt, user.id);

    const saved = await prisma.event.upsert({
        where: { id: eventId },
        update: {
            ...fields,
            items: { create: items },
            externalRentals: { create: externalRentals }
        },
        create: {
            id: eventId,
            ...fields,
            createdBy: user.id,
            items: { create: items },
            externalRentals: { create: externalRentals }
        },
        include: {
            items: { include: { toy: true } },
            externalRentals: true
        }
    });

    const snapshot = { clientName: saved.clientName, date: saved.date, price: saved.price };
    if (isUpdate && existingEvent) {
        const changes = computeChanges(existingEvent, saved, TRACKED_FIELDS);
        safeAudit({ entityType: 'Event', entityId: eventId, action: 'UPDATE', user, changes, snapshot });
    } else {
        safeAudit({ entityType: 'Event', entityId: eventId, action: 'CREATE', user, snapshot });
    }

    return saved;
}

async function deleteEvent(id, user) {
    const eventId = parseFloat(id);
    if (isNaN(eventId)) {
        const err = new Error('ID inválido');
        err.status = 400;
        throw err;
    }

    const existingEvent = await prisma.event.findUnique({ where: { id: eventId } });
    await prisma.eventItem.deleteMany({ where: { eventId } });
    await prisma.eventExternalRental.deleteMany({ where: { eventId } });
    await prisma.event.delete({ where: { id: eventId } });

    if (existingEvent) {
        safeAudit({
            entityType: 'Event',
            entityId: eventId,
            action: 'DELETE',
            user,
            snapshot: {
                clientName: existingEvent.clientName,
                date: existingEvent.date,
                price: existingEvent.price
            }
        });
    }
}

async function listEventsFull() {
    return prisma.event.findMany({
        include: {
            items: { include: { toy: true } },
            company: true,
            externalRentals: true
        },
        orderBy: { date: 'desc' }
    });
}

async function getPublicEvent(id) {
    const eventId = parseFloat(id);
    const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: { items: { include: { toy: true } }, company: true }
    });
    if (!event) return null;

    return {
        id: event.id,
        date: event.date,
        endDate: event.endDate,
        eventType: event.eventType || 'event',
        startTime: event.startTime,
        endTime: event.endTime,
        companyName: event.company?.name || '',
        items: event.items.map(i => ({
            id: i.toyId,
            nome: i.toy?.name || 'Item',
            quantidade: i.quantity,
            precoUnitario: i.price,
            adicionadoPeloCliente: i.price === null || i.price === undefined
        })),
        subtotal: event.subtotal,
        discountType: event.discountType,
        discountValue: event.discountValue,
        deliveryFee: event.deliveryFee,
        price: event.price,
        clientType: event.clientType,
        clientName: event.clientName,
        clientCpf: event.clientCpf,
        clientRg: event.clientRg,
        clientDob: event.clientDob,
        clientPhone: event.clientPhone,
        clientPhoneBackup: event.clientPhoneBackup,
        cnpj: event.cnpj,
        companyAddress: event.companyAddress,
        repName: event.repName,
        repPhone: event.repPhone,
        clientAddress: event.clientAddress,
        cep: event.cep,
        complemento: event.complemento,
        referencia: event.referencia,
        bairro: event.bairro,
        cidade: event.cidade,
        uf: event.uf,
        isBirthday: event.isBirthday,
        birthdayPersonName: event.birthdayPersonName,
        birthdayPersonDob: event.birthdayPersonDob
    };
}

async function updatePublicEvent(id, d) {
    const eventId = parseFloat(id);

    const updateData = {
        clientType: d.clientType,
        clientName: d.clientName,
        clientCpf: d.clientCpf,
        clientRg: d.clientRg,
        clientDob: d.clientDob,
        clientPhone: d.clientPhone,
        clientPhoneBackup: d.clientPhoneBackup,
        cnpj: d.cnpj,
        companyAddress: d.companyAddress,
        repName: d.repName,
        repPhone: d.repPhone,
        clientAddress: d.clientAddress,
        contractAddress: d.contractAddress,
        cep: d.cep,
        complemento: d.complemento,
        referencia: d.referencia,
        bairro: d.bairro,
        cidade: d.cidade,
        uf: d.uf,
        isBirthday: d.isBirthday || false,
        birthdayPersonName: d.birthdayPersonName,
        birthdayPersonDob: d.birthdayPersonDob,
        status: 'cadastro_completo'
    };

    // Cliente pode propor nova data/horário — admin confirma depois.
    if (d.date) updateData.date = d.date;
    if (d.startTime) updateData.startTime = d.startTime;
    if (d.endTime) updateData.endTime = d.endTime;

    const updated = await prisma.event.update({ where: { id: eventId }, data: updateData });

    // Brinquedos extras pedidos pelo cliente (sem preço — admin define depois).
    if (Array.isArray(d.newItems) && d.newItems.length > 0) {
        const items = d.newItems
            .map(it => ({
                eventId,
                toyId: it.id ? parseFloat(it.id) : null,
                quantity: parseInt(it.quantity) || 1,
                price: null
            }))
            .filter(it => it.toyId !== null);
        if (items.length > 0) {
            await prisma.eventItem.createMany({ data: items });
        }
    }

    // Fire-and-forget: notificação nunca quebra o update.
    notifyAdminsCadastroCompleto(d.clientName).catch(err =>
        console.error('Erro ao enviar notificação push:', err)
    );

    return updated;
}

async function listPublicToys() {
    return prisma.toy.findMany({
        select: { id: true, name: true, imageUrl: true },
        orderBy: { name: 'asc' }
    });
}

// Verifica se há conflito com outro evento confirmado no mesmo dia/horário.
// Retorna { available: boolean, reason?: string } — nunca confirma de forma definitiva,
// apenas indica se *aparenta* estar livre.
async function checkAvailability({ date, startTime, endTime, excludeEventId }) {
    if (!date) return { available: false, reason: 'Data obrigatória' };

    const sameDayEvents = await prisma.event.findMany({
        where: {
            date,
            status: { not: 'cancelado' },
            ...(excludeEventId ? { id: { not: parseFloat(excludeEventId) } } : {})
        },
        select: { id: true, startTime: true, endTime: true, eventType: true }
    });

    if (sameDayEvents.length === 0) return { available: true };

    // Sem horário informado — qualquer evento no dia bloqueia.
    if (!startTime || !endTime) {
        return { available: false, reason: 'Já existem outros eventos neste dia' };
    }

    const toMin = (t) => {
        const [h, m] = String(t || '').split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    };
    const reqStart = toMin(startTime);
    const reqEnd = toMin(endTime);

    for (const ev of sameDayEvents) {
        if (!ev.startTime || !ev.endTime) {
            return { available: false, reason: 'Há outro evento no dia sem horário definido' };
        }
        const evStart = toMin(ev.startTime);
        const evEnd = toMin(ev.endTime);
        if (reqStart < evEnd && reqEnd > evStart) {
            return { available: false, reason: 'Horário sobrepõe outro evento' };
        }
    }

    return { available: true };
}

async function notifyAdminsCadastroCompleto(clientName) {
    const subscriptions = await prisma.pushSubscription.findMany();
    const payload = JSON.stringify({
        title: 'Cadastro de Evento Preenchido!',
        body: `${clientName || 'Cliente'} preencheu o cadastro do evento.`,
        url: '/Agenda%20de%20eventos.html',
        type: 'EVENT_CADASTRO_COMPLETO'
    });

    for (const sub of subscriptions) {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload
            );
        } catch (err) {
            if (err.statusCode === 410 || err.statusCode === 404) {
                await prisma.pushSubscription.delete({ where: { id: sub.id } });
            }
        }
    }
}

module.exports = {
    upsertEvent,
    deleteEvent,
    listEventsFull,
    getPublicEvent,
    updatePublicEvent,
    listPublicToys,
    checkAvailability
};

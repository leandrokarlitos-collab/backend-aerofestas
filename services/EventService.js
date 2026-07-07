const prisma = require('../prisma/client');
const { logAudit, computeChanges } = require('./audit');
const webpush = require('../config/webpush');
const { getBucket } = require('./firebaseAdmin');
const crypto = require('crypto');
const path = require('path');

// Tipos de arquivo aceitos como contrato anexado (PDF, imagens e Word).
const CONTRACT_ALLOWED_MIME = [
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const TRACKED_FIELDS = [
    'date', 'endDate', 'excludedDates', 'dateOverrides', 'revenueMode', 'clientName', 'price', 'subtotal', 'paymentStatus',
    'monitor', 'clientAddress', 'cidade', 'uf', 'status', 'eventObservations',
    'discountValue', 'deliveryFee', 'signalAmount', 'signalReceived', 'eventType',
    'isTicketSale', 'estimatedValue', 'ticketGrossSold', 'ticketSchoolPercent', 'ticketNetTotal', 'ticketItems'
];

// Serializa campo JSON do evento (excludedDates, dateOverrides) — aceita string já serializada,
// array/objeto, null ou undefined. Retorna string JSON ou null.
function serializeJsonField(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '' || trimmed === 'null') return null;
        return trimmed;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
}

const toFloatOr = (v, fallback) =>
    (v !== undefined && v !== null) ? parseFloat(v) : fallback;

// Converte para número ou null, preservando "vazio" — usado nos campos opcionais
// do pós-evento de venda por ficha (às vezes só o líquido é informado).
const toFloatOrNull = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
};

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
        excludedDates: evt.excludedDates !== undefined ? serializeJsonField(evt.excludedDates) : undefined,
        dateOverrides: evt.dateOverrides !== undefined ? serializeJsonField(evt.dateOverrides) : undefined,
        // Modo de recebimento (rateio): 'perDay' (padrão) | 'upfront'. Guarda só valores válidos.
        revenueMode: evt.revenueMode === 'upfront' ? 'upfront' : (evt.revenueMode === 'perDay' ? 'perDay' : undefined),
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
        clientSocial: evt.clientSocial,
        clientSocialChecked: typeof evt.clientSocialChecked === 'boolean' ? evt.clientSocialChecked : null,

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
        pixKey: evt.pixKey || null,
        paymentDetails: evt.paymentDetails,

        isTicketSale: evt.isTicketSale === true,
        estimatedValue: evt.isTicketSale === true ? toFloatOr(evt.estimatedValue, 0) : null,
        // Resultado pós-evento (venda por ficha): opcionais — null quando não informados.
        ticketGrossSold: evt.isTicketSale === true ? toFloatOrNull(evt.ticketGrossSold) : null,
        ticketSchoolPercent: evt.isTicketSale === true ? toFloatOrNull(evt.ticketSchoolPercent) : null,
        ticketNetTotal: evt.isTicketSale === true ? toFloatOrNull(evt.ticketNetTotal) : null,
        // Itens lançados da venda por ingresso — JSON string (ou null quando não é venda por ingresso).
        ticketItems: evt.isTicketSale === true ? serializeJsonField(evt.ticketItems) : null,

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
        company: event.company ? {
            id: event.company.id,
            name: event.company.name,
            cnpj: event.company.cnpj,
            address: event.company.address,
            phone: event.company.phone,
            email: event.company.email,
            paymentInfo: event.company.paymentInfo,
            repName: event.company.repName,
            repDoc: event.company.repDoc
        } : null,
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
        signalAmount: event.signalAmount,
        pixKey: event.pixKey,
        clientType: event.clientType,
        clientName: event.clientName,
        clientCpf: event.clientCpf,
        clientRg: event.clientRg,
        clientDob: event.clientDob,
        clientPhone: event.clientPhone,
        clientPhoneBackup: event.clientPhoneBackup,
        clientSocial: event.clientSocial,
        cnpj: event.cnpj,
        companyAddress: event.companyAddress,
        repName: event.repName,
        repCpf: event.repCpf,
        repPhone: event.repPhone,
        repPhoneBackup: event.repPhoneBackup,
        clientAddress: event.clientAddress,
        cep: event.cep,
        complemento: event.complemento,
        referencia: event.referencia,
        bairro: event.bairro,
        cidade: event.cidade,
        uf: event.uf,
        eventLat: event.eventLat,
        eventLng: event.eventLng,
        status: event.status,
        signedAt: event.signedAt,
        signedName: event.signedName,
        isBirthday: event.isBirthday,
        birthdayPersonName: event.birthdayPersonName,
        birthdayPersonDob: event.birthdayPersonDob
    };
}

async function updatePublicEvent(id, d, meta = {}) {
    const eventId = parseFloat(id);

    const updateData = {
        clientType: d.clientType,
        clientName: d.clientName,
        clientCpf: d.clientCpf,
        clientRg: d.clientRg,
        clientDob: d.clientDob,
        clientPhone: d.clientPhone,
        clientPhoneBackup: d.clientPhoneBackup,
        clientSocial: d.clientSocial,
        cnpj: d.cnpj,
        companyAddress: d.companyAddress,
        repName: d.repName,
        repCpf: d.repCpf,
        repPhone: d.repPhone,
        repPhoneBackup: d.repPhoneBackup,
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
    if (d.endDate !== undefined) updateData.endDate = d.endDate || null;
    if (d.startTime) updateData.startTime = d.startTime;
    if (d.endTime) updateData.endTime = d.endTime;
    if (d.eventLat !== undefined) updateData.eventLat = d.eventLat;
    if (d.eventLng !== undefined) updateData.eventLng = d.eventLng;

    // Assinatura simples: só registra se chegou signed=true E ainda não foi assinado.
    if (d.signed === true) {
        const existing = await prisma.event.findUnique({
            where: { id: eventId },
            select: { signedAt: true }
        });
        if (existing && !existing.signedAt) {
            updateData.signedAt = new Date();
            updateData.signedName = d.clientName || null;
            updateData.signedIp = meta.ip || null;
            updateData.signedUserAgent = meta.userAgent || null;
        }
    }

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

// Auto-save parcial — cliente preenchendo. Não dispara notificação,
// não exige campos obrigatórios. Marca status como cadastro_em_andamento
// se o status atual for pendente_cadastro/null/em_andamento (não regride
// de cadastro_completo).
async function saveDraftPublicEvent(id, d) {
    const eventId = parseFloat(id);
    const existing = await prisma.event.findUnique({
        where: { id: eventId },
        select: { status: true }
    });
    if (!existing) {
        const err = new Error('Evento não encontrado');
        err.status = 404;
        throw err;
    }

    const ALLOWED = [
        'clientType', 'clientName', 'clientCpf', 'clientRg', 'clientDob',
        'clientPhone', 'clientPhoneBackup', 'clientSocial',
        'cnpj', 'companyAddress', 'repName', 'repCpf', 'repPhone', 'repPhoneBackup',
        'clientAddress', 'cep', 'complemento', 'referencia', 'bairro', 'cidade', 'uf',
        'eventLat', 'eventLng',
        'isBirthday', 'birthdayPersonName', 'birthdayPersonDob',
        'date', 'endDate', 'startTime', 'endTime'
    ];
    const updateData = {};
    for (const k of ALLOWED) {
        if (d[k] !== undefined) updateData[k] = d[k];
    }

    // Só promove status para "em_andamento" se ainda não foi finalizado.
    const lockedStatuses = ['cadastro_completo', 'cancelado', 'concluido'];
    if (!lockedStatuses.includes(existing.status)) {
        updateData.status = 'cadastro_em_andamento';
    }

    const updated = await prisma.event.update({
        where: { id: eventId },
        data: updateData
    });

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

// Extensão do arquivo a partir do nome original ou do mime type.
function contractExtension(file) {
    if (file.originalname) {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext) return ext;
    }
    const map = {
        'application/pdf': '.pdf',
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
        'image/heic': '.heic', 'image/heif': '.heif',
        'application/msword': '.doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
    };
    return map[file.mimetype] || '';
}

/**
 * Anexa (ou substitui) o contrato de um evento: envia o arquivo ao Firebase Storage
 * e grava contractFileUrl/contractFileName no evento. Retorna o evento atualizado.
 */
async function uploadContract(eventId, file, user) {
    const id = parseFloat(eventId);
    if (isNaN(id)) { const e = new Error('eventId inválido'); e.status = 400; throw e; }
    if (!file) { const e = new Error('Nenhum arquivo enviado'); e.status = 400; throw e; }
    if (!CONTRACT_ALLOWED_MIME.includes(file.mimetype)) {
        const e = new Error(`Tipo de arquivo não suportado: ${file.mimetype}`); e.status = 400; throw e;
    }

    const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });
    if (!event) { const e = new Error('Evento não encontrado'); e.status = 404; throw e; }

    const bucket = getBucket(); // 503 se Storage não configurado
    const ext = contractExtension(file);
    const random = crypto.randomBytes(6).toString('hex');
    const storagePath = `contracts/event-${id}/${Date.now()}-${random}${ext}`;
    const storageFile = bucket.file(storagePath);

    await storageFile.save(file.buffer, {
        metadata: {
            contentType: file.mimetype,
            cacheControl: 'private, max-age=0',
            metadata: {
                eventId: String(id),
                uploadedBy: user?.email || user?.name || 'unknown'
            }
        },
        resumable: false
    });
    await storageFile.makePublic();

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURI(storagePath)}`;
    const originalName = (file.originalname || `contrato${ext}`).slice(0, 200);

    const updated = await prisma.event.update({
        where: { id },
        data: { contractFileUrl: publicUrl, contractFileName: originalName }
    });

    safeAudit({
        entityType: 'Event',
        entityId: id,
        action: 'UPDATE',
        user,
        snapshot: { contractFileUrl: publicUrl, contractFileName: originalName, source: 'contract-upload' }
    });

    return updated;
}

/**
 * Remove o vínculo do contrato do evento (não apaga o arquivo físico do Storage,
 * seguindo a mesma política das fotos). Retorna o evento atualizado.
 */
async function removeContract(eventId, user) {
    const id = parseFloat(eventId);
    if (isNaN(id)) { const e = new Error('eventId inválido'); e.status = 400; throw e; }

    const event = await prisma.event.findUnique({ where: { id }, select: { id: true, contractFileUrl: true } });
    if (!event) { const e = new Error('Evento não encontrado'); e.status = 404; throw e; }

    const updated = await prisma.event.update({
        where: { id },
        data: { contractFileUrl: null, contractFileName: null }
    });

    safeAudit({
        entityType: 'Event',
        entityId: id,
        action: 'UPDATE',
        user,
        snapshot: { contractFileUrl: null, previous: event.contractFileUrl, source: 'contract-remove' }
    });

    return updated;
}

module.exports = {
    upsertEvent,
    deleteEvent,
    listEventsFull,
    getPublicEvent,
    updatePublicEvent,
    saveDraftPublicEvent,
    listPublicToys,
    checkAvailability,
    uploadContract,
    removeContract
};

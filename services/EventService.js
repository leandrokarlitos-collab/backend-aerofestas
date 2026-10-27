const reservations = require('../js/eventReservations');
const prisma = require('../prisma/client');
const { logAudit, computeChanges } = require('./audit');
const webpush = require('../config/webpush');
const { getBucket } = require('./firebaseAdmin');
const crypto = require('crypto');
const path = require('path');
const {
    MAX_DIAS_PERIODO,
    eventActiveDates,
    countDaysInRange,
    normalizeDateRange,
    pruneExcludedDates
} = require('../utils/eventDates');

// Tipos de arquivo aceitos como contrato anexado (PDF, imagens e Word).
const CONTRACT_ALLOWED_MIME = [
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const TRACKED_FIELDS = [
    'routeId', 'departureAt', 'availableAt', 'date', 'endDate', 'excludedDates', 'dateOverrides', 'revenueMode', 'clientName', 'price', 'subtotal', 'paymentStatus',
    'monitor', 'clientAddress', 'cidade', 'uf', 'status', 'eventObservations',
    'discountValue', 'deliveryFee', 'signalAmount', 'signalReceived', 'eventType', 'municipalityStatus',
    'isTicketSale', 'estimatedValue', 'ticketGrossSold', 'ticketSchoolPercent', 'ticketNetTotal', 'ticketItems',
    // Texto que o cliente assina: alteração precisa deixar o "de → para" no histórico, senão não
    // há como reconstruir o que ele leu se contestar a condição depois.
    'contractPaymentTerms', 'paymentDetails'
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

// 'YYYY-MM-DD' -> 'DD/MM/YYYY' (sem Date, para não sofrer shift de fuso).
const isoToBR = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—');
};

const rangeToBR = (date, endDate) =>
    (endDate && endDate > date) ? `${isoToBR(date)} a ${isoToBR(endDate)}` : isoToBR(date);

const timesToBR = (start, end) =>
    (start || end) ? `${start || '—'} às ${end || '—'}` : 'não informado';

// Compara o que o vendedor combinou com o que o cliente enviou pelo link público.
// Retorna null quando nada de data/horário mudou; senão, o texto do pedido de alteração.
function describeScheduleChange(before, next) {
    const parts = [];
    const beforeRange = rangeToBR(before.date, before.endDate);
    const nextRange = rangeToBR(next.date, next.endDate);
    if (beforeRange !== nextRange) parts.push(`Data: ${beforeRange} → ${nextRange}`);

    const beforeTimes = timesToBR(before.startTime, before.endTime);
    const nextTimes = timesToBR(next.startTime, next.endTime);
    if (beforeTimes !== nextTimes) parts.push(`Horário: ${beforeTimes} → ${nextTimes}`);

    if (!parts.length) return null;

    const quando = new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo'
    }).format(new Date());
    return `Cliente pediu alteração pelo link em ${quando} — ${parts.join('; ')}. Confirmar com o cliente antes de fechar.`;
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

// Condições de pagamento do contrato: texto público que o cliente lê e assina.
// Normaliza quebras de linha e recusa texto absurdo em vez de cortar — truncar aqui
// mutilaria uma condição no meio da frase dentro de um contrato já assinado.
// Redação vigente do contrato do link público. Só eventos carimbados com esta versão recebem a
// cláusula de pagamento nova; os anteriores (coluna NULL) continuam renderizando o texto antigo.
const CONTRACT_TEMPLATE_VERSION = 2;

const MAX_CONTRACT_PAYMENT_TERMS = 2000;
function normalizeContractPaymentTerms(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).replace(/\r\n?/g, '\n').trim();
    if (!s) return null;
    if (s.length > MAX_CONTRACT_PAYMENT_TERMS) {
        const err = new Error(`Condições de pagamento muito longas (máximo de ${MAX_CONTRACT_PAYMENT_TERMS} caracteres).`);
        err.status = 400;
        throw err;
    }
    return s;
}

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
    if (evt.municipalityStatus != null && !['confirmed', 'quote'].includes(evt.municipalityStatus)) {
        const err = new Error('Situação da prefeitura inválida.');
        err.status = 400;
        throw err;
    }
    return {
        municipalityStatus: evt.eventType === 'meeting' ? null : evt.municipalityStatus,
        ...(evt.routeId !== undefined
            ? {
                routeId: evt.eventType === 'meeting'
                    ? null
                    : (evt.routeId !== null && evt.routeId !== '' ? parseInt(evt.routeId, 10) : null)
            }
            : {}),
        departureAt: evt.departureAt,
        availableAt: evt.availableAt,
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

        // Geolocalização do evento (pin no minimapa). Só grava quando o campo vem no
        // payload, para não apagar o pin marcado pelo cliente em salvamentos parciais que
        // não incluem o campo. Vazio/null => limpa (admin marcou "Localização não informada").
        ...(evt.eventLat !== undefined ? { eventLat: toFloatOrNull(evt.eventLat) } : {}),
        ...(evt.eventLng !== undefined ? { eventLng: toFloatOrNull(evt.eventLng) } : {}),

        subtotal: toFloatOr(evt.subtotal, 0),
        discountType: evt.discountType,
        discountValue: toFloatOr(evt.discountValue, 0),
        deliveryFee: toFloatOr(evt.deliveryFee, 0),
        paymentStatus: evt.paymentStatus,
        signalAmount: toFloatOr(evt.signalAmount, 0),
        signalReceived: evt.signalReceived || false,
        pixKey: evt.pixKey || null,
        paymentDetails: evt.paymentDetails,

        // Condições de pagamento do contrato (texto público). Mesmo guard de eventLat/eventLng:
        // só grava quando o campo vem no payload, para que um save parcial que não o inclua não
        // apague a cláusula de um contrato já assinado.
        ...(evt.contractPaymentTerms !== undefined
            ? { contractPaymentTerms: normalizeContractPaymentTerms(evt.contractPaymentTerms) }
            : {}),

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

// Substitui a escala de um evento pela lista informada. Dedupe por monitor,
// normaliza o papel e descarta monitorIds inexistentes (evita erro de FK e
// escala fantasma). Uma linha por monitor; `dia` fica null (escala vale para
// o evento todo) — granularidade por-dia é evolução futura.
async function replaceAssignments(eventId, rawList) {
    const seen = new Set();
    const wanted = [];
    for (const a of (rawList || [])) {
        const monitorId = a && a.monitorId != null ? String(a.monitorId) : null;
        if (!monitorId || seen.has(monitorId)) continue;
        seen.add(monitorId);
        const hg = (a.horaChegadaGalpao || '').toString().trim();
        wanted.push({
            monitorId,
            papel: a.papel === 'motorista' ? 'motorista' : 'monitor',
            dia: a.dia || null,
            horaChegadaGalpao: /^\d{1,2}:\d{2}$/.test(hg) ? hg : null
        });
    }

    let validos = wanted;
    if (wanted.length) {
        const existentes = await prisma.monitor.findMany({
            where: { id: { in: wanted.map(w => w.monitorId) } },
            select: { id: true }
        });
        const okIds = new Set(existentes.map(m => m.id));
        validos = wanted.filter(w => okIds.has(w.monitorId));
    }

    await prisma.eventAssignment.deleteMany({ where: { eventId } });
    if (validos.length) {
        await prisma.eventAssignment.createMany({
            data: validos.map(w => ({ eventId, monitorId: w.monitorId, papel: w.papel, dia: w.dia, horaChegadaGalpao: w.horaChegadaGalpao }))
        });
    }
}

const INITIAL_EVENT_CODE = 1001;

function parseEventCodeInput(raw) {
    if (raw === undefined || raw === null) return null;
    const cleaned = String(raw).trim().replace(/^#+/, '').trim();
    if (!/^\d+$/.test(cleaned)) return null;
    const code = parseInt(cleaned, 10);
    return Number.isSafeInteger(code) && code > 0 ? code : null;
}

async function nextEventCode() {
    const agg = await prisma.event.aggregate({ _max: { code: true } });
    const currentMax = agg && agg._max ? agg._max.code : null;
    return (Number.isInteger(currentMax) && currentMax >= INITIAL_EVENT_CODE)
        ? currentMax + 1
        : INITIAL_EVENT_CODE;
}

function isCodeUniqueViolation(err) {
    if (!err || err.code !== 'P2002') return false;
    const target = err.meta && err.meta.target;
    if (Array.isArray(target)) return target.includes('code');
    if (typeof target === 'string') return target.includes('code');
    return false;
}

async function upsertEvent(evt, user) {
    const eventId = evt.id ? parseFloat(evt.id) : Date.now();
    const isUpdate = !!evt.id;

    const existingEvent = isUpdate
        ? await prisma.event.findUnique({ where: { id: eventId }, include: { items: true } })
        : null;

    const items = normalizeItems(evt.items || evt.toys);
    const externalRentals = normalizeExternalRentals(evt.externalRentals);

    // Valida ANTES de destruir: buildEventFields pode lançar 400 (condições longas demais) e os
    // deleteMany abaixo não estão em transação — se a ordem se invertesse, um payload inválido
    // apagaria os brinquedos e as locações do evento e devolveria erro sem regravar nada.
    const fields = buildEventFields(evt, user.id);

    let targetRoute = null;
    let routeWindowUpdated = false;
    const creatingNewRoute = evt.eventType !== 'meeting' && evt.newRoute && typeof evt.newRoute === 'object';

    if (creatingNewRoute) {
        fields.departureAt = String(evt.newRoute.departureAt || evt.departureAt || '').trim();
        fields.availableAt = String(evt.newRoute.availableAt || evt.availableAt || '').trim();
    } else if (fields.routeId && Number.isInteger(fields.routeId) && fields.routeId > 0) {
        targetRoute = await prisma.eventRoute.findUnique({ where: { id: fields.routeId } });
        if (!targetRoute) {
            const err = new Error('Rota selecionada não foi encontrada.');
            err.status = 404;
            throw err;
        }
        const nextDep = evt.departureAt ? String(evt.departureAt).trim() : targetRoute.departureAt;
        const nextAvail = evt.availableAt ? String(evt.availableAt).trim() : targetRoute.availableAt;
        fields.departureAt = nextDep;
        fields.availableAt = nextAvail;
        routeWindowUpdated = nextDep !== targetRoute.departureAt || nextAvail !== targetRoute.availableAt;
    }

    const effectiveRouteId = fields.routeId !== undefined
        ? fields.routeId
        : (existingEvent ? existingEvent.routeId : null);

    const proposed = {
        ...existingEvent,
        ...evt,
        routeId: creatingNewRoute ? null : effectiveRouteId,
        departureAt: fields.departureAt,
        availableAt: fields.availableAt,
        items
    };
    const travelError = reservations.validate(proposed);
    if (travelError) { const err = new Error(travelError); err.status = 400; throw err; }
    const [rawOtherEvents, inventory] = await Promise.all([
        prisma.event.findMany({ where: { id: { not: eventId }, status: { not: 'cancelado' } }, include: { items: true } }),
        prisma.toy.findMany({ select: { id: true, name: true, quantity: true } })
    ]);

    const otherEvents = routeWindowUpdated && targetRoute
        ? rawOtherEvents.map(oe => (oe.routeId === targetRoute.id
            ? { ...oe, departureAt: fields.departureAt, availableAt: fields.availableAt }
            : oe))
        : rawOtherEvents;

    if (routeWindowUpdated && targetRoute) {
        for (const sibling of otherEvents) {
            if (sibling.routeId !== targetRoute.id) continue;
            if (sibling.status === 'cancelado' || sibling.paymentStatus === 'Cancelado' || sibling.eventType === 'meeting') continue;
            const sibErr = reservations.validate(sibling);
            if (sibErr) {
                const err = new Error(`${sibErr} (Parada existente na rota: ${sibling.clientName || sibling.cidade || '#' + (sibling.code || sibling.id)})`);
                err.status = 400;
                throw err;
            }
        }
    }

    const reservationChanged =
        JSON.stringify(reservations.intervals(proposed)) !== JSON.stringify(reservations.intervals(existingEvent || {})) ||
        (proposed.routeId || null) !== (existingEvent?.routeId || null) ||
        creatingNewRoute ||
        routeWindowUpdated;
    const stockError = reservationChanged && reservations.conflict(proposed, otherEvents, inventory);
    if (stockError) { const err = new Error(stockError); err.status = 409; throw err; }

    if (creatingNewRoute) {
        const EventRouteService = require('./EventRouteService');
        const createdRoute = await EventRouteService.createEventRoute({
            ...evt.newRoute,
            departureAt: fields.departureAt,
            availableAt: fields.availableAt
        }, user);
        fields.routeId = createdRoute.id;
    }

    if (isUpdate) {
        await prisma.eventItem.deleteMany({ where: { eventId } });
        await prisma.eventExternalRental.deleteMany({ where: { eventId } });
    }

    const needsCode = fields.eventType !== 'meeting' && (!existingEvent || existingEvent.code == null);

    let saved;
    const maxAttempts = needsCode ? 5 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const codeField = needsCode ? { code: await nextEventCode() } : {};
        try {
            saved = await prisma.event.upsert({
                where: { id: eventId },
                update: {
                    ...fields,
                    ...codeField,
                    items: { create: items },
                    externalRentals: { create: externalRentals }
                },
                create: {
                    id: eventId,
                    ...fields,
                    ...codeField,
                    createdBy: user.id,
                    // Carimba a redação do contrato vigente. Eventos criados antes desta coluna ficam
                    // NULL e continuam sendo renderizados com a redação antiga — um contrato assinado
                    // nunca pode mudar de texto por causa de um deploy.
                    contractTemplateVersion: CONTRACT_TEMPLATE_VERSION,
                    items: { create: items },
                    externalRentals: { create: externalRentals }
                },
                include: {
                    items: { include: { toy: true } },
                    externalRentals: true,
                    route: { include: { vehicles: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } } },
                    assignments: { include: { monitor: { select: { id: true, nome: true, cnh: true, cnhCategoria: true } } } }
                }
            });
            break;
        } catch (err) {
            if (needsCode && attempt < maxAttempts && isCodeUniqueViolation(err)) {
                continue;
            }
            throw err;
        }
    }

    if (routeWindowUpdated && targetRoute) {
        await prisma.eventRoute.update({
            where: { id: targetRoute.id },
            data: {
                departureAt: fields.departureAt,
                availableAt: fields.availableAt,
                updatedBy: user?.id ? String(user.id) : null
            }
        });
        await prisma.event.updateMany({
            where: { routeId: targetRoute.id, id: { not: eventId } },
            data: {
                departureAt: fields.departureAt,
                availableAt: fields.availableAt
            }
        });
    }

    // Escala estruturada (F2): SÓ mexe quando o payload traz o array `assignments`.
    // Saves parciais (assinatura, rascunho) que não incluem o campo NÃO apagam a
    // escala — mesmo guard usado para eventLat/eventLng em buildEventFields.
    if (Array.isArray(evt.assignments)) {
        await replaceAssignments(eventId, evt.assignments);
        saved.assignments = await prisma.eventAssignment.findMany({
            where: { eventId },
            include: { monitor: { select: { id: true, nome: true, cnh: true, cnhCategoria: true } } }
        });
    }

    const snapshot = { code: saved.code, clientName: saved.clientName, date: saved.date, price: saved.price };
    if (existingEvent?.routeId && existingEvent.routeId !== saved.routeId && prisma.eventRoute) {
        const remaining = await prisma.event.count({ where: { routeId: existingEvent.routeId } });
        if (remaining === 0) {
            await prisma.eventRoute.delete({ where: { id: existingEvent.routeId } }).catch(() => {});
        }
    }
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
    if (existingEvent?.routeId && prisma.eventRoute) {
        const remaining = await prisma.event.count({ where: { routeId: existingEvent.routeId } });
        if (remaining === 0) {
            await prisma.eventRoute.delete({ where: { id: existingEvent.routeId } }).catch(() => {});
        }
    }

    if (existingEvent) {
        safeAudit({
            entityType: 'Event',
            entityId: eventId,
            action: 'DELETE',
            user,
            snapshot: {
                code: existingEvent.code,
                clientName: existingEvent.clientName,
                date: existingEvent.date,
                price: existingEvent.price
            }
        });
    }
}

// Grava a escala de um evento de forma DEDICADA (independente do save do evento).
// Usado pela rota PUT /events/:id/assignments — garante que a escala persista sem
// depender de qual caminho de save do evento (normal, dia-único, etc.) foi usado.
async function setEventAssignments(id, list, user) {
    const eventId = parseFloat(id);
    if (isNaN(eventId)) {
        const err = new Error('ID inválido');
        err.status = 400;
        throw err;
    }
    await replaceAssignments(eventId, Array.isArray(list) ? list : []);
    const assignments = await prisma.eventAssignment.findMany({
        where: { eventId },
        include: { monitor: { select: { id: true, nome: true, cnh: true, cnhCategoria: true } } }
    });
    safeAudit({ entityType: 'Event', entityId: eventId, action: 'ESCALA', user, snapshot: { monitores: assignments.length } });
    return assignments;
}

async function listEventsFull() {
    return prisma.event.findMany({
        include: {
            items: { include: { toy: true } },
            company: true,
            externalRentals: true,
            route: { include: { vehicles: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } } },
            assignments: { include: { monitor: { select: { id: true, nome: true, cnh: true, cnhCategoria: true } } } }
        },
        orderBy: { date: 'desc' }
    });
}

async function getEventByCode(rawCode) {
    const code = parseEventCodeInput(rawCode);
    if (!code) return null;
    return prisma.event.findUnique({
        where: { code },
        include: {
            items: { include: { toy: true } },
            company: true,
            externalRentals: true
        }
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
        // Dias removidos do intervalo pelo admin — o link público não deixa o cliente
        // editá-los, mas precisa deles para contar os dias e listar as datas no contrato.
        excludedDates: event.excludedDates,
        activeDates: eventActiveDates(event),
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
        // Somente LEITURA para o cliente: alimenta a CLÁUSULA QUARTA do contrato. Note que o
        // campo NÃO entra em updatePublicEvent nem na ALLOWED de saveDraftPublicEvent — senão o
        // cliente reescreveria a própria condição de pagamento pelo PATCH do rascunho.
        contractPaymentTerms: event.contractPaymentTerms,
        // Qual redação de contrato este evento usa (NULL = anterior à cláusula de pagamento nova).
        contractTemplateVersion: event.contractTemplateVersion,
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

    // Estado atual — precisa vir antes para validar a faixa de datas e detectar
    // o que o cliente mudou em relação ao que o vendedor combinou.
    const before = await prisma.event.findUnique({
        where: { id: eventId }, include: { items: true }
    });
    if (!before) {
        const err = new Error('Evento não encontrado');
        err.status = 404;
        throw err;
    }

    // Cliente pode propor nova data/horário — admin confirma depois.
    if (d.date) updateData.date = d.date;
    if (d.startTime) updateData.startTime = d.startTime;
    if (d.endTime) updateData.endTime = d.endTime;
    if (d.eventLat !== undefined) updateData.eventLat = d.eventLat;
    if (d.eventLng !== undefined) updateData.eventLng = d.eventLng;

    const nextDate = updateData.date || before.date;
    if (d.endDate !== undefined) {
        const { endDate, error } = normalizeDateRange(nextDate, d.endDate);
        if (error) {
            const err = new Error(error);
            err.status = 400;
            throw err;
        }
        updateData.endDate = endDate;
    }

    // Se a faixa mudou, dias excluídos que ficaram fora dela deixam de fazer sentido.
    const nextEndDate = updateData.endDate !== undefined ? updateData.endDate : before.endDate;
    if (before.excludedDates && (nextDate !== before.date || nextEndDate !== before.endDate)) {
        updateData.excludedDates = pruneExcludedDates(before.excludedDates, nextDate, nextEndDate);
    }

    // Pedido de alteração: o cliente pode mexer, mas o vendedor precisa confirmar.
    const changeNote = describeScheduleChange(before, {
        date: nextDate,
        endDate: nextEndDate,
        startTime: updateData.startTime || before.startTime,
        endTime: updateData.endTime || before.endTime
    });
    if (changeNote) updateData.clientChangeNote = changeNote;

    const proposed = { ...before, ...updateData, items: [...before.items, ...normalizeItems(d.newItems)] };
    const travelError = reservations.validate(proposed);
    if (travelError) { const err = new Error(travelError + ' Entre em contato com a equipe para ajustar o deslocamento.'); err.status = 400; throw err; }
    const [otherEvents, inventory] = await Promise.all([
        prisma.event.findMany({ where: { id: { not: eventId }, status: { not: 'cancelado' } }, include: { items: true } }),
        prisma.toy.findMany({ select: { id: true, name: true, quantity: true } })
    ]);
    const reservationChanged = JSON.stringify(reservations.intervals(proposed)) !== JSON.stringify(reservations.intervals(before));
    const stockError = reservationChanged && reservations.conflict(proposed, otherEvents, inventory);
    if (stockError) { const err = new Error(stockError); err.status = 409; throw err; }

    // Assinatura simples: só registra se chegou signed=true E ainda não foi assinado.
    if (d.signed === true && !before.signedAt) {
        updateData.signedAt = new Date();
        updateData.signedName = d.clientName || null;
        updateData.signedIp = meta.ip || null;
        updateData.signedUserAgent = meta.userAgent || null;
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

    // Data e horário NÃO entram aqui de propósito: são o que o vendedor combinou e
    // servem de referência para detectar o pedido de alteração do cliente no envio
    // final (updatePublicEvent). Se o auto-save gravasse a data nova, o "antes" já
    // estaria mutado e a alteração passaria despercebida pela equipe.
    const ALLOWED = [
        'clientType', 'clientName', 'clientCpf', 'clientRg', 'clientDob',
        'clientPhone', 'clientPhoneBackup', 'clientSocial',
        'cnpj', 'companyAddress', 'repName', 'repCpf', 'repPhone', 'repPhoneBackup',
        'clientAddress', 'cep', 'complemento', 'referencia', 'bairro', 'cidade', 'uf',
        'eventLat', 'eventLng',
        'isBirthday', 'birthdayPersonName', 'birthdayPersonDob'
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

// Vendedor conferiu o pedido de alteração do cliente — some com o aviso amarelo.
async function clearClientChangeNote(id, user) {
    const eventId = parseFloat(id);
    const updated = await prisma.event.update({
        where: { id: eventId },
        data: { clientChangeNote: null, updatedBy: user?.id ? String(user.id) : null }
    });
    safeAudit({
        entityType: 'Event',
        entityId: eventId,
        action: 'UPDATE',
        user,
        changes: { clientChangeNote: { from: 'pendente', to: null } }
    });
    return updated;
}

async function listPublicToys() {
    return prisma.toy.findMany({
        select: { id: true, name: true, imageUrl: true },
        orderBy: { name: 'asc' }
    });
}

// Verifica se há conflito com outro evento em QUALQUER dia do período pedido.
// Retorna { available: boolean, reason?: string, conflictDates?: string[] } — nunca confirma
// de forma definitiva, apenas indica se *aparenta* estar livre.
async function checkAvailability({ date, endDate, startTime, endTime, excludeEventId }) {
    if (!date) return { available: false, reason: 'Data obrigatória' };

    // Rota pública e sem auth: nunca enumere uma faixa arbitrária vinda da query.
    if (countDaysInRange(date, endDate) > MAX_DIAS_PERIODO) {
        return { available: false, reason: `Período muito longo (máximo de ${MAX_DIAS_PERIODO} dias)` };
    }

    const requested = eventActiveDates({ date, endDate });
    if (requested.length === 0) return { available: false, reason: 'Data inválida' };

    const rangeStart = requested[0];
    const rangeEnd = requested[requested.length - 1];

    // Candidatos: qualquer evento cujo intervalo [date, endDate] possa tocar o período pedido.
    // endDate é null em evento de 1 dia, por isso o OR.
    const candidates = await prisma.event.findMany({
        where: {
            OR: [
                { date: { lte: rangeEnd }, OR: [{ endDate: { gte: rangeStart } }, { date: { gte: rangeStart } }] },
                { departureAt: { lte: rangeEnd + 'T24:00' }, availableAt: { gt: rangeStart + 'T00:00' } }
            ],
            status: { not: 'cancelado' },
            ...(excludeEventId ? { id: { not: parseFloat(excludeEventId) } } : {})
        },
        select: {
            id: true, date: true, endDate: true, excludedDates: true,
            startTime: true, endTime: true, eventType: true, departureAt: true, availableAt: true, dateOverrides: true, paymentStatus: true
        }
    });

    const conflicts = requested.filter(iso => {
        const request = { start: `${iso}T${startTime || '00:00'}`, end: `${iso}T${endTime || '24:00'}` };
        return candidates.some(e => reservations.intervals(e).some(i => reservations.overlap(request, i)));
    });
    if (!conflicts.length) return { available: true };
    return { available: false, conflictDates: conflicts, reason: 'Há eventos ou equipamentos em deslocamento no período solicitado. Consulte a equipe.' };
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
            if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403) {
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
    setEventAssignments,
    deleteEvent,
    listEventsFull,
    getEventByCode,
    parseEventCodeInput,
    getPublicEvent,
    updatePublicEvent,
    saveDraftPublicEvent,
    clearClientChangeNote,
    listPublicToys,
    checkAvailability,
    uploadContract,
    removeContract
};

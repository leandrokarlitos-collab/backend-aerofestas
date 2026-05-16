const crypto = require('crypto');
const prisma = require('../prisma/client');
const { logAudit, computeChanges } = require('./audit');
const PropostaTemplateService = require('./PropostaTemplateService');

const TRACKED_FIELDS = [
    'clientName', 'clientPhone', 'eventTitle', 'eventDate', 'eventTime', 'eventLocation',
    'showPrices', 'discountType', 'discountValue', 'subtotal', 'total', 'observacoes',
    'templateId', 'heroEyebrow', 'heroTitle', 'heroSubtitle', 'whatsappNumber',
    'whatsappMessage', 'brandPillText', 'ogImageUrl', 'status'
];

const RESERVED_SLUGS = new Set(['maple-bear', 'view', 'preview', 'admin', 'api', 'p', 'propostas', 'index', 'login']);

function safeAudit(payload) {
    try {
        Promise.resolve(logAudit(payload)).catch(err =>
            console.error('[audit] falha silenciosa:', err)
        );
    } catch (err) {
        console.error('[audit] falha sincrona silenciosa:', err);
    }
}

const toFloatOr = (v, fallback) =>
    (v !== undefined && v !== null && v !== '') ? parseFloat(v) : fallback;

function slugify(text) {
    // Remove combining diacritical marks (U+0300..U+036F) após decompor com NFD
    return String(text || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'proposta';
}

async function generateUniqueSlug(clientName, eventTitle) {
    const base = slugify(eventTitle || clientName);
    for (let attempt = 0; attempt < 6; attempt++) {
        const suffix = crypto.randomBytes(2).toString('hex'); // 4 chars hex
        const candidate = `${base}-${suffix}`;
        if (RESERVED_SLUGS.has(candidate) || RESERVED_SLUGS.has(base)) continue;
        const exists = await prisma.proposta.findUnique({ where: { slug: candidate }, select: { id: true } });
        if (!exists) return candidate;
    }
    // Fallback determinístico
    return `${base}-${Date.now().toString(36).slice(-6)}`;
}

function normalizeItems(rawItems, showPrices) {
    return (rawItems || [])
        .map((item, idx) => {
            const toyId = item.toyId ? parseFloat(item.toyId) : (item.id ? parseFloat(item.id) : null);
            return {
                toyId: Number.isFinite(toyId) ? toyId : null,
                quantity: Math.max(1, parseInt(item.quantity) || 1),
                unitPrice: showPrices ? toFloatOr(item.unitPrice ?? item.price, null) : null,
                order: Number.isFinite(item.order) ? parseInt(item.order) : idx,
                toyNameSnapshot: item.toyNameSnapshot || item.name || null,
                toyImageSnapshot: item.toyImageSnapshot || item.imageUrl || null
            };
        })
        .filter(i => i.toyId !== null);
}

async function enrichItemSnapshots(items) {
    // Para cada item, garante que tenha toyNameSnapshot e toyImageSnapshot.
    // Se vier do frontend sem snapshot, busca do Toy.
    const toyIds = [...new Set(items.map(i => i.toyId).filter(Boolean))];
    if (!toyIds.length) return items;

    const toys = await prisma.toy.findMany({
        where: { id: { in: toyIds } },
        include: {
            photos: {
                where: { isPrimary: true },
                take: 1,
                select: { url: true }
            }
        }
    });
    const byId = new Map(toys.map(t => [t.id, t]));

    return items.map(item => {
        const toy = byId.get(item.toyId);
        return {
            ...item,
            toyNameSnapshot: item.toyNameSnapshot || toy?.name || null,
            toyImageSnapshot: item.toyImageSnapshot || toy?.photos?.[0]?.url || toy?.imageUrl || null
        };
    });
}

function computeFinancials(items, showPrices, discountType, discountValue) {
    if (!showPrices) {
        return { subtotal: null, total: null, discountType: null, discountValue: null };
    }
    const subtotal = items.reduce((acc, it) => {
        if (it.unitPrice == null) return acc;
        return acc + (it.unitPrice * it.quantity);
    }, 0);
    let descontoCalc = 0;
    if (discountType === 'percent' && discountValue) {
        descontoCalc = subtotal * (parseFloat(discountValue) / 100);
    } else if (discountType === 'value' && discountValue) {
        descontoCalc = parseFloat(discountValue);
    }
    const total = Math.max(0, subtotal - descontoCalc);
    return {
        subtotal,
        total,
        discountType: descontoCalc > 0 ? discountType : null,
        discountValue: descontoCalc > 0 ? parseFloat(discountValue) : null
    };
}

function buildPropostaFields(data, user) {
    const showPrices = !!data.showPrices;
    return {
        clientName: String(data.clientName || '').trim() || 'Cliente',
        clientId: data.clientId ? parseFloat(data.clientId) : null,
        clientPhone: data.clientPhone ? String(data.clientPhone).replace(/\D/g, '') : null,

        eventTitle: data.eventTitle ? String(data.eventTitle).trim() : null,
        eventDate: data.eventDate || null,
        eventTime: data.eventTime ? String(data.eventTime).trim() : null,
        eventLocation: data.eventLocation ? String(data.eventLocation).trim() : null,
        eventDetails: data.eventDetails ? String(data.eventDetails).trim() : null,

        showPrices,
        observacoes: data.observacoes ? String(data.observacoes).trim() : null,

        templateId: data.templateId || null,
        // Overrides (todos opcionais — empty string vira null)
        heroEyebrow: data.heroEyebrow?.trim() || null,
        heroTitle: data.heroTitle?.trim() || null,
        heroSubtitle: data.heroSubtitle?.trim() || null,
        whatsappNumber: data.whatsappNumber ? String(data.whatsappNumber).replace(/\D/g, '') : null,
        whatsappMessage: data.whatsappMessage?.trim() || null,
        brandPillText: data.brandPillText?.trim() || null,
        whyCards: data.whyCards || null,
        faq: data.faq || null,
        howItWorks: data.howItWorks || null,
        ogImageUrl: data.ogImageUrl || null,

        status: data.status || 'draft',
        updatedBy: user?.id || null
    };
}

async function listPropostas() {
    return prisma.proposta.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
            client: { select: { id: true, name: true, phone: true } },
            template: { select: { id: true, nome: true } },
            items: {
                orderBy: { order: 'asc' },
                include: { toy: { select: { id: true, name: true, imageUrl: true } } }
            }
        }
    });
}

async function getById(id) {
    const propostaId = parseFloat(id);
    if (!Number.isFinite(propostaId)) return null;
    return prisma.proposta.findUnique({
        where: { id: propostaId },
        include: {
            client: true,
            template: true,
            items: {
                orderBy: { order: 'asc' },
                include: {
                    toy: {
                        include: {
                            photos: { orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }] }
                        }
                    }
                }
            }
        }
    });
}

async function upsertProposta(data, user) {
    const isUpdate = !!data.id;
    const propostaId = isUpdate ? parseFloat(data.id) : Date.now();

    const existing = isUpdate
        ? await prisma.proposta.findUnique({ where: { id: propostaId }, include: { items: true } })
        : null;

    const showPrices = !!data.showPrices;
    const rawItems = normalizeItems(data.items || [], showPrices);
    const items = await enrichItemSnapshots(rawItems);
    const financials = computeFinancials(items, showPrices, data.discountType, data.discountValue);

    const fields = buildPropostaFields(data, user);

    let slug = existing?.slug;
    if (!slug) {
        slug = await generateUniqueSlug(fields.clientName, fields.eventTitle);
    }

    const dataToSave = {
        ...fields,
        ...financials
    };

    if (isUpdate) {
        // Apaga items antigos e recria (mesmo padrão de EventService)
        await prisma.propostaItem.deleteMany({ where: { propostaId } });
    }

    const saved = await prisma.proposta.upsert({
        where: { id: propostaId },
        update: {
            ...dataToSave,
            items: { create: items }
        },
        create: {
            id: propostaId,
            slug,
            ...dataToSave,
            createdBy: user?.id || null,
            items: { create: items }
        },
        include: {
            template: true,
            client: true,
            items: { orderBy: { order: 'asc' }, include: { toy: true } }
        }
    });

    const snapshot = { clientName: saved.clientName, slug: saved.slug, total: saved.total };
    if (isUpdate && existing) {
        const changes = computeChanges(existing, saved, TRACKED_FIELDS);
        safeAudit({ entityType: 'Proposta', entityId: propostaId, action: 'UPDATE', user, changes, snapshot });
    } else {
        safeAudit({ entityType: 'Proposta', entityId: propostaId, action: 'CREATE', user, snapshot });
    }

    return saved;
}

async function duplicateProposta(id, user) {
    const original = await getById(id);
    if (!original) {
        const err = new Error('Proposta não encontrada');
        err.status = 404;
        throw err;
    }

    const newSlug = await generateUniqueSlug(`${original.clientName} copia`, original.eventTitle);
    const newId = Date.now();

    const saved = await prisma.proposta.create({
        data: {
            id: newId,
            slug: newSlug,
            status: 'draft',
            clientName: original.clientName,
            clientId: original.clientId,
            clientPhone: original.clientPhone,
            eventTitle: original.eventTitle,
            eventDate: original.eventDate,
            eventTime: original.eventTime,
            eventLocation: original.eventLocation,
            eventDetails: original.eventDetails,
            showPrices: original.showPrices,
            discountType: original.discountType,
            discountValue: original.discountValue,
            subtotal: original.subtotal,
            total: original.total,
            observacoes: original.observacoes,
            templateId: original.templateId,
            heroEyebrow: original.heroEyebrow,
            heroTitle: original.heroTitle,
            heroSubtitle: original.heroSubtitle,
            whatsappNumber: original.whatsappNumber,
            whatsappMessage: original.whatsappMessage,
            brandPillText: original.brandPillText,
            whyCards: original.whyCards,
            faq: original.faq,
            howItWorks: original.howItWorks,
            ogImageUrl: original.ogImageUrl,
            createdBy: user?.id || null,
            items: {
                create: original.items.map(it => ({
                    toyId: it.toyId,
                    quantity: it.quantity,
                    unitPrice: it.unitPrice,
                    order: it.order,
                    toyNameSnapshot: it.toyNameSnapshot,
                    toyImageSnapshot: it.toyImageSnapshot
                }))
            }
        },
        include: { items: true, template: true, client: true }
    });

    safeAudit({
        entityType: 'Proposta',
        entityId: newId,
        action: 'CREATE',
        user,
        snapshot: { clientName: saved.clientName, slug: saved.slug, duplicatedFrom: original.id }
    });

    return saved;
}

async function deleteProposta(id, user) {
    const propostaId = parseFloat(id);
    if (!Number.isFinite(propostaId)) {
        const err = new Error('ID inválido');
        err.status = 400;
        throw err;
    }

    const existing = await prisma.proposta.findUnique({ where: { id: propostaId } });
    if (!existing) {
        const err = new Error('Proposta não encontrada');
        err.status = 404;
        throw err;
    }

    // PropostaItem tem onDelete: Cascade no schema, então caem juntos
    await prisma.proposta.delete({ where: { id: propostaId } });

    safeAudit({
        entityType: 'Proposta',
        entityId: propostaId,
        action: 'DELETE',
        user,
        snapshot: { clientName: existing.clientName, slug: existing.slug }
    });
}

// View-model público: aplica coalescência template → override e snapshots
function mergeWithTemplate(proposta, publicUrl) {
    const template = proposta.template;
    const FALLBACKS = {
        heroEyebrow: 'Proposta exclusiva',
        heroTitle: 'Atrações para o seu evento',
        heroSubtitle: 'Brinquedos premium selecionados especialmente para você.',
        brandPillText: 'Aero Festas',
        whatsappNumber: '5562985545046',
        whatsappMessage: 'Olá! Gostaria de conversar sobre a proposta {{propostaUrl}}.',
        whyCards: '[]',
        faq: '[]',
        howItWorks: '[]',
        ogImageUrl: null
    };

    const pick = (field) => proposta[field] ?? template?.[field] ?? FALLBACKS[field];

    const parseJsonSafe = (raw, fallback) => {
        if (!raw) return fallback;
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : fallback;
        } catch {
            return fallback;
        }
    };

    const whatsappMessageRaw = pick('whatsappMessage');
    const whatsappMessage = String(whatsappMessageRaw || '')
        .replaceAll('{{clientName}}', proposta.clientName || '')
        .replaceAll('{{propostaUrl}}', publicUrl || '')
        .replaceAll('{{eventDate}}', proposta.eventDate || '')
        .replaceAll('{{eventTitle}}', proposta.eventTitle || '');

    return {
        id: proposta.id,
        slug: proposta.slug,
        status: proposta.status,

        clientName: proposta.clientName,
        clientPhone: proposta.clientPhone,

        eventTitle: proposta.eventTitle,
        eventDate: proposta.eventDate,
        eventTime: proposta.eventTime,
        eventLocation: proposta.eventLocation,
        eventDetails: proposta.eventDetails,

        showPrices: !!proposta.showPrices,
        subtotal: proposta.subtotal,
        total: proposta.total,
        discountType: proposta.discountType,
        discountValue: proposta.discountValue,
        observacoes: proposta.observacoes,

        // Conteúdo merged (override → template → fallback)
        heroEyebrow: pick('heroEyebrow'),
        heroTitle: pick('heroTitle'),
        heroSubtitle: pick('heroSubtitle'),
        brandPillText: pick('brandPillText'),
        whatsappNumber: pick('whatsappNumber'),
        whatsappMessage,
        whyCards: parseJsonSafe(pick('whyCards'), []),
        faq: parseJsonSafe(pick('faq'), []),
        howItWorks: parseJsonSafe(pick('howItWorks'), []),
        ogImageUrl: pick('ogImageUrl'),

        items: (proposta.items || []).map(it => ({
            id: it.id,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            order: it.order,
            name: it.toyNameSnapshot || it.toy?.name || 'Item',
            imageUrl: it.toyImageSnapshot
                || it.toy?.photos?.find(p => p.isPrimary)?.url
                || it.toy?.photos?.[0]?.url
                || it.toy?.imageUrl
                || null,
            // Galeria completa para lightbox (todas as fotos do Toy)
            photos: (it.toy?.photos || []).map(p => p.url)
        }))
    };
}

async function getPublicProposta(slug) {
    if (!slug || typeof slug !== 'string') return null;
    const proposta = await prisma.proposta.findUnique({
        where: { slug },
        include: {
            template: true,
            client: { select: { id: true, name: true, phone: true } },
            items: {
                orderBy: { order: 'asc' },
                include: {
                    toy: {
                        include: {
                            photos: {
                                orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }]
                            }
                        }
                    }
                }
            }
        }
    });

    if (!proposta) return null;

    // Telemetria leve em background — não bloqueia o response
    const isFirstView = proposta.viewedAt === null;
    prisma.proposta.update({
        where: { id: proposta.id },
        data: {
            viewedAt: isFirstView ? new Date() : proposta.viewedAt,
            viewCount: { increment: 1 },
            status: isFirstView && proposta.status === 'sent' ? 'viewed' : proposta.status
        }
    }).catch(err => console.error('[Proposta] Falha ao registrar view:', err));

    // URL pública canônica (preferencialmente o rewrite curto /p/<slug>)
    const baseUrl = process.env.PUBLIC_BASE_URL || 'https://agenda-aero-festas.web.app';
    const publicUrl = `${baseUrl}/p/${proposta.slug}`;

    return mergeWithTemplate(proposta, publicUrl);
}

module.exports = {
    listPropostas,
    getById,
    upsertProposta,
    duplicateProposta,
    deleteProposta,
    getPublicProposta,
    generateUniqueSlug
};

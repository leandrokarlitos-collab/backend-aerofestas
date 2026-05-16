const prisma = require('../prisma/client');
const { logAudit, computeChanges } = require('./audit');

const TRACKED_FIELDS = [
    'nome', 'isDefault', 'heroEyebrow', 'heroTitle', 'heroSubtitle', 'brandPillText',
    'whyCards', 'faq', 'howItWorks', 'whatsappNumber', 'whatsappMessage', 'ogImageUrl'
];

function safeAudit(payload) {
    try {
        Promise.resolve(logAudit(payload)).catch(err =>
            console.error('[audit] falha silenciosa:', err)
        );
    } catch (err) {
        console.error('[audit] falha sincrona silenciosa:', err);
    }
}

// Valida que uma string é JSON parseável; se vazia/null retorna null
function validateJsonString(value, fieldName) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') value = JSON.stringify(value);
    try {
        JSON.parse(value);
        return value;
    } catch (e) {
        const err = new Error(`Campo ${fieldName} contém JSON inválido`);
        err.status = 400;
        throw err;
    }
}

// Seed inicial caso ninguém exista. Idempotente.
const SEED_TEMPLATE = {
    nome: 'Template padrão Aero Festas',
    isDefault: true,
    heroEyebrow: 'Proposta exclusiva',
    heroTitle: 'Atrações para o seu evento',
    heroSubtitle: 'Selecionamos brinquedos premium para uma festa inesquecível — com segurança, monitoria treinada e o cuidado que seu evento merece.',
    brandPillText: 'Aero Festas',
    whyCards: JSON.stringify([
        { icon: 'shield-halved', title: 'Equipamentos certificados', body: 'Inspeção a cada locação e manutenção preventiva contínua.' },
        { icon: 'user-shield', title: 'Monitoria treinada', body: 'Equipe capacitada para garantir a segurança e diversão das crianças.' },
        { icon: 'truck-fast', title: 'Logística sem dor de cabeça', body: 'Entrega, montagem e desmontagem por nossa conta. Você só curte.' },
        { icon: 'heart', title: 'Atendimento próximo', body: 'Acompanhamos sua festa do orçamento ao desmonte. Você nunca está sozinho.' }
    ]),
    faq: JSON.stringify([
        { q: 'Vocês fazem a montagem dos brinquedos?', a: 'Sim! A montagem e desmontagem estão sempre inclusas.' },
        { q: 'Os monitores acompanham a festa toda?', a: 'Sim, nossos monitores ficam no local durante todo o evento, garantindo segurança e organização.' },
        { q: 'Quantos brinquedos cabem no meu espaço?', a: 'Visitamos o local antes do evento para garantir a melhor configuração possível.' }
    ]),
    howItWorks: JSON.stringify([
        { num: 1, title: 'Confirmação da proposta', body: 'Você nos avisa pelo WhatsApp que aceitou e definimos os detalhes finais.' },
        { num: 2, title: 'Sinal de reserva', body: 'Confirmamos a data com um pequeno sinal — o restante fica para depois do evento.' },
        { num: 3, title: 'Dia do evento', body: 'Chegamos antes do horário, montamos, monitoramos e desmontamos. Você curte.' }
    ]),
    whatsappNumber: '5562985545046',
    whatsappMessage: 'Olá! Sou {{clientName}} e gostaria de conversar sobre a proposta {{propostaUrl}}.',
    ogImageUrl: null
};

async function ensureDefaultTemplate() {
    const existing = await prisma.propostaTemplate.findFirst({ where: { isDefault: true } });
    if (existing) return existing;

    const created = await prisma.propostaTemplate.create({
        data: {
            id: require('crypto').randomUUID(),
            ...SEED_TEMPLATE
        }
    });
    console.log('[PropostaTemplate] Seed default criado:', created.id);
    return created;
}

async function listTemplates() {
    return prisma.propostaTemplate.findMany({
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }]
    });
}

async function getById(id) {
    return prisma.propostaTemplate.findUnique({ where: { id: String(id) } });
}

async function getDefault() {
    const found = await prisma.propostaTemplate.findFirst({ where: { isDefault: true } });
    if (found) return found;
    return ensureDefaultTemplate();
}

async function upsertTemplate(data, user) {
    const id = data.id ? String(data.id) : require('crypto').randomUUID();
    const isUpdate = !!data.id;

    // Valida JSONs antes de gravar — evita render quebrado na proposta pública
    const whyCards = validateJsonString(data.whyCards, 'whyCards');
    const faq = validateJsonString(data.faq, 'faq');
    const howItWorks = validateJsonString(data.howItWorks, 'howItWorks');

    if (!whyCards) {
        const err = new Error('whyCards é obrigatório');
        err.status = 400;
        throw err;
    }
    if (!howItWorks) {
        const err = new Error('howItWorks é obrigatório');
        err.status = 400;
        throw err;
    }

    const existing = isUpdate ? await prisma.propostaTemplate.findUnique({ where: { id } }) : null;

    const payload = {
        nome: String(data.nome || 'Template sem nome').trim(),
        isDefault: !!data.isDefault,
        heroEyebrow: String(data.heroEyebrow || '').trim(),
        heroTitle: String(data.heroTitle || '').trim(),
        heroSubtitle: String(data.heroSubtitle || '').trim(),
        brandPillText: data.brandPillText ? String(data.brandPillText).trim() : null,
        whyCards,
        faq,
        howItWorks,
        whatsappNumber: String(data.whatsappNumber || '').replace(/\D/g, ''),
        whatsappMessage: String(data.whatsappMessage || '').trim(),
        ogImageUrl: data.ogImageUrl || null,
        updatedBy: user?.id || null
    };

    const saved = await prisma.propostaTemplate.upsert({
        where: { id },
        update: payload,
        create: { id, ...payload, createdBy: user?.id || null }
    });

    // Se foi marcado como default, zerar nos outros (transação atômica)
    if (saved.isDefault) {
        await prisma.propostaTemplate.updateMany({
            where: { id: { not: saved.id }, isDefault: true },
            data: { isDefault: false }
        });
    }

    const snapshot = { nome: saved.nome, isDefault: saved.isDefault };
    if (isUpdate && existing) {
        const changes = computeChanges(existing, saved, TRACKED_FIELDS);
        safeAudit({ entityType: 'PropostaTemplate', entityId: saved.id, action: 'UPDATE', user, changes, snapshot });
    } else {
        safeAudit({ entityType: 'PropostaTemplate', entityId: saved.id, action: 'CREATE', user, snapshot });
    }

    return saved;
}

async function setDefault(id, user) {
    const targetId = String(id);
    const target = await prisma.propostaTemplate.findUnique({ where: { id: targetId } });
    if (!target) {
        const err = new Error('Template não encontrado');
        err.status = 404;
        throw err;
    }

    await prisma.$transaction([
        prisma.propostaTemplate.updateMany({
            where: { id: { not: targetId }, isDefault: true },
            data: { isDefault: false }
        }),
        prisma.propostaTemplate.update({
            where: { id: targetId },
            data: { isDefault: true, updatedBy: user?.id || null }
        })
    ]);

    safeAudit({
        entityType: 'PropostaTemplate',
        entityId: targetId,
        action: 'UPDATE',
        user,
        changes: { isDefault: { old: target.isDefault, new: true } },
        snapshot: { nome: target.nome, isDefault: true }
    });

    return prisma.propostaTemplate.findUnique({ where: { id: targetId } });
}

async function deleteTemplate(id, user) {
    const targetId = String(id);
    const existing = await prisma.propostaTemplate.findUnique({ where: { id: targetId } });
    if (!existing) {
        const err = new Error('Template não encontrado');
        err.status = 404;
        throw err;
    }

    if (existing.isDefault) {
        const err = new Error('Não é possível excluir o template padrão. Defina outro como padrão antes.');
        err.status = 409;
        throw err;
    }

    const inUse = await prisma.proposta.count({ where: { templateId: targetId } });
    if (inUse > 0) {
        const err = new Error(`Este template está sendo usado por ${inUse} proposta(s). Troque o template delas antes de excluir.`);
        err.status = 409;
        throw err;
    }

    await prisma.propostaTemplate.delete({ where: { id: targetId } });

    safeAudit({
        entityType: 'PropostaTemplate',
        entityId: targetId,
        action: 'DELETE',
        user,
        snapshot: { nome: existing.nome, isDefault: existing.isDefault }
    });
}

module.exports = {
    listTemplates,
    getById,
    getDefault,
    ensureDefaultTemplate,
    upsertTemplate,
    setDefault,
    deleteTemplate,
    SEED_TEMPLATE
};

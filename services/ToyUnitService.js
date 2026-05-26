const prisma = require('../prisma/client');
const { logAudit, computeChanges } = require('./audit');

const VALID_CONDITIONS = ['OK', 'DESCONHECIDO', 'MOLHADO', 'UMIDO', 'SUJO', 'MOFADO', 'DANIFICADO', 'EM_MANUTENCAO', 'OUTROS'];

// Severidade: 0 = OK, 7 = pior. Usada para derivar o "condition" (string única, legado)
// a partir do array "conditions".
const CONDITION_SEVERITY = {
    OK: 0, OUTROS: 1, SUJO: 2, UMIDO: 3, MOLHADO: 4, DESCONHECIDO: 4,
    EM_MANUTENCAO: 5, MOFADO: 7, DANIFICADO: 7
};

const TRACKED_FIELDS = ['condition', 'conditions', 'conditionDetails'];

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
 * Normaliza um payload de estado vindo do cliente.
 * Aceita:
 *   - conditions: ['SUJO', 'MOLHADO']  (preferido)
 *   - condition: 'SUJO'                 (legado / fallback)
 * Regras:
 *   - 'OK' é mutuamente exclusivo: se aparecer junto com outros, prevalecem os outros.
 *   - Sem nada selecionado => ['OK'].
 *   - Sem duplicados, todos em UPPERCASE, validados contra VALID_CONDITIONS.
 *   - Ordena pelo VALID_CONDITIONS (estável para diffs/auditoria).
 */
function normalizeConditions(payload) {
    let list = [];

    if (Array.isArray(payload.conditions)) {
        list = payload.conditions;
    } else if (payload.condition != null) {
        list = [payload.condition];
    }

    list = list
        .map(c => String(c || '').toUpperCase().trim())
        .filter(Boolean);

    // Dedup preservando primeira ocorrência
    list = [...new Set(list)];

    // Se há outros estados além de OK, remove OK
    if (list.length > 1 && list.includes('OK')) {
        list = list.filter(c => c !== 'OK');
    }

    // Vazio => OK
    if (!list.length) list = ['OK'];

    // Ordena pelo VALID_CONDITIONS (mantém ordem canônica)
    list.sort((a, b) => VALID_CONDITIONS.indexOf(a) - VALID_CONDITIONS.indexOf(b));

    return list;
}

function worstOf(list) {
    return list.reduce((worst, c) => {
        const sev = CONDITION_SEVERITY[c] ?? 0;
        const worstSev = CONDITION_SEVERITY[worst] ?? 0;
        return sev > worstSev ? c : worst;
    }, 'OK');
}

/**
 * Garante que ToyUnit.count >= qty. Se houver menos, cria as faltantes.
 * NUNCA apaga unidades existentes (preserva histórico de auditoria).
 * Se qty diminuir, as unidades com unitNumber > qty ficam "inativas" (filtradas no list).
 */
async function syncUnitsToQuantity(toyId, qty) {
    const id = parseFloat(toyId);
    if (isNaN(id)) throw new Error('toyId inválido');
    const targetQty = Math.max(0, parseInt(qty) || 0);

    const existing = await prisma.toyUnit.findMany({
        where: { toyId: id },
        orderBy: { unitNumber: 'asc' }
    });

    const currentMax = existing.reduce((max, u) => Math.max(max, u.unitNumber), 0);
    const currentCount = existing.length;

    if (currentCount >= targetQty) return existing;

    const toCreate = [];
    let next = currentMax + 1;
    for (let i = currentCount; i < targetQty; i++) {
        toCreate.push({
            toyId: id,
            unitNumber: next++,
            condition: 'OK',
            conditions: ['OK'],
            conditionDetails: null
        });
    }

    if (toCreate.length) {
        await prisma.toyUnit.createMany({ data: toCreate });
    }

    return prisma.toyUnit.findMany({
        where: { toyId: id },
        orderBy: { unitNumber: 'asc' }
    });
}

/**
 * Lista unidades ativas (unitNumber <= toy.quantity) ordenadas.
 */
async function listUnitsByToy(toyId) {
    const id = parseFloat(toyId);
    if (isNaN(id)) throw new Error('toyId inválido');

    const toy = await prisma.toy.findUnique({ where: { id } });
    if (!toy) return [];

    const units = await prisma.toyUnit.findMany({
        where: { toyId: id, unitNumber: { lte: toy.quantity } },
        orderBy: { unitNumber: 'asc' }
    });
    return units;
}

/**
 * Atualiza condição de uma unidade.
 * Aceita array (conditions) ou string única (condition, legado).
 * Salva ambos os campos: conditions[] = lista normalizada; condition = pior estado.
 */
async function updateCondition(toyId, unitId, payload, user) {
    const id = parseInt(unitId);
    const tId = parseFloat(toyId);
    if (isNaN(id) || isNaN(tId)) {
        const err = new Error('IDs inválidos');
        err.status = 400;
        throw err;
    }

    const conditions = normalizeConditions(payload);

    const invalid = conditions.find(c => !VALID_CONDITIONS.includes(c));
    if (invalid) {
        const err = new Error(`Estado inválido: ${invalid}. Valores aceitos: ${VALID_CONDITIONS.join(', ')}`);
        err.status = 400;
        throw err;
    }

    const conditionDetails = payload.conditionDetails != null
        ? String(payload.conditionDetails).trim()
        : null;

    if (conditions.includes('OUTROS') && !conditionDetails) {
        const err = new Error('Quando o estado é "OUTROS", o campo "Mais detalhes" é obrigatório.');
        err.status = 400;
        throw err;
    }

    const existing = await prisma.toyUnit.findUnique({ where: { id } });
    if (!existing || existing.toyId !== tId) {
        const err = new Error('Unidade não encontrada');
        err.status = 404;
        throw err;
    }

    const condition = worstOf(conditions);

    const saved = await prisma.toyUnit.update({
        where: { id },
        data: {
            condition,
            conditions,
            conditionDetails: conditionDetails || null,
            conditionUpdatedBy: user?.name || user?.email || null
        }
    });

    const changes = computeChanges(existing, saved, TRACKED_FIELDS);
    if (changes) {
        safeAudit({
            entityType: 'ToyUnit',
            entityId: id,
            action: 'UPDATE',
            user,
            changes,
            snapshot: {
                toyId: saved.toyId,
                unitNumber: saved.unitNumber,
                condition: saved.condition,
                conditions: saved.conditions,
                conditionDetails: saved.conditionDetails
            }
        });
    }

    return saved;
}

module.exports = {
    syncUnitsToQuantity,
    listUnitsByToy,
    updateCondition,
    VALID_CONDITIONS,
    CONDITION_SEVERITY,
    normalizeConditions,
    worstOf
};

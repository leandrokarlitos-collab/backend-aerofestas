const express = require('express');
const { authenticate } = require('../middleware/auth');
const ClientService = require('../services/ClientService');
const prisma = require('../prisma/client');
const { logAudit, computeChanges } = require('../services/audit');

const router = express.Router();

// Auditoria fire-and-forget (mesmo padrão do ClientService)
function safeAudit(payload) {
    try {
        Promise.resolve(logAudit(payload)).catch(err =>
            console.error('[audit] falha silenciosa:', err)
        );
    } catch (err) {
        console.error('[audit] falha síncrona silenciosa:', err);
    }
}

// ===================== Helpers CRM v3 =====================

const VALID_STAGES = ['novo', 'contato', 'proposta', 'negociacao', 'fechado', 'pos_venda', 'perdido'];

// Mapeamento do CRM legado (estágios numéricos) → strings do contrato
const LEGACY_STAGE_MAP = {
    '1': 'novo',        // Apresentação
    '2': 'contato',     // Sondagem
    '3': 'proposta',    // Proposta
    '4': 'negociacao',  // Negociação
    '5': 'fechado',     // Ganho
    '6': 'pos_venda',   // Pós-venda
    '99': 'perdido'     // Locação Perdida
};

// Campos que o import pode preencher em clientes casados (apenas quando vazios no banco)
const IMPORT_FIELDS = ['phone', 'email', 'instagram', 'birthday', 'stage', 'source', 'tags'];

// Campos aceitos no PATCH /:id
const PATCH_FIELDS = ['name', 'phone', 'address', 'cpf', 'email', 'instagram', 'birthday', 'stage', 'source', 'tags', 'lastContactAt'];

function isEmpty(v) {
    return v === null || v === undefined || String(v).trim() === '';
}

// Nome normalizado: sem acento (NFD), caixa baixa, espaços colapsados
function normalizeName(name) {
    return String(name || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

// Últimos 8 dígitos do telefone (só dígitos); '' se não houver telefone
function phoneLast8(phone) {
    return String(phone || '').replace(/\D/g, '').slice(-8);
}

function matchKey(name, phone) {
    return `${normalizeName(name)}|${phoneLast8(phone)}`;
}

// Aceita string do contrato ou estágio numérico legado; null se inválido/vazio
function normalizeStage(stage) {
    if (stage === null || stage === undefined || stage === '') return null;
    const s = String(stage).trim();
    if (LEGACY_STAGE_MAP[s]) return LEGACY_STAGE_MAP[s];
    return VALID_STAGES.includes(s) ? s : null;
}

// tags: array → JSON string; string mantida como está
function normalizeTags(tags) {
    if (tags === null || tags === undefined || tags === '') return null;
    if (Array.isArray(tags)) return JSON.stringify(tags);
    if (typeof tags === 'string') return tags;
    return null;
}

// Estrito: parseFloat aceitaria lixo parcial ('123abc'→123, '123,45'→123)
// e atualizaria o cliente ERRADO — só dígitos com fração decimal opcional.
const CLIENT_ID_RE = /^\d+(\.\d+)?$/;
function parseClientId(raw) {
    const s = String(raw ?? '').trim();
    if (!CLIENT_ID_RE.test(s)) return null;
    const id = Number(s);
    return isNaN(id) ? null : id;
}

const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// dueDate válida: formato E data possível (rejeita 2026-13-40)
function dueDateValida(s) {
    return DUE_DATE_RE.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime());
}

// tags equivalentes: compara arrays JSON parseados e ordenados
// ('["a","b"]' ≡ '["b","a"]' — ordem/espaçamento não é conflito)
function tagsEquivalentes(a, b) {
    try {
        const pa = JSON.parse(a), pb = JSON.parse(b);
        if (!Array.isArray(pa) || !Array.isArray(pb)) return false;
        return JSON.stringify([...pa].sort()) === JSON.stringify([...pb].sort());
    } catch { return false; }
}

// ===================== ROTAS EXISTENTES (preservadas) =====================

router.get('/', authenticate, async (req, res, next) => {
    try {
        const clients = await ClientService.listClients();
        res.json(clients);
    } catch (err) { next(err); }
});

router.post('/', authenticate, async (req, res, next) => {
    try {
        const { id, ...payload } = req.body;
        const saved = id
            ? await ClientService.updateClient(id, payload, req.user)
            : await ClientService.createClient(payload, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

// ===================== CRM v3: rotas fixas ANTES de /:id =====================
// (ordem importa: /follow-ups/pending, /follow-ups/:id, /notes/:noteId e
//  /import-local precisam vir antes das rotas com :id genérico)

// GET /follow-ups/pending → follow-ups em aberto com nome do cliente
router.get('/follow-ups/pending', authenticate, async (req, res, next) => {
    try {
        const pending = await prisma.clientFollowUp.findMany({
            where: { done: false },
            orderBy: { dueDate: 'asc' },
            include: { client: { select: { name: true } } }
        });
        res.json(pending.map(f => ({
            id: f.id,
            dueDate: f.dueDate,
            note: f.note,
            clientId: f.clientId,
            clientName: f.client ? f.client.name : null
        })));
    } catch (err) { next(err); }
});

// PATCH /follow-ups/:id → {done}
router.patch('/follow-ups/:id', authenticate, async (req, res, next) => {
    try {
        const { done } = req.body || {};
        if (typeof done !== 'boolean') {
            return res.status(400).json({ error: 'Campo "done" (boolean) é obrigatório' });
        }
        const updated = await prisma.clientFollowUp.update({
            where: { id: req.params.id },
            data: { done, doneAt: done ? new Date() : null }
        });
        res.json({ success: true, data: updated });
    } catch (err) {
        if (err.code === 'P2025') {
            return res.status(404).json({ error: 'Follow-up não encontrado' });
        }
        next(err);
    }
});

// DELETE /notes/:noteId
router.delete('/notes/:noteId', authenticate, async (req, res, next) => {
    try {
        await prisma.clientNote.delete({ where: { id: req.params.noteId } });
        res.json({ success: true });
    } catch (err) {
        if (err.code === 'P2025') {
            return res.status(404).json({ error: 'Nota não encontrada' });
        }
        next(err);
    }
});

// POST /import-local?dryRun=1 → importação idempotente e NUNCA destrutiva do CRM local
router.post('/import-local', authenticate, async (req, res, next) => {
    try {
        const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
        const items = req.body && req.body.items;
        if (!Array.isArray(items)) {
            return res.status(400).json({ error: 'Corpo inválido: esperado {items:[...]}' });
        }
        if (items.length > 5000) {
            return res.status(400).json({ error: 'Limite de 5000 itens por importação' });
        }

        // Carrega todos os clientes com notas/follow-ups para casamento e dedupe
        const existing = await prisma.client.findMany({
            include: {
                notes: { select: { text: true } },
                followUps: { select: { dueDate: true, note: true } }
            }
        });

        const byId = new Map();
        const byKey = new Map();
        for (const c of existing) {
            byId.set(c.id, c);
            const key = matchKey(c.name, c.phone);
            if (!byKey.has(key)) byKey.set(key, c);
        }

        const report = {
            dryRun,
            matched: 0,
            created: 0,
            fieldsFilled: 0,
            notesCreated: 0,
            followUpsCreated: 0,
            followUpsInvalid: 0, // dueDate fora de YYYY-MM-DD ou data impossível
            skipped: 0,
            conflicts: [],
            errors: []           // falhas por item — os demais itens seguem
        };
        const createdBy = (req.user && req.user.email) || null;
        const baseId = Date.now();

        for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx] || {};
            const name = typeof item.name === 'string' ? item.name.trim() : '';
            if (!name) { report.skipped++; continue; }
            try {

            // Valores locais normalizados
            const local = {
                phone: isEmpty(item.phone) ? null : String(item.phone).trim(),
                email: isEmpty(item.email) ? null : String(item.email).trim(),
                instagram: isEmpty(item.instagram) ? null : String(item.instagram).trim(),
                birthday: isEmpty(item.birthday) ? null : String(item.birthday).trim(),
                stage: normalizeStage(item.stage),
                source: isEmpty(item.source) ? null : String(item.source).trim(),
                tags: normalizeTags(item.tags)
            };
            // stage 'novo' é o default: não carrega informação nem gera conflito
            if (local.stage === 'novo') local.stage = null;

            const notesIn = Array.isArray(item.notes) ? item.notes : [];
            const followUpsIn = Array.isArray(item.followUps) ? item.followUps : [];

            // Casamento: id numérico ESTRITO primeiro, fallback nome + últimos 8 dígitos
            let match = null;
            const rawId = (item.id !== undefined && item.id !== null) ? String(item.id).trim() : '';
            const numericId = CLIENT_ID_RE.test(rawId) ? Number(rawId) : NaN;
            if (!isNaN(numericId) && byId.has(numericId)) match = byId.get(numericId);
            if (!match) {
                const key = matchKey(name, item.phone);
                if (byKey.has(key)) match = byKey.get(key);
            }

            if (match) {
                report.matched++;

                // Preenche APENAS campos vazios no banco; nunca sobrescreve
                const data = {};
                for (const campo of IMPORT_FIELDS) {
                    const localVal = local[campo];
                    if (localVal === null) continue;
                    let bancoVal = match[campo];
                    if (campo === 'stage' && bancoVal === 'novo') bancoVal = null; // default conta como vazio
                    if (isEmpty(bancoVal)) {
                        data[campo] = localVal;
                    } else if (campo === 'tags' && tagsEquivalentes(bancoVal, localVal)) {
                        // mesmo conteúdo em ordem/formatação diferente não é conflito
                    } else if (String(bancoVal).trim() !== String(localVal).trim()) {
                        report.conflicts.push({ name: match.name, campo, banco: match[campo], local: localVal });
                    }
                }
                if (Object.keys(data).length > 0) {
                    report.fieldsFilled += Object.keys(data).length;
                    if (!dryRun) {
                        await prisma.client.update({ where: { id: match.id }, data });
                        const changes = {};
                        for (const [campo, val] of Object.entries(data)) changes[campo] = { old: null, new: val };
                        safeAudit({ entityType: 'Client', entityId: match.id, action: 'UPDATE', user: req.user, changes });
                    }
                    Object.assign(match, data); // mantém índice em memória coerente no lote
                }

                // Notas: cria apenas se não existir nota com o mesmo texto
                const noteTexts = new Set((match.notes || []).map(n => (n.text || '').trim()));
                for (const n of notesIn) {
                    const text = (n && typeof n.text === 'string') ? n.text.trim() : '';
                    if (!text || noteTexts.has(text)) continue;
                    noteTexts.add(text);
                    report.notesCreated++;
                    if (!dryRun) {
                        const noteData = { clientId: match.id, text, createdBy };
                        const createdAt = n.createdAt ? new Date(n.createdAt) : null;
                        if (createdAt && !isNaN(createdAt.getTime())) noteData.createdAt = createdAt;
                        await prisma.clientNote.create({ data: noteData });
                    }
                }

                // Follow-ups: cria apenas se não existir mesmo (dueDate + note)
                const fuKeys = new Set((match.followUps || []).map(f => `${f.dueDate}|${(f.note || '').trim()}`));
                for (const f of followUpsIn) {
                    const dueDate = (f && typeof f.dueDate === 'string') ? f.dueDate.trim() : '';
                    if (!dueDateValida(dueDate)) { if (dueDate) report.followUpsInvalid++; continue; }
                    const note = (f && !isEmpty(f.note)) ? String(f.note).trim() : '';
                    const fuKey = `${dueDate}|${note}`;
                    if (fuKeys.has(fuKey)) continue;
                    fuKeys.add(fuKey);
                    report.followUpsCreated++;
                    if (!dryRun) {
                        await prisma.clientFollowUp.create({
                            data: {
                                clientId: match.id,
                                dueDate,
                                note: note || null,
                                done: !!(f && f.done),
                                doneAt: (f && f.done) ? new Date() : null,
                                createdBy
                            }
                        });
                    }
                }
            } else {
                // Cliente novo → cria com id Date.now()+idx
                report.created++;
                let newId = baseId + idx;

                // Dedupe interno do próprio item
                const noteCreates = [];
                const noteTexts = new Set();
                for (const n of notesIn) {
                    const text = (n && typeof n.text === 'string') ? n.text.trim() : '';
                    if (!text || noteTexts.has(text)) continue;
                    noteTexts.add(text);
                    const noteData = { text, createdBy };
                    const createdAt = n.createdAt ? new Date(n.createdAt) : null;
                    if (createdAt && !isNaN(createdAt.getTime())) noteData.createdAt = createdAt;
                    noteCreates.push(noteData);
                }

                const fuCreates = [];
                const fuKeys = new Set();
                for (const f of followUpsIn) {
                    const dueDate = (f && typeof f.dueDate === 'string') ? f.dueDate.trim() : '';
                    if (!dueDateValida(dueDate)) { if (dueDate) report.followUpsInvalid++; continue; }
                    const note = (f && !isEmpty(f.note)) ? String(f.note).trim() : '';
                    const fuKey = `${dueDate}|${note}`;
                    if (fuKeys.has(fuKey)) continue;
                    fuKeys.add(fuKey);
                    fuCreates.push({
                        dueDate,
                        note: note || null,
                        done: !!(f && f.done),
                        doneAt: (f && f.done) ? new Date() : null,
                        createdBy
                    });
                }

                report.notesCreated += noteCreates.length;
                report.followUpsCreated += fuCreates.length;

                if (!dryRun) {
                    const montarData = (id) => ({
                        id,
                        name,
                        phone: local.phone,
                        address: null,
                        cpf: null,
                        email: local.email,
                        instagram: local.instagram,
                        birthday: local.birthday,
                        stage: local.stage || 'novo',
                        source: local.source,
                        tags: local.tags,
                        notes: noteCreates.length ? { create: noteCreates } : undefined,
                        followUps: fuCreates.length ? { create: fuCreates } : undefined
                    });
                    try {
                        await prisma.client.create({ data: montarData(newId) });
                    } catch (e) {
                        // Colisão de id (Date.now() concorrente com outro create) → 1 retry com id deslocado
                        if (e && e.code === 'P2002') {
                            newId = baseId + idx + 100000 + Math.floor(Math.random() * 100000);
                            await prisma.client.create({ data: montarData(newId) });
                        } else { throw e; }
                    }
                    safeAudit({
                        entityType: 'Client', entityId: newId, action: 'CREATE', user: req.user,
                        snapshot: { name, phone: local.phone, origem: 'import-local' }
                    });
                }

                // Registra no índice para idempotência dentro do mesmo lote
                const created = {
                    id: newId,
                    name,
                    ...local,
                    stage: local.stage || 'novo',
                    notes: noteCreates.map(n => ({ text: n.text })),
                    followUps: fuCreates.map(f => ({ dueDate: f.dueDate, note: f.note }))
                };
                byId.set(newId, created);
                const key = matchKey(name, local.phone);
                if (!byKey.has(key)) byKey.set(key, created);
            }
            } catch (errItem) {
                // Falha isolada não derruba o lote — entra no relatório
                report.errors.push({ name, erro: String((errItem && errItem.message) || errItem).slice(0, 200) });
            }
        }

        res.json(report);
    } catch (err) { next(err); }
});

// ===================== CRM v3: rotas com :id =====================

// GET /:id → cliente + notas (createdAt desc) + follow-ups (dueDate asc)
router.get('/:id', authenticate, async (req, res, next) => {
    try {
        const clientId = parseClientId(req.params.id);
        if (clientId === null) return res.status(400).json({ error: 'ID inválido' });

        const client = await prisma.client.findUnique({
            where: { id: clientId },
            include: {
                notes: { orderBy: { createdAt: 'desc' } },
                followUps: { orderBy: { dueDate: 'asc' } }
            }
        });
        if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

        res.json(client);
    } catch (err) { next(err); }
});

// PATCH /:id → atualização parcial (só campos presentes no body)
router.patch('/:id', authenticate, async (req, res, next) => {
    try {
        const clientId = parseClientId(req.params.id);
        if (clientId === null) return res.status(400).json({ error: 'ID inválido' });

        const body = req.body || {};
        const data = {};

        for (const campo of PATCH_FIELDS) {
            if (!Object.prototype.hasOwnProperty.call(body, campo)) continue;
            const valor = body[campo];

            if (campo === 'name') {
                if (isEmpty(valor)) return res.status(400).json({ error: 'Nome não pode ser vazio' });
                data.name = String(valor).trim();
            } else if (campo === 'stage') {
                if (isEmpty(valor)) {
                    data.stage = 'novo';
                } else {
                    const stage = normalizeStage(valor);
                    if (!stage) return res.status(400).json({ error: `Stage inválido: ${valor}` });
                    data.stage = stage;
                }
            } else if (campo === 'tags') {
                data.tags = normalizeTags(valor);
            } else if (campo === 'lastContactAt') {
                if (valor === null || valor === '') {
                    data.lastContactAt = null;
                } else {
                    const d = new Date(valor);
                    if (isNaN(d.getTime())) return res.status(400).json({ error: 'lastContactAt inválido' });
                    data.lastContactAt = d;
                }
            } else {
                data[campo] = isEmpty(valor) ? null : String(valor).trim();
            }
        }

        if (Object.keys(data).length === 0) {
            return res.status(400).json({ error: 'Nenhum campo para atualizar' });
        }

        const existing = await prisma.client.findUnique({ where: { id: clientId } });
        if (!existing) return res.status(404).json({ error: 'Cliente não encontrado' });

        const saved = await prisma.client.update({ where: { id: clientId }, data });

        // Trilha de auditoria — mesma garantia das rotas antigas (ClientService)
        const changes = computeChanges(existing, saved, Object.keys(data));
        if (changes) {
            safeAudit({ entityType: 'Client', entityId: clientId, action: 'UPDATE', user: req.user, changes });
        }

        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

// POST /:id/notes → {text}
router.post('/:id/notes', authenticate, async (req, res, next) => {
    try {
        const clientId = parseClientId(req.params.id);
        if (clientId === null) return res.status(400).json({ error: 'ID inválido' });

        const text = (req.body && typeof req.body.text === 'string') ? req.body.text.trim() : '';
        if (!text) return res.status(400).json({ error: 'Campo "text" é obrigatório' });

        const client = await prisma.client.findUnique({ where: { id: clientId } });
        if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

        const note = await prisma.clientNote.create({
            data: {
                clientId,
                text,
                createdBy: (req.user && req.user.email) || null
            }
        });
        res.json({ success: true, data: note });
    } catch (err) { next(err); }
});

// POST /:id/follow-ups → {dueDate, note}
router.post('/:id/follow-ups', authenticate, async (req, res, next) => {
    try {
        const clientId = parseClientId(req.params.id);
        if (clientId === null) return res.status(400).json({ error: 'ID inválido' });

        const dueDate = (req.body && typeof req.body.dueDate === 'string') ? req.body.dueDate.trim() : '';
        if (!DUE_DATE_RE.test(dueDate)) {
            return res.status(400).json({ error: 'Campo "dueDate" (YYYY-MM-DD) é obrigatório' });
        }
        const note = (req.body && !isEmpty(req.body.note)) ? String(req.body.note).trim() : null;

        const client = await prisma.client.findUnique({ where: { id: clientId } });
        if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

        const followUp = await prisma.clientFollowUp.create({
            data: {
                clientId,
                dueDate,
                note,
                createdBy: (req.user && req.user.email) || null
            }
        });
        res.json({ success: true, data: followUp });
    } catch (err) { next(err); }
});

// ===================== ROTAS EXISTENTES (preservadas) =====================

router.put('/:id', authenticate, async (req, res, next) => {
    try {
        const saved = await ClientService.updateClient(req.params.id, req.body, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

router.delete('/:id', authenticate, async (req, res, next) => {
    try {
        await ClientService.deleteClient(req.params.id, req.user);
        res.json({ success: true });
    } catch (err) { next(err); }
});

module.exports = router;

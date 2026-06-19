const prisma = require('../prisma/client');
const { logAudit } = require('./audit');
const { getBucket } = require('./firebaseAdmin');
const crypto = require('crypto');
const path = require('path');

// Comprovantes podem ser imagens (foto do celular) ou PDF (recibo bancário).
const ALLOWED_MIME = [
    'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif',
    'application/pdf'
];

// kind → campo do Event que guarda a URL do comprovante.
const KIND_FIELD = {
    signal: 'signalReceiptUrl', // comprovante da entrada/sinal
    final: 'finalReceiptUrl'    // comprovante do valor final/integral
};

function safeAudit(payload) {
    try {
        Promise.resolve(logAudit(payload)).catch(err =>
            console.error('[audit] falha silenciosa:', err)
        );
    } catch (err) {
        console.error('[audit] falha sincrona silenciosa:', err);
    }
}

function inferExtension(file) {
    if (file.originalname) {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext) return ext;
    }
    const map = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/avif': '.avif',
        'image/heic': '.heic',
        'image/heif': '.heif',
        'application/pdf': '.pdf'
    };
    return map[file.mimetype] || '.bin';
}

function normalizeKind(kind) {
    const k = String(kind || '').trim().toLowerCase();
    if (!KIND_FIELD[k]) {
        const err = new Error('Tipo de comprovante inválido (use "signal" ou "final")');
        err.status = 400;
        throw err;
    }
    return k;
}

/**
 * Faz upload de um comprovante de pagamento (imagem ou PDF) para o Firebase Storage
 * e grava a URL no campo correspondente do evento (signalReceiptUrl ou finalReceiptUrl).
 * Retorna { url, kind }.
 */
async function uploadReceipt(eventId, file, kind, user) {
    const id = parseFloat(eventId);
    if (isNaN(id)) {
        const err = new Error('eventId inválido');
        err.status = 400;
        throw err;
    }
    const k = normalizeKind(kind);

    if (!file || !file.buffer) {
        const err = new Error('Nenhum arquivo enviado');
        err.status = 400;
        throw err;
    }
    if (!ALLOWED_MIME.includes(file.mimetype)) {
        const err = new Error(`Tipo de arquivo não suportado: ${file.mimetype}`);
        err.status = 400;
        throw err;
    }

    const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });
    if (!event) {
        const err = new Error('Evento não encontrado');
        err.status = 404;
        throw err;
    }

    const bucket = getBucket(); // Lança 503 se Storage não configurado

    const ext = inferExtension(file);
    const random = crypto.randomBytes(6).toString('hex');
    const storagePath = `receipts/event-${id}/${k}-${Date.now()}-${random}${ext}`;
    const storageFile = bucket.file(storagePath);

    await storageFile.save(file.buffer, {
        metadata: {
            contentType: file.mimetype,
            cacheControl: 'public, max-age=31536000, immutable',
            metadata: {
                eventId: String(id),
                kind: k,
                uploadedBy: user?.email || user?.name || 'unknown'
            }
        },
        resumable: false
    });

    await storageFile.makePublic();

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURI(storagePath)}`;

    await prisma.event.update({
        where: { id },
        data: { [KIND_FIELD[k]]: publicUrl }
    });

    safeAudit({
        entityType: 'Event',
        entityId: id,
        action: 'UPDATE',
        user,
        changes: { [KIND_FIELD[k]]: { old: null, new: publicUrl } },
        snapshot: { eventId: id, kind: k, url: publicUrl, source: 'receipt-upload' }
    });

    return { url: publicUrl, kind: k };
}

/**
 * Remove a referência ao comprovante no evento (zera o campo).
 * O arquivo físico no Storage não é apagado — admin gerencia o bucket.
 */
async function removeReceipt(eventId, kind, user) {
    const id = parseFloat(eventId);
    if (isNaN(id)) {
        const err = new Error('eventId inválido');
        err.status = 400;
        throw err;
    }
    const k = normalizeKind(kind);

    const event = await prisma.event.findUnique({
        where: { id },
        select: { id: true, [KIND_FIELD[k]]: true }
    });
    if (!event) {
        const err = new Error('Evento não encontrado');
        err.status = 404;
        throw err;
    }

    const oldUrl = event[KIND_FIELD[k]] || null;
    await prisma.event.update({
        where: { id },
        data: { [KIND_FIELD[k]]: null }
    });

    safeAudit({
        entityType: 'Event',
        entityId: id,
        action: 'UPDATE',
        user,
        changes: { [KIND_FIELD[k]]: { old: oldUrl, new: null } },
        snapshot: { eventId: id, kind: k, source: 'receipt-remove' }
    });

    return { success: true };
}

module.exports = { uploadReceipt, removeReceipt, KIND_FIELD };

const prisma = require('../prisma/client');
const { logAudit } = require('./audit');
const { getBucket } = require('./firebaseAdmin');
const crypto = require('crypto');
const path = require('path');

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'];

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
        'image/heif': '.heif'
    };
    return map[file.mimetype] || '.jpg';
}

/**
 * Lista todas as fotos do brinquedo, com a principal primeiro.
 */
async function listPhotosByToy(toyId) {
    const id = parseFloat(toyId);
    if (isNaN(id)) throw new Error('toyId inválido');

    return prisma.toyPhoto.findMany({
        where: { toyId: id },
        orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
        include: {
            event: { select: { id: true, date: true, clientName: true } }
        }
    });
}

/**
 * Adiciona uma foto ao banco. Se for a primeira do toy, marca como principal
 * e atualiza Toy.imageUrl (denormalizado).
 * @param eventId opcional — vincula a foto a um evento específico
 */
async function addPhoto(toyId, url, user, eventId = null) {
    const id = parseFloat(toyId);
    if (isNaN(id)) {
        const err = new Error('toyId inválido');
        err.status = 400;
        throw err;
    }

    const cleanUrl = String(url || '').trim();
    if (!cleanUrl) {
        const err = new Error('URL da foto é obrigatória');
        err.status = 400;
        throw err;
    }

    const toy = await prisma.toy.findUnique({ where: { id } });
    if (!toy) {
        const err = new Error('Brinquedo não encontrado');
        err.status = 404;
        throw err;
    }

    let resolvedEventId = null;
    if (eventId != null && eventId !== '') {
        const evId = parseFloat(eventId);
        if (!isNaN(evId)) {
            const ev = await prisma.event.findUnique({ where: { id: evId }, select: { id: true } });
            if (ev) resolvedEventId = evId;
        }
    }

    const existing = await prisma.toyPhoto.findMany({
        where: { toyId: id },
        orderBy: { order: 'desc' },
        take: 1
    });
    const nextOrder = existing.length ? existing[0].order + 1 : 0;
    const isFirstPhoto = (await prisma.toyPhoto.count({ where: { toyId: id } })) === 0;

    const created = await prisma.toyPhoto.create({
        data: {
            toyId: id,
            url: cleanUrl,
            isPrimary: isFirstPhoto,
            order: nextOrder,
            eventId: resolvedEventId
        }
    });

    if (isFirstPhoto) {
        await prisma.toy.update({
            where: { id },
            data: { imageUrl: cleanUrl }
        });
    }

    safeAudit({
        entityType: 'ToyPhoto',
        entityId: created.id,
        action: 'CREATE',
        user,
        snapshot: { toyId: id, url: cleanUrl, isPrimary: isFirstPhoto, eventId: resolvedEventId }
    });

    return created;
}

/**
 * Marca uma foto como principal: zera isPrimary nas outras, seta na escolhida,
 * atualiza Toy.imageUrl com a URL nova.
 */
async function setPrimary(toyId, photoId, user) {
    const tId = parseFloat(toyId);
    const pId = parseInt(photoId);
    if (isNaN(tId) || isNaN(pId)) {
        const err = new Error('IDs inválidos');
        err.status = 400;
        throw err;
    }

    const photo = await prisma.toyPhoto.findUnique({ where: { id: pId } });
    if (!photo || photo.toyId !== tId) {
        const err = new Error('Foto não encontrada');
        err.status = 404;
        throw err;
    }

    await prisma.$transaction([
        prisma.toyPhoto.updateMany({
            where: { toyId: tId, isPrimary: true },
            data: { isPrimary: false }
        }),
        prisma.toyPhoto.update({
            where: { id: pId },
            data: { isPrimary: true }
        }),
        prisma.toy.update({
            where: { id: tId },
            data: { imageUrl: photo.url }
        })
    ]);

    safeAudit({
        entityType: 'ToyPhoto',
        entityId: pId,
        action: 'UPDATE',
        user,
        changes: { isPrimary: { old: false, new: true } },
        snapshot: { toyId: tId, url: photo.url, isPrimary: true }
    });

    return { success: true };
}

/**
 * Remove uma foto. Se era a principal, promove a próxima (menor order)
 * a primária. Se não sobrar nenhuma, Toy.imageUrl = null.
 * O arquivo físico em fotos_dos_brinquedos/ NÃO é apagado — admin gerencia o disco.
 */
async function deletePhoto(toyId, photoId, user) {
    const tId = parseFloat(toyId);
    const pId = parseInt(photoId);
    if (isNaN(tId) || isNaN(pId)) {
        const err = new Error('IDs inválidos');
        err.status = 400;
        throw err;
    }

    const photo = await prisma.toyPhoto.findUnique({ where: { id: pId } });
    if (!photo || photo.toyId !== tId) {
        const err = new Error('Foto não encontrada');
        err.status = 404;
        throw err;
    }

    const wasPrimary = photo.isPrimary;
    await prisma.toyPhoto.delete({ where: { id: pId } });

    if (wasPrimary) {
        const next = await prisma.toyPhoto.findFirst({
            where: { toyId: tId },
            orderBy: { order: 'asc' }
        });

        if (next) {
            await prisma.$transaction([
                prisma.toyPhoto.update({
                    where: { id: next.id },
                    data: { isPrimary: true }
                }),
                prisma.toy.update({
                    where: { id: tId },
                    data: { imageUrl: next.url }
                })
            ]);
        } else {
            await prisma.toy.update({
                where: { id: tId },
                data: { imageUrl: null }
            });
        }
    }

    safeAudit({
        entityType: 'ToyPhoto',
        entityId: pId,
        action: 'DELETE',
        user,
        snapshot: { toyId: tId, url: photo.url, isPrimary: wasPrimary }
    });

    return { success: true };
}

/**
 * Faz upload de N arquivos para o Firebase Storage e cria os ToyPhoto correspondentes.
 * - Cada arquivo é validado por MIME type e tamanho (já filtrados pelo multer).
 * - Caminho no Storage: toys/{toyId}/{timestamp}-{rand}{ext}
 * - O primeiro upload se torna principal automaticamente (se ainda não houver fotos).
 * - Se eventId for passado, vincula cada foto criada ao evento.
 * - Retorna array de ToyPhoto criados.
 */
async function uploadFiles(toyId, files, user, eventId = null) {
    const id = parseFloat(toyId);
    if (isNaN(id)) {
        const err = new Error('toyId inválido');
        err.status = 400;
        throw err;
    }

    if (!Array.isArray(files) || files.length === 0) {
        const err = new Error('Nenhum arquivo enviado');
        err.status = 400;
        throw err;
    }

    const toy = await prisma.toy.findUnique({ where: { id } });
    if (!toy) {
        const err = new Error('Brinquedo não encontrado');
        err.status = 404;
        throw err;
    }

    let resolvedEventId = null;
    if (eventId != null && eventId !== '') {
        const evId = parseFloat(eventId);
        if (!isNaN(evId)) {
            const ev = await prisma.event.findUnique({ where: { id: evId }, select: { id: true } });
            if (ev) resolvedEventId = evId;
        }
    }

    const bucket = getBucket(); // Lança 503 se Storage não configurado

    // Estado atual de fotos (para definir order e isPrimary do primeiro)
    const existingCount = await prisma.toyPhoto.count({ where: { toyId: id } });
    const lastOrderRow = await prisma.toyPhoto.findFirst({
        where: { toyId: id },
        orderBy: { order: 'desc' },
        select: { order: true }
    });
    let nextOrder = (lastOrderRow?.order ?? -1) + 1;

    const created = [];
    let madePrimaryUrl = null;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (!ALLOWED_MIME.includes(file.mimetype)) {
            const err = new Error(`Tipo de arquivo não suportado: ${file.mimetype}`);
            err.status = 400;
            throw err;
        }

        const ext = inferExtension(file);
        const random = crypto.randomBytes(6).toString('hex');
        const eventSegment = resolvedEventId ? `event-${resolvedEventId}-` : '';
        const storagePath = `toys/${id}/${eventSegment}${Date.now()}-${random}${ext}`;
        const storageFile = bucket.file(storagePath);

        await storageFile.save(file.buffer, {
            metadata: {
                contentType: file.mimetype,
                cacheControl: 'public, max-age=31536000, immutable',
                metadata: {
                    toyId: String(id),
                    eventId: resolvedEventId ? String(resolvedEventId) : '',
                    uploadedBy: user?.email || user?.name || 'unknown'
                }
            },
            resumable: false
        });

        await storageFile.makePublic();

        // URL pública via storage.googleapis.com (sem token, sem expiração)
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURI(storagePath)}`;

        const isFirstEver = (existingCount === 0 && i === 0);
        const photo = await prisma.toyPhoto.create({
            data: {
                toyId: id,
                url: publicUrl,
                isPrimary: isFirstEver,
                order: nextOrder++,
                eventId: resolvedEventId
            }
        });

        if (isFirstEver) madePrimaryUrl = publicUrl;
        created.push(photo);

        safeAudit({
            entityType: 'ToyPhoto',
            entityId: photo.id,
            action: 'CREATE',
            user,
            snapshot: { toyId: id, url: publicUrl, isPrimary: isFirstEver, eventId: resolvedEventId, source: 'upload' }
        });
    }

    if (madePrimaryUrl) {
        await prisma.toy.update({
            where: { id },
            data: { imageUrl: madePrimaryUrl }
        });
    }

    return created;
}

module.exports = {
    listPhotosByToy,
    addPhoto,
    setPrimary,
    deletePhoto,
    uploadFiles
};

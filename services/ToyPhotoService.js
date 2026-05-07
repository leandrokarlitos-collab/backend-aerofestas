const prisma = require('../prisma/client');
const { logAudit } = require('./audit');

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
 * Lista todas as fotos do brinquedo, com a principal primeiro.
 */
async function listPhotosByToy(toyId) {
    const id = parseFloat(toyId);
    if (isNaN(id)) throw new Error('toyId inválido');

    return prisma.toyPhoto.findMany({
        where: { toyId: id },
        orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }]
    });
}

/**
 * Adiciona uma foto ao banco. Se for a primeira do toy, marca como principal
 * e atualiza Toy.imageUrl (denormalizado).
 */
async function addPhoto(toyId, url, user) {
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
            order: nextOrder
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
        snapshot: { toyId: id, url: cleanUrl, isPrimary: isFirstPhoto }
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

module.exports = {
    listPhotosByToy,
    addPhoto,
    setPrimary,
    deletePhoto
};

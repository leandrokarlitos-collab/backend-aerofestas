const crypto = require('crypto');
const path = require('path');
const { logAudit } = require('./audit');
const { getBucket } = require('./firebaseAdmin');

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
 * Faz upload de uma imagem de capa (OG) de proposta ou template.
 * Caminho no Storage: propostas/{ownerType}/{ownerId}/og-{timestamp}-{rand}{ext}
 * Retorna URL pública.
 */
async function uploadPropostaCover({ file, ownerType, ownerId, user }) {
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

    const safeOwner = (ownerType === 'template') ? 'templates' : 'propostas';
    const safeId = String(ownerId || 'orphan').replace(/[^a-zA-Z0-9_-]/g, '');
    const ext = inferExtension(file);
    const random = crypto.randomBytes(6).toString('hex');
    const storagePath = `propostas/${safeOwner}/${safeId}/og-${Date.now()}-${random}${ext}`;

    const bucket = getBucket(); // Lança 503 se Storage não configurado
    const storageFile = bucket.file(storagePath);

    await storageFile.save(file.buffer, {
        metadata: {
            contentType: file.mimetype,
            cacheControl: 'public, max-age=31536000, immutable',
            metadata: {
                ownerType: safeOwner,
                ownerId: safeId,
                uploadedBy: user?.email || user?.name || 'unknown'
            }
        },
        resumable: false
    });

    await storageFile.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURI(storagePath)}`;

    safeAudit({
        entityType: safeOwner === 'templates' ? 'PropostaTemplate' : 'Proposta',
        entityId: safeId,
        action: 'UPDATE',
        user,
        snapshot: { ogImageUrl: publicUrl, source: 'upload' }
    });

    return publicUrl;
}

module.exports = { uploadPropostaCover };

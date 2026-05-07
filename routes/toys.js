const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const ToyService = require('../services/ToyService');
const ToyUnitService = require('../services/ToyUnitService');
const ToyPhotoService = require('../services/ToyPhotoService');

const router = express.Router();

// Multer em memória — arquivos vão direto para o Firebase Storage, sem tocar disco do Railway.
// Limites: 15 MB por arquivo (sobra pra fotos originais de celular antes de resize), até 12 arquivos.
const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 15 * 1024 * 1024,
        files: 12
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Apenas imagens são permitidas'));
    }
});

router.get('/', authenticate, async (req, res, next) => {
    try {
        const toys = await ToyService.listToys();
        res.json(toys);
    } catch (err) { next(err); }
});

// POST — semântica upsert (backward-compat com salvarBrinquedo do frontend)
router.post('/', authenticate, async (req, res, next) => {
    try {
        const { id, name, quantity, imageUrl } = req.body;
        const saved = id
            ? await ToyService.updateToy(id, { name, quantity, imageUrl }, req.user)
            : await ToyService.createToy({ name, quantity, imageUrl }, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

// PUT — endpoint REST-próprio para updates explícitos
router.put('/:id', authenticate, async (req, res, next) => {
    try {
        const saved = await ToyService.updateToy(req.params.id, req.body, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

router.delete('/:id', authenticate, async (req, res, next) => {
    try {
        await ToyService.deleteToy(req.params.id, req.user);
        res.json({ success: true });
    } catch (err) { next(err); }
});

// --- ToyUnit (estado por unidade) ---

router.put('/:toyId/units/:unitId', authenticate, async (req, res, next) => {
    try {
        const saved = await ToyUnitService.updateCondition(
            req.params.toyId,
            req.params.unitId,
            req.body,
            req.user
        );
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

// --- ToyPhoto (banco de fotos) ---

router.get('/:toyId/photos', authenticate, async (req, res, next) => {
    try {
        const photos = await ToyPhotoService.listPhotosByToy(req.params.toyId);
        res.json(photos);
    } catch (err) { next(err); }
});

router.post('/:toyId/photos', authenticate, async (req, res, next) => {
    try {
        const created = await ToyPhotoService.addPhoto(
            req.params.toyId,
            req.body.url,
            req.user,
            req.body.eventId || null
        );
        res.json({ success: true, data: created });
    } catch (err) { next(err); }
});

router.delete('/:toyId/photos/:photoId', authenticate, async (req, res, next) => {
    try {
        await ToyPhotoService.deletePhoto(
            req.params.toyId,
            req.params.photoId,
            req.user
        );
        res.json({ success: true });
    } catch (err) { next(err); }
});

router.put('/:toyId/photos/:photoId/primary', authenticate, async (req, res, next) => {
    try {
        await ToyPhotoService.setPrimary(
            req.params.toyId,
            req.params.photoId,
            req.user
        );
        res.json({ success: true });
    } catch (err) { next(err); }
});

// Upload direto do celular/galeria — multipart/form-data, campo "files" (1..12 arquivos).
router.post(
    '/:toyId/photos/upload',
    authenticate,
    (req, res, next) => {
        photoUpload.array('files', 12)(req, res, (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    err.status = 413;
                    err.message = 'Arquivo maior que 15 MB. Reduza no celular ou tente outra foto.';
                } else if (err.code === 'LIMIT_FILE_COUNT') {
                    err.status = 400;
                    err.message = 'Máximo de 12 fotos por envio.';
                } else if (!err.status) {
                    err.status = 400;
                }
                return next(err);
            }
            next();
        });
    },
    async (req, res, next) => {
        try {
            // eventId chega no body do multipart (campo de texto opcional)
            const eventId = req.body?.eventId || null;
            const created = await ToyPhotoService.uploadFiles(
                req.params.toyId,
                req.files || [],
                req.user,
                eventId
            );
            res.json({ success: true, data: created });
        } catch (err) { next(err); }
    }
);

module.exports = router;

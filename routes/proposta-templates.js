const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const PropostaTemplateService = require('../services/PropostaTemplateService');
const { uploadPropostaCover } = require('../services/PropostaUploadService');

const router = express.Router();

// Upload em memória para foto de capa (OG)
const ogUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Apenas imagens são permitidas'));
    }
});

router.get('/', authenticate, async (req, res, next) => {
    try {
        const list = await PropostaTemplateService.listTemplates();
        res.json(list);
    } catch (err) { next(err); }
});

router.get('/default', authenticate, async (req, res, next) => {
    try {
        const t = await PropostaTemplateService.getDefault();
        res.json(t);
    } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
    try {
        const t = await PropostaTemplateService.getById(req.params.id);
        if (!t) return res.status(404).json({ error: 'Template não encontrado' });
        res.json(t);
    } catch (err) { next(err); }
});

router.post('/', authenticate, async (req, res, next) => {
    try {
        const saved = await PropostaTemplateService.upsertTemplate(req.body, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

router.put('/:id', authenticate, async (req, res, next) => {
    try {
        const saved = await PropostaTemplateService.upsertTemplate(
            { ...req.body, id: req.params.id },
            req.user
        );
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

router.post('/:id/set-default', authenticate, async (req, res, next) => {
    try {
        const saved = await PropostaTemplateService.setDefault(req.params.id, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

router.delete('/:id', authenticate, async (req, res, next) => {
    try {
        await PropostaTemplateService.deleteTemplate(req.params.id, req.user);
        res.json({ success: true });
    } catch (err) { next(err); }
});

// Upload de capa OG do template
router.post(
    '/:id/og-upload',
    authenticate,
    (req, res, next) => {
        ogUpload.single('image')(req, res, (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    err.status = 413;
                    err.message = 'Arquivo maior que 15 MB.';
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
            if (!req.file) {
                return res.status(400).json({ error: 'Nenhuma imagem enviada' });
            }
            const url = await uploadPropostaCover({
                file: req.file,
                ownerType: 'template',
                ownerId: req.params.id,
                user: req.user
            });
            res.json({ success: true, data: { url } });
        } catch (err) { next(err); }
    }
);

module.exports = router;

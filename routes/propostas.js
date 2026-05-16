const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const PropostaService = require('../services/PropostaService');
const { uploadPropostaCover } = require('../services/PropostaUploadService');

const adminRouter = express.Router();
const publicRouter = express.Router();

const ogUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Apenas imagens são permitidas'));
    }
});

// ---------------- ADMIN ----------------

adminRouter.get('/propostas', authenticate, async (req, res, next) => {
    try {
        const list = await PropostaService.listPropostas();
        res.json(list);
    } catch (err) { next(err); }
});

adminRouter.get('/propostas/:id', authenticate, async (req, res, next) => {
    try {
        const p = await PropostaService.getById(req.params.id);
        if (!p) return res.status(404).json({ error: 'Proposta não encontrada' });
        res.json(p);
    } catch (err) { next(err); }
});

adminRouter.post('/propostas', authenticate, async (req, res, next) => {
    try {
        const saved = await PropostaService.upsertProposta(req.body, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

adminRouter.put('/propostas/:id', authenticate, async (req, res, next) => {
    try {
        const saved = await PropostaService.upsertProposta(
            { ...req.body, id: req.params.id },
            req.user
        );
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

adminRouter.post('/propostas/:id/duplicate', authenticate, async (req, res, next) => {
    try {
        const saved = await PropostaService.duplicateProposta(req.params.id, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

adminRouter.delete('/propostas/:id', authenticate, async (req, res, next) => {
    try {
        await PropostaService.deleteProposta(req.params.id, req.user);
        res.json({ success: true });
    } catch (err) { next(err); }
});

// Upload de capa OG da proposta
adminRouter.post(
    '/propostas/:id/og-upload',
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
                ownerType: 'proposta',
                ownerId: req.params.id,
                user: req.user
            });
            res.json({ success: true, data: { url } });
        } catch (err) { next(err); }
    }
);

// ---------------- PUBLIC ----------------

publicRouter.get('/propostas/:slug', async (req, res, next) => {
    try {
        const data = await PropostaService.getPublicProposta(req.params.slug);
        if (!data) return res.status(404).json({ error: 'Proposta não encontrada' });
        // Cache curto no CDN/browser — proposta pode ser editada
        res.set('Cache-Control', 'public, max-age=60, must-revalidate');
        res.json(data);
    } catch (err) { next(err); }
});

module.exports = { adminRouter, publicRouter };

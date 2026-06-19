const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const EventService = require('../services/EventService');
const EventReceiptService = require('../services/EventReceiptService');

const adminRouter = express.Router();
const publicRouter = express.Router();

// Comprovantes de pagamento: imagem ou PDF, 1 arquivo por envio, até 15 MB.
const receiptUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype && (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf')) {
            cb(null, true);
        } else {
            cb(new Error('Apenas imagens ou PDF são permitidos'));
        }
    }
});

// ---------------- ADMIN ----------------

adminRouter.get('/events-full', async (req, res, next) => {
    try {
        const events = await EventService.listEventsFull();
        res.json(events);
    } catch (err) { next(err); }
});

adminRouter.post('/events', authenticate, async (req, res, next) => {
    try {
        const saved = await EventService.upsertEvent(req.body, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

adminRouter.delete('/events/:id', authenticate, async (req, res, next) => {
    try {
        await EventService.deleteEvent(req.params.id, req.user);
        res.json({ success: true, message: 'Evento excluído com sucesso!' });
    } catch (err) { next(err); }
});

// --- Comprovantes de pagamento (sinal / final) ---

// Upload de comprovante (multipart, campo "file"; kind no body: "signal" | "final")
adminRouter.post(
    '/events/:id/receipt',
    authenticate,
    (req, res, next) => {
        receiptUpload.single('file')(req, res, (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    err.status = 413;
                    err.message = 'Arquivo maior que 15 MB. Reduza o arquivo e tente novamente.';
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
            const kind = req.body?.kind;
            const result = await EventReceiptService.uploadReceipt(
                req.params.id, req.file, kind, req.user
            );
            res.json({ success: true, data: result });
        } catch (err) { next(err); }
    }
);

// Remove a referência ao comprovante (kind: "signal" | "final")
adminRouter.delete('/events/:id/receipt/:kind', authenticate, async (req, res, next) => {
    try {
        await EventReceiptService.removeReceipt(req.params.id, req.params.kind, req.user);
        res.json({ success: true });
    } catch (err) { next(err); }
});

// ---------------- PUBLIC ----------------

publicRouter.get('/events/:id', async (req, res, next) => {
    try {
        const data = await EventService.getPublicEvent(req.params.id);
        if (!data) return res.status(404).json({ error: 'Evento não encontrado' });
        res.json(data);
    } catch (err) { next(err); }
});

publicRouter.put('/events/:id', async (req, res, next) => {
    try {
        const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
        const userAgent = req.get('user-agent') || null;
        const updated = await EventService.updatePublicEvent(req.params.id, req.body, { ip, userAgent });
        res.json({ success: true, data: updated });
    } catch (err) { next(err); }
});

// Auto-save parcial enquanto o cliente preenche.
publicRouter.patch('/events/:id/draft', async (req, res, next) => {
    try {
        const updated = await EventService.saveDraftPublicEvent(req.params.id, req.body);
        res.json({ success: true, data: { id: updated.id, status: updated.status } });
    } catch (err) {
        if (err.status === 404) return res.status(404).json({ error: err.message });
        next(err);
    }
});

// Lista pública de brinquedos (sem preço — apenas catálogo para o cliente escolher mais itens).
publicRouter.get('/toys', async (req, res, next) => {
    try {
        const toys = await EventService.listPublicToys();
        res.json(toys);
    } catch (err) { next(err); }
});

// Checa se data/horário aparentam estar livres na agenda.
// GET /api/public/availability?date=YYYY-MM-DD&startTime=HH:MM&endTime=HH:MM&excludeId=...
publicRouter.get('/availability', async (req, res, next) => {
    try {
        const { date, startTime, endTime, excludeId } = req.query;
        const result = await EventService.checkAvailability({
            date, startTime, endTime, excludeEventId: excludeId
        });
        res.json(result);
    } catch (err) { next(err); }
});

module.exports = { adminRouter, publicRouter };

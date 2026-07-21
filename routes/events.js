const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const EventService = require('../services/EventService');

const adminRouter = express.Router();
const publicRouter = express.Router();

// Upload do contrato: mantém o arquivo em memória (vai direto pro Firebase Storage).
const contractUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
});

// ---------------- ADMIN ----------------

adminRouter.get('/events-full', authenticate, async (req, res, next) => {
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

// Grava a ESCALA de um evento de forma dedicada (independente do save do evento).
adminRouter.put('/events/:id/assignments', authenticate, async (req, res, next) => {
    try {
        const data = await EventService.setEventAssignments(req.params.id, req.body.assignments, req.user);
        res.json({ success: true, data });
    } catch (err) { next(err); }
});

// Marca como conferido o pedido de alteração de data/horário feito pelo cliente.
adminRouter.delete('/events/:id/change-note', authenticate, async (req, res, next) => {
    try {
        await EventService.clearClientChangeNote(req.params.id, req.user);
        res.json({ success: true });
    } catch (err) { next(err); }
});

// Anexar / substituir o contrato do evento (arquivo: PDF, imagem ou Word).
adminRouter.post('/events/:id/contract', authenticate, contractUpload.single('file'), async (req, res, next) => {
    try {
        const updated = await EventService.uploadContract(req.params.id, req.file, req.user);
        res.json({ success: true, data: { id: updated.id, contractFileUrl: updated.contractFileUrl, contractFileName: updated.contractFileName } });
    } catch (err) { next(err); }
});

// Remover o contrato anexado do evento.
adminRouter.delete('/events/:id/contract', authenticate, async (req, res, next) => {
    try {
        const updated = await EventService.removeContract(req.params.id, req.user);
        res.json({ success: true, data: { id: updated.id } });
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
    } catch (err) {
        if (err.status === 400 || err.status === 404) {
            return res.status(err.status).json({ error: err.message });
        }
        next(err);
    }
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

// Checa se o período/horário aparentam estar livres na agenda.
// GET /api/public/availability?date=YYYY-MM-DD&endDate=YYYY-MM-DD&startTime=HH:MM&endTime=HH:MM&excludeId=...
// endDate é opcional — sem ele, checa apenas o dia de `date` (comportamento anterior).
publicRouter.get('/availability', async (req, res, next) => {
    try {
        const { date, endDate, startTime, endTime, excludeId } = req.query;
        const result = await EventService.checkAvailability({
            date, endDate, startTime, endTime, excludeEventId: excludeId
        });
        res.json(result);
    } catch (err) { next(err); }
});

module.exports = { adminRouter, publicRouter };

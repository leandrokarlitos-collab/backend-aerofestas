const express = require('express');
const { authenticate } = require('../middleware/auth');
const EventService = require('../services/EventService');

const adminRouter = express.Router();
const publicRouter = express.Router();

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
        const updated = await EventService.updatePublicEvent(req.params.id, req.body);
        res.json({ success: true, data: updated });
    } catch (err) { next(err); }
});

module.exports = { adminRouter, publicRouter };

const express = require('express');
const { authenticate } = require('../middleware/auth');
const EventRouteService = require('../services/EventRouteService');

const router = express.Router();

router.get('/', authenticate, async (req, res, next) => {
    try {
        const routes = await EventRouteService.listEventRoutes();
        res.json(routes);
    } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
    try {
        const route = await EventRouteService.getEventRoute(req.params.id);
        if (!route) return res.status(404).json({ error: 'Rota não encontrada.' });
        res.json(route);
    } catch (err) { next(err); }
});

router.post('/', authenticate, async (req, res, next) => {
    try {
        const saved = await EventRouteService.createEventRoute(req.body, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

router.put('/:id', authenticate, async (req, res, next) => {
    try {
        const saved = await EventRouteService.updateEventRoute(req.params.id, req.body, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

router.delete('/:id', authenticate, async (req, res, next) => {
    try {
        const clearTravel = req.query.clearTravel !== '0';
        await EventRouteService.deleteEventRoute(req.params.id, req.user, { clearTravel });
        res.json({ success: true });
    } catch (err) { next(err); }
});

module.exports = router;

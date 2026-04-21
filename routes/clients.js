const express = require('express');
const { authenticate } = require('../middleware/auth');
const ClientService = require('../services/ClientService');

const router = express.Router();

router.get('/', authenticate, async (req, res, next) => {
    try {
        const clients = await ClientService.listClients();
        res.json(clients);
    } catch (err) { next(err); }
});

router.post('/', authenticate, async (req, res, next) => {
    try {
        const { id, ...payload } = req.body;
        const saved = id
            ? await ClientService.updateClient(id, payload, req.user)
            : await ClientService.createClient(payload, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

router.put('/:id', authenticate, async (req, res, next) => {
    try {
        const saved = await ClientService.updateClient(req.params.id, req.body, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

router.delete('/:id', authenticate, async (req, res, next) => {
    try {
        await ClientService.deleteClient(req.params.id, req.user);
        res.json({ success: true });
    } catch (err) { next(err); }
});

module.exports = router;

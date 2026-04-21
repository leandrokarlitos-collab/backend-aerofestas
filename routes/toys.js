const express = require('express');
const { authenticate } = require('../middleware/auth');
const ToyService = require('../services/ToyService');

const router = express.Router();

router.get('/', authenticate, async (req, res, next) => {
    try {
        const toys = await ToyService.listToys();
        res.json(toys);
    } catch (err) { next(err); }
});

// POST — semântica upsert (backward-compat com salvarBrinquedo do frontend)
router.post('/', authenticate, async (req, res, next) => {
    try {
        const { id, name, quantity } = req.body;
        const saved = id
            ? await ToyService.updateToy(id, { name, quantity }, req.user)
            : await ToyService.createToy({ name, quantity }, req.user);
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

module.exports = router;

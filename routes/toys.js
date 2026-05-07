const express = require('express');
const { authenticate } = require('../middleware/auth');
const ToyService = require('../services/ToyService');
const ToyUnitService = require('../services/ToyUnitService');
const ToyPhotoService = require('../services/ToyPhotoService');

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
            req.user
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

module.exports = router;

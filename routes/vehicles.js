const express = require('express');
const { authenticate } = require('../middleware/auth');
const VehicleService = require('../services/VehicleService');

const router = express.Router();

router.get('/', authenticate, async (req, res, next) => {
    try {
        const vehicles = await VehicleService.listVehicles();
        res.json(vehicles);
    } catch (err) { next(err); }
});

router.post('/', authenticate, async (req, res, next) => {
    try {
        const saved = await VehicleService.upsertVehicle(req.body, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

router.put('/:id', authenticate, async (req, res, next) => {
    try {
        const saved = await VehicleService.updateVehicle(req.params.id, req.body, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

router.delete('/:id', authenticate, async (req, res, next) => {
    try {
        await VehicleService.deleteVehicle(req.params.id, req.user);
        res.json({ success: true });
    } catch (err) { next(err); }
});

module.exports = router;

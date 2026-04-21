const express = require('express');
const { authenticate } = require('../middleware/auth');
const CompanyService = require('../services/CompanyService');

const router = express.Router();

router.get('/', authenticate, async (req, res, next) => {
    try {
        const companies = await CompanyService.listCompanies();
        res.json(companies);
    } catch (err) { next(err); }
});

// POST — semântica upsert (backward-compat com salvarEmpresa do frontend)
router.post('/', authenticate, async (req, res, next) => {
    try {
        const saved = await CompanyService.upsertCompany(req.body, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

router.put('/:id', authenticate, async (req, res, next) => {
    try {
        const saved = await CompanyService.updateCompany(req.params.id, req.body, req.user);
        res.json({ success: true, data: saved });
    } catch (err) { next(err); }
});

router.delete('/:id', authenticate, async (req, res, next) => {
    try {
        await CompanyService.deleteCompany(req.params.id, req.user);
        res.json({ success: true });
    } catch (err) { next(err); }
});

module.exports = router;

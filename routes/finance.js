const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// --- DASHBOARD E LEITURA ---

// GET /api/finance/dashboard
router.get('/dashboard', async (req, res) => {
    try {
        const { month, year } = req.query;
        const date = new Date();
        const currentMonth = month ? parseInt(month) - 1 : date.getMonth();
        const currentYear = year ? parseInt(year) : date.getFullYear();

        const startDate = new Date(currentYear, currentMonth, 1);
        const endDate = new Date(currentYear, currentMonth + 1, 0);
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        const events = await prisma.event.findMany({ where: { date: { gte: startStr, lte: endStr } } });
        const receitaTotal = events.reduce((acc, evt) => acc + (evt.price || 0), 0);

        const transactions = await prisma.transaction.findMany({ where: { type: 'EXPENSE', date: { gte: startStr, lte: endStr } } });
        const despesaTotal = transactions.reduce((acc, tra) => acc + (tra.amount || 0), 0);

        res.json({
            period: `${currentMonth + 1}/${currentYear}`,
            summary: { revenue: receitaTotal, expenses: despesaTotal, balance: receitaTotal - despesaTotal }
        });
    } catch (error) { res.status(500).json({ error: "Erro financeiro" }); }
});

// GET Listas
router.get('/transactions', async (req, res) => {
    const data = await prisma.transaction.findMany({ orderBy: { date: 'desc' }, take: 200 });
    res.json(data);
});
router.get('/accounts', async (req, res) => {
    const data = await prisma.bankAccount.findMany({ orderBy: { name: 'asc' } });
    res.json(data);
});
router.get('/fixed-expenses', async (req, res) => {
    const data = await prisma.fixedExpense.findMany({ orderBy: { dueDay: 'asc' } });
    res.json(data);
});

// --- CRIAÇÃO (SALVAR DADOS) ---

// POST /api/finance/transactions (Salvar Gasto)
router.post('/transactions', async (req, res) => {
    try {
        const t = req.body;
        const newTransaction = await prisma.transaction.create({
            data: {
                id: t.id || Date.now().toString(), // Garante um ID
                description: t.description,
                amount: parseFloat(t.amount),
                type: t.type || 'EXPENSE',
                date: t.date,
                category: t.category,
                paymentMethod: t.paymentMethod,
                // Opcionais
                // contaId: t.contaId ... (se você criar relacionamento no prisma depois)
            }
        });
        res.json(newTransaction);
    } catch (error) {
        console.error("Erro ao salvar transação:", error);
        res.status(500).json({ error: "Erro ao salvar" });
    }
});

// POST /api/finance/accounts (Salvar Conta Bancária)
router.post('/accounts', async (req, res) => {
    try {
        const c = req.body;
        const newAccount = await prisma.bankAccount.create({
            data: {
                id: c.id || Date.now().toString(),
                name: c.name,
                bank: c.bank,
                type: c.type,
                agency: c.agency,
                number: c.number
            }
        });
        res.json(newAccount);
    } catch (e) { res.status(500).json({ error: "Erro ao salvar conta" }); }
});

// POST /api/finance/fixed-expenses (Salvar Conta Fixa)
router.post('/fixed-expenses', async (req, res) => {
    try {
        const f = req.body;
        const newFixed = await prisma.fixedExpense.create({
            data: {
                id: f.id || Date.now().toString(),
                description: f.description,
                amount: parseFloat(f.amount),
                dueDay: parseInt(f.dueDay),
                category: f.category,
                recurrenceType: f.recurrenceType,
                startDate: f.startDate,
                installments: f.installments ? parseInt(f.installments) : null
            }
        });
        res.json(newFixed);
    } catch (e) { res.status(500).json({ error: "Erro ao salvar conta fixa" }); }
});

// --- CATEGORIAS FINANCEIRAS ---

// GET Categorias de Gastos
router.get('/categories/expenses', async (req, res) => {
    try {
        const data = await prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } });
        res.json(data);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar categorias" }); }
});

// GET Categorias de Contas Fixas
router.get('/categories/fixed', async (req, res) => {
    try {
        const data = await prisma.fixedExpenseCategory.findMany({ orderBy: { name: 'asc' } });
        res.json(data);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar categorias" }); }
});

// POST Categoria de Gasto
router.post('/categories/expenses', async (req, res) => {
    try {
        const newCat = await prisma.expenseCategory.create({
            data: { id: Date.now().toString(), name: req.body.name }
        });
        res.json(newCat);
    } catch (e) { res.status(500).json({ error: "Erro ao salvar categoria" }); }
});

// POST Categoria de Conta Fixa
router.post('/categories/fixed', async (req, res) => {
    try {
        const newCat = await prisma.fixedExpenseCategory.create({
            data: { id: Date.now().toString(), name: req.body.name }
        });
        res.json(newCat);
    } catch (e) { res.status(500).json({ error: "Erro ao salvar categoria" }); }
});

// DELETE Genérico (Para todos os tipos incluindo categorias)
router.delete('/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        
        if (type === 'transactions') await prisma.transaction.delete({ where: { id } });
        else if (type === 'accounts') await prisma.bankAccount.delete({ where: { id } });
        else if (type === 'fixed-expenses') await prisma.fixedExpense.delete({ where: { id } });
        else if (type === 'categories-expenses') await prisma.expenseCategory.delete({ where: { id } });
        else if (type === 'categories-fixed') await prisma.fixedExpenseCategory.delete({ where: { id } });
        else return res.status(400).json({ error: "Tipo inválido" });
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao deletar" }); }
});

module.exports = router;
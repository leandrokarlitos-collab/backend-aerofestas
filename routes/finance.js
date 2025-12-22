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
                accountId: t.accountId
            }
        });
        res.json(newTransaction);
    } catch (error) {
        console.error("Erro ao salvar transação:", error);
        res.status(500).json({ error: "Erro ao salvar" });
    }
});

// PUT /api/finance/transactions/:id (Atualizar Gasto)
router.put('/transactions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const t = req.body;
        const updated = await prisma.transaction.update({
            where: { id },
            data: {
                description: t.description,
                amount: parseFloat(t.amount),
                type: t.type,
                date: t.date,
                category: t.category,
                paymentMethod: t.paymentMethod,
                accountId: t.accountId
            }
        });
        res.json(updated);
    } catch (error) {
        console.error("Erro ao atualizar transação:", error);
        res.status(500).json({ error: "Erro ao atualizar" });
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

// PUT /api/finance/accounts/:id (Atualizar Conta Bancária)
router.put('/accounts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const c = req.body;
        const updatedAccount = await prisma.bankAccount.update({
            where: { id },
            data: {
                name: c.name,
                bank: c.bank,
                type: c.type,
                agency: c.agency,
                number: c.number
            }
        });
        res.json(updatedAccount);
    } catch (e) { res.status(500).json({ error: "Erro ao atualizar conta" }); }
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

// PUT /api/finance/fixed-expenses/:id (Atualizar Conta Fixa)
router.put('/fixed-expenses/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const f = req.body;
        const updatedFixed = await prisma.fixedExpense.update({
            where: { id },
            data: {
                description: f.description,
                amount: parseFloat(f.amount),
                dueDay: parseInt(f.dueDay),
                category: f.category,
                recurrenceType: f.recurrenceType,
                startDate: f.startDate,
                installments: f.installments ? parseInt(f.installments) : null
            }
        });
        res.json(updatedFixed);
    } catch (e) { res.status(500).json({ error: "Erro ao atualizar conta fixa" }); }
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


// POST Seed - Popular categorias padrão (executar uma vez)
router.post('/seed-categories', async (req, res) => {
    try {
        // Categorias de Gastos Padrão
        const gastoCategorias = [
            { id: 'gc-1', name: 'Transporte' },
            { id: 'gc-2', name: 'Combustível' },
            { id: 'gc-3', name: 'Manutenção' },
            { id: 'gc-4', name: 'Alimentação' },
            { id: 'gc-5', name: 'Insumos' },
            { id: 'gc-6', name: 'Limpeza' },
            { id: 'gc-7', name: 'Impostos' },
            { id: 'gc-8', name: 'Outros' }
        ];

        // Categorias de Contas Fixas Padrão
        const fixedCategorias = [
            { id: 'cfc-1', name: 'Aluguel' },
            { id: 'cfc-2', name: 'Energia' },
            { id: 'cfc-3', name: 'Água' },
            { id: 'cfc-4', name: 'Internet' },
            { id: 'cfc-5', name: 'Telefone' },
            { id: 'cfc-6', name: 'Impostos MEI' },
            { id: 'cfc-7', name: 'Seguros' },
            { id: 'cfc-8', name: 'Salários' }
        ];

        // Criar categorias (usando createMany com skipDuplicates)
        await prisma.expenseCategory.createMany({
            data: gastoCategorias,
            skipDuplicates: true
        });

        await prisma.fixedExpenseCategory.createMany({
            data: fixedCategorias,
            skipDuplicates: true
        });

        res.json({
            success: true,
            message: 'Categorias padrão criadas com sucesso!',
            gastoCategorias: gastoCategorias.length,
            fixedCategorias: fixedCategorias.length
        });
    } catch (e) {
        console.error("Erro ao criar categorias:", e);
        res.status(500).json({ error: "Erro ao criar categorias padrão" });
    }
});

// --- MONITORES ---

// GET /api/finance/monitores
router.get('/monitores', async (req, res) => {
    try {
        const monitores = await prisma.monitor.findMany({
            include: {
                desempenho: true,
                pagamentos: true
            },
            orderBy: { nome: 'asc' }
        });
        res.json(monitores);
    } catch (e) {
        console.error("Erro ao buscar monitores:", e);
        res.status(500).json({ error: "Erro ao buscar monitores" });
    }
});

// POST /api/finance/monitores
router.post('/monitores', async (req, res) => {
    try {
        const m = req.body;
        const novoMonitor = await prisma.monitor.create({
            data: {
                id: m.id || Date.now().toString(),
                nome: m.nome,
                nascimento: m.nascimento,
                telefone: m.telefone,
                email: m.email,
                endereco: m.endereco,
                observacoes: m.observacoes,
                cnh: m.cnh || false,
                cnhCategoria: m.cnhCategoria,
                fotoPerfil: m.fotoPerfil,
                fotoDocumento: m.fotoDocumento,
                habilidades: m.habilidades ? JSON.stringify(m.habilidades) : null
            }
        });
        res.json(novoMonitor);
    } catch (e) {
        console.error("Erro ao criar monitor:", e);
        res.status(500).json({ error: "Erro ao criar monitor" });
    }
});

// PUT /api/finance/monitores/:id
router.put('/monitores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const m = req.body;
        const updated = await prisma.monitor.update({
            where: { id },
            data: {
                nome: m.nome,
                nascimento: m.nascimento,
                telefone: m.telefone,
                email: m.email,
                endereco: m.endereco,
                observacoes: m.observacoes,
                cnh: m.cnh,
                cnhCategoria: m.cnhCategoria,
                fotoPerfil: m.fotoPerfil,
                fotoDocumento: m.fotoDocumento,
                habilidades: m.habilidades ? JSON.stringify(m.habilidades) : null
            }
        });
        res.json(updated);
    } catch (e) {
        console.error("Erro ao atualizar monitor:", e);
        res.status(500).json({ error: "Erro ao atualizar monitor" });
    }
});

// DELETE /api/finance/monitores/:id
router.delete('/monitores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.monitor.delete({ where: { id } });
        res.json({ success: true });
    } catch (e) {
        console.error("Erro ao deletar monitor:", e);
        res.status(500).json({ error: "Erro ao deletar monitor" });
    }
});

// --- DESEMPENHO (NOTAS) ---

// POST /api/finance/desempenho
router.post('/desempenho', async (req, res) => {
    try {
        const d = req.body;
        const novoDesempenho = await prisma.desempenho.create({
            data: {
                id: d.id || Date.now().toString(),
                data: d.data,
                descricao: d.descricao,
                nota: d.nota,
                obs: d.obs,
                detalhes: d.detalhes ? JSON.stringify(d.detalhes) : null,
                pagamentoId: d.pagamentoId,
                monitorId: d.monitorId
            }
        });
        res.json(novoDesempenho);
    } catch (e) {
        console.error("Erro ao criar desempenho:", e);
        res.status(500).json({ error: "Erro ao criar desempenho" });
    }
});

// --- PAGAMENTOS DE MONITORES ---

// GET /api/finance/pagamentos-monitores
router.get('/pagamentos-monitores', async (req, res) => {
    try {
        const pagamentos = await prisma.pagamentoMonitor.findMany({
            orderBy: { data: 'desc' },
            take: 500
        });
        res.json(pagamentos);
    } catch (e) {
        console.error("Erro ao buscar pagamentos:", e);
        res.status(500).json({ error: "Erro ao buscar pagamentos" });
    }
});

// POST /api/finance/pagamentos-monitores
router.post('/pagamentos-monitores', async (req, res) => {
    try {
        const p = req.body;
        const novoPagamento = await prisma.pagamentoMonitor.create({
            data: {
                id: p.id || Date.now().toString(),
                data: p.data,
                monitorId: p.monitorId,
                nome: p.nome,
                valorBase: parseFloat(p.valorBase),
                adicional: parseFloat(p.adicional) || 0,
                horasExtras: parseFloat(p.horasExtras) || 0,
                pagamento: parseFloat(p.pagamento),
                statusPagamento: p.statusPagamento || 'Executado',
                horaEntrada: p.horaEntrada,
                horaSaida: p.horaSaida,
                numEventos: p.numEventos ? parseFloat(p.numEventos) : null
            }
        });
        res.json(novoPagamento);
    } catch (e) {
        console.error("Erro ao criar pagamento:", e);
        res.status(500).json({ error: "Erro ao criar pagamento" });
    }
});

// DELETE /api/finance/pagamentos-monitores/:id
router.delete('/pagamentos-monitores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.pagamentoMonitor.delete({ where: { id } });
        res.json({ success: true });
    } catch (e) {
        console.error("Erro ao deletar pagamento:", e);
        res.status(500).json({ error: "Erro ao deletar pagamento" });
    }
});

// --- FUNCIONÁRIOS (SISTEMA DE SALÁRIOS) ---

// GET /api/finance/funcionarios
router.get('/funcionarios', async (req, res) => {
    try {
        const funcionarios = await prisma.funcionario.findMany({
            orderBy: { nome: 'asc' }
        });
        res.json(funcionarios);
    } catch (e) {
        console.error("Erro ao buscar funcionários:", e);
        res.status(500).json({ error: "Erro ao buscar funcionários" });
    }
});

// POST /api/finance/funcionarios
router.post('/funcionarios', async (req, res) => {
    try {
        const f = req.body;
        const novoFuncionario = await prisma.funcionario.create({
            data: {
                id: f.id || Date.now().toString(),
                nome: f.nome,
                salarioFixo: parseFloat(f.salarioFixo),
                va: parseFloat(f.va),
                vt: parseFloat(f.vt)
            }
        });
        res.json(novoFuncionario);
    } catch (e) {
        console.error("Erro ao criar funcionário:", e);
        res.status(500).json({ error: "Erro ao criar funcionário" });
    }
});

// DELETE /api/finance/funcionarios/:id
router.delete('/funcionarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.funcionario.delete({ where: { id } });
        res.json({ success: true });
    } catch (e) {
        console.error("Erro ao deletar funcionário:", e);
        res.status(500).json({ error: "Erro ao deletar funcionário" });
    }
});

// --- FAIXAS DE COMISSÃO ---

// GET /api/finance/faixas-comissao
router.get('/faixas-comissao', async (req, res) => {
    try {
        const faixas = await prisma.faixaComissao.findMany({
            orderBy: { ateValor: 'asc' }
        });
        res.json(faixas);
    } catch (e) {
        console.error("Erro ao buscar faixas:", e);
        res.status(500).json({ error: "Erro ao buscar faixas" });
    }
});

// POST /api/finance/faixas-comissao
router.post('/faixas-comissao', async (req, res) => {
    try {
        const f = req.body;
        const novaFaixa = await prisma.faixaComissao.create({
            data: {
                id: f.id || Date.now().toString(),
                ateValor: parseFloat(f.ateValor),
                percentual: parseFloat(f.percentual)
            }
        });
        res.json(novaFaixa);
    } catch (e) {
        console.error("Erro ao criar faixa:", e);
        res.status(500).json({ error: "Erro ao criar faixa" });
    }
});

// DELETE /api/finance/faixas-comissao/:id
router.delete('/faixas-comissao/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.faixaComissao.delete({ where: { id } });
        res.json({ success: true });
    } catch (e) {
        console.error("Erro ao deletar faixa:", e);
        res.status(500).json({ error: "Erro ao deletar faixa" });
    }
});

// --- SEED INICIAL DE FUNCIONÁRIOS E COMISSÃO ---

router.post('/seed-salarios', async (req, res) => {
    try {
        // Cria funcionário padrão se não existir
        const funcionariosPadrão = [
            { id: 'func-default-1', nome: 'Funcionário 1', salarioFixo: 2200, va: 390, vt: 223.60 }
        ];

        await prisma.funcionario.createMany({
            data: funcionariosPadrão,
            skipDuplicates: true
        });

        // Cria faixas de comissão padrão
        const faixasPadrão = [
            { id: 'com-1', ateValor: 45000, percentual: 0.02 },
            { id: 'com-2', ateValor: 55000, percentual: 0.025 },
            { id: 'com-3', ateValor: 65000, percentual: 0.03 },
            { id: 'com-4', ateValor: 75000, percentual: 0.035 },
            { id: 'com-5', ateValor: 85000, percentual: 0.04 },
            { id: 'com-6', ateValor: 95000, percentual: 0.045 },
            { id: 'com-7', ateValor: 99999999, percentual: 0.05 }
        ];

        await prisma.faixaComissao.createMany({
            data: faixasPadrão,
            skipDuplicates: true
        });

        res.json({
            success: true,
            message: 'Dados de salário inicializados!',
            funcionarios: funcionariosPadrão.length,
            faixas: faixasPadrão.length
        });
    } catch (e) {
        console.error("Erro ao criar seeds de salário:", e);
        res.status(500).json({ error: "Erro ao inicializar salários" });
    }
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

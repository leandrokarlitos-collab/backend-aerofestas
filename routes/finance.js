const express = require('express');
const router = express.Router();
const prisma = require('../prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { authenticate, isAuthenticated } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

// --- Rateio proporcional de eventos multi-dia entre meses ---
// Um evento que cruza a virada de mês contribui em cada mês na proporção de dias
// ativos que caem naquele mês: valor_total / nº_dias_ativos × dias_no_mês.
// Respeita excludedDates (dias alternados). Reuniões e eventos de 1 dia = 1 dia só.
function parseExcludedDatesFin(evt) {
    if (!evt.excludedDates) return [];
    if (Array.isArray(evt.excludedDates)) return evt.excludedDates;
    try { return JSON.parse(evt.excludedDates) || []; } catch { return []; }
}
function eventActiveDates(evt) {
    const start = evt.date;
    if (!start) return [];
    const end = (evt.endDate && evt.endDate >= start) ? evt.endDate : start;
    if (evt.eventType === 'meeting' || end === start) return [start];
    const excluded = new Set(parseExcludedDatesFin(evt));
    const out = [];
    const d = new Date(start + 'T00:00:00');
    const ed = new Date(end + 'T00:00:00');
    while (d <= ed) {
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!excluded.has(iso)) out.push(iso);
        d.setDate(d.getDate() + 1);
    }
    return out;
}
// Valor real de UM dia do evento: override do dia (subtotal ou itens) ou a base por dia.
function subtotalOfItemsFin(items) {
    return (items || []).reduce((a, i) => a + ((i.price != null ? Number(i.price) : 0) * (i.quantity || 1)), 0);
}
function parseOverridesFin(evt) {
    if (!evt.dateOverrides) return {};
    if (typeof evt.dateOverrides === 'object') return evt.dateOverrides;
    try { return JSON.parse(evt.dateOverrides) || {}; } catch { return {}; }
}
function dayValueFin(dayIso, basePerDay, overrides) {
    const ov = overrides[dayIso];
    if (ov && Array.isArray(ov.items)) return (ov.subtotal != null) ? Number(ov.subtotal) : subtotalOfItemsFin(ov.items);
    return basePerDay;
}
// Fração do evento atribuível ao intervalo [startStr, endStr], pelo PESO (valor real) de cada dia.
// Distribuir o total do evento por esse peso CONSERVA sempre o total — nunca infla, inclusive em
// eventos de "valor fechado" (item = total do evento). 'upfront'/ingresso: tudo no mês de início.
function eventFractionInRange(evt, startStr, endStr) {
    const active = eventActiveDates(evt);
    if (!active.length) return 0;
    if (evt.isTicketSale || (evt.revenueMode || 'perDay') === 'upfront') {
        return (evt.date >= startStr && evt.date <= endStr) ? 1 : 0;
    }
    const overrides = parseOverridesFin(evt);
    const basePerDay = subtotalOfItemsFin(evt.items);
    const weights = active.map(d => dayValueFin(d, basePerDay, overrides));
    let totalW = weights.reduce((a, b) => a + b, 0);
    const useCount = totalW <= 0;      // sem valor por dia → peso igual por dia
    if (useCount) totalW = active.length;
    let rangeW = 0;
    active.forEach((d, i) => { if (d >= startStr && d <= endStr) rangeW += (useCount ? 1 : weights[i]); });
    return totalW > 0 ? rangeW / totalW : 0;
}
// Receita: ingresso = líquido no mês de início; senão o preço do evento distribuído pelo peso dos dias.
function eventRevenueInRange(evt, startStr, endStr) {
    if (evt.isTicketSale) {
        if (evt.ticketNetTotal == null) return 0;
        return (evt.date >= startStr && evt.date <= endStr) ? (Number(evt.ticketNetTotal) || 0) : 0;
    }
    return (Number(evt.price) || 0) * eventFractionInRange(evt, startStr, endStr);
}
// Custo de locações externas atribuído ao intervalo pela mesma fração (conserva o total).
function eventRentalsInRange(evt, startStr, endStr) {
    const rentals = (evt.externalRentals || []).reduce((s, r) => s + (Number(r.cost) || 0), 0);
    if (!rentals) return 0;
    return rentals * eventFractionInRange(evt, startStr, endStr);
}

// --- Conta fixa parcelada: vencimento por parcela (installmentDates) ---
// Normaliza para string JSON ao gravar; parse tolerante ao ler.
function normalizeInstallmentDates(v) {
    if (v == null) return null;
    if (typeof v === 'string') { const t = v.trim(); return (t === '' || t === 'null') ? null : t; }
    if (Array.isArray(v)) return v.length ? JSON.stringify(v) : null;
    return null;
}
function parseInstallmentDatesFE(fe) {
    const raw = fe.installmentDates;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { return JSON.parse(raw) || []; } catch { return []; }
}

// --- AUTENTICAÇÃO ---
// Todas as rotas de /api/finance exigem token, EXCETO as usadas pelo
// formulário PÚBLICO de cadastro/atualização de monitores
// (cadastro-monitor.html, enviado a candidatos sem login):
//   POST /monitores            (cadastro)
//   POST /monitores/verificar  (checagem de CPF/e-mail duplicado)
//   GET  /monitores/:id        (link de atualização ?id=)
//   PUT  /monitores/:id        (salvar atualização via link)
// Obs.: endurecer o par GET/PUT público com token assinado no link é melhoria
// futura — hoje preserva o fluxo existente do formulário público.
const FINANCE_ROTAS_PUBLICAS = [
    { method: 'POST', re: /^\/monitores\/?$/ },
    { method: 'POST', re: /^\/monitores\/verificar\/?$/ },
    { method: 'POST', re: /^\/monitores\/[^/]+\/confirmar-cpf\/?$/ },
    { method: 'GET',  re: /^\/monitores\/[^/]+\/?$/ },
    { method: 'PUT',  re: /^\/monitores\/[^/]+\/?$/ },
];
router.use((req, res, next) => {
    const publica = FINANCE_ROTAS_PUBLICAS.some(r => r.method === req.method && r.re.test(req.path));
    if (publica) return next();
    return authenticate(req, res, next);
});

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
        const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

        // 1. Receitas de Eventos — eventos cancelados NÃO entram na receita.
        // Busca eventos que SE SOBREPÕEM ao mês (não só os que começam nele): um
        // evento multi-dia que cruza a virada de mês precisa contribuir em cada mês
        // tocado, com o valor real dos dias daquele mês (ver eventRevenueInRange).
        const events = await prisma.event.findMany({
            where: {
                date: { lte: endStr },
                OR: [
                    { endDate: { gte: startStr } }, // multi-dia que termina dentro/após o mês
                    { date: { gte: startStr } }     // qualquer evento que começa no mês (inclui 1 dia)
                ]
            },
            include: { externalRentals: true, items: true }
        });
        const eventosDoMes = events.filter(evt => evt.status !== 'cancelado' && evt.paymentStatus !== 'Cancelado');
        // Receita: cada dia com seu VALOR REAL (ver eventRevenueInRange). Eventos multi-dia que
        // cruzam a virada de mês somam, em cada mês, o valor dos dias que caem nele. Eventos por
        // ingresso entram pelo líquido realizado, no mês de início.
        const receitaEventos = eventosDoMes.reduce((acc, evt) => acc + eventRevenueInRange(evt, startStr, endStr), 0);

        // 1.2 Locações externas (custo de equipamentos de terceiros usados em eventos)
        // - Só contam de eventos não-cancelados
        // - Entram como despesa no mês de início do evento (uma vez).
        const externalRentalsExpense = eventosDoMes.reduce((acc, evt) => acc + eventRentalsInRange(evt, startStr, endStr), 0);

        // 1.1 Receitas Manuais (Transações)
        const revenueTransactions = await prisma.transaction.findMany({
            where: { type: 'REVENUE', date: { gte: startStr, lte: endStr } }
        });
        const receitaManual = revenueTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);

        const receitaTotal = receitaEventos + receitaManual;

        // 2. Despesas Diversas (Transações)
        const transactions = await prisma.transaction.findMany({
            where: { type: 'EXPENSE', date: { gte: startStr, lte: endStr } }
        });
        const expensesFromTransactions = transactions.reduce((acc, tra) => acc + (tra.amount || 0), 0);

        // 3. Monitores (Pagos vs Pendentes)
        const monitorPayments = await prisma.pagamentoMonitor.findMany({
            where: { data: { gte: startStr, lte: endStr } }
        });

        const monitorPaid = monitorPayments
            .filter(p => p.statusPagamento === 'Executado')
            .reduce((acc, p) => acc + (p.pagamento || 0), 0);

        const monitorPendingDetails = monitorPayments
            .filter(p => p.statusPagamento !== 'Executado')
            .map(p => ({
                id: p.id,
                description: `Monitor: ${p.nome}`,
                amount: p.pagamento || 0,
                type: 'monitor'
            }));
        const monitorPending = monitorPendingDetails.reduce((acc, p) => acc + p.amount, 0);

        // 4. Contas Fixas Pendentes
        const fixedExpenses = await prisma.fixedExpense.findMany();
        const fixedPendingDetails = [];

        for (const fe of fixedExpenses) {
            let isMonthActive = true;
            const installmentDates = parseInstallmentDatesFE(fe);
            if (installmentDates.length) {
                // Parcelas com vencimento próprio: ativa só nos meses que têm uma parcela.
                isMonthActive = installmentDates.some(d => (d || '').slice(0, 7) === monthStr);
            } else if (fe.recurrenceType === 'parcelada' && fe.startDate) {
                const [startYear, startMonth] = fe.startDate.split('-').map(Number);
                const monthsDiff = (currentYear - startYear) * 12 + ((currentMonth + 1) - startMonth);
                if (monthsDiff < 0 || monthsDiff >= (fe.installments || 0)) {
                    isMonthActive = false;
                }
            } else if (fe.startDate) {
                const [startYear, startMonth] = fe.startDate.split('-').map(Number);
                const monthsDiff = (currentYear - startYear) * 12 + ((currentMonth + 1) - startMonth);
                if (monthsDiff < 0) isMonthActive = false;
            }

            if (isMonthActive) {
                const alreadyPaid = transactions.some(t =>
                    t.description && t.description.includes(fe.description) &&
                    t.description.includes('[Conta Fixa]')
                );

                if (!alreadyPaid) {
                    fixedPendingDetails.push({
                        id: fe.id,
                        description: fe.description,
                        amount: fe.amount || 0,
                        type: 'fixed'
                    });
                }
            }
        }
        const fixedPending = fixedPendingDetails.reduce((acc, p) => acc + p.amount, 0);

        // 5. Salários Pendentes (Simulado por Funcionários Cadastrados)
        const employees = await prisma.funcionario.findMany();
        const commissionScales = await prisma.faixaComissao.findMany({ orderBy: { ateValor: 'asc' } });
        const salaryPendingDetails = [];

        // Calcula percentual de comissão para este faturamento
        let percentualComissao = 0;
        if (commissionScales.length > 0) {
            const faixa = commissionScales.find(f => receitaTotal <= f.ateValor) || commissionScales[commissionScales.length - 1];
            percentualComissao = faixa ? faixa.percentual : 0;
        }

        for (const emp of employees) {
            // Soma todos os pagamentos já realizados para este funcionário no mês
            const totalAlreadyPaid = transactions
                .filter(t => t.description && t.description.includes(`Salário: ${emp.nome}`))
                .reduce((acc, t) => acc + (t.amount || 0), 0);

            const comissao = receitaTotal * percentualComissao;
            const totalExpected = (emp.salarioFixo || 0) + (emp.va || 0) + (emp.vt || 0) + comissao;

            if (totalAlreadyPaid < totalExpected - 0.01) { // Margem pequena para arredondamento
                salaryPendingDetails.push({
                    id: emp.id,
                    description: `Salário: ${emp.nome} (Restante)`,
                    amount: totalExpected - totalAlreadyPaid,
                    totalExpected: totalExpected,
                    alreadyPaid: totalAlreadyPaid,
                    type: 'salary'
                });
            }
        }
        const salaryPending = salaryPendingDetails.reduce((acc, p) => acc + p.amount, 0);

        const despesaTotal = expensesFromTransactions + monitorPaid + externalRentalsExpense;
        const pendingTotal = monitorPending + fixedPending + salaryPending;
        const allPendingDetails = [...monitorPendingDetails, ...fixedPendingDetails, ...salaryPendingDetails];

        res.json({
            period: `${currentMonth + 1}/${currentYear}`,
            summary: {
                revenue: receitaTotal,
                expenses: despesaTotal,
                balance: receitaTotal - despesaTotal,
                pendingExpenses: pendingTotal,
                pendingDetails: allPendingDetails
            }
        });
    } catch (error) {
        console.error("Erro no dashboard:", error);
        res.status(500).json({ error: "Erro financeiro" });
    }
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
                accountId: t.accountId,
                declaredBy: t.declaredBy || null,
                expenseDetail: t.expenseDetail || null
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
                accountId: t.accountId,
                declaredBy: t.declaredBy || null,
                expenseDetail: t.expenseDetail || null
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
                installments: f.installments ? parseInt(f.installments) : null,
                installmentDates: normalizeInstallmentDates(f.installmentDates)
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
                installments: f.installments ? parseInt(f.installments) : null,
                installmentDates: normalizeInstallmentDates(f.installmentDates)
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

// PUT Categoria de Gasto
router.put('/categories/expenses/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await prisma.expenseCategory.update({
            where: { id },
            data: { name: req.body.name }
        });
        res.json(updated);
    } catch (e) { res.status(500).json({ error: "Erro ao atualizar categoria" }); }
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

// PUT Categoria de Conta Fixa
router.put('/categories/fixed/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await prisma.fixedExpenseCategory.update({
            where: { id },
            data: { name: req.body.name }
        });
        res.json(updated);
    } catch (e) { res.status(500).json({ error: "Erro ao atualizar categoria" }); }
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

// Status de classificação permitidos para o monitor
const MONITOR_STATUS_VALIDOS = ['ativo', 'reserva', 'alerta', 'desqualificado'];

// --- Acesso ao app do monitor (F1) ---

const MONITOR_APP_LINK = 'https://agenda-aero-festas.web.app/app-monitor/login.html';

// E-mail de aprovação (mesmo padrão Gmail de routes/auth.js)
const monitorMailer = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

// Placeholder usado pelo formulário quando o candidato não tem e-mail
const EMAIL_PLACEHOLDER = 'naopossui@aerofestas.com.br';

const soDigitosCpf = (v) => String(v || '').replace(/\D/g, '');

// Remove credenciais de qualquer resposta que devolva um Monitor.
function semCredenciais(monitor) {
    if (!monitor) return monitor;
    const { senhaHash, resetSenhaToken, resetSenhaExpira, ...limpo } = monitor;
    return limpo;
}

// Visão pública mínima do monitor: só o necessário para a etapa de
// identificação do formulário (a ficha completa exige confirmar o CPF).
function perfilPublicoMinimo(monitor) {
    return {
        id: monitor.id,
        nome: monitor.nome,
        nascimento: monitor.nascimento,
        temCpf: soDigitosCpf(monitor.cpf).length > 0
    };
}

// Contém tentativa e erro de CPF no link público de atualização
const limiterConfirmarCpf = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' }
});

// Normaliza ocorrências para string JSON (aceita array do front ou string já serializada)
function normalizeOcorrencias(v) {
    if (v == null) return undefined; // undefined = não mexe no campo
    if (Array.isArray(v)) return JSON.stringify(v);
    if (typeof v === 'string') {
        const t = v.trim();
        if (t === '' || t === 'null' || t === '[]') return null;
        return t;
    }
    return null;
}

// Aplica os campos administrativos de classificação (status, statusMotivo, ocorrências)
// ao objeto `data` SOMENTE quando a requisição está autenticada. Rotas de monitor
// (POST/PUT) são públicas para o formulário de cadastro do candidato; sem esta trava,
// qualquer um poderia alterar/zerar a classificação disciplinar de um monitor.
function aplicarClassificacaoSePermitido(data, m, req) {
    if (!isAuthenticated(req)) return;
    if (MONITOR_STATUS_VALIDOS.includes(m.status)) data.status = m.status;
    if (m.statusMotivo !== undefined) data.statusMotivo = m.statusMotivo || null;
    const ocorr = normalizeOcorrencias(m.ocorrencias);
    if (ocorr !== undefined) data.ocorrencias = ocorr;
}

// GET /api/finance/monitores (Otimizado para Performance)
router.get('/monitores', async (req, res) => {
    try {
        const { page = 1, limit = 50, status } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const where = {};
        if (status) where.status = status;

        const monitores = await prisma.monitor.findMany({
            where,
            select: {
                id: true,
                nome: true,
                nascimento: true,
                telefone: true,
                email: true,
                cpf: true,
                endereco: true,
                observacoes: true,
                status: true,
                statusMotivo: true,   // Observação da classificação (alerta/desqualificado)
                ocorrencias: true,    // JSON de tags de ocorrência
                comoChegou: true,     // Origem (indicação/outro) — exibida no card
                indicadoPor: true,    // Quem indicou — exibido no card
                disponibilidade: true, // Dias/turnos disponíveis — exibida no card
                cnh: true,
                cnhCategoria: true,
                tamanhoCamiseta: true,
                possuiCursoPS: true,
                fotoPerfil: true, // Traz URL (leve) para mostrar nos cards
                fotoDocumento: false, // Documento não precisa na listagem
                fotoCertificadoPS: false, // PS não precisa na listagem
                acessoStatus: true,   // Badge de acesso ao app (F1)
                ultimoLoginApp: true, // Último login no app do monitor
                // Relacionamentos básicos se necessário
                desempenho: { take: 1, orderBy: { data: 'desc' } },
                // Nº de convocações = diárias/pagamentos registrados (mostrado no card)
                _count: { select: { pagamentos: true } }
            },
            skip: skip,
            take: parseInt(limit),
            orderBy: { nome: 'asc' }
        });
        res.json(monitores);
    } catch (e) {
        console.error("Erro ao buscar monitores:", e);
        res.status(500).json({ error: "Erro ao buscar monitores" });
    }
});

// GET /api/finance/monitores/:id
// Rota pública (link de atualização ?id=). Sem token de gestor devolve SÓ a visão
// mínima de identificação — a ficha completa (saúde, documentos, CPF) exige
// confirmar o CPF em POST /monitores/:id/confirmar-cpf. Nunca devolve senhaHash.
router.get('/monitores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const monitor = await prisma.monitor.findUnique({
            where: { id },
            include: {
                desempenho: true,
                pagamentos: true
            }
        });
        if (!monitor) return res.status(404).json({ error: "Monitor não encontrado" });
        if (!isAuthenticated(req)) {
            return res.json(perfilPublicoMinimo(monitor));
        }
        res.json(semCredenciais(monitor));
    } catch (e) {
        console.error("Erro ao buscar monitor:", e);
        res.status(500).json({ error: "Erro ao buscar monitor" });
    }
});

// POST /api/finance/monitores/:id/confirmar-cpf
// Etapa 2 do link público: o candidato prova a identidade informando o CPF.
// Só então recebe a ficha completa para pré-preencher o formulário de
// atualização (sem isso, o PUT em branco apagaria os dados existentes).
router.post('/monitores/:id/confirmar-cpf', limiterConfirmarCpf, async (req, res) => {
    try {
        const { id } = req.params;
        const cpfDigitos = soDigitosCpf(req.body && req.body.cpf);
        if (cpfDigitos.length !== 11) {
            return res.status(400).json({ error: 'Informe um CPF válido.' });
        }

        const monitor = await prisma.monitor.findUnique({ where: { id } });
        if (!monitor) return res.status(404).json({ error: 'Monitor não encontrado' });

        // Cadastro antigo sem CPF: aceita o CPF informado (é gravado no update).
        const cpfSalvo = soDigitosCpf(monitor.cpf);
        if (cpfSalvo && cpfSalvo !== cpfDigitos) {
            return res.status(403).json({ error: 'CPF não confere com o cadastro original.' });
        }

        res.json(semCredenciais(monitor));
    } catch (e) {
        console.error("Erro ao confirmar CPF do monitor:", e);
        res.status(500).json({ error: "Erro ao confirmar CPF" });
    }
});

// POST /api/finance/monitores/verificar
router.post('/monitores/verificar', async (req, res) => {
    try {
        const { nome, nascimento } = req.body;
        if (!nome || !nascimento) {
            return res.status(400).json({ error: "Nome e data de nascimento são obrigatórios." });
        }

        const monitor = await prisma.monitor.findFirst({
            where: {
                nome: { equals: nome, mode: 'insensitive' },
                nascimento: nascimento
            }
        });

        if (monitor) {
            // Visão mínima: a ficha completa só sai após confirmar o CPF
            // (POST /monitores/:id/confirmar-cpf) — evita vazar saúde/CPF/fotos
            // para quem só conhece nome + nascimento.
            return res.json({ found: true, monitor: perfilPublicoMinimo(monitor) });
        } else {
            return res.json({ found: false });
        }
    } catch (e) {
        console.error("Erro ao verificar monitor:", e);
        res.status(500).json({ error: "Erro interno ao verificar monitor." });
    }
});

// POST /api/finance/monitores
router.post('/monitores', async (req, res) => {
    try {
        const m = req.body;
        const cpfLimpo = m.cpf ? String(m.cpf).trim() : '';
        const dadosMonitor = {
            id: m.id || Date.now().toString(),
            nome: m.nome,
            cpf: cpfLimpo || null,
            nascimento: m.nascimento,
            telefone: m.telefone,
            email: m.email,
            endereco: m.endereco,
            observacoes: m.observacoes,
            comoChegou: m.comoChegou || null,
            indicadoPor: m.indicadoPor || null,
            disponibilidade: m.disponibilidade || null,
            cnh: m.cnh || false,
            cnhCategoria: m.cnhCategoria,
            fotoPerfil: m.fotoPerfil,
            fotoDocumento: m.fotoDocumento,
            habilidades: m.habilidades ? JSON.stringify(m.habilidades) : null,
            tipoSanguineo: m.tipoSanguineo,
            medicamentos: m.medicamentos,
            restricoesAlimentares: m.restricoesAlimentares,
            alergias: m.alergias,
            planoSaude: m.planoSaude,
            condicaoMedica: m.condicaoMedica,
            tamanhoCamiseta: m.tamanhoCamiseta,
            escolaridade: m.escolaridade,
            possuiCursoPS: m.possuiCursoPS,
            fotoCertificadoPS: m.fotoCertificadoPS,
            habilidadesEspecificas: m.habilidadesEspecificas,
            idiomas: m.idiomas, // Já vem como stringified JSON do front
            experiencias: m.experiencias,
            fobias: m.fobias,
            contatoEmergenciaNome: m.contatoEmergenciaNome,
            contatoEmergenciaParentesco: m.contatoEmergenciaParentesco,
            contatoEmergenciaTelefone: m.contatoEmergenciaTelefone,
            instagram: m.instagram,
            facebook: m.facebook,
            linkedin: m.linkedin,
            tiktok: m.tiktok
        };
        // Classificação (status/motivo/ocorrências) é administrativa: só é aceita de
        // requisições autenticadas. No cadastro público, status cai no default do
        // schema ("reserva") e motivo/ocorrências ficam nulos — impossível um candidato
        // (ou terceiro sem token) se auto-classificar via o link público.
        aplicarClassificacaoSePermitido(dadosMonitor, m, req);
        // Acesso ao app (F1): o candidato define a senha no cadastro público e a
        // conta nasce 'pendente' — inócua até o gestor aprovar em equipe.html.
        if (m.senha != null && String(m.senha) !== '') {
            const senha = String(m.senha);
            if (senha.length < 6) {
                return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
            }
            dadosMonitor.senhaHash = await bcrypt.hash(senha, 10);
            dadosMonitor.acessoStatus = 'pendente';
        }
        const novoMonitor = await prisma.monitor.create({ data: dadosMonitor });
        res.json(semCredenciais(novoMonitor));
    } catch (e) {
        console.error("Erro ao criar monitor:", e);
        if (e.code === 'P2002' && Array.isArray(e.meta?.target) && e.meta.target.includes('cpf')) {
            return res.status(409).json({ error: "Já existe um monitor cadastrado com este CPF." });
        }
        res.status(500).json({ error: "Erro ao criar monitor" });
    }
});

// PUT /api/finance/monitores/:id
router.put('/monitores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const m = req.body;
        const cpfLimpo = m.cpf !== undefined ? (String(m.cpf).trim() || null) : undefined;
        const dadosMonitor = {
            nome: m.nome,
            cpf: cpfLimpo,
            nascimento: m.nascimento,
            telefone: m.telefone,
            email: m.email,
            endereco: m.endereco,
            observacoes: m.observacoes,
            comoChegou: m.comoChegou,
            indicadoPor: m.indicadoPor,
            disponibilidade: m.disponibilidade,
            cnh: m.cnh,
            cnhCategoria: m.cnhCategoria,
            fotoPerfil: m.fotoPerfil,
            fotoDocumento: m.fotoDocumento,
            habilidades: m.habilidades ? JSON.stringify(m.habilidades) : undefined,
            tipoSanguineo: m.tipoSanguineo,
            medicamentos: m.medicamentos,
            restricoesAlimentares: m.restricoesAlimentares,
            alergias: m.alergias,
            planoSaude: m.planoSaude,
            condicaoMedica: m.condicaoMedica,
            tamanhoCamiseta: m.tamanhoCamiseta,
            escolaridade: m.escolaridade,
            possuiCursoPS: m.possuiCursoPS,
            fotoCertificadoPS: m.fotoCertificadoPS,
            habilidadesEspecificas: m.habilidadesEspecificas,
            idiomas: m.idiomas,
            experiencias: m.experiencias,
            fobias: m.fobias,
            contatoEmergenciaNome: m.contatoEmergenciaNome,
            contatoEmergenciaParentesco: m.contatoEmergenciaParentesco,
            contatoEmergenciaTelefone: m.contatoEmergenciaTelefone,
            instagram: m.instagram,
            facebook: m.facebook,
            linkedin: m.linkedin,
            tiktok: m.tiktok
        };
        // status/statusMotivo/ocorrências só mudam via requisição autenticada. O
        // formulário PÚBLICO de atualização do candidato (cadastro-monitor.html, que
        // envia status:'reserva' fixo) NÃO pode rebaixar/limpar a classificação de um
        // monitor já marcado como alerta/desqualificado — os campos são ignorados aqui.
        // dadosMonitor é uma whitelist explícita: senhaHash/acessoStatus e demais
        // campos de acesso (F1) NUNCA entram por esta rota pública.
        aplicarClassificacaoSePermitido(dadosMonitor, m, req);
        const updated = await prisma.monitor.update({ where: { id }, data: dadosMonitor });
        res.json(semCredenciais(updated));
    } catch (e) {
        console.error("Erro ao atualizar monitor:", e);
        if (e.code === 'P2002' && Array.isArray(e.meta?.target) && e.meta.target.includes('cpf')) {
            return res.status(409).json({ error: "Já existe outro monitor com este CPF." });
        }
        if (e.code === 'P2025') {
            return res.status(404).json({ error: "Monitor não encontrado." });
        }
        res.status(500).json({ error: "Erro ao atualizar monitor" });
    }
});

// PATCH /api/finance/monitores/:id/status
// Classificação do monitor: status + observação (motivo) + ocorrências.
router.patch('/monitores/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, statusMotivo, ocorrencias } = req.body;
        if (!MONITOR_STATUS_VALIDOS.includes(status)) {
            return res.status(400).json({ error: `Status inválido. Use um de: ${MONITOR_STATUS_VALIDOS.join(', ')}.` });
        }
        const data = { status };
        // Só grava motivo/ocorrências quando enviados (permite classificar sem apagar o resto)
        if (statusMotivo !== undefined) data.statusMotivo = statusMotivo || null;
        const ocorr = normalizeOcorrencias(ocorrencias);
        if (ocorr !== undefined) data.ocorrencias = ocorr;
        const updated = await prisma.monitor.update({ where: { id }, data });
        res.json(semCredenciais(updated));
    } catch (e) {
        console.error("Erro ao alterar status do monitor:", e);
        res.status(500).json({ error: "Erro ao alterar status" });
    }
});

// DELETE /api/finance/monitores/:id
router.delete('/monitores/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.monitor.delete({ where: { id } });
        res.json({ success: true });
    } catch (e) {
        console.error("Erro ao deletar monitor:", e);
        res.status(500).json({ error: "Erro ao deletar monitor" });
    }
});

// PATCH /api/finance/monitores/:id/acesso
// Ciclo de acesso ao app do monitor (F1), só gestor: aprovar | bloquear | reativar.
// (Rota autenticada pelo router.use — não está em FINANCE_ROTAS_PUBLICAS.)
router.patch('/monitores/:id/acesso', async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body || {};
        const ACOES = { aprovar: 'ativo', bloquear: 'bloqueado', reativar: 'ativo' };
        if (!ACOES[action]) {
            return res.status(400).json({ error: "Ação inválida. Use 'aprovar', 'bloquear' ou 'reativar'." });
        }

        const monitor = await prisma.monitor.findUnique({ where: { id } });
        if (!monitor) return res.status(404).json({ error: 'Monitor não encontrado' });

        if (action === 'aprovar' && monitor.acessoStatus !== 'pendente') {
            return res.status(400).json({ error: 'Só é possível aprovar contas pendentes.' });
        }
        if (action === 'reativar' && monitor.acessoStatus !== 'bloqueado') {
            return res.status(400).json({ error: 'Só é possível reativar contas bloqueadas.' });
        }

        const data = { acessoStatus: ACOES[action] };
        if (action === 'aprovar') {
            data.acessoAprovadoPor = req.user.id;
            data.acessoAprovadoEm = new Date();
        }
        const updated = await prisma.monitor.update({ where: { id }, data });

        logAudit({
            entityType: 'MonitorAcesso',
            entityId: id,
            action: action.toUpperCase(),
            user: req.user,
            changes: { acessoStatus: { old: monitor.acessoStatus, new: updated.acessoStatus } }
        });

        // E-mail com o link do app (melhor esforço; se falhar, o gestor copia o link)
        let emailEnviado = false;
        if (action === 'aprovar' && monitor.email && monitor.email !== EMAIL_PLACEHOLDER) {
            emailEnviado = true;
            monitorMailer.sendMail({
                from: `"Aero Festas" <${process.env.GMAIL_USER}>`,
                to: monitor.email,
                subject: 'Seu acesso ao app da Aero Festas foi liberado! 🎉',
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2>Olá, ${monitor.nome ? monitor.nome.split(' ')[0] : 'monitor'}!</h2>
                        <p>Seu acesso ao app do monitor da <b>Aero Festas</b> foi aprovado.</p>
                        <p>Entre com o seu <b>CPF</b> e a <b>senha que você definiu no cadastro</b>:</p>
                        <a href="${MONITOR_APP_LINK}" style="background-color: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Abrir o app do monitor</a>
                        <p style="margin-top: 16px; font-size: 12px; color: #64748b;">Se o botão não funcionar, copie e cole este link: ${MONITOR_APP_LINK}</p>
                    </div>
                `
            }).catch(err => {
                console.error('Erro e-mail aprovação monitor:', err);
            });
        }

        res.json({ monitor: semCredenciais(updated), appLink: MONITOR_APP_LINK, emailEnviado });
    } catch (e) {
        console.error("Erro ao alterar acesso do monitor:", e);
        res.status(500).json({ error: "Erro ao alterar acesso" });
    }
});

// POST /api/finance/monitores/:id/reset-senha
// Gestor gera senha temporária ("monitores são seres com amnésia"). A senha é
// devolvida UMA única vez para o gestor repassar ao monitor.
router.post('/monitores/:id/reset-senha', async (req, res) => {
    try {
        const { id } = req.params;
        const monitor = await prisma.monitor.findUnique({ where: { id } });
        if (!monitor) return res.status(404).json({ error: 'Monitor não encontrado' });

        const senhaTemporaria = crypto.randomBytes(4).toString('hex'); // 8 caracteres
        const data = { senhaHash: await bcrypt.hash(senhaTemporaria, 10) };
        // Monitor que nunca teve acesso: gestor definir a senha = provisionamento
        // direto (já sai ativo). 'pendente' e 'bloqueado' NÃO mudam — aprovação e
        // reativação continuam sendo decisões explícitas.
        if (monitor.acessoStatus === 'sem_acesso') {
            data.acessoStatus = 'ativo';
            data.acessoAprovadoPor = req.user.id;
            data.acessoAprovadoEm = new Date();
        }
        const updated = await prisma.monitor.update({ where: { id }, data });

        logAudit({
            entityType: 'MonitorAcesso',
            entityId: id,
            action: 'RESET_SENHA',
            user: req.user,
            changes: monitor.acessoStatus !== updated.acessoStatus
                ? { acessoStatus: { old: monitor.acessoStatus, new: updated.acessoStatus } }
                : null
        });

        res.json({ senhaTemporaria, acessoStatus: updated.acessoStatus, appLink: MONITOR_APP_LINK });
    } catch (e) {
        console.error("Erro ao resetar senha do monitor:", e);
        res.status(500).json({ error: "Erro ao resetar senha" });
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
        // Monitor avulso (não-cadastrado): sem monitorId, identificado só pelo nome.
        if (!p.monitorId && !(p.nome && String(p.nome).trim())) {
            return res.status(400).json({ error: "Informe o monitor ou o nome do monitor avulso." });
        }
        const id = p.id || Date.now().toString();
        const dados = {
            data: p.data,
            dataPagamento: p.dataPagamento,
            eventoId: p.eventoId || null,
            monitorId: p.monitorId || null,
            nome: p.nome,
            valorBase: parseFloat(p.valorBase),
            adicional: parseFloat(p.adicional) || 0,
            horasExtras: parseFloat(p.horasExtras) || 0,
            horasDiaria: p.horasDiaria != null ? parseFloat(p.horasDiaria) : 11,
            pagamento: parseFloat(p.pagamento),
            statusPagamento: p.statusPagamento || 'Executado',
            horaEntrada: p.horaEntrada,
            horaSaida: p.horaSaida,
            foiMotorista: p.foiMotorista || false,
            numEventos: p.numEventos ? parseFloat(p.numEventos) : null,
            observacoes: p.observacoes || null,
            tipo: p.tipo === 'diverso' ? 'diverso' : 'diaria',
            descricao: p.descricao || null,
            indicacoes: Math.max(0, parseInt(p.indicacoes) || 0)
        };
        // Upsert (não create) para tornar o POST idempotente: se a resposta HTTP de
        // um lançamento se perder depois do commit, o retry com o mesmo id (UUID gerado
        // no cliente) reaproveita o registro em vez de estourar violação de PK.
        const novoPagamento = await prisma.pagamentoMonitor.upsert({
            where: { id },
            create: { id, ...dados },
            update: dados
        });
        res.json(novoPagamento);
    } catch (e) {
        console.error("Erro ao criar pagamento:", e);
        res.status(500).json({ error: "Erro ao criar pagamento" });
    }
});

// POST /api/finance/pagamentos-monitores/transferir
// Vincula diárias avulsas (monitorId null) a um monitor cadastrado. Usado na
// reconciliação: quando um monitor é cadastrado e há diárias avulsas com nome
// parecido, o usuário do painel escolhe quais transferir.
router.post('/pagamentos-monitores/transferir', async (req, res) => {
    try {
        const { monitorId, ids } = req.body;
        if (!monitorId || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: "Informe monitorId e a lista de diárias (ids)." });
        }
        // Guarda monitorId:null — só transfere o que ainda está avulso, nunca "rouba"
        // uma diária já vinculada a outro monitor.
        const result = await prisma.pagamentoMonitor.updateMany({
            where: { id: { in: ids }, monitorId: null },
            data: { monitorId }
        });
        res.json({ success: true, transferidos: result.count });
    } catch (e) {
        console.error("Erro ao transferir diárias avulsas:", e);
        res.status(500).json({ error: "Erro ao transferir diárias avulsas" });
    }
});

// PUT /api/finance/pagamentos-monitores/:id
router.put('/pagamentos-monitores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const p = req.body;

        // Monitor avulso (não-cadastrado): sem monitorId, identificado só pelo nome.
        if (!p.monitorId && !(p.nome && String(p.nome).trim())) {
            return res.status(400).json({ error: "Informe o monitor ou o nome do monitor avulso." });
        }

        const pagamentoAtualizado = await prisma.pagamentoMonitor.update({
            where: { id },
            data: {
                data: p.data,
                dataPagamento: p.dataPagamento,
                eventoId: p.eventoId || null,
                monitorId: p.monitorId || null,
                nome: p.nome,
                valorBase: parseFloat(p.valorBase),
                adicional: parseFloat(p.adicional) || 0,
                horasExtras: parseFloat(p.horasExtras) || 0,
                horasDiaria: p.horasDiaria != null ? parseFloat(p.horasDiaria) : 11,
                pagamento: parseFloat(p.pagamento),
                statusPagamento: p.statusPagamento || 'Pendente',
                horaEntrada: p.horaEntrada,
                horaSaida: p.horaSaida,
                foiMotorista: p.foiMotorista || false,
                numEventos: p.numEventos ? parseFloat(p.numEventos) : null,
                observacoes: p.observacoes || null,
                tipo: p.tipo === 'diverso' ? 'diverso' : 'diaria',
                descricao: p.descricao || null,
                indicacoes: Math.max(0, parseInt(p.indicacoes) || 0)
            }
        });

        res.json(pagamentoAtualizado);
    } catch (e) {
        console.error("Erro ao atualizar pagamento:", e);
        res.status(500).json({ error: "Erro ao atualizar pagamento" });
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

// PUT /api/finance/funcionarios/:id
router.put('/funcionarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const f = req.body;
        const updated = await prisma.funcionario.update({
            where: { id },
            data: {
                nome: f.nome,
                salarioFixo: parseFloat(f.salarioFixo),
                va: parseFloat(f.va),
                vt: parseFloat(f.vt)
            }
        });
        res.json(updated);
    } catch (e) {
        console.error("Erro ao atualizar funcionário:", e);
        res.status(500).json({ error: "Erro ao atualizar funcionário" });
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

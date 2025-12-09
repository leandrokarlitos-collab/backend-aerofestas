const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth'); // Se tiver middleware, se não, remova

// GET /api/finance/dashboard
// Retorna o resumo financeiro (Entradas via Eventos, Saídas via Transações)
router.get('/dashboard', async (req, res) => {
    try {
        const { month, year } = req.query;
        
        // Define o intervalo de datas (Se não mandar, pega o mês atual)
        const date = new Date();
        const currentMonth = month ? parseInt(month) - 1 : date.getMonth();
        const currentYear = year ? parseInt(year) : date.getFullYear();
        
        const startDate = new Date(currentYear, currentMonth, 1);
        const endDate = new Date(currentYear, currentMonth + 1, 0); // Último dia do mês

        // 1. CALCULAR RECEITAS (Soma dos Eventos neste período)
        // Buscamos eventos que acontecem neste mês
        // Nota: Ajuste o filtro de data conforme seu banco (string 'YYYY-MM-DD' ou DateTime)
        // Aqui assumindo que salvamos como String YYYY-MM-DD no banco
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        const events = await prisma.event.findMany({
            where: {
                date: {
                    gte: startStr,
                    lte: endStr
                }
            }
        });

        const receitaTotal = events.reduce((acc, evt) => acc + (evt.price || 0), 0);

        // 2. CALCULAR DESPESAS (Soma da tabela Transaction)
        const transactions = await prisma.transaction.findMany({
            where: {
                type: 'EXPENSE',
                date: {
                    gte: startStr,
                    lte: endStr
                }
            }
        });

        const despesaTotal = transactions.reduce((acc, tra) => acc + (tra.amount || 0), 0);

        // 3. CALCULAR LUCRO
        const saldo = receitaTotal - despesaTotal;

        // 4. RETORNAR DADOS
        res.json({
            period: `${currentMonth + 1}/${currentYear}`,
            summary: {
                revenue: receitaTotal,
                expenses: despesaTotal,
                balance: saldo
            },
            details: {
                eventsCount: events.length,
                expensesCount: transactions.length
            }
        });

    } catch (error) {
        console.error("Erro Financeiro:", error);
        res.status(500).json({ error: "Erro ao calcular finanças" });
    }
});

// GET /api/finance/transactions
// Lista as despesas para a tabela
router.get('/transactions', async (req, res) => {
    try {
        const transactions = await prisma.transaction.findMany({
            orderBy: { date: 'desc' },
            take: 100 // Limite para não travar
        });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ error: "Erro ao listar transações" });
    }
});

module.exports = router;
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const profileRoutes = require('./routes/profile');
const historyRoutes = require('./routes/history');
const financeRoutes = require('./routes/finance');
const taskRoutes = require('./routes/tasks');
const dailyPlanRoutes = require('./routes/dailyPlans');
const whatsappRoutes = require('./routes/whatsapp');
const { router: backupRoutes, runBackup } = require('./routes/backup');
const cron = require('node-cron');
const webpush = require('web-push');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BIiU_AzAKYphDuzGTCEy-tvcZGZtEjdaW4JZZ3WVGJYOrDJ4hjpmOmA_yOD_R4O_n1N8RrTm190cLPd10grA4g0';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'Gyay8GSr9huvXx-5OGG1YTp18j28I9PpBg33ORBfs6Y';

webpush.setVapidDetails(
    'mailto:contato@aerofestas.com.br',
    VAPID_PUBLIC,
    VAPID_PRIVATE
);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --- CONFIGURAÇÃO DO GMAIL (NODEMAILER) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

// --- ROTA DE ENVIO DE E-MAIL ---
app.post('/api/send-email', async (req, res) => {
    const { to, subject, text, html } = req.body;
    if (!to || !subject) return res.status(400).json({ error: 'Faltam campos.' });

    try {
        await transporter.sendMail({
            from: `"Aero Festas" <${process.env.GMAIL_USER}>`,
            to, subject, text, html
        });
        res.json({ success: true, message: 'E-mail enviado!' });
    } catch (error) {
        console.error("Erro email:", error);
        res.status(500).json({ error: 'Erro ao enviar e-mail.' });
    }
});

// --- ROTA DE MIGRAÇÃO (COM FINANCEIRO COMPLETO) ---
app.post('/api/migrar-completo', async (req, res) => {
    req.setTimeout(900000); // 15 minutos

    const { financeDataV30, toys, events, clients, companies } = req.body;

    try {
        console.log("🚀 Iniciando migração de dados...");

        // 1. MONITORES
        if (financeDataV30?.monitores) {
            for (const m of financeDataV30.monitores) {
                await prisma.monitor.upsert({
                    where: { id: String(m.id) },
                    update: {},
                    create: {
                        id: String(m.id),
                        nome: m.nome,
                        nascimento: m.nascimento || null,
                        telefone: m.telefone || null,
                        email: m.email || null,
                        endereco: m.endereco || null,
                        cnh: m.cnh || false,
                        cnhCategoria: m.cnhCategoria || null,
                        fotoPerfil: m.fotoPerfil || null
                    }
                });

                if (m.desempenho) {
                    for (const d of m.desempenho) {
                        await prisma.desempenho.upsert({
                            where: { id: String(d.id) },
                            update: {},
                            create: {
                                id: String(d.id),
                                data: d.data,
                                nota: String(d.nota),
                                descricao: d.descricao,
                                obs: d.obs,
                                detalhes: d.detalhes ? JSON.stringify(d.detalhes) : null,
                                monitorId: String(m.id)
                            }
                        });
                    }
                }
            }
        }

        // 2. BRINQUEDOS
        if (toys) {
            for (const t of toys) {
                await prisma.toy.upsert({
                    where: { id: parseFloat(t.id) },
                    update: { quantity: t.quantity, name: t.name },
                    create: { id: parseFloat(t.id), name: t.name, quantity: t.quantity }
                });
            }
        }

        // 3. CLIENTES
        if (clients) {
            for (const c of clients) {
                if (!c.id) continue;
                await prisma.client.upsert({
                    where: { id: parseFloat(c.id) },
                    update: {},
                    create: {
                        id: parseFloat(c.id),
                        name: c.name,
                        phone: c.phone,
                        address: c.address,
                        cpf: c.cpf
                    }
                });
            }
        }

        // 4. EMPRESAS
        if (companies) {
            for (const comp of companies) {
                if (!comp.id) continue;
                await prisma.company.upsert({
                    where: { id: parseFloat(comp.id) },
                    update: {},
                    create: {
                        id: parseFloat(comp.id),
                        name: comp.name || "",
                        cnpj: comp.cnpj,
                        address: comp.address,
                        phone: comp.phone,
                        email: comp.email,
                        paymentInfo: comp.paymentInfo,
                        repName: comp.repName,
                        repDoc: comp.repDoc
                    }
                });
            }
        }

        // 5. EVENTOS
        if (events) {
            for (const evt of events) {
                if (!evt.id) continue;
                const listaItens = evt.toys || evt.itens || [];
                const itensParaSalvar = listaItens.map(item => ({
                    quantity: parseInt(item.quantity) || 1,
                    price: (item.price !== undefined && item.price !== null) ? parseFloat(item.price) : (item.valor !== undefined && item.valor !== null ? parseFloat(item.valor) : 0),
                    toyId: item.id ? parseFloat(item.id) : (item.toyId ? parseFloat(item.toyId) : null)
                })).filter(i => i.toyId !== null);

                let precoFinal = parseFloat(evt.price || evt.total || evt.valor || 0);
                if (precoFinal === 0 && listaItens.length > 0) {
                    precoFinal = listaItens.reduce((acc, item) => {
                        const unitPrice = (item.price !== undefined && item.price !== null) ? parseFloat(item.price) : (item.valor !== undefined && item.valor !== null ? parseFloat(item.valor) : 0);
                        return acc + (unitPrice * (parseInt(item.quantity) || 1));
                    }, 0);
                }

                try { await prisma.eventItem.deleteMany({ where: { eventId: parseFloat(evt.id) } }); } catch (e) { }

                const dadosEvento = {
                    id: parseFloat(evt.id),
                    date: evt.date,
                    clientName: evt.clientName || "Cliente",
                    startTime: evt.startTime,
                    endTime: evt.endTime,
                    price: precoFinal,
                    yourCompanyId: evt.yourCompanyId ? parseFloat(evt.yourCompanyId) : null,
                    items: { create: itensParaSalvar }
                };

                await prisma.event.upsert({
                    where: { id: parseFloat(evt.id) },
                    update: dadosEvento,
                    create: dadosEvento
                });
            }
        }

        // 6. FINANCEIRO
        if (financeDataV30) {
            // 6a. Gastos Gerais
            if (financeDataV30.gastos) {
                console.log(`💰 Processando ${financeDataV30.gastos.length} gastos...`);
                for (const g of financeDataV30.gastos) {
                    if (!g.id) continue;
                    await prisma.transaction.upsert({
                        where: { id: String(g.id) },
                        update: {},
                        create: {
                            id: String(g.id),
                            description: g.descricao || "Gasto",
                            amount: parseFloat(g.valor) || 0,
                            type: 'EXPENSE',
                            date: g.data,
                            category: g.categoria || 'Outros',
                            paymentMethod: g.pagamento || null
                        }
                    });
                }
            }
            // 6b. Pagamentos de Monitores
            if (financeDataV30.pagamentosMonitores) {
                console.log(`💰 Processando ${financeDataV30.pagamentosMonitores.length} pagamentos de monitores...`);
                for (const p of financeDataV30.pagamentosMonitores) {
                    if (!p.id) continue;
                    await prisma.transaction.upsert({
                        where: { id: String(p.id) },
                        update: {},
                        create: {
                            id: String(p.id),
                            description: `Pgto Monitor: ${p.nome}`,
                            amount: parseFloat(p.pagamento) || 0,
                            type: 'EXPENSE',
                            date: p.data,
                            category: 'Salários',
                            paymentMethod: 'PIX'
                        }
                    });
                }
            }
            // 6d. CADASTRO DE CONTAS BANCÁRIAS (Novo bloco adicionado)
            if (financeDataV30.contas) {
                console.log(`🏦 Processando ${financeDataV30.contas.length} contas bancárias...`);
                for (const c of financeDataV30.contas) {
                    await prisma.bankAccount.upsert({
                        where: { id: String(c.id) },
                        update: {},
                        create: {
                            id: String(c.id),
                            name: c.nome,
                            bank: c.banco,
                            type: c.tipo,
                            agency: c.agencia || null,
                            number: c.numero || null
                        }
                    });
                }
            }
            // 6e. CADASTRO DE CONTAS FIXAS
            if (financeDataV30.contasFixas) {
                console.log(`📅 Processando ${financeDataV30.contasFixas.length} cadastros de contas fixas...`);
                for (const c of financeDataV30.contasFixas) {
                    let tipoRecorrencia = c.tipoRecorrencia || "permanente";
                    tipoRecorrencia = tipoRecorrencia.toLowerCase();

                    await prisma.fixedExpense.upsert({
                        where: { id: String(c.id) },
                        update: {},
                        create: {
                            id: String(c.id),
                            description: c.descricao || c.nome || "Conta Fixa",
                            amount: parseFloat(c.valor) || 0,
                            dueDay: parseInt(c.diaVencimento) || 10,
                            category: c.categoria || "Geral",
                            recurrenceType: tipoRecorrencia,
                            startDate: c.dataInicio || null,
                            installments: c.numParcelas ? parseInt(c.numParcelas) : null,
                            attachments: c.anexos ? JSON.stringify(c.anexos) : null
                        }
                    });
                }
            }
        }

        console.log("✅ Migração finalizada!");
        res.json({ success: true, message: "Todos os dados foram migrados!" });

    } catch (error) {
        console.error("❌ Erro migração:", error);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

// --- ROTAS DE LEITURA ---
app.get('/api/admin/toys', async (req, res) => {
    const toys = await prisma.toy.findMany({ orderBy: { name: 'asc' } });
    res.json(toys);
});
app.get('/api/admin/clients', async (req, res) => {
    const clients = await prisma.client.findMany({ orderBy: { name: 'asc' } });
    res.json(clients);
});
app.get('/api/admin/companies', async (req, res) => {
    const companies = await prisma.company.findMany({ orderBy: { name: 'asc' } });
    res.json(companies);
});
app.get('/api/admin/events-full', async (req, res) => {
    const events = await prisma.event.findMany({
        include: {
            items: { include: { toy: true } },
            company: true
        },
        orderBy: { date: 'desc' }
    });
    res.json(events);
});
app.get('/api/finance/accounts', async (req, res) => {
    try {
        const accounts = await prisma.bankAccount.findMany({ orderBy: { name: 'asc' } });
        res.json(accounts);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar contas" }); }
});
app.get('/api/finance/fixed-expenses', async (req, res) => {
    try {
        const fixed = await prisma.fixedExpense.findMany({ orderBy: { dueDay: 'asc' } });
        res.json(fixed);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar contas fixas" }); }
});

// --- SALVAR EVENTO ---
app.post('/api/admin/events', async (req, res) => {
    const evt = req.body;
    const eventId = evt.id ? parseFloat(evt.id) : Date.now();
    try {
        const itens = (evt.items || evt.toys || []).map(item => ({
            quantity: parseInt(item.quantity) || 1,
            price: (item.price !== undefined && item.price !== null) ? parseFloat(item.price) : (item.valor !== undefined && item.valor !== null ? parseFloat(item.valor) : 0),
            toyId: item.id ? parseFloat(item.id) : (item.toyId ? parseFloat(item.toyId) : null)
        })).filter(i => i.toyId !== null);

        if (evt.id) await prisma.eventItem.deleteMany({ where: { eventId: eventId } });

        // Dados completos do evento
        const data = {
            id: eventId,
            date: evt.date,
            endDate: evt.endDate || null, // Data de término para eventos multi-dia
            clientName: evt.clientName,
            yourCompanyId: evt.yourCompanyId ? parseFloat(evt.yourCompanyId) : null,
            startTime: evt.startTime,
            endTime: evt.endTime,
            price: evt.price ? parseFloat(evt.price) : 0,

            // Campos adicionais do cliente
            clientType: evt.clientType,
            clientCpf: evt.clientCpf,
            clientRg: evt.clientRg,
            clientDob: evt.clientDob,
            clientPhone: evt.clientPhone,
            clientPhoneBackup: evt.clientPhoneBackup,

            // Campos PJ
            cnpj: evt.cnpj,
            companyAddress: evt.companyAddress,
            repName: evt.repName,
            repCpf: evt.repCpf,
            repPhone: evt.repPhone,
            repPhoneBackup: evt.repPhoneBackup,

            // Endereço do evento
            clientAddress: evt.clientAddress,
            contractAddress: evt.contractAddress,
            cep: evt.cep,
            complemento: evt.complemento,
            bairro: evt.bairro,
            cidade: evt.cidade,
            uf: evt.uf,

            // Financeiro
            subtotal: evt.subtotal ? parseFloat(evt.subtotal) : 0,
            discountType: evt.discountType,
            discountValue: evt.discountValue ? parseFloat(evt.discountValue) : 0,
            deliveryFee: evt.deliveryFee ? parseFloat(evt.deliveryFee) : 0,
            paymentStatus: evt.paymentStatus,
            signalAmount: evt.signalAmount ? parseFloat(evt.signalAmount) : 0,
            signalReceived: evt.signalReceived || false,
            paymentDetails: evt.paymentDetails,

            // Outros
            monitor: evt.monitor,
            eventObservations: evt.eventObservations,
            isBirthday: evt.isBirthday || false,
            birthdayPersonName: evt.birthdayPersonName,
            birthdayPersonDob: evt.birthdayPersonDob,

            items: { create: itens }
        };

        const saved = await prisma.event.upsert({
            where: { id: eventId }, update: data, create: data,
            include: { items: { include: { toy: true } } }
        });
        res.json({ success: true, data: saved });
    } catch (error) {
        console.error('Erro ao salvar evento:', error);
        res.status(500).json({ error: "Erro ao salvar evento", details: error.message });
    }
});

// --- DELETAR EVENTO ---
app.delete('/api/admin/events/:id', async (req, res) => {
    const eventId = parseFloat(req.params.id);

    if (isNaN(eventId)) {
        return res.status(400).json({ error: "ID inválido" });
    }

    try {
        // Primeiro deleta os itens associados ao evento
        await prisma.eventItem.deleteMany({
            where: { eventId: eventId }
        });

        // Depois deleta o evento
        await prisma.event.delete({
            where: { id: eventId }
        });

        res.json({ success: true, message: "Evento excluído com sucesso!" });
    } catch (error) {
        console.error("Erro ao deletar evento:", error);
        res.status(500).json({ error: "Erro ao excluir evento" });
    }
});

// --- ROTAS FINAIS ---
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/admin/history', historyRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/daily-plans', dailyPlanRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/backup', backupRoutes);

// --- NOTIFICAÇÕES PUSH ---

// Rota de Inscrição
app.post('/api/notifications/subscribe', async (req, res) => {
    const subscription = req.body;

    try {
        await prisma.pushSubscription.upsert({
            where: { endpoint: subscription.endpoint },
            update: {
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth
            },
            create: {
                endpoint: subscription.endpoint,
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth
            }
        });
        res.status(201).json({ message: 'Inscrito com sucesso!' });
    } catch (error) {
        console.error('Erro subscribe:', error);
        res.status(500).json({ error: 'Erro ao processar assinatura' });
    }
});

// Função para verificar contas e enviar notificações
async function checkDueDatesAndNotify() {
    console.log("🔍 Verificando contas para enviar notificações...");
    try {
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);

        const currentDay = today.getDate();
        const tomorrowDay = tomorrow.getDate();

        // Busca contas que vencem hoje ou amanhã
        const expensesToNotify = await prisma.fixedExpense.findMany({
            where: {
                OR: [
                    { dueDay: currentDay },
                    { dueDay: tomorrowDay }
                ]
            }
        });

        if (expensesToNotify.length === 0) return;

        const subscriptions = await prisma.pushSubscription.findMany();

        for (const expense of expensesToNotify) {
            const isToday = expense.dueDay === currentDay;
            const title = isToday ? '⚠️ Conta Vencendo Hoje!' : '📅 Conta Vencendo Amanhã';
            const body = `${expense.description}: R$ ${expense.amount.toFixed(2)}`;
            const url = '/Sistema%20Gest%C3%A3o%20Financeira.html';

            const payload = JSON.stringify({ title, body, url });

            for (const sub of subscriptions) {
                try {
                    await webpush.sendNotification({
                        endpoint: sub.endpoint,
                        keys: {
                            p256dh: sub.p256dh,
                            auth: sub.auth
                        }
                    }, payload);
                } catch (err) {
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        // Inscrição expirada ou inválida
                        await prisma.pushSubscription.delete({ where: { id: sub.id } });
                    }
                }
            }
        }
    } catch (error) {
        console.error('Erro checkDueDates:', error);
    }
}

// Verifica a cada 12 horas
setInterval(checkDueDatesAndNotify, 12 * 60 * 60 * 1000);
// Executa 1 minuto após iniciar o servidor
setTimeout(checkDueDatesAndNotify, 60000);

// --- BACKUP DIÁRIO AUTOMÁTICO (03:00) ---
cron.schedule('0 3 * * *', async () => {
    console.log('⏰ Executando backup diário automático...');
    await runBackup('cron-diario');
});
// Executa backup 2 minutos após iniciar o servidor
setTimeout(() => runBackup('startup'), 120000);

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.redirect('/login.html'));

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
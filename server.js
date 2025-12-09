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

// --- ROTA DE MIGRAÇÃO (COM FINANCEIRO) ---
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

                // Desempenho
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
                    toyId: item.id ? parseFloat(item.id) : (item.toyId ? parseFloat(item.toyId) : null)
                })).filter(i => i.toyId !== null);

                let precoFinal = parseFloat(evt.price || evt.total || evt.valor || 0);
                if (precoFinal === 0 && listaItens.length > 0) {
                    precoFinal = listaItens.reduce((acc, item) => acc + (parseFloat(item.price || 0) * (item.quantity || 1)), 0);
                }

                // Limpa itens antigos para recriar
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

        // 6. FINANCEIRO (GASTOS E PAGAMENTOS)
        if (financeDataV30) {
            // Gastos Gerais
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
            // Pagamentos de Monitores
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
app.get('/api/admin/events-full', async (req, res) => {
    const events = await prisma.event.findMany({
        include: { items: { include: { toy: true } } },
        orderBy: { date: 'desc' }
    });
    res.json(events);
});

// --- SALVAR EVENTO ---
app.post('/api/admin/events', async (req, res) => {
    const evt = req.body;
    const eventId = evt.id ? parseFloat(evt.id) : Date.now();
    try {
        const itens = (evt.items || evt.toys || []).map(item => ({
            quantity: parseInt(item.quantity) || 1,
            toyId: item.id ? parseFloat(item.id) : (item.toyId ? parseFloat(item.toyId) : null)
        })).filter(i => i.toyId !== null);

        if (evt.id) await prisma.eventItem.deleteMany({ where: { eventId: eventId } });

        const data = {
            id: eventId, date: evt.date, clientName: evt.clientName,
            yourCompanyId: evt.yourCompanyId ? parseFloat(evt.yourCompanyId) : null,
            startTime: evt.startTime, endTime: evt.endTime,
            price: evt.price ? parseFloat(evt.price) : 0,
            items: { create: itens }
        };

        const saved = await prisma.event.upsert({
            where: { id: eventId }, update: data, create: data,
            include: { items: { include: { toy: true } } }
        });
        res.json({ success: true, data: saved });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao salvar" });
    }
});

// --- ROTAS FINAIS ---
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/admin/history', historyRoutes);
app.use('/api/finance', financeRoutes);

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.redirect('/login.html'));

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
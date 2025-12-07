require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const profileRoutes = require('./routes/profile');
const historyRoutes = require('./routes/history');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
// Aumentando o limite para 50MB para aceitar a migração
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --- ROTA DE MIGRAÇÃO (VERSÃO FINAL COM CORREÇÃO DE PREÇOS) ---
app.post('/api/migrar-completo', async (req, res) => {
    req.setTimeout(900000); // 15 minutos de timeout

    const { financeDataV30, toys, events, clients, companies } = req.body;

    try {
        console.log("🚀 Iniciando migração de dados...");

        // 1. MIGRAR MONITORES E DESEMPENHO
        if (financeDataV30 && financeDataV30.monitores) {
            console.log(`📦 Processando ${financeDataV30.monitores.length} monitores...`);
            for (const m of financeDataV30.monitores) {
                await prisma.monitor.upsert({
                    where: { id: m.id },
                    update: {},
                    create: {
                        id: m.id,
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

                if (m.desempenho && m.desempenho.length > 0) {
                    for (const d of m.desempenho) {
                        await prisma.desempenho.upsert({
                            where: { id: d.id },
                            update: {},
                            create: {
                                id: d.id,
                                data: d.data,
                                nota: typeof d.nota === 'string' ? d.nota : String(d.nota),
                                descricao: d.descricao || null,
                                obs: d.obs || null,
                                detalhes: d.detalhes ? JSON.stringify(d.detalhes) : null,
                                monitorId: m.id
                            }
                        });
                    }
                }
            }
        }

        // 2. MIGRAR BRINQUEDOS (TOYS)
        if (toys && toys.length > 0) {
            console.log(`🧸 Processando ${toys.length} brinquedos...`);
            for (const t of toys) {
                await prisma.toy.upsert({
                    where: { id: t.id },
                    update: { quantity: t.quantity, name: t.name },
                    create: {
                        id: t.id,
                        name: t.name,
                        quantity: t.quantity
                    }
                });
            }
        }

        // 3. MIGRAR CLIENTES
        if (clients && clients.length > 0) {
            console.log(`👥 Processando ${clients.length} clientes...`);
            for (const c of clients) {
                if (!c.id) continue;
                await prisma.client.upsert({
                    where: { id: parseFloat(c.id) },
                    update: {},
                    create: {
                        id: parseFloat(c.id),
                        name: c.name,
                        phone: c.phone || null,
                        address: c.address || null,
                        cpf: c.cpf || null
                    }
                });
            }
        }

        // 4. MIGRAR EMPRESAS (COMPANIES)
        if (companies && companies.length > 0) {
            console.log(`🏢 Processando ${companies.length} empresas...`);
            for (const comp of companies) {
                if (!comp.id) continue;
                await prisma.company.upsert({
                    where: { id: parseFloat(comp.id) },
                    update: {},
                    create: {
                        id: parseFloat(comp.id),
                        name: comp.name || "",
                        cnpj: comp.cnpj || null,
                        address: comp.address || null,
                        phone: comp.phone || null,
                        email: comp.email || null,
                        paymentInfo: comp.paymentInfo || null,
                        repName: comp.repName || null,
                        repDoc: comp.repDoc || null
                    }
                });
            }
        }

        // 5. MIGRAR EVENTOS (COM CÁLCULO DE PREÇO E ITENS)
        if (events && events.length > 0) {
            console.log(`📅 Processando ${events.length} eventos...`);
            for (const evt of events) {
                if (!evt.id) continue;

                const listaItens = evt.toys || evt.itens || [];
                const itensParaSalvar = listaItens.map(item => ({
                    quantity: parseInt(item.quantity) || 1,
                    toyId: item.id ? parseFloat(item.id) : (item.toyId ? parseFloat(item.toyId) : null)
                })).filter(i => i.toyId !== null);

                // Cálculo de preço fallback
                let precoFinal = parseFloat(evt.price || evt.total || evt.valor || 0);
                if (precoFinal === 0 && listaItens.length > 0) {
                    precoFinal = listaItens.reduce((acc, item) => acc + (parseFloat(item.price || 0) * (item.quantity || 1)), 0);
                }

                // Deleta itens antigos para evitar duplicidade na recarga
                try {
                    await prisma.eventItem.deleteMany({ where: { eventId: parseFloat(evt.id) } });
                } catch (e) { /* Ignora se não existir */ }

                const dadosEvento = {
                    id: parseFloat(evt.id),
                    date: evt.date,
                    clientName: evt.clientName || "Cliente Desconhecido",
                    startTime: evt.startTime || null,
                    endTime: evt.endTime || null,
                    price: precoFinal,
                    yourCompanyId: evt.yourCompanyId ? parseFloat(evt.yourCompanyId) : null,
                    items: {
                        create: itensParaSalvar
                    }
                };

                await prisma.event.upsert({
                    where: { id: parseFloat(evt.id) },
                    update: dadosEvento,
                    create: dadosEvento
                });
            }
        }

        console.log("✅ Migração finalizada com sucesso!");
        res.json({ success: true, message: "Todos os dados foram migrados!" });

    } catch (error) {
        console.error("❌ Erro durante a migração:", error);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

// --- ROTAS DE LEITURA ---
app.get('/api/admin/toys', async (req, res) => {
    try {
        const toys = await prisma.toy.findMany({ orderBy: { name: 'asc' } });
        res.json(toys);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar brinquedos" });
    }
});

app.get('/api/admin/clients', async (req, res) => {
    try {
        const clients = await prisma.client.findMany({ orderBy: { name: 'asc' } });
        res.json(clients);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar clientes" });
    }
});

app.get('/api/admin/events-full', async (req, res) => {
    try {
        const events = await prisma.event.findMany({
            include: {
                items: { include: { toy: true } }
            },
            orderBy: { date: 'desc' }
        });
        res.json(events);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar eventos" });
    }
});

// --- ROTA DE SALVAR EVENTO (CORRIGIDA E SEGURA) ---
app.post('/api/admin/events', async (req, res) => {
    console.log("🚨 RECEBI UM PEDIDO DE SALVAR EVENTO!");
    const evt = req.body;

    // Garante ID numérico ou timestamp
    const eventId = evt.id ? parseFloat(evt.id) : Date.now();

    try {
        const listaItens = evt.items || evt.toys || evt.itens || [];
        const itensParaSalvar = listaItens.map(item => ({
            quantity: parseInt(item.quantity) || 1,
            toyId: item.id ? parseFloat(item.id) : (item.toyId ? parseFloat(item.toyId) : null)
        })).filter(i => i.toyId !== null);

        if (evt.id) {
            await prisma.eventItem.deleteMany({ where: { eventId: eventId } });
        }

        const eventData = {
            id: eventId,
            date: evt.date,
            clientName: evt.clientName || "Cliente Sem Nome",
            yourCompanyId: evt.yourCompanyId ? parseFloat(evt.yourCompanyId) : null,
            startTime: evt.startTime || null,
            endTime: evt.endTime || null,
            price: evt.price ? parseFloat(evt.price) : 0,
            items: {
                create: itensParaSalvar
            }
        };

        const savedEvent = await prisma.event.upsert({
            where: { id: eventId },
            update: eventData,
            create: eventData,
            include: { items: { include: { toy: true } } }
        });

        console.log("✅ Evento salvo:", savedEvent.id);
        res.json({ success: true, data: savedEvent });

    } catch (error) {
        console.error("❌ ERRO:", error);
        res.status(500).json({ error: "Erro interno", details: error.message });
    }
});

// Rotas da API Legadas
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/admin/history', historyRoutes);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'API Online' });
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.redirect('/login.html');
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
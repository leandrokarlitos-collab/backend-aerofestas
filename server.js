require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer'); // <--- MUDANÇA AQUI
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --- CONFIGURAÇÃO DO NODEMAILER (GMAIL SMTP) ---
// Isso garante que o email saia pelo Google e apareça nos Enviados
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD // Senha de App de 16 dígitos
    }
});

// Verifica conexão ao iniciar
transporter.verify(function (error, success) {
    if (error) {
        console.warn("⚠️  Erro na conexão SMTP:", error.message);
    } else {
        console.log("✅ Servidor SMTP (Gmail) pronto para enviar e-mails!");
    }
});

// --- ROTA DE ENVIO DE E-MAIL ---
app.post('/api/send-email', async (req, res) => {
    const { to, subject, text, html } = req.body;

    if (!to || !subject) {
        return res.status(400).json({ error: 'Faltam campos obrigatórios (to, subject)' });
    }

    const mailOptions = {
        from: `"Aero Festas" <${process.env.GMAIL_USER}>`, // Nome bonito
        to, 
        subject,
        text: text || '',
        html: html || text || '', 
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`📧 E-mail enviado: ${info.messageId}`);
        res.json({ success: true, message: 'E-mail enviado com sucesso via Gmail!' });
    } catch (error) {
        console.error("❌ Erro ao enviar e-mail:", error);
        res.status(500).json({ error: 'Falha ao enviar e-mail', details: error.message });
    }
});

// --- ROTA DE MIGRAÇÃO ---
app.post('/api/migrar-completo', async (req, res) => {
  req.setTimeout(900000); 
  const { financeDataV30, toys, events, clients, companies } = req.body;

  try {
    console.log("🚀 Iniciando migração de dados...");

    // 1. MIGRAR MONITORES
    if (financeDataV30 && financeDataV30.monitores) {
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

    // 2. MIGRAR BRINQUEDOS
    if (toys && toys.length > 0) {
      for (const t of toys) {
        await prisma.toy.upsert({
          where: { id: t.id },
          update: { quantity: t.quantity, name: t.name },
          create: { id: t.id, name: t.name, quantity: t.quantity }
        });
      }
    }

    // 3. MIGRAR CLIENTES
    if (clients && clients.length > 0) {
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

    // 4. MIGRAR EMPRESAS
    if (companies && companies.length > 0) {
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

    // 5. MIGRAR EVENTOS
    if (events && events.length > 0) {
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

             try { await prisma.eventItem.deleteMany({ where: { eventId: parseFloat(evt.id) } }); } catch (e) {}

             const dadosEvento = {
                 id: parseFloat(evt.id),
                 date: evt.date,
                 clientName: evt.clientName || "Cliente Desconhecido",
                 startTime: evt.startTime || null,
                 endTime: evt.endTime || null,
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

    console.log("✅ Migração finalizada com sucesso!");
    res.json({ success: true, message: "Todos os dados foram migrados!" });

  } catch (error) {
    console.error("❌ Erro durante a migração:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// --- ROTAS GET ---
app.get('/api/admin/toys', async (req, res) => {
    try {
        const toys = await prisma.toy.findMany({ orderBy: { name: 'asc' } });
        res.json(toys);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar brinquedos" }); }
});

app.get('/api/admin/clients', async (req, res) => {
    try {
        const clients = await prisma.client.findMany({ orderBy: { name: 'asc' } });
        res.json(clients);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar clientes" }); }
});

app.get('/api/admin/events-full', async (req, res) => {
    try {
        const events = await prisma.event.findMany({
            include: { items: { include: { toy: true } } },
            orderBy: { date: 'desc' }
        });
        res.json(events);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar eventos" }); }
});

// --- ROTA DE SALVAR EVENTO ---
app.post('/api/admin/events', async (req, res) => {
    console.log("🚨 RECEBI UM PEDIDO DE SALVAR EVENTO!");
    const evt = req.body;
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
             items: { create: itensParaSalvar }
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

// Inicia servidor com Log
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    if (process.env.GMAIL_USER) {
        console.log(`📧 SMTP Gmail: ✅ Ativo (${process.env.GMAIL_USER})`);
    } else {
        console.log(`📧 SMTP Gmail: ⚠️  INATIVO (Falta variáveis no .env)`);
    }
});
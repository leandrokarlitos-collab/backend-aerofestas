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

// --- ROTA DE MIGRAÇÃO (ATUALIZADA) ---
app.post('/api/migrar-completo', async (req, res) => {
  // Aumenta o tempo limite para não dar erro em envio grande
  req.setTimeout(500000); 
  
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

    // 5. MIGRAR EVENTOS (COM ITENS AGORA!)
    if (events && events.length > 0) {
        console.log(`📅 Processando ${events.length} eventos...`);
        for (const evt of events) {
             if (!evt.id) continue;

             // Tenta encontrar a lista de brinquedos dentro do evento
             // Geralmente chama "toys" ou "itens" no JSON antigo
             const listaItens = evt.toys || evt.itens || [];

             // Prepara os itens para salvar no formato do Prisma
             const itensParaSalvar = listaItens.map(item => ({
                 quantity: item.quantity || 1,
                 // Tenta pegar o ID do brinquedo (pode ser item.id ou item.toyId)
                 toyId: item.id || item.toyId || null 
             })).filter(i => i.toyId !== null); // Remove se não tiver ID

             await prisma.event.upsert({
                 where: { id: parseFloat(evt.id) },
                 update: {}, // Se já existe, não mexe (para não duplicar itens)
                 create: {
                     id: parseFloat(evt.id),
                     date: evt.date,
                     clientName: evt.clientName || "Cliente Desconhecido",
                     // MÁGICA AQUI: Cria os itens junto com o evento
                     items: {
                         create: itensParaSalvar
                     }
                 }
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

// --- NOVAS ROTAS PARA O FRONTEND (CAMINHO A) ---

// 1. Buscar Brinquedos
app.get('/api/admin/toys', async (req, res) => {
    try {
        const toys = await prisma.toy.findMany({ orderBy: { name: 'asc' } });
        res.json(toys);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao buscar brinquedos" });
    }
});

// 2. Buscar Clientes
app.get('/api/admin/clients', async (req, res) => {
    try {
        const clients = await prisma.client.findMany({ orderBy: { name: 'asc' } });
        res.json(clients);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao buscar clientes" });
    }
});

// 3. Buscar Eventos Completos (Com Itens)
app.get('/api/admin/events-full', async (req, res) => {
    try {
        const events = await prisma.event.findMany({
            include: {
                items: { include: { toy: true } } // Traz os itens e o nome do brinquedo
            },
            orderBy: { date: 'desc' }
        });
        res.json(events);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao buscar eventos" });
    }
});

// 4. Criar/Atualizar Evento (CORRIGIDO PARA EVITAR NaN)
app.post('/api/admin/events', async (req, res) => {
    console.log("------------------------------------------------");
    console.log("🚨 RECEBI UM PEDIDO DE SALVAR EVENTO!");

    const evt = req.body;

    // --- CORREÇÃO DO ID (O PULO DO GATO) ---
    // Se o ID vier (edição), converte para Float.
    // Se não vier (novo), gera um timestamp agora (Date.now()).
    const eventId = evt.id ? parseFloat(evt.id) : Date.now();

    console.log("📦 ID Final:", eventId); // Agora nunca será NaN

    try {
        const listaItens = evt.items || evt.toys || evt.itens || [];

        const itensParaSalvar = listaItens.map(item => ({
            quantity: parseInt(item.quantity) || 1,
            toyId: item.id ? parseFloat(item.id) : (item.toyId ? parseFloat(item.toyId) : null)
        })).filter(i => i.toyId !== null);

        // Se for atualização, limpa itens antigos
        // Importante: Só deleta se o evento JÁ EXISTIA (evt.id original não era nulo)
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

        // Upsert:
        // Se for novo (ID gerado agora), o 'where' não acha nada -> Cria.
        // Se for edição (ID antigo), o 'where' acha -> Atualiza.
        const savedEvent = await prisma.event.upsert({
            where: { id: eventId },
            update: eventData,
            create: eventData,
            include: { items: { include: { toy: true } } }
        });

        console.log("✅ Evento salvo com sucesso! ID:", savedEvent.id);
        res.json({ success: true, data: savedEvent });

    } catch (error) {
        console.error("❌ ERRO GRAVE AO SALVAR EVENTO:");
        console.error(error);
        res.status(500).json({
            error: "Erro interno ao salvar evento.",
            details: error.message
        });
    }
});

// --- FIM DAS NOVAS ROTAS ---

// Rotas da API Legadas
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/admin/history', historyRoutes);

// Rota de health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Sistema Operante API está funcionando' });
});

// Servir arquivos estáticos (HTML, CSS, JS)
app.use(express.static(path.join(__dirname)));

// Rota raiz - redireciona para login
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// Inicia servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📧 Firebase Email: ${process.env.FIREBASE_EMAIL_FUNCTION_URL ? '✅ Configurado' : '⚠️  Não configurado (modo simulação)'}`);
});
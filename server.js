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
// --- ROTA DE MIGRAÇÃO (ADICIONAR AQUI) ---
app.post('/api/migrar-completo', async (req, res) => {
  // Aumenta o tempo limite para não dar erro em envio grande
  req.setTimeout(500000); 
  
  const { financeDataV30, toys, events, clients } = req.body;

  try {
    console.log("🚀 Iniciando migração de dados...");

    // 1. MIGRAR MONITORES E DESEMPENHO (Do JSON Financeiro)
    if (financeDataV30 && financeDataV30.monitores) {
      console.log(`📦 Processando ${financeDataV30.monitores.length} monitores...`);
      
      for (const m of financeDataV30.monitores) {
        // Salva o Monitor
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

        // Salva os Desempenhos desse Monitor
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
                // AQUI ESTÁ O TRUQUE DO SQLITE (Objeto virando Texto)
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

    // 3. MIGRAR CLIENTES (Se houver no JSON)
    if (clients && clients.length > 0) {
        console.log(`👥 Processando ${clients.length} clientes...`);
        for (const c of clients) {
            // Verifica se o ID é válido (não nulo)
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

    // 4. MIGRAR EVENTOS (Se houver)
    if (events && events.length > 0) {
        console.log(`📅 Processando ${events.length} eventos...`);
        for (const evt of events) {
             if (!evt.id) continue;

             await prisma.event.upsert({
                 where: { id: parseFloat(evt.id) },
                 update: {},
                 create: {
                     id: parseFloat(evt.id),
                     date: evt.date,
                     clientName: evt.clientName || "Cliente Desconhecido"
                     // Adicione outros campos do evento aqui se precisar
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
// --- FIM DA ROTA DE MIGRAÇÃO ---

// Rotas da API (ANTES de servir arquivos estáticos)
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/admin/history', historyRoutes);

// Rota de health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Sistema Operante API está funcionando' });
});

// Servir arquivos estáticos (HTML, CSS, JS) - DEPOIS das rotas da API
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


const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate, isAdmin } = require('../middleware/auth');
const webpush = require('web-push');

// Rate limiter simples em memória (por instância)
const rateLimits = {};
const RATE_LIMIT_MAX = 30; // msgs por minuto
const RATE_LIMIT_WINDOW = 60000; // 1 minuto

function checkRateLimit(instanceName) {
    const now = Date.now();
    if (!rateLimits[instanceName]) {
        rateLimits[instanceName] = [];
    }
    rateLimits[instanceName] = rateLimits[instanceName].filter(t => now - t < RATE_LIMIT_WINDOW);
    if (rateLimits[instanceName].length >= RATE_LIMIT_MAX) {
        return false;
    }
    rateLimits[instanceName].push(now);
    return true;
}

// Normaliza telefone: remove tudo que não é dígito, garante código do país
function normalizePhone(raw) {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length >= 12) return digits;
    if (digits.length === 10 || digits.length === 11) return '55' + digits;
    return digits;
}

// Extrai texto da mensagem do webhook (vários formatos possíveis)
function extractMessageText(message) {
    if (!message) return null;
    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
    if (message.imageMessage?.caption) return message.imageMessage.caption;
    if (message.videoMessage?.caption) return message.videoMessage.caption;
    if (message.documentMessage?.caption) return message.documentMessage.caption;
    if (message.documentMessage?.title) return message.documentMessage.title;
    return null;
}

// Detecta tipo da mensagem
function detectMessageType(message) {
    if (!message) return 'text';
    if (message.imageMessage) return 'image';
    if (message.videoMessage) return 'video';
    if (message.audioMessage || message.pttMessage) return 'audio';
    if (message.documentMessage) return 'document';
    if (message.stickerMessage) return 'sticker';
    if (message.locationMessage) return 'location';
    if (message.contactMessage) return 'contact';
    return 'text';
}

// Extrai informações de mídia da mensagem
function extractMediaInfo(message) {
    if (!message) return {};
    const mediaMsg = message.imageMessage || message.videoMessage || message.audioMessage ||
                     message.pttMessage || message.documentMessage || message.stickerMessage;
    if (!mediaMsg) return {};
    return {
        mediaUrl: mediaMsg.url || null,
        mediaName: mediaMsg.fileName || mediaMsg.title || null,
        mediaMimetype: mediaMsg.mimetype || null
    };
}

// Envia push notification para todos os usuários inscritos
async function sendPushToAll(title, body, url) {
    try {
        const subscriptions = await prisma.pushSubscription.findMany();
        const payload = JSON.stringify({ title, body, url, icon: '/icons/icon-192.png' });

        for (const sub of subscriptions) {
            try {
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payload
                );
            } catch (err) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
                }
            }
        }
    } catch (e) {
        console.error('Erro ao enviar push notifications:', e);
    }
}

// ===================================================================
// WEBHOOK — Recebe eventos do Evolution API (sem JWT, valida por apikey)
// ===================================================================

// Armazena últimos webhooks recebidos para debug (máx 20)
const webhookDebugLog = [];

// GET /api/whatsapp/webhook/debug — Ver últimos webhooks recebidos (admin)
router.get('/webhook/debug', authenticate, async (req, res) => {
    res.json(webhookDebugLog);
});

router.post('/webhook', async (req, res) => {
    // Responde rápido para não travar o Evolution API
    res.status(200).json({ status: 'received' });

    try {
        // Log de debug - guarda últimos 20 webhooks
        webhookDebugLog.unshift({
            timestamp: new Date().toISOString(),
            body: JSON.stringify(req.body).substring(0, 2000)
        });
        if (webhookDebugLog.length > 20) webhookDebugLog.pop();

        console.log('[WA Webhook] Evento recebido:', JSON.stringify(req.body).substring(0, 500));

        // v2.3.x pode enviar o evento em formatos diferentes
        const body = req.body;
        const event = (body.event || '').toLowerCase();
        // instanceName pode vir como string ou como objeto {instanceName: '...'}
        let instanceName = body.instance;
        if (typeof instanceName === 'object' && instanceName !== null) {
            instanceName = instanceName.instanceName || instanceName.name;
        }
        const data = body.data;

        if (!instanceName || !data) {
            console.warn('[WA Webhook] Evento sem instance ou data:', { event, instanceName: body.instance, hasData: !!data });
            return;
        }

        // Busca a instância no banco
        const instance = await prisma.whatsAppInstance.findUnique({
            where: { instanceName }
        });
        if (!instance) {
            console.warn(`[WA Webhook] Instância desconhecida: ${instanceName}`);
            return;
        }

        // --- MESSAGES_UPSERT --- (v1: messages.upsert, v2.3: messages_upsert ou messages.upsert)
        if (event === 'messages.upsert' || event === 'messages_upsert') {
            const key = data.key;
            if (!key || !key.remoteJid) return;

            // Ignora mensagens de grupos e status
            if (key.remoteJid.includes('@g.us') || key.remoteJid === 'status@broadcast') return;

            const remoteJid = key.remoteJid;
            const fromMe = key.fromMe || false;
            const messageId = key.id;
            const pushName = data.pushName || null;
            const messageText = extractMessageText(data.message);
            const messageType = detectMessageType(data.message);
            const timestamp = data.messageTimestamp
                ? new Date(parseInt(data.messageTimestamp) * 1000)
                : new Date();

            // Conteúdo para exibição (se não tem texto, mostra o tipo)
            const displayContent = messageText || `[${messageType}]`;
            const mediaInfo = extractMediaInfo(data.message);

            // Extrai número do telefone
            const phoneNumber = remoteJid.replace('@s.whatsapp.net', '');

            // Upsert da conversa
            const conversation = await prisma.whatsAppConversation.upsert({
                where: {
                    remoteJid_instanceId: { remoteJid, instanceId: instance.id }
                },
                create: {
                    remoteJid,
                    phoneNumber,
                    contactName: pushName,
                    instanceId: instance.id,
                    lastMessageAt: timestamp,
                    lastMessagePreview: displayContent.substring(0, 200),
                    unreadCount: fromMe ? 0 : 1
                },
                update: {
                    contactName: pushName || undefined,
                    lastMessageAt: timestamp,
                    lastMessagePreview: displayContent.substring(0, 200),
                    unreadCount: fromMe ? undefined : { increment: 1 }
                }
            });

            // Cria a mensagem (ignora duplicata)
            try {
                await prisma.whatsAppMessage.create({
                    data: {
                        id: messageId,
                        conversationId: conversation.id,
                        fromMe,
                        content: displayContent,
                        messageType,
                        mediaUrl: mediaInfo.mediaUrl || null,
                        mediaName: mediaInfo.mediaName || null,
                        mediaMimetype: mediaInfo.mediaMimetype || null,
                        timestamp,
                        status: fromMe ? 'sent' : 'received'
                    }
                });
            } catch (e) {
                // P2002 = unique constraint violation (msg duplicada)
                if (e.code !== 'P2002') throw e;
            }

            // Auto-match de cliente (apenas para mensagens recebidas)
            if (!fromMe && !conversation.clientId) {
                const normalizedPhone = normalizePhone(phoneNumber);
                const last10 = normalizedPhone.slice(-10);

                // Busca cliente pelo telefone (últimos 10 dígitos)
                const existingClient = await prisma.client.findFirst({
                    where: {
                        phone: { contains: last10 }
                    }
                });

                if (existingClient) {
                    await prisma.whatsAppConversation.update({
                        where: { id: conversation.id },
                        data: { clientId: existingClient.id }
                    });
                } else {
                    // Cria novo cliente
                    const newClient = await prisma.client.create({
                        data: {
                            id: parseFloat(Date.now()),
                            name: pushName || phoneNumber,
                            phone: phoneNumber
                        }
                    });
                    await prisma.whatsAppConversation.update({
                        where: { id: conversation.id },
                        data: { clientId: newClient.id }
                    });
                }
            }

            // Push notification para mensagens recebidas
            if (!fromMe) {
                const senderName = pushName || phoneNumber;
                sendPushToAll(
                    `WhatsApp ${instance.displayName}: ${senderName}`,
                    displayContent.substring(0, 100),
                    `/WhatsApp.html?instance=${instanceName}`
                );
            }
        }

        // --- CONNECTION_UPDATE --- (v1: connection.update, v2.3: connection_update ou connection.update)
        if (event === 'connection.update' || event === 'connection_update') {
            const state = data.state || data.status;
            let status = 'disconnected';
            if (state === 'open' || state === 'connected') status = 'connected';
            else if (state === 'connecting') status = 'connecting';
            else if (state === 'close' || state === 'disconnected') status = 'disconnected';

            await prisma.whatsAppInstance.update({
                where: { instanceName },
                data: {
                    status,
                    phoneNumber: data.phoneNumber || undefined
                }
            });
            console.log(`[WA] Instância ${instanceName}: ${status}`);
        }

        // --- MESSAGES_UPDATE (status: delivered, read) ---
        if (event === 'messages.update' || event === 'messages_update') {
            const updates = Array.isArray(data) ? data : [data];
            for (const update of updates) {
                // v2.3.6 formato: { keyId, status, messageId }
                // v1 formato: { key: { id }, update: { status } }
                const msgId = update.keyId || update.key?.id;
                const rawStatus = update.status || update.update?.status;
                if (!rawStatus) continue;

                let statusStr = 'sent';
                if (rawStatus === 2 || rawStatus === 'SERVER_ACK') statusStr = 'sent';
                if (rawStatus === 3 || rawStatus === 'DELIVERY_ACK') statusStr = 'delivered';
                if (rawStatus === 4 || rawStatus === 'READ') statusStr = 'read';
                if (rawStatus === 5 || rawStatus === 'PLAYED') statusStr = 'read';

                if (msgId) {
                    // Tenta atualizar pela keyId (ID WhatsApp = id na nossa tabela)
                    await prisma.whatsAppMessage.update({
                        where: { id: msgId },
                        data: { status: statusStr }
                    }).catch(() => {});
                }

                // v2.3.6 também envia messageId (ID interno Prisma do Evolution)
                // Não usamos, mas o keyId já é suficiente
            }
        }

    } catch (error) {
        console.error('[WA Webhook] Erro ao processar:', error);
    }
});

// ===================================================================
// INSTÂNCIAS
// ===================================================================

// GET /api/whatsapp/instances — Lista todas as instâncias
router.get('/instances', authenticate, async (req, res) => {
    try {
        const instances = await prisma.whatsAppInstance.findMany({
            orderBy: { displayName: 'asc' },
            select: {
                id: true,
                instanceName: true,
                displayName: true,
                phoneNumber: true,
                status: true,
                companyName: true,
                evolutionUrl: true,
                apiKey: true
            }
        });

        // Sincroniza status com Evolution API em tempo real (via fetchInstances - mais confiável)
        const firstInst = instances.find(i => i.evolutionUrl && i.apiKey);
        if (firstInst) {
            try {
                const evoRes = await fetch(`${firstInst.evolutionUrl}/instance/fetchInstances`, {
                    headers: { 'apikey': firstInst.apiKey }
                });
                if (evoRes.ok) {
                    const evoInstances = await evoRes.json();
                    for (const inst of instances) {
                        const evoInst = evoInstances.find(e => e.name === inst.instanceName);
                        if (!evoInst) continue;

                        const evoStatus = evoInst.connectionStatus;
                        let newStatus = inst.status;
                        if (evoStatus === 'open') newStatus = 'connected';
                        else if (evoStatus === 'connecting') newStatus = 'connecting';
                        else if (evoStatus === 'close') {
                            newStatus = inst.status === 'qr_pending' ? 'qr_pending' : 'disconnected';
                        }

                        if (newStatus !== inst.status) {
                            await prisma.whatsAppInstance.update({
                                where: { instanceName: inst.instanceName },
                                data: { status: newStatus }
                            });
                            console.log(`[WA Sync] ${inst.instanceName}: ${inst.status} → ${newStatus}`);
                            inst.status = newStatus;
                        }
                    }
                }
            } catch (e) {
                console.warn(`[WA Sync] Erro ao consultar Evolution API:`, e.message);
            }
        }

        // Retorna sem campos sensíveis
        const result = instances.map(({ evolutionUrl, apiKey, ...rest }) => rest);
        res.json(result);
    } catch (error) {
        console.error('Erro ao listar instâncias:', error);
        res.status(500).json({ error: 'Erro ao listar instâncias' });
    }
});

// POST /api/whatsapp/instances/seed — Cria instâncias iniciais (admin)
router.post('/instances/seed', isAdmin, async (req, res) => {
    try {
        const evolutionUrl = process.env.EVOLUTION_API_URL;
        const apiKey = process.env.EVOLUTION_API_KEY;

        if (!evolutionUrl || !apiKey) {
            return res.status(400).json({ error: 'EVOLUTION_API_URL e EVOLUTION_API_KEY não configurados.' });
        }

        const instancesToCreate = [
            { instanceName: 'aero-festas', displayName: 'Aero Festas', companyName: 'Aero Festas' },
            { instanceName: 'abc-festas', displayName: 'ABC Festas', companyName: 'ABC Festas' }
        ];

        const results = [];

        for (const inst of instancesToCreate) {
            // Cria na Evolution API
            try {
                const evoRes = await fetch(`${evolutionUrl}/instance/create`, {
                    method: 'POST',
                    headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        instanceName: inst.instanceName,
                        qrcode: true,
                        integration: 'WHATSAPP-BAILEYS'
                    })
                });
                const evoData = await evoRes.json();
                console.log(`[WA Seed] Evolution API criou ${inst.instanceName}:`, evoData);
            } catch (e) {
                console.warn(`[WA Seed] Erro ao criar ${inst.instanceName} no Evolution:`, e.message);
            }

            // Upsert no banco local
            const dbInst = await prisma.whatsAppInstance.upsert({
                where: { instanceName: inst.instanceName },
                create: { ...inst, evolutionUrl, apiKey },
                update: { evolutionUrl, apiKey, displayName: inst.displayName, companyName: inst.companyName }
            });
            results.push(dbInst);
        }

        // Configura webhook na Evolution API (formato v2.3.x)
        try {
            const backendUrl = process.env.BACKEND_URL || 'https://backend-aerofestas-production.up.railway.app';
            for (const inst of instancesToCreate) {
                const webhookRes = await fetch(`${evolutionUrl}/webhook/set/${inst.instanceName}`, {
                    method: 'POST',
                    headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        webhook: {
                            enabled: true,
                            url: `${backendUrl}/api/whatsapp/webhook`,
                            webhookByEvents: false,
                            events: [
                                'MESSAGES_UPSERT', 'MESSAGES_UPDATE',
                                'CONNECTION_UPDATE', 'QRCODE_UPDATED'
                            ]
                        }
                    })
                });
                const webhookData = await webhookRes.json();
                console.log(`[WA Seed] Webhook configurado para ${inst.instanceName}:`, webhookData);
            }
        } catch (e) {
            console.warn('[WA Seed] Erro ao configurar webhooks:', e.message);
        }

        res.json({ success: true, instances: results });
    } catch (error) {
        console.error('Erro no seed:', error);
        res.status(500).json({ error: 'Erro ao criar instâncias' });
    }
});

// POST /api/whatsapp/instances/:name/connect — Obtém QR code (admin)
router.post('/instances/:name/connect', isAdmin, async (req, res) => {
    try {
        const instance = await prisma.whatsAppInstance.findUnique({
            where: { instanceName: req.params.name }
        });
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        const evoRes = await fetch(`${instance.evolutionUrl}/instance/connect/${instance.instanceName}`, {
            headers: { 'apikey': instance.apiKey }
        });
        const data = await evoRes.json();

        await prisma.whatsAppInstance.update({
            where: { instanceName: req.params.name },
            data: { status: 'qr_pending' }
        });

        res.json(data);
    } catch (error) {
        console.error('Erro ao conectar instância:', error);
        res.status(500).json({ error: 'Erro ao conectar' });
    }
});

// GET /api/whatsapp/instances/:name/qr — Busca QR code atual (admin)
router.get('/instances/:name/qr', isAdmin, async (req, res) => {
    try {
        const instance = await prisma.whatsAppInstance.findUnique({
            where: { instanceName: req.params.name }
        });
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        const evoRes = await fetch(`${instance.evolutionUrl}/instance/connect/${instance.instanceName}`, {
            headers: { 'apikey': instance.apiKey }
        });
        const data = await evoRes.json();
        res.json(data);
    } catch (error) {
        console.error('Erro ao buscar QR:', error);
        res.status(500).json({ error: 'Erro ao buscar QR code' });
    }
});

// POST /api/whatsapp/instances/:name/disconnect — Desconecta (admin)
router.post('/instances/:name/disconnect', isAdmin, async (req, res) => {
    try {
        const instance = await prisma.whatsAppInstance.findUnique({
            where: { instanceName: req.params.name }
        });
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        await fetch(`${instance.evolutionUrl}/instance/logout/${instance.instanceName}`, {
            method: 'DELETE',
            headers: { 'apikey': instance.apiKey }
        });

        await prisma.whatsAppInstance.update({
            where: { instanceName: req.params.name },
            data: { status: 'disconnected' }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao desconectar:', error);
        res.status(500).json({ error: 'Erro ao desconectar' });
    }
});

// ===================================================================
// CONVERSAS
// ===================================================================

// GET /api/whatsapp/conversations
router.get('/conversations', authenticate, async (req, res) => {
    try {
        const { instance, search, page = 1, limit = 50, clientId } = req.query;

        const where = {};

        if (instance) {
            const inst = await prisma.whatsAppInstance.findUnique({ where: { instanceName: instance } });
            if (inst) where.instanceId = inst.id;
        }

        if (clientId) {
            where.clientId = parseFloat(clientId);
        }

        if (search) {
            where.OR = [
                { contactName: { contains: search, mode: 'insensitive' } },
                { phoneNumber: { contains: search.replace(/\D/g, '') } }
            ];
        }

        const conversations = await prisma.whatsAppConversation.findMany({
            where,
            orderBy: { lastMessageAt: 'desc' },
            take: parseInt(limit),
            skip: (parseInt(page) - 1) * parseInt(limit),
            include: {
                instance: {
                    select: { instanceName: true, displayName: true, companyName: true }
                }
            }
        });

        res.json(conversations);
    } catch (error) {
        console.error('Erro ao listar conversas:', error);
        res.status(500).json({ error: 'Erro ao listar conversas' });
    }
});

// ===================================================================
// MENSAGENS
// ===================================================================

// GET /api/whatsapp/conversations/:id/messages
router.get('/conversations/:id/messages', authenticate, async (req, res) => {
    try {
        const { page = 1, limit = 50 } = req.query;

        const messages = await prisma.whatsAppMessage.findMany({
            where: { conversationId: req.params.id },
            orderBy: { timestamp: 'desc' },
            take: parseInt(limit),
            skip: (parseInt(page) - 1) * parseInt(limit)
        });

        res.json(messages);
    } catch (error) {
        console.error('Erro ao listar mensagens:', error);
        res.status(500).json({ error: 'Erro ao listar mensagens' });
    }
});

// ===================================================================
// ENVIO DE MENSAGENS
// ===================================================================

// POST /api/whatsapp/send
router.post('/send', authenticate, async (req, res) => {
    try {
        let { instanceName, remoteJid, conversationId, text } = req.body;

        // Se conversationId foi passado, busca o remoteJid e instanceName da conversa
        if (conversationId && (!remoteJid || !instanceName)) {
            const conv = await prisma.whatsAppConversation.findUnique({
                where: { id: conversationId },
                include: { instance: true }
            });
            if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
            remoteJid = conv.remoteJid;
            instanceName = instanceName || conv.instance.instanceName;
        }

        if (!instanceName || !remoteJid || !text) {
            return res.status(400).json({ error: 'instanceName, remoteJid (ou conversationId) e text são obrigatórios' });
        }

        // Rate limit
        if (!checkRateLimit(instanceName)) {
            return res.status(429).json({ error: 'Limite de envio atingido. Aguarde 1 minuto.' });
        }

        const instance = await prisma.whatsAppInstance.findUnique({
            where: { instanceName }
        });
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        // Envia via Evolution API
        const number = remoteJid.replace('@s.whatsapp.net', '');
        const evoRes = await fetch(`${instance.evolutionUrl}/message/sendText/${instanceName}`, {
            method: 'POST',
            headers: {
                'apikey': instance.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                number,
                text,
                delay: 1200,
                linkPreview: true
            })
        });

        const evoData = await evoRes.json();

        if (!evoRes.ok) {
            console.error('Erro Evolution API send:', evoData);
            return res.status(502).json({ error: 'Erro ao enviar via WhatsApp', details: evoData });
        }

        // Extrai ID da mensagem enviada
        const sentMessageId = evoData.key?.id || `sent-${Date.now()}`;

        // Encontra ou cria conversa
        const conversation = await prisma.whatsAppConversation.upsert({
            where: {
                remoteJid_instanceId: { remoteJid, instanceId: instance.id }
            },
            create: {
                remoteJid,
                phoneNumber: number,
                instanceId: instance.id,
                lastMessageAt: new Date(),
                lastMessagePreview: text.substring(0, 200)
            },
            update: {
                lastMessageAt: new Date(),
                lastMessagePreview: text.substring(0, 200)
            }
        });

        // Salva mensagem no banco
        const savedMessage = await prisma.whatsAppMessage.create({
            data: {
                id: sentMessageId,
                conversationId: conversation.id,
                fromMe: true,
                content: text,
                messageType: 'text',
                timestamp: new Date(),
                status: 'sent'
            }
        });

        res.json(savedMessage);
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
});

// ===================================================================
// ENVIO DE MÍDIA (imagem, vídeo, áudio, documento)
// ===================================================================

// POST /api/whatsapp/send-media
router.post('/send-media', authenticate, async (req, res) => {
    try {
        let { instanceName, remoteJid, conversationId, mediaType, media, caption, fileName, mimetype } = req.body;

        // Resolve conversa se necessário
        if (conversationId && (!remoteJid || !instanceName)) {
            const conv = await prisma.whatsAppConversation.findUnique({
                where: { id: conversationId },
                include: { instance: true }
            });
            if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
            remoteJid = conv.remoteJid;
            instanceName = instanceName || conv.instance.instanceName;
        }

        if (!instanceName || !remoteJid || !media || !mediaType) {
            return res.status(400).json({ error: 'instanceName, remoteJid, media e mediaType são obrigatórios' });
        }

        if (!checkRateLimit(instanceName)) {
            return res.status(429).json({ error: 'Limite de envio atingido. Aguarde 1 minuto.' });
        }

        const instance = await prisma.whatsAppInstance.findUnique({ where: { instanceName } });
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        const number = remoteJid.replace('@s.whatsapp.net', '');
        let evoRes, evoData;

        if (mediaType === 'audio') {
            // Áudio usa endpoint dedicado (sendWhatsAppAudio) para aparecer como nota de voz
            evoRes = await fetch(`${instance.evolutionUrl}/message/sendWhatsAppAudio/${instanceName}`, {
                method: 'POST',
                headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ number, audio: media, delay: 1200, encoding: true })
            });
        } else {
            // Imagem, vídeo e documento usam sendMedia
            const body = { number, mediatype: mediaType, media, delay: 1200 };
            if (caption) body.caption = caption;
            if (fileName) body.fileName = fileName;
            if (mimetype) body.mimetype = mimetype;
            evoRes = await fetch(`${instance.evolutionUrl}/message/sendMedia/${instanceName}`, {
                method: 'POST',
                headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        }

        evoData = await evoRes.json();

        if (!evoRes.ok) {
            console.error('Erro Evolution API send-media:', evoData);
            return res.status(502).json({ error: 'Erro ao enviar mídia', details: evoData });
        }

        const sentMessageId = evoData.key?.id || `sent-${Date.now()}`;
        const displayContent = caption || `[${mediaType}]`;

        // Upsert conversa
        const conversation = await prisma.whatsAppConversation.upsert({
            where: { remoteJid_instanceId: { remoteJid, instanceId: instance.id } },
            create: { remoteJid, phoneNumber: number, instanceId: instance.id, lastMessageAt: new Date(), lastMessagePreview: displayContent.substring(0, 200) },
            update: { lastMessageAt: new Date(), lastMessagePreview: displayContent.substring(0, 200) }
        });

        const savedMessage = await prisma.whatsAppMessage.create({
            data: {
                id: sentMessageId,
                conversationId: conversation.id,
                fromMe: true,
                content: displayContent,
                messageType: mediaType,
                mediaUrl: typeof media === 'string' && media.startsWith('http') ? media : null,
                mediaName: fileName || null,
                mediaMimetype: mimetype || null,
                timestamp: new Date(),
                status: 'sent'
            }
        });

        res.json(savedMessage);
    } catch (error) {
        console.error('Erro ao enviar mídia:', error);
        res.status(500).json({ error: 'Erro ao enviar mídia' });
    }
});

// ===================================================================
// CATÁLOGO DO WHATSAPP BUSINESS
// ===================================================================

// GET /api/whatsapp/catalog/:instanceName — Busca catálogo da conta Business
router.get('/catalog/:instanceName', authenticate, async (req, res) => {
    try {
        const instance = await prisma.whatsAppInstance.findUnique({ where: { instanceName: req.params.instanceName } });
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        const evoRes = await fetch(`${instance.evolutionUrl}/chat/fetchCatalog/${instance.instanceName}`, {
            headers: { 'apikey': instance.apiKey }
        });

        if (!evoRes.ok) {
            const err = await evoRes.json().catch(() => ({}));
            return res.status(502).json({ error: 'Erro ao buscar catálogo', details: err });
        }

        const catalog = await evoRes.json();
        res.json(catalog);
    } catch (error) {
        console.error('Erro ao buscar catálogo:', error);
        res.status(500).json({ error: 'Erro ao buscar catálogo' });
    }
});

// POST /api/whatsapp/send-catalog — Envia produto do catálogo como mensagem
router.post('/send-catalog', authenticate, async (req, res) => {
    try {
        let { instanceName, remoteJid, conversationId, productId, productName, productUrl, productImage, caption } = req.body;

        if (conversationId && (!remoteJid || !instanceName)) {
            const conv = await prisma.whatsAppConversation.findUnique({
                where: { id: conversationId },
                include: { instance: true }
            });
            if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
            remoteJid = conv.remoteJid;
            instanceName = instanceName || conv.instance.instanceName;
        }

        if (!instanceName || !remoteJid) {
            return res.status(400).json({ error: 'instanceName e remoteJid são obrigatórios' });
        }

        if (!checkRateLimit(instanceName)) {
            return res.status(429).json({ error: 'Limite de envio atingido. Aguarde 1 minuto.' });
        }

        const instance = await prisma.whatsAppInstance.findUnique({ where: { instanceName } });
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        const number = remoteJid.replace('@s.whatsapp.net', '');

        // Envia produto como imagem com caption descritivo
        let evoRes;
        if (productImage) {
            const body = {
                number,
                mediatype: 'image',
                media: productImage,
                caption: caption || `📦 *${productName || 'Produto'}*\n${productUrl || ''}`,
                delay: 1200
            };
            evoRes = await fetch(`${instance.evolutionUrl}/message/sendMedia/${instanceName}`, {
                method: 'POST',
                headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } else {
            // Sem imagem, envia como texto formatado
            const text = `📦 *${productName || 'Produto'}*\n${caption || ''}\n${productUrl || ''}`.trim();
            evoRes = await fetch(`${instance.evolutionUrl}/message/sendText/${instanceName}`, {
                method: 'POST',
                headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ number, text, delay: 1200 })
            });
        }

        const evoData = await evoRes.json();
        if (!evoRes.ok) {
            return res.status(502).json({ error: 'Erro ao enviar catálogo', details: evoData });
        }

        const sentMessageId = evoData.key?.id || `sent-${Date.now()}`;
        const displayContent = `📦 ${productName || 'Catálogo'}`;

        const conversation = await prisma.whatsAppConversation.upsert({
            where: { remoteJid_instanceId: { remoteJid, instanceId: instance.id } },
            create: { remoteJid, phoneNumber: number, instanceId: instance.id, lastMessageAt: new Date(), lastMessagePreview: displayContent.substring(0, 200) },
            update: { lastMessageAt: new Date(), lastMessagePreview: displayContent.substring(0, 200) }
        });

        const savedMessage = await prisma.whatsAppMessage.create({
            data: {
                id: sentMessageId,
                conversationId: conversation.id,
                fromMe: true,
                content: displayContent,
                messageType: productImage ? 'image' : 'text',
                mediaUrl: productImage || null,
                timestamp: new Date(),
                status: 'sent'
            }
        });

        res.json(savedMessage);
    } catch (error) {
        console.error('Erro ao enviar catálogo:', error);
        res.status(500).json({ error: 'Erro ao enviar catálogo' });
    }
});

// ===================================================================
// ATALHOS / RESPOSTAS RÁPIDAS
// ===================================================================

// GET /api/whatsapp/shortcuts — Lista todos os atalhos
router.get('/shortcuts', authenticate, async (req, res) => {
    try {
        const shortcuts = await prisma.whatsAppShortcut.findMany({
            orderBy: { command: 'asc' }
        });
        res.json(shortcuts);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao listar atalhos' });
    }
});

// POST /api/whatsapp/shortcuts — Cria atalho
router.post('/shortcuts', authenticate, async (req, res) => {
    try {
        const { command, title, content, mediaUrl, mediaType, instanceId } = req.body;
        if (!command || !title || !content) {
            return res.status(400).json({ error: 'command, title e content são obrigatórios' });
        }
        // Normaliza comando: remove / inicial se houver, lowercase
        const cmd = command.replace(/^\//, '').toLowerCase().trim();
        const shortcut = await prisma.whatsAppShortcut.create({
            data: { command: cmd, title, content, mediaUrl: mediaUrl || null, mediaType: mediaType || null, instanceId: instanceId || null }
        });
        res.json(shortcut);
    } catch (error) {
        if (error.code === 'P2002') return res.status(409).json({ error: 'Atalho já existe com esse comando' });
        res.status(500).json({ error: 'Erro ao criar atalho' });
    }
});

// PUT /api/whatsapp/shortcuts/:id — Atualiza atalho
router.put('/shortcuts/:id', authenticate, async (req, res) => {
    try {
        const { command, title, content, mediaUrl, mediaType } = req.body;
        const data = {};
        if (command) data.command = command.replace(/^\//, '').toLowerCase().trim();
        if (title) data.title = title;
        if (content) data.content = content;
        if (mediaUrl !== undefined) data.mediaUrl = mediaUrl || null;
        if (mediaType !== undefined) data.mediaType = mediaType || null;
        const shortcut = await prisma.whatsAppShortcut.update({ where: { id: req.params.id }, data });
        res.json(shortcut);
    } catch (error) {
        if (error.code === 'P2002') return res.status(409).json({ error: 'Comando já existe' });
        res.status(500).json({ error: 'Erro ao atualizar atalho' });
    }
});

// DELETE /api/whatsapp/shortcuts/:id — Remove atalho
router.delete('/shortcuts/:id', authenticate, async (req, res) => {
    try {
        await prisma.whatsAppShortcut.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao remover atalho' });
    }
});

// ===================================================================
// MARCAR COMO LIDA / VINCULAR CLIENTE
// ===================================================================

// PUT /api/whatsapp/conversations/:id/read
router.put('/conversations/:id/read', authenticate, async (req, res) => {
    try {
        await prisma.whatsAppConversation.update({
            where: { id: req.params.id },
            data: { unreadCount: 0 }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao marcar como lida' });
    }
});

// PUT /api/whatsapp/conversations/:id/link-client
router.put('/conversations/:id/link-client', authenticate, async (req, res) => {
    try {
        const { clientId } = req.body;
        const conversation = await prisma.whatsAppConversation.update({
            where: { id: req.params.id },
            data: { clientId: parseFloat(clientId) }
        });
        res.json(conversation);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao vincular cliente' });
    }
});

// ===================================================================
// CONTAGEM DE NÃO-LIDAS
// ===================================================================

// GET /api/whatsapp/unread-count
router.get('/unread-count', authenticate, async (req, res) => {
    try {
        const instances = await prisma.whatsAppInstance.findMany();
        const result = {};

        for (const inst of instances) {
            const aggregation = await prisma.whatsAppConversation.aggregate({
                where: { instanceId: inst.id },
                _sum: { unreadCount: true }
            });
            result[inst.instanceName] = aggregation._sum.unreadCount || 0;
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao contar não-lidas' });
    }
});

module.exports = router;

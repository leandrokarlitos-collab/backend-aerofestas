const express = require('express');
const router = express.Router();
const prisma = require('../prisma/client');
const { authenticate, isAdmin } = require('../middleware/auth');
const webpush = require('web-push');

// Rate limiter simples em memória (por instância)
const rateLimits = {};
const RATE_LIMIT_MAX = 30; // msgs por minuto
const RATE_LIMIT_WINDOW = 60000; // 1 minuto

// Presença em memória { 'instanceName:remoteJid': { status, updatedAt } }
const presenceStore = {};

// Status/Stories em memória { 'instanceName': [{ id, participant, message, timestamp }] }
const statusStore = {};

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

// Normaliza remoteJid: remove sufixo de dispositivo (ex: :0) antes do @
// 5511999999999:0@s.whatsapp.net → 5511999999999@s.whatsapp.net
function normalizeRemoteJid(jid) {
    if (!jid) return jid;
    return jid.replace(/:\d+@/, '@');
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

// Webhook global da Evolution API (URLs separadas por evento) — redireciona para o handler principal
router.post('/webhook/:eventName', async (req, res, next) => {
    // Evolution API envia para /webhook/messages-update, /webhook/messages-upsert, etc.
    // Injeta o eventName no body para que o handler principal consiga processar
    if (!req.body.event) {
        const eventName = req.params.eventName.replace(/-/g, '.'); // messages-update → messages.update
        req.body.event = eventName;
    }
    next(); // passa para o próximo handler que é o router.post('/webhook')
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

            // Normaliza JID antes de qualquer operação
            key.remoteJid = normalizeRemoteJid(key.remoteJid);

            // Captura status — salvar no banco E no store em memória
            if (key.remoteJid === 'status@broadcast') {
                const statusKey = instanceName;
                if (!statusStore[statusKey]) statusStore[statusKey] = [];
                const statusTimestamp = data.messageTimestamp ? new Date(parseInt(data.messageTimestamp) * 1000) : new Date();
                const statusEntry = {
                    id: key.id,
                    fromMe: key.fromMe || false,
                    participant: data.participant || key.participant || null,
                    pushName: data.pushName || null,
                    messageType: detectMessageType(data.message),
                    mediaUrl: extractMediaInfo(data.message).mediaUrl || null,
                    content: extractMessageText(data.message),
                    timestamp: statusTimestamp
                };
                statusStore[statusKey].unshift(statusEntry);
                // Mantém apenas últimos 200 status
                if (statusStore[statusKey].length > 200) statusStore[statusKey] = statusStore[statusKey].slice(0, 200);
                // Persiste no banco (best-effort)
                try {
                    const inst = await prisma.whatsAppInstance.findUnique({ where: { instanceName } });
                    if (inst) {
                        await prisma.whatsAppStatus.upsert({
                            where: { id: key.id },
                            create: {
                                id: key.id,
                                instanceId: inst.id,
                                participant: statusEntry.participant,
                                pushName: statusEntry.pushName,
                                messageType: statusEntry.messageType,
                                content: statusEntry.content,
                                mediaUrl: statusEntry.mediaUrl,
                                timestamp: statusTimestamp
                            },
                            update: {}
                        });
                    }
                } catch(e) { /* não crítico */ }
                return;
            }

            const remoteJid = normalizeRemoteJid(key.remoteJid);
            const isGroup = remoteJid.includes('@g.us');
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

            // Extrai número do telefone ou ID do grupo
            const phoneNumber = remoteJid.replace(/@s\.whatsapp\.net|@g\.us/g, '');

            // Para grupos, pega o nome do grupo via metadata se disponível
            const groupContactName = isGroup ? (data.groupMetadata?.subject || pushName || phoneNumber) : pushName;

            // Upsert da conversa
            const conversation = await prisma.whatsAppConversation.upsert({
                where: {
                    remoteJid_instanceId: { remoteJid, instanceId: instance.id }
                },
                create: {
                    remoteJid,
                    phoneNumber,
                    contactName: groupContactName,
                    instanceId: instance.id,
                    isGroup,
                    lastMessageAt: timestamp,
                    lastMessagePreview: displayContent.substring(0, 200),
                    unreadCount: fromMe ? 0 : 1
                },
                update: {
                    contactName: isGroup ? undefined : (pushName || undefined),
                    lastMessageAt: timestamp,
                    lastMessagePreview: isGroup && pushName ? `${pushName}: ${displayContent}`.substring(0, 200) : displayContent.substring(0, 200),
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
                        pushName: pushName || null,
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

            // Auto-match de cliente (apenas para mensagens recebidas, não grupos)
            if (!fromMe && !isGroup && !conversation.clientId) {
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
            // data pode ser: array de updates, objeto único, ou { messages: [...] }
            let updates = [];
            if (Array.isArray(data)) updates = data;
            else if (data.messages && Array.isArray(data.messages)) updates = data.messages;
            else if (data.keyId || data.key || data.status !== undefined) updates = [data];
            else updates = [data];

            console.log(`[WA Status] Recebido ${updates.length} atualizações. Raw:`, JSON.stringify(data).substring(0, 500));

            for (const update of updates) {
                // Formatos possíveis:
                // v2.3.6: { keyId, remoteJid, fromMe, status, instanceId }
                // v2.x:   { key: { id, remoteJid, fromMe }, update: { status } }
                // baileys: { key: { id }, update: { status } }
                const msgId = update.keyId || update.key?.id || update.id;
                const rawStatus = update.status ?? update.update?.status ?? update.ack;

                console.log(`[WA Status] msgId=${msgId}, rawStatus=${rawStatus}, type=${typeof rawStatus}`);

                if (rawStatus === undefined || rawStatus === null) continue;

                let statusStr = 'sent';
                // rawStatus pode ser número (2,3,4,5) ou string ("SERVER_ACK","DELIVERY_ACK","READ","PLAYED")
                const rsNum = Number(rawStatus);
                const rsStr = typeof rawStatus === 'string' ? rawStatus.toUpperCase() : '';
                if (rsNum === 3 || rsStr === 'DELIVERY_ACK' || rsStr === 'DELIVERED') statusStr = 'delivered';
                else if (rsNum === 4 || rsStr === 'READ') statusStr = 'read';
                else if (rsNum === 5 || rsStr === 'PLAYED') statusStr = 'played';
                else if (rsNum === 2 || rsStr === 'SERVER_ACK') statusStr = 'sent';
                // default stays 'sent'

                if (msgId) {
                    try {
                        await prisma.whatsAppMessage.update({
                            where: { id: msgId },
                            data: { status: statusStr }
                        });
                        console.log(`[WA Status] OK: ${msgId} → ${statusStr}`);
                    } catch (e) {
                        console.warn(`[WA Status] Msg ${msgId} não encontrada no banco`);
                    }
                }
            }
        }

        // --- PRESENCE_UPDATE (typing, recording, available, unavailable) ---
        if (event === 'presence.update' || event === 'presence_update') {
            const remoteJid = data.id || data.remoteJid || data.participant;
            const presence = data.presences?.[remoteJid]?.lastKnownPresence
                          || data.lastKnownPresence
                          || data.presence
                          || data.status;
            if (remoteJid && presence) {
                const key = `${instanceName}:${remoteJid}`;
                presenceStore[key] = { status: presence, updatedAt: Date.now() };
                console.log(`[WA Presence] ${key} → ${presence}`);
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
                                'CONNECTION_UPDATE', 'QRCODE_UPDATED',
                                'PRESENCE_UPDATE'
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

// POST /api/whatsapp/instances/update-webhooks — Atualiza webhooks de todas as instâncias (admin)
router.post('/instances/update-webhooks', isAdmin, async (req, res) => {
    try {
        const instances = await prisma.whatsAppInstance.findMany();
        const backendUrl = process.env.BACKEND_URL || 'https://backend-aerofestas-production.up.railway.app';
        const results = [];
        for (const inst of instances) {
            try {
                const evoRes = await fetch(`${inst.evolutionUrl}/webhook/set/${inst.instanceName}`, {
                    method: 'POST',
                    headers: { 'apikey': inst.apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        webhook: {
                            enabled: true,
                            url: `${backendUrl}/api/whatsapp/webhook`,
                            webhookByEvents: false,
                            events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED', 'PRESENCE_UPDATE']
                        }
                    })
                });
                const data = await evoRes.json();
                results.push({ instance: inst.instanceName, success: evoRes.ok, data });
            } catch (e) {
                results.push({ instance: inst.instanceName, success: false, error: e.message });
            }
        }
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar webhooks' });
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
        const { instance, search, page = 1, limit = 50, clientId, archived, groups } = req.query;

        const where = {};

        if (instance) {
            const inst = await prisma.whatsAppInstance.findUnique({ where: { instanceName: instance } });
            if (inst) where.instanceId = inst.id;
        }

        if (clientId) {
            where.clientId = parseFloat(clientId);
        }

        // Filtro por arquivados
        if (archived === 'true') {
            where.isArchived = true;
        } else if (archived !== 'all') {
            where.isArchived = false;
        }

        // Filtro por grupos
        if (groups === 'true') {
            where.isGroup = true;
        } else if (groups === 'false') {
            where.isGroup = false;
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

// POST /api/whatsapp/ensure-conversation — Garante que conversa existe no banco (usado ao abrir grupos)
router.post('/ensure-conversation', authenticate, async (req, res) => {
    try {
        const { instanceName, remoteJid, contactName, isGroup } = req.body;
        if (!instanceName || !remoteJid) return res.status(400).json({ error: 'instanceName e remoteJid obrigatórios' });

        const instance = await prisma.whatsAppInstance.findUnique({ where: { instanceName } });
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        const normalized = normalizeRemoteJid(remoteJid);
        const phoneNumber = normalized.replace(/@s\.whatsapp\.net|@g\.us/g, '');

        const conv = await prisma.whatsAppConversation.upsert({
            where: { remoteJid_instanceId: { remoteJid: normalized, instanceId: instance.id } },
            create: {
                remoteJid: normalized,
                phoneNumber,
                contactName: contactName || null,
                instanceId: instance.id,
                isGroup: isGroup || normalized.includes('@g.us')
            },
            update: {
                contactName: contactName || undefined
            }
        });

        res.json(conv);
    } catch (error) {
        console.error('Erro ao garantir conversa:', error);
        res.status(500).json({ error: 'Erro ao garantir conversa' });
    }
});

// ===================================================================
// MENSAGENS
// ===================================================================

// GET /api/whatsapp/conversations/:id/messages
router.get('/conversations/:id/messages', authenticate, async (req, res) => {
    try {
        const { page = 1, limit = 80, since } = req.query;

        const select = {
            id: true,
            conversationId: true,
            fromMe: true,
            pushName: true,
            content: true,
            messageType: true,
            mediaUrl: true,
            mediaName: true,
            mediaMimetype: true,
            timestamp: true,
            status: true
        };

        // Modo "polling incremental": busca apenas msgs após um timestamp
        // Muito mais leve que buscar page=1 inteiro a cada 5s
        if (since) {
            const sinceDate = new Date(since);
            if (!isNaN(sinceDate.getTime())) {
                const messages = await prisma.whatsAppMessage.findMany({
                    where: {
                        conversationId: req.params.id,
                        timestamp: { gt: sinceDate }
                    },
                    orderBy: { timestamp: 'asc' },
                    take: 50,
                    select
                });
                return res.json(messages);
            }
        }

        // Modo normal: paginação
        const take = Math.min(parseInt(limit) || 80, 200);
        const skip = (Math.max(parseInt(page) || 1, 1) - 1) * take;

        const messages = await prisma.whatsAppMessage.findMany({
            where: { conversationId: req.params.id },
            orderBy: { timestamp: 'desc' },
            take,
            skip,
            select
        });

        // Cache-Control para páginas antigas
        if (skip > 0) {
            res.setHeader('Cache-Control', 'private, max-age=60');
        }

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

        // Envia via Evolution API (para grupos, usa o JID completo)
        const isGroupJid = remoteJid.includes('@g.us');
        const number = isGroupJid ? remoteJid : remoteJid.replace('@s.whatsapp.net', '');
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

        const isGroupJid = remoteJid.includes('@g.us');
        const number = isGroupJid ? remoteJid : remoteJid.replace('@s.whatsapp.net', '');
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
                mediaUrl: typeof media === 'string' && media.startsWith('http') ? media
                    : (typeof media === 'string' ? `data:${mimetype || 'application/octet-stream'};base64,${media}` : null),
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
// PRESENÇA (TYPING / RECORDING)
// ===================================================================

// GET /api/whatsapp/presence/:instanceName/:remoteJid — Consulta presença
router.get('/presence/:instanceName/:remoteJid', authenticate, (req, res) => {
    const key = `${req.params.instanceName}:${req.params.remoteJid}`;
    const entry = presenceStore[key];
    // Presença expira em 15 segundos (se não houver update, considerar idle)
    if (entry && (Date.now() - entry.updatedAt) < 15000) {
        return res.json({ presence: entry.status });
    }
    res.json({ presence: null });
});

// ===================================================================
// FOTO DE PERFIL DO CONTATO
// ===================================================================

// GET /api/whatsapp/profile-pic/:instanceName/:number — Busca foto de perfil
router.get('/profile-pic/:instanceName/:number', authenticate, async (req, res) => {
    try {
        const instance = await prisma.whatsAppInstance.findUnique({
            where: { instanceName: req.params.instanceName }
        });
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        // Valida número: Evolution API exige string numérica
        const number = req.params.number;
        if (!number || !/^\d+$/.test(number)) {
            return res.json({ profilePicUrl: null });
        }

        const evoRes = await fetch(`${instance.evolutionUrl}/chat/fetchProfilePictureUrl/${instance.instanceName}`, {
            method: 'POST',
            headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ number })
        });

        if (!evoRes.ok) {
            return res.json({ profilePicUrl: null });
        }

        const data = await evoRes.json();
        res.json({ profilePicUrl: data.profilePictureUrl || data.url || data.picture || null });
    } catch (error) {
        console.error('Erro ao buscar foto de perfil:', error);
        res.json({ profilePicUrl: null });
    }
});

// ===================================================================
// DOWNLOAD DE MÍDIA (para áudios recebidos sem URL)
// ===================================================================

// POST /api/whatsapp/download-media — Baixa mídia via getBase64FromMediaMessage
router.post('/download-media', authenticate, async (req, res) => {
    try {
        const { instanceName, messageId, conversationId } = req.body;

        // Buscar a mensagem e instância
        const message = await prisma.whatsAppMessage.findUnique({
            where: { id: messageId },
            include: { conversation: { include: { instance: true } } }
        });

        if (!message) return res.status(404).json({ error: 'Mensagem não encontrada' });

        const instance = message.conversation.instance;

        // Chamar Evolution API para obter a mídia em base64
        const evoRes = await fetch(`${instance.evolutionUrl}/chat/getBase64FromMediaMessage/${instance.instanceName}`, {
            method: 'POST',
            headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: { key: { id: messageId } },
                convertToMp4: false
            })
        });

        if (!evoRes.ok) {
            const err = await evoRes.json().catch(() => ({}));
            console.error('Erro Evolution API download-media:', err);
            return res.status(502).json({ error: 'Erro ao baixar mídia', details: err });
        }

        const data = await evoRes.json();
        const base64 = data.base64 || data.mediaUrl || null;
        const mimetype = data.mimetype || data.mediatype || message.mediaMimetype || 'audio/ogg';

        // Se obteve o base64, salvar a URL como data URI na mensagem
        if (base64) {
            const mediaUrl = base64.startsWith('data:') ? base64 : `data:${mimetype};base64,${base64}`;
            await prisma.whatsAppMessage.update({
                where: { id: messageId },
                data: { mediaUrl }
            });
            return res.json({ mediaUrl, mimetype });
        }

        res.json({ mediaUrl: null });
    } catch (error) {
        console.error('Erro ao baixar mídia:', error);
        res.status(500).json({ error: 'Erro ao baixar mídia' });
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

// ===================================================================
// SYNC DE HISTÓRICO (CRÍTICO — busca mensagens da Evolution API)
// ===================================================================

// Função auxiliar para buscar instância com credenciais
async function getInstanceWithCreds(instanceName) {
    const instance = await prisma.whatsAppInstance.findUnique({ where: { instanceName } });
    if (!instance) return null;
    return instance;
}

// POST /api/whatsapp/sync-conversation/:conversationId — Sync sob demanda
router.post('/sync-conversation/:conversationId', authenticate, async (req, res) => {
    try {
        const conv = await prisma.whatsAppConversation.findUnique({
            where: { id: req.params.conversationId },
            include: { instance: true }
        });
        if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

        const instance = conv.instance;
        const remoteJid = conv.remoteJid;
        let synced = 0;
        let total = 0;

        // 1. Tenta buscar mensagens na Evolution API
        try {
            const evoRes = await fetch(`${instance.evolutionUrl}/chat/findMessages/${instance.instanceName}`, {
                method: 'POST',
                headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    where: { key: { remoteJid } },
                    limit: 200
                })
            });

            if (evoRes.ok) {
                const evoMessages = await evoRes.json();
                // Log da estrutura bruta para debug (primeiros 500 chars)
                console.log(`[Sync] ${remoteJid}: raw response keys=`, Object.keys(evoMessages || {}), 'isArray=', Array.isArray(evoMessages));

                // Evolution API v2 pode retornar várias estruturas:
                // - Array direto: [...]
                // - { messages: [...] }
                // - { messages: { records: [...] } }
                // - { data: [...] }
                let msgs = [];
                if (Array.isArray(evoMessages)) {
                    msgs = evoMessages;
                } else if (Array.isArray(evoMessages?.messages)) {
                    msgs = evoMessages.messages;
                } else if (Array.isArray(evoMessages?.messages?.records)) {
                    msgs = evoMessages.messages.records;
                } else if (Array.isArray(evoMessages?.data)) {
                    msgs = evoMessages.data;
                } else if (Array.isArray(evoMessages?.records)) {
                    msgs = evoMessages.records;
                } else {
                    console.warn(`[Sync] ${remoteJid}: formato desconhecido da Evolution API:`, JSON.stringify(evoMessages).substring(0, 300));
                    msgs = [];
                }
                total = msgs.length;
                console.log(`[Sync] ${remoteJid}: Evolution API retornou ${total} msgs`);

                for (const msg of msgs) {
                    const key = msg.key;
                    if (!key || !key.id) continue;

                    const messageText = extractMessageText(msg.message);
                    const messageType = detectMessageType(msg.message);
                    const mediaInfo = extractMediaInfo(msg.message);
                    const timestamp = msg.messageTimestamp
                        ? new Date(parseInt(msg.messageTimestamp) * 1000)
                        : new Date();
                    const displayContent = messageText || `[${messageType}]`;

                    try {
                        await prisma.whatsAppMessage.create({
                            data: {
                                id: key.id,
                                conversationId: conv.id,
                                fromMe: key.fromMe || false,
                                pushName: msg.pushName || null,
                                content: displayContent,
                                messageType,
                                mediaUrl: mediaInfo.mediaUrl || null,
                                mediaName: mediaInfo.mediaName || null,
                                mediaMimetype: mediaInfo.mediaMimetype || null,
                                timestamp,
                                status: key.fromMe ? 'sent' : 'received'
                            }
                        });
                        synced++;
                    } catch (e) {
                        if (e.code !== 'P2002') console.warn('[Sync] Erro ao salvar msg:', e.message);
                    }
                }
            } else {
                const err = await evoRes.text().catch(() => '');
                console.warn(`[Sync] Evolution API retornou ${evoRes.status} para ${remoteJid}:`, err.substring(0, 200));
            }
        } catch (evoErr) {
            console.warn(`[Sync] Erro ao chamar Evolution API para ${remoteJid}:`, evoErr.message);
        }

        // 2. Conta quantas mensagens existem no banco para esta conversa
        const dbCount = await prisma.whatsAppMessage.count({
            where: { conversationId: conv.id }
        });

        // 3. Se a Evolution API não tem mais histórico mas o banco já tem, retorna o que tem
        if (total === 0 && dbCount > 0) {
            console.log(`[Sync] ${remoteJid}: Evolution API sem histórico, mas banco tem ${dbCount} msgs`);
            return res.json({ success: true, synced: 0, total: 0, dbCount, alreadyInDb: true });
        }

        // 4. Atualiza lastMessageAt da conversa se sincronizou
        if (synced > 0) {
            const lastMsg = await prisma.whatsAppMessage.findFirst({
                where: { conversationId: conv.id },
                orderBy: { timestamp: 'desc' }
            });
            if (lastMsg) {
                await prisma.whatsAppConversation.update({
                    where: { id: conv.id },
                    data: {
                        lastMessageAt: lastMsg.timestamp,
                        lastMessagePreview: lastMsg.content?.substring(0, 200)
                    }
                });
            }
        }

        res.json({ success: true, synced, total, dbCount });
    } catch (error) {
        console.error('Erro ao sincronizar conversa:', error);
        res.status(500).json({ error: 'Erro ao sincronizar' });
    }
});

// POST /api/whatsapp/sync-history/:instanceName — Sync completo de todas as conversas
router.post('/sync-history/:instanceName', authenticate, async (req, res) => {
    try {
        const instance = await getInstanceWithCreds(req.params.instanceName);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        // Busca todas as conversas desta instância
        const conversations = await prisma.whatsAppConversation.findMany({
            where: { instanceId: instance.id }
        });

        let totalSynced = 0;
        const errors = [];

        for (const conv of conversations) {
            try {
                const evoRes = await fetch(`${instance.evolutionUrl}/chat/findMessages/${instance.instanceName}`, {
                    method: 'POST',
                    headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        where: { key: { remoteJid: conv.remoteJid } },
                        limit: 100
                    })
                });

                if (!evoRes.ok) continue;

                const evoMessages = await evoRes.json();
                let msgs = [];
                if (Array.isArray(evoMessages)) {
                    msgs = evoMessages;
                } else if (Array.isArray(evoMessages?.messages)) {
                    msgs = evoMessages.messages;
                } else if (Array.isArray(evoMessages?.messages?.records)) {
                    msgs = evoMessages.messages.records;
                } else if (Array.isArray(evoMessages?.data)) {
                    msgs = evoMessages.data;
                } else if (Array.isArray(evoMessages?.records)) {
                    msgs = evoMessages.records;
                } else {
                    msgs = [];
                }

                for (const msg of msgs) {
                    const key = msg.key;
                    if (!key || !key.id) continue;

                    const messageText = extractMessageText(msg.message);
                    const messageType = detectMessageType(msg.message);
                    const mediaInfo = extractMediaInfo(msg.message);
                    const timestamp = msg.messageTimestamp
                        ? new Date(parseInt(msg.messageTimestamp) * 1000)
                        : new Date();
                    const displayContent = messageText || `[${messageType}]`;

                    try {
                        await prisma.whatsAppMessage.create({
                            data: {
                                id: key.id,
                                conversationId: conv.id,
                                fromMe: key.fromMe || false,
                                pushName: msg.pushName || null,
                                content: displayContent,
                                messageType,
                                mediaUrl: mediaInfo.mediaUrl || null,
                                mediaName: mediaInfo.mediaName || null,
                                mediaMimetype: mediaInfo.mediaMimetype || null,
                                timestamp,
                                status: key.fromMe ? 'sent' : 'received'
                            }
                        });
                        totalSynced++;
                    } catch (e) {
                        if (e.code !== 'P2002') errors.push(e.message);
                    }
                }
            } catch (e) {
                errors.push(`${conv.remoteJid}: ${e.message}`);
            }
        }

        // Também tenta buscar chats que ainda não existem no banco
        try {
            const evoRes = await fetch(`${instance.evolutionUrl}/chat/findChats/${instance.instanceName}`, {
                method: 'POST',
                headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            if (evoRes.ok) {
                const chats = await evoRes.json();
                const chatList = Array.isArray(chats) ? chats : chats.chats || [];

                for (const chat of chatList) {
                    let remoteJid = chat.id || chat.remoteJid;
                    if (!remoteJid) continue;
                    // Pula status broadcast
                    if (remoteJid === 'status@broadcast') continue;
                    // Pula JIDs com @lid (endereçamento LID do Meta Business/Itaú)
                    if (remoteJid.includes('@lid')) continue;
                    // Normaliza JID (remove sufixo :0 de dispositivo)
                    remoteJid = normalizeRemoteJid(remoteJid);
                    // Pula JIDs sem domínio @s.whatsapp.net ou @g.us (IDs internos inválidos)
                    if (!remoteJid.includes('@')) continue;

                    const isGroup = remoteJid.includes('@g.us');
                    const phoneNumber = remoteJid.replace(/@s\.whatsapp\.net|@g\.us/g, '');

                    // Extrai texto do lastMessagePreview (pode ser Object ou String)
                    let lastPreview = null;
                    if (chat.lastMessage) {
                        if (typeof chat.lastMessage === 'string') {
                            lastPreview = chat.lastMessage.substring(0, 200);
                        } else if (typeof chat.lastMessage === 'object') {
                            // Tenta extrair texto do objeto de mensagem
                            const msg = chat.lastMessage;
                            const text = msg.message?.conversation
                                || msg.message?.extendedTextMessage?.text
                                || msg.message?.imageMessage?.caption
                                || msg.message?.videoMessage?.caption
                                || msg.messageType
                                || null;
                            lastPreview = text ? String(text).substring(0, 200) : null;
                        }
                    }

                    // Verifica se já existe
                    const existing = await prisma.whatsAppConversation.findUnique({
                        where: { remoteJid_instanceId: { remoteJid, instanceId: instance.id } }
                    });

                    if (!existing) {
                        await prisma.whatsAppConversation.create({
                            data: {
                                remoteJid,
                                phoneNumber,
                                contactName: chat.name || chat.pushName || null,
                                instanceId: instance.id,
                                isGroup,
                                lastMessageAt: chat.lastMessageAt ? new Date(chat.lastMessageAt) : null,
                                lastMessagePreview: lastPreview
                            }
                        });
                    }
                }
            }
        } catch (e) {
            console.warn('[Sync History] Erro ao buscar chats:', e.message);
        }

        res.json({ success: true, synced: totalSynced, conversations: conversations.length, errors: errors.slice(0, 10) });
    } catch (error) {
        console.error('Erro ao sincronizar histórico:', error);
        res.status(500).json({ error: 'Erro ao sincronizar histórico' });
    }
});

// ===================================================================
// CONTATOS
// ===================================================================

// GET /api/whatsapp/contacts/:instanceName — Lista contatos via Evolution API
router.get('/contacts/:instanceName', authenticate, async (req, res) => {
    try {
        const instance = await getInstanceWithCreds(req.params.instanceName);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        const evoRes = await fetch(`${instance.evolutionUrl}/chat/findContacts/${instance.instanceName}`, {
            method: 'POST',
            headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        if (!evoRes.ok) {
            const err = await evoRes.json().catch(() => ({}));
            return res.status(502).json({ error: 'Erro ao buscar contatos', details: err });
        }

        const contacts = await evoRes.json();
        const contactList = Array.isArray(contacts) ? contacts : contacts.contacts || [];

        // Normaliza e filtra contatos válidos
        const result = contactList
            .filter(c => c.id && !c.id.includes('@g.us') && c.id !== 'status@broadcast')
            .map(c => ({
                remoteJid: c.id,
                phoneNumber: c.id.replace('@s.whatsapp.net', ''),
                name: c.pushName || c.name || c.verifiedName || c.id.replace('@s.whatsapp.net', ''),
                profilePicUrl: c.profilePictureUrl || null
            }));

        res.json(result);
    } catch (error) {
        console.error('Erro ao buscar contatos:', error);
        res.status(500).json({ error: 'Erro ao buscar contatos' });
    }
});

// POST /api/whatsapp/send-contact — Envia contato (vCard)
router.post('/send-contact', authenticate, async (req, res) => {
    try {
        let { instanceName, remoteJid, conversationId, contact } = req.body;
        // contact: { fullName, phoneNumber, wuid? }

        if (conversationId && (!remoteJid || !instanceName)) {
            const conv = await prisma.whatsAppConversation.findUnique({
                where: { id: conversationId },
                include: { instance: true }
            });
            if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
            remoteJid = conv.remoteJid;
            instanceName = instanceName || conv.instance.instanceName;
        }

        if (!instanceName || !remoteJid || !contact) {
            return res.status(400).json({ error: 'instanceName, remoteJid e contact são obrigatórios' });
        }

        if (!checkRateLimit(instanceName)) {
            return res.status(429).json({ error: 'Limite de envio atingido.' });
        }

        const instance = await getInstanceWithCreds(instanceName);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        const number = remoteJid.replace(/@s\.whatsapp\.net|@g\.us/g, '');
        const contactPhone = contact.phoneNumber || contact.phone;
        const contactName = contact.fullName || contact.name;

        const evoRes = await fetch(`${instance.evolutionUrl}/message/sendContact/${instanceName}`, {
            method: 'POST',
            headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                number,
                contact: [{
                    fullName: contactName,
                    wuid: contactPhone.replace(/\D/g, ''),
                    phoneNumber: contactPhone,
                    organization: contact.organization || '',
                    email: contact.email || '',
                    url: contact.url || ''
                }]
            })
        });

        const evoData = await evoRes.json();
        if (!evoRes.ok) {
            return res.status(502).json({ error: 'Erro ao enviar contato', details: evoData });
        }

        const sentMessageId = evoData.key?.id || `sent-${Date.now()}`;

        const conversation = await prisma.whatsAppConversation.upsert({
            where: { remoteJid_instanceId: { remoteJid, instanceId: instance.id } },
            create: { remoteJid, phoneNumber: number, instanceId: instance.id, lastMessageAt: new Date(), lastMessagePreview: `📇 ${contactName}` },
            update: { lastMessageAt: new Date(), lastMessagePreview: `📇 ${contactName}` }
        });

        const savedMessage = await prisma.whatsAppMessage.create({
            data: {
                id: sentMessageId,
                conversationId: conversation.id,
                fromMe: true,
                content: `📇 ${contactName}`,
                messageType: 'contact',
                timestamp: new Date(),
                status: 'sent'
            }
        });

        res.json(savedMessage);
    } catch (error) {
        console.error('Erro ao enviar contato:', error);
        res.status(500).json({ error: 'Erro ao enviar contato' });
    }
});

// ===================================================================
// GRUPOS
// ===================================================================

// GET /api/whatsapp/groups/:instanceName — Lista todos os grupos
router.get('/groups/:instanceName', authenticate, async (req, res) => {
    try {
        const instance = await getInstanceWithCreds(req.params.instanceName);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        // Tenta POST (padrão v2.x), fallback para GET (algumas versões)
        let evoRes = await fetch(`${instance.evolutionUrl}/group/fetchAllGroups/${instance.instanceName}`, {
            method: 'POST',
            headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ getParticipants: false })
        });

        // Fallback: tenta GET se POST falhou
        if (!evoRes.ok) {
            evoRes = await fetch(`${instance.evolutionUrl}/group/fetchAllGroups/${instance.instanceName}?getParticipants=false`, {
                method: 'GET',
                headers: { 'apikey': instance.apiKey }
            });
        }

        if (!evoRes.ok) {
            const err = await evoRes.json().catch(() => ({}));
            console.error(`[WA Groups] Erro ao buscar grupos (${evoRes.status}):`, err);
            return res.status(502).json({ error: 'Erro ao buscar grupos', details: err });
        }

        const groups = await evoRes.json();
        const groupList = Array.isArray(groups) ? groups : groups.groups || [];

        res.json(groupList.map(g => ({
            id: g.id,
            subject: g.subject || g.name || 'Grupo',
            owner: g.owner || null,
            size: g.size || g.participants?.length || 0,
            profilePicUrl: g.profilePicUrl || g.pictureUrl || null,
            creation: g.creation || null,
            desc: g.desc || null
        })));
    } catch (error) {
        console.error('Erro ao buscar grupos:', error);
        res.status(500).json({ error: 'Erro ao buscar grupos' });
    }
});

// GET /api/whatsapp/groups/:instanceName/:groupJid — Detalhes de um grupo
router.get('/groups/:instanceName/:groupJid', authenticate, async (req, res) => {
    try {
        const instance = await getInstanceWithCreds(req.params.instanceName);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        const evoRes = await fetch(`${instance.evolutionUrl}/group/findGroupByJid/${instance.instanceName}`, {
            method: 'POST',
            headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ jid: req.params.groupJid })
        });

        if (!evoRes.ok) {
            const err = await evoRes.json().catch(() => ({}));
            return res.status(502).json({ error: 'Erro ao buscar grupo', details: err });
        }

        const group = await evoRes.json();
        res.json(group);
    } catch (error) {
        console.error('Erro ao buscar grupo:', error);
        res.status(500).json({ error: 'Erro ao buscar grupo' });
    }
});

// PUT /api/whatsapp/groups/:instanceName/:groupJid/subject — Atualiza nome do grupo
router.put('/groups/:instanceName/:groupJid/subject', authenticate, async (req, res) => {
    try {
        const instance = await getInstanceWithCreds(req.params.instanceName);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });
        const { subject } = req.body;
        const evoRes = await fetch(`${instance.evolutionUrl}/group/updateGroupSubject/${instance.instanceName}`, {
            method: 'PUT',
            headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupJid: req.params.groupJid, subject })
        });
        const data = await evoRes.json().catch(() => ({}));
        if (!evoRes.ok) return res.status(502).json({ error: 'Erro ao atualizar nome', details: data });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar nome do grupo' });
    }
});

// PUT /api/whatsapp/groups/:instanceName/:groupJid/description — Atualiza descrição
router.put('/groups/:instanceName/:groupJid/description', authenticate, async (req, res) => {
    try {
        const instance = await getInstanceWithCreds(req.params.instanceName);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });
        const { description } = req.body;
        const evoRes = await fetch(`${instance.evolutionUrl}/group/updateGroupDescription/${instance.instanceName}`, {
            method: 'PUT',
            headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupJid: req.params.groupJid, description })
        });
        const data = await evoRes.json().catch(() => ({}));
        if (!evoRes.ok) return res.status(502).json({ error: 'Erro ao atualizar descrição', details: data });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar descrição do grupo' });
    }
});

// POST /api/whatsapp/groups/:instanceName/:groupJid/participants — Adiciona/remove/promove/rebaixa participantes
router.post('/groups/:instanceName/:groupJid/participants', authenticate, async (req, res) => {
    try {
        const instance = await getInstanceWithCreds(req.params.instanceName);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });
        // action: 'add' | 'remove' | 'promote' | 'demote'
        const { action, participants } = req.body;
        if (!action || !participants) return res.status(400).json({ error: 'action e participants obrigatórios' });
        const evoRes = await fetch(`${instance.evolutionUrl}/group/updateParticipant/${instance.instanceName}`, {
            method: 'PUT',
            headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupJid: req.params.groupJid, action, participants })
        });
        const data = await evoRes.json().catch(() => ({}));
        if (!evoRes.ok) return res.status(502).json({ error: 'Erro ao atualizar participantes', details: data });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar participantes' });
    }
});

// POST /api/whatsapp/groups/:instanceName/:groupJid/leave — Sair do grupo
router.post('/groups/:instanceName/:groupJid/leave', authenticate, async (req, res) => {
    try {
        const instance = await getInstanceWithCreds(req.params.instanceName);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });
        const evoRes = await fetch(`${instance.evolutionUrl}/group/leaveGroup/${instance.instanceName}`, {
            method: 'DELETE',
            headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupJid: req.params.groupJid })
        });
        const data = await evoRes.json().catch(() => ({}));
        if (!evoRes.ok) return res.status(502).json({ error: 'Erro ao sair do grupo', details: data });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao sair do grupo' });
    }
});

// ===================================================================
// ARQUIVAR / SILENCIAR
// ===================================================================

// PUT /api/whatsapp/conversations/:id/archive — Arquiva/desarquiva conversa
router.put('/conversations/:id/archive', authenticate, async (req, res) => {
    try {
        const { archive } = req.body; // true or false
        const conv = await prisma.whatsAppConversation.update({
            where: { id: req.params.id },
            data: { isArchived: archive !== false }
        });

        // Tenta arquivar na Evolution API também
        try {
            const instance = await prisma.whatsAppInstance.findUnique({ where: { id: conv.instanceId } });
            if (instance) {
                // Busca última mensagem para o payload
                const lastMsg = await prisma.whatsAppMessage.findFirst({
                    where: { conversationId: conv.id },
                    orderBy: { timestamp: 'desc' }
                });

                await fetch(`${instance.evolutionUrl}/chat/archiveChat/${instance.instanceName}`, {
                    method: 'POST',
                    headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat: conv.remoteJid,
                        archive: archive !== false,
                        lastMessage: lastMsg ? {
                            remoteJid: conv.remoteJid,
                            fromMe: lastMsg.fromMe,
                            id: lastMsg.id
                        } : undefined
                    })
                });
            }
        } catch (e) {
            console.warn('[Archive] Erro ao arquivar na Evolution API:', e.message);
        }

        res.json(conv);
    } catch (error) {
        console.error('Erro ao arquivar:', error);
        res.status(500).json({ error: 'Erro ao arquivar' });
    }
});

// PUT /api/whatsapp/conversations/:id/mute — Silencia/dessilencia conversa
router.put('/conversations/:id/mute', authenticate, async (req, res) => {
    try {
        const { mute, duration } = req.body; // mute: bool, duration: '8h'|'1w'|'forever'|null

        let mutedUntil = null;
        if (mute && duration) {
            const now = new Date();
            if (duration === '8h') mutedUntil = new Date(now.getTime() + 8 * 60 * 60 * 1000);
            else if (duration === '1w') mutedUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
            // 'forever' = null mutedUntil but isMuted = true
        }

        const conv = await prisma.whatsAppConversation.update({
            where: { id: req.params.id },
            data: {
                isMuted: mute !== false,
                mutedUntil
            }
        });

        res.json(conv);
    } catch (error) {
        console.error('Erro ao silenciar:', error);
        res.status(500).json({ error: 'Erro ao silenciar' });
    }
});

// ===================================================================
// PERFIL DO WHATSAPP
// ===================================================================

// GET /api/whatsapp/profile/:instanceName — Busca perfil da instância
router.get('/profile/:instanceName', authenticate, async (req, res) => {
    try {
        const instance = await getInstanceWithCreds(req.params.instanceName);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        // Tenta buscar perfil via fetchProfile
        try {
            const evoRes = await fetch(`${instance.evolutionUrl}/chat/fetchProfile/${instance.instanceName}`, {
                method: 'POST',
                headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: instance.phoneNumber || '' })
            });
            if (evoRes.ok) {
                const profile = await evoRes.json();
                return res.json({
                    name: profile.name || profile.pushName || instance.displayName,
                    status: profile.status || profile.about || '',
                    profilePicUrl: profile.profilePictureUrl || profile.picture || null,
                    phoneNumber: instance.phoneNumber
                });
            }
        } catch (e) { /* fallback below */ }

        // Fallback: retorna dados do banco
        res.json({
            name: instance.displayName,
            status: '',
            profilePicUrl: null,
            phoneNumber: instance.phoneNumber
        });
    } catch (error) {
        console.error('Erro ao buscar perfil:', error);
        res.status(500).json({ error: 'Erro ao buscar perfil' });
    }
});

// PUT /api/whatsapp/profile/:instanceName — Edita perfil
router.put('/profile/:instanceName', authenticate, async (req, res) => {
    try {
        const instance = await getInstanceWithCreds(req.params.instanceName);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        const { name, status, profilePic } = req.body;
        const results = {};

        // Atualiza nome
        if (name) {
            try {
                const evoRes = await fetch(`${instance.evolutionUrl}/chat/updateProfileName/${instance.instanceName}`, {
                    method: 'POST',
                    headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                results.name = evoRes.ok;
                if (evoRes.ok) {
                    await prisma.whatsAppInstance.update({
                        where: { instanceName: instance.instanceName },
                        data: { displayName: name }
                    });
                }
            } catch (e) { results.name = false; }
        }

        // Atualiza recado/about
        if (status !== undefined) {
            try {
                const evoRes = await fetch(`${instance.evolutionUrl}/chat/updateProfileStatus/${instance.instanceName}`, {
                    method: 'POST',
                    headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status })
                });
                results.status = evoRes.ok;
            } catch (e) { results.status = false; }
        }

        // Atualiza foto de perfil
        if (profilePic) {
            try {
                const evoRes = await fetch(`${instance.evolutionUrl}/chat/updateProfilePicture/${instance.instanceName}`, {
                    method: 'POST',
                    headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ picture: profilePic })
                });
                results.profilePic = evoRes.ok;
            } catch (e) { results.profilePic = false; }
        }

        res.json({ success: true, results });
    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);
        res.status(500).json({ error: 'Erro ao atualizar perfil' });
    }
});

// ===================================================================
// STATUS / STORIES
// ===================================================================

// GET /api/whatsapp/status/:instanceName — Busca status dos contatos
router.get('/status/:instanceName', authenticate, async (req, res) => {
    try {
        const instance = await getInstanceWithCreds(req.params.instanceName);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        // 1. Busca do banco (últimas 24h)
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const dbStatuses = await prisma.whatsAppStatus.findMany({
            where: { instanceId: instance.id, timestamp: { gte: since } },
            orderBy: { timestamp: 'desc' },
            take: 200
        });

        if (dbStatuses.length > 0) {
            return res.json(dbStatuses);
        }

        // 2. Fallback: store em memória (se reiniciou e ainda tem dados)
        const memStatuses = statusStore[req.params.instanceName] || [];
        if (memStatuses.length > 0) {
            return res.json(memStatuses);
        }

        // 3. Tenta buscar via Evolution API como último recurso
        try {
            const evoRes = await fetch(`${instance.evolutionUrl}/chat/findStatusMessage/${instance.instanceName}`, {
                method: 'POST',
                headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            if (evoRes.ok) {
                const statuses = await evoRes.json();
                return res.json(Array.isArray(statuses) ? statuses : statuses.messages || []);
            }
        } catch (e) { /* sem status */ }

        res.json([]);
    } catch (error) {
        console.error('Erro ao buscar status:', error);
        res.status(500).json({ error: 'Erro ao buscar status' });
    }
});

// POST /api/whatsapp/status/:instanceName — Posta status
router.post('/status/:instanceName', authenticate, async (req, res) => {
    try {
        const instance = await getInstanceWithCreds(req.params.instanceName);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        const { type, content, caption, backgroundColor, font, media, statusJidList } = req.body;
        // type: 'text' | 'image' | 'video' | 'audio'

        const body = {
            type: type || 'text',
            content: content || '',
            allContacts: !statusJidList,
            statusJidList: statusJidList || undefined
        };
        if (caption) body.caption = caption;
        if (backgroundColor) body.backgroundColor = backgroundColor;
        if (font) body.font = font;
        if (media) body.media = media;

        const evoRes = await fetch(`${instance.evolutionUrl}/message/sendStatus/${instance.instanceName}`, {
            method: 'POST',
            headers: { 'apikey': instance.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const evoData = await evoRes.json();
        if (!evoRes.ok) {
            return res.status(502).json({ error: 'Erro ao postar status', details: evoData });
        }

        res.json({ success: true, data: evoData });
    } catch (error) {
        console.error('Erro ao postar status:', error);
        res.status(500).json({ error: 'Erro ao postar status' });
    }
});

// ===================================================================
// MERGE DE CONVERSAS DUPLICADAS (JID com sufixo de dispositivo)
// ===================================================================

// POST /api/whatsapp/merge-duplicates — Mescla conversas com JID :0 para JID normalizado (admin)
router.post('/merge-duplicates', isAdmin, async (req, res) => {
    try {
        const instances = await prisma.whatsAppInstance.findMany();
        let merged = 0;
        let deleted = 0;
        const log = [];

        for (const instance of instances) {
            // Busca todas as conversas com sufixo de dispositivo no JID (ex: :0@)
            const duplicates = await prisma.whatsAppConversation.findMany({
                where: {
                    instanceId: instance.id,
                    remoteJid: { contains: ':' }
                }
            });

            for (const dup of duplicates) {
                // Normaliza o JID (remove sufixo :0)
                const normalJid = dup.remoteJid.replace(/:\d+@/, '@');
                if (normalJid === dup.remoteJid) continue; // sem mudança

                // Busca a conversa normalizada (se existir)
                const normalConv = await prisma.whatsAppConversation.findUnique({
                    where: { remoteJid_instanceId: { remoteJid: normalJid, instanceId: instance.id } }
                });

                if (normalConv) {
                    // Move mensagens do duplicado para a conversa normal
                    const moved = await prisma.whatsAppMessage.updateMany({
                        where: { conversationId: dup.id },
                        data: { conversationId: normalConv.id }
                    });

                    // Atualiza lastMessageAt e preview na conversa normal
                    const lastMsg = await prisma.whatsAppMessage.findFirst({
                        where: { conversationId: normalConv.id },
                        orderBy: { timestamp: 'desc' }
                    });
                    if (lastMsg) {
                        await prisma.whatsAppConversation.update({
                            where: { id: normalConv.id },
                            data: {
                                lastMessageAt: lastMsg.timestamp,
                                lastMessagePreview: lastMsg.content?.substring(0, 200) || dup.lastMessagePreview
                            }
                        });
                    }

                    // Remove a conversa duplicada
                    await prisma.whatsAppConversation.delete({ where: { id: dup.id } });
                    merged += moved.count;
                    deleted++;
                    log.push(`Merged ${dup.remoteJid} → ${normalJid} (${moved.count} msgs)`);
                } else {
                    // Não existe conversa normalizada: só renomeia o JID
                    await prisma.whatsAppConversation.update({
                        where: { id: dup.id },
                        data: {
                            remoteJid: normalJid,
                            phoneNumber: normalJid.replace(/@s\.whatsapp\.net|@g\.us/g, '')
                        }
                    });
                    log.push(`Renamed ${dup.remoteJid} → ${normalJid}`);
                    merged++;
                }
            }
        }

        res.json({ success: true, merged, deleted, log });
    } catch (error) {
        console.error('Erro ao mesclar duplicatas:', error);
        res.status(500).json({ error: 'Erro ao mesclar duplicatas' });
    }
});

module.exports = router;

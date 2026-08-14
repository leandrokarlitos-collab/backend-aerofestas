/**
 * AlertService — alertas críticos para administradores
 * (Sistema de Segurança de Dados v3 — Aero Festas)
 *
 * sendAdminAlert(title, body): dois canais BEST-EFFORT —
 *   1. E-mail (nodemailer/Gmail) para os usuários isAdmin do banco;
 *   2. Web-push para todas as PushSubscriptions.
 * A falha de um canal NUNCA impede o outro e a função NUNCA lança.
 *
 * checkBackupWatchdog(): verifica se o último backup bem-sucedido tem menos
 * de 26h; caso contrário (ou se nunca houve backup), alerta os admins.
 */

const nodemailer = require('nodemailer');
const prisma = require('../prisma/client');
const webpush = require('../config/webpush');

// Mesmo padrão de routes/admin.js — service gmail + credenciais via env
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

/**
 * Envia um alerta para os administradores por e-mail e web-push.
 * Nunca lança — cada canal é isolado em try/catch próprio.
 * Retorna { email: boolean, push: boolean } indicando o que foi entregue.
 */
async function sendAdminAlert(title, body) {
    const result = { email: false, push: false };

    // --- Canal 1: e-mail para os usuários admin ---
    try {
        if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
            console.warn('[alert] GMAIL_USER/GMAIL_APP_PASSWORD não configurados — canal e-mail pulado');
        } else {
            const admins = await prisma.user.findMany({ where: { isAdmin: true } });
            const emails = admins.map(a => a.email).filter(Boolean);
            if (emails.length === 0) {
                console.warn('[alert] Nenhum usuário admin com e-mail cadastrado — canal e-mail pulado');
            } else {
                await transporter.sendMail({
                    from: `"Aero Festas" <${process.env.GMAIL_USER}>`,
                    to: emails.join(', '),
                    subject: title,
                    text: body
                });
                result.email = true;
            }
        }
    } catch (err) {
        console.error('[alert] Falha no canal e-mail:', err.message);
    }

    // --- Canal 2: web-push ---
    // ATENÇÃO: hoje o campo PushSubscription.userId é SEMPRE null (a rota
    // /api/notifications/subscribe em server.js não vincula usuário), então
    // filtrar subscriptions por admin é impossível — o alerta vai para TODAS
    // as subscriptions registradas. Quando o subscribe passar a gravar o
    // userId, este bloco pode filtrar por admins.
    try {
        const subscriptions = await prisma.pushSubscription.findMany();
        const payload = JSON.stringify({ title, body });

        for (const sub of subscriptions) {
            try {
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payload
                );
                result.push = true;
            } catch (err) {
                if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403) {
                    // Subscription expirada/inválida ou de chave VAPID antiga — remove do banco
                    try {
                        await prisma.pushSubscription.delete({ where: { id: sub.id } });
                    } catch (e) { /* já removida — noop */ }
                } else {
                    // Inclui o caso de VAPID não configurado (config/webpush.js
                    // só seta as chaves via env) — loga sem propagar
                    console.warn('[alert] Web-push falhou:', err.message);
                }
            }
        }
    } catch (err) {
        console.error('[alert] Falha no canal web-push:', err.message);
    }

    console.log(`[alert] "${title}" — email: ${result.email ? 'enviado' : 'não enviado'}, push: ${result.push ? 'enviado' : 'não enviado'}`);
    return result;
}

/** Limite do watchdog: cron diário roda às 03:00 UTC + folga para deploy/restart. */
const WATCHDOG_MAX_HOURS = 26;

/**
 * Watchdog de backup: busca o último BackupRun bem-sucedido (type 'backup').
 * Se não existir ou tiver mais de 26h, dispara sendAdminAlert.
 * Retorna { ok, hoursAgo } (hoursAgo = null se nunca houve backup ou em erro).
 */
async function checkBackupWatchdog() {
    try {
        const last = await prisma.backupRun.findFirst({
            where: { type: 'backup', success: true },
            orderBy: { createdAt: 'desc' }
        });

        if (!last) {
            await sendAdminAlert(
                '🚨 Backup atrasado',
                'Nenhum backup bem-sucedido encontrado no histórico (BackupRun). ' +
                'Verifique o servidor e o cron das 03:00 imediatamente.'
            );
            return { ok: false, hoursAgo: null };
        }

        const hoursAgo = (Date.now() - new Date(last.createdAt).getTime()) / (1000 * 60 * 60);
        const rounded = Math.round(hoursAgo * 10) / 10;

        if (hoursAgo > WATCHDOG_MAX_HOURS) {
            await sendAdminAlert(
                '🚨 Backup atrasado',
                `Último backup bem-sucedido foi há ${rounded}h ` +
                `(${new Date(last.createdAt).toISOString()}) — limite de ${WATCHDOG_MAX_HOURS}h excedido. ` +
                'Verifique o cron das 03:00, o Firebase Storage e os logs do Railway.'
            );
            return { ok: false, hoursAgo: rounded };
        }

        return { ok: true, hoursAgo: rounded };
    } catch (err) {
        console.error('[alert] checkBackupWatchdog falhou:', err.message);
        return { ok: false, hoursAgo: null };
    }
}

/** Limite do watchdog da varredura de licitações: cron roda 1x/dia às 6h BRT,
 *  então 48h sem sucesso = duas execuções seguidas perdidas. */
const VARREDURA_MAX_HOURS = 48;

/**
 * Watchdog da varredura de licitações (PNCP): a tela mostra a data do último
 * sucesso, mas só para quem ABRIR a tela. Se o PNCP (ou o cron) morrer em
 * silêncio, este check avisa os admins ativamente — o mesmo raciocínio do
 * watchdog de backup: robô morto não pode parecer robô sem novidades.
 * Retorna { ok, hoursAgo } (hoursAgo = null se nunca houve sucesso ou em erro).
 */
async function checkVarreduraWatchdog() {
    try {
        // Se nunca houve NENHUMA varredura, o módulo pode simplesmente ainda não
        // ter estreado — não alarma; o alarme é para robô que JÁ funcionou e parou.
        const total = await prisma.licitacaoVarredura.count();
        if (total === 0) return { ok: true, hoursAgo: null };

        const last = await prisma.licitacaoVarredura.findFirst({
            where: { status: 'sucesso' },
            orderBy: { concluidoEm: 'desc' }
        });

        if (!last) {
            await sendAdminAlert(
                '🚨 Varredura de licitações nunca concluiu',
                `Há ${total} tentativa(s) de varredura do PNCP registradas e NENHUMA completa com sucesso. ` +
                'O PNCP pode estar fora do ar há dias — os editais da tela de Prospecção podem estar desatualizados. ' +
                'Abra a Prospecção e use "Buscar novas licitações" para testar.'
            );
            return { ok: false, hoursAgo: null };
        }

        const hoursAgo = (Date.now() - new Date(last.concluidoEm).getTime()) / (1000 * 60 * 60);
        const rounded = Math.round(hoursAgo * 10) / 10;

        if (hoursAgo > VARREDURA_MAX_HOURS) {
            await sendAdminAlert(
                '🚨 Varredura de licitações atrasada',
                `A última varredura bem-sucedida do PNCP foi há ${rounded}h ` +
                `(${new Date(last.concluidoEm).toLocaleString('pt-BR')}) — limite de ${VARREDURA_MAX_HOURS}h excedido. ` +
                'Sem varredura, edital novo NÃO aparece e a ausência de licitações na tela vira silêncio enganoso. ' +
                'Verifique os logs do Railway e o estado do PNCP (pncp.gov.br).'
            );
            return { ok: false, hoursAgo: rounded };
        }

        return { ok: true, hoursAgo: rounded };
    } catch (err) {
        console.error('[alert] checkVarreduraWatchdog falhou:', err.message);
        return { ok: false, hoursAgo: null };
    }
}

module.exports = { sendAdminAlert, checkBackupWatchdog, checkVarreduraWatchdog };

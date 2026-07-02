const webpush = require('web-push');

// Chaves VAPID exclusivamente via variáveis de ambiente — nunca commitar chaves aqui.
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webpush.setVapidDetails(
        'mailto:contato@aerofestas.com.br',
        VAPID_PUBLIC,
        VAPID_PRIVATE
    );
} else {
    console.warn('[webpush] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não definidas — notificações push desabilitadas.');
}

module.exports = webpush;

const webpush = require('web-push');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BIiU_AzAKYphDuzGTCEy-tvcZGZtEjdaW4JZZ3WVGJYOrDJ4hjpmOmA_yOD_R4O_n1N8RrTm190cLPd10grA4g0';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'Gyay8GSr9huvXx-5OGG1YTp18j28I9PpBg33ORBfs6Y';

webpush.setVapidDetails(
    'mailto:contato@aerofestas.com.br',
    VAPID_PUBLIC,
    VAPID_PRIVATE
);

module.exports = webpush;

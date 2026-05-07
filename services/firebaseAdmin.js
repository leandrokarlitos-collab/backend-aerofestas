/**
 * Inicialização do Firebase Admin para upload de imagens ao Storage.
 *
 * Variáveis de ambiente esperadas (configurar no Railway):
 *   - FIREBASE_SERVICE_ACCOUNT_JSON  → conteúdo completo do JSON da service account, em uma única linha
 *   - FIREBASE_STORAGE_BUCKET        → ex.: "agenda-aero-festas.appspot.com"
 *                                       ou   "agenda-aero-festas.firebasestorage.app"
 *
 * Se FIREBASE_SERVICE_ACCOUNT_JSON não estiver setada, o módulo loga um warning
 * mas NÃO derruba o servidor — apenas falha as rotas que dependem dele.
 */

const admin = require('firebase-admin');

let bucket = null;
let initError = null;

function init() {
    if (admin.apps.length) {
        bucket = admin.storage().bucket();
        return;
    }

    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET;

    if (!json) {
        initError = 'FIREBASE_SERVICE_ACCOUNT_JSON não definida — uploads de foto desabilitados';
        console.warn('[firebaseAdmin] ' + initError);
        return;
    }
    if (!bucketName) {
        initError = 'FIREBASE_STORAGE_BUCKET não definida — uploads de foto desabilitados';
        console.warn('[firebaseAdmin] ' + initError);
        return;
    }

    let credentials;
    try {
        credentials = JSON.parse(json);
        // Railway pode "escapar" o \n do private_key — desfaz se necessário
        if (credentials.private_key && credentials.private_key.includes('\\n')) {
            credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
        }
    } catch (err) {
        initError = 'FIREBASE_SERVICE_ACCOUNT_JSON inválida (não é JSON válido): ' + err.message;
        console.error('[firebaseAdmin] ' + initError);
        return;
    }

    try {
        admin.initializeApp({
            credential: admin.credential.cert(credentials),
            storageBucket: bucketName
        });
        bucket = admin.storage().bucket();
        console.log('[firebaseAdmin] inicializado, bucket:', bucketName);
    } catch (err) {
        initError = 'Falha ao inicializar firebase-admin: ' + err.message;
        console.error('[firebaseAdmin] ' + initError);
    }
}

init();

function getBucket() {
    if (!bucket) {
        const err = new Error(initError || 'Firebase Storage não configurado no servidor');
        err.status = 503;
        throw err;
    }
    return bucket;
}

module.exports = { getBucket, isReady: () => !!bucket };

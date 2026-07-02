/**
 * BackupService — Sistema de Segurança de Dados v3 (Aero Festas)
 *
 * Backup lógico completo do banco (31 de 32 modelos; só WhatsAppStatus fica
 * de fora — conteúdo efêmero de 24h) em formato FLAT v2:
 *   { metadata: { schemaVersion, timestamp, counts, checksum, ... },
 *     tables: { Toy: [...], Client: [...], ... } }
 *
 * Armazenamento durável: Firebase Storage (bucket já usado para fotos/contratos),
 * gzip nível 9, retenção GFS (30 diários / 24 mensais / anuais para sempre),
 * verificação de integridade pós-upload (re-download + sha256) e status
 * persistido na tabela BackupRun (sobrevive a restart/deploy do Railway).
 *
 * Fallback: sem bucket configurado, grava em backups/ local (efêmero no
 * Railway — marcado como durable:false e alertado).
 *
 * Criptografia opcional (LGPD): se BACKUP_ENCRYPTION_KEY (64 hex chars =
 * 32 bytes) estiver setada, aplica AES-256-GCM sobre o gzip → .json.gz.enc
 * (arquivo = IV 12B + authTag 16B + ciphertext).
 *
 * A ordem de TABLES é a ordem TOPOLÓGICA de FKs — o restore insere nessa
 * ordem para nunca violar constraint. scripts/restore.js importa daqui.
 */

const zlib = require('zlib');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');
const firebaseAdmin = require('./firebaseAdmin');

// ---------------------------------------------------------------------------
// Constantes compartilhadas com scripts/restore.js
// ---------------------------------------------------------------------------

/**
 * Modelo → delegate do Prisma Client, em ORDEM TOPOLÓGICA de FKs.
 * Nível 0: sem FK de saída. Nível 1: FKs só para nível 0. Nível 2: idem.
 */
const TABLES = [
    // --- Nível 0 ---
    { model: 'Toy', delegate: 'toy' },
    { model: 'Client', delegate: 'client' },
    { model: 'Company', delegate: 'company' },
    { model: 'User', delegate: 'user' },
    { model: 'Monitor', delegate: 'monitor' },
    { model: 'Funcionario', delegate: 'funcionario' },
    { model: 'FaixaComissao', delegate: 'faixaComissao' },
    { model: 'BankAccount', delegate: 'bankAccount' },
    { model: 'FixedExpense', delegate: 'fixedExpense' },
    { model: 'ExpenseCategory', delegate: 'expenseCategory' },
    { model: 'FixedExpenseCategory', delegate: 'fixedExpenseCategory' },
    { model: 'PropostaTemplate', delegate: 'propostaTemplate' },
    { model: 'WhatsAppInstance', delegate: 'whatsAppInstance' },
    // --- Nível 1 ---
    { model: 'Event', delegate: 'event' },                    // → Company
    { model: 'ToyUnit', delegate: 'toyUnit' },                // → Toy
    { model: 'ToyMaintenance', delegate: 'toyMaintenance' },  // → Toy, Monitor
    { model: 'Task', delegate: 'task' },                      // → User
    { model: 'DailyPlan', delegate: 'dailyPlan' },            // → User
    { model: 'PushSubscription', delegate: 'pushSubscription' }, // → User
    { model: 'Transaction', delegate: 'transaction' },        // → BankAccount
    { model: 'Desempenho', delegate: 'desempenho' },          // → Monitor
    { model: 'PagamentoMonitor', delegate: 'pagamentoMonitor' }, // → Monitor
    { model: 'Proposta', delegate: 'proposta' },              // → Client, PropostaTemplate
    { model: 'WhatsAppConversation', delegate: 'whatsAppConversation' }, // → Client, Instance
    { model: 'WhatsAppShortcut', delegate: 'whatsAppShortcut' },         // → Instance
    // --- Nível 2 ---
    { model: 'EventItem', delegate: 'eventItem' },            // → Event, Toy
    { model: 'EventExternalRental', delegate: 'eventExternalRental' }, // → Event
    { model: 'ToyPhoto', delegate: 'toyPhoto' },              // → Toy, Event
    { model: 'PropostaItem', delegate: 'propostaItem' },      // → Proposta, Toy
    { model: 'WhatsAppMessage', delegate: 'whatsAppMessage' },// → Conversation
    // --- Sem FK (auditoria por último: volumosa e independente) ---
    { model: 'AuditLog', delegate: 'auditLog' },
];

/** Tabelas com id Int autoincrement — sequences precisam de setval() pós-restore. */
const AUTOINCREMENT_TABLES = [
    'ToyMaintenance', 'ToyUnit', 'ToyPhoto', 'EventExternalRental', 'EventItem', 'PropostaItem',
];

const SCHEMA_VERSION = '2.0';
const STORAGE_PREFIX = 'backups';
const DAILY_KEEP = 30;
const MONTHLY_KEEP = 24;

// Fallback local (comportamento legado — efêmero no Railway)
const LOCAL_BACKUP_DIR = path.join(__dirname, '..', 'backups');
const LOCAL_MAX_BACKUPS = 7;

// ---------------------------------------------------------------------------
// Coleta v2 (tabelas flat, FKs intactas)
// ---------------------------------------------------------------------------

async function collectAllData(options = {}) {
    const tables = {};
    const counts = {};
    let totalRecords = 0;

    for (const { model, delegate } of TABLES) {
        if (options.skipAudit && model === 'AuditLog') {
            tables[model] = [];
            counts[model] = 0;
            continue;
        }
        const rows = await prisma[delegate].findMany();
        tables[model] = rows;
        counts[model] = rows.length;
        totalRecords += rows.length;
    }

    const checksum = sha256(canonicalTablesJson(tables));

    return {
        metadata: {
            schemaVersion: SCHEMA_VERSION,
            timestamp: new Date().toISOString(),
            source: options.source || 'manual',
            counts,
            totalRecords,
            checksum,
            excluded: ['WhatsAppStatus', 'BackupRun'],
        },
        tables,
    };
}

function canonicalTablesJson(tables) {
    // JSON canônico: ordem fixa de tabelas (a de TABLES) — o checksum é estável
    const ordered = {};
    for (const { model } of TABLES) {
        if (tables[model] !== undefined) ordered[model] = tables[model];
    }
    return JSON.stringify(ordered);
}

function sha256(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

// ---------------------------------------------------------------------------
// Criptografia opcional (AES-256-GCM)
// ---------------------------------------------------------------------------

function getEncryptionKey() {
    const hex = process.env.BACKUP_ENCRYPTION_KEY;
    if (!hex) return null;
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
        console.warn('[backup] BACKUP_ENCRYPTION_KEY inválida (esperado 64 hex chars) — criptografia desativada');
        return null;
    }
    return Buffer.from(hex, 'hex');
}

function encrypt(buffer, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decrypt(buffer, key) {
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const data = buffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Decodifica um buffer de backup (.json.gz ou .json.gz.enc ou .json puro). */
function decodeBackupBuffer(buffer, filename) {
    let buf = buffer;
    if (filename.endsWith('.enc')) {
        const key = getEncryptionKey();
        if (!key) throw new Error('Backup criptografado, mas BACKUP_ENCRYPTION_KEY não está setada');
        buf = decrypt(buf, key);
    }
    if (filename.includes('.gz')) {
        buf = zlib.gunzipSync(buf);
    }
    return JSON.parse(buf.toString('utf-8'));
}

// ---------------------------------------------------------------------------
// Execução do backup
// ---------------------------------------------------------------------------

function backupFilename(now) {
    const ts = (now || new Date()).toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
    const key = getEncryptionKey();
    return `aero-backup-${ts}.json.gz` + (key ? '.enc' : '');
}

/**
 * Executa o backup completo: coleta → gzip (→ cripto) → upload/local →
 * verificação → retenção GFS → BackupRun → alerta em falha.
 */
async function runBackup(source = 'manual') {
    const started = Date.now();
    let run = {
        type: 'backup',
        source,
        success: false,
        message: null,
        totalRecords: 0,
        counts: null,
        sizeBytes: 0,
        checksum: null,
        storagePath: null,
        durable: false,
        verified: false,
        durationMs: 0,
    };

    try {
        console.log(`📦 [backup] Iniciando backup (${source})...`);
        const data = await collectAllData({ source });
        run.totalRecords = data.metadata.totalRecords;
        run.counts = JSON.stringify(data.metadata.counts);
        run.checksum = data.metadata.checksum;

        const json = JSON.stringify(data);
        let payload = zlib.gzipSync(Buffer.from(json, 'utf-8'), { level: 9 });
        const key = getEncryptionKey();
        if (key) payload = encrypt(payload, key);
        run.sizeBytes = payload.length;

        const filename = backupFilename();

        if (firebaseAdmin.isReady()) {
            const storagePath = `${STORAGE_PREFIX}/daily/${filename}`;
            const bucket = firebaseAdmin.getBucket();
            const file = bucket.file(storagePath);

            // Upload com retry: o token OAuth/upload pode falhar transitoriamente
            // (rede do Railway) — 3 tentativas com 8s de espaço
            await comRetry(() => file.save(payload, {
                resumable: false,
                contentType: 'application/gzip',
                metadata: {
                    metadata: {
                        checksum: data.metadata.checksum,
                        totalRecords: String(data.metadata.totalRecords),
                        schemaVersion: SCHEMA_VERSION,
                        source,
                        encrypted: key ? 'true' : 'false',
                    },
                },
            }), 3, 8000);
            run.storagePath = storagePath;
            run.durable = true;

            // Verificação de integridade: re-download + sha256
            run.verified = await verifyBackup(storagePath, data.metadata.checksum);
            if (!run.verified) {
                throw new Error(`Verificação de integridade FALHOU para ${storagePath}`);
            }

            // Retenção GFS (promoção mensal/anual + limpeza) — best effort
            try {
                await applyRetention(storagePath, filename);
            } catch (err) {
                console.warn('[backup] Retenção GFS falhou (não fatal):', err.message);
            }

            run.success = true;
            run.message = `Backup salvo no Storage: ${storagePath} (${(payload.length / 1024).toFixed(1)} KB, ${run.totalRecords} registros, verificado)`;
        } else {
            // Fallback local — efêmero no Railway
            saveLocalBackup(filename, payload);
            run.success = true;
            run.durable = false;
            run.verified = false;
            run.message = 'ATENÇÃO: Firebase Storage não configurado — backup salvo apenas no filesystem local (NÃO sobrevive a deploy/restart do Railway)';
            console.warn('⚠️ [backup] ' + run.message);
        }
    } catch (error) {
        run.success = false;
        run.message = `Erro no backup: ${error.message}`;
        console.error('❌ [backup]', error);
    }

    run.durationMs = Date.now() - started;

    // Persiste o BackupRun (sobrevive a restart) — falha aqui não derruba nada
    let saved = null;
    try {
        saved = await prisma.backupRun.create({ data: run });
    } catch (err) {
        console.error('[backup] Falha ao persistir BackupRun:', err.message);
    }

    // Espelho status.json no bucket (fallback extremo de leitura) — best effort
    if (firebaseAdmin.isReady()) {
        try {
            await firebaseAdmin.getBucket().file(`${STORAGE_PREFIX}/status.json`).save(
                JSON.stringify({ ...run, createdAt: new Date().toISOString() }, null, 2),
                { resumable: false, contentType: 'application/json' }
            );
        } catch (e) { /* silencioso */ }
    }

    // Alertas: falha ou modo degradado
    if (!run.success || !run.durable) {
        try {
            const { sendAdminAlert } = require('./AlertService');
            const title = run.success ? '⚠️ Backup em modo degradado' : '🚨 Falha no backup';
            await sendAdminAlert(title, run.message);
        } catch (err) {
            console.warn('[backup] Alerta não enviado:', err.message);
        }
    }

    if (run.success) {
        console.log(`✅ [backup] ${run.message} (${run.durationMs}ms)`);
    }

    return toStatusShape(saved || { ...run, createdAt: new Date() });
}

/** Executa fn com até N tentativas, esperando esperaMs entre elas. */
async function comRetry(fn, tentativas, esperaMs) {
    let ultimoErro;
    for (let t = 1; t <= tentativas; t++) {
        try {
            return await fn();
        } catch (err) {
            ultimoErro = err;
            if (t < tentativas) {
                console.warn(`[backup] Tentativa ${t}/${tentativas} falhou (${err.message}) — nova tentativa em ${esperaMs / 1000}s`);
                await new Promise(r => setTimeout(r, esperaMs));
            }
        }
    }
    throw ultimoErro;
}

/** Formata BackupRun no shape legado esperado pelo frontend (Dashboard). */
function toStatusShape(run) {
    if (!run) return { success: null, timestamp: null, message: null, recordCount: 0 };
    return {
        success: run.success,
        timestamp: run.createdAt instanceof Date ? run.createdAt.toISOString() : run.createdAt,
        message: run.message,
        recordCount: run.totalRecords || 0,
        // Campos novos (aditivos — o frontend legado ignora)
        type: run.type,
        source: run.source,
        durable: run.durable,
        verified: run.verified,
        storagePath: run.storagePath,
        sizeBytes: run.sizeBytes,
        durationMs: run.durationMs,
        counts: run.counts ? safeParse(run.counts) : null,
    };
}

function safeParse(str) {
    try { return JSON.parse(str); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Verificação de integridade
// ---------------------------------------------------------------------------

async function verifyBackup(storagePath, expectedChecksum) {
    try {
        const bucket = firebaseAdmin.getBucket();
        const [buffer] = await bucket.file(storagePath).download();
        const data = decodeBackupBuffer(buffer, storagePath);
        const actual = sha256(canonicalTablesJson(data.tables));
        const expected = expectedChecksum || (data.metadata && data.metadata.checksum);
        return actual === expected;
    } catch (err) {
        console.error('[backup] verifyBackup falhou:', err.message);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Retenção GFS
// ---------------------------------------------------------------------------

async function applyRetention(dailyPath, filename) {
    const bucket = firebaseAdmin.getBucket();
    const now = new Date();
    const monthPrefix = `aero-backup-${now.toISOString().slice(0, 7)}`; // aero-backup-YYYY-MM
    const yearPrefix = `aero-backup-${now.toISOString().slice(0, 4)}`;  // aero-backup-YYYY

    // Promoção mensal: 1ª cópia do mês
    const [monthlyFiles] = await bucket.getFiles({ prefix: `${STORAGE_PREFIX}/monthly/${monthPrefix}` });
    if (monthlyFiles.length === 0) {
        await bucket.file(dailyPath).copy(bucket.file(`${STORAGE_PREFIX}/monthly/${filename}`));
        console.log(`[backup] Promovido para monthly/: ${filename}`);
    }

    // Promoção anual: 1ª cópia do ano
    const [yearlyFiles] = await bucket.getFiles({ prefix: `${STORAGE_PREFIX}/yearly/${yearPrefix}` });
    if (yearlyFiles.length === 0) {
        await bucket.file(dailyPath).copy(bucket.file(`${STORAGE_PREFIX}/yearly/${filename}`));
        console.log(`[backup] Promovido para yearly/: ${filename}`);
    }

    // Limpeza: mantém os N mais recentes (nomes ISO ordenam lexicograficamente)
    await cleanupPrefix(`${STORAGE_PREFIX}/daily/`, DAILY_KEEP);
    await cleanupPrefix(`${STORAGE_PREFIX}/monthly/`, MONTHLY_KEEP);
}

async function cleanupPrefix(prefix, keep) {
    const bucket = firebaseAdmin.getBucket();
    const [files] = await bucket.getFiles({ prefix });
    const backups = files
        .filter(f => f.name.includes('aero-backup-'))
        .sort((a, b) => b.name.localeCompare(a.name)); // mais recente primeiro
    for (const old of backups.slice(keep)) {
        try {
            await old.delete();
            console.log(`[backup] Retenção: removido ${old.name}`);
        } catch (err) {
            console.warn(`[backup] Falha ao remover ${old.name}:`, err.message);
        }
    }
}

// ---------------------------------------------------------------------------
// Fallback local (legado)
// ---------------------------------------------------------------------------

function saveLocalBackup(filename, payload) {
    if (!fs.existsSync(LOCAL_BACKUP_DIR)) {
        fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(LOCAL_BACKUP_DIR, filename), payload);

    const files = fs.readdirSync(LOCAL_BACKUP_DIR)
        .filter(f => f.startsWith('aero-backup-') || f.startsWith('backup-'))
        .sort()
        .reverse();
    for (const old of files.slice(LOCAL_MAX_BACKUPS)) {
        try { fs.unlinkSync(path.join(LOCAL_BACKUP_DIR, old)); } catch { /* noop */ }
    }
}

// ---------------------------------------------------------------------------
// Consulta (status, histórico, listagem, download)
// ---------------------------------------------------------------------------

async function getStatus() {
    const last = await prisma.backupRun.findFirst({
        where: { type: 'backup' },
        orderBy: { createdAt: 'desc' },
    });
    return toStatusShape(last);
}

async function getHistory(limit = 30) {
    const runs = await prisma.backupRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(limit) || 30, 100),
    });
    return runs.map(toStatusShape);
}

/** Lista os objetos de backup no bucket (daily/monthly/yearly). */
async function listBackups() {
    if (!firebaseAdmin.isReady()) return { durable: false, files: [] };
    const bucket = firebaseAdmin.getBucket();
    const [files] = await bucket.getFiles({ prefix: `${STORAGE_PREFIX}/` });
    return {
        durable: true,
        files: files
            .filter(f => f.name.includes('aero-backup-'))
            .map(f => ({
                path: f.name,
                tier: f.name.split('/')[1], // daily | monthly | yearly
                sizeBytes: Number(f.metadata.size || 0),
                updated: f.metadata.updated,
                totalRecords: f.metadata.metadata ? Number(f.metadata.metadata.totalRecords || 0) : null,
                checksum: f.metadata.metadata ? f.metadata.metadata.checksum : null,
                encrypted: f.metadata.metadata ? f.metadata.metadata.encrypted === 'true' : false,
            }))
            .sort((a, b) => b.path.localeCompare(a.path)),
    };
}

/** Signed URL de 15 minutos — backup é dado sensível, nunca makePublic(). */
async function getDownloadUrl(storagePath) {
    if (!storagePath || !storagePath.startsWith(`${STORAGE_PREFIX}/`) || storagePath.includes('..')) {
        const err = new Error('Caminho de backup inválido');
        err.status = 400;
        throw err;
    }
    const bucket = firebaseAdmin.getBucket();
    const [url] = await bucket.file(storagePath).getSignedUrl({
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000,
    });
    return url;
}

/** Baixa e decodifica um backup do bucket (usado pelo restore --from-storage). */
async function downloadBackup(storagePath) {
    if (!storagePath || !storagePath.startsWith(`${STORAGE_PREFIX}/`) || storagePath.includes('..')) {
        const err = new Error('Caminho de backup inválido');
        err.status = 400;
        throw err;
    }
    const bucket = firebaseAdmin.getBucket();
    const [buffer] = await bucket.file(storagePath).download();
    return decodeBackupBuffer(buffer, storagePath);
}

/** Resolve "latest" para o daily mais recente do bucket. */
async function resolveLatestPath() {
    const { files } = await listBackups();
    const daily = files.filter(f => f.tier === 'daily');
    if (!daily.length) throw new Error('Nenhum backup encontrado no bucket');
    return daily[0].path;
}

module.exports = {
    TABLES,
    AUTOINCREMENT_TABLES,
    SCHEMA_VERSION,
    collectAllData,
    canonicalTablesJson,
    sha256,
    runBackup,
    verifyBackup,
    getStatus,
    getHistory,
    listBackups,
    getDownloadUrl,
    downloadBackup,
    resolveLatestPath,
    decodeBackupBuffer,
    toStatusShape,
};

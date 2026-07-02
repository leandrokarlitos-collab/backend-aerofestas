#!/usr/bin/env node
/**
 * scripts/restore.js — CLI de restauração de backups (Sistema de Segurança de Dados v3)
 *
 * USO:
 *   node scripts/restore.js --file ./backup.json.gz                      (dry-run — DEFAULT)
 *   node scripts/restore.js --file ./backup.json.gz --mode empty-only --yes
 *   node scripts/restore.js --file ./backup.json.gz --mode upsert --tables Event,Transaction
 *   node scripts/restore.js --from-storage latest --mode empty-only --yes
 *   node scripts/restore.js --from-storage backups/monthly/aero-backup-2026-06-01T03-00-00Z.json.gz
 *   node scripts/restore.js --record-drill "Drill trimestral OK — 385 registros"
 *
 * FLAGS:
 *   --file <caminho>          Backup local (.json | .json.gz | .json.gz.enc)
 *   --from-storage <p|latest> Backup do Firebase Storage (exige FIREBASE_SERVICE_ACCOUNT_JSON)
 *   --mode empty-only|upsert  Sem --mode → dry-run (NENHUMA escrita)
 *   --dry-run                 Força dry-run mesmo com --mode
 *   --tables A,B              Restaura só o subconjunto (+ dependências, fechadas automaticamente)
 *   --yes                     Pula a confirmação interativa (NÃO pula a trava de produção)
 *   --allow-production        Obrigatório se o host da DATABASE_URL for Railway (railway|rlwy.net)
 *   --skip-checksum           Pula validação de integridade (necessário para backups v1 legados)
 *   --record-drill "msg"      Grava BackupRun {type:'drill', success:true} no banco atual e sai
 *
 * SEGURANÇA:
 *   - Este script NUNCA executa DELETE/TRUNCATE/reset — só INSERT (createMany) e UPSERT.
 *   - empty-only exige que TODAS as tabelas-alvo estejam vazias no banco antes de escrever.
 *   - Banco de produção (Railway) exige --allow-production + digitar o nome do database.
 *
 * FORMATOS ACEITOS:
 *   v2 (atual): { metadata: {schemaVersion:'2.0', checksum, counts, ...}, tables: {Toy:[...], ...} }
 *   v1 (legado): { metadata: {version:'1.0'}, eventos, clientes, ... } — convertido para v2 em memória
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');
const readline = require('readline');

const BackupService = require('../services/BackupService');
const { TABLES, AUTOINCREMENT_TABLES, canonicalTablesJson, sha256 } = BackupService;
const prisma = require('../prisma/client');

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const LOTE_CREATE = 500;   // createMany (empty-only)
const LOTE_UPSERT = 100;   // upsert dentro de $transaction
const HOSTS_PRODUCAO = ['railway', 'rlwy.net'];

/** Mapa explícito de dependências de FK — usado para fechar o subconjunto de --tables. */
const DEPENDENCIAS = {
    Event: ['Company'],
    EventItem: ['Event', 'Toy'],
    ToyUnit: ['Toy'],
    ToyMaintenance: ['Toy', 'Monitor'],
    ToyPhoto: ['Toy', 'Event'],
    EventExternalRental: ['Event'],
    Task: ['User'],
    DailyPlan: ['User'],
    PushSubscription: ['User'],
    Transaction: ['BankAccount'],
    Desempenho: ['Monitor'],
    PagamentoMonitor: ['Monitor'],
    Proposta: ['Client', 'PropostaTemplate'],
    PropostaItem: ['Proposta', 'Toy'],
    WhatsAppConversation: ['Client', 'WhatsAppInstance'],
    WhatsAppShortcut: ['WhatsAppInstance'],
    WhatsAppMessage: ['WhatsAppConversation'],
};

/** Chave do backup v1 legado → modelo v2. */
const V1_PARA_V2 = {
    eventos: 'Event',
    clientes: 'Client',
    empresas: 'Company',
    brinquedos: 'Toy',
    monitores: 'Monitor',
    transacoes: 'Transaction',
    contasBancarias: 'BankAccount',
    contasFixas: 'FixedExpense',
    funcionarios: 'Funcionario',
    faixasComissao: 'FaixaComissao',
    tarefas: 'Task',
    planosDiarios: 'DailyPlan',
    categoriasGastos: 'ExpenseCategory',
    categoriasFixas: 'FixedExpenseCategory',
};

// Campos escalares válidos por modelo (via DMMF do Prisma Client) — remove campos
// aninhados/obsoletos de backups antigos antes de escrever. Se o DMMF não estiver
// disponível nesta versão do Prisma, segue sem filtro (os erros caem no fallback).
const CAMPOS_VALIDOS = {};
try {
    const { Prisma } = require('@prisma/client');
    for (const m of Prisma.dmmf.datamodel.models) {
        CAMPOS_VALIDOS[m.name] = new Set(m.fields.filter(f => f.kind !== 'object').map(f => f.name));
    }
} catch { /* sem DMMF — filtro desativado */ }

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

class ErroFatal extends Error {}

function fatal(msg) {
    throw new ErroFatal(msg);
}

function pad(str, len) {
    str = String(str);
    return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function padEsq(str, len) {
    str = String(str);
    return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

function fmtDuracao(ms) {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function resumirErro(msg) {
    return String(msg || '').replace(/\s+/g, ' ').slice(0, 160);
}

/** Pergunta interativa via readline (retorna a resposta trimada). */
function perguntar(texto) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(texto, (resp) => {
            rl.close();
            resolve((resp || '').trim());
        });
    });
}

/** Extrai host/database da DATABASE_URL com a senha mascarada. */
function infoBanco() {
    const url = process.env.DATABASE_URL || '';
    if (!url) fatal('DATABASE_URL não está definida. Defina-a antes de rodar o restore.');
    try {
        const u = new URL(url);
        const usuario = u.username || '(sem usuário)';
        const porta = u.port ? `:${u.port}` : '';
        return {
            host: u.hostname,
            database: u.pathname.replace(/^\//, '').split('?')[0],
            mascarada: `${u.protocol}//${usuario}:****@${u.hostname}${porta}${u.pathname}`,
        };
    } catch {
        fatal('DATABASE_URL inválida (não foi possível interpretar a URL).');
    }
}

/** Remove campos que não existem no modelo (relações aninhadas, colunas obsoletas). */
function limparLinha(model, row, removidosPorModelo) {
    const validos = CAMPOS_VALIDOS[model];
    if (!validos) return row;
    const limpo = {};
    for (const [k, v] of Object.entries(row)) {
        if (validos.has(k)) {
            limpo[k] = v;
        } else {
            removidosPorModelo[model] = removidosPorModelo[model] || new Set();
            removidosPorModelo[model].add(k);
        }
    }
    return limpo;
}

// ---------------------------------------------------------------------------
// Parse de argumentos
// ---------------------------------------------------------------------------

function ajuda() {
    console.log(`
Restore CLI — Aero Festas (Sistema de Segurança de Dados v3)

  node scripts/restore.js --file ./backup.json.gz                        dry-run (default)
  node scripts/restore.js --file ./backup.json.gz --mode empty-only --yes
  node scripts/restore.js --from-storage latest --mode empty-only --yes
  node scripts/restore.js --from-storage backups/monthly/arquivo.json.gz
  node scripts/restore.js --record-drill "mensagem"

Flags: --file, --from-storage, --mode empty-only|upsert, --dry-run, --tables A,B,
       --yes, --allow-production, --skip-checksum, --record-drill, --help
`);
}

function parseArgs(argv) {
    const args = {
        file: null, fromStorage: null, recordDrill: null,
        mode: null, dryRun: false, tables: null,
        yes: false, allowProduction: false, skipChecksum: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case '--file':             args.file = argv[++i]; break;
            case '--from-storage':     args.fromStorage = argv[++i]; break;
            case '--record-drill': {
                // não engolir a próxima flag como mensagem (ex.: --record-drill --yes)
                const prox = argv[i + 1];
                args.recordDrill = (prox && !prox.startsWith('--')) ? argv[++i] : 'Drill de restauração executado';
                break;
            }
            case '--mode':             args.mode = argv[++i]; break;
            case '--dry-run':          args.dryRun = true; break;
            case '--tables':           args.tables = argv[++i]; break;
            case '--yes':              args.yes = true; break;
            case '--allow-production': args.allowProduction = true; break;
            case '--skip-checksum':    args.skipChecksum = true; break;
            case '--help': case '-h':  ajuda(); process.exit(0); break;
            default: fatal(`Argumento desconhecido: ${a} (use --help)`);
        }
    }

    if (args.recordDrill === null) {
        if (!args.file && !args.fromStorage) {
            fatal('Informe a origem do backup: --file <caminho> ou --from-storage <caminho|latest>. Use --help.');
        }
        if (args.file && args.fromStorage) {
            fatal('Use --file OU --from-storage, não ambos.');
        }
        if (args.mode && !['empty-only', 'upsert'].includes(args.mode)) {
            fatal(`Modo inválido: "${args.mode}". Use --mode empty-only ou --mode upsert.`);
        }
    }

    // Sem --mode → dry-run é o DEFAULT. --dry-run força mesmo com --mode.
    args.dryRun = args.dryRun || !args.mode;
    return args;
}

// ---------------------------------------------------------------------------
// Carregamento e detecção de formato
// ---------------------------------------------------------------------------

async function carregarBackup(args) {
    if (args.file) {
        const caminho = path.resolve(process.cwd(), args.file);
        if (!fs.existsSync(caminho)) fatal(`Arquivo não encontrado: ${caminho}`);
        console.log(`📂 Lendo arquivo local: ${caminho}`);
        const buffer = fs.readFileSync(caminho);
        return { data: BackupService.decodeBackupBuffer(buffer, path.basename(caminho)), origem: caminho };
    }

    // --from-storage: exige Firebase Admin configurado
    const firebaseAdmin = require('../services/firebaseAdmin');
    if (!firebaseAdmin.isReady()) {
        fatal('Firebase Storage não configurado. Defina FIREBASE_SERVICE_ACCOUNT_JSON e ' +
              'FIREBASE_STORAGE_BUCKET no ambiente (as mesmas variáveis do backend no Railway) ' +
              'para usar --from-storage. Alternativa: baixe o arquivo e use --file.');
    }
    let storagePath = args.fromStorage;
    if (storagePath === 'latest') {
        storagePath = await BackupService.resolveLatestPath();
        console.log(`☁️  "latest" resolvido para: ${storagePath}`);
    }
    console.log(`☁️  Baixando do Storage: ${storagePath}`);
    return { data: await BackupService.downloadBackup(storagePath), origem: `storage:${storagePath}` };
}

function detectarFormato(data) {
    if (data && data.metadata && data.metadata.schemaVersion === '2.0' && data.tables) return 'v2';
    if (data && ((data.metadata && data.metadata.version === '1.0') || data.eventos || data.clientes)) return 'v1';
    return null;
}

/**
 * Converte o backup v1 legado (chaves em pt-br, Event.items e Monitor.desempenho/
 * pagamentos aninhados) para o shape flat v2. Tabelas ausentes no v1 ficam vazias.
 */
function converterV1(data) {
    const tables = {};
    for (const { model } of TABLES) tables[model] = [];

    for (const [chaveV1, model] of Object.entries(V1_PARA_V2)) {
        tables[model] = Array.isArray(data[chaveV1]) ? data[chaveV1] : [];
    }

    // Event: extrai items aninhados → EventItem (removendo o toy aninhado de cada item)
    tables.Event = tables.Event.map((ev) => {
        const { items, company, toyPhotos, externalRentals, ...flat } = ev;
        if (Array.isArray(items)) {
            for (const item of items) {
                const { toy, event, ...itemFlat } = item;
                tables.EventItem.push(itemFlat);
            }
        }
        return flat;
    });

    // Monitor: extrai desempenho → Desempenho e pagamentos → PagamentoMonitor
    tables.Monitor = tables.Monitor.map((m) => {
        const { desempenho, pagamentos, manutencoes, ...flat } = m;
        if (Array.isArray(desempenho)) {
            for (const d of desempenho) { const { monitor, ...df } = d; tables.Desempenho.push(df); }
        }
        if (Array.isArray(pagamentos)) {
            for (const p of pagamentos) { const { monitor, ...pf } = p; tables.PagamentoMonitor.push(pf); }
        }
        return flat;
    });

    // Transaction: remove relação account se veio aninhada
    tables.Transaction = tables.Transaction.map((t) => { const { account, ...flat } = t; return flat; });

    console.log('🔄 Backup v1 legado convertido para o formato v2 (tabelas ausentes ficam vazias).');
    return tables;
}

// ---------------------------------------------------------------------------
// Seleção de tabelas (--tables) + fechamento de dependências
// ---------------------------------------------------------------------------

function resolverSelecao(tablesArg) {
    const todos = TABLES.map(t => t.model);
    if (!tablesArg) return { selecao: new Set(todos), adicionadas: [] };

    const pedidos = tablesArg.split(',').map(s => s.trim()).filter(Boolean);
    const selecao = new Set();
    for (const pedido of pedidos) {
        const model = todos.find(m => m.toLowerCase() === pedido.toLowerCase());
        if (!model) fatal(`Tabela desconhecida em --tables: "${pedido}". Válidas: ${todos.join(', ')}`);
        selecao.add(model);
    }

    // Fecha dependências transitivamente (ex.: EventItem → Event → Company)
    const adicionadas = [];
    let mudou = true;
    while (mudou) {
        mudou = false;
        for (const m of [...selecao]) {
            for (const dep of (DEPENDENCIAS[m] || [])) {
                if (!selecao.has(dep)) {
                    selecao.add(dep);
                    adicionadas.push(dep);
                    mudou = true;
                }
            }
        }
    }
    if (adicionadas.length) {
        console.log(`🔗 Dependências incluídas automaticamente: ${adicionadas.join(', ')}`);
    }
    return { selecao, adicionadas };
}

// ---------------------------------------------------------------------------
// Dry-run
// ---------------------------------------------------------------------------

async function executarDryRun(tables, selecao, mode) {
    console.log('\n🔍 DRY-RUN — nenhuma escrita será feita.\n');
    const linhas = [];
    let totalArquivo = 0;
    let conflitos = 0;

    for (const { model, delegate } of TABLES) {
        if (!selecao.has(model)) continue;
        const noArquivo = (tables[model] || []).length;
        const noBanco = await prisma[delegate].count();
        totalArquivo += noArquivo;

        let acao;
        if (noArquivo === 0) {
            acao = '— (nada no arquivo)';
        } else if (noBanco === 0) {
            acao = `inserir ${noArquivo}`;
        } else if (mode === 'upsert') {
            acao = `upsert ${noArquivo} (banco já tem ${noBanco})`;
        } else {
            acao = `CONFLITO — empty-only exige tabela vazia`;
            conflitos++;
        }
        linhas.push({ model, noArquivo, noBanco, acao });
    }

    console.log(pad('Tabela', 24) + padEsq('Arquivo', 9) + padEsq('Banco', 9) + '  Ação prevista');
    console.log('-'.repeat(80));
    for (const l of linhas) {
        console.log(pad(l.model, 24) + padEsq(l.noArquivo, 9) + padEsq(l.noBanco, 9) + '  ' + l.acao);
    }
    console.log('-'.repeat(80));
    console.log(`Total no arquivo (tabelas selecionadas): ${totalArquivo} registros`);
    if (conflitos > 0) {
        console.log(`⚠️  ${conflitos} tabela(s) com dados no banco — --mode empty-only seria BLOQUEADO. Considere --mode upsert.`);
    }
    console.log('\nPara executar de verdade: adicione --mode empty-only (banco vazio) ou --mode upsert.');
}

// ---------------------------------------------------------------------------
// Escrita — empty-only e upsert
// ---------------------------------------------------------------------------

/** empty-only: pré-checagem de que TODAS as tabelas-alvo (com dados no arquivo) estão vazias. */
async function verificarBancoVazio(tables, selecao) {
    const ocupadas = [];
    for (const { model, delegate } of TABLES) {
        if (!selecao.has(model)) continue;
        if ((tables[model] || []).length === 0) continue; // nada a escrever nessa tabela
        const count = await prisma[delegate].count();
        if (count > 0) ocupadas.push({ model, count });
    }
    if (ocupadas.length) {
        console.error('\n❌ Modo empty-only BLOQUEADO — tabelas-alvo com dados no banco:');
        for (const o of ocupadas) {
            console.error(`   - ${o.model}: ${o.count} registro(s) no banco`);
        }
        fatal('Nada foi escrito. Use um banco vazio (drill) ou --mode upsert para mesclar por id.');
    }
}

/** Insere uma tabela em lotes com createMany; fallback linha-a-linha em erro de FK. */
async function inserirTabela(model, delegate, rows, stats, errosDetalhe) {
    for (let i = 0; i < rows.length; i += LOTE_CREATE) {
        const lote = rows.slice(i, i + LOTE_CREATE);
        try {
            const res = await prisma[delegate].createMany({ data: lote, skipDuplicates: true });
            stats.inseridos += res.count;
            stats.pulados += lote.length - res.count;
        } catch (err) {
            // Lote falhou (FK quebrada ou linha inválida) → fallback linha-a-linha
            console.warn(`   ⚠️  ${model}: lote ${i / LOTE_CREATE + 1} falhou (${resumirErro(err.message)}) — tentando linha a linha...`);
            for (const row of lote) {
                try {
                    await prisma[delegate].create({ data: row });
                    stats.inseridos++;
                } catch (e) {
                    stats.erros++;
                    errosDetalhe.push(`${model} id=${row.id}: ${resumirErro(e.message)}`);
                }
            }
        }
    }
}

/** Upsert por id em lotes de 100 dentro de $transaction; fallback linha-a-linha. */
async function upsertTabela(model, delegate, rows, stats, errosDetalhe) {
    for (let i = 0; i < rows.length; i += LOTE_UPSERT) {
        const lote = rows.slice(i, i + LOTE_UPSERT);
        const ids = lote.map(r => r.id);
        // Descobre quais ids já existem (para o relatório inseridos × atualizados)
        const existentes = await prisma[delegate].findMany({
            where: { id: { in: ids } },
            select: { id: true },
        });
        const jaExiste = new Set(existentes.map(e => e.id));

        const montarUpsert = (row) => {
            const { id, ...semId } = row; // não reescreve a PK no update
            return prisma[delegate].upsert({ where: { id }, create: row, update: semId });
        };

        try {
            await prisma.$transaction(lote.map(montarUpsert));
            for (const row of lote) {
                if (jaExiste.has(row.id)) stats.atualizados++; else stats.inseridos++;
            }
        } catch (err) {
            console.warn(`   ⚠️  ${model}: lote ${i / LOTE_UPSERT + 1} falhou (${resumirErro(err.message)}) — tentando linha a linha...`);
            for (const row of lote) {
                try {
                    await montarUpsert(row);
                    if (jaExiste.has(row.id)) stats.atualizados++; else stats.inseridos++;
                } catch (e) {
                    stats.erros++;
                    errosDetalhe.push(`${model} id=${row.id}: ${resumirErro(e.message)}`);
                }
            }
        }
    }
}

/** Realinha as sequences das tabelas Int autoincrement com o MAX(id) atual. */
async function resetarSequences(selecao) {
    for (const model of AUTOINCREMENT_TABLES) {
        if (!selecao.has(model)) continue;
        try {
            await prisma.$executeRawUnsafe(
                `SELECT setval(pg_get_serial_sequence('"${model}"','id'), GREATEST(COALESCE((SELECT MAX(id) FROM "${model}"),0),1));`
            );
            console.log(`   🔢 Sequence de ${model} realinhada.`);
        } catch (err) {
            console.warn(`   ⚠️  Falha ao realinhar sequence de ${model}: ${resumirErro(err.message)}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Trava de produção + confirmação
// ---------------------------------------------------------------------------

async function confirmarEscrita(args, info) {
    const ehProducao = HOSTS_PRODUCAO.some(p => info.host.toLowerCase().includes(p));

    if (ehProducao) {
        console.log('\n🚨 ATENÇÃO: o host parece ser o banco de PRODUÇÃO (Railway)!');
        if (!args.allowProduction) {
            fatal('Restauração em produção exige a flag --allow-production. Abortado — nada foi escrito.');
        }
        if (!process.stdin.isTTY) {
            fatal('Restauração em produção exige confirmação interativa (terminal). Abortado — nada foi escrito.');
        }
        // --yes NÃO pula esta confirmação: é preciso digitar o nome do database
        const resp = await perguntar(`Para confirmar, digite o nome do database ("${info.database}"): `);
        if (resp !== info.database) {
            fatal(`Confirmação incorreta ("${resp}" ≠ "${info.database}"). Abortado — nada foi escrito.`);
        }
        return;
    }

    if (!args.yes) {
        if (!process.stdin.isTTY) {
            fatal('Sem terminal interativo — use --yes para confirmar a escrita.');
        }
        const resp = await perguntar('Confirmar a restauração neste banco? (digite "sim"): ');
        if (resp.toLowerCase() !== 'sim') {
            fatal('Restauração cancelada pelo usuário. Nada foi escrito.');
        }
    }
}

// ---------------------------------------------------------------------------
// Registro em BackupRun (best effort — o banco alvo pode não ter a tabela)
// ---------------------------------------------------------------------------

async function registrarRestore(success, message, totalRecords, counts, durationMs) {
    try {
        // counts no shape {Model: n} (mesmo contrato dos runs de backup na UI):
        // n = inseridos + atualizados por tabela
        const countsFlat = {};
        for (const [model, s] of Object.entries(counts || {})) {
            countsFlat[model] = (s.inseridos || 0) + (s.atualizados || 0);
        }
        await prisma.backupRun.create({
            data: {
                type: 'restore',
                source: 'cli',
                success,
                message,
                totalRecords,
                counts: JSON.stringify(countsFlat),
                durationMs,
            },
        });
        console.log('📝 BackupRun (type: restore) registrado no banco alvo.');
    } catch (err) {
        console.warn(`⚠️  Não foi possível registrar BackupRun (não fatal): ${resumirErro(err.message)}`);
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const args = parseArgs(process.argv);
    const inicio = Date.now();

    // --record-drill: grava o registro do drill e sai
    if (args.recordDrill !== null) {
        const info = infoBanco();
        console.log(`Banco alvo: host=${info.host} database=${info.database}`);
        const run = await prisma.backupRun.create({
            data: { type: 'drill', source: 'cli', success: true, message: args.recordDrill },
        });
        console.log(`✅ Drill registrado: id=${run.id} em ${run.createdAt.toISOString()}`);
        return;
    }

    // 1. Banco alvo (senha mascarada)
    const info = infoBanco();
    console.log('🎯 Banco alvo:');
    console.log(`   Host:     ${info.host}`);
    console.log(`   Database: ${info.database}`);
    console.log(`   URL:      ${info.mascarada}`);

    // 2. Carrega e decodifica o backup
    const { data, origem } = await carregarBackup(args);

    // 3. Detecta o formato
    const formato = detectarFormato(data);
    if (!formato) {
        fatal('Formato de backup não reconhecido — esperado v2 (metadata.schemaVersion "2.0" + tables) ou v1 legado (metadata.version "1.0").');
    }
    console.log(`📄 Formato detectado: ${formato === 'v2' ? 'v2 (flat)' : 'v1 (legado)'} | origem: ${origem}`);
    if (data.metadata && data.metadata.timestamp) {
        console.log(`   Criado em: ${data.metadata.timestamp} | fonte: ${data.metadata.source || '?'}`);
    }

    // 4. Checksum (sha256 do JSON canônico de tables)
    let tables;
    if (formato === 'v2') {
        tables = data.tables;
        const esperado = data.metadata.checksum;
        if (!args.skipChecksum) {
            const atual = sha256(canonicalTablesJson(tables));
            if (!esperado) {
                fatal('Backup v2 sem checksum na metadata. Use --skip-checksum para prosseguir mesmo assim.');
            }
            if (atual !== esperado) {
                fatal(`Checksum NÃO confere (arquivo corrompido ou adulterado).\n   esperado: ${esperado}\n   atual:    ${atual}\nUse --skip-checksum apenas se souber o que está fazendo.`);
            }
            console.log(`✅ Checksum verificado: ${atual.slice(0, 16)}…`);
        } else {
            console.warn('⚠️  Checksum PULADO (--skip-checksum).');
        }
    } else {
        if (!args.skipChecksum) {
            fatal('Backups v1 legados não têm checksum. Rode novamente com --skip-checksum para aceitar.');
        }
        console.warn('⚠️  Backup v1 sem checksum — prosseguindo por causa de --skip-checksum.');
        tables = converterV1(data);
    }

    // 5. Seleção de tabelas + fechamento de dependências
    const { selecao } = resolverSelecao(args.tables);

    // 6. Dry-run (default sem --mode) — ZERO escrita
    if (args.dryRun) {
        await executarDryRun(tables, selecao, args.mode);
        return;
    }

    // 7. Trava de produção + confirmação interativa
    await confirmarEscrita(args, info);

    // 8. empty-only: pré-checagem de banco vazio (aborta sem escrever NADA)
    if (args.mode === 'empty-only') {
        await verificarBancoVazio(tables, selecao);
    }

    // 9. Escrita na ordem topológica de TABLES
    console.log(`\n🚀 Iniciando restauração (--mode ${args.mode})...\n`);
    const statsPorTabela = {};
    const errosDetalhe = [];
    const removidosPorModelo = {};

    for (const { model, delegate } of TABLES) {
        if (!selecao.has(model)) continue;
        const brutas = tables[model] || [];
        if (brutas.length === 0) continue;

        const rows = brutas.map(r => limparLinha(model, r, removidosPorModelo));
        const stats = { inseridos: 0, atualizados: 0, pulados: 0, erros: 0 };
        statsPorTabela[model] = stats;

        process.stdout.write(`   ${pad(model, 24)} ${brutas.length} registro(s)... `);
        const t0 = Date.now();
        if (args.mode === 'empty-only') {
            await inserirTabela(model, delegate, rows, stats, errosDetalhe);
        } else {
            await upsertTabela(model, delegate, rows, stats, errosDetalhe);
        }
        console.log(`ok (${fmtDuracao(Date.now() - t0)})`);
    }

    // Campos removidos por não existirem mais no schema (informativo)
    for (const [model, campos] of Object.entries(removidosPorModelo)) {
        console.log(`   ℹ️  ${model}: campos ignorados (não existem no schema atual): ${[...campos].join(', ')}`);
    }

    // 10. Reset de sequences das tabelas autoincrement
    console.log('\n🔧 Realinhando sequences (tabelas autoincrement)...');
    await resetarSequences(selecao);

    // 11. Relatório final
    const duracao = Date.now() - inicio;
    let totInseridos = 0, totAtualizados = 0, totPulados = 0, totErros = 0;

    console.log('\n📊 Relatório final:\n');
    console.log(pad('Tabela', 24) + padEsq('Inseridos', 10) + padEsq('Atualizados', 12) + padEsq('Pulados', 9) + padEsq('Erros', 7));
    console.log('-'.repeat(62));
    for (const [model, s] of Object.entries(statsPorTabela)) {
        console.log(pad(model, 24) + padEsq(s.inseridos, 10) + padEsq(s.atualizados, 12) + padEsq(s.pulados, 9) + padEsq(s.erros, 7));
        totInseridos += s.inseridos;
        totAtualizados += s.atualizados;
        totPulados += s.pulados;
        totErros += s.erros;
    }
    console.log('-'.repeat(62));
    console.log(pad('TOTAL', 24) + padEsq(totInseridos, 10) + padEsq(totAtualizados, 12) + padEsq(totPulados, 9) + padEsq(totErros, 7));
    console.log(`\n⏱️  Duração total: ${fmtDuracao(duracao)}`);

    if (errosDetalhe.length) {
        console.log(`\n⚠️  ${errosDetalhe.length} linha(s) puladas por erro (FK quebrada ou dado inválido):`);
        for (const e of errosDetalhe.slice(0, 30)) console.log(`   - ${e}`);
        if (errosDetalhe.length > 30) console.log(`   ... e mais ${errosDetalhe.length - 30} erro(s).`);
    }

    // 12. Registra o restore em BackupRun (best effort)
    const sucesso = true; // chegou até aqui = restauração concluída (erros pontuais reportados acima)
    const resumo = `Restore ${args.mode} de ${origem}: ${totInseridos} inseridos, ${totAtualizados} atualizados, ` +
                   `${totPulados} pulados, ${totErros} erros em ${fmtDuracao(duracao)}`;
    await registrarRestore(sucesso, resumo, totInseridos + totAtualizados, statsPorTabela, duracao);

    console.log(`\n✅ Restauração concluída. ${resumo}`);
    if (totErros > 0) {
        console.log('   Revise os erros acima — as linhas puladas NÃO foram inseridas.');
    }
}

main()
    .then(async () => {
        await prisma.$disconnect().catch(() => {});
        process.exit(0);
    })
    .catch(async (err) => {
        if (err instanceof ErroFatal) {
            console.error(`\n❌ ${err.message}`);
        } else {
            console.error('\n❌ Erro inesperado:', err);
        }
        await prisma.$disconnect().catch(() => {});
        process.exit(1);
    });

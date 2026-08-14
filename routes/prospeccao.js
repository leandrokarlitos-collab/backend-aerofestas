// Prospecção B2B — prefeituras de GO e vizinhos (secretarias de assistência social).
// Persiste o TRABALHO do gestor sobre cada município: status do funil, anotação,
// canais já usados e correções de contato. Os dados-base (população, distância,
// orçamento, contatos do CadSUAS) são snapshot estático no frontend
// (js/data/prospeccao-municipios.js) e nunca são sobrescritos aqui.
const express = require('express');
const prisma = require('../prisma/client');
const { authenticate } = require('../middleware/auth');
const PncpService = require('../services/PncpService');

const router = express.Router();

const STATUS_VALIDOS = ['nao_contatado', 'contatado', 'proposta_enviada', 'negociacao', 'fechado', 'descartado'];

// Campos do snapshot que o gestor pode corrigir pela tela (whitelist estrita —
// o JSON gravado é SEMPRE re-serializado aqui, nunca o texto cru do cliente)
const CAMPOS_CONTATO = ['telPrefeitura', 'secretaria', 'secretario', 'contatoSecretaria', 'enderecoSecretaria', 'site', 'obs'];

// Por onde já falamos com a prefeitura (acumulativo)
const CANAIS_VALIDOS = ['whatsapp', 'ligacao', 'email', 'oficio', 'presencial', 'instagram'];
// Por que NÃO alcançamos — separa "ainda não tentei" de "tentei e não deu"
const PROBLEMAS_VALIDOS = ['tel_nao_encontrado', 'tel_desatualizado', 'nao_atende', 'whats_sem_resposta', 'email_sem_resposta', 'sem_retorno'];

// Valida lista contra whitelist e devolve JSON canônico (ordem da whitelist, sem duplicata)
function validarLista(valor, permitidos, nomeCampo) {
    if (valor === null) return null;
    if (!Array.isArray(valor)) throw erro(400, `${nomeCampo} inválido: esperado lista.`);
    const set = new Set();
    for (const c of valor) {
        const s = String(c).trim();
        if (!permitidos.includes(s)) throw erro(400, `Valor inválido em ${nomeCampo}: ${s}`);
        set.add(s);
    }
    return set.size ? JSON.stringify(permitidos.filter(c => set.has(c))) : null;
}

// Data de retorno: aceita 'AAAA-MM-DD' ou ISO; null limpa o lembrete
function validarProximoContato(valor) {
    if (valor === null || valor === '') return null;
    const d = new Date(valor);
    if (isNaN(d.getTime())) throw erro(400, 'Data de próximo contato inválida.');
    return d;
}

function validarContatosEdit(valor) {
    if (valor === null) return null; // null explícito = restaurar o snapshot original
    if (typeof valor !== 'object' || Array.isArray(valor)) {
        throw erro(400, 'contatosEdit inválido: esperado objeto com os campos de contato.');
    }
    const limpo = {};
    for (const campo of CAMPOS_CONTATO) {
        const v = valor[campo];
        if (v === undefined || v === null) continue;
        const s = String(v).trim();
        if (s) limpo[campo] = s.slice(0, 500);
    }
    return Object.keys(limpo).length ? JSON.stringify(limpo) : null;
}

function erro(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

// ---------------------------------------------------------------------------
// LICITAÇÕES (PNCP) — rotas declaradas ANTES de `/:cod` de propósito
// ---------------------------------------------------------------------------
// A varredura em si mora em services/PncpService.js; aqui só entra transporte.

/** Serializa um edital para a tela — nada de campo cru do PNCP vazando. */
function editalParaTela(e) {
    let termos = [];
    try { termos = e.termos ? JSON.parse(e.termos) : []; } catch (err) { termos = []; }
    return {
        id: e.id,
        cod: e.codMunicipio,
        municipio: e.municipioNome,
        uf: e.uf,
        objeto: e.objeto,
        informacao: e.informacao,
        orgao: e.orgaoNome,
        unidade: e.unidadeNome,
        modalidade: e.modalidadeNome,
        valorEstimado: e.valorEstimado,
        situacao: e.situacaoNome,
        srp: e.srp,
        abertura: e.dataAberturaProposta,
        prazo: e.dataEncerramentoProposta,
        publicacao: e.dataPublicacao,
        link: e.linkPncp || e.linkSistemaOrigem || null,
        termos,
        forca: e.forca,
        // Varredura bem-sucedida deixou de listar o edital antes do prazo vencer:
        // provável cancelamento/suspensão. A tela avisa em vez de esconder.
        sumiuEm: e.sumiuEm,
        vistoEm: e.vistoEm,
        criadoEm: e.criadoEm
    };
}

const varreduraParaTela = v => v && ({
    id: v.id,
    origem: v.origem,
    status: v.status,
    municipiosAlvo: v.municipiosAlvo,
    municipiosOk: v.municipiosOk,
    municipiosFalha: v.municipiosFalha,
    municipioAtual: v.municipioAtual,
    itensLidos: v.itensLidos,
    novos: v.novos,
    atualizados: v.atualizados,
    sumidos: v.sumidos,
    notificados: v.notificados,
    erro: v.erro,
    iniciadoPor: v.iniciadoPor,
    iniciadoEm: v.iniciadoEm,
    concluidoEm: v.concluidoEm,
    duracaoMs: v.duracaoMs
});

// Editais ABERTOS agora + estado das varreduras.
// "Aberto" é derivado do prazo, nunca de um booleano gravado: por isso um edital
// vencido some da tela mesmo que a varredura esteja quebrada há dias.
router.get('/licitacoes', authenticate, async (req, res, next) => {
    try {
        const agora = new Date();
        const [editais, ultimoSucesso, ultima, rodando] = await Promise.all([
            prisma.licitacaoPncp.findMany({
                where: {
                    descartado: false,
                    OR: [
                        { dataEncerramentoProposta: { gte: agora } },
                        { dataEncerramentoProposta: null }
                    ]
                },
                orderBy: [{ forca: 'asc' }, { dataEncerramentoProposta: 'asc' }]
            }),
            prisma.licitacaoVarredura.findFirst({
                where: { status: 'sucesso' },
                orderBy: { concluidoEm: 'desc' }
            }),
            prisma.licitacaoVarredura.findFirst({
                where: { status: { in: ['sucesso', 'parcial', 'falha'] } },
                orderBy: { iniciadoEm: 'desc' }
            }),
            prisma.licitacaoVarredura.findFirst({
                where: { status: 'executando' },
                orderBy: { iniciadoEm: 'desc' }
            })
        ]);

        res.json({
            editais: editais.map(editalParaTela),
            // Data do último SUCESSO — é o que diz se o robô está de fato vivo.
            ultimoSucesso: varreduraParaTela(ultimoSucesso),
            ultima: varreduraParaTela(ultima),
            rodando: varreduraParaTela(rodando)
        });
    } catch (err) { next(err); }
});

// Dispara uma varredura manual. Responde na hora com o id: quem espera a
// varredura inteira numa requisição HTTP colhe timeout de proxy.
router.post('/licitacoes/varrer', authenticate, async (req, res, next) => {
    try {
        const user = req.user || {};
        const quem = user.name || user.email || (user.id != null ? String(user.id) : 'gestor');
        const { run, jaRodando, promessa } = await PncpService.iniciarVarredura({
            origem: 'manual',
            iniciadoPor: quem
        });

        if (jaRodando) {
            const atual = await prisma.licitacaoVarredura.findFirst({
                where: { status: 'executando' },
                orderBy: { iniciadoEm: 'desc' }
            });
            return res.status(409).json({
                error: 'Já existe uma varredura em andamento.',
                varredura: varreduraParaTela(atual)
            });
        }

        // Roda solta; o cliente acompanha por GET /licitacoes/varredura/:id
        promessa.catch(err => console.error('[pncp] varredura manual falhou:', err));
        res.status(202).json({ success: true, varredura: varreduraParaTela(run) });
    } catch (err) { next(err); }
});

// Progresso de uma varredura (alimenta a barra da tela)
router.get('/licitacoes/varredura/:id', authenticate, async (req, res, next) => {
    try {
        const v = await prisma.licitacaoVarredura.findUnique({ where: { id: String(req.params.id) } });
        if (!v) throw erro(404, 'Varredura não encontrada.');
        res.json(varreduraParaTela(v));
    } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// TERMOS DE BUSCA — o gestor edita sem esperar deploy
// ---------------------------------------------------------------------------

const termoParaTela = t => ({
    id: t.id,
    termo: t.termo,
    forca: t.forca,
    ativo: t.ativo,
    deFabrica: t.deFabrica,
    criadoPor: t.criadoPor,
    criadoEm: t.criadoEm
});

router.get('/licitacoes/termos', authenticate, async (req, res, next) => {
    try {
        const termos = await prisma.licitacaoTermo.findMany({
            orderBy: [{ forca: 'asc' }, { termo: 'asc' }]
        });
        res.json(termos.map(termoParaTela));
    } catch (err) { next(err); }
});

router.post('/licitacoes/termos', authenticate, async (req, res, next) => {
    try {
        const body = req.body || {};
        const termo = String(body.termo || '').trim().replace(/\s+/g, ' ');
        if (termo.length < 3) throw erro(400, 'Informe um termo com pelo menos 3 letras.');
        if (termo.length > 60) throw erro(400, 'Termo muito longo (máximo 60 caracteres).');
        // Termo curto demais ou genérico demais casa com tudo e enche a tela de
        // ruído — o mínimo de 3 letras é a barreira barata contra isso.
        const forca = body.forca === 'fraco' ? 'fraco' : 'forte';

        const existente = await prisma.licitacaoTermo.findUnique({ where: { termo } });
        if (existente) throw erro(409, `O termo "${termo}" já existe${existente.ativo ? '' : ' (está desativado)'}.`);

        const user = req.user || {};
        const row = await prisma.licitacaoTermo.create({
            data: {
                termo,
                forca,
                // padrao fica null: termo criado pela tela casa por texto, com
                // acento e separador flexíveis (ver regexDoTexto no serviço).
                criadoPor: user.name || user.email || (user.id != null ? String(user.id) : null)
            }
        });
        PncpService.invalidarCacheTermos();
        res.status(201).json({ success: true, data: termoParaTela(row) });
    } catch (err) { next(err); }
});

router.patch('/licitacoes/termos/:id', authenticate, async (req, res, next) => {
    try {
        const body = req.body || {};
        const dados = {};
        if (body.forca !== undefined) {
            if (!['forte', 'fraco'].includes(body.forca)) throw erro(400, 'Força inválida (forte ou fraco).');
            dados.forca = body.forca;
        }
        if (body.ativo !== undefined) {
            if (typeof body.ativo !== 'boolean') throw erro(400, 'ativo inválido.');
            dados.ativo = body.ativo;
        }
        if (!Object.keys(dados).length) throw erro(400, 'Nada para atualizar.');

        const row = await prisma.licitacaoTermo.update({
            where: { id: String(req.params.id) },
            data: dados
        }).catch(() => null);
        if (!row) throw erro(404, 'Termo não encontrado.');
        PncpService.invalidarCacheTermos();
        res.json({ success: true, data: termoParaTela(row) });
    } catch (err) { next(err); }
});

// Só termo criado pela tela pode ser apagado. Os de fábrica se desativam
// (PATCH ativo:false): apagá-los deixaria a varredura cega sem deixar rastro.
router.delete('/licitacoes/termos/:id', authenticate, async (req, res, next) => {
    try {
        const row = await prisma.licitacaoTermo.findUnique({ where: { id: String(req.params.id) } });
        if (!row) throw erro(404, 'Termo não encontrado.');
        if (row.deFabrica) throw erro(400, 'Termo de fábrica não pode ser apagado — desative-o.');
        await prisma.licitacaoTermo.delete({ where: { id: row.id } });
        PncpService.invalidarCacheTermos();
        res.json({ success: true });
    } catch (err) { next(err); }
});

// Descarta (ou reabilita) um edital: "parque" e "lazer" trazem pavimentação e
// rodeio junto; o gestor tira da tela sem apagar o registro.
router.patch('/licitacoes/:id', authenticate, async (req, res, next) => {
    try {
        const body = req.body || {};
        if (typeof body.descartado !== 'boolean') throw erro(400, 'Informe descartado: true ou false.');
        const user = req.user || {};
        const row = await prisma.licitacaoPncp.update({
            where: { id: String(req.params.id) },
            data: {
                descartado: body.descartado,
                descartadoPor: body.descartado
                    ? (user.name || user.email || (user.id != null ? String(user.id) : null))
                    : null
            }
        }).catch(() => null);
        if (!row) throw erro(404, 'Edital não encontrado.');
        res.json({ success: true, data: editalParaTela(row) });
    } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// ANDAMENTO DO FUNIL
// ---------------------------------------------------------------------------

// Andamento de todos os municípios já tocados — o frontend mescla com o snapshot
router.get('/', authenticate, async (req, res, next) => {
    try {
        const rows = await prisma.prospeccaoPrefeitura.findMany();
        res.json(rows);
    } catch (err) { next(err); }
});

// Grava/atualiza o andamento de um município (upsert pelo código IBGE)
router.put('/:cod', authenticate, async (req, res, next) => {
    try {
        const cod = String(req.params.cod || '').trim();
        // Código municipal de 7 dígitos. O radar cobre o BRASIL INTEIRO (27 UFs),
        // então basta validar o formato: 2 dígitos de UF válidos + 5 dígitos.
        // UFs existentes: 11-17 (Norte), 21-29 (Nordeste), 31-35 (Sudeste),
        // 41-43 (Sul), 50-53 (Centro-Oeste). Não existem 18-20, 30, 34, 36-40,
        // 44-49 nem 54+, e por isso a lista continua explícita: um código
        // malformado tem de ser rejeitado, não gravar lixo no banco.
        if (!/^(1[1-7]|2[1-9]|3[1-5]|4[1-3]|5[0-3])\d{5}$/.test(cod)) throw erro(400, 'Código IBGE inválido (esperado município brasileiro, 7 dígitos).');

        const body = req.body || {};
        const nome = String(body.nome || '').trim();
        if (!nome) throw erro(400, 'Informe o nome do município.');

        const dados = {};
        if (body.status !== undefined) {
            if (!STATUS_VALIDOS.includes(body.status)) throw erro(400, 'Status inválido.');
            dados.status = body.status;
        }
        if (body.nota !== undefined) {
            dados.nota = body.nota ? String(body.nota).trim().slice(0, 4000) : null;
        }
        if (body.canais !== undefined) {
            dados.canais = validarLista(body.canais, CANAIS_VALIDOS, 'canais');
        }
        if (body.problemas !== undefined) {
            dados.problemas = validarLista(body.problemas, PROBLEMAS_VALIDOS, 'problemas');
        }
        if (body.proximoContato !== undefined) {
            dados.proximoContato = validarProximoContato(body.proximoContato);
        }
        if (body.jaAtendemos !== undefined) {
            dados.jaAtendemos = body.jaAtendemos === true || body.jaAtendemos === 'true';
        }
        if (body.valorFechado !== undefined) {
            // null/'' limpa; senão precisa ser um valor monetário plausível
            if (body.valorFechado === null || body.valorFechado === '') {
                dados.valorFechado = null;
            } else {
                const v = Number(body.valorFechado);
                if (!Number.isFinite(v) || v < 0 || v > 100_000_000) throw erro(400, 'Valor fechado inválido.');
                dados.valorFechado = v;
            }
        }
        if (body.contatosEdit !== undefined) {
            dados.contatosEdit = validarContatosEdit(body.contatosEdit);
        }
        if (Object.keys(dados).length === 0) throw erro(400, 'Nada para atualizar.');

        const user = req.user || {};
        dados.updatedBy = user.name || user.email || (user.id != null ? String(user.id) : null);

        const row = await prisma.prospeccaoPrefeitura.upsert({
            where: { cod },
            create: {
                cod,
                nome,
                status: dados.status || 'nao_contatado',
                nota: dados.nota !== undefined ? dados.nota : null,
                canais: dados.canais !== undefined ? dados.canais : null,
                problemas: dados.problemas !== undefined ? dados.problemas : null,
                proximoContato: dados.proximoContato !== undefined ? dados.proximoContato : null,
                jaAtendemos: dados.jaAtendemos === true,
                valorFechado: dados.valorFechado !== undefined ? dados.valorFechado : null,
                contatosEdit: dados.contatosEdit !== undefined ? dados.contatosEdit : null,
                updatedBy: dados.updatedBy
            },
            update: dados
        });
        res.json({ success: true, data: row });
    } catch (err) { next(err); }
});

module.exports = router;

// Prospecção B2B — prefeituras de GO e vizinhos (secretarias de assistência social).
// Persiste o TRABALHO do gestor sobre cada município: status do funil, anotação,
// canais já usados e correções de contato. Os dados-base (população, distância,
// orçamento, contatos do CadSUAS) são snapshot estático no frontend
// (js/data/prospeccao-municipios.js) e nunca são sobrescritos aqui.
const express = require('express');
const prisma = require('../prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const STATUS_VALIDOS = ['nao_contatado', 'contatado', 'proposta_enviada', 'negociacao', 'fechado', 'descartado'];

// Campos do snapshot que o gestor pode corrigir pela tela (whitelist estrita —
// o JSON gravado é SEMPRE re-serializado aqui, nunca o texto cru do cliente)
const CAMPOS_CONTATO = ['telPrefeitura', 'secretaria', 'secretario', 'contatoSecretaria', 'enderecoSecretaria', 'site', 'obs'];

// Por onde já falamos com a prefeitura (acumulativo)
const CANAIS_VALIDOS = ['whatsapp', 'ligacao', 'email', 'oficio', 'presencial', 'instagram'];

function validarCanais(valor) {
    if (valor === null) return null;
    if (!Array.isArray(valor)) throw erro(400, 'canais inválido: esperado lista.');
    // dedup + ordem canônica (a whitelist define a ordem exibida na tela)
    const set = new Set();
    for (const c of valor) {
        const s = String(c).trim();
        if (!CANAIS_VALIDOS.includes(s)) throw erro(400, `Canal inválido: ${s}`);
        set.add(s);
    }
    return set.size ? JSON.stringify(CANAIS_VALIDOS.filter(c => set.has(c))) : null;
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
        // Código municipal de 7 dígitos começando pela UF:
        // 52=GO, 53=DF, 17=TO, 31=MG, 29=BA, 51=MT, 50=MS (GO e fronteiriços)
        if (!/^(52|53|17|31|29|51|50)\d{5}$/.test(cod)) throw erro(400, 'Código IBGE inválido (esperado município de GO ou UF vizinha, 7 dígitos).');

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
            dados.canais = validarCanais(body.canais);
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
                contatosEdit: dados.contatosEdit !== undefined ? dados.contatosEdit : null,
                updatedBy: dados.updatedBy
            },
            update: dados
        });
        res.json({ success: true, data: row });
    } catch (err) { next(err); }
});

module.exports = router;

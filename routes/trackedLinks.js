/**
 * Links rastreáveis (encurtador próprio da Aero Festas — substitui o Bitly pago).
 *
 * publicRouter: recebe o POST da página /r/<slug> (o QR impresso no panfleto),
 * registra o acesso e devolve APENAS o destino atual — nada de dado interno.
 * adminRouter: CRUD dos links + relatórios (analytics, acessos e exportação CSV).
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const TrackedLinkService = require('../services/TrackedLinkService');

const adminRouter = express.Router();
const publicRouter = express.Router();

// Slug: minúsculas, 2 a 40 caracteres, começa com letra ou número.
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,39}$/;

// Rate limit próprio e generoso: um panfleto pode gerar muitos scans do MESMO IP
// (Wi-Fi de escola/salão, NAT de prefeitura, faixa CGNAT de operadora), e cada
// bloqueio é um visitante perdido de um QR já impresso. O teto alto continua
// barrando abuso real; o handler registra a perda no log para ela não ser invisível.
const MENSAGEM_LIMITE = { error: 'Muitos acessos em pouco tempo. Aguarde alguns minutos e tente novamente.' };

const redirectLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: MENSAGEM_LIMITE,
    handler: (req, res, next, options) => {
        const ip = (req && req.ip) ? req.ip : 'desconhecido';
        const slug = (req && req.params && req.params.slug) ? req.params.slug : 'desconhecido';
        console.warn(`[trackedLink] rate limit atingido — visitante bloqueado. ip=${ip} slug=${slug}`);
        res.status(options.statusCode).json(options.message || MENSAGEM_LIMITE);
    }
});

function erro(status, mensagem) {
    const err = new Error(mensagem);
    err.status = status;
    return err;
}

function normalizarSlug(valor) {
    return String(valor ?? '').trim().toLowerCase();
}

function validarNome(valor) {
    const name = String(valor ?? '').trim();
    if (!name) throw erro(400, 'Informe o nome do link.');
    return name;
}

function validarDestino(valor) {
    const destination = String(valor ?? '').trim();
    if (!destination) throw erro(400, 'Informe o destino do link.');
    if (!/^https?:\/\//i.test(destination)) {
        throw erro(400, 'O destino precisa começar com http:// ou https://.');
    }
    return destination;
}

// Data de hoje (fuso de Brasília) no formato YYYY-MM-DD, para o nome do CSV.
function dataDeHoje() {
    try {
        return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    } catch (_) {
        return new Date().toISOString().slice(0, 10);
    }
}

// ---------------- PUBLIC ----------------

// POST /api/public/r/:slug — chamado pela página r.html antes de redirecionar.
// O corpo chega como text/plain (evita preflight de CORS), mas pode vir já
// parseado como objeto se o cliente mandar application/json: aceitamos os dois.
publicRouter.post(
    '/r/:slug',
    redirectLimiter,
    express.text({ type: '*/*', limit: '16kb' }),
    async (req, res, next) => {
        try {
            const slug = normalizarSlug(req.params.slug);

            let payload = req.body;
            if (typeof payload === 'string') {
                // Corpo inválido nunca pode virar 500 — o QR já está impresso.
                try { payload = JSON.parse(payload || '{}'); } catch (_) { payload = {}; }
            }
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {};

            // Cache de slug do processo (TTL de 30s): tira o findUnique do caminho
            // quente, porque no cold start do Railway ele sozinho já estoura o
            // orçamento de 2,5s do r.html e manda o visitante para o fallback.
            const link = slug ? await TrackedLinkService.findLinkBySlugCached(slug) : null;
            if (!link || !link.active) {
                res.set('Cache-Control', 'no-store');
                return res.status(404).json({ error: 'Link não encontrado ou desativado.' });
            }

            // Responde PRIMEIRO, grava DEPOIS: a telemetria nunca pode segurar o
            // redirecionamento (findUnique + create em container frio passam de 2,5s).
            res.set('Cache-Control', 'no-store');
            res.json({ destination: link.destination });

            // Fire-and-forget de verdade: sem await, com .catch para não gerar
            // unhandled rejection, e dentro de try/catch para barrar também uma
            // exceção síncrona lançada antes da primeira await de recordHit.
            try {
                Promise.resolve(TrackedLinkService.recordHit(link, payload, req))
                    .catch(e => console.error('[trackedLink] falha ao registrar acesso:', e && e.message ? e.message : e));
            } catch (e) {
                console.error('[trackedLink] falha ao registrar acesso:', e && e.message ? e.message : e);
            }
        } catch (err) { next(err); }
    }
);

// ---------------- ADMIN ----------------

adminRouter.get('/', authenticate, async (req, res, next) => {
    try {
        const links = await TrackedLinkService.listLinks();
        res.json(links);
    } catch (err) { next(err); }
});

adminRouter.post('/', authenticate, async (req, res, next) => {
    try {
        const body = req.body || {};
        const slug = normalizarSlug(body.slug);
        if (!slug) throw erro(400, 'Informe o slug (o final do link curto).');
        if (!SLUG_REGEX.test(slug)) {
            throw erro(400, 'Slug inválido: use de 2 a 40 caracteres, apenas letras minúsculas, números e hífen, começando por letra ou número.');
        }
        const dados = {
            slug,
            name: validarNome(body.name),
            destination: validarDestino(body.destination),
            // 'active' precisa ser repassado: sem ele o service aplica o padrão
            // true e o link nasce ligado mesmo com a caixa desmarcada no modal
            // (QR de campanha futura redirecionando antes da hora). Omitir o
            // campo continua significando "nasce ativo".
            active: body.active === undefined ? true : (body.active === true || body.active === 'true'),
            notes: body.notes ? String(body.notes).trim() : null
        };
        const data = await TrackedLinkService.createLink(dados, req.user);
        res.json({ success: true, data });
    } catch (err) { next(err); }
});

adminRouter.get('/:id', authenticate, async (req, res, next) => {
    try {
        const link = await TrackedLinkService.getLink(req.params.id);
        if (!link) throw erro(404, 'Link não encontrado.');
        res.json(link);
    } catch (err) { next(err); }
});

adminRouter.put('/:id', authenticate, async (req, res, next) => {
    try {
        const body = req.body || {};
        const dados = {};
        if (body.name !== undefined) dados.name = validarNome(body.name);
        if (body.destination !== undefined) dados.destination = validarDestino(body.destination);
        if (body.active !== undefined) dados.active = body.active === true || body.active === 'true';
        if (body.notes !== undefined) dados.notes = body.notes ? String(body.notes).trim() : null;
        if (Object.keys(dados).length === 0) throw erro(400, 'Nada para atualizar.');

        const data = await TrackedLinkService.updateLink(req.params.id, dados, req.user);
        res.json({ success: true, data });
    } catch (err) { next(err); }
});

adminRouter.delete('/:id', authenticate, async (req, res, next) => {
    try {
        await TrackedLinkService.deleteLink(req.params.id);
        res.json({ success: true });
    } catch (err) { next(err); }
});

adminRouter.get('/:id/analytics', authenticate, async (req, res, next) => {
    try {
        const data = await TrackedLinkService.analytics(req.params.id, {
            from: req.query.from || null,
            to: req.query.to || null
        });
        res.json(data);
    } catch (err) { next(err); }
});

adminRouter.get('/:id/hits', authenticate, async (req, res, next) => {
    try {
        const limitBruto = parseInt(req.query.limit, 10);
        const offsetBruto = parseInt(req.query.offset, 10);
        const data = await TrackedLinkService.listHits(req.params.id, {
            limit: Number.isFinite(limitBruto) ? Math.min(Math.max(limitBruto, 1), 500) : 50,
            offset: Number.isFinite(offsetBruto) && offsetBruto > 0 ? offsetBruto : 0,
            from: req.query.from || null,
            to: req.query.to || null
        });
        res.json(data);
    } catch (err) { next(err); }
});

// Exporta os acessos do período em CSV (Excel abre direto — separador ';' e BOM).
adminRouter.get('/:id/export', authenticate, async (req, res, next) => {
    try {
        const link = await TrackedLinkService.getLink(req.params.id);
        if (!link) throw erro(404, 'Link não encontrado.');

        // hitsCsv devolve { csv, total, truncado, limite } — o corte deixou de ser silencioso.
        const { csv, total, truncado, limite } = await TrackedLinkService.hitsCsv(req.params.id, {
            from: req.query.from || null,
            to: req.query.to || null
        });

        // O slug já é validado na criação; a limpeza aqui é só defesa do header.
        const slugArquivo = String(link.slug || 'link').replace(/[^a-z0-9-]/gi, '') || 'link';
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="scans-${slugArquivo}-${dataDeHoje()}.csv"`);
        if (truncado) {
            // Expose-Headers porque o front baixa via fetch em outro domínio (Firebase → Railway).
            res.set('X-Export-Truncado', 'true');
            res.set('X-Export-Total', String(total));
            res.set('X-Export-Limite', String(limite));
            res.set('Access-Control-Expose-Headers', 'X-Export-Truncado, X-Export-Total, X-Export-Limite');
        }
        res.send(csv);
    } catch (err) { next(err); }
});

module.exports = { adminRouter, publicRouter };

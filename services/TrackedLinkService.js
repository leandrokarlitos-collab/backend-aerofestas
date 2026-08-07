/**
 * TrackedLinkService — encurtador próprio e rastreável (substitui o Bitly pago).
 *
 * O QR impresso aponta para /r/<slug>; a página de redirecionamento chama a rota
 * pública, que registra o acesso aqui e devolve o destino ATUAL do link.
 * O hit guarda slug e destino desnormalizados: se o dono trocar o destino depois,
 * o histórico continua mostrando para onde cada acesso realmente foi.
 *
 * Toda a agregação é feita em JS (findMany + reduce), como no PropostaTrackService.
 */
const prisma = require('../prisma/client');

// Fuso do relatório — o dono está no Brasil, então os dias/horas do painel são de São Paulo,
// não do UTC do banco. Sem isso, um acesso às 22h de sábado apareceria no domingo.
const TZ = 'America/Sao_Paulo';

const MAX_SLUG = 40;
const MAX_NAME = 120;
const MAX_DEST = 2000;
const MAX_NOTES = 2000;
const MAX_UA = 300;
const MAX_REF = 300;
const MAX_TXT = 120;
const MAX_DAYS_FILL = 1830;   // teto de segurança do preenchimento de byDay (~5 anos)
const MAX_CSV_ROWS = 20000;   // teto de linhas exportadas de uma vez
const MAX_ANALYTICS_ROWS = 200000; // teto de acessos lidos por relatório (protege a memória do processo)

// ---------------------------------------------------------------------------
// Helpers básicos
// ---------------------------------------------------------------------------

function str(v, max) {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s.slice(0, max) : null;
}

function intOrNull(v, min, max) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return null;
    return Math.max(min, Math.min(max, n));
}

function floatOrNull(v, min, max) {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return null;
    return Math.max(min, Math.min(max, n));
}

function boolOrFalse(v) {
    return v === true || v === 1 || v === '1' || v === 'true';
}

// IP do visitante. Fonte primária é req.ip: o server.js define app.set('trust proxy', 1),
// então o Express já descarta o X-Forwarded-For forjado pelo cliente e usa só o salto
// confiável (o proxy do Railway). Ler o header cru deixaria qualquer um mandar
// "X-Forwarded-For: 8.8.8.8" e envenenar cidade/UF e contagem do relatório.
// O header e o socket ficam só como último recurso (ex.: chamada sem Express na frente).
function clientIp(req) {
    if (!req) return null;
    if (req.ip) return String(req.ip).trim().slice(0, 60) || null;
    const xff = req.headers ? req.headers['x-forwarded-for'] : null;
    if (xff) return String(xff).split(',')[0].trim().slice(0, 60) || null;
    return (req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '').slice(0, 60) || null;
}

// Remove o prefixo IPv4-mapeado (::ffff:187.1.2.3) e colchetes de IPv6.
function normalizeIp(ip) {
    if (!ip) return null;
    let s = String(ip).trim();
    if (s.startsWith('[')) s = s.replace(/^\[|\]$/g, '');
    s = s.replace(/^::ffff:/i, '');
    s = s.split('%')[0]; // descarta zona de escopo (fe80::1%eth0)
    return s || null;
}

function err400(msg) {
    const e = new Error(msg);
    e.status = 400;
    return e;
}

function err404(msg) {
    const e = new Error(msg);
    e.status = 404;
    return e;
}

function err409(msg) {
    const e = new Error(msg);
    e.status = 409;
    return e;
}

// Nome de quem fez a ação, para createdBy/updatedBy/changedBy.
function actorName(user) {
    if (!user) return null;
    const v = user.name || user.email || user.id;
    return v ? String(v).slice(0, MAX_TXT) : null;
}

// ---------------------------------------------------------------------------
// Datas no fuso de São Paulo
// ---------------------------------------------------------------------------

const DTF_PARTS = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
});

const DTF_BR = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
});

// Quebra um instante UTC nas partes do relógio de São Paulo.
function spParts(date) {
    const p = {};
    for (const part of DTF_PARTS.formatToParts(date)) {
        if (part.type !== 'literal') p[part.type] = part.value;
    }
    return {
        ymd: `${p.year}-${p.month}-${p.day}`,
        hour: parseInt(p.hour, 10) % 24, // ICU pode devolver "24" para a meia-noite
        minute: parseInt(p.minute, 10),
        second: parseInt(p.second, 10)
    };
}

// Deslocamento (ms) do fuso de São Paulo naquele instante. Hoje é sempre -3h,
// mas o cálculo continua correto se o horário de verão voltar.
function spOffsetMs(date) {
    const p = spParts(date);
    const [y, m, d] = p.ymd.split('-').map(Number);
    const asUtc = Date.UTC(y, m - 1, d, p.hour, p.minute, p.second);
    return asUtc - (Math.floor(date.getTime() / 1000) * 1000);
}

// Converte um "relógio de parede" de São Paulo (em ms de Date.UTC) no instante UTC real.
function spWallToUtc(baseMs) {
    let off = spOffsetMs(new Date(baseMs));
    off = spOffsetMs(new Date(baseMs - off)); // refina na virada de horário de verão
    return new Date(baseMs - off);
}

// 'YYYY-MM-DD' → instante UTC do início (ou do fim, inclusivo) daquele dia em São Paulo.
function spDayBoundary(ymd, endOfDay) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
    if (!m) return null;
    const base = endOfDay
        ? Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999)
        : Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
    return spWallToUtc(base);
}

function ymdAddDays(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekdayOfYmd(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
}

// Monta o filtro de período do Prisma. `to` é INCLUSIVO (vai até 23:59:59.999).
function buildRange(from, to) {
    const gte = spDayBoundary(from, false);
    const lte = spDayBoundary(to, true);
    if (!gte && !lte) return null;
    const range = {};
    if (gte) range.gte = gte;
    if (lte) range.lte = lte;
    return range;
}

// ---------------------------------------------------------------------------
// parseUserAgent — regex próprias, sem dependência externa.
// A ORDEM importa: navegadores embutidos em apps e engines derivadas do Chrome
// precisam ser testadas antes dos genéricos (o UA do Chrome contém "Safari").
// ---------------------------------------------------------------------------

const EMPTY_UA = {
    deviceType: 'desconhecido',
    os: null,
    osVersion: null,
    browser: null,
    browserVersion: null,
    inApp: null
};

const NT_MAP = {
    '10.0': '10', // Windows 11 também se anuncia como NT 10.0
    '6.3': '8.1',
    '6.2': '8',
    '6.1': '7',
    '6.0': 'Vista',
    '5.2': 'XP',
    '5.1': 'XP'
};

function ver(match, idx) {
    if (!match || !match[idx]) return null;
    return String(match[idx]).replace(/_/g, '.').slice(0, 30);
}

function detectInApp(ua) {
    if (/FBAN|FBAV|FB_IAB|FBIOS|FBDV/i.test(ua)) return 'facebook';
    if (/Instagram/i.test(ua)) return 'instagram';
    if (/WhatsApp/i.test(ua)) return 'whatsapp';
    if (/(?:^|[\s;(])Line\/[\d.]/i.test(ua)) return 'line';
    return null;
}

function detectBrowser(ua) {
    let m;
    if ((m = /Edg(?:A|iOS|e)?\/([\d.]+)/i.exec(ua))) return { browser: 'Edge', browserVersion: ver(m, 1) };
    if ((m = /(?:OPR|OPiOS|Opera Mini|Opera)\/([\d.]+)/i.exec(ua))) return { browser: 'Opera', browserVersion: ver(m, 1) };
    if ((m = /SamsungBrowser\/([\d.]+)/i.exec(ua))) return { browser: 'Samsung Internet', browserVersion: ver(m, 1) };
    if ((m = /(?:Firefox|FxiOS)\/([\d.]+)/i.exec(ua))) return { browser: 'Firefox', browserVersion: ver(m, 1) };
    if ((m = /(?:UCBrowser|UBrowser)\/([\d.]+)/i.exec(ua))) return { browser: 'UC Browser', browserVersion: ver(m, 1) };
    if ((m = /CriOS\/([\d.]+)/i.exec(ua))) return { browser: 'Chrome', browserVersion: ver(m, 1) };
    if ((m = /(?:Chrome|Chromium)\/([\d.]+)/i.exec(ua))) return { browser: 'Chrome', browserVersion: ver(m, 1) };
    if (/Safari/i.test(ua)) {
        m = /Version\/([\d.]+)/i.exec(ua);
        return { browser: 'Safari', browserVersion: ver(m, 1) };
    }
    return { browser: null, browserVersion: null };
}

function detectOs(ua) {
    let m;
    // iOS/iPadOS antes de macOS: o UA do iPhone contém "like Mac OS X".
    if (/iPhone|iPad|iPod/i.test(ua)) {
        m = /(?:iPhone )?OS (\d+[._]\d+(?:[._]\d+)?)/i.exec(ua);
        return { os: /iPad/i.test(ua) ? 'iPadOS' : 'iOS', osVersion: ver(m, 1) };
    }
    // Android antes de Linux: o UA do Android contém "Linux".
    if (/Android/i.test(ua)) {
        m = /Android[ /]?(\d+(?:\.\d+)*)/i.exec(ua);
        return { os: 'Android', osVersion: ver(m, 1) };
    }
    // ChromeOS antes de Linux: o UA do CrOS contém "X11".
    if (/CrOS/i.test(ua)) {
        m = /CrOS \S+ ([\d.]+)/i.exec(ua);
        return { os: 'ChromeOS', osVersion: ver(m, 1) };
    }
    if (/Windows/i.test(ua)) {
        m = /Windows NT ([\d.]+)/i.exec(ua);
        const nt = m ? m[1] : null;
        return { os: 'Windows', osVersion: nt ? (NT_MAP[nt] || nt) : null };
    }
    if (/Mac OS X|Macintosh/i.test(ua)) {
        m = /Mac OS X (\d+[._]\d+(?:[._]\d+)?)/i.exec(ua);
        return { os: 'macOS', osVersion: ver(m, 1) };
    }
    if (/Linux|X11/i.test(ua)) return { os: 'Linux', osVersion: null };
    return { os: null, osVersion: null };
}

function detectDevice(ua) {
    const android = /Android/i.test(ua);
    if (/iPad/i.test(ua) || (android && !/Mobi/i.test(ua)) || /Tablet/i.test(ua)) return 'tablet';
    if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'mobile';
    return 'desktop';
}

/**
 * Extrai dispositivo/SO/navegador de um User-Agent.
 * UA vazio → todos os campos null e deviceType 'desconhecido'.
 */
function parseUserAgent(ua) {
    const s = ua == null ? '' : String(ua).trim();
    if (!s) return { ...EMPTY_UA };

    const { os, osVersion } = detectOs(s);
    const { browser, browserVersion } = detectBrowser(s);
    const inApp = detectInApp(s);

    return {
        deviceType: detectDevice(s),
        os,
        osVersion,
        // Instagram/Facebook no iOS não mandam token de navegador: é uma WebView.
        // Melhor mostrar "WebView" que "(não informado)" no relatório.
        browser: browser || (inApp ? 'WebView' : null),
        browserVersion,
        inApp
    };
}

// ---------------------------------------------------------------------------
// Registro do acesso
// ---------------------------------------------------------------------------

const EMPTY_GEO = {
    country: null, countryName: null, region: null, city: null,
    latitude: null, longitude: null, geoTimezone: null
};

/**
 * Grava um acesso ao link. NUNCA lança — o redirecionamento do cliente é
 * mais importante que a estatística.
 * @param {object} link  registro TrackedLink já carregado (slug + destino vigente)
 * @param {object} payload dados coletados no navegador
 * @param {object} req   request Express (headers/socket)
 */
async function recordHit(link, payload, req) {
    try {
        if (!link || !link.id) return;
        const p = (payload && typeof payload === 'object') ? payload : {};

        const ip = normalizeIp(clientIp(req));
        const ipVersion = ip ? (ip.includes(':') ? 'v6' : 'v4') : null;
        const userAgent = str(req && req.headers ? req.headers['user-agent'] : null, MAX_UA);
        const ua = parseUserAgent(userAgent);

        // Geo por IP é sempre estimativa e nunca pode derrubar o registro.
        let geo = EMPTY_GEO;
        try {
            const found = ip ? await require('./GeoLookup').lookup(ip) : null;
            if (found && typeof found === 'object') geo = { ...EMPTY_GEO, ...found };
        } catch (e) {
            console.error('[trackedLink] falha no geo por IP:', e.message || e);
        }

        await prisma.trackedLinkHit.create({
            data: {
                linkId: link.id,
                // Desnormalizados de propósito: o histórico precisa continuar correto
                // depois que o dono trocar o destino do link.
                slug: str(link.slug, MAX_SLUG) || 'desconhecido',
                destination: str(link.destination, MAX_DEST),

                visitorId: str(p.visitorId, MAX_TXT),
                isReturning: boolOrFalse(p.returning),

                ip: str(ip, 60),
                ipVersion,
                asn: str(geo.asn, MAX_TXT),
                network: str(geo.network, MAX_TXT),

                country: str(geo.country, MAX_TXT),
                countryName: str(geo.countryName, MAX_TXT),
                region: str(geo.region, MAX_TXT),
                city: str(geo.city, MAX_TXT),
                latitude: floatOrNull(geo.latitude, -90, 90),
                longitude: floatOrNull(geo.longitude, -180, 180),
                geoTimezone: str(geo.geoTimezone, MAX_TXT),

                userAgent,
                deviceType: str(ua.deviceType, MAX_TXT),
                os: str(ua.os, MAX_TXT),
                osVersion: str(ua.osVersion, MAX_TXT),
                browser: str(ua.browser, MAX_TXT),
                browserVersion: str(ua.browserVersion, MAX_TXT),
                inApp: str(ua.inApp, MAX_TXT),

                screenW: intOrNull(p.screenW, 0, 20000),
                screenH: intOrNull(p.screenH, 0, 20000),
                dpr: floatOrNull(p.dpr, 0, 10),
                language: str(p.language, MAX_TXT),
                tzName: str(p.tzName, MAX_TXT),
                tzOffsetMin: intOrNull(p.tzOffsetMin, -900, 900),

                referrer: str(p.referrer, MAX_REF),
                utmSource: str(p.utmSource, MAX_TXT),
                utmMedium: str(p.utmMedium, MAX_TXT),
                utmCampaign: str(p.utmCampaign, MAX_TXT)
            }
        });
    } catch (err) {
        console.error('[trackedLink] falha ao registrar acesso:', err);
    }
}

// ---------------------------------------------------------------------------
// Cache de slug (caminho quente do QR)
// ---------------------------------------------------------------------------

// Cache em memória DO PROCESSO (não é compartilhado entre instâncias do Railway).
// Existe para tirar o findUnique do caminho do scan: no cold start do container a
// consulta ao banco sozinha já estoura o orçamento de 2,5s do r.html e o visitante
// cai no fallback. Como o TTL é de 30s, uma troca de destino feita em outra
// instância propaga em no máximo 30s mesmo sem invalidação explícita.
const SLUG_TTL_MS = 30 * 1000;      // slug encontrado
const SLUG_TTL_NEG_MS = 5 * 1000;   // slug inexistente: cache bem curto de propósito
const SLUG_CACHE_MAX = 500;         // teto simples: varredura de slugs aleatórios não pode crescer sem fim
const slugCache = new Map();        // slug → { id, destination, active, ts }

// Remove o slug do cache. Chamada no create/update/delete para a mudança valer na hora.
function invalidarCacheSlug(slug) {
    const s = String(slug ?? '').trim().toLowerCase();
    if (s) slugCache.delete(s);
}

/**
 * Busca o link pelo slug usando o cache do processo. Devolve null se não existir.
 * Só campos necessários ao redirecionamento + ao registro do acesso.
 */
async function findLinkBySlugCached(slugBruto) {
    const slug = String(slugBruto ?? '').trim().toLowerCase();
    if (!slug) return null;

    const agora = Date.now();
    const cached = slugCache.get(slug);
    if (cached && (agora - cached.ts) < (cached.id ? SLUG_TTL_MS : SLUG_TTL_NEG_MS)) {
        return cached.id
            ? { id: cached.id, slug, destination: cached.destination, active: cached.active }
            : null;
    }

    const link = await prisma.trackedLink.findUnique({ where: { slug } });

    if (slugCache.size >= SLUG_CACHE_MAX) slugCache.clear();
    slugCache.set(slug, link
        ? { id: link.id, destination: link.destination, active: link.active, ts: agora }
        : { id: null, destination: null, active: false, ts: agora });

    return link;
}

// ---------------------------------------------------------------------------
// CRUD dos links
// ---------------------------------------------------------------------------

// Normaliza antes de validar: minúsculas, sem acento, espaços viram hífen.
function normalizeSlug(raw) {
    if (raw == null) return '';
    return String(raw)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[\s_.]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_SLUG);
}

function validSlug(slug) {
    return /^[a-z0-9][a-z0-9-]{1,39}$/.test(slug);
}

function normalizeDestination(raw) {
    const d = str(raw, MAX_DEST);
    if (!d) throw err400('Informe o destino do link.');
    if (!/^https?:\/\/\S/i.test(d)) {
        throw err400('O destino precisa começar com http:// ou https://');
    }
    return d;
}

function prepareSlug(raw) {
    const slug = normalizeSlug(raw);
    if (!slug) throw err400('Informe o apelido (slug) do link.');
    if (!validSlug(slug)) {
        throw err400('Apelido inválido. Use de 2 a 40 caracteres: letras minúsculas, números e hífen.');
    }
    return slug;
}

async function assertSlugLivre(slug, ignoreId) {
    const existing = await prisma.trackedLink.findUnique({ where: { slug } });
    if (existing && existing.id !== ignoreId) {
        throw err409(`O apelido "${slug}" já está em uso por outro link.`);
    }
}

/**
 * Lista todos os links com totalHits / uniqueVisitors / lastHitAt.
 * Duas consultas agregadas — sem N+1.
 */
async function listLinks() {
    const links = await prisma.trackedLink.findMany({ orderBy: { createdAt: 'desc' } });
    if (!links.length) return [];

    const [totals, visitors] = await Promise.all([
        prisma.trackedLinkHit.groupBy({
            by: ['linkId'],
            _count: { _all: true },
            _max: { createdAt: true }
        }),
        prisma.trackedLinkHit.groupBy({
            by: ['linkId', 'visitorId'],
            where: { visitorId: { not: null } }
        })
    ]);

    const totalMap = new Map();
    for (const t of totals) {
        totalMap.set(t.linkId, {
            totalHits: t._count ? t._count._all : 0,
            lastHitAt: t._max ? t._max.createdAt : null
        });
    }

    const uniqueMap = new Map();
    for (const v of visitors) {
        uniqueMap.set(v.linkId, (uniqueMap.get(v.linkId) || 0) + 1);
    }

    return links.map(link => {
        const t = totalMap.get(link.id) || { totalHits: 0, lastHitAt: null };
        return {
            ...link,
            totalHits: t.totalHits,
            uniqueVisitors: uniqueMap.get(link.id) || 0,
            lastHitAt: t.lastHitAt
        };
    });
}

/**
 * Um link com o histórico de trocas de destino. Devolve null se não existir.
 */
async function getLink(id) {
    const linkId = str(id, 60);
    if (!linkId) return null;

    const link = await prisma.trackedLink.findUnique({
        where: { id: linkId },
        include: { changes: { orderBy: { createdAt: 'desc' }, take: 50 } }
    });
    if (!link) return null;

    const [totalHits, visitors, last] = await Promise.all([
        prisma.trackedLinkHit.count({ where: { linkId } }),
        prisma.trackedLinkHit.groupBy({
            by: ['visitorId'],
            where: { linkId, visitorId: { not: null } }
        }),
        prisma.trackedLinkHit.findFirst({
            where: { linkId },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true }
        })
    ]);

    return {
        ...link,
        totalHits,
        uniqueVisitors: visitors.length,
        lastHitAt: last ? last.createdAt : null
    };
}

/**
 * Cria um link. Slug duplicado → err.status 409.
 */
async function createLink({ slug, name, destination, notes, active } = {}, user) {
    const finalSlug = prepareSlug(slug);
    const finalName = str(name, MAX_NAME);
    if (!finalName) throw err400('Informe o nome do link.');
    const finalDest = normalizeDestination(destination);

    await assertSlugLivre(finalSlug, null);

    const by = actorName(user);

    try {
        const saved = await prisma.trackedLink.create({
            data: {
                slug: finalSlug,
                name: finalName,
                destination: finalDest,
                notes: str(notes, MAX_NOTES),
                active: active === undefined ? true : boolOrFalse(active),
                createdBy: by,
                updatedBy: by
            }
        });

        // Registra o destino inicial no histórico (fromUrl null = criação).
        await prisma.trackedLinkChange.create({
            data: { linkId: saved.id, fromUrl: null, toUrl: saved.destination, changedBy: by }
        });

        // Derruba um eventual cache negativo (alguém pode ter acessado o slug antes de existir).
        invalidarCacheSlug(saved.slug);

        return saved;
    } catch (e) {
        if (e && e.code === 'P2002') throw err409(`O apelido "${finalSlug}" já está em uso por outro link.`);
        throw e;
    }
}

/**
 * Atualiza um link. Se o destino mudar, grava um TrackedLinkChange.
 */
async function updateLink(id, { slug, name, destination, notes, active } = {}, user) {
    const linkId = str(id, 60);
    if (!linkId) throw err400('ID inválido.');

    const existing = await prisma.trackedLink.findUnique({ where: { id: linkId } });
    if (!existing) throw err404('Link não encontrado.');

    const by = actorName(user);
    const data = { updatedBy: by };

    if (slug !== undefined) {
        const finalSlug = prepareSlug(slug);
        if (finalSlug !== existing.slug) {
            await assertSlugLivre(finalSlug, linkId);
            data.slug = finalSlug;
        }
    }

    if (name !== undefined) {
        const finalName = str(name, MAX_NAME);
        if (!finalName) throw err400('Informe o nome do link.');
        data.name = finalName;
    }

    let novoDestino = null;
    if (destination !== undefined) {
        const finalDest = normalizeDestination(destination);
        data.destination = finalDest;
        if (finalDest !== existing.destination) novoDestino = finalDest;
    }

    if (notes !== undefined) data.notes = str(notes, MAX_NOTES);
    if (active !== undefined) data.active = boolOrFalse(active);

    const ops = [prisma.trackedLink.update({ where: { id: linkId }, data })];
    if (novoDestino) {
        ops.push(prisma.trackedLinkChange.create({
            data: {
                linkId,
                fromUrl: existing.destination,
                toUrl: novoDestino,
                changedBy: by
            }
        }));
    }

    try {
        const [saved] = await prisma.$transaction(ops);
        // Invalida o slug ANTIGO e o NOVO: se houve renomeação, os dois estão errados no cache.
        invalidarCacheSlug(existing.slug);
        invalidarCacheSlug(saved.slug);
        return saved;
    } catch (e) {
        if (e && e.code === 'P2002') throw err409('Este apelido já está em uso por outro link.');
        throw e;
    }
}

/**
 * Exclui o link. Hits e histórico caem junto (onDelete: Cascade no schema).
 */
async function deleteLink(id) {
    const linkId = str(id, 60);
    if (!linkId) throw err400('ID inválido.');

    const existing = await prisma.trackedLink.findUnique({ where: { id: linkId } });
    if (!existing) throw err404('Link não encontrado.');

    await prisma.trackedLink.delete({ where: { id: linkId } });

    // Sem isso o slug apagado continuaria redirecionando por até 30s nesta instância.
    invalidarCacheSlug(existing.slug);
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

const VAZIO = '(não informado)';

function bump(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
}

// Map → [{ key, hits }] ordenado por hits DESC (empate: chave ASC).
function toList(map) {
    return [...map.entries()]
        .map(([key, hits]) => ({ key, hits }))
        .sort((a, b) => (b.hits - a.hits) || String(a.key).localeCompare(String(b.key), 'pt-BR'));
}

// Origem: host quando der para extrair, senão o valor cru. '(direto)' quando vazio.
function referrerKey(ref) {
    const r = str(ref, MAX_REF);
    if (!r) return '(direto)';
    try {
        const h = new URL(r).hostname;
        if (h) return h.replace(/^www\./i, '');
    } catch {
        // referrer sem esquema ou corrompido — usa o texto como veio
    }
    return r;
}

async function mustFindLink(id) {
    const linkId = str(id, 60);
    if (!linkId) throw err400('ID inválido.');
    const link = await prisma.trackedLink.findUnique({ where: { id: linkId } });
    if (!link) throw err404('Link não encontrado.');
    return link;
}

/**
 * Agrega os acessos do link no período. `from`/`to` são 'YYYY-MM-DD' opcionais
 * e `to` é INCLUSIVO. Datas e horas no fuso de São Paulo.
 */
async function analytics(id, { from, to } = {}) {
    const link = await mustFindLink(id);
    const range = buildRange(from, to);

    const where = { linkId: link.id };
    if (range) where.createdAt = range;

    // Teto de leitura: sem ele, um link muito acessado carregaria o período inteiro
    // na memória do processo. Ao bater no teto o relatório vira AMOSTRA (os acessos
    // mais antigos do período) e o campo `truncado` avisa a interface.
    const hits = await prisma.trackedLinkHit.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: MAX_ANALYTICS_ROWS,
        select: {
            createdAt: true, visitorId: true, isReturning: true,
            deviceType: true, os: true, browser: true, inApp: true,
            country: true, countryName: true, region: true, city: true,
            language: true, tzName: true, referrer: true
        }
    });

    const dayHits = new Map();      // ymd → hits
    const dayVisitors = new Map();  // ymd → Set(visitorId)
    const hourMap = new Map();
    const weekdayMap = new Map();
    const device = new Map();
    const os = new Map();
    const browser = new Map();
    const inApp = new Map();
    const country = new Map();
    const region = new Map();
    const city = new Map();
    const language = new Map();
    const timezone = new Map();
    const referrer = new Map();

    const visitors = new Set();
    let returningHits = 0;

    for (const h of hits) {
        const p = spParts(h.createdAt);

        dayHits.set(p.ymd, (dayHits.get(p.ymd) || 0) + 1);
        if (h.visitorId) {
            if (!dayVisitors.has(p.ymd)) dayVisitors.set(p.ymd, new Set());
            dayVisitors.get(p.ymd).add(h.visitorId);
            visitors.add(h.visitorId);
        }

        bump(hourMap, p.hour);
        bump(weekdayMap, weekdayOfYmd(p.ymd));
        if (h.isReturning) returningHits++;

        bump(device, str(h.deviceType, MAX_TXT) || VAZIO);
        bump(os, str(h.os, MAX_TXT) || VAZIO);
        bump(browser, str(h.browser, MAX_TXT) || VAZIO);
        bump(inApp, str(h.inApp, MAX_TXT) || '(navegador normal)');
        bump(country, str(h.countryName, MAX_TXT) || str(h.country, MAX_TXT) || VAZIO);
        bump(region, str(h.region, MAX_TXT) || VAZIO);

        const cidade = str(h.city, MAX_TXT);
        const uf = str(h.region, MAX_TXT);
        bump(city, cidade ? (uf ? `${cidade}/${uf}` : cidade) : VAZIO);

        bump(language, str(h.language, MAX_TXT) || VAZIO);
        bump(timezone, str(h.tzName, MAX_TXT) || VAZIO);
        bump(referrer, referrerKey(h.referrer));
    }

    // byDay preenchido dia a dia: o gráfico precisa mostrar os buracos como zero.
    // O período considerado é o filtro informado; sem filtro, do primeiro ao último acesso.
    const diasComHit = [...dayHits.keys()].sort();
    const inicio = (from && spDayBoundary(from, false)) ? String(from).trim() : (diasComHit[0] || null);
    const fim = (to && spDayBoundary(to, true)) ? String(to).trim() : (diasComHit[diasComHit.length - 1] || null);

    const byDay = [];
    if (inicio && fim && inicio <= fim) {
        let cursor = inicio;
        let guard = 0;
        while (cursor <= fim && guard++ < MAX_DAYS_FILL) {
            const set = dayVisitors.get(cursor);
            byDay.push({ key: cursor, hits: dayHits.get(cursor) || 0, uniques: set ? set.size : 0 });
            cursor = ymdAddDays(cursor, 1);
        }
    }

    const byHour = [];
    for (let h = 0; h < 24; h++) byHour.push({ key: h, hits: hourMap.get(h) || 0 });

    const byWeekday = [];
    for (let d = 0; d < 7; d++) byWeekday.push({ key: d, hits: weekdayMap.get(d) || 0 });

    return {
        totals: {
            hits: hits.length,
            uniqueVisitors: visitors.size,
            returningHits,
            firstHitAt: hits.length ? hits[0].createdAt : null,
            lastHitAt: hits.length ? hits[hits.length - 1].createdAt : null
        },
        truncado: hits.length >= MAX_ANALYTICS_ROWS,
        amostraDe: hits.length,
        byDay,
        byHour,
        byWeekday,
        byDevice: toList(device),
        byOs: toList(os),
        byBrowser: toList(browser),
        byInApp: toList(inApp),
        byCountry: toList(country),
        byRegion: toList(region),
        byCity: toList(city),
        byLanguage: toList(language),
        byTimezone: toList(timezone),
        byReferrer: toList(referrer)
    };
}

/**
 * Lista paginada dos acessos (mais recentes primeiro).
 */
async function listHits(id, { limit, offset, from, to } = {}) {
    const link = await mustFindLink(id);
    const range = buildRange(from, to);

    const where = { linkId: link.id };
    if (range) where.createdAt = range;

    const take = intOrNull(limit, 1, 500) || 50;
    const skip = intOrNull(offset, 0, 1000000) || 0;

    const [total, items] = await Promise.all([
        prisma.trackedLinkHit.count({ where }),
        prisma.trackedLinkHit.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take,
            skip
        })
    ]);

    return { total, items };
}

// ---------------------------------------------------------------------------
// Exportação CSV (Excel pt-BR: separador ';' e BOM UTF-8)
// ---------------------------------------------------------------------------

const CSV_HEADERS = [
    'Data/hora', 'Cidade', 'UF', 'País', 'Dispositivo', 'Sistema', 'Navegador',
    'Dentro de app', 'Idioma', 'Fuso', 'Tela', 'Visitante', 'Recorrente',
    'Origem', 'Destino', 'IP'
];

function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells) {
    return cells.map(csvCell).join(';');
}

function dataHoraBr(date) {
    if (!date) return '';
    return DTF_BR.format(date).replace(', ', ' ');
}

function juntar(a, b) {
    const x = str(a, MAX_TXT);
    const y = str(b, MAX_TXT);
    if (!x) return y || '';
    return y ? `${x} ${y}` : x;
}

/**
 * CSV dos acessos do link no período, pronto para abrir no Excel em pt-BR.
 * Devolve { csv, total, truncado, limite } — `total` é quantos acessos existem no
 * período e `truncado` avisa que o arquivo tem só os `limite` mais recentes.
 * O corte não pode ser silencioso: o dono precisa saber que o CSV não é o período inteiro.
 */
async function hitsCsv(id, { from, to } = {}) {
    const link = await mustFindLink(id);
    const range = buildRange(from, to);

    const where = { linkId: link.id };
    if (range) where.createdAt = range;

    const [total, hits] = await Promise.all([
        prisma.trackedLinkHit.count({ where }),
        prisma.trackedLinkHit.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: MAX_CSV_ROWS
        })
    ]);

    const linhas = [csvRow(CSV_HEADERS)];

    for (const h of hits) {
        const tela = (h.screenW || h.screenH) ? `${h.screenW || 0}x${h.screenH || 0}` : '';
        linhas.push(csvRow([
            dataHoraBr(h.createdAt),
            h.city || '',
            h.region || '',
            h.countryName || h.country || '',
            h.deviceType || '',
            juntar(h.os, h.osVersion),
            juntar(h.browser, h.browserVersion),
            h.inApp || '',
            h.language || '',
            h.tzName || '',
            tela,
            h.visitorId || '',
            h.isReturning ? 'Sim' : 'Não',
            h.referrer || '',
            h.destination || '',
            h.ip || ''
        ]));
    }

    // BOM UTF-8 no início: sem ele o Excel pt-BR abre "São Paulo" como "SÃ£o Paulo".
    return {
        csv: '\uFEFF' + linhas.join('\r\n') + '\r\n',
        total,
        truncado: total > hits.length,
        limite: MAX_CSV_ROWS
    };
}

module.exports = {
    parseUserAgent,
    recordHit,
    findLinkBySlugCached,
    invalidarCacheSlug,
    listLinks,
    getLink,
    createLink,
    updateLink,
    deleteLink,
    analytics,
    listHits,
    hitsCsv
};

/**
 * PropostaTrackService — analytics leve das propostas estáticas (/p/<slug>).
 * Grava eventos anônimos por sessão (view/scroll/click/end) e agrega por proposta.
 * Nunca lança para o cliente: o beacon é fire-and-forget.
 */
const prisma = require('../prisma/client');

const VALID_TYPES = new Set(['view', 'scroll', 'click', 'end']);

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

function clientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim().slice(0, 60) || null;
    return (req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '').slice(0, 60) || null;
}

/**
 * Registra um evento. `payload` vem do beacon do navegador; `req` traz UA/IP.
 * Retorna true se gravou, false se ignorado (payload inválido).
 */
async function record(payload, req) {
    const type = String(payload && payload.type || '').toLowerCase();
    if (!VALID_TYPES.has(type)) return false;
    const slug = str(payload.slug, 80);
    if (!slug) return false;

    await prisma.propostaTrack.create({
        data: {
            slug,
            sessionId: str(payload.sessionId, 60) || 'anon',
            visitor: str(payload.visitor, 80),
            type,
            label: str(payload.label, 120),
            scrollPct: intOrNull(payload.scrollPct, 0, 100),
            durationMs: intOrNull(payload.durationMs, 0, 24 * 60 * 60 * 1000),
            referrer: str(payload.referrer, 300),
            userAgent: str(req.headers['user-agent'], 300),
            ip: clientIp(req)
        }
    });
    return true;
}

function deviceFromUA(ua) {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(ua || '') ? 'mobile' : 'desktop';
}

/**
 * Agrega os eventos de um slug em sessões + totais para o painel admin.
 */
async function summary(slug) {
    const events = await prisma.propostaTrack.findMany({
        where: { slug },
        orderBy: { createdAt: 'asc' }
    });

    const sessions = new Map();
    for (const e of events) {
        let s = sessions.get(e.sessionId);
        if (!s) {
            s = {
                sessionId: e.sessionId,
                visitor: e.visitor || null,
                firstSeen: e.createdAt,
                lastSeen: e.createdAt,
                maxScroll: 0,
                durationMs: 0,
                sections: new Set(),
                clicks: [],
                userAgent: e.userAgent || null,
                ip: e.ip || null,
                referrer: e.referrer || null
            };
            sessions.set(e.sessionId, s);
        }
        s.lastSeen = e.createdAt;
        if (e.visitor && !s.visitor) s.visitor = e.visitor;
        if (e.referrer && !s.referrer) s.referrer = e.referrer;
        if (e.scrollPct != null && e.scrollPct > s.maxScroll) s.maxScroll = e.scrollPct;
        if (e.durationMs != null && e.durationMs > s.durationMs) s.durationMs = e.durationMs;
        if (e.type === 'scroll' && e.label && e.label !== 'depth') s.sections.add(e.label);
        if (e.type === 'click' && e.label) s.clicks.push({ label: e.label, at: e.createdAt });
    }

    const sessionList = [...sessions.values()].map(s => ({
        sessionId: s.sessionId,
        visitor: s.visitor,
        firstSeen: s.firstSeen,
        lastSeen: s.lastSeen,
        maxScroll: s.maxScroll,
        durationMs: s.durationMs,
        sections: [...s.sections],
        clicks: s.clicks,
        device: deviceFromUA(s.userAgent),
        ip: s.ip,
        referrer: s.referrer
    })).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

    const clicksByLabel = {};
    for (const s of sessionList) {
        for (const c of s.clicks) clicksByLabel[c.label] = (clicksByLabel[c.label] || 0) + 1;
    }

    const totals = {
        totalOpens: events.filter(e => e.type === 'view').length,
        uniqueSessions: sessionList.length,
        identifiedVisitors: [...new Set(sessionList.map(s => s.visitor).filter(Boolean))],
        lastOpenedAt: sessionList.length ? sessionList[0].lastSeen : null,
        avgMaxScroll: sessionList.length
            ? Math.round(sessionList.reduce((a, s) => a + s.maxScroll, 0) / sessionList.length)
            : 0,
        reached100: sessionList.filter(s => s.maxScroll >= 100).length,
        clicksByLabel
    };

    return { slug, totals, sessions: sessionList, eventCount: events.length };
}

module.exports = { record, summary };

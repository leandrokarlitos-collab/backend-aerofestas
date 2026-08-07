/**
 * GeoLookup — geolocalização aproximada por IP, 100% OFFLINE.
 *
 * Por que offline: a base do `fast-geoip` fica em disco, dentro do node_modules.
 * O IP do visitante NUNCA sai do servidor — não há chamada HTTP para serviço externo,
 * então não há custo por consulta, não há latência de rede e não há vazamento de dado
 * pessoal para terceiros.
 *
 * Por que fail-soft: este serviço alimenta o redirecionamento público /r/<slug>, que
 * responde a um QR Code já impresso em panfleto. Nenhuma falha aqui (pacote ausente,
 * base corrompida, IP maluco) pode derrubar o backend nem atrasar o redirecionamento.
 * Em qualquer erro devolvemos todos os campos como null e seguimos a vida.
 */

/** Objeto de retorno vazio — reutilizado sempre que não há dado de geo. */
const EMPTY_GEO = Object.freeze({
    country: null,
    countryName: null,
    region: null,
    city: null,
    latitude: null,
    longitude: null,
    geoTimezone: null
});

/** Cópia nova do vazio (o chamador pode querer mesclar/alterar o objeto). */
function emptyGeo() {
    return Object.assign({}, EMPTY_GEO);
}

// Carga preguiçosa do pacote: só resolvemos o require na primeira consulta e
// guardamos o resultado no módulo. Se falhar, avisamos UMA vez e desligamos de vez.
let geoip = null;
let geoipCarregado = false;
let geoipIndisponivel = false;

function getGeoip() {
    if (geoipCarregado) return geoip;
    geoipCarregado = true;
    try {
        geoip = require('fast-geoip');
        if (!geoip || typeof geoip.lookup !== 'function') {
            throw new Error('fast-geoip sem método lookup()');
        }
    } catch (err) {
        geoip = null;
        geoipIndisponivel = true;
        console.warn('[GeoLookup] base de geolocalização indisponível, seguindo sem geo:', err.message);
    }
    return geoip;
}

/** Países mais prováveis no nosso público; o resto cai no próprio código ISO. */
const NOMES_PAISES = {
    BR: 'Brasil',
    PT: 'Portugal',
    US: 'Estados Unidos',
    AR: 'Argentina',
    ES: 'Espanha',
    PY: 'Paraguai',
    UY: 'Uruguai',
    CL: 'Chile',
    FR: 'França',
    DE: 'Alemanha',
    IT: 'Itália',
    GB: 'Reino Unido',
    CA: 'Canadá',
    MX: 'México',
    CO: 'Colômbia',
    JP: 'Japão',
    CN: 'China'
};

/** String vazia (o fast-geoip devolve '' quando não sabe) vira null. */
function str(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
}

/** Número finito ou null (evita gravar NaN no Float? do Prisma). */
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Normaliza o IP que chega do proxy/socket:
 * remove espaços, colchetes de IPv6, porta, zona (%eth0) e o prefixo IPv6-mapeado '::ffff:'.
 */
function normalizarIp(ip) {
    let s = String(ip == null ? '' : ip).trim();
    if (!s) return '';

    // Forma "[2001:db8::1]:443" ou "[2001:db8::1]"
    if (s.startsWith('[')) {
        const fim = s.indexOf(']');
        s = fim > 0 ? s.slice(1, fim) : s.slice(1);
    }

    // "1.2.3.4:8080" — só corta a porta quando há UM único ':' (IPv6 tem vários)
    if (s.indexOf('.') !== -1 && s.split(':').length === 2) {
        s = s.split(':')[0];
    }

    // Zona de link-local do IPv6: "fe80::1%eth0"
    const pctIdx = s.indexOf('%');
    if (pctIdx !== -1) s = s.slice(0, pctIdx);

    // IPv4 embrulhado em IPv6: "::ffff:189.1.2.3"
    if (s.toLowerCase().startsWith('::ffff:')) s = s.slice(7);

    return s.trim();
}

const RE_IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * IP privado, local, reservado ou inválido? Nesses casos não adianta consultar a base.
 * Cobre 127.*, 10.*, 192.168.*, 172.16-31.*, 169.254.*, ::1, fc00::/7 e fe80::/10.
 */
function ipIgnoravel(ip) {
    if (!ip) return true;

    const m = ip.match(RE_IPV4);
    if (m) {
        const o = [+m[1], +m[2], +m[3], +m[4]];
        if (o.some(n => n > 255)) return true;              // IPv4 malformado
        if (o[0] === 0) return true;                        // 0.0.0.0/8
        if (o[0] === 127) return true;                      // loopback
        if (o[0] === 10) return true;                       // privado classe A
        if (o[0] === 192 && o[1] === 168) return true;      // privado classe C
        if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // privado classe B
        if (o[0] === 169 && o[1] === 254) return true;      // link-local
        return false;
    }

    // A partir daqui só aceitamos algo com cara de IPv6
    const v6 = ip.toLowerCase();
    if (v6.indexOf(':') === -1) return true;                // nem IPv4 nem IPv6
    if (!/^[0-9a-f:.]+$/.test(v6)) return true;             // caractere inválido
    if (v6 === '::1' || v6 === '::') return true;           // loopback / indefinido
    if (/^f[cd]/.test(v6)) return true;                     // fc00::/7 (unique local)
    if (/^fe[89ab]/.test(v6)) return true;                  // fe80::/10 (link-local)
    return false;
}

/**
 * Consulta a geolocalização aproximada de um IP.
 * NUNCA lança: em qualquer problema devolve o objeto com todos os campos null.
 *
 * @param {string} ip IP bruto (pode vir com porta, colchetes ou prefixo ::ffff:)
 * @returns {Promise<{country:string|null,countryName:string|null,region:string|null,
 *                    city:string|null,latitude:number|null,longitude:number|null,
 *                    geoTimezone:string|null}>}
 */
async function lookup(ip) {
    try {
        if (geoipIndisponivel) return emptyGeo();

        const limpo = normalizarIp(ip);
        if (ipIgnoravel(limpo)) return emptyGeo();

        const lib = getGeoip();
        if (!lib) return emptyGeo();

        const geo = await lib.lookup(limpo);
        if (!geo) return emptyGeo();

        const country = str(geo.country);
        const ll = Array.isArray(geo.ll) ? geo.ll : [];

        return {
            country,
            countryName: country ? (NOMES_PAISES[country.toUpperCase()] || country) : null,
            region: str(geo.region),
            city: str(geo.city),
            latitude: num(ll[0]),
            longitude: num(ll[1]),
            geoTimezone: str(geo.timezone)
        };
    } catch (err) {
        // Fail-soft: o hit ainda é gravado, só sem os campos de geo.
        console.warn('[GeoLookup] falha ao consultar IP, seguindo sem geo:', err.message);
        return emptyGeo();
    }
}

module.exports = { lookup, EMPTY_GEO };

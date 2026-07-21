// Helpers de datas de evento (multi-dia) compartilhados pelo backend.
//
// Convenções do projeto (as mesmas usadas em routes/finance.js e nos HTMLs):
// - datas são strings ISO 'YYYY-MM-DD' e são comparadas lexicograficamente, nunca com Date;
// - para enumerar dias usa-se `new Date(iso + 'T00:00:00')` (evita o shift de fuso do parse ISO)
//   e a formatação manual do dia — nunca toISOString();
// - endDate menor que date cai silenciosamente para evento de 1 dia nos LEITORES; a validação
//   dura fica nos pontos de ESCRITA (ver normalizeDateRange).

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Teto de dias aceito pelas rotas PÚBLICAS. Existe por dois motivos:
// erro de digitação no ano ("2926") viraria um evento de séculos, e a rota de
// disponibilidade é aberta — sem teto, uma requisição enumera milhões de dias.
// O admin não passa por aqui: pelo painel ele pode cadastrar o período que quiser.
const MAX_DIAS_PERIODO = 60;

function isIsoDate(v) {
    return typeof v === 'string' && ISO_DATE_RE.test(v);
}

// Aceita string JSON, array já parseado, null/undefined. Sempre devolve array de ISO válidas.
function parseExcludedDates(value) {
    if (!value) return [];
    let raw = value;
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch { return []; }
    }
    if (!Array.isArray(raw)) return [];
    return raw.filter(isIsoDate);
}

// Quantos dias tem [start, end] inclusive — por aritmética, sem materializar a lista.
// Serve de guarda antes de enumerar faixas potencialmente enormes.
function countDaysInRange(start, end) {
    if (!isIsoDate(start)) return 0;
    const last = isIsoDate(end) && end >= start ? end : start;
    const a = new Date(start + 'T00:00:00');
    const b = new Date(last + 'T00:00:00');
    return Math.round((b - a) / 86400000) + 1;
}

// Lista os dias de [start, end] inclusive, opcionalmente recortados pela janela
// [from, to]. O recorte existe para nunca materializar a faixa inteira de um evento
// muito longo quando só interessa o pedaço que cruza o período consultado.
function listDatesInRange(start, end, from, to) {
    if (!isIsoDate(start)) return [];
    let first = start;
    let last = isIsoDate(end) && end >= start ? end : start;
    if (isIsoDate(from) && from > first) first = from;
    if (isIsoDate(to) && to < last) last = to;
    if (first > last) return [];

    const out = [];
    const d = new Date(first + 'T00:00:00');
    const guard = new Date(last + 'T00:00:00');
    while (d <= guard) {
        out.push(
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        );
        d.setDate(d.getDate() + 1);
    }
    return out;
}

// Dias em que o evento realmente acontece: intervalo [date, endDate] menos excludedDates.
// Reuniões (eventType 'meeting') ocupam sempre um único dia.
// `from`/`to` recortam o resultado à janela de interesse (opcional).
function eventActiveDates(evt, from, to) {
    if (!evt || !isIsoDate(evt.date)) return [];
    if (evt.eventType === 'meeting') {
        const dentro = (!isIsoDate(from) || evt.date >= from) && (!isIsoDate(to) || evt.date <= to);
        return dentro ? [evt.date] : [];
    }
    const excluded = new Set(parseExcludedDates(evt.excludedDates));
    return listDatesInRange(evt.date, evt.endDate, from, to).filter(iso => !excluded.has(iso));
}

// Normaliza a faixa de datas nos pontos de escrita.
// Retorna { endDate, error }:
//   - endDate ausente/vazio/igual à data inicial  -> null (convenção: evento de 1 dia não guarda endDate)
//   - endDate anterior à data inicial              -> error preenchido (quem chama decide 400 ou descartar)
function normalizeDateRange(date, endDate) {
    if (endDate === undefined) return { endDate: undefined, error: null };
    const end = (endDate === null || endDate === '') ? null : endDate;
    if (end === null) return { endDate: null, error: null };
    if (!isIsoDate(end)) return { endDate: null, error: 'Data de término inválida.' };
    if (!isIsoDate(date)) return { endDate: null, error: 'Data de início inválida.' };
    if (end < date) return { endDate: null, error: 'A data de término não pode ser anterior à data de início.' };
    if (end === date) return { endDate: null, error: null };
    if (countDaysInRange(date, end) > MAX_DIAS_PERIODO) {
        return { endDate: null, error: `Período muito longo (máximo de ${MAX_DIAS_PERIODO} dias por aqui). Confira o ano digitado ou fale com o vendedor.` };
    }
    return { endDate: end, error: null };
}

// Remove das exclusões os dias que caíram fora da nova faixa (usado quando o período muda).
// Devolve null quando não sobra nenhuma exclusão, para não gravar '[]' à toa.
function pruneExcludedDates(excludedDates, date, endDate) {
    const inRange = new Set(listDatesInRange(date, endDate));
    const kept = parseExcludedDates(excludedDates).filter(iso => inRange.has(iso));
    return kept.length ? JSON.stringify(kept) : null;
}

module.exports = {
    MAX_DIAS_PERIODO,
    isIsoDate,
    parseExcludedDates,
    countDaysInRange,
    listDatesInRange,
    eventActiveDates,
    normalizeDateRange,
    pruneExcludedDates
};

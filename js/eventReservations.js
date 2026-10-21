(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.EventReservations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const json = (v, fallback) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || fallback); } catch { return fallback; } };
    const active = e => e.eventType !== 'meeting' && e.status !== 'cancelado' && e.paymentStatus !== 'Cancelado';
    const overlap = (a, b) => a.start < b.end && b.start < a.end;
    function days(start, end) {
        const out = [];
        const d = new Date(start + 'T00:00:00Z');
        while (Number.isFinite(+d) && out.length < 3700) {
            const iso = d.toISOString().slice(0, 10);
            if (iso > end) break;
            out.push(iso);
            d.setUTCDate(d.getUTCDate() + 1);
        }
        return out;
    }
    const quantities = items => (items || []).reduce((map, item) => {
        const id = item.toyId || item.toy?.id || item.id;
        map[id] = (map[id] || 0) + Number(item.quantity || 1);
        return map;
    }, {});
    function intervals(e) {
        if (!active(e) || !e.date) return [];
        const overrides = json(e.dateOverrides, {});
        const excluded = json(e.excludedDates, []);
        const base = e.items || e.toys || [];
        if (e.departureAt && e.availableAt) {
            const qty = quantities(base);
            for (const day of days(e.date, e.endDate || e.date).filter(d => !excluded.includes(d))) {
                const dayQty = quantities(overrides[day]?.items || base);
                for (const id in dayQty) qty[id] = Math.max(qty[id] || 0, dayQty[id]);
            }
            return [{ start: e.departureAt, end: e.availableAt, quantities: qty }];
        }
        return days(e.date, e.endDate || e.date).filter(d => !excluded.includes(d)).map(day => ({
            start: `${day}T${overrides[day]?.startTime || e.startTime || '00:00'}`,
            end: `${day}T${overrides[day]?.endTime || e.endTime || '24:00'}`,
            quantities: quantities(overrides[day]?.items || base)
        }));
    }
    function validate(e) {
        if (!e.departureAt && !e.availableAt) return null;
        const valid = v => /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(v || '') &&
            Number.isFinite(Date.parse(v + ':00Z')) && new Date(v + ':00Z').toISOString().slice(0, 16) === v;
        if (!valid(e.departureAt) || !valid(e.availableAt)) return 'Informe a data e a hora de saída e de liberação dos equipamentos.';
        if (e.departureAt >= e.availableAt) return 'A liberação deve ocorrer depois da saída.';
        if (days(e.departureAt.slice(0, 10), e.availableAt.slice(0, 10)).length >= 3700) return 'Período de deslocamento muito longo.';
        const normal = intervals({ ...e, departureAt: null, availableAt: null });
        if (normal.some(i => e.departureAt > i.start || e.availableAt < i.end)) return 'O deslocamento deve abranger todos os dias e horários do evento.';
        return null;
    }
    function travelOn(e, date) {
        if (!active(e) || !e.departureAt || !e.availableAt) return false;
        const day = { start: date + 'T00:00', end: date + 'T24:00' };
        const normal = intervals({ ...e, departureAt: null, availableAt: null });
        if (!normal.length) return false;
        return overlap(day, { start: e.departureAt, end: normal[0].start }) && e.departureAt < normal[0].start ||
            overlap(day, { start: normal[normal.length - 1].end, end: e.availableAt }) && normal[normal.length - 1].end < e.availableAt;
    }
    // Peak simultaneous quantity; adjacent bookings do not add together.
    function reserved(toyId, request, events) {
        const points = [];
        for (const event of events) for (const i of intervals(event)) {
            if (!overlap(request, i)) continue;
            const qty = i.quantities[toyId] || 0;
            points.push([i.start > request.start ? i.start : request.start, qty]);
            points.push([i.end < request.end ? i.end : request.end, -qty]);
        }
        points.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
        let current = 0, peak = 0;
        for (const [, delta] of points) { current += delta; peak = Math.max(peak, current); }
        return peak;
    }
    function conflict(event, others, toys) {
        if (!active(event)) return null;
        for (const request of intervals(event)) for (const id in request.quantities) {
            const toy = toys.find(t => String(t.id) === id);
            if (toy && request.quantities[id] + reserved(id, request, others) > toy.quantity) {
                return `Estoque insuficiente de ${toy.name} no período reservado (${request.start.replace('T', ' ')} a ${request.end.replace('T', ' ')}). Verifique os eventos e deslocamentos da Agenda.`;
            }
        }
        return null;
    }
    return { intervals, validate, travelOn, reserved, conflict, overlap, days };
});

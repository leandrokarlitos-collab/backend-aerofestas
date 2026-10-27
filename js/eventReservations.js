(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.EventReservations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const json = (v, fallback) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || fallback); } catch { return fallback; } };
    const active = e => !!e && e.eventType !== 'meeting' && e.status !== 'cancelado' && e.paymentStatus !== 'Cancelado';
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
        if (id !== undefined && id !== null && id !== '') {
            map[id] = (map[id] || 0) + Number(item.quantity || 1);
        }
        return map;
    }, {});

    function localIntervals(e) {
        if (!active(e) || !e.date) return [];
        const overrides = json(e.dateOverrides, {});
        const excluded = json(e.excludedDates, []);
        const base = e.items || e.toys || [];
        return days(e.date, e.endDate || e.date).filter(d => !excluded.includes(d)).map(day => ({
            start: `${day}T${overrides[day]?.startTime || e.startTime || '00:00'}`,
            end: `${day}T${overrides[day]?.endTime || e.endTime || '24:00'}`,
            quantities: quantities(overrides[day]?.items || base)
        }));
    }

    function eventPeakQuantities(e) {
        if (!active(e) || !e.date) return {};
        const overrides = json(e.dateOverrides, {});
        const excluded = json(e.excludedDates, []);
        const base = e.items || e.toys || [];
        const qty = quantities(base);
        for (const day of days(e.date, e.endDate || e.date).filter(d => !excluded.includes(d))) {
            const dayQty = quantities(overrides[day]?.items || base);
            for (const id in dayQty) qty[id] = Math.max(qty[id] || 0, dayQty[id]);
        }
        return qty;
    }

    function intervals(e) {
        if (!active(e) || !e.date) return [];
        if (e.departureAt && e.availableAt) {
            return [{ start: e.departureAt, end: e.availableAt, quantities: eventPeakQuantities(e) }];
        }
        return localIntervals(e);
    }

    function peakFromIntervalList(toyId, request, list) {
        const points = [];
        for (const i of list) {
            if (request && !overlap(request, i)) continue;
            const qty = i.quantities[toyId] || 0;
            if (!qty) continue;
            const start = request ? (i.start > request.start ? i.start : request.start) : i.start;
            const end = request ? (i.end < request.end ? i.end : request.end) : i.end;
            points.push([start, qty]);
            points.push([end, -qty]);
        }
        points.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
        let current = 0, peak = 0;
        for (const [, delta] of points) { current += delta; peak = Math.max(peak, current); }
        return peak;
    }

    // Carga embarcada consolidada para uma rota (pico simultâneo entre paradas, sem somar paradas em horários distintos)
    function routeCargo(routeEvents) {
        const activeEvents = (routeEvents || []).filter(active);
        const allLocal = [];
        const cargo = {};
        for (const ev of activeEvents) {
            const evPeak = eventPeakQuantities(ev);
            for (const id in evPeak) cargo[id] = Math.max(cargo[id] || 0, evPeak[id]);
            for (const li of localIntervals(ev)) allLocal.push(li);
        }
        for (const id in cargo) {
            cargo[id] = Math.max(cargo[id], peakFromIntervalList(id, null, allLocal));
        }
        return cargo;
    }

    function routeInterval(routeEvents, boundsOverride) {
        const activeEvents = (routeEvents || []).filter(active);
        if (!activeEvents.length) return [];
        let start = boundsOverride?.departureAt || null;
        let end = boundsOverride?.availableAt || null;
        for (const ev of activeEvents) {
            if (ev.departureAt && (!start || ev.departureAt < start)) start = ev.departureAt;
            if (ev.availableAt && (!end || ev.availableAt > end)) end = ev.availableAt;
        }
        if (!start || !end) {
            const out = [];
            for (const ev of activeEvents) for (const i of intervals(ev)) out.push(i);
            return out;
        }
        return [{ start, end, quantities: routeCargo(activeEvents) }];
    }

    function effectiveIntervals(events, sameRouteId) {
        const out = [];
        const routeGroups = new Map();
        const targetRoute = sameRouteId != null && sameRouteId !== '' ? String(sameRouteId) : null;

        for (const ev of (events || [])) {
            if (!active(ev)) continue;
            if (ev.routeId != null && ev.routeId !== '') {
                const key = String(ev.routeId);
                if (targetRoute && key === targetRoute) {
                    // Parada irmã da mesma rota: só bloqueia se coincidir no horário real do evento
                    for (const li of localIntervals(ev)) out.push(li);
                } else {
                    if (!routeGroups.has(key)) routeGroups.set(key, []);
                    routeGroups.get(key).push(ev);
                }
            } else {
                for (const i of intervals(ev)) out.push(i);
            }
        }
        for (const [, group] of routeGroups) {
            for (const ri of routeInterval(group)) out.push(ri);
        }
        return out;
    }

    function validate(e) {
        if (!e.departureAt && !e.availableAt) return null;
        const valid = v => /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(v || '') &&
            Number.isFinite(Date.parse(v + ':00Z')) && new Date(v + ':00Z').toISOString().slice(0, 16) === v;
        if (!valid(e.departureAt) || !valid(e.availableAt)) return 'Informe a data e a hora de saída e de liberação dos equipamentos.';
        if (e.departureAt >= e.availableAt) return 'A liberação deve ocorrer depois da saída.';
        if (days(e.departureAt.slice(0, 10), e.availableAt.slice(0, 10)).length >= 3700) return 'Período de deslocamento muito longo.';
        const normal = localIntervals(e);
        if (normal.some(i => e.departureAt > i.start || e.availableAt < i.end)) return 'O deslocamento deve abranger todos os dias e horários do evento.';
        return null;
    }

    function travelOn(e, date) {
        if (!active(e) || !e.departureAt || !e.availableAt) return false;
        const day = { start: date + 'T00:00', end: date + 'T24:00' };
        const normal = localIntervals(e);
        if (!normal.length) return false;
        return overlap(day, { start: e.departureAt, end: normal[0].start }) && e.departureAt < normal[0].start ||
            overlap(day, { start: normal[normal.length - 1].end, end: e.availableAt }) && normal[normal.length - 1].end < e.availableAt;
    }

    // Indica se uma rota (ou evento em rota/deslocamento) abrange o dia civil informado (saída..liberação inclusive)
    function routeSpanOn(routeOrEvent, date) {
        if (!routeOrEvent || !routeOrEvent.departureAt || !routeOrEvent.availableAt) return false;
        if ('eventType' in routeOrEvent && !active(routeOrEvent)) return false;
        return overlap({ start: date + 'T00:00', end: date + 'T24:00' }, { start: routeOrEvent.departureAt, end: routeOrEvent.availableAt });
    }

    // Peak simultaneous quantity; adjacent bookings do not add together; route stops share vehicle cargo.
    function reserved(toyId, request, events, options) {
        const sameRouteId = options?.routeId ?? request?.routeId ?? null;
        return peakFromIntervalList(toyId, request, effectiveIntervals(events, sameRouteId));
    }

    function conflict(event, others, toys) {
        if (!active(event)) return null;
        const hasRoute = event.routeId != null && event.routeId !== '';
        if (hasRoute) {
            const routeKey = String(event.routeId);
            const sameRoute = (others || []).filter(o => active(o) && o.routeId != null && String(o.routeId) === routeKey);
            const external = (others || []).filter(o => !active(o) || o.routeId == null || String(o.routeId) !== routeKey);

            // 1. Dentro da mesma rota, paradas em horários simultâneos não podem ultrapassar o estoque
            for (const req of localIntervals(event)) for (const id in req.quantities) {
                const toy = toys.find(t => String(t.id) === id);
                if (toy && req.quantities[id] + reserved(id, req, sameRoute, { routeId: event.routeId }) > toy.quantity) {
                    return `Estoque insuficiente de ${toy.name} entre paradas simultâneas da mesma rota (${req.start.replace('T', ' ')} a ${req.end.replace('T', ' ')}).`;
                }
            }

            // 2. Contra eventos fora da rota, a rota inteira reserva continuamente a sua carga embarcada
            for (const rReq of routeInterval([event, ...sameRoute])) for (const id in rReq.quantities) {
                const toy = toys.find(t => String(t.id) === id);
                if (toy && rReq.quantities[id] + reserved(id, rReq, external) > toy.quantity) {
                    return `Estoque insuficiente de ${toy.name} no período reservado da rota (${rReq.start.replace('T', ' ')} a ${rReq.end.replace('T', ' ')}). Verifique os eventos e deslocamentos da Agenda.`;
                }
            }
            return null;
        }

        for (const request of intervals(event)) for (const id in request.quantities) {
            const toy = toys.find(t => String(t.id) === id);
            if (toy && request.quantities[id] + reserved(id, request, others) > toy.quantity) {
                return `Estoque insuficiente de ${toy.name} no período reservado (${request.start.replace('T', ' ')} a ${request.end.replace('T', ' ')}). Verifique os eventos e deslocamentos da Agenda.`;
            }
        }
        return null;
    }

    return { intervals, localIntervals, routeCargo, routeInterval, routeSpanOn, validate, travelOn, reserved, conflict, overlap, days };
});

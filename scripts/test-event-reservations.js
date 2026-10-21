const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/eventReservations');
const event = {
    id: 1, date: '2026-10-24', startTime: '10:00', endTime: '18:00',
    departureAt: '2026-10-23T14:00', availableAt: '2026-10-25T16:00',
    items: [{ toyId: 7, quantity: 1 }]
};
const request = (start, end) => ({ start, end });
test('reserva ida, evento, noite e retorno continuamente', () => {
    for (const date of ['2026-10-23', '2026-10-24', '2026-10-25']) {
        assert.equal(R.reserved(7, request(date + 'T15:00', date + 'T16:00'), [event]), 1);
    }
    assert.equal(R.reserved(7, request('2026-10-24T01:00', '2026-10-24T02:00'), [event]), 1);
});
test('libera exatamente na hora de retorno e não bloqueia antes da saída', () => {
    assert.equal(R.reserved(7, request('2026-10-25T16:00', '2026-10-25T18:00'), [event]), 0);
    assert.equal(R.reserved(7, request('2026-10-23T12:00', '2026-10-23T14:00'), [event]), 0);
});
test('mostra caminhão em todos os dias de ida e retorno, inclusive dia do evento', () => {
    for (const date of ['2026-10-23', '2026-10-24', '2026-10-25']) assert.equal(R.travelOn(event, date), true);
    assert.equal(R.travelOn(event, '2026-10-26'), false);
    const multi = { ...event, endDate: '2026-10-26', availableAt: '2026-10-27T16:00' };
    assert.equal(R.travelOn(multi, '2026-10-25'), false);
    assert.equal(R.travelOn(multi, '2026-10-26'), true);
});
test('quantidades restantes podem ser reservadas', () => {
    const local = { date: '2026-10-23', startTime: '15:00', endTime: '17:00', items: [{ toyId: 7, quantity: 2 }] };
    assert.equal(R.conflict(local, [event], [{ id: 7, name: 'Castelo', quantity: 3 }]), null);
    assert.match(R.conflict(local, [event], [{ id: 7, name: 'Castelo', quantity: 2 }]), /Estoque insuficiente/);
});
test('reserva nova viagem contra evento local existente', () => {
    const local = { date: '2026-10-25', startTime: '15:00', endTime: '17:00', items: [{ toyId: 7, quantity: 1 }] };
    assert.match(R.conflict(event, [local], [{ id: 7, name: 'Castelo', quantity: 1 }]), /Estoque insuficiente/);
});
test('dias excluídos continuam bloqueados durante viagem e usam maior quantidade por dia', () => {
    const multi = { ...event, endDate: '2026-10-26', availableAt: '2026-10-27T16:00', excludedDates: '["2026-10-25"]', dateOverrides: { '2026-10-26': { items: [{ toyId: 7, quantity: 2 }] } } };
    assert.equal(R.reserved(7, request('2026-10-25T10:00', '2026-10-25T12:00'), [multi]), 2);
    assert.equal(R.reserved(7, request('2026-10-25T10:00', '2026-10-25T12:00'), [{ ...multi, departureAt: null, availableAt: null }]), 0);
});
test('reservas sequenciais não somam como se fossem simultâneas', () => {
    const base = { ...event, departureAt: null, availableAt: null };
    assert.equal(R.reserved(7, request('2026-10-24T08:00', '2026-10-24T22:00'), [
        { ...base, startTime: '10:00', endTime: '12:00' }, { ...base, startTime: '12:00', endTime: '14:00' }
    ]), 1);
});
test('cancelamentos e reuniões não reservam equipamentos', () => {
    for (const extra of [{ status: 'cancelado' }, { paymentStatus: 'Cancelado' }, { eventType: 'meeting' }]) {
        assert.deepEqual(R.intervals({ ...event, ...extra }), []);
        assert.equal(R.travelOn({ ...event, ...extra }, '2026-10-23'), false);
    }
});
test('valida campos incompletos, datas impossíveis e período que não abrange evento', () => {
    assert.equal(R.validate(event), null);
    for (const extra of [{ availableAt: null }, { departureAt: '2026-02-30T14:00' }, { departureAt: '2026-10-24T11:00' }, { availableAt: '2026-10-24T17:00' }]) assert.ok(R.validate({ ...event, ...extra }));
    assert.equal(R.validate({ ...event, departureAt: null, availableAt: null }), null);
});
test('horários específicos por dia devem caber no período de viagem', () => {
    assert.ok(R.validate({ ...event, dateOverrides: { '2026-10-24': { startTime: '09:00' } }, departureAt: '2026-10-24T09:30' }));
});

function serviceWith(database) {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../services/EventService'), 'utf8'), {
        module, console, process,
        require: name => {
            if (name === '../prisma/client') return database;
            if (name === '../js/eventReservations') return R;
            if (name === '../utils/eventDates') return require('../utils/eventDates');
            if (name === './audit') return { logAudit() {}, computeChanges() { return []; } };
            if (name === '../config/webpush' || name === './firebaseAdmin') return {};
            return require(name);
        }
    });
    return module.exports;
}
test('API pública encontra indisponibilidade em dia anterior ao evento', async () => {
    let query;
    const service = serviceWith({ event: { findMany: async q => { query = q; return [event]; } } });
    const result = await service.checkAvailability({ date: '2026-10-23', startTime: '15:00', endTime: '16:00' });
    assert.equal(result.available, false);
    assert.ok(query.where.OR[1].departureAt);
    assert.equal((await service.checkAvailability({ date: '2026-10-25', startTime: '16:00', endTime: '18:00' })).available, true);
});
test('servidor rejeita conflito antes de apagar os itens existentes', async () => {
    let writes = 0;
    const service = serviceWith({
        event: { findUnique: async () => null, findMany: async () => [event], upsert: async () => { writes++; } },
        toy: { findMany: async () => [{ id: 7, name: 'Castelo', quantity: 1 }] },
        eventItem: { deleteMany: async () => { writes++; } },
        eventExternalRental: { deleteMany: async () => { writes++; } }
    });
    await assert.rejects(service.upsertEvent({ id: 2, date: '2026-10-23', startTime: '15:00', endTime: '17:00', items: [{ toyId: 7, quantity: 1 }] }, { id: 1 }), e => e.status === 409);
    assert.equal(writes, 0);
});

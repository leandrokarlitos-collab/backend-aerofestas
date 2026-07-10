const express = require('express');
const router = express.Router();
const prisma = require('../prisma/client');
const { authenticateMonitor } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

// Todas as rotas exigem sessão de monitor ativa (monitorToken). O guard recheca
// acessoStatus='ativo' no banco a cada request (revogação instantânea).
router.use(authenticateMonitor);

// Data de hoje em America/Sao_Paulo no formato YYYY-MM-DD (Event.date é string local).
function hojeISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// Monta um endereço legível a partir dos campos do evento (sem PII financeira).
function montarEndereco(ev) {
    const linha1 = ev.clientAddress || ev.contractAddress || '';
    const partes = [ev.bairro, ev.cidade, ev.uf].filter(Boolean).join(', ');
    return [linha1, partes].filter(Boolean).join(' — ');
}

/**
 * GET /api/monitor/events
 * "Meus eventos": a escala do monitor logado, de hoje em diante.
 * Retorna também o estado atual de disponibilidade (para o toggle da home).
 */
router.get('/events', async (req, res) => {
    try {
        const monitorId = req.monitor.id;
        const hoje = hojeISO();

        const escalas = await prisma.eventAssignment.findMany({
            where: { monitorId },
            include: { event: true }
        });

        const eventos = escalas
            .filter(a => a.event) // defensivo
            .filter(a => (a.event.endDate || a.event.date || '') >= hoje) // hoje ou futuro
            .map(a => {
                const ev = a.event;
                const souMotorista = a.papel === 'motorista';
                const temGeo = ev.eventLat != null && ev.eventLng != null;
                // Regra: o DESTINO (endereço/mapa/horário do evento) só é exposto ao MOTORISTA.
                // O monitor comum vê apenas o horário de chegada no galpão — não precisa saber
                // o local (evita cálculo errado de antecedência); o local fica p/ controle interno.
                return {
                    assignmentId: a.id,
                    eventId: ev.id,
                    papel: a.papel,
                    souMotorista,
                    dia: a.dia,
                    date: ev.date,
                    endDate: ev.endDate,
                    horaChegadaGalpao: a.horaChegadaGalpao || null,
                    // Campos do destino: só para o motorista
                    startTime: souMotorista ? ev.startTime : null,
                    endTime: souMotorista ? ev.endTime : null,
                    titulo: souMotorista ? (ev.clientName || 'Evento') : null,
                    endereco: souMotorista ? montarEndereco(ev) : null,
                    eventLat: souMotorista ? ev.eventLat : null,
                    eventLng: souMotorista ? ev.eventLng : null,
                    mapsUrl: (souMotorista && temGeo) ? `https://www.google.com/maps/search/?api=1&query=${ev.eventLat},${ev.eventLng}` : null
                };
            })
            .sort((x, y) => (x.date || '').localeCompare(y.date || ''));

        res.json({
            disponivelAgora: !!req.monitor.disponivelAgora,
            eventos
        });
    } catch (error) {
        console.error('Erro meus-eventos:', error);
        res.status(500).json({ error: 'Erro ao carregar seus eventos.' });
    }
});

/**
 * PATCH /api/monitor/disponibilidade
 * Toggle "disponível para diária" (estilo Uber). body: { disponivel: boolean }
 */
router.patch('/disponibilidade', async (req, res) => {
    try {
        const disponivel = req.body?.disponivel === true;
        const atualizado = await prisma.monitor.update({
            where: { id: req.monitor.id },
            data: {
                disponivelAgora: disponivel,
                disponivelDesde: disponivel ? new Date() : null
            },
            select: { disponivelAgora: true, disponivelDesde: true }
        });

        logAudit({
            entityType: 'MonitorDisponibilidade',
            entityId: req.monitor.id,
            action: disponivel ? 'DISPONIVEL' : 'INDISPONIVEL',
            user: { id: 'monitor:' + req.monitor.id, name: req.monitor.nome, email: '' }
        });

        res.json(atualizado);
    } catch (error) {
        console.error('Erro disponibilidade:', error);
        res.status(500).json({ error: 'Erro ao atualizar disponibilidade.' });
    }
});

module.exports = router;

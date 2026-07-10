const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../prisma/client');
const { authenticateMonitor } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

// Sem fallback: o server.js aborta na inicialização se JWT_SECRET não existir.
const JWT_SECRET = process.env.JWT_SECRET;

// CPF pode estar salvo com máscara ("000.000.000-00") ou só dígitos —
// compara sempre pelos dígitos.
const soDigitos = (v) => String(v || '').replace(/\D/g, '');

/**
 * POST /api/monitor/auth/login
 * Login do monitor por CPF + senha. Emite JWT separado (role 'monitor')
 * que NENHUMA rota de gestor aceita.
 */
router.post('/login', async (req, res) => {
    try {
        const { cpf, senha } = req.body || {};
        const cpfDigitos = soDigitos(cpf);
        if (!cpfDigitos || !senha) {
            return res.status(400).json({ error: 'Informe CPF e senha.' });
        }

        // Poucos monitores têm credencial; busca os com senha e compara por dígitos
        // (cobre CPF gravado com ou sem máscara).
        const candidatos = await prisma.monitor.findMany({
            where: { senhaHash: { not: null }, cpf: { not: null } },
            select: { id: true, nome: true, cpf: true, senhaHash: true, acessoStatus: true }
        });
        const monitor = candidatos.find(m => soDigitos(m.cpf) === cpfDigitos);

        const RESPOSTA_GENERICA = { error: 'CPF ou senha inválidos, ou acesso não liberado.' };
        if (!monitor || !monitor.senhaHash) {
            return res.status(401).json(RESPOSTA_GENERICA);
        }

        const senhaOk = await bcrypt.compare(String(senha), monitor.senhaHash);
        if (!senhaOk) {
            return res.status(401).json(RESPOSTA_GENERICA);
        }

        // Credencial correta, mas conta ainda não liberada — só aqui revelamos o estado
        if (monitor.acessoStatus === 'pendente') {
            return res.status(403).json({ error: 'Seu acesso ainda não foi liberado pelo gestor.', code: 'PENDENTE' });
        }
        if (monitor.acessoStatus !== 'ativo') {
            return res.status(403).json({ error: 'Acesso não liberado.' });
        }

        const token = jwt.sign(
            { monitorId: monitor.id, role: 'monitor', nome: monitor.nome },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        await prisma.monitor.update({
            where: { id: monitor.id },
            data: { ultimoLoginApp: new Date() }
        });

        logAudit({
            entityType: 'MonitorAcesso',
            entityId: monitor.id,
            action: 'LOGIN',
            user: { id: 'monitor:' + monitor.id, name: monitor.nome, email: soDigitos(monitor.cpf) }
        });

        res.json({ token, monitor: { id: monitor.id, nome: monitor.nome } });
    } catch (error) {
        console.error('Erro login monitor:', error);
        res.status(500).json({ error: 'Erro ao fazer login.' });
    }
});

/**
 * GET /api/monitor/auth/me
 * Dados mínimos do monitor logado (nunca senha, saúde ou documentos).
 */
router.get('/me', authenticateMonitor, (req, res) => {
    const m = req.monitor;
    res.json({
        id: m.id,
        nome: m.nome,
        telefone: m.telefone,
        acessoStatus: m.acessoStatus
    });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const prisma = require('../prisma/client');

// Sem fallback: o server.js aborta na inicialização se JWT_SECRET não existir.
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = 'https://agenda-aero-festas.web.app';

// --- CONFIGURAÇÃO DO GMAIL ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

/**
 * POST /api/auth/register
 * Auto-cadastro público DESATIVADO: qualquer conta criada aqui teria acesso
 * a todas as rotas autenticadas. Contas são provisionadas pelo administrador
 * em admin.html (POST /api/admin/users).
 */
router.post('/register', (req, res) => {
    return res.status(403).json({
        error: 'Cadastro desativado. Solicite seu acesso ao administrador do sistema.'
    });
});

/**
 * POST /api/auth/forgot-password
 * Solicita recuperação de senha
 */
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });

        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
        if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

        const resetToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
        const expires = new Date();
        expires.setHours(expires.getHours() + 1); // Validade de 1 hora

        await prisma.user.update({
            where: { id: user.id },
            data: {
                resetPasswordToken: resetToken,
                resetPasswordExpires: expires
            }
        });

        const resetLink = `${FRONTEND_URL}/reset-password.html?token=${resetToken}`;

        const mailOptions = {
            from: `"Aero Festas" <${process.env.GMAIL_USER}>`,
            to: user.email,
            subject: 'Recuperação de Senha - Aero Festas 🔑',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Recuperação de Senha</h2>
                    <p>Você solicitou a troca de senha. Clique abaixo para criar uma nova:</p>
                    <a href="${resetLink}" style="background-color: #ef4444; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Redefinir Senha</a>
                    <p>Este link expira em 1 hora.</p>
                </div>
            `
        };

        transporter.sendMail(mailOptions).catch(err => {
            console.error("Erro email reset:", err);
        });

        res.json({ message: 'E-mail de recuperação enviado!' });

    } catch (error) {
        console.error("Erro Forgot Password:", error);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

/**
 * POST /api/auth/reset-password
 * Define a nova senha
 */
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ error: 'Dados incompletos.' });

        const user = await prisma.user.findFirst({
            where: {
                resetPasswordToken: token,
                resetPasswordExpires: { gt: new Date() }
            }
        });

        if (!user) return res.status(400).json({ error: 'Token inválido ou expirado.' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                resetPasswordToken: null,
                resetPasswordExpires: null
            }
        });

        res.json({ message: 'Senha alterada com sucesso! Faça login.' });

    } catch (error) {
        console.error("Erro Reset Password:", error);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

/**
 * POST /api/auth/confirm-email
 */
router.post('/confirm-email', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'Token obrigatório.' });

        const user = await prisma.user.findFirst({ where: { verificationToken: token } });
        if (!user) return res.status(400).json({ error: 'Token inválido.' });

        await prisma.user.update({
            where: { id: user.id },
            data: { emailConfirmed: true, verificationToken: null }
        });

        res.json({ message: 'E-mail confirmado!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao confirmar.' });
    }
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login realizado!',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                isAdmin: user.isAdmin,
                photoUrl: user.photoUrl,
                phone: user.phone
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao fazer login.' });
    }
});

/**
 * GET /api/auth/me
 */
router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Sem token.' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await prisma.user.findUnique({ where: { id: decoded.id } });
        if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            isAdmin: user.isAdmin,
            emailConfirmed: user.emailConfirmed,
            photoUrl: user.photoUrl,
            phone: user.phone
        });
    } catch (error) {
        res.status(401).json({ error: 'Token inválido.' });
    }
});

module.exports = router;

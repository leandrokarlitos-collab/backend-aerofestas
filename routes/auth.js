const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); // Instale se não tiver: npm install bcryptjs
const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Configurações
const JWT_SECRET = process.env.JWT_SECRET || 'segredo-super-secreto-aero';

// --- CONFIGURAÇÃO DO GMAIL (MESMA DO SERVER.JS) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

/**
 * POST /api/auth/register
 * Registra novo usuário no PostgreSQL e envia e-mail
 */
router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
        }

        // 1. Verifica se usuário já existe no Banco
        const existingUser = await prisma.user.findUnique({
            where: { email: email.toLowerCase().trim() }
        });

        if (existingUser) {
            return res.status(400).json({ error: 'E-mail já cadastrado.' });
        }

        // 2. Criptografa a senha
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Gera token de confirmação
        const verificationToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

        // 4. Cria usuário no Banco de Dados
        const newUser = await prisma.user.create({
            data: {
                name: name.trim(),
                email: email.toLowerCase().trim(),
                password: hashedPassword,
                isAdmin: false,
                emailConfirmed: false,
                verificationToken: verificationToken
            }
        });

        console.log(`👤 Usuário criado no banco: ${newUser.email}`);

        // 5. Envia E-mail pelo Gmail
        const mailOptions = {
            from: `"Aero Festas" <${process.env.GMAIL_USER}>`,
            to: newUser.email,
            subject: 'Confirme seu cadastro - Aero Festas 🎈',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #4f46e5;">Bem-vindo, ${newUser.name}!</h2>
                    <p>Seu cadastro foi realizado com sucesso.</p>
                    <p>Para ativar sua conta, use o código abaixo ou clique no link (se houver página de confirmação):</p>
                    
                    <div style="background-color: #f3f4f6; padding: 15px; text-align: center; border-radius: 5px; font-size: 24px; letter-spacing: 5px; font-weight: bold; margin: 20px 0;">
                        ${verificationToken}
                    </div>

                    <p style="color: #666; font-size: 12px;">Se você não criou esta conta, ignore este e-mail.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`📧 E-mail de confirmação enviado para ${newUser.email}`);

        res.status(201).json({
            message: 'Cadastro realizado! Verifique seu e-mail.',
            userId: newUser.id
        });

    } catch (error) {
        console.error("❌ Erro no Registro:", error);
        res.status(500).json({ error: 'Erro interno ao cadastrar.' });
    }
});

/**
 * POST /api/auth/confirm-email
 * Confirma o cadastro com o token
 */
router.post('/confirm-email', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) return res.status(400).json({ error: 'Token obrigatório.' });

        // Busca usuário com esse token
        const user = await prisma.user.findFirst({
            where: { verificationToken: token }
        });

        if (!user) {
            return res.status(400).json({ error: 'Token inválido ou já utilizado.' });
        }

        // Atualiza usuário para confirmado
        await prisma.user.update({
            where: { id: user.id },
            data: {
                emailConfirmed: true,
                verificationToken: null // Limpa o token para não usar de novo
            }
        });

        res.json({ message: 'E-mail confirmado com sucesso! Faça login.' });

    } catch (error) {
        console.error("Erro na confirmação:", error);
        res.status(500).json({ error: 'Erro ao confirmar e-mail.' });
    }
});

/**
 * POST /api/auth/login
 * Login simples com JWT
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase().trim() }
        });

        if (!user) {
            return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
        }

        // Opcional: Bloquear se não confirmou email
        if (!user.emailConfirmed) {
            return res.status(403).json({ error: 'Confirme seu e-mail antes de entrar.' });
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
                isAdmin: user.isAdmin
            }
        });

    } catch (error) {
        console.error("Erro no login:", error);
        res.status(500).json({ error: 'Erro ao fazer login.' });
    }
});

/**
 * GET /api/auth/me
 * Retorna dados do usuário logado
 */
router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Sem token.' });

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: { id: true, name: true, email: true, isAdmin: true, emailConfirmed: true }
        });

        if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

        res.json(user);

    } catch (error) {
        res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
});

module.exports = router;
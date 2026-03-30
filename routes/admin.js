const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { isAdmin } = require('../middleware/auth');
const prisma = require('../prisma/client');

const FRONTEND_URL = 'https://sistema-operante-aerofestas.web.app';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

/**
 * GET /api/admin/users
 * Lista todos os usuários (apenas admin)
 */
router.get('/users', isAdmin, async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                isAdmin: true,
                emailConfirmed: true,
                phone: true,
                createdAt: true,
                updatedAt: true
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(users);
    } catch (error) {
        console.error('Erro ao listar usuários:', error);
        res.status(500).json({ error: 'Erro ao listar usuários' });
    }
});

/**
 * POST /api/admin/users
 * Cria um novo usuário (apenas admin)
 * Com skipEmailConfirmation=true, o usuário já fica confirmado e pronto para login
 */
router.post('/users', isAdmin, async (req, res) => {
    try {
        const { name, email, password, isAdmin: makeAdmin, skipEmailConfirmation } = req.body;

        if (!name || !email) {
            return res.status(400).json({ error: 'Nome e email são obrigatórios' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Email inválido' });
        }

        const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
        if (existing) {
            return res.status(400).json({ error: 'Email já cadastrado' });
        }

        const finalPassword = password || crypto.randomBytes(6).toString('hex');
        const hashedPassword = await bcrypt.hash(finalPassword, 10);

        const verificationToken = skipEmailConfirmation ? null : (crypto.randomBytes(32).toString('hex'));

        const newUser = await prisma.user.create({
            data: {
                name: name.trim(),
                email: email.toLowerCase().trim(),
                password: hashedPassword,
                isAdmin: makeAdmin === true,
                emailConfirmed: skipEmailConfirmation === true,
                verificationToken
            }
        });

        // Se não pular confirmação, envia email
        if (!skipEmailConfirmation) {
            const confirmLink = `${FRONTEND_URL}/confirm-email.html?token=${verificationToken}`;
            const mailOptions = {
                from: `"Aero Festas" <${process.env.GMAIL_USER}>`,
                to: newUser.email,
                subject: 'Confirme seu cadastro - Aero Festas',
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2>Bem-vindo, ${newUser.name}!</h2>
                        <p>Clique no botão abaixo para confirmar seu e-mail e ativar sua conta:</p>
                        <a href="${confirmLink}" style="background-color: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Confirmar E-mail</a>
                        <p style="margin-top: 20px;">Ou use este código: <b>${verificationToken}</b></p>
                    </div>
                `
            };
            transporter.sendMail(mailOptions).catch(err => console.error('Erro ao enviar email:', err));
        }

        res.status(201).json({
            message: 'Usuário criado com sucesso',
            user: {
                id: newUser.id,
                name: newUser.name,
                email: newUser.email,
                isAdmin: newUser.isAdmin,
                emailConfirmed: newUser.emailConfirmed
            },
            ...(password ? {} : { generatedPassword: finalPassword })
        });
    } catch (error) {
        console.error('Erro ao criar usuário:', error);
        res.status(500).json({ error: 'Erro ao criar usuário' });
    }
});

/**
 * DELETE /api/admin/users/:id
 * Remove um usuário (apenas admin)
 */
router.delete('/users/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        if (id === req.user.id) {
            return res.status(400).json({ error: 'Você não pode remover seu próprio usuário' });
        }

        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        await prisma.user.delete({ where: { id } });

        res.json({ message: 'Usuário removido com sucesso' });
    } catch (error) {
        console.error('Erro ao remover usuário:', error);
        res.status(500).json({ error: 'Erro ao remover usuário' });
    }
});

/**
 * PUT /api/admin/users/:id
 * Atualiza um usuário (apenas admin)
 */
router.put('/users/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, isAdmin: makeAdmin, emailConfirmed } = req.body;

        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const updateData = {};

        if (name !== undefined) {
            updateData.name = name.trim();
        }

        if (email !== undefined) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: 'Email inválido' });
            }
            const emailExists = await prisma.user.findFirst({
                where: { email: email.toLowerCase().trim(), NOT: { id } }
            });
            if (emailExists) {
                return res.status(400).json({ error: 'Email já está em uso' });
            }
            updateData.email = email.toLowerCase().trim();
        }

        if (makeAdmin !== undefined) {
            if (id === req.user.id && makeAdmin === false) {
                return res.status(400).json({ error: 'Você não pode remover seus próprios privilégios de admin' });
            }
            updateData.isAdmin = makeAdmin === true;
        }

        if (emailConfirmed !== undefined) {
            updateData.emailConfirmed = emailConfirmed === true;
        }

        if (Object.keys(updateData).length === 0) {
            return res.json({ message: 'Nenhuma alteração realizada', user });
        }

        const updatedUser = await prisma.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                isAdmin: true,
                emailConfirmed: true,
                updatedAt: true
            }
        });

        res.json({
            message: 'Usuário atualizado com sucesso',
            user: updatedUser
        });
    } catch (error) {
        console.error('Erro ao atualizar usuário:', error);
        res.status(500).json({ error: 'Erro ao atualizar usuário' });
    }
});

module.exports = router;

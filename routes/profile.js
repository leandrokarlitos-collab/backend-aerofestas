const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { hashPassword, comparePassword } = require('../utils/crypto');
const prisma = require('../prisma/client');

/**
 * GET /api/profile
 * Obter perfil do usuário autenticado
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                photoUrl: true,
                isAdmin: true,
                emailConfirmed: true,
                createdAt: true,
                updatedAt: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone || '',
            photoUrl: user.photoUrl || null,
            isAdmin: user.isAdmin,
            emailConfirmed: user.emailConfirmed,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
        });
    } catch (error) {
        console.error('Erro ao buscar perfil:', error);
        res.status(500).json({ error: 'Erro ao buscar perfil' });
    }
});

/**
 * PUT /api/profile
 * Atualizar perfil (nome, email, telefone, foto)
 */
router.put('/', authenticate, async (req, res) => {
    try {
        const { name, email, phone, photoUrl } = req.body;

        // Busca usuário atual
        const currentUser = await prisma.user.findUnique({
            where: { id: req.user.id }
        });

        if (!currentUser) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const updateData = {};
        let emailChanged = false;

        // Valida e atualiza email
        if (email !== undefined && email !== currentUser.email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: 'Email inválido' });
            }

            // Verifica se email já existe
            const emailExists = await prisma.user.findFirst({
                where: {
                    email: email.toLowerCase(),
                    NOT: { id: req.user.id }
                }
            });

            if (emailExists) {
                return res.status(400).json({ error: 'Email já está em uso' });
            }

            updateData.email = email.toLowerCase().trim();
            updateData.emailConfirmed = false; // Requer nova confirmação
            emailChanged = true;
        }

        // Atualiza nome
        if (name !== undefined && name.trim() !== currentUser.name) {
            updateData.name = name.trim();
        }

        // Atualiza telefone
        if (phone !== undefined) {
            updateData.phone = phone.trim() || null;
        }

        // Atualiza foto de perfil
        if (photoUrl !== undefined) {
            updateData.photoUrl = photoUrl || null;
        }

        // Se houve alterações
        if (Object.keys(updateData).length > 0) {
            const updatedUser = await prisma.user.update({
                where: { id: req.user.id },
                data: updateData,
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    photoUrl: true,
                    emailConfirmed: true,
                    updatedAt: true
                }
            });

            res.json({
                message: 'Perfil atualizado com sucesso',
                user: updatedUser,
                emailRequiresConfirmation: emailChanged
            });
        } else {
            res.json({ message: 'Nenhuma alteração realizada' });
        }
    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);
        res.status(500).json({ error: 'Erro ao atualizar perfil' });
    }
});

/**
 * PUT /api/profile/password
 * Alterar senha
 */
router.put('/password', authenticate, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Nova senha deve ter no mínimo 6 caracteres' });
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user.id }
        });

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        // Verifica senha atual
        const passwordMatch = await comparePassword(currentPassword, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Senha atual incorreta' });
        }

        // Atualiza senha
        const hashedPassword = await hashPassword(newPassword);
        await prisma.user.update({
            where: { id: req.user.id },
            data: { password: hashedPassword }
        });

        res.json({ message: 'Senha alterada com sucesso' });
    } catch (error) {
        console.error('Erro ao alterar senha:', error);
        res.status(500).json({ error: 'Erro ao alterar senha' });
    }
});

module.exports = router;

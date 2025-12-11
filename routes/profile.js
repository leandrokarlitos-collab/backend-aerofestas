const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { hashPassword, comparePassword } = require('../utils/crypto');
const fs = require('fs').promises;
const path = require('path');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'user_history.json');

// Garante que os arquivos de dados existam
async function ensureDataFiles() {
    const dataDir = path.join(__dirname, '..', 'data');
    try {
        await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
        // Pasta já existe
    }

    try {
        await fs.access(USERS_FILE);
    } catch {
        await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2));
    }

    try {
        await fs.access(HISTORY_FILE);
    } catch {
        await fs.writeFile(HISTORY_FILE, JSON.stringify([], null, 2));
    }
}

// Carrega usuários do arquivo
async function loadUsers() {
    try {
        await ensureDataFiles();
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

// Salva usuários no arquivo
async function saveUsers(users) {
    await ensureDataFiles();
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

// Carrega histórico do arquivo
async function loadHistory() {
    try {
        await ensureDataFiles();
        const data = await fs.readFile(HISTORY_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

// Salva histórico no arquivo
async function saveHistory(history) {
    await ensureDataFiles();
    await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// Adiciona entrada no histórico
async function addHistoryEntry(entry) {
    const history = await loadHistory();
    history.push({
        id: Date.now().toString(),
        ...entry,
        timestamp: new Date().toISOString()
    });
    await saveHistory(history);
}

/**
 * GET /api/profile
 * Obter perfil do usuário autenticado
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const users = await loadUsers();
        const user = users.find(u => u.id === req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        // Busca informações de quem criou e alterou
        let createdByInfo = null;
        let updatedByInfo = null;

        if (user.createdBy && user.createdBy !== 'system') {
            const creator = users.find(u => u.id === user.createdBy);
            if (creator) {
                createdByInfo = { id: creator.id, name: creator.name, email: creator.email };
            }
        }

        if (user.updatedBy && user.updatedBy !== 'system') {
            const updater = users.find(u => u.id === user.updatedBy);
            if (updater) {
                updatedByInfo = { id: updater.id, name: updater.name, email: updater.email };
            }
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
            updatedAt: user.updatedAt,
            createdBy: user.createdBy,
            updatedBy: user.updatedBy,
            createdByInfo,
            updatedByInfo
        });
    } catch (error) {
        console.error('Erro ao buscar perfil:', error);
        res.status(500).json({ error: 'Erro ao buscar perfil' });
    }
});

/**
 * PUT /api/profile
 * Atualizar perfil (nome, email)
 */
router.put('/', authenticate, async (req, res) => {
    try {
        const { name, email, phone, photoUrl } = req.body;
        const users = await loadUsers();
        const userIndex = users.findIndex(u => u.id === req.user.id);

        if (userIndex === -1) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const user = users[userIndex];
        const changes = {};

        // Validação de email
        if (email !== undefined) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: 'Email inválido' });
            }

            // Verifica se email já existe em outro usuário
            const emailExists = users.find(u => u.id !== req.user.id && u.email.toLowerCase() === email.toLowerCase());
            if (emailExists) {
                return res.status(400).json({ error: 'Email já está em uso' });
            }

            if (user.email !== email) {
                changes.email = { old: user.email, new: email };
                user.email = email.toLowerCase().trim();
                user.emailConfirmed = false; // Requer nova confirmação se email mudou
            }
        }

        // Atualiza nome
        if (name !== undefined && name.trim() !== user.name) {
            changes.name = { old: user.name, new: name.trim() };
            user.name = name.trim();
        }

        // Atualiza telefone
        if (phone !== undefined && phone.trim() !== (user.phone || '')) {
            changes.phone = { old: user.phone || '', new: phone.trim() };
            user.phone = phone.trim();
        }

        // Atualiza foto de perfil (base64 ou URL)
        if (photoUrl !== undefined) {
            changes.photoUrl = { old: user.photoUrl || null, new: photoUrl || null };
            user.photoUrl = photoUrl || null;
        }

        // Se houve alterações
        if (Object.keys(changes).length > 0) {
            user.updatedBy = req.user.id;
            user.updatedAt = new Date().toISOString();

            await saveUsers(users);

            // Registra no histórico
            await addHistoryEntry({
                userId: user.id,
                userEmail: user.email,
                userName: user.name,
                action: 'update',
                changedBy: req.user.id,
                changedByName: req.user.name,
                changes
            });

            res.json({
                message: 'Perfil atualizado com sucesso',
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    photoUrl: user.photoUrl,
                    emailConfirmed: user.emailConfirmed,
                    updatedAt: user.updatedAt
                },
                emailRequiresConfirmation: changes.email !== undefined
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

        const users = await loadUsers();
        const userIndex = users.findIndex(u => u.id === req.user.id);

        if (userIndex === -1) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const user = users[userIndex];

        // Verifica senha atual
        const passwordMatch = await comparePassword(currentPassword, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Senha atual incorreta' });
        }

        // Atualiza senha
        user.password = await hashPassword(newPassword);
        user.updatedBy = req.user.id;
        user.updatedAt = new Date().toISOString();

        await saveUsers(users);

        // Registra no histórico
        await addHistoryEntry({
            userId: user.id,
            userEmail: user.email,
            userName: user.name,
            action: 'update',
            changedBy: req.user.id,
            changedByName: req.user.name,
            changes: { password: { old: '***', new: '***' } }
        });

        res.json({ message: 'Senha alterada com sucesso' });
    } catch (error) {
        console.error('Erro ao alterar senha:', error);
        res.status(500).json({ error: 'Erro ao alterar senha' });
    }
});

module.exports = router;


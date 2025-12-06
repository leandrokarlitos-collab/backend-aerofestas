const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/auth');
const { hashPassword, generateToken } = require('../utils/crypto');
const { sendConfirmationEmail } = require('../utils/email');
const fs = require('fs').promises;
const path = require('path');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');
const TOKENS_FILE = path.join(__dirname, '..', 'data', 'tokens.json');
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'user_history.json');

// Carrega usuários do arquivo
async function loadUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

// Salva usuários no arquivo
async function saveUsers(users) {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

// Carrega tokens do arquivo
async function loadTokens() {
    try {
        const data = await fs.readFile(TOKENS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

// Salva tokens no arquivo
async function saveTokens(tokens) {
    await fs.writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

// Carrega histórico do arquivo
async function loadHistory() {
    try {
        const data = await fs.readFile(HISTORY_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

// Salva histórico no arquivo
async function saveHistory(history) {
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
 * GET /api/admin/users
 * Lista todos os usuários (apenas admin)
 */
router.get('/users', isAdmin, async (req, res) => {
    try {
        const users = await loadUsers();
        
        // Remove senhas da resposta e inclui informações de auditoria
        const usersWithoutPasswords = users.map(user => ({
            id: user.id,
            name: user.name,
            email: user.email,
            isAdmin: user.isAdmin,
            emailConfirmed: user.emailConfirmed,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            createdBy: user.createdBy,
            updatedBy: user.updatedBy
        }));

        res.json(usersWithoutPasswords);
    } catch (error) {
        console.error('Erro ao listar usuários:', error);
        res.status(500).json({ error: 'Erro ao listar usuários' });
    }
});

/**
 * POST /api/admin/users
 * Adiciona um novo usuário (apenas admin)
 */
router.post('/users', isAdmin, async (req, res) => {
    try {
        const { name, email, password, isAdmin: makeAdmin, skipEmailConfirmation } = req.body;

        // Validação
        if (!name || !email) {
            return res.status(400).json({ error: 'Nome e email são obrigatórios' });
        }

        // Validação de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Email inválido' });
        }

        const users = await loadUsers();

        // Verifica se email já existe
        if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
            return res.status(400).json({ error: 'Email já cadastrado' });
        }

        // Gera senha padrão se não fornecida
        const finalPassword = password || generateToken().substring(0, 12);
        const hashedPassword = await hashPassword(finalPassword);

        // Cria novo usuário
        const newUser = {
            id: Date.now().toString(),
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            isAdmin: makeAdmin === true,
            emailConfirmed: skipEmailConfirmation === true,
            createdAt: new Date().toISOString(),
            createdBy: req.user.id,
            updatedBy: req.user.id,
            updatedAt: new Date().toISOString()
        };

        users.push(newUser);
        await saveUsers(users);

        // Registra no histórico
        await addHistoryEntry({
            userId: newUser.id,
            userEmail: newUser.email,
            userName: newUser.name,
            action: 'create',
            changedBy: req.user.id,
            changedByName: req.user.name,
            changes: {
                name: newUser.name,
                email: newUser.email,
                isAdmin: newUser.isAdmin
            }
        });

        // Se não pular confirmação, envia email
        if (!skipEmailConfirmation) {
            const confirmationToken = generateToken();
            const tokens = await loadTokens();
            tokens.push({
                token: confirmationToken,
                userId: newUser.id,
                email: newUser.email,
                createdAt: Date.now()
            });
            await saveTokens(tokens);

            try {
                await sendConfirmationEmail(newUser.email, confirmationToken, newUser.name);
            } catch (emailError) {
                console.error('Erro ao enviar email:', emailError);
            }
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

        // Não permite remover a si mesmo
        if (id === req.user.id) {
            return res.status(400).json({ error: 'Você não pode remover seu próprio usuário' });
        }

        const users = await loadUsers();
        const userIndex = users.findIndex(u => u.id === id);

        if (userIndex === -1) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const userToDelete = users[userIndex];

        // Registra no histórico antes de remover
        await addHistoryEntry({
            userId: userToDelete.id,
            userEmail: userToDelete.email,
            userName: userToDelete.name,
            action: 'delete',
            changedBy: req.user.id,
            changedByName: req.user.name,
            changes: {
                deleted: true
            }
        });

        // Remove usuário
        users.splice(userIndex, 1);
        await saveUsers(users);

        // Remove tokens relacionados
        const tokens = await loadTokens();
        const remainingTokens = tokens.filter(t => t.userId !== id);
        await saveTokens(remainingTokens);

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

        const users = await loadUsers();
        const user = users.find(u => u.id === id);

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const changes = {};

        // Atualiza campos fornecidos e rastreia mudanças
        if (name !== undefined && name.trim() !== user.name) {
            changes.name = { old: user.name, new: name.trim() };
            user.name = name.trim();
        }
        if (email !== undefined) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: 'Email inválido' });
            }
            // Verifica se email já existe em outro usuário
            const emailExists = users.find(u => u.id !== id && u.email.toLowerCase() === email.toLowerCase());
            if (emailExists) {
                return res.status(400).json({ error: 'Email já está em uso' });
            }
            if (user.email !== email.toLowerCase().trim()) {
                changes.email = { old: user.email, new: email.toLowerCase().trim() };
                user.email = email.toLowerCase().trim();
            }
        }
        if (makeAdmin !== undefined) {
            // Não permite remover admin de si mesmo
            if (id === req.user.id && makeAdmin === false) {
                return res.status(400).json({ error: 'Você não pode remover seus próprios privilégios de admin' });
            }
            if (user.isAdmin !== (makeAdmin === true)) {
                changes.isAdmin = { old: user.isAdmin, new: makeAdmin === true };
                user.isAdmin = makeAdmin === true;
            }
        }
        if (emailConfirmed !== undefined && user.emailConfirmed !== emailConfirmed) {
            changes.emailConfirmed = { old: user.emailConfirmed, new: emailConfirmed === true };
            user.emailConfirmed = emailConfirmed === true;
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
        }

        await saveUsers(users);

        res.json({
            message: Object.keys(changes).length > 0 ? 'Usuário atualizado com sucesso' : 'Nenhuma alteração realizada',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                isAdmin: user.isAdmin,
                emailConfirmed: user.emailConfirmed,
                updatedAt: user.updatedAt,
                updatedBy: user.updatedBy
            }
        });
    } catch (error) {
        console.error('Erro ao atualizar usuário:', error);
        res.status(500).json({ error: 'Erro ao atualizar usuário' });
    }
});

module.exports = router;


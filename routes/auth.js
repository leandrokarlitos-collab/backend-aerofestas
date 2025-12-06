const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');
const { hashPassword, comparePassword, generateToken } = require('../utils/crypto');
const { sendConfirmationEmail } = require('../utils/email');
const { authenticate } = require('../middleware/auth');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');
const TOKENS_FILE = path.join(__dirname, '..', 'data', 'tokens.json');
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
        await fs.access(TOKENS_FILE);
    } catch {
        await fs.writeFile(TOKENS_FILE, JSON.stringify([], null, 2));
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

// Carrega tokens do arquivo
async function loadTokens() {
    try {
        await ensureDataFiles();
        const data = await fs.readFile(TOKENS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

// Salva tokens no arquivo
async function saveTokens(tokens) {
    await ensureDataFiles();
    await fs.writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

// Limpa tokens expirados (mais de 24 horas)
async function cleanExpiredTokens() {
    const tokens = await loadTokens();
    const now = Date.now();
    const validTokens = tokens.filter(t => now - t.createdAt < 24 * 60 * 60 * 1000);
    await saveTokens(validTokens);
}

/**
 * POST /api/auth/register
 * Registra um novo usuário
 */
router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Validação
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
        }

        // Validação de email simples
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Email inválido' });
        }

        const users = await loadUsers();

        // Verifica se email já existe
        if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
            return res.status(400).json({ error: 'Email já cadastrado' });
        }

        // Cria novo usuário
        const hashedPassword = await hashPassword(password);
        const newUser = {
            id: Date.now().toString(),
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            isAdmin: false,
            emailConfirmed: false,
            createdAt: new Date().toISOString(),
            createdBy: 'system',
            updatedBy: 'system',
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
            changedBy: 'system',
            changedByName: 'Sistema',
            changes: {
                name: newUser.name,
                email: newUser.email,
                isAdmin: false
            }
        });

        // Gera token de confirmação
        const confirmationToken = generateToken();
        const tokens = await loadTokens();
        tokens.push({
            token: confirmationToken,
            userId: newUser.id,
            email: newUser.email,
            createdAt: Date.now()
        });
        await saveTokens(tokens);

        // Envia email de confirmação
        try {
            await sendConfirmationEmail(newUser.email, confirmationToken, newUser.name);
        } catch (emailError) {
            console.error('Erro ao enviar email:', emailError);
            // Continua mesmo se o email falhar
        }

        res.status(201).json({
            message: 'Usuário cadastrado com sucesso. Verifique seu email para confirmar o cadastro.',
            userId: newUser.id
        });
    } catch (error) {
        console.error('Erro no registro:', error);
        res.status(500).json({ error: 'Erro ao cadastrar usuário' });
    }
});

/**
 * POST /api/auth/confirm-email
 * Confirma email usando token
 */
router.post('/confirm-email', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Token não fornecido' });
        }

        await cleanExpiredTokens();
        const tokens = await loadTokens();
        const tokenData = tokens.find(t => t.token === token);

        if (!tokenData) {
            return res.status(400).json({ error: 'Token inválido ou expirado' });
        }

        const users = await loadUsers();
        const user = users.find(u => u.id === tokenData.userId);

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        // Confirma email
        user.emailConfirmed = true;
        await saveUsers(users);

        // Remove token usado
        const remainingTokens = tokens.filter(t => t.token !== token);
        await saveTokens(remainingTokens);

        res.json({ message: 'Email confirmado com sucesso!' });
    } catch (error) {
        console.error('Erro na confirmação:', error);
        res.status(500).json({ error: 'Erro ao confirmar email' });
    }
});

/**
 * POST /api/auth/login
 * Faz login e retorna JWT
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha são obrigatórios' });
        }

        const users = await loadUsers();
        const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

        if (!user) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }

        // Verifica senha
        const passwordMatch = await comparePassword(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }

        // Verifica se email foi confirmado
        if (!user.emailConfirmed) {
            return res.status(403).json({ error: 'Email não confirmado. Verifique sua caixa de entrada.' });
        }

        // Gera JWT
        const jwtToken = jwt.sign(
            {
                id: user.id,
                email: user.email,
                name: user.name,
                isAdmin: user.isAdmin
            },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        res.json({
            token: jwtToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                isAdmin: user.isAdmin
            }
        });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ error: 'Erro ao fazer login' });
    }
});

/**
 * GET /api/auth/me
 * Retorna informações do usuário autenticado
 */
router.get('/me', authenticate, async (req, res) => {
    try {
        const users = await loadUsers();
        const user = users.find(u => u.id === req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            isAdmin: user.isAdmin,
            emailConfirmed: user.emailConfirmed
        });
    } catch (error) {
        console.error('Erro ao buscar usuário:', error);
        res.status(500).json({ error: 'Erro ao buscar informações do usuário' });
    }
});

module.exports = router;


const express = require('express');
const router = express.Router();
const prisma = require('../prisma/client');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/tasks
 * Busca todas as tarefas do usuário logado
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const tasks = await prisma.task.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' }
        });
        res.json(tasks);
    } catch (error) {
        console.error("Erro ao buscar tarefas:", error);
        res.status(500).json({ error: 'Erro ao buscar tarefas.' });
    }
});

/**
 * POST /api/tasks
 * Cria uma nova tarefa
 */
router.post('/', authenticate, async (req, res) => {
    try {
        const { text, dueDate, completed } = req.body;
        if (!text) return res.status(400).json({ error: 'O texto da tarefa é obrigatório.' });

        const newTask = await prisma.task.create({
            data: {
                text,
                dueDate: dueDate || null,
                completed: completed || false,
                userId: req.user.id
            }
        });
        res.status(201).json(newTask);
    } catch (error) {
        console.error("Erro ao criar tarefa:", error);
        res.status(500).json({ error: 'Erro ao criar tarefa.' });
    }
});

/**
 * PUT /api/tasks/:id
 * Atualiza uma tarefa (texto, status ou data)
 */
router.put('/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { text, dueDate, completed } = req.body;

        const task = await prisma.task.findUnique({ where: { id } });
        if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });
        if (task.userId !== req.user.id) return res.status(403).json({ error: 'Acesso negado.' });

        const updatedTask = await prisma.task.update({
            where: { id },
            data: {
                text: text !== undefined ? text : task.text,
                dueDate: dueDate !== undefined ? dueDate : task.dueDate,
                completed: completed !== undefined ? completed : task.completed
            }
        });
        res.json(updatedTask);
    } catch (error) {
        console.error("Erro ao atualizar tarefa:", error);
        res.status(500).json({ error: 'Erro ao atualizar tarefa.' });
    }
});

/**
 * DELETE /api/tasks/:id
 * Remove uma tarefa
 */
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        const task = await prisma.task.findUnique({ where: { id } });
        if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });
        if (task.userId !== req.user.id) return res.status(403).json({ error: 'Acesso negado.' });

        await prisma.task.delete({ where: { id } });
        res.json({ success: true, message: 'Tarefa removida.' });
    } catch (error) {
        console.error("Erro ao deletar tarefa:", error);
        res.status(500).json({ error: 'Erro ao deletar tarefa.' });
    }
});

module.exports = router;

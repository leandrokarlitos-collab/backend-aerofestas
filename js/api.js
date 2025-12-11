// js/api.js
import { getToken } from './auth.js';

// URL do Backend (Railway)
export const API_BASE_URL = "https://backend-aerofestas-production.up.railway.app";
const BASE_URL = `${API_BASE_URL}/api`;

export const api = {
    // --- LEITURAS (GET) ---

    getBrinquedos: async () => {
        try {
            const res = await fetch(`${BASE_URL}/admin/toys`);
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    getClientes: async () => {
        try {
            const res = await fetch(`${BASE_URL}/admin/clients`);
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    getEventos: async () => {
        try {
            const res = await fetch(`${BASE_URL}/admin/events-full`);
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    getEmpresas: async () => {
        try {
            const res = await fetch(`${BASE_URL}/admin/companies`);
            return res.ok ? await res.json() : [];
        } catch (e) {
            console.error('Erro ao buscar empresas:', e);
            return [];
        }
    },

    // 💰 FINANCEIRO (Extrato)
    getTransacoes: async () => {
        try {
            const token = getToken();
            if (!token) return [];
            const res = await fetch(`${BASE_URL}/finance/transactions`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : [];
        } catch (error) {
            console.error("Erro API Transações:", error);
            return [];
        }
    },

    // 📊 DASHBOARD FINANCEIRO
    getFinanceiro: async (mes, ano) => {
        try {
            const token = getToken();
            if (!token) return null;
            const query = mes && ano ? `?month=${mes}&year=${ano}` : '';
            const res = await fetch(`${BASE_URL}/finance/dashboard${query}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : null;
        } catch (error) { return null; }
    },

    // 🏦 CONTAS BANCÁRIAS
    getContas: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/accounts`, { headers: { 'Authorization': `Bearer ${token}` } });
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    // 📅 CONTAS FIXAS (CADASTROS)
    getContasFixas: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/fixed-expenses`, { headers: { 'Authorization': `Bearer ${token}` } });
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    // 🏷️ CATEGORIAS DE GASTOS
    getCategoriasGastos: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/categories/expenses`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    // 🏷️ CATEGORIAS DE CONTAS FIXAS
    getCategoriasFixas: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/categories/fixed`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    // --- ESCRITAS (POST/DELETE) ---

    // Salvar Evento
    salvarEvento: async (evento) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/admin/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(evento)
            });
            return res.ok ? await res.json() : null;
        } catch (error) { throw error; }
    },

    // Deletar Evento
    deletarEvento: async (eventoId) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/admin/events/${eventoId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : null;
        } catch (error) {
            console.error('Erro ao deletar evento:', error);
            throw error;
        }
    },

    // Salvar Gasto/Transação
    salvarTransacao: async (dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/transactions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(dados)
            });
            return res.ok;
        } catch (e) { return false; }
    },

    // Salvar Conta Bancária
    salvarConta: async (dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/accounts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(dados)
            });
            return res.ok;
        } catch (e) { return false; }
    },

    // Salvar Conta Fixa
    salvarContaFixa: async (dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/fixed-expenses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(dados)
            });
            return res.ok;
        } catch (e) { return false; }
    },

    // Salvar Categoria de Gasto
    salvarCategoriaGasto: async (nome) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/categories/expenses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ name: nome })
            });
            return res.ok;
        } catch (e) { return false; }
    },

    // Salvar Categoria de Conta Fixa
    salvarCategoriaFixa: async (nome) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/categories/fixed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ name: nome })
            });
            return res.ok;
        } catch (e) { return false; }
    },

    // Excluir Item Genérico
    deletarItem: async (id, tipo) => {
        // tipo: 'transactions', 'accounts', 'fixed-expenses'
        try {
            const token = getToken();
            await fetch(`${BASE_URL}/finance/${tipo}/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return true;
        } catch (e) { return false; }
    }
};
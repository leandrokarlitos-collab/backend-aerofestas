// js/api.js
import { getToken } from './auth.js';

export const API_BASE_URL = "https://backend-aerofestas-production.up.railway.app";
const BASE_URL = `${API_BASE_URL}/api`;

export const api = {
    // 🧸 BRINQUEDOS
    getBrinquedos: async () => {
        try {
            const res = await fetch(`${BASE_URL}/admin/toys`);
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    // 👥 CLIENTES
    getClientes: async () => {
        try {
            const res = await fetch(`${BASE_URL}/admin/clients`);
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    // 📅 EVENTOS (Receitas)
    getEventos: async () => {
        try {
            const res = await fetch(`${BASE_URL}/admin/events-full`);
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    // 💰 TRANSAÇÕES (Gastos/Despesas) - ESSENCIAL PARA O FINANCEIRO
    getTransacoes: async () => {
        try {
            const token = getToken();
            if (!token) return [];

            const res = await fetch(`${BASE_URL}/finance/transactions`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            // O backend retorna todas as transações.
            // Vamos filtrar aqui ou usar tudo, dependendo da necessidade.
            return res.ok ? await res.json() : [];
        } catch (error) {
            console.error("Erro API Transações:", error);
            return [];
        }
    },

    // 📊 RESUMO FINANCEIRO (Cards do Dashboard)
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

    // 💾 SALVAR EVENTO
    salvarEvento: async (evento) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/admin/events`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(evento)
            });
            return res.ok ? await res.json() : null;
        } catch (error) { throw error; }
    }
};
// js/api.js

// URL do seu backend no Railway (sem barra no final)
const BASE_URL = "https://backend-aerofestas-production.up.railway.app/api";

export const api = {
    // 🧸 BRINQUEDOS
    getBrinquedos: async () => {
        try {
            const res = await fetch(`${BASE_URL}/admin/toys`);
            if (!res.ok) throw new Error('Falha ao buscar brinquedos');
            return await res.json();
        } catch (error) {
            console.error("Erro API Toys:", error);
            return []; // Retorna array vazio para não quebrar a tela
        }
    },

    // 👥 CLIENTES
    getClientes: async () => {
        try {
            const res = await fetch(`${BASE_URL}/admin/clients`);
            if (!res.ok) throw new Error('Falha ao buscar clientes');
            return await res.json();
        } catch (error) {
            console.error("Erro API Clients:", error);
            return [];
        }
    },

    // 📅 EVENTOS (Completo com itens)
    getEventos: async () => {
        try {
            // Usando a rota nova que criamos no server.js atualizado
            const res = await fetch(`${BASE_URL}/admin/events-full`);
            if (!res.ok) throw new Error('Falha ao buscar eventos');
            return await res.json();
        } catch (error) {
            console.error("Erro API Events:", error);
            return [];
        }
    },

    // 💾 SALVAR EVENTO
    salvarEvento: async (evento) => {
        try {
            const res = await fetch(`${BASE_URL}/admin/events`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(evento)
            });
            if (!res.ok) throw new Error('Falha ao salvar evento');
            return await res.json();
        } catch (error) {
            console.error("Erro API Save Event:", error);
            throw error;
        }
    }
};
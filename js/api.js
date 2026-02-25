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

    // Salvar Brinquedo
    salvarBrinquedo: async (brinquedo) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/admin/toys`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(brinquedo)
            });
            return res.ok ? await res.json() : null;
        } catch (error) { console.error('Erro ao salvar brinquedo:', error); return null; }
    },

    // Deletar Brinquedo
    deletarBrinquedo: async (id) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/admin/toys/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : null;
        } catch (error) { console.error('Erro ao deletar brinquedo:', error); return null; }
    },

    // Salvar Empresa
    salvarEmpresa: async (empresa) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/admin/companies`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(empresa)
            });
            return res.ok ? await res.json() : null;
        } catch (error) { console.error('Erro ao salvar empresa:', error); return null; }
    },

    // Deletar Empresa
    deletarEmpresa: async (id) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/admin/companies/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : null;
        } catch (error) { console.error('Erro ao deletar empresa:', error); return null; }
    },

    // Salvar Evento
    salvarEvento: async (evento) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/admin/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(evento)
            });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                console.error('Erro API ao salvar evento:', res.status, errorData);
                return null;
            }
            return await res.json();
        } catch (error) {
            console.error('Erro de rede ao salvar evento:', error);
            return null;
        }
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
    // Atualizar Gasto/Transação
    atualizarTransacao: async (id, dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/transactions/${id}`, {
                method: 'PUT',
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
    // Atualizar Conta Bancária
    atualizarConta: async (id, dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/accounts/${id}`, {
                method: 'PUT',
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
    // Atualizar Conta Fixa
    atualizarContaFixa: async (id, dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/fixed-expenses/${id}`, {
                method: 'PUT',
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
    // Atualizar Categoria de Gasto
    atualizarCategoriaGasto: async (id, nome) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/categories/expenses/${id}`, {
                method: 'PUT',
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
    // Atualizar Categoria de Conta Fixa
    atualizarCategoriaFixa: async (id, nome) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/categories/fixed/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ name: nome })
            });
            return res.ok;
        } catch (e) { return false; }
    },

    // Excluir Item Genérico
    deletarItem: async (id, tipo) => {
        // tipo: 'transactions', 'accounts', 'fixed-expenses', 'categories-expenses', 'categories-fixed'
        try {
            const token = getToken();
            await fetch(`${BASE_URL}/finance/${tipo}/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return true;
        } catch (e) { return false; }
    },

    // --- MONITORES ---

    getMonitores: async (page = 1, limit = 50) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/monitores?page=${page}&limit=${limit}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : [];
        } catch (e) {
            console.error("Erro ao buscar monitores:", e);
            return [];
        }
    },

    getMonitorById: async (id) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/monitores/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : null;
        } catch (e) {
            console.error("Erro ao buscar detalhes do monitor:", e);
            return null;
        }
    },

    salvarMonitor: async (dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/monitores`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(dados)
            });
            return res.ok;
        } catch (e) {
            console.error("Erro ao salvar monitor:", e);
            return false;
        }
    },

    atualizarMonitor: async (id, dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/monitores/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(dados)
            });
            return res.ok;
        } catch (e) {
            console.error("Erro ao atualizar monitor:", e);
            return false;
        }
    },

    deletarMonitor: async (id) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/monitores/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok;
        } catch (e) {
            console.error("Erro ao deletar monitor:", e);
            return false;
        }
    },

    // --- DESEMPENHO ---

    salvarDesempenho: async (dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/desempenho`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(dados)
            });
            return res.ok;
        } catch (e) {
            console.error("Erro ao salvar desempenho:", e);
            return false;
        }
    },

    // --- PAGAMENTOS DE MONITORES ---

    getPagamentosMonitores: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/pagamentos-monitores`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : [];
        } catch (e) {
            console.error("Erro ao buscar pagamentos:", e);
            return [];
        }
    },

    salvarPagamentoMonitor: async (dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/pagamentos-monitores`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(dados)
            });
            return res.ok;
        } catch (e) {
            console.error("Erro ao salvar pagamento:", e);
            return false;
        }
    },

    atualizarPagamentoMonitor: async (id, dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/pagamentos-monitores/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(dados)
            });
            return res.ok;
        } catch (e) {
            console.error("Erro ao atualizar pagamento:", e);
            return false;
        }
    },

    deletarPagamentoMonitor: async (id) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/pagamentos-monitores/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok;
        } catch (e) {
            console.error("Erro ao deletar pagamento:", e);
            return false;
        }
    },

    // --- FUNCIONÁRIOS ---

    getFuncionarios: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/funcionarios`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : [];
        } catch (e) {
            console.error("Erro ao buscar funcionários:", e);
            return [];
        }
    },

    salvarFuncionario: async (dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/funcionarios`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(dados)
            });
            return res.ok;
        } catch (e) {
            console.error("Erro ao salvar funcionário:", e);
            return false;
        }
    },

    atualizarFuncionario: async (id, dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/funcionarios/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(dados)
            });
            return res.ok;
        } catch (e) {
            console.error("Erro ao atualizar funcionário:", e);
            return false;
        }
    },

    deletarFuncionario: async (id) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/funcionarios/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok;
        } catch (e) {
            console.error("Erro ao deletar funcionário:", e);
            return false;
        }
    },

    // --- FAIXAS DE COMISSÃO ---

    getFaixasComissao: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/faixas-comissao`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : [];
        } catch (e) {
            console.error("Erro ao buscar faixas:", e);
            return [];
        }
    },

    salvarFaixaComissao: async (dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/faixas-comissao`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(dados)
            });
            return res.ok;
        } catch (e) {
            console.error("Erro ao salvar faixa:", e);
            return false;
        }
    },

    deletarFaixaComissao: async (id) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/finance/faixas-comissao/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok;
        } catch (e) {
            console.error("Erro ao deletar faixa:", e);
            return false;
        }
    },

    // --- TAREFAS (CLOUD) ---
    getTasks: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/tasks`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    salvarTarefa: async (dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(dados)
            });
            return res.ok ? await res.json() : null;
        } catch (e) { return null; }
    },

    atualizarTarefa: async (id, dados) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/tasks/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(dados)
            });
            return res.ok ? await res.json() : null;
        } catch (e) { return null; }
    },

    deletarTarefa: async (id) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/tasks/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok;
        } catch (e) { return false; }
    },

    // --- PLANO DIÁRIO (CLOUD) ---
    getDailyPlanHistory: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/daily-plans/history/all`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : {};
        } catch (e) { return {}; }
    },

    getDailyPlan: async (date) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/daily-plans/${date}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : null;
        } catch (e) { return null; }
    },

    salvarPlanoDiario: async (date, content) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/daily-plans`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ date, content })
            });
            return res.ok ? await res.json() : null;
        } catch (e) { return null; }
    },

    // --- WHATSAPP ---

    getWhatsAppInstances: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/whatsapp/instances`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    getWhatsAppConversations: async (instanceName, search = '') => {
        try {
            const token = getToken();
            let url = `${BASE_URL}/whatsapp/conversations?`;
            if (instanceName) url += `instance=${encodeURIComponent(instanceName)}&`;
            if (search) url += `search=${encodeURIComponent(search)}`;
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    getWhatsAppMessages: async (conversationId, limit = 50, before = '') => {
        try {
            const token = getToken();
            let url = `${BASE_URL}/whatsapp/conversations/${conversationId}/messages?limit=${limit}`;
            if (before) url += `&before=${encodeURIComponent(before)}`;
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : [];
        } catch (e) { return []; }
    },

    sendWhatsAppMessage: async (instanceName, conversationId, text) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/whatsapp/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ instanceName, conversationId, text })
            });
            return res.ok ? await res.json() : null;
        } catch (e) { return null; }
    },

    getWhatsAppUnreadCount: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/whatsapp/unread-count`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : { total: 0, instances: [] };
        } catch (e) { return { total: 0, instances: [] }; }
    },

    markWhatsAppRead: async (conversationId) => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/whatsapp/conversations/${conversationId}/read`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok;
        } catch (e) { return false; }
    },

    pollWhatsApp: async (instance, since, conversationId) => {
        try {
            const token = getToken();
            const params = new URLSearchParams({ instance });
            if (since) params.set('since', since);
            if (conversationId) params.set('conversationId', conversationId);
            const res = await fetch(`${BASE_URL}/whatsapp/poll?${params}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : null;
        } catch (e) { return null; }
    },

    // --- BACKUP ---

    getBackupFull: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/backup/full`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : null;
        } catch (e) {
            console.error("Erro ao gerar backup:", e);
            return null;
        }
    },

    getBackupStatus: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/backup/status`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : null;
        } catch (e) { return null; }
    },

    runBackup: async () => {
        try {
            const token = getToken();
            const res = await fetch(`${BASE_URL}/backup/run`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok ? await res.json() : null;
        } catch (e) {
            console.error("Erro ao executar backup:", e);
            return null;
        }
    }
};
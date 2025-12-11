// Aponta direto para o servidor no Railway
export const API_BASE_URL = "https://backend-aerofestas-production.up.railway.app";

// --- FUNÇÕES DE TOKEN (USO INTERNO E EXTERNO) ---

/**
 * Salva token no localStorage
 */
export function saveToken(token) {
    localStorage.setItem('authToken', token);
}

/**
 * Obtém token do localStorage
 */
export function getToken() {
    return localStorage.getItem('authToken');
}

/**
 * Remove token do localStorage
 */
export function removeToken() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userData');
}

/**
 * Salva dados do usuário no localStorage
 */
export function saveUserData(user) {
    localStorage.setItem('userData', JSON.stringify(user));
}

/**
 * Obtém dados do usuário do localStorage
 */
export function getUserData() {
    const data = localStorage.getItem('userData');
    return data ? JSON.parse(data) : null;
}

/**
 * Verifica se o usuário está autenticado
 */
export function isAuthenticated() {
    return !!getToken();
}

// --- FUNÇÕES DE AUTENTICAÇÃO ---

/**
 * Faz login
 */
export async function login(email, password) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao fazer login');
        }

        saveToken(data.token);
        saveUserData(data.user);
        return data;
    } catch (error) {
        throw error;
    }
}

/**
 * Registra novo usuário
 */
export async function register(name, email, password) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao cadastrar');
        }

        return data;
    } catch (error) {
        throw error;
    }
}

/**
 * Confirma email usando token
 */
export async function confirmEmail(token) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/confirm-email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao confirmar email');
        }

        return data;
    } catch (error) {
        throw error;
    }
}

/**
 * Obtém informações do usuário autenticado
 */
export async function getMe() {
    try {
        const token = getToken();
        if (!token) {
            throw new Error('Não autenticado');
        }

        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                removeToken();
            }
            throw new Error(data.error || 'Erro ao buscar informações');
        }

        saveUserData(data);
        return data;
    } catch (error) {
        throw error;
    }
}

/**
 * Faz logout
 */
export function logout() {
    removeToken();
    window.location.href = '/login.html';
}

// --- FUNÇÕES ADMINISTRATIVAS (Para uso futuro) ---

export async function listUsers() {
    try {
        const token = getToken();
        const response = await fetch(`${API_BASE_URL}/api/admin/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro ao listar usuários');
        return data;
    } catch (error) { throw error; }
}

export async function addUser(userData) {
    try {
        const token = getToken();
        const response = await fetch(`${API_BASE_URL}/api/admin/users`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro ao adicionar usuário');
        return data;
    } catch (error) { throw error; }
}

export async function removeUser(userId) {
    try {
        const token = getToken();
        const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro ao remover usuário');
        return data;
    } catch (error) { throw error; }
}

export async function updateUser(userId, userData) {
    try {
        const token = getToken();
        const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro ao atualizar usuário');
        return data;
    } catch (error) { throw error; }
}

export async function getHistory(filters = {}) {
    try {
        const token = getToken();
        const params = new URLSearchParams();
        if (filters.action) params.append('action', filters.action);
        if (filters.startDate) params.append('startDate', filters.startDate);
        if (filters.endDate) params.append('endDate', filters.endDate);
        if (filters.userId) params.append('userId', filters.userId);
        if (filters.limit) params.append('limit', filters.limit);
        if (filters.offset) params.append('offset', filters.offset);

        const response = await fetch(`${API_BASE_URL}/api/admin/history?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro ao buscar histórico');
        return data;
    } catch (error) { throw error; }
}
// js/profile.js
import { getToken, removeToken, getUserData, saveUserData, API_BASE_URL } from './auth.js';

/**
 * Obtém perfil do usuário autenticado
 */
export async function getProfile() {
    try {
        const token = getToken();
        if (!token) {
            throw new Error('Não autenticado');
        }

        const response = await fetch(`${API_BASE_URL}/api/profile`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                removeToken();
                window.location.href = '/login.html';
            }
            throw new Error(data.error || 'Erro ao buscar perfil');
        }

        return data;
    } catch (error) {
        throw error;
    }
}

/**
 * Atualiza perfil (nome, email)
 */
export async function updateProfile(profileData) {
    try {
        const token = getToken();
        if (!token) {
            throw new Error('Não autenticado');
        }

        const response = await fetch(`${API_BASE_URL}/api/profile`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(profileData)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao atualizar perfil');
        }

        // Atualiza dados do usuário no localStorage
        if (data.user) {
            const userData = getUserData();
            if (userData) {
                Object.assign(userData, data.user);
                saveUserData(userData);
            }
        }

        return data;
    } catch (error) {
        throw error;
    }
}

/**
 * Altera senha
 */
export async function changePassword(currentPassword, newPassword) {
    try {
        const token = getToken();
        if (!token) {
            throw new Error('Não autenticado');
        }

        const response = await fetch(`${API_BASE_URL}/api/profile/password`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                currentPassword,
                newPassword
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao alterar senha');
        }

        return data;
    } catch (error) {
        throw error;
    }
}
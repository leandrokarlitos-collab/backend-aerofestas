// API_BASE_URL já está definido em auth.js
// Usa window.location.origin diretamente ou a constante de auth.js

/**
 * Obtém perfil do usuário autenticado
 */
async function getProfile() {
    try {
        const token = getToken();
        if (!token) {
            throw new Error('Não autenticado');
        }

        const apiBase = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.location.origin;
        const response = await fetch(`${apiBase}/api/profile`, {
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
async function updateProfile(profileData) {
    try {
        const token = getToken();
        if (!token) {
            throw new Error('Não autenticado');
        }

        const apiBase = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.location.origin;
        const response = await fetch(`${apiBase}/api/profile`, {
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
async function changePassword(currentPassword, newPassword) {
    try {
        const token = getToken();
        if (!token) {
            throw new Error('Não autenticado');
        }

        const apiBase = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.location.origin;
        const response = await fetch(`${apiBase}/api/profile/password`, {
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


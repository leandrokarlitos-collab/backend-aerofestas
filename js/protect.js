/**
 * Script para proteger páginas HTML
 * Verifica autenticação e redireciona para login se necessário
 */

(async function() {
    // Páginas que não precisam de autenticação
    const publicPages = ['login.html', 'register.html', 'confirm-email.html'];
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';

    // Se for página pública, não faz nada
    if (publicPages.includes(currentPage)) {
        return;
    }

    // Verifica se há token
    const token = localStorage.getItem('authToken');
    
    if (!token) {
        // Salva a página atual para redirecionar após login
        sessionStorage.setItem('redirectAfterLogin', window.location.href);
        window.location.href = '/login.html';
        return;
    }

    // Verifica se o token é válido
    try {
        const response = await fetch('/api/auth/me', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            // Token inválido, remove e redireciona
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
            sessionStorage.setItem('redirectAfterLogin', window.location.href);
            window.location.href = '/login.html';
            return;
        }

        const userData = await response.json();
        localStorage.setItem('userData', JSON.stringify(userData));

        // Adiciona botão de logout se não existir
        addLogoutButton(userData);

    } catch (error) {
        console.error('Erro ao verificar autenticação:', error);
        localStorage.removeItem('authToken');
        localStorage.removeItem('userData');
        window.location.href = '/login.html';
    }
})();

/**
 * Adiciona botão de logout na página
 */
function addLogoutButton(userData) {
    // Verifica se o container já existe
    if (document.getElementById('auth-buttons-container')) {
        return;
    }

    // Cria container para os botões no canto superior esquerdo
    const authButtonsContainer = document.createElement('div');
    authButtonsContainer.id = 'auth-buttons-container';
    authButtonsContainer.className = 'fixed top-4 left-4 z-50 flex items-center gap-2';
    
    // Adiciona link para perfil
    const profileLink = document.createElement('a');
    profileLink.href = '/profile.html';
    profileLink.innerHTML = '<i class="fas fa-user"></i> Perfil';
    profileLink.className = 'bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 transition-colors';
    authButtonsContainer.appendChild(profileLink);
    
    // Adiciona link para admin se for admin
    if (userData.isAdmin) {
        const adminLink = document.createElement('a');
        adminLink.href = '/admin.html';
        adminLink.innerHTML = '<i class="fas fa-user-shield"></i> Admin';
        adminLink.className = 'bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 transition-colors';
        authButtonsContainer.appendChild(adminLink);
    }

    // Cria botão de logout
    const logoutBtn = document.createElement('button');
    logoutBtn.id = 'auth-logout-btn';
    logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Sair';
    logoutBtn.className = 'bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 transition-colors';
    logoutBtn.onclick = () => {
        localStorage.removeItem('authToken');
        localStorage.removeItem('userData');
        window.location.href = '/login.html';
    };
    
    authButtonsContainer.appendChild(logoutBtn);
    document.body.appendChild(authButtonsContainer);
}


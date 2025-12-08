/**
 * Script para proteger páginas HTML e Gerenciar Menu de Usuário
 */

// URL do Backend (Railway)
// Se estiver usando ES Modules, não declare variáveis globais sem exportar ou usar window
const API_BASE_URL = "https://backend-aerofestas-production.up.railway.app";

// Verifica token ao carregar
(async function () {
    const publicPages = ['login.html', 'register.html', 'confirm-email.html', 'forgot-password.html', 'reset-password.html'];
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';

    if (publicPages.includes(currentPage)) return;

    const token = localStorage.getItem('authToken');

    if (!token) {
        sessionStorage.setItem('redirectAfterLogin', window.location.href);
        window.location.href = 'login.html';
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error('Token inválido');

        const userData = await response.json();
        localStorage.setItem('userData', JSON.stringify(userData));

        // Injeta o menu
        injectUserMenu(userData);

    } catch (error) {
        console.error('Erro de autenticação:', error);
        localStorage.removeItem('authToken');
        localStorage.removeItem('userData');
        window.location.href = 'login.html';
    }
})();

function injectUserMenu(userData) {
    if (document.getElementById('user-menu-container')) return;

    // Mudei para FIXED BOTTOM-LEFT para não atrapalhar o menu superior
    const container = document.createElement('div');
    container.id = 'user-menu-container';
    container.className = 'fixed bottom-4 left-4 z-50 flex items-center gap-2 bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg border border-gray-200 transition-all hover:shadow-xl';

    // 1. Ícone de Perfil
    const profileBtn = document.createElement('a');
    profileBtn.href = 'profile.html';
    profileBtn.className = 'w-8 h-8 flex items-center justify-center bg-indigo-100 text-indigo-600 rounded-full hover:bg-indigo-200 transition-colors';
    profileBtn.innerHTML = '<i class="fas fa-user text-sm"></i>';
    profileBtn.title = "Meu Perfil";

    // 2. Nome do Usuário
    const userName = document.createElement('span');
    userName.className = 'text-sm font-semibold text-gray-700 hidden sm:block';
    userName.textContent = userData.name.split(' ')[0];

    container.appendChild(profileBtn);
    container.appendChild(userName);

    // 3. Botão ADMIN (Só aparece se for admin)
    if (userData.isAdmin) {
        const divider = document.createElement('div');
        divider.className = 'w-px h-4 bg-gray-300 mx-1';
        container.appendChild(divider);

        const adminBtn = document.createElement('a');
        adminBtn.href = 'admin.html'; // Certifique-se que esta página existe ou será criada
        adminBtn.className = 'text-purple-600 hover:text-purple-800 transition-colors text-sm font-bold flex items-center gap-1';
        adminBtn.innerHTML = '<i class="fas fa-user-shield"></i>';
        adminBtn.title = "Painel Admin";
        container.appendChild(adminBtn);
    }

    // 4. Divisor e Logout
    const divider2 = document.createElement('div');
    divider2.className = 'w-px h-4 bg-gray-300 mx-1';
    container.appendChild(divider2);

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'text-gray-400 hover:text-red-500 transition-colors';
    logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i>';
    logoutBtn.title = "Sair";
    logoutBtn.onclick = () => {
        if (confirm('Sair do sistema?')) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
            window.location.href = 'login.html';
        }
    };
    container.appendChild(logoutBtn);

    document.body.appendChild(container);
}
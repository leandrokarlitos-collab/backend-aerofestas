/**
 * Script para proteger páginas HTML e Gerenciar Menu de Usuário
 * Versão Premium ARRASTÁVEL com Menu Recolhível e Animações Disruptivas
 */

// URL do Backend (Railway)
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

        // Injeta o menu PREMIUM
        injectPremiumUserMenu(userData);

    } catch (error) {
        console.error('Erro de autenticação:', error);
        localStorage.removeItem('authToken');
        localStorage.removeItem('userData');
        window.location.href = 'login.html';
    }
})();

function injectPremiumUserMenu(userData) {
    if (document.getElementById('user-menu-container')) return;

    // Estilos CSS inline para garantir funcionamento
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInLeft {
            from {
                transform: translateX(-120%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @keyframes slideOutLeft {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(-120%);
                opacity: 0;
            }
        }

        @keyframes pulseGlow {
            0%, 100% {
                box-shadow: 0 0 20px rgba(79, 70, 229, 0.3), 0 0 40px rgba(139, 92, 246, 0.2);
            }
            50% {
                box-shadow: 0 0 30px rgba(79, 70, 229, 0.5), 0 0 60px rgba(139, 92, 246, 0.4);
            }
        }

        @keyframes rotateToggle {
            from { transform: rotate(0deg); }
            to { transform: rotate(180deg); }
        }

        #user-menu-container {
            animation: slideInLeft 0.6s cubic-bezier(0.68, -0.55, 0.27, 1.55);
        }

        #user-menu-container.menu-collapsed {
            animation: slideOutLeft 0.4s cubic-bezier(0.68, -0.55, 0.27, 1.55) forwards;
        }

        #user-menu-container.menu-expanded {
            animation: slideInLeft 0.6s cubic-bezier(0.68, -0.55, 0.27, 1.55);
        }

        .toggle-menu-btn {
            transition: all 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55);
        }

        .toggle-menu-btn.rotated {
            transform: rotate(180deg);
        }

        .menu-item-enter {
            animation: slideInLeft 0.4s ease-out;
        }

        #user-menu-container::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 1rem;
            padding: 2px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            opacity: 0;
            transition: opacity 0.3s;
        }

        #user-menu-container:hover::before {
            opacity: 0.6;
        }

        .user-menu-btn {
            position: relative;
            overflow: hidden;
        }

        .user-menu-btn::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 0;
            height: 0;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.5);
            transform: translate(-50%, -50%);
            transition: width 0.6s, height 0.6s;
        }

        .user-menu-btn:active::before {
            width: 300px;
            height: 300px;
        }
    `;
    document.head.appendChild(style);

    // Container principal
    const container = document.createElement('div');
    container.id = 'user-menu-container';
    container.className = 'fixed bottom-4 left-4 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border border-white/20 transition-all duration-300';

    // Glassmorphism background
    container.style.cssText = `
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.85) 100%);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
    `;

    // Verifica estado salvo no localStorage
    const isCollapsed = localStorage.getItem('userMenuCollapsed') === 'true';

    // 1. Botão Toggle (Chevron)
    const toggleBtn = document.createElement('button');
    toggleBtn.className = `toggle-menu-btn user-menu-btn w-10 h-10 flex items-center justify-center bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white rounded-xl hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 transition-all duration-300 shadow-lg hover:shadow-2xl ${isCollapsed ? 'rotated' : ''}`;
    toggleBtn.innerHTML = '<i class="fas fa-chevron-left text-sm"></i>';
    toggleBtn.title = isCollapsed ? "Expandir Menu" : "Recolher Menu";
    toggleBtn.style.animation = 'pulseGlow 3s ease-in-out infinite';

    // Wrapper para os itens do menu (que serão escondidos/mostrados)
    const menuItems = document.createElement('div');
    menuItems.className = 'flex items-center gap-3 transition-all duration-300 overflow-hidden';
    menuItems.style.maxWidth = isCollapsed ? '0px' : '400px';
    menuItems.style.opacity = isCollapsed ? '0' : '1';

    // 2. Ícone de Perfil
    const profileBtn = document.createElement('a');
    profileBtn.href = 'profile.html';
    profileBtn.className = 'user-menu-btn w-10 h-10 flex items-center justify-center bg-gradient-to-br from-blue-500 to-cyan-600 text-white rounded-xl hover:from-blue-600 hover:to-cyan-700 transition-all duration-200 shadow-md hover:shadow-xl hover:scale-110';
    profileBtn.innerHTML = '<i class="fas fa-user text-sm"></i>';
    profileBtn.title = "Meu Perfil";

    // 3. Nome do Usuário
    const userName = document.createElement('span');
    userName.className = 'text-sm font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent hidden sm:block whitespace-nowrap';
    userName.textContent = userData.name.split(' ')[0];

    menuItems.appendChild(profileBtn);
    menuItems.appendChild(userName);

    // 4. Botão ADMIN (Só aparece se for admin)
    if (userData.isAdmin) {
        const divider = document.createElement('div');
        divider.className = 'w-px h-6 bg-gradient-to-b from-transparent via-purple-300 to-transparent mx-1';
        menuItems.appendChild(divider);

        const adminBtn = document.createElement('a');
        adminBtn.href = 'admin.html';
        adminBtn.className = 'user-menu-btn flex items-center justify-center w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 text-white hover:from-purple-600 hover:to-pink-700 rounded-xl transition-all duration-200 shadow-md hover:shadow-xl hover:scale-110';
        adminBtn.innerHTML = '<i class="fas fa-user-shield text-sm"></i>';
        adminBtn.title = "Painel Admin";
        menuItems.appendChild(adminBtn);
    }

    // 5. Divisor e Logout
    const divider2 = document.createElement('div');
    divider2.className = 'w-px h-6 bg-gradient-to-b from-transparent via-gray-300 to-transparent mx-1';
    menuItems.appendChild(divider2);

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'user-menu-btn flex items-center justify-center w-10 h-10 text-white bg-gradient-to-br from-red-500 to-orange-600 hover:from-red-600 hover:to-orange-700 rounded-xl transition-all duration-200 shadow-md hover:shadow-xl hover:scale-110';
    logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt text-sm"></i>';
    logoutBtn.title = "Sair";
    logoutBtn.onclick = () => {
        if (confirm('Deseja sair do sistema?')) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
            window.location.href = 'login.html';
        }
    };
    menuItems.appendChild(logoutBtn);

    // Evento de toggle
    toggleBtn.onclick = () => {
        const isCurrentlyCollapsed = menuItems.style.maxWidth === '0px';

        if (isCurrentlyCollapsed) {
            // Expandir
            menuItems.style.maxWidth = '400px';
            menuItems.style.opacity = '1';
            toggleBtn.classList.remove('rotated');
            toggleBtn.title = "Recolher Menu";
            localStorage.setItem('userMenuCollapsed', 'false');
        } else {
            // Recolher
            menuItems.style.maxWidth = '0px';
            menuItems.style.opacity = '0';
            toggleBtn.classList.add('rotated');
            toggleBtn.title = "Expandir Menu";
            localStorage.setItem('userMenuCollapsed', 'true');
        }
    };

    // ========================================
    // 🎯 FUNCIONALIDADE DE ARRASTAR (DRAG & DROP) 
    // ========================================
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    // Carrega posição salva ou usa posição padrão
    const savedPosition = localStorage.getItem('userMenuPosition');
    if (savedPosition) {
        try {
            const { x, y } = JSON.parse(savedPosition);
            // Valida se a posição está dentro da tela (permite 50px fora)
            if (x > -200 && x < window.innerWidth - 50 && y > -100 && y < window.innerHeight - 50) {
                xOffset = x;
                yOffset = y;
                container.style.transform = `translate(${x}px, ${y}px)`;
                container.style.bottom = 'auto';
                container.style.left = 'auto';
                container.style.top = '1rem';
            } else {
                // Posição inválida, remove do localStorage
                localStorage.removeItem('userMenuPosition');
            }
        } catch (e) {
            // Se houver erro no JSON, remove
            localStorage.removeItem('userMenuPosition');
        }
    }

    // Adiciona cursor grab
    container.style.cursor = 'grab';
    container.title = "Arraste para mover | Duplo clique para resetar posição";

    // Mouse down - inicia drag
    container.addEventListener('mousedown', (e) => {
        // Ignora se clicou em um botão
        if (e.target.closest('a, button')) return;

        isDragging = true;
        container.style.cursor = 'grabbing';
        container.style.transition = 'none'; // Remove transição durante o drag

        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
    });

    // Mouse move - arrasta
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        e.preventDefault();

        // Calcula nova posição
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;

        // LIMITES DA VIEWPORT - impede sair completamente da tela
        const menuRect = container.getBoundingClientRect();
        const maxX = window.innerWidth - menuRect.width;
        const maxY = window.innerHeight - menuRect.height;

        // Aplica limites (permite 50px fora horizontal, 20px vertical)
        currentX = Math.max(-50, Math.min(currentX, maxX + 50));
        currentY = Math.max(-20, Math.min(currentY, maxY + 20));

        xOffset = currentX;
        yOffset = currentY;

        container.style.transform = `translate(${currentX}px, ${currentY}px)`;
        container.style.bottom = 'auto';
        container.style.left = 'auto';
        container.style.top = '1rem';
    });

    // Mouse up - finaliza drag
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            container.style.cursor = 'grab';
            container.style.transition = 'all 0.3s ease'; // Restaura transição

            // Salva posição no localStorage
            localStorage.setItem('userMenuPosition', JSON.stringify({
                x: xOffset,
                y: yOffset
            }));
        }
    });

    // Double click - reseta posição
    container.addEventListener('dblclick', () => {
        xOffset = 0;
        yOffset = 0;
        container.style.transform = 'translate(0, 0)';
        container.style.bottom = '1rem';
        container.style.left = '1rem';
        localStorage.removeItem('userMenuPosition');

        // Feedback visual
        container.style.animation = 'none';
        setTimeout(() => {
            container.style.animation = 'slideInLeft 0.6s cubic-bezier(0.68, -0.55, 0.27, 1.55)';
        }, 10);
    });

    // ========================================
    // FIM DA FUNCIONALIDADE DE DRAG & DROP
    // ========================================

    // Monta o menu
    container.appendChild(toggleBtn);
    container.appendChild(menuItems);
    document.body.appendChild(container);
}
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
    container.className = 'fixed bottom-4 left-4 z-[1100] flex items-center gap-3 rounded-2xl shadow-2xl border border-white/20 transition-all duration-300';

    // Verifica estado salvo no localStorage
    const isCollapsed = localStorage.getItem('userMenuCollapsed') === 'true';

    // Ajusta padding baseado no estado
    container.style.padding = isCollapsed ? '0.75rem' : '0.75rem 1.25rem';

    // Glassmorphism background
    container.style.cssText += `
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.85) 100%);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
    `;

    // ============================================
    // 1. AVATAR/FOTO DO PERFIL (Sempre visível + Toggle)
    // ============================================
    const avatarBtn = document.createElement('button');
    avatarBtn.className = 'user-menu-btn w-11 h-11 flex items-center justify-center bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white rounded-full hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 transition-all duration-300 shadow-lg hover:shadow-2xl hover:scale-110 flex-shrink-0';
    avatarBtn.style.animation = 'pulseGlow 3s ease-in-out infinite';

    // Se houver foto do perfil, usa. Senão, usa ícone
    if (userData.photoUrl) {
        avatarBtn.style.backgroundImage = `url(${userData.photoUrl})`;
        avatarBtn.style.backgroundSize = 'cover';
        avatarBtn.style.backgroundPosition = 'center';
    } else {
        // Pega iniciais do nome
        const initials = userData.name
            .split(' ')
            .map(n => n[0])
            .slice(0, 2)
            .join('')
            .toUpperCase();
        avatarBtn.innerHTML = `<span class="font-bold text-sm">${initials}</span>`;
    }

    avatarBtn.title = isCollapsed ? `${userData.name} - Clique para expandir` : `${userData.name} - Clique para recolher`;

    // ============================================
    // 2. MENU ITEMS (Escondíveis)
    // ============================================
    const menuItems = document.createElement('div');
    menuItems.className = 'flex items-center gap-3 transition-all duration-300 overflow-hidden';
    menuItems.style.maxWidth = isCollapsed ? '0px' : '400px';
    menuItems.style.opacity = isCollapsed ? '0' : '1';

    // Link para perfil
    const profileLink = document.createElement('a');
    profileLink.href = 'profile.html';
    profileLink.className = 'text-sm font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent hover:from-indigo-700 hover:to-purple-700 whitespace-nowrap transition-all duration-200';
    profileLink.textContent = 'Perfil';
    profileLink.title = "Ver meu perfil";
    menuItems.appendChild(profileLink);

    // Nome do Usuário
    const userName = document.createElement('span');
    userName.className = 'text-xs text-gray-500 hidden sm:block whitespace-nowrap';
    userName.textContent = `(${userData.name.split(' ')[0]})`;
    menuItems.appendChild(userName);

    // Botão ADMIN (Só aparece se for admin)
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

    // Divisor e Logout
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

    // ============================================
    // 3. EVENTO DE CLICK DO AVATAR
    // ============================================
    avatarBtn.onclick = (e) => {
        e.stopPropagation(); // Impede propagação para o container

        // Shift + Click = Ir para perfil
        if (e.shiftKey) {
            window.location.href = 'profile.html';
            return;
        }

        // Click simples = Toggle menu
        const isCurrentlyCollapsed = menuItems.style.maxWidth === '0px';

        if (isCurrentlyCollapsed) {
            // Expandir
            menuItems.style.maxWidth = '400px';
            menuItems.style.opacity = '1';
            container.style.padding = '0.75rem 1.25rem';
            avatarBtn.title = `${userData.name} - Clique: toggle | Shift+Clique: perfil`;
            localStorage.setItem('userMenuCollapsed', 'false');
        } else {
            // Recolher
            menuItems.style.maxWidth = '0px';
            menuItems.style.opacity = '0';
            container.style.padding = '0.75rem';
            avatarBtn.title = `${userData.name} - Clique: toggle | Shift+Clique: perfil`;
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

    // Posicionamento Robusto: Usamos top/left 0 e transform para evitar conflitos de stretching
    container.style.top = '0';
    container.style.left = '0';
    container.style.bottom = 'auto';

    if (savedPosition) {
        try {
            const { x, y } = JSON.parse(savedPosition);
            xOffset = x;
            yOffset = y;
        } catch (e) {
            localStorage.removeItem('userMenuPosition');
        }
    } else {
        // Posição Inicial Padrão sem stretching
        xOffset = 16;
        // Se mobile, sobe um pouco mais para não bater na nav
        const isMobile = window.innerWidth < 1024;
        yOffset = window.innerHeight - (isMobile ? 160 : 80);
    }

    container.style.transform = `translate(${xOffset}px, ${yOffset}px)`;

    // Adiciona cursor grab
    container.style.cursor = 'grab';
    container.title = "Arraste para mover | Duplo clique para resetar posição";

    // Mouse down - inicia drag
    container.addEventListener('mousedown', (e) => {
        // Permite arrastar pelo avatar, mas não pelos botões de ação/links
        if (e.target.closest('a') || (e.target.closest('button') && e.target !== avatarBtn)) return;

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

    // ========================================
    // 📱 TOUCH EVENTS PARA MOBILE
    // ========================================

    // Touch start - inicia drag no mobile
    container.addEventListener('touchstart', (e) => {
        // Permite arrastar pelo avatar
        if (e.target.closest('a') || (e.target.closest('button') && e.target !== avatarBtn)) return;

        const touch = e.touches[0];
        isDragging = true;
        container.style.transition = 'none';

        initialX = touch.clientX - xOffset;
        initialY = touch.clientY - yOffset;
    }, { passive: false });

    // Touch move - arrasta no mobile
    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;

        // Impede scroll enquanto arrasta o menu
        if (e.cancelable) e.preventDefault();

        const touch = e.touches[0];
        currentX = touch.clientX - initialX;
        currentY = touch.clientY - initialY;

        // LIMITES DA VIEWPORT
        const menuRect = container.getBoundingClientRect();
        const maxX = window.innerWidth - menuRect.width;
        const maxY = window.innerHeight - menuRect.height;

        currentX = Math.max(-50, Math.min(currentX, maxX + 50));
        currentY = Math.max(-20, Math.min(currentY, maxY + 20));

        xOffset = currentX;
        yOffset = currentY;

        container.style.transform = `translate(${currentX}px, ${currentY}px)`;
    }, { passive: false });

    // Touch end - finaliza drag no mobile
    document.addEventListener('touchend', () => {
        if (isDragging) {
            isDragging = false;
            container.style.transition = 'all 0.3s ease';

            localStorage.setItem('userMenuPosition', JSON.stringify({
                x: xOffset,
                y: yOffset
            }));
        }
    });

    // ========================================
    // LONG PRESS NO AVATAR PARA MOBILE
    // ========================================
    let longPressTimer;
    const LONG_PRESS_DURATION = 500; // 500ms

    avatarBtn.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => {
            // Long press detectado - vai para perfil
            window.location.href = 'profile.html';
        }, LONG_PRESS_DURATION);
    }, { passive: true });

    avatarBtn.addEventListener('touchend', () => {
        clearTimeout(longPressTimer);
    });

    avatarBtn.addEventListener('touchmove', () => {
        clearTimeout(longPressTimer);
    });

    // Double click - reseta posição (só no container, não nos botões)
    container.addEventListener('dblclick', (e) => {
        // Ignora se clicar nos botões
        if (e.target.closest('button, a')) return;

        // Reseta para o padrão inicial seguro
        const isMobile = window.innerWidth < 1024;
        xOffset = 16;
        yOffset = window.innerHeight - (isMobile ? 160 : 80);

        container.style.transform = `translate(${xOffset}px, ${yOffset}px)`;

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

    // Monta o menu (Avatar sempre visível + Menu items)
    container.appendChild(avatarBtn);
    container.appendChild(menuItems);
    document.body.appendChild(container);
}
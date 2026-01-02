/**
 * PWA Init - Sistema Operante Aero Festas v1.0.0
 * Gerencia o Service Worker e atualizações forçadas via GitHub/Servidor
 */

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then((registration) => {
                console.log('✅ PWA: Service Worker registrado com sucesso:', registration.scope);

                // Detecta se há uma nova versão aguardando
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('🔄 PWA: Nova atualização disponível!');
                            // O SW já chama skipWaiting() no install, 
                            // então o evento 'controllerchange' será disparado abaixo.
                        }
                    });
                });
            })
            .catch((error) => {
                console.error('❌ PWA: Erro ao registrar Service Worker:', error);
            });
    });

    // Evento para capturar o prompt de instalação
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        // Impede que o mini-infobar apareça no mobile
        e.preventDefault();
        // Guarda o evento para ser disparado depois
        deferredPrompt = e;
        console.log('📱 PWA: Prompt de instalação capturado');

        // Opcional: Mostrar um botão de instalação personalizado
        showInstallPromotion();
    });

    window.addEventListener('appinstalled', (event) => {
        console.log('🎉 PWA: Aplicativo instalado com sucesso!');
        deferredPrompt = null;
        // Esconde o botão de instalação se ele estiver visível
        const installBtn = document.getElementById('pwa-install-btn');
        if (installBtn) installBtn.style.display = 'none';
    });

    // Evento crucial: Disparado quando o novo Service Worker assume o controle
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            console.log('🚀 PWA: Forçando atualização para a nova versão...');

            // Exibe um aviso rápido antes de recarregar (opcional, mas bom UX)
            showUpdateToast();

            setTimeout(() => {
                window.location.reload();
            }, 1500);
        }
    });
}

function showInstallPromotion() {
    // Só mostra se ainda não existir o botão
    if (document.getElementById('pwa-install-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'pwa-install-btn';
    btn.innerHTML = '<i class="fas fa-download mr-2"></i>Instalar App';
    btn.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4f46e5;
        color: white;
        padding: 10px 20px;
        border-radius: 50px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        z-index: 9999;
        font-family: sans-serif;
        font-weight: bold;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        animation: slideDownPWA 0.5s ease-out;
    `;

    btn.addEventListener('click', async () => {
        if (!deferredPrompt) return;

        // Mostra o prompt nativo
        deferredPrompt.prompt();

        // Aguarda a resposta do usuário
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);

        // Limpa o prompt
        deferredPrompt = null;
        btn.style.display = 'none';
    });

    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideDownPWA {
            from { transform: translateY(-120%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(btn);
}

function showUpdateToast() {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #4f46e5;
        color: white;
        padding: 15px 25px;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        z-index: 10000;
        font-family: sans-serif;
        font-weight: bold;
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideInPWA 0.5s ease-out;
    `;

    toast.innerHTML = `
        <i class="fas fa-sync fa-spin"></i>
        <span>Atualizando para a v1.0.0...</span>
    `;

    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInPWA {
            from { transform: translateX(120%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(toast);
}


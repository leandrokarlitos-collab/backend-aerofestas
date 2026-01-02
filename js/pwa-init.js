/**
 * PWA Init - Sistema Operante Aero Festas v1.0.0
 * Gerencia o Service Worker e atualizações forçadas via GitHub/Servidor
 */

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
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


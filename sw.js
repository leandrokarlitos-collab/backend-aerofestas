const CACHE_NAME = 'aero-festas-v1.0.5';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/login.html',
    '/Dashboard.html',
    '/Sistema%20de%20CRM.html',
    '/Sistema%20Gest%C3%A3o%20Financeira.html',
    '/Agenda%20de%20eventos.html',
    '/admin.html',
    '/profile.html',
    '/register.html',
    '/forgot-password.html',
    '/reset-password.html',
    '/confirm-email.html',
    '/js/auth.js',
    '/js/api.js',
    '/js/protect.js',
    '/js/pwa-init.js',
    '/js/charts-financeiro.js',
    '/js/charts-init.js',
    '/js/profile.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/pwa-desktop.png',
    '/icons/pwa-mobile.png',
    '/Logo_aviao.ico'
    // CDNs externos removidos para evitar erro de CORS no cache inicial
];

// Instalação - Cache inicial
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('📦 PWA: Cacheando assets essenciais...');
            // addAll falha se qualquer um falhar. Usamos map para tentar individualmente se necessário?
            // Mas para PWA instalável, o cache inicial deve ser íntegro.
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => self.skipWaiting())
    );
});

// Ativação - Limpeza de caches antigos
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ PWA: Removendo cache antigo:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch - Estratégia Stale-While-Revalidate (Otimizada para CDNs)
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Ignora requisições de API, websockets e extensões do Chrome
    if (url.pathname.includes('/api/') || 
        url.protocol === 'chrome-extension:' || 
        url.protocol === 'ws:' || 
        url.protocol === 'wss:') {
        return;
    }

    // Estratégia especial para CDNs externos
    const isExternalCDN = !url.origin.includes('agenda-aero-festas.web.app') && 
                          !url.origin.includes('localhost') &&
                          !url.origin.includes('127.0.0.1');

    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            // Se temos cache e é CDN externo, usa cache primeiro
            if (cachedResponse && isExternalCDN) {
                return cachedResponse;
            }

            // Tenta buscar da rede
            const fetchRequest = isExternalCDN 
                ? new Request(request.url, { mode: 'no-cors' })
                : request;

            return fetch(fetchRequest)
                .then((networkResponse) => {
                    // Cacheia apenas respostas bem-sucedidas
                    if (networkResponse && networkResponse.status === 200) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseToCache);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // Se falhar e temos cache, retorna cache
                    return cachedResponse || new Response('Offline', { 
                        status: 503, 
                        statusText: 'Service Unavailable' 
                    });
                });
        })
    );
});

// Evento de Recebimento de Push
self.addEventListener('push', (event) => {
    let data = { title: 'Aero Festas', body: 'Novidade no sistema!' };

    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: data.url || '/',
        vibrate: [100, 50, 100],
        actions: [
            { action: 'open', title: 'Ver Agora' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Evento de Clique na Notificação
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((clientList) => {
            for (const client of clientList) {
                if (client.url === event.notification.data && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data);
            }
        })
    );
});


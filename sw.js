const CACHE_NAME = 'aero-festas-v1.0.3';
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
    '/Logo_aviao.ico',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.tailwindcss.com'
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

// Fetch - Estratégia Stale-While-Revalidate
self.addEventListener('fetch', (event) => {
    // Ignora requisições de API e Chrome Extensions
    if (event.request.url.includes('/api/') || event.request.url.startsWith('chrome-extension')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request)
                .then((networkResponse) => {
                    // Cacheia apenas respostas bem-sucedidas (status 200)
                    // Permitimos 'basic' (mesma origem) e 'cors' (CDNs)
                    if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // Offline fallback
                    return cachedResponse || Response.error();
                });

            return cachedResponse || fetchPromise;
        })
    );
});


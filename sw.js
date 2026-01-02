const CACHE_NAME = 'aero-festas-v1.0.0';
const ASSETS_TO_CACHE = [
    '/',
    '/login.html',
    '/Dashboard.html',
    '/js/auth.js',
    '/js/api.js',
    '/js/protect.js',
    '/js/pwa-init.js',
    '/manifest.json'
];

// Instalação - Cache inicial
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting(); // Força a ativação imediata do novo SW
});

// Ativação - Limpeza de caches antigos
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim(); // Assume o controle das abas abertas imediatamente
});

// Fetch - Estratégia Stale-While-Revalidate
self.addEventListener('fetch', (event) => {
    // Ignora requisições de API para não cachear dados dinâmicos do banco
    if (event.request.url.includes('/api/')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                // Atualiza o cache com a nova versão do arquivo
                if (networkResponse && networkResponse.status === 200) {
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, networkResponse.clone());
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Se falhar a rede, apenas retorna o que tiver no cache
            });

            return cachedResponse || fetchPromise;
        })
    );
});


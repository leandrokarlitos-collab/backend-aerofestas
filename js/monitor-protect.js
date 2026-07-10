/**
 * Guard do APP DO MONITOR (F1) — não confundir com js/protect.js (guard do gestor).
 * Sessão do monitor usa a chave 'monitorToken' (separada de 'authToken').
 *
 * Valida GET /api/monitor/auth/me; se o token for inválido, expirado ou o acesso
 * tiver sido bloqueado pelo gestor, limpa a sessão e volta para o login.
 * Em caso de sucesso expõe window.MONITOR_ME e dispara o evento 'monitor:ready'.
 */
(function () {
    const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api'
        : 'https://backend-aerofestas-production.up.railway.app/api';

    const LOGIN_URL = 'login.html';

    function sair() {
        localStorage.removeItem('monitorToken');
        localStorage.removeItem('monitorNome');
        window.location.replace(LOGIN_URL);
    }

    window.monitorLogout = sair;

    const token = localStorage.getItem('monitorToken');
    if (!token) { sair(); return; }

    fetch(`${API_BASE}/monitor/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
        .then(async (res) => {
            if (!res.ok) { sair(); return; }
            const me = await res.json();
            window.MONITOR_ME = me;
            localStorage.setItem('monitorNome', me.nome || '');
            document.dispatchEvent(new CustomEvent('monitor:ready', { detail: me }));
        })
        .catch(() => {
            // Sem rede: mantém a sessão local (o conteúdo F1 é estático);
            // o próximo request com rede revalida.
            const nome = localStorage.getItem('monitorNome') || '';
            window.MONITOR_ME = { nome };
            document.dispatchEvent(new CustomEvent('monitor:ready', { detail: window.MONITOR_ME }));
        });
})();

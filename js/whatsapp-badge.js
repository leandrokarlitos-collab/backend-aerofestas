/**
 * WhatsApp Badge Global - Sistema Operante Aero Festas
 * Polling de mensagens não-lidas para atualizar badge na bottom-nav
 */

(function () {
    const WA_API = 'https://backend-aerofestas-production.up.railway.app/api/whatsapp';
    const POLL_INTERVAL = 30000; // 30 segundos

    function updateBadge(count) {
        const badge = document.getElementById('wa-nav-badge');
        if (!badge) return;

        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.classList.remove('hidden');
            badge.style.display = 'flex';
        } else {
            badge.classList.add('hidden');
            badge.style.display = 'none';
        }
    }

    async function fetchUnreadCount() {
        try {
            const token = localStorage.getItem('authToken');
            if (!token) return;

            const res = await fetch(`${WA_API}/unread-count`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) return;

            const data = await res.json();
            const total = (data.instances || []).reduce((sum, inst) => sum + (inst.unreadCount || 0), 0);
            updateBadge(total);
        } catch (e) {
            // Silently fail - badge just won't update
        }
    }

    // Initial fetch after page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(fetchUnreadCount, 2000));
    } else {
        setTimeout(fetchUnreadCount, 2000);
    }

    // Polling
    setInterval(fetchUnreadCount, POLL_INTERVAL);
})();

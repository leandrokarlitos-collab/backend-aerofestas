/* ============================================================
   AERO FESTAS · RASTREADOR DE PROPOSTA (jardins-florenca)
   Envia eventos anônimos por sessão ao backend:
   - view   : abertura da página
   - scroll : marcos de profundidade (25/50/75/100) e seções vistas
   - click  : cliques em CTAs (whatsapp/telefone/email/ampliar)
   - end    : tempo na página + rolagem máxima (ao sair)
   Tudo via sendBeacon (text/plain, sem preflight). Nunca quebra a página.
   ============================================================ */
(() => {
  'use strict';
  try {
    const SLUG = 'jardins-florenca';
    const ENDPOINT = 'https://backend-aerofestas-production.up.railway.app/api/public/track';

    // sessionId persistente (dedupe de visitas do mesmo navegador)
    let sid;
    try {
      sid = localStorage.getItem('af_track_sid');
      if (!sid) {
        sid = 's' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem('af_track_sid', sid);
      }
    } catch (_) {
      sid = 's' + Math.random().toString(36).slice(2);
    }

    // Atribuição opcional por destinatário: .../p/jardins-florenca?c=sindico-joao
    let visitor = null;
    try { visitor = new URLSearchParams(location.search).get('c'); } catch (_) {}

    const startedAt = Date.now();
    let maxScroll = 0;
    const sentDepth = new Set();
    const sentSections = new Set();

    function send(type, extra) {
      const payload = JSON.stringify(Object.assign({
        slug: SLUG, sessionId: sid, visitor: visitor || null,
        type, referrer: document.referrer || null
      }, extra || {}));
      try {
        const blob = new Blob([payload], { type: 'text/plain' });
        if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return;
      } catch (_) {}
      // Fallback: fetch keepalive (também text/plain para evitar preflight)
      try {
        fetch(ENDPOINT, {
          method: 'POST', body: payload, mode: 'cors', keepalive: true,
          headers: { 'Content-Type': 'text/plain' }
        }).catch(() => {});
      } catch (_) {}
    }

    // 1) Abertura
    send('view');

    // 2) Profundidade de rolagem (marcos)
    function computeScroll() {
      const h = document.documentElement;
      const scrollable = h.scrollHeight - h.clientHeight;
      const pct = scrollable > 0 ? Math.min(100, Math.round((h.scrollTop / scrollable) * 100)) : 100;
      if (pct > maxScroll) maxScroll = pct;
      [25, 50, 75, 100].forEach((m) => {
        if (maxScroll >= m && !sentDepth.has(m)) {
          sentDepth.add(m);
          send('scroll', { scrollPct: m, label: 'depth' });
        }
      });
    }
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; computeScroll(); }); }
    }, { passive: true });
    computeScroll();

    // 3) Seções alcançadas (quais partes o cliente realmente viu)
    const SECTIONS = [
      ['hero', '.hero'],
      ['brinquedos', '#brinquedos'],
      ['resumo-precos', '.price-summary'],
      ['por-que-aero', '.why'],
      ['como-funciona', '.how'],
      ['cta-final', '.cta-final']
    ];
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const name = e.target.getAttribute('data-track-section');
          if (name && !sentSections.has(name)) {
            sentSections.add(name);
            send('scroll', { label: name, scrollPct: maxScroll });
          }
        });
      }, { threshold: 0.4 });
      SECTIONS.forEach(([name, sel]) => {
        const el = document.querySelector(sel);
        if (el) { el.setAttribute('data-track-section', name); io.observe(el); }
      });
    }

    // 4) Cliques em CTAs
    document.addEventListener('click', (ev) => {
      const el = ev.target.closest && ev.target.closest('a[href], button');
      if (!el) return;
      const href = (el.getAttribute && el.getAttribute('href')) || '';
      let label = null;
      if (href.indexOf('wa.me') !== -1) label = 'whatsapp';
      else if (href.indexOf('tel:') === 0) label = 'telefone';
      else if (href.indexOf('mailto:') === 0) label = 'email';
      else if (el.classList && el.classList.contains('toy-zoom')) label = 'ampliar-foto';
      else if (el.classList && el.classList.contains('btn')) label = 'botao';
      if (label) send('click', { label });
    }, true);

    // 5) Encerramento: tempo na página + rolagem máxima
    function flushEnd() {
      send('end', { scrollPct: maxScroll, durationMs: Date.now() - startedAt });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushEnd();
    });
    window.addEventListener('pagehide', flushEnd);
  } catch (_) {
    // Rastreamento nunca deve afetar a experiência da proposta.
  }
})();

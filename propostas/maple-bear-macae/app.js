/* ============================================================
   AERO FESTAS · PROPOSTA MAPLE BEAR · APP
   ============================================================ */
(() => {
  'use strict';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = matchMedia('(hover: none)').matches;

  /* ---------- 1. SCROLL PROGRESS BAR ---------- */
  const bar = document.querySelector('.scroll-progress');
  let scrollRaf = 0;
  function updateScrollProgress() {
    const h = document.documentElement;
    const scrollable = h.scrollHeight - h.clientHeight;
    const ratio = scrollable > 0 ? Math.min(1, h.scrollTop / scrollable) : 0;
    if (bar) bar.style.transform = `scaleX(${ratio})`;
  }
  window.addEventListener('scroll', () => {
    if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updateScrollProgress(); });
  }, { passive: true });
  updateScrollProgress();

  /* ---------- 2. SCROLL REVEAL (IO + STAGGER) ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const parent = el.closest('.reveal-group');
        let delay = 0;
        if (parent) {
          const siblings = [...parent.querySelectorAll('.reveal')];
          delay = siblings.indexOf(el) * 80;
        }
        el.style.transitionDelay = `${delay}ms`;
        el.classList.add('is-visible');
        io.unobserve(el);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -10% 0px' });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  /* ---------- 3. STAT COUNTERS ---------- */
  const counters = document.querySelectorAll('[data-counter]');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const cio = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const target = +el.dataset.counter;
        const dur = 1200;
        const start = performance.now();
        const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
        function tick(now) {
          const t = Math.min(1, (now - start) / dur);
          el.textContent = Math.round(target * easeOutCubic(t));
          if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        cio.unobserve(el);
      });
    }, { threshold: 0.5 });
    counters.forEach((c) => cio.observe(c));
  } else {
    counters.forEach((c) => { c.textContent = c.dataset.counter; });
  }

  /* ---------- 4. HERO PARALLAX ---------- */
  const heroBg = document.querySelector('.hero-bg');
  const floatCards = document.querySelectorAll('.float-card');
  if (heroBg && !reduceMotion) {
    let ticking = false;
    function onParallax() {
      const y = window.scrollY;
      if (y > 800) return; // skip when out of view
      heroBg.style.transform = `translate3d(0, ${y * 0.18}px, 0)`;
      floatCards.forEach((card, i) => {
        const factor = 0.05 + i * 0.025;
        card.style.translate = `0 ${y * factor}px`;
      });
      ticking = false;
    }
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(onParallax); }
    }, { passive: true });
  }

  /* ---------- 5. MAGNETIC BUTTONS (DESKTOP) ---------- */
  if (!isTouch && !reduceMotion) {
    const magnets = document.querySelectorAll('.btn-magnetic');
    magnets.forEach((btn) => {
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        btn.style.transform = `translate(${x * 0.18}px, ${y * 0.28}px)`;
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  }

  /* ---------- 6. CARD TILT 3D (DESKTOP) ---------- */
  if (!isTouch && !reduceMotion) {
    const cards = document.querySelectorAll('.toy-card');
    cards.forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        const rx = (py - 0.5) * -6;
        const ry = (px - 0.5) * 6;
        card.style.transform = `perspective(1000px) translateY(-6px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
  }

  /* ---------- 7. STICKY MOBILE CTA ---------- */
  const stickyCta = document.querySelector('.sticky-mobile-cta');
  const hero = document.querySelector('.hero');
  if (stickyCta && hero && 'IntersectionObserver' in window) {
    const sio = new IntersectionObserver(
      ([entry]) => stickyCta.classList.toggle('is-visible', !entry.isIntersecting),
      { threshold: 0, rootMargin: '-30% 0px 0px 0px' }
    );
    sio.observe(hero);
  }

  /* ---------- 8. LIGHTBOX (galeria swipeable) ---------- */
  const dlg = document.getElementById('lightbox');
  const track = document.getElementById('lbTrack');
  const counter = document.getElementById('lbCounter');
  const titleEl = document.getElementById('lbTitle');
  const btnPrev = dlg && dlg.querySelector('.lb-prev');
  const btnNext = dlg && dlg.querySelector('.lb-next');
  const btnClose = dlg && dlg.querySelector('.lb-close');

  // Build slide data from existing toy cards
  const toyCards = [...document.querySelectorAll('.toy-card')];
  const slides = toyCards.map((card) => {
    const idx = +card.dataset.idx;
    const img = card.querySelector('img');
    const titleNode = card.querySelector('.toy-name');
    const title = titleNode ? titleNode.textContent.trim().replace(/\s+/g, ' ') : '';
    const src = img ? img.getAttribute('src') : '';
    const srcset = img && img.parentElement.querySelector('source')
      ? img.parentElement.querySelector('source').getAttribute('srcset')
      : '';
    return { idx, src, srcset, title };
  });

  let current = 0;

  function buildLightboxSlides() {
    if (!track) return;
    track.innerHTML = '';
    slides.forEach((s) => {
      const slide = document.createElement('div');
      slide.className = 'lb-slide';
      const pic = document.createElement('picture');
      if (s.srcset) {
        const source = document.createElement('source');
        source.type = 'image/webp';
        source.srcset = s.srcset.replace(/-400\.webp/g, '-1200.webp').replace(/-800\.webp/g, '-1200.webp');
        pic.appendChild(source);
      }
      const im = document.createElement('img');
      im.src = s.src.replace(/-800\.webp/g, '-1200.webp');
      im.alt = s.title;
      im.loading = 'lazy';
      im.decoding = 'async';
      pic.appendChild(im);
      slide.appendChild(pic);
      track.appendChild(slide);
    });
  }

  function goTo(i, animate = true) {
    if (!track) return;
    current = (i + slides.length) % slides.length;
    track.style.transition = animate ? '' : 'none';
    track.style.transform = `translateX(${-current * 100}%)`;
    if (counter) counter.textContent = `${current + 1} / ${slides.length}`;
    if (titleEl) titleEl.textContent = slides[current].title;
    // Preload neighbors
    [-1, 1].forEach((d) => {
      const ni = (current + d + slides.length) % slides.length;
      const im = new Image();
      im.src = slides[ni].src.replace(/-800\.webp/g, '-1200.webp');
    });
  }

  function openLightbox(idx) {
    if (!dlg) return;
    if (track && !track.children.length) buildLightboxSlides();
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    document.body.style.overflow = 'hidden';
    goTo(idx - 1, false);
  }

  function closeLightbox() {
    if (!dlg) return;
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
    document.body.style.overflow = '';
  }

  // Wire toy cards
  toyCards.forEach((card) => {
    const idx = +card.dataset.idx;
    card.addEventListener('click', (e) => {
      // Avoid double-trigger from inner button
      if (e.target.closest('.toy-zoom')) return;
      openLightbox(idx);
    });
    const zoomBtn = card.querySelector('.toy-zoom');
    if (zoomBtn) {
      zoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(+zoomBtn.dataset.open);
      });
    }
  });

  if (btnPrev) btnPrev.addEventListener('click', () => goTo(current - 1));
  if (btnNext) btnNext.addEventListener('click', () => goTo(current + 1));
  if (btnClose) btnClose.addEventListener('click', closeLightbox);

  // Keyboard navigation
  if (dlg) {
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') goTo(current - 1);
      else if (e.key === 'ArrowRight') goTo(current + 1);
      else if (e.key === 'Escape') closeLightbox();
    });
    dlg.addEventListener('click', (e) => {
      // Click on backdrop closes
      if (e.target === dlg) closeLightbox();
    });
  }

  // Touch swipe
  if (track) {
    let startX = 0, startY = 0, dx = 0, dragging = false, locked = false;
    track.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0; dragging = true; locked = false;
      track.style.transition = 'none';
    }, { passive: true });
    track.addEventListener('touchmove', (e) => {
      if (!dragging || e.touches.length !== 1) return;
      const x = e.touches[0].clientX - startX;
      const y = e.touches[0].clientY - startY;
      if (!locked) {
        if (Math.abs(y) > Math.abs(x) + 6) { dragging = false; return; }
        locked = true;
      }
      dx = x;
      const offset = -current * 100 + (dx / track.clientWidth) * 100;
      track.style.transform = `translateX(${offset}%)`;
    }, { passive: true });
    track.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      track.style.transition = '';
      const threshold = track.clientWidth * 0.2;
      if (dx < -threshold) goTo(current + 1);
      else if (dx > threshold) goTo(current - 1);
      else goTo(current);
    });
  }

  /* ---------- 9. FOOTER YEAR ---------- */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- 10. SMOOTH SCROLL OFFSET FIX ---------- */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      if (href.length <= 1) return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 20;
      window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  });

})();

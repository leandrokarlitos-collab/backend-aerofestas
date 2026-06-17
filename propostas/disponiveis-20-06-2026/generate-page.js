/**
 * Gerador da página "Brinquedos disponíveis · 20/06/2026".
 * Análogo às propostas (mesmo modelo visual + lightbox para ampliar a foto).
 *
 * O que faz:
 *  1. Converte as fotos de /fotos_dos_brinquedos/* em 3 tamanhos WebP (400/800/1200)
 *     dentro de ./img/toys/
 *  2. Copia styles.css e app.js do _shared (página fica autossuficiente)
 *  3. Gera o index.html estático com um card por brinquedo
 *
 * Para mudar a LISTA de brinquedos: edite o array TOYS abaixo e rode de novo:
 *   node propostas/disponiveis-20-06-2026/generate-page.js
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'fotos_dos_brinquedos');
const SHARED = path.join(ROOT, 'propostas', '_shared');
const OUT_IMG = path.join(__dirname, 'img', 'toys');

/* ===== CONFIG DA PÁGINA ===== */
const EVENT_DATE_ISO = '2026-06-20';
const EVENT_DATE_BR = '20 de junho de 2026';
const EVENT_DATE_SHORT = '20/06/2026';
// Data em que a página foi gerada (carimbo de "verificar disponibilidade")
const _now = new Date();
const GENERATED_DATE_BR = `${String(_now.getDate()).padStart(2, '0')}/${String(_now.getMonth() + 1).padStart(2, '0')}/${_now.getFullYear()}`;
const WHATSAPP_NUMBER = '5562985545046';
const WHATSAPP_MSG = `Olá! Vi os brinquedos disponíveis para ${EVENT_DATE_SHORT} e gostaria de conversar.`;

/* ===== LISTA DE BRINQUEDOS (disponíveis em 20/06/2026) =====
   in       = nome do arquivo original em /fotos_dos_brinquedos
   copyFrom = (alternativa a "in") nome de uma proposta de onde copiar o webp já otimizado;
              nesse caso "in" é o slug de origem dentro de propostas/<copyFrom>/img/toys
   slug     = nome base dos arquivos webp gerados
   name     = título principal do card
   sub      = subtítulo opcional (variação) */
const TOYS = [
  { in: 'liga-justica', copyFrom: 'salesianos',  slug: '01-multipark-liga-justica',        name: 'Multipark', sub: 'Liga da Justiça' },
  { in: 'Multipark Safari.jpg',                   slug: '02-multipark-safari',              name: 'Multipark', sub: 'Safari' },
  { in: 'Multipark Castelo Park.jpg',             slug: '03-multipark-castelo-park',        name: 'Multipark', sub: 'Castelo Park' },
  { in: 'alpinismo', copyFrom: 'salesianos',      slug: '04-alpinismo',                     name: 'Alpinismo Inflável' },
  { in: 'Tobogã Inflável - Premium.png',          slug: '05-toboga-tradicional',            name: 'Tobogã', sub: 'Tradicional' },
  { in: 'Combo 3 em 1 Dino.png',                  slug: '06-combo-dino',                    name: 'Combo 3 em 1', sub: 'Dino' },
  { in: 'combo_dino_pocket.png',                  slug: '07-combo-dino-pocket',             name: 'Combo 3 em 1', sub: 'Dino Pocket' },
  { in: 'Girafa Pocket.png',                      slug: '08-combo-girafa-pocket',           name: 'Combo 3 em 1', sub: 'Girafa Pocket' },
  { in: 'Futebol_Inflável_tradicional.png',       slug: '09-futebol-sabao',                 name: 'Futebol de Sabão', sub: '10×5 m' },
  { in: 'muro_de_escalada.png',                   slug: '10-muro-escalada',                 name: 'Muro de Escalada' },
  { in: 'Chute ao gol.png',                       slug: '11-chute-ao-gol',                  name: 'Chute ao Gol' },
  { in: 'Cama elástica.png',                      slug: '12-pula-pula-tradicional',         name: 'Pula Pula', sub: 'Tradicional' },
  { in: 'pula pula com bolinhas.png',             slug: '13-pula-pula-bolinhas',            name: 'Pula Pula com Bolinhas', sub: 'Foguetinho' },
  { in: 'Piscina de Bolinhas tradicional.png',    slug: '14-piscina-bolinhas-tradicional',  name: 'Piscina de Bolinhas', sub: 'Tradicional' },
  { in: 'Piscina de Bolinhas Inflável.png',       slug: '15-piscina-bolinhas-inflavel',     name: 'Piscina de Bolinhas', sub: 'Inflável' },
  { in: 'Guerra de Cotonetes.png',                slug: '16-guerra-cotonetes',              name: 'Guerra de Cotonetes' },
  { in: 'tombo legal.png',                        slug: '17-tombo-legal',                   name: 'Tombo Legal' },
  { in: 'tobogã pool party.png',                  slug: '18-toboga-pool-party',             name: 'Tobogã', sub: 'Pool Party' },
  { in: 'Tobogã Inflável - Splash.jpeg',          slug: '19-toboga-splash',                 name: 'Tobogã', sub: 'Splash' },
];

const SIZES = [400, 800, 1200];
const WA_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MSG)}`;

const ZOOM_SVG = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M15 3h6v6h-2V6.4l-4.3 4.3-1.4-1.4L17.6 5H15V3zM3 15h2v2.6l4.3-4.3 1.4 1.4L6.4 19H9v2H3v-6z"/></svg>';
const WA_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M17.5 14.4c-.3-.2-1.7-.8-2-.9-.3-.1-.5-.2-.7.1-.2.3-.8 1-1 1.2-.2.2-.4.2-.6.1-.3-.1-1.2-.4-2.3-1.4-.8-.7-1.4-1.6-1.6-1.9-.2-.3 0-.4.1-.6.1-.1.3-.4.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5 0 1.5 1.1 2.9 1.2 3.1.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.4M12 21h0a9 9 0 0 1-4.6-1.3l-.3-.2-3.4.9.9-3.3-.2-.3a9 9 0 0 1-1.4-4.8 9 9 0 0 1 9-9 9 9 0 0 1 9 9 9 9 0 0 1-9 9m7.7-16.6A10.7 10.7 0 0 0 12 1 10.7 10.7 0 0 0 1.3 11.7c0 1.9.5 3.7 1.4 5.3L1.2 23l6.2-1.6a10.7 10.7 0 0 0 5.1 1.3h0a10.7 10.7 0 0 0 10.7-10.7c0-2.9-1.1-5.6-3.1-7.6"/></svg>';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toyName(t) {
  return t.sub ? `${esc(t.name)} <span class="toy-sub">${esc(t.sub)}</span>` : esc(t.name);
}
function toyLabel(t) {
  return t.sub ? `${t.name} ${t.sub}` : t.name;
}

function cardHtml(t, i) {
  const idx = i + 1;
  const num = String(idx).padStart(2, '0');
  const eager = i < 4 ? 'eager' : 'lazy';
  const srcset = SIZES.map((w) => `img/toys/${t.slug}-${w}.webp ${w}w`).join(', ');
  return `      <article class="toy-card reveal" data-idx="${idx}">
        <div class="toy-img">
          <picture>
            <source type="image/webp" srcset="${srcset}" sizes="(max-width: 600px) 100vw, (max-width: 1024px) 50vw, 33vw">
            <img src="img/toys/${t.slug}-800.webp" data-fullsize="img/toys/${t.slug}-1200.webp" alt="${esc(toyLabel(t))}" loading="${eager}" decoding="async">
          </picture>
        </div>
        <div class="toy-meta">
          <span class="toy-num">${num}</span>
          <h3 class="toy-name">${toyName(t)}</h3>
        </div>
        <button class="toy-zoom" aria-label="Ampliar ${esc(toyLabel(t))}" data-open="${idx}">
          ${ZOOM_SVG}
        </button>
      </article>`;
}

function floatCardHtml(t, i) {
  return `      <div class="float-card float-card-${'abcd'[i]}">
        <picture>
          <source type="image/webp" srcset="img/toys/${t.slug}-400.webp">
          <img src="img/toys/${t.slug}-400.webp" alt="" loading="eager" decoding="async">
        </picture>
      </div>`;
}

function pageHtml() {
  const count = TOYS.length;
  const cards = TOYS.map(cardHtml).join('\n\n');
  const floats = TOYS.slice(0, 4).map(floatCardHtml).join('\n');
  const year = EVENT_DATE_ISO.slice(0, 4);

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#E31837">
<meta name="color-scheme" content="light">

<!-- Base fixa: garante que CSS/JS/imagens (caminhos relativos) funcionem tanto
     no link curto /p/disponiveis-20-06-2026 quanto na pasta direta. -->
<base href="/propostas/disponiveis-20-06-2026/">

<title>Brinquedos disponíveis · ${EVENT_DATE_SHORT} · Aero Festas</title>
<meta name="description" content="Brinquedos disponíveis para ${EVENT_DATE_BR}. Toque nas fotos para ampliar. Segurança, monitoria treinada e diversão garantida.">

<link rel="icon" href="../../icons/Logo_Aero_Festas.png" type="image/png">
<link rel="apple-touch-icon" href="../../icons/Logo_Aero_Festas.png">

<meta property="og:type" content="website">
<meta property="og:title" content="Brinquedos disponíveis · ${EVENT_DATE_SHORT} · Aero Festas">
<meta property="og:description" content="Confira os brinquedos disponíveis para ${EVENT_DATE_BR}.">
<meta property="og:locale" content="pt_BR">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700;800;900&display=swap">
<link rel="stylesheet" href="styles.css?v=1">

<style>
  /* Bloco de disponibilidade (mesmo estilo do "Sobre o evento" das propostas) */
  .event-info { padding: 56px 0 10px; }
  .event-info .container { max-width: 900px; margin: 0 auto; }
  .event-info-card {
    background: rgba(255,255,255,0.7);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
    backdrop-filter: blur(16px) saturate(160%);
    border: 1px solid rgba(255,255,255,0.5);
    border-radius: 22px;
    padding: 30px 32px;
    box-shadow: var(--shadow-md);
    display: flex; align-items: center; gap: 22px; flex-wrap: wrap;
  }
  .event-info-date {
    flex: 0 0 auto;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    width: 92px; height: 92px; border-radius: 20px;
    background: linear-gradient(135deg, var(--red), var(--red-soft));
    color: #fff; box-shadow: var(--shadow-red);
  }
  .event-info-date .d { font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 34px; line-height: 1; }
  .event-info-date .m { font-size: 12px; text-transform: uppercase; letter-spacing: .12em; margin-top: 4px; font-weight: 600; }
  .event-info-text h2 {
    font-family: 'Outfit', sans-serif; font-weight: 700;
    font-size: clamp(19px, 3vw, 26px); margin: 0 0 4px; color: var(--text);
  }
  .event-info-text p { color: var(--text-2); margin: 0; }
  .event-info-note {
    display: inline-flex; align-items: center; gap: 7px;
    margin-top: 12px !important;
    padding: 6px 13px; border-radius: 999px;
    background: rgba(227,24,55,0.08);
    color: var(--red-deep) !important;
    font-size: 12.5px; font-weight: 600; letter-spacing: .01em;
  }
  .event-info-note svg { flex: 0 0 auto; }
</style>
</head>

<body>

<!-- Scroll-progress bar -->
<div class="scroll-progress" aria-hidden="true"></div>

<!-- Top floating brand pill -->
<header class="top-pill" aria-label="Aero Festas · Disponíveis ${EVENT_DATE_SHORT}">
  <span class="pill-dot" aria-hidden="true"></span>
  <span class="pill-text">Aero Festas <span class="pill-sep">·</span> <strong>${EVENT_DATE_SHORT}</strong></span>
</header>

<!-- ============== HERO ============== -->
<section class="hero" id="topo">
  <div class="hero-bg" aria-hidden="true">
    <div class="hero-blob blob-a"></div>
    <div class="hero-blob blob-b"></div>
    <div class="hero-pattern"></div>
  </div>

  <div class="hero-inner">
    <p class="eyebrow">
      <span class="eyebrow-dot"></span>
      Disponibilidade · ${EVENT_DATE_BR}
    </p>

    <h1 class="hero-title">
      Brinquedos disponíveis<br>
      para <span class="title-shimmer">${EVENT_DATE_SHORT}</span>
    </h1>

    <p class="hero-sub">
      Selecionamos os <strong>${count} brinquedos disponíveis</strong> para o seu evento —
      com segurança, monitoria treinada e o cuidado que a sua festa merece.
      Toque em cada foto para ampliar.
    </p>

    <div class="hero-ctas">
      <a class="btn btn-primary btn-magnetic" href="${WA_URL}" target="_blank" rel="noopener">
        ${WA_SVG}
        Conversar pelo WhatsApp
      </a>
      <a class="btn btn-ghost" href="#brinquedos">
        Ver os ${count} brinquedos
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m-6-6 6 6 6-6"/>
        </svg>
      </a>
    </div>

    <!-- Decorative floating cards -->
    <div class="hero-cards" aria-hidden="true">
${floats}
    </div>

    <a class="scroll-cue" href="#destaques" aria-label="Rolar para baixo">
      <span></span>
    </a>
  </div>
</section>

<!-- Junina divider -->
<div class="junina-divider" aria-hidden="true">
  <svg viewBox="0 0 600 24" preserveAspectRatio="none">
    <path d="M0 4 Q 30 18 60 4 T 120 4 T 180 4 T 240 4 T 300 4 T 360 4 T 420 4 T 480 4 T 540 4 T 600 4" fill="none" stroke="currentColor" stroke-width="1" opacity=".25"/>
    <g fill="currentColor">
      <polygon points="60,4 56,12 64,12"/>
      <polygon points="180,4 176,12 184,12" opacity=".7"/>
      <polygon points="300,4 296,12 304,12"/>
      <polygon points="420,4 416,12 424,12" opacity=".7"/>
      <polygon points="540,4 536,12 544,12"/>
    </g>
  </svg>
</div>

<!-- ============== STATS ============== -->
<section class="stats reveal-group" aria-label="Resumo">
  <div class="container">
    <div class="stat-card reveal">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M21 11h-2.07a7 7 0 0 0-1.43-3.27l1.46-1.46-1.41-1.41-1.46 1.46A7 7 0 0 0 13 5.07V3h-2v2.07a7 7 0 0 0-3.27 1.43L6.27 5.04 4.86 6.45l1.46 1.46A7 7 0 0 0 5.07 11H3v2h2.07a7 7 0 0 0 1.43 3.27l-1.46 1.46 1.41 1.41 1.46-1.46A7 7 0 0 0 11 18.93V21h2v-2.07a7 7 0 0 0 3.27-1.43l1.46 1.46 1.41-1.41-1.46-1.46A7 7 0 0 0 18.93 13H21v-2zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/></svg>
      </div>
      <div class="stat-num" data-counter="${count}">0</div>
      <div class="stat-label">Brinquedos disponíveis</div>
    </div>
    <div class="stat-card reveal">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 13c-2.7-1-4.7-3.7-5-6.6.5-1.5 3-2.4 5-2.4s4.5.9 5 2.4c-.3 2.9-2.3 5.6-5 6.6z"/></svg>
      </div>
      <div class="stat-num">100%</div>
      <div class="stat-label">Monitoria treinada</div>
    </div>
    <div class="stat-card reveal">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/></svg>
      </div>
      <div class="stat-num">${EVENT_DATE_SHORT.slice(0, 5)}</div>
      <div class="stat-label">Data do evento</div>
    </div>
  </div>
</section>

<!-- ============== DISPONIBILIDADE ============== -->
<section class="event-info reveal-group">
  <div class="container">
    <div class="event-info-card reveal">
      <div class="event-info-date" aria-hidden="true">
        <span class="d">${EVENT_DATE_SHORT.slice(0, 2)}</span>
        <span class="m">Jun</span>
      </div>
      <div class="event-info-text">
        <h2>Disponíveis para ${EVENT_DATE_BR}</h2>
        <p>Os ${count} brinquedos abaixo estão disponíveis para reserva nesta data. Toque em qualquer foto para ver em tela cheia.</p>
        <p class="event-info-note">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          Página gerada em ${GENERATED_DATE_BR} · verificar disponibilidade
        </p>
      </div>
    </div>
  </div>
</section>

<!-- Section anchor for hero scroll cue -->
<div id="destaques"></div>

<!-- ============== BRINQUEDOS ============== -->
<section class="toys" id="brinquedos">
  <div class="container">
    <header class="section-head reveal">
      <p class="section-eyebrow">A Coleção</p>
      <h2 class="section-title">Brinquedos disponíveis para ${EVENT_DATE_SHORT}</h2>
      <p class="section-sub">Toque em cada brinquedo para ver em tela cheia. Use o swipe ou as setas para navegar.</p>
    </header>

    <div class="toy-grid reveal-group" id="toyGrid">

${cards}

    </div>
  </div>
</section>

<!-- ============== POR QUE A AERO ============== -->
<section class="why">
  <div class="container">
    <header class="section-head reveal">
      <p class="section-eyebrow">Tranquilidade</p>
      <h2 class="section-title">Por que escolher a Aero Festas</h2>
    </header>

    <div class="why-grid reveal-group">
      <div class="why-card reveal">
        <div class="why-icon">
          <svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M12 1 3 5v6c0 5 3.8 9.7 9 11 5.2-1.3 9-6 9-11V5l-9-4zm-2 16-4-4 1.4-1.4L10 14.2l6.6-6.6L18 9l-8 8z"/></svg>
        </div>
        <h3>Equipamentos certificados</h3>
        <p>Todos os brinquedos com manutenção em dia, ancoragem adequada e laudos atualizados.</p>
      </div>

      <div class="why-card reveal">
        <div class="why-icon">
          <svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.7 0-8 1.3-8 4v3h16v-3c0-2.7-5.3-4-8-4zm8 0c-.3 0-.7 0-1.1.1A4.6 4.6 0 0 1 18 17v3h6v-3c0-2.7-5.3-4-8-4z"/></svg>
        </div>
        <h3>Monitoria treinada</h3>
        <p>Equipe dedicada operando cada brinquedo, com foco total na segurança das crianças.</p>
      </div>

      <div class="why-card reveal">
        <div class="why-icon">
          <svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M12 2 1 21h22L12 2zm0 4 7.5 13h-15L12 6zm-1 4v4h2v-4h-2zm0 6v2h2v-2h-2z"/></svg>
        </div>
        <h3>Logística sem dor de cabeça</h3>
        <p>Montagem profissional antes do evento e desmontagem ao fim — você só vê a festa pronta.</p>
      </div>

      <div class="why-card reveal">
        <div class="why-icon">
          <svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>
        </div>
        <h3>Atendimento próximo</h3>
        <p>Conversa direta no WhatsApp, ajustes rápidos e total flexibilidade para alinhar a sua festa.</p>
      </div>
    </div>
  </div>
</section>

<!-- Junina divider -->
<div class="junina-divider" aria-hidden="true">
  <svg viewBox="0 0 600 24" preserveAspectRatio="none">
    <path d="M0 4 Q 30 18 60 4 T 120 4 T 180 4 T 240 4 T 300 4 T 360 4 T 420 4 T 480 4 T 540 4 T 600 4" fill="none" stroke="currentColor" stroke-width="1" opacity=".25"/>
    <g fill="currentColor">
      <polygon points="60,4 56,12 64,12"/>
      <polygon points="180,4 176,12 184,12" opacity=".7"/>
      <polygon points="300,4 296,12 304,12"/>
      <polygon points="420,4 416,12 424,12" opacity=".7"/>
      <polygon points="540,4 536,12 544,12"/>
    </g>
  </svg>
</div>

<!-- ============== COMO FUNCIONA ============== -->
<section class="how">
  <div class="container">
    <header class="section-head reveal">
      <p class="section-eyebrow">Simples assim</p>
      <h2 class="section-title">Como funciona</h2>
    </header>

    <ol class="timeline reveal-group">
      <li class="step reveal">
        <div class="step-num">1</div>
        <div class="step-body">
          <h3>Escolha os brinquedos</h3>
          <p>Você seleciona os brinquedos disponíveis para ${EVENT_DATE_SHORT}. Em seguida, formalizamos tudo.</p>
        </div>
      </li>
      <li class="step reveal">
        <div class="step-num">2</div>
        <div class="step-body">
          <h3>Sinal de reserva</h3>
          <p>Pequeno sinal garante a data exclusiva no calendário — saldo no dia do evento.</p>
        </div>
      </li>
      <li class="step reveal">
        <div class="step-num">3</div>
        <div class="step-body">
          <h3>Logística & montagem</h3>
          <p>Nossa equipe chega antes do horário combinado e monta tudo com calma e segurança.</p>
        </div>
      </li>
      <li class="step reveal">
        <div class="step-num">4</div>
        <div class="step-body">
          <h3>Festa</h3>
          <p>Crianças felizes, monitores atentos, e você curtindo o resultado sem se preocupar com nada.</p>
        </div>
      </li>
    </ol>
  </div>
</section>

<!-- ============== CTA FINAL ============== -->
<section class="cta-final">
  <div class="container">
    <div class="cta-card reveal">
      <p class="cta-eyebrow">Vamos conversar?</p>
      <h2 class="cta-title">Garanta sua data: ${EVENT_DATE_SHORT}</h2>
      <p class="cta-sub">Estamos à disposição para finalizar os detalhes e reservar os brinquedos para o seu evento.</p>

      <div class="cta-actions">
        <a class="btn btn-primary btn-magnetic btn-lg" href="${WA_URL}" target="_blank" rel="noopener">
          ${WA_SVG}
          Conversar pelo WhatsApp
        </a>

        <div class="cta-secondary">
          <a href="tel:+${WHATSAPP_NUMBER}" class="link-pill">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20 15.5c-1.2 0-2.4-.2-3.6-.6-.3-.1-.7 0-1 .2l-2.2 2.2a15.5 15.5 0 0 1-6.6-6.6l2.2-2.2c.3-.3.4-.7.2-1A11.4 11.4 0 0 1 8.5 4c0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1A17 17 0 0 0 20 21c.6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z"/></svg>
            (62) 98554-5046
          </a>
          <a href="mailto:aerofestaseventos@gmail.com" class="link-pill">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>
            aerofestaseventos@gmail.com
          </a>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ============== FOOTER ============== -->
<footer class="site-footer">
  <div class="container">
    <img class="footer-logo" src="../../icons/Logo_Aero_Festas.png" alt="Aero Festas" width="56" height="56">
    <p class="footer-line">Aero Festas · Parceira oficial do seu evento</p>
    <p class="footer-meta">© <span id="year">${year}</span> Aero Festas Eventos. Todos os direitos reservados.</p>
  </div>
</footer>

<!-- ============== STICKY MOBILE CTA ============== -->
<a class="sticky-mobile-cta" href="${WA_URL}" target="_blank" rel="noopener" aria-label="Conversar pelo WhatsApp">
  ${WA_SVG}
  <span>Conversar agora</span>
</a>

<!-- ============== LIGHTBOX ============== -->
<dialog class="lightbox" id="lightbox" aria-label="Galeria de brinquedos">
  <button class="lb-close" aria-label="Fechar">
    <svg viewBox="0 0 24 24" width="22" height="22"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/></svg>
  </button>

  <button class="lb-nav lb-prev" aria-label="Anterior">
    <svg viewBox="0 0 24 24" width="22" height="22"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6"/></svg>
  </button>

  <div class="lb-stage">
    <div class="lb-track" id="lbTrack"></div>
  </div>

  <button class="lb-nav lb-next" aria-label="Próximo">
    <svg viewBox="0 0 24 24" width="22" height="22"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6"/></svg>
  </button>

  <div class="lb-meta">
    <span class="lb-counter" id="lbCounter">1 / ${count}</span>
    <span class="lb-title" id="lbTitle"></span>
  </div>
</dialog>

<script src="app.js?v=1"></script>
</body>
</html>
`;
}

/* ===== EXECUÇÃO ===== */
(async () => {
  fs.mkdirSync(OUT_IMG, { recursive: true });

  // 0. Remove órfãos (webp de versões anteriores da lista) e mantém os atuais p/ reaproveitar
  const wanted = new Set(TOYS.flatMap((t) => SIZES.map((w) => `${t.slug}-${w}.webp`)));
  for (const f of fs.readdirSync(OUT_IMG)) {
    if (f.endsWith('.webp') && !wanted.has(f)) { fs.unlinkSync(path.join(OUT_IMG, f)); }
  }

  // 1. Gera imagens (otimiza do original OU copia webp já pronto de outra proposta)
  let totalIn = 0, totalOut = 0, ok = 0;
  const faltando = [];
  for (const t of TOYS) {
    // Pula se já gerado (reprocessa rápido ao mudar só a lista/HTML).
    const allExist = SIZES.every((w) => fs.existsSync(path.join(OUT_IMG, `${t.slug}-${w}.webp`)));
    if (allExist) { ok++; console.log(`  ${t.slug} -> (já existe, pulado)`); continue; }

    // Caso A: copiar webp já otimizado de outra proposta
    if (t.copyFrom) {
      let okCopy = true;
      for (const w of SIZES) {
        const from = path.join(ROOT, 'propostas', t.copyFrom, 'img', 'toys', `${t.in}-${w}.webp`);
        if (!fs.existsSync(from)) { okCopy = false; break; }
        fs.copyFileSync(from, path.join(OUT_IMG, `${t.slug}-${w}.webp`));
      }
      if (okCopy) { ok++; console.log(`  ${t.slug} -> (copiado de ${t.copyFrom})`); }
      else { faltando.push(t.slug); console.log(`  ${t.slug} -> FONTE webp não encontrada em ${t.copyFrom}`); }
      continue;
    }

    // Caso B: otimizar do original
    const inPath = path.join(SRC, t.in);
    if (!fs.existsSync(inPath)) { faltando.push(t.slug); console.log(`  ${t.slug} -> ORIGINAL não encontrado: ${t.in}`); continue; }

    totalIn += fs.statSync(inPath).size;
    process.stdout.write(`  ${t.slug} -> `);
    const parts = [];
    for (const w of SIZES) {
      const outPath = path.join(OUT_IMG, `${t.slug}-${w}.webp`);
      await sharp(inPath)
        .resize({ width: w, withoutEnlargement: true, fit: 'inside' })
        .webp({ quality: 82, effort: 5 })
        .toFile(outPath);
      const sz = fs.statSync(outPath).size;
      totalOut += sz;
      parts.push(`${w}w:${(sz / 1024).toFixed(0)}KB`);
    }
    ok++;
    console.log(parts.join(' | '));
  }

  // 2. Copia assets compartilhados (página autossuficiente)
  fs.copyFileSync(path.join(SHARED, 'styles.css'), path.join(__dirname, 'styles.css'));
  fs.copyFileSync(path.join(SHARED, 'app.js'), path.join(__dirname, 'app.js'));

  // 3. Gera index.html
  fs.writeFileSync(path.join(__dirname, 'index.html'), pageHtml(), 'utf8');

  console.log(`\n${ok}/${TOYS.length} brinquedos · ${(totalIn / 1024 / 1024).toFixed(1)}MB -> ${(totalOut / 1024 / 1024).toFixed(2)}MB`);
  if (faltando.length) console.log(`ATENÇÃO — sem imagem: ${faltando.join(', ')}`);
  console.log('index.html, styles.css e app.js gerados em propostas/disponiveis-20-06-2026/');
})().catch((err) => { console.error(err); process.exit(1); });

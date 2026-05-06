/**
 * Generates a 1200x630 Open Graph cover image
 * showcasing 4 brinquedos + title.
 * Output: /propostas/maple-bear/img/og-cover.jpg
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const W = 1200, H = 630;
const OUT = path.resolve(__dirname, 'img', 'og-cover.jpg');
const TOY_DIR = path.resolve(__dirname, 'img', 'toys');

const featured = [
  '01-touro-mecanico-800.webp',
  '04-multipark-castelo-medieval-800.webp',
  '02-toboga-toboshark-800.webp',
  '05-multiplay-jardim-encantado-800.webp',
];

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0F1B2D"/>
      <stop offset="100%" stop-color="#1B2A44"/>
    </linearGradient>
    <radialGradient id="glow" cx="20%" cy="0%" r="50%">
      <stop offset="0%" stop-color="#E31837" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#E31837" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="100%" cy="100%" r="60%">
      <stop offset="0%" stop-color="#FF6B7D" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#FF6B7D" stop-opacity="0"/>
    </radialGradient>
    <pattern id="dots" patternUnits="userSpaceOnUse" width="22" height="22">
      <circle cx="2" cy="2" r="1" fill="rgba(255,255,255,0.05)"/>
    </pattern>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect width="${W}" height="${H}" fill="url(#glow2)"/>

  <!-- Top accent bar -->
  <rect x="0" y="0" width="${W}" height="6" fill="#E31837"/>

  <!-- Eyebrow chip -->
  <g transform="translate(60, 90)">
    <rect rx="999" ry="999" width="280" height="36" fill="rgba(227,24,55,0.15)" stroke="rgba(227,24,55,0.45)" stroke-width="1"/>
    <circle cx="20" cy="18" r="4" fill="#E31837"/>
    <text x="34" y="24" font-family="Inter, sans-serif" font-size="13" font-weight="700" fill="#FF6B7D" letter-spacing="2">FESTA JUNINA · 2026</text>
  </g>

  <!-- Title -->
  <text x="60" y="220" font-family="Outfit, Arial, sans-serif" font-size="64" font-weight="800" fill="#FFFFFF" letter-spacing="-1.5">Arraiá Maple Bear BH</text>
  <text x="60" y="290" font-family="Outfit, Arial, sans-serif" font-size="44" font-weight="600" fill="rgba(255,255,255,0.7)" letter-spacing="-1">Proposta Aero Festas</text>

  <!-- 12 brinquedos pill -->
  <g transform="translate(60, 360)">
    <rect rx="999" ry="999" width="320" height="56" fill="#E31837"/>
    <text x="32" y="36" font-family="Inter, sans-serif" font-size="20" font-weight="700" fill="#FFFFFF">12 brinquedos premium</text>
    <text x="270" y="36" font-family="Inter, sans-serif" font-size="20" font-weight="700" fill="#FFFFFF">→</text>
  </g>

  <!-- Footer -->
  <text x="60" y="${H - 50}" font-family="Inter, sans-serif" font-size="16" font-weight="500" fill="rgba(255,255,255,0.5)">aerofestas.com.br · (62) 98554-5046</text>
</svg>
`;

(async () => {
  // Compose the layered image
  let img = sharp(Buffer.from(svg));

  // Add 4 brinquedo thumbnails on the right
  const composites = [];
  const positions = [
    { left: 700, top: 90,  size: 220 },
    { left: 940, top: 90,  size: 220 },
    { left: 700, top: 330, size: 220 },
    { left: 940, top: 330, size: 220 },
  ];

  for (let i = 0; i < featured.length; i++) {
    const fp = path.join(TOY_DIR, featured[i]);
    if (!fs.existsSync(fp)) continue;
    const pos = positions[i];
    const buf = await sharp(fp)
      .resize({ width: pos.size, height: pos.size, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .composite([{
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${pos.size}" height="${pos.size}"><rect width="${pos.size}" height="${pos.size}" rx="20" ry="20" fill="white" stroke="#E31837" stroke-width="3"/></svg>`),
        blend: 'dest-over'
      }])
      .png()
      .toBuffer();
    composites.push({ input: buf, left: pos.left, top: pos.top });
  }

  await img
    .composite(composites)
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(OUT);

  const sz = fs.statSync(OUT).size;
  console.log(`OG cover: ${OUT} (${(sz / 1024).toFixed(0)}KB)`);
})().catch(err => { console.error(err); process.exit(1); });

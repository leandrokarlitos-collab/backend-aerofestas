/**
 * Gera capa Open Graph 1200x630 premium para a proposta Crescer +.
 * Output: /propostas/crescer-mais/img/og-cover.jpg
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const W = 1200, H = 630;
const OUT = path.resolve(__dirname, 'img', 'og-cover.jpg');
const TOY_DIR = path.resolve(__dirname, 'img', 'toys');

const featured = [
  'alpinismo-800.webp',
  'castelo-park-800.webp',
  '10-multipark-safari-800.webp',
  'liga-justica-800.webp',
];

function bandeirinhas() {
  const colors = ['#E31837', '#F2B341', '#FFFFFF', '#E31837', '#3DA0FF'];
  const triW = 28, triH = 36;
  const spacing = 48;
  const yLine = 28;
  let out = `<line x1="0" y1="${yLine}" x2="${W}" y2="${yLine}" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>`;
  let x = 14;
  let i = 0;
  while (x + triW <= W) {
    const c = colors[i % colors.length];
    out += `<polygon points="${x},${yLine} ${x + triW},${yLine} ${x + triW / 2},${yLine + triH}" fill="${c}" opacity="0.92"/>`;
    out += `<circle cx="${x}" cy="${yLine}" r="2" fill="rgba(255,255,255,0.7)"/>`;
    x += spacing;
    i++;
  }
  return out;
}

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#0A1320"/>
      <stop offset="100%" stop-color="#1B2A44"/>
    </linearGradient>
    <radialGradient id="glowRed" cx="10%" cy="-5%" r="60%">
      <stop offset="0%"  stop-color="#E31837" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#E31837" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowGold" cx="95%" cy="115%" r="55%">
      <stop offset="0%"  stop-color="#F2B341" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#F2B341" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="redShimmer" x1="0" y1="0" x2="1" y2="0.4">
      <stop offset="0%"  stop-color="#FF8A99"/>
      <stop offset="45%" stop-color="#E31837"/>
      <stop offset="100%" stop-color="#B81026"/>
    </linearGradient>
    <pattern id="dots" patternUnits="userSpaceOnUse" width="22" height="22">
      <circle cx="2" cy="2" r="1" fill="rgba(255,255,255,0.04)"/>
    </pattern>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>
  <rect width="${W}" height="${H}" fill="url(#glowRed)"/>
  <rect width="${W}" height="${H}" fill="url(#glowGold)"/>

  <g>${bandeirinhas()}</g>

  <text x="60" y="215" font-family="Outfit, Arial, sans-serif" font-size="52" font-weight="600" fill="rgba(255,255,255,0.92)" letter-spacing="-1">Arraiá</text>
  <text x="60" y="310" font-family="Outfit, Arial, sans-serif" font-size="86" font-weight="900" fill="url(#redShimmer)" letter-spacing="-2.5">Crescer +</text>

  <text x="62" y="365" font-family="Outfit, Arial, sans-serif" font-size="24" font-weight="500" fill="rgba(255,255,255,0.65)" letter-spacing="0.4">Festa Junina · 2026 · 11 brinquedos premium</text>

  <text x="60" y="${H - 38}" font-family="Inter, sans-serif" font-size="14" font-weight="500" fill="rgba(255,255,255,0.45)" letter-spacing="0.6">Aero Festas  ·  (62) 98554-5046</text>
</svg>
`;

(async () => {
  let img = sharp(Buffer.from(svg));

  const composites = [];
  const cardSize = 200;
  const gap = 18;
  const startX = 750;
  const startY = 130;
  const positions = [
    { left: startX,                  top: startY },
    { left: startX + cardSize + gap, top: startY },
    { left: startX,                  top: startY + cardSize + gap },
    { left: startX + cardSize + gap, top: startY + cardSize + gap },
  ];

  for (let i = 0; i < featured.length; i++) {
    const fp = path.join(TOY_DIR, featured[i]);
    if (!fs.existsSync(fp)) {
      console.warn(`SKIP missing: ${featured[i]}`);
      continue;
    }
    const pos = positions[i];

    const photo = await sharp(fp)
      .resize({
        width: cardSize - 12,
        height: cardSize - 12,
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .toBuffer();

    const frame = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="${cardSize}" height="${cardSize}">
        <rect width="${cardSize}" height="${cardSize}" rx="22" ry="22" fill="#FFFFFF"/>
        <rect x="0" y="0" width="${cardSize}" height="6" rx="22" ry="22" fill="#E31837"/>
      </svg>
    `);

    const card = await sharp(frame)
      .composite([{ input: photo, top: 12, left: 6 }])
      .png()
      .toBuffer();

    composites.push({ input: card, left: pos.left, top: pos.top });
  }

  await img
    .composite(composites)
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(OUT);

  const sz = fs.statSync(OUT).size;
  console.log(`OG cover: ${OUT} (${(sz / 1024).toFixed(0)}KB)`);
})().catch(err => { console.error(err); process.exit(1); });

/**
 * One-shot image optimizer for the Maple Bear landing.
 * Converts /fotos_dos_brinquedos/* originals into 3 WebP sizes
 * (400w, 800w, 1200w) at /propostas/maple-bear/img/toys/.
 * Run with: node propostas/maple-bear/optimize-images.js
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'fotos_dos_brinquedos');
const OUT = path.resolve(__dirname, 'img', 'toys');

const map = [
  { in: 'Touro Mecânico.jpg',                slug: '01-touro-mecanico' },
  { in: 'Tobogã Toboshark.avif',             slug: '02-toboga-toboshark' },
  { in: 'High Jump - 4 estações.png',        slug: '03-high-jump-4-estacoes' },
  { in: 'Multipark Castelo Medieval.png',    slug: '04-multipark-castelo-medieval' },
  { in: 'Multiplay Jardim Encantado.png',    slug: '05-multiplay-jardim-encantado' },
  { in: 'Combo 3 em 1 - Girafa.png',         slug: '06-combo-3-em-1-girafa' },
  { in: 'Combo 3 em 1 - Super Balões.png',   slug: '07-combo-3-em-1-super-baloes' },
  { in: 'Disco Play.png',                    slug: '08-disco-play' },
  { in: 'cama dupla (2 unidades).jpg',       slug: '09-cama-dupla-2-unidades' },
  { in: 'Multipark Safari.jpg',              slug: '10-multipark-safari' },
  { in: 'Giro Radical.png',                  slug: '11-giro-radical' },
  { in: 'Futebol Inflável.png',              slug: '12-futebol-inflavel' },
];

const SIZES = [400, 800, 1200];

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  let totalIn = 0, totalOut = 0;
  for (const item of map) {
    const inPath = path.join(SRC, item.in);
    if (!fs.existsSync(inPath)) {
      console.log(`SKIP ${item.in} (not found)`);
      continue;
    }
    const inSize = fs.statSync(inPath).size;
    totalIn += inSize;
    process.stdout.write(`Processing ${item.slug} (${(inSize / 1024 / 1024).toFixed(1)}MB) -> `);
    const sizes = [];
    for (const w of SIZES) {
      const outPath = path.join(OUT, `${item.slug}-${w}.webp`);
      await sharp(inPath)
        .resize({ width: w, withoutEnlargement: true, fit: 'inside' })
        .webp({ quality: 82, effort: 5 })
        .toFile(outPath);
      const sz = fs.statSync(outPath).size;
      sizes.push(`${w}w:${(sz / 1024).toFixed(0)}KB`);
      totalOut += sz;
    }
    console.log(sizes.join(' | '));
  }
  console.log(`\nDone. ${(totalIn / 1024 / 1024).toFixed(1)}MB -> ${(totalOut / 1024 / 1024).toFixed(2)}MB (${((totalOut / totalIn) * 100).toFixed(1)}% of original)`);
})().catch((err) => { console.error(err); process.exit(1); });

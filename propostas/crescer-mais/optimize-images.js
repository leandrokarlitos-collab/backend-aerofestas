/**
 * One-shot image optimizer for the Crescer + landing.
 * Converts /fotos_dos_brinquedos/* originals into 3 WebP sizes
 * (400w, 800w, 1200w) at /propostas/crescer-mais/img/toys/.
 * Run with: node propostas/crescer-mais/optimize-images.js
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'fotos_dos_brinquedos');
const OUT = path.resolve(__dirname, 'img', 'toys');

const map = [
  { in: 'Tobogã com Bolinhas.jpg',           slug: 'toboga-bolinhas' },
  { in: 'Tobogã Inflável - Splash.jpeg',     slug: 'toboga-splash' },
  { in: 'High Jump - 1 estação.png',         slug: 'high-jump-1-estacao' },
  { in: 'Multipark Safari.jpg',              slug: '10-multipark-safari' },
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

/**
 * Otimizador de imagens para a proposta Maple Bear Uberaba.
 * Run: node propostas/maple-bear-uberaba/optimize-images.js
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'fotos_dos_brinquedos');
const OUT = path.resolve(__dirname, 'img', 'toys');

const map = [
  { in: 'Futebol_Inflável_tradicional.png', slug: 'futebol-inflavel-tradicional' },
  { in: 'Aventura na floresta.jpg',         slug: 'multiplay-aventura-floresta' },
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

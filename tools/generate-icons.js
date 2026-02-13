#!/usr/bin/env node
/**
 * Generate PWA icons from favicon.svg
 * Usage: node tools/generate-icons.js
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SVG = path.join(ROOT, 'www', 'favicon.svg');
const OUT = path.join(ROOT, 'www', 'icons');

const SIZES = [192, 512];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const svg = fs.readFileSync(SVG);

  for (const size of SIZES) {
    const outPath = path.join(OUT, `icon-${size}.png`);
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`  ${outPath}`);
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * Build script: obfuscates JS files for production deploy.
 * Copies www/ to dist/, obfuscates JS (except config.js), leaves everything else intact.
 *
 * Usage: node tools/obfuscate.js
 */

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'www');
const DIST = path.join(ROOT, 'dist');

// Files to skip obfuscation (copied as-is)
const SKIP_OBFUSCATION = new Set(['config.js', 'site.config.js']);

const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  renameGlobals: false,
  selfDefending: false,
  sourceMap: false,
  target: 'browser',
  // Preserve ES module syntax
  inputFileName: undefined,
  identifierNamesGenerator: 'hexadecimal',
};

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function obfuscateFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, {
    ...OBFUSCATOR_OPTIONS,
    inputFileName: path.basename(filePath),
  });
  fs.writeFileSync(filePath, result.getObfuscatedCode());
}

// Clean dist
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true });
}

// Copy entire www/ to dist/
console.log('Copying www/ to dist/...');
copyDirSync(SRC, DIST);

// Obfuscate JS files in dist/
const jsDir = path.join(DIST, 'js');
const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));

let obfuscated = 0;
let skipped = 0;

for (const file of jsFiles) {
  if (SKIP_OBFUSCATION.has(file)) {
    console.log(`  skip: js/${file}`);
    skipped++;
    continue;
  }
  console.log(`  obfuscate: js/${file}`);
  obfuscateFile(path.join(jsDir, file));
  obfuscated++;
}

// Also obfuscate main.js in dist root
const mainJs = path.join(DIST, 'main.js');
if (fs.existsSync(mainJs)) {
  console.log('  obfuscate: main.js');
  obfuscateFile(mainJs);
  obfuscated++;
}

// Note: sw.js lives at dist root and is not in dist/js/, so it is never obfuscated.
// Service workers must remain readable for browser registration to work correctly.

console.log(`\nDone. ${obfuscated} files obfuscated, ${skipped} skipped.`);
console.log(`Output: ${DIST}/`);

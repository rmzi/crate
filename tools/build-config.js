#!/usr/bin/env node
/**
 * Build config: parses site.md (YAML frontmatter + markdown body) and generates:
 *   - dist/js/site.config.js  (ES module with SITE export)
 *   - Injects rendered markdown into dist/index.html info modal
 *
 * Falls back to www/js/site.config.js if site.md doesn't exist.
 *
 * Usage: node tools/build-config.js
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const ROOT = path.resolve(__dirname, '..');
const SITE_MD = path.join(ROOT, 'site.md');
const DIST = path.join(ROOT, 'dist');

// If no site.md, nothing to do — site.config.js was already copied by obfuscate.js
if (!fs.existsSync(SITE_MD)) {
  console.log('No site.md found, using www/js/site.config.js as-is.');
  process.exit(0);
}

const raw = fs.readFileSync(SITE_MD, 'utf8');
const { data: frontmatter, content: markdownBody } = matter(raw);

// --- Generate site.config.js ---
const siteObj = {
  name: frontmatter.name || 'Crate',
  url: frontmatter.url || '',
  password: frontmatter.password || null,
  gaTrackingId: frontmatter.ga_tracking_id || null,
  theme: {
    accent: frontmatter.theme?.accent || '#ff0000',
    font: frontmatter.theme?.font || "'Special Elite', cursive",
    titleFont: frontmatter.theme?.title_font || "'Anton', Impact, sans-serif",
    searchFont: frontmatter.theme?.search_font || "'Bebas Neue', sans-serif",
  }
};

// Include effects config if present
if (frontmatter.effects) {
  siteObj.effects = frontmatter.effects;
}

// Include mixes config if present
if (frontmatter.mixes) {
  siteObj.mixes = frontmatter.mixes;
}

// Include deploy config if present
if (frontmatter.deploy) {
  siteObj.deploy = frontmatter.deploy;
}

const siteConfigJs = `/**
 * Site configuration — generated from site.md by build-config.js
 * Do not edit directly; edit site.md instead.
 * @module site.config
 */

export const SITE = ${JSON.stringify(siteObj, null, 2)};
`;

const siteConfigPath = path.join(DIST, 'js', 'site.config.js');
fs.writeFileSync(siteConfigPath, siteConfigJs);
console.log('Generated dist/js/site.config.js from site.md frontmatter');

// --- Render markdown and inject into index.html ---
const htmlContent = marked(markdownBody.trim());

// Build the info modal body content
let modalInner = '';

// Add reset button after the markdown content
modalInner += htmlContent;
modalInner += '\n<p><button id="full-reset-btn" class="modal-reset-btn">RESET ALL DATA</button></p>';

// Generate mixes HTML if present
if (frontmatter.mixes && frontmatter.mixes.length > 0) {
  const mixTitle = frontmatter.mixes_title || 'Mixes';
  modalInner += `\n<div class="modal-mixes">`;
  modalInner += `\n  <h4 class="stout-junts-title">${mixTitle}</h4>`;
  modalInner += `\n  <div class="stout-junts-grid">`;
  for (const mix of frontmatter.mixes) {
    modalInner += `\n    <div class="stout-junt">`;
    if (mix.url) {
      modalInner += `\n      <a href="${mix.url}" target="_blank" rel="noopener" class="sj-vol">${mix.title}</a>`;
    } else {
      modalInner += `\n      <span class="sj-vol">${mix.title}</span>`;
    }
    if (mix.image) {
      const dataImages = [mix.image, mix.back_image].filter(Boolean).join(',');
      modalInner += `\n      <img src="/${mix.image}" alt="${mix.title}" class="sj-thumb" data-images="/${dataImages.split(',').join(',/')}">`;
    }
    if (mix.collab) {
      modalInner += `\n      <span class="sj-collab"><strong>w/ ${mix.collab}</strong></span>`;
    }
    modalInner += `\n    </div>`;
  }
  modalInner += `\n  </div>`;
  modalInner += `\n</div>`;
}

// Generate links HTML if present
if (frontmatter.links && frontmatter.links.length > 0) {
  modalInner += `\n<div class="modal-links">`;
  for (const link of frontmatter.links) {
    modalInner += `\n  <a href="${link.url}" target="_blank" rel="noopener" class="icon-link" aria-label="${link.label}">`;
    modalInner += `\n    ${link.svg}`;
    modalInner += `\n  </a>`;
  }
  modalInner += `\n</div>`;
}

// Inject into dist/index.html
const indexPath = path.join(DIST, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');

// Replace the placeholder in the info modal
const placeholder = '<!-- SITE_MD_CONTENT -->';
if (indexHtml.includes(placeholder)) {
  indexHtml = indexHtml.replace(placeholder, modalInner);
  console.log('Injected site.md content into dist/index.html info modal');
} else {
  console.warn('Warning: <!-- SITE_MD_CONTENT --> placeholder not found in index.html');
}

// Replace site name in title tag
indexHtml = indexHtml.replace(/<title>[^<]*<\/title>/, `<title>${siteObj.name}</title>`);

// Replace site name in title-logo
indexHtml = indexHtml.replace(
  /(<h1[^>]*class="title-logo"[^>]*>)[^<]*/,
  `$1${siteObj.name}`
);

// Replace site name in player-title
indexHtml = indexHtml.replace(
  /(<h1[^>]*class="player-title"[^>]*>)[^<]*/,
  `$1${siteObj.name}`
);

fs.writeFileSync(indexPath, indexHtml);
console.log('Updated dist/index.html with site name and content');

/**
 * Site configuration — edit this file to customize your crate.
 * This is the only file you need to change for basic setup.
 * @module site.config
 */

export const SITE = {
  // Required
  name: 'Crate',                // Site name (shown in title, share text, PWA)
  url: 'https://example.com',   // Production URL for media paths

  // Auth
  password: null,                // Voice recognition passphrase (null to disable)

  // Analytics
  gaTrackingId: null,            // Google Analytics 4 tracking ID (null to disable)

  // Theme (CSS custom properties are in main.css :root)
  theme: {
    accent: '#ff0000',
    font: "'Special Elite', cursive",
    titleFont: "'Anton', Impact, sans-serif",
    searchFont: "'Bebas Neue', sans-serif",
  }
};

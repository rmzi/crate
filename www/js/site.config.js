/**
 * Site configuration — edit this file to customize your crate.
 * This is the only file you need to change for basic setup.
 * @module site.config
 */

export const SITE = {
  // Required
  name: 'Crate',                // Site name (shown in title, share text, PWA)
  url: 'https://crate.rmzi.world',

  // Auth
  password: null,

  // Analytics
  gaTrackingId: null,

  // Theme (CSS custom properties are in main.css :root)
  theme: {
    accent: '#ff0000',
    font: "'Special Elite', cursive",
    titleFont: "'Anton', Impact, sans-serif",
    searchFont: "'Bebas Neue', sans-serif",
  }
};

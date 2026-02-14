/**
 * Crate Music Player
 * Self-hosted streaming PWA with signed cookie authentication
 *
 * @module main
 */

import { init } from './js/events.js';

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/**
 * Version check and cache busting
 * @module version
 */

import { APP_VERSION } from './config.js';

/**
 * Check version against server and reload if stale
 */
export async function checkVersion() {
  try {
    const response = await fetch(`/version.txt?_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const serverVersion = (await response.text()).trim();
    if (serverVersion !== APP_VERSION) {
      // Preserve hash for deep links
      const hash = window.location.hash;
      window.location.href = window.location.pathname + '?_=' + Date.now() + hash;
    }
  } catch (e) {
    console.warn('Version check failed:', e);
  }
}

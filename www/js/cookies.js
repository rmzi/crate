/**
 * Cookie management for CloudFront authentication
 * @module cookies
 */

import { CONFIG, SIGNED_COOKIES } from './config.js';

/**
 * Check if we have CloudFront cookies
 * @returns {boolean}
 */
export function hasValidCookies() {
  return CONFIG.COOKIE_NAMES.every(name =>
    document.cookie.split(';').some(c => c.trim().startsWith(name + '='))
  );
}

/**
 * Set CloudFront signed cookies
 * @returns {boolean} Success status
 */
export function setSignedCookies() {
  if (!SIGNED_COOKIES) {
    console.error('Signed cookies not configured');
    return false;
  }
  try {
    for (const [name, value] of Object.entries(SIGNED_COOKIES)) {
      document.cookie = `${name}=${value}; path=/; secure; samesite=strict; max-age=${60 * 60 * 24 * 365}`;
    }
    return true;
  } catch (e) {
    console.error('Failed to set cookies:', e);
    return false;
  }
}

/**
 * Clear all CloudFront cookies
 */
export function clearAllCookies() {
  CONFIG.COOKIE_NAMES.forEach(name => {
    document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; secure; samesite=strict`;
  });
  console.log('Cookies cleared');
}

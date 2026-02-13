/**
 * Utility functions
 * @module utils
 */

/**
 * Format seconds as MM:SS
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
export function formatTime(seconds) {
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Seeded random for better variety (uses current time as entropy)
 * @param {number} max - Maximum value (exclusive)
 * @returns {number} Random integer from 0 to max-1
 */
export function seededRandom(max) {
  // Combine multiple entropy sources for better randomization
  const timeSeed = Date.now();
  const microTime = performance.now();
  const combined = (timeSeed * 1000 + microTime) % 2147483647;
  // Use a simple hash mixing function
  const hash = ((combined * 1103515245 + 12345) >>> 0) % 2147483647;
  return (hash + Math.floor(Math.random() * 1000000)) % max;
}

/**
 * Get media URL
 * @param {string} path - Relative path to media file
 * @returns {string} Full URL
 */
export function getMediaUrl(path) {
  if (!path) return '';
  return '/' + path;
}

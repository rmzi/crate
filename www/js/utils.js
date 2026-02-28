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

/**
 * Generate a deterministic gradient from a track ID
 * @param {string} trackId - Track ID to generate gradient from
 * @returns {string} CSS gradient string
 */
export function generateTrackGradient(trackId) {
  if (!trackId) return 'linear-gradient(135deg, hsl(0, 0%, 20%), hsl(0, 0%, 15%))';

  // Hash the track ID to get deterministic values
  let hash = 0;
  for (let i = 0; i < trackId.length; i++) {
    hash = ((hash << 5) - hash) + trackId.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Use the hash to generate gradient parameters
  const absHash = Math.abs(hash);

  // Generate 2-3 colors
  const colorCount = 2 + (absHash % 2);
  const colors = [];

  for (let i = 0; i < colorCount; i++) {
    // Use different parts of the hash for each color
    const offset = i * 100;
    const hue = (absHash + offset) % 360;
    // Muted saturation (30-60%) and dark lightness (15-35%)
    const saturation = 30 + ((absHash + offset * 2) % 31);
    const lightness = 15 + ((absHash + offset * 3) % 21);
    colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
  }

  // Vary the angle based on the hash
  const angle = 45 + ((absHash % 8) * 45); // 45, 90, 135, 180, 225, 270, 315, 360

  return `linear-gradient(${angle}deg, ${colors.join(', ')})`;
}

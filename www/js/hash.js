/**
 * URL hash helpers for deep linking
 * @module hash
 */

/**
 * Encode track path to URL-safe base64 hash
 * @param {Object} track - Track object with path property
 * @returns {string|null} Encoded hash or null on error
 */
export function encodeTrackHash(track) {
  try {
    return btoa(track.path).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch (e) {
    return null;
  }
}

/**
 * Decode URL hash to track path
 * @param {string} hash - URL hash (without #)
 * @returns {string|null} Decoded path or null on error
 */
export function decodeTrackHash(hash) {
  try {
    // Restore base64 padding and chars
    let b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return atob(b64);
  } catch (e) {
    return null;
  }
}

/**
 * Get track path from current URL hash
 * @returns {string|null} Track path or null if no hash
 */
export function getTrackPathFromHash() {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#')) {
    return decodeTrackHash(hash.substring(1));
  }
  return null;
}

/**
 * Set track in URL hash
 * @param {Object} track - Track object with path property
 */
export function setTrackInHash(track) {
  if (track) {
    const encoded = encodeTrackHash(track);
    if (encoded) {
      history.replaceState(
        { screen: 'player-screen', trackPath: track.path },
        '',
        '#' + encoded
      );
    }
  }
}

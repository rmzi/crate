/**
 * PWA client-side bridge
 * Registers service worker, tracks cached audio, monitors online/offline state
 * @module pwa
 */

import { state } from './state.js';
import { getMediaUrl } from './utils.js';

/** Set of cached audio paths (e.g. '/audio/foo.mp3') */
export const cachedTracks = new Set();

/** Network state observable */
export const networkState = { offline: false };

let offlineChangeCallback = null;

/**
 * Register callback for offline state changes
 * @param {Function} fn - Called with (offline: boolean)
 */
export function setOfflineChangeCallback(fn) {
  offlineChangeCallback = fn;
}

/**
 * Check if a track's audio is cached
 * @param {Object} track - Track object with .path
 * @returns {boolean}
 */
export function isTrackCached(track) {
  if (!track || !track.path) return false;
  return cachedTracks.has(getMediaUrl(track.path));
}

/**
 * Populate cachedTracks from the audio cache
 */
async function populateCachedTracks() {
  try {
    const cache = await caches.open('audio-v1');
    const keys = await cache.keys();
    cachedTracks.clear();
    for (const req of keys) {
      cachedTracks.add(new URL(req.url).pathname);
    }
  } catch (e) {
    // Cache API not available
  }
}

/**
 * Handle messages from service worker
 */
function handleSWMessage(event) {
  const { data } = event;
  if (!data || !data.type) return;

  if (data.type === 'CACHE_UPDATED') {
    const path = new URL(data.url).pathname;
    cachedTracks.add(path);
  } else if (data.type === 'CACHE_EVICTED') {
    const path = new URL(data.url).pathname;
    cachedTracks.delete(path);
  } else if (data.type === 'GET_FAVORITES') {
    // Respond with favorite track audio paths
    const paths = [];
    if (state.favoriteTracks && state.tracks) {
      for (const track of state.tracks) {
        if (state.favoriteTracks.has(track.id) && track.path) {
          paths.push(getMediaUrl(track.path));
        }
      }
    }
    event.ports[0].postMessage({ paths });
  }
}

/**
 * Update offline state and notify
 */
function updateOnlineStatus() {
  const wasOffline = networkState.offline;
  networkState.offline = !navigator.onLine;
  if (wasOffline !== networkState.offline && offlineChangeCallback) {
    offlineChangeCallback(networkState.offline);
  }
}

/**
 * Initialize PWA: register SW, populate cache set, setup listeners
 */
export async function initPWA() {
  // Set initial network state
  networkState.offline = !navigator.onLine;

  // Online/offline listeners
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  if (!('serviceWorker' in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    console.log('SW registered:', reg.scope);
  } catch (e) {
    console.warn('SW registration failed:', e);
    return;
  }

  // Listen for SW messages
  navigator.serviceWorker.addEventListener('message', handleSWMessage);

  // Populate cached tracks from existing cache
  await populateCachedTracks();
}

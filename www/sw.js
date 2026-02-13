/**
 * Service Worker for Crate PWA
 * Cache strategies: shell (stale-while-revalidate), manifest (network-first),
 * artwork (cache-first), audio (cache-first + cache-on-play)
 */

const SHELL_CACHE = 'shell-v1';
const MANIFEST_CACHE = 'manifest-v1';
const ARTWORK_CACHE = 'artwork-v1';
const AUDIO_CACHE = 'audio-v1';

const CACHE_NAMES = [SHELL_CACHE, MANIFEST_CACHE, ARTWORK_CACHE, AUDIO_CACHE];

// 500MB audio cache cap
const AUDIO_CACHE_LIMIT = 500 * 1024 * 1024;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/main.css',
  '/main.js',
  '/js/analytics.js',
  '/js/audio.js',
  '/js/config.js',
  '/js/cookies.js',
  '/js/elements.js',
  '/js/events.js',
  '/js/hash.js',
  '/js/konami.js',
  '/js/player.js',
  '/js/pwa.js',
  '/js/state.js',
  '/js/storage.js',
  '/js/tracks.js',
  '/js/ui.js',
  '/js/utils.js',
  '/js/version.js',
  '/js/voice.js',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/app.webmanifest'
];

// Passthrough patterns — never cache these
function isPassthrough(url) {
  const path = new URL(url).pathname;
  if (path === '/version.txt') return true;
  // Cross-origin (GA, fonts) handled by origin check below
  return false;
}

function isShellRequest(url) {
  const u = new URL(url);
  const p = u.pathname;
  return p === '/' ||
    p.endsWith('.html') ||
    p.endsWith('.css') ||
    (p.endsWith('.js') && !p.startsWith('/audio/')) ||
    p.startsWith('/icons/') ||
    p.startsWith('/favicon');
}

function isManifestRequest(url) {
  return new URL(url).pathname === '/manifest.json';
}

function isArtworkRequest(url) {
  const p = new URL(url).pathname;
  return p.startsWith('/artwork/') || p.startsWith('/stout_junts_images/');
}

function isAudioRequest(url) {
  const p = new URL(url).pathname;
  return p.startsWith('/audio/') && p.endsWith('.mp3');
}

// ---- Install: precache shell ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ---- Activate: clean old caches ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => !CACHE_NAMES.includes(k))
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---- Fetch strategies ----
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  // Only handle same-origin GET requests
  if (request.method !== 'GET') return;
  if (new URL(url).origin !== self.location.origin) return;
  if (isPassthrough(url)) return;

  if (isManifestRequest(url)) {
    event.respondWith(networkFirst(request, MANIFEST_CACHE));
  } else if (isAudioRequest(url)) {
    event.respondWith(audioCacheFirst(request));
  } else if (isArtworkRequest(url)) {
    event.respondWith(cacheFirst(request, ARTWORK_CACHE));
  } else if (isShellRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});

// ---- Stale-while-revalidate ----
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
}

// ---- Network-first ----
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw e;
  }
}

// ---- Cache-first ----
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

// ---- Audio: cache-first + cache-on-play with FIFO eviction ----
async function audioCacheFirst(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    // Clone before caching — cache in background
    const clone = response.clone();
    event_cacheAudio(cache, request, clone);
  }
  return response;
}

async function event_cacheAudio(cache, request, response) {
  try {
    await cache.put(request, response);
    await enforceAudioCacheLimit(cache);
    notifyClients({ type: 'CACHE_UPDATED', url: request.url });
  } catch (e) {
    console.warn('SW: failed to cache audio', e);
  }
}

// ---- FIFO eviction for audio cache ----
async function enforceAudioCacheLimit(cache) {
  const keys = await cache.keys();
  if (keys.length === 0) return;

  // Get favorites from clients
  let favPaths = new Set();
  try {
    favPaths = await getFavoritePaths();
  } catch (e) {
    // If we can't get favorites, evict any
  }

  // Estimate total size
  let totalSize = 0;
  const entries = [];
  for (const req of keys) {
    const resp = await cache.match(req);
    const blob = await resp.clone().blob();
    entries.push({ request: req, size: blob.size, url: req.url });
    totalSize += blob.size;
  }

  // Evict oldest non-favorited entries until under limit
  while (totalSize > AUDIO_CACHE_LIMIT && entries.length > 0) {
    // Find first non-favorited entry (FIFO order)
    const idx = entries.findIndex(e => {
      const path = new URL(e.url).pathname;
      return !favPaths.has(path);
    });
    // If all are favorited, evict oldest anyway
    const evictIdx = idx >= 0 ? idx : 0;
    const evicted = entries.splice(evictIdx, 1)[0];
    await cache.delete(evicted.request);
    totalSize -= evicted.size;
    notifyClients({ type: 'CACHE_EVICTED', url: evicted.url });
  }
}

// ---- Communication with main thread ----
async function getFavoritePaths() {
  const clients = await self.clients.matchAll();
  if (clients.length === 0) return new Set();

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => resolve(new Set()), 1000);

    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      resolve(new Set(event.data.paths || []));
    };

    clients[0].postMessage({ type: 'GET_FAVORITES' }, [channel.port2]);
  });
}

function notifyClients(message) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => client.postMessage(message));
  });
}

// Listen for messages from main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/**
 * Offline audio cache using IndexedDB
 * @module cache
 */

// Offline cache limit (~28 tracks at ~7 MB average)
export const CACHE_LIMIT_BYTES = 200 * 1024 * 1024;

const DB_NAME = 'crate_cache';
const DB_VERSION = 1;
const AUDIO_STORE = 'audio';

let db = null;

/**
 * Open/create the IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  if (db) return Promise.resolve(db);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(AUDIO_STORE)) {
        database.createObjectStore(AUDIO_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    request.onerror = (e) => {
      reject(e.target.error);
    };
  });
}

/**
 * Get cached audio blob for a track
 * @param {string} trackId
 * @returns {Promise<Blob|null>}
 */
export async function getCachedAudio(trackId) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(AUDIO_STORE, 'readonly');
    const store = tx.objectStore(AUDIO_STORE);
    const request = store.get(trackId);
    request.onsuccess = () => {
      resolve(request.result ? request.result.blob : null);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Store audio blob in cache
 * @param {string} trackId
 * @param {Blob} blob
 * @returns {Promise<void>}
 */
export async function cacheAudio(trackId, blob) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(AUDIO_STORE, 'readwrite');
    const store = tx.objectStore(AUDIO_STORE);
    store.put({ id: trackId, blob, size: blob.size, cachedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Remove a single track from cache
 * @param {string} trackId
 * @returns {Promise<void>}
 */
export async function removeCachedAudio(trackId) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(AUDIO_STORE, 'readwrite');
    const store = tx.objectStore(AUDIO_STORE);
    store.delete(trackId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get Set of all cached track IDs
 * @returns {Promise<Set<string>>}
 */
export async function getCachedTrackIds() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(AUDIO_STORE, 'readonly');
    const store = tx.objectStore(AUDIO_STORE);
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(new Set(request.result));
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get cache statistics
 * @returns {Promise<{count: number, totalSize: number}>}
 */
export async function getCacheStats() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(AUDIO_STORE, 'readonly');
    const store = tx.objectStore(AUDIO_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const records = request.result;
      resolve({
        count: records.length,
        totalSize: records.reduce((sum, r) => sum + (r.size || 0), 0)
      });
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Check if adding a blob would exceed the cache limit
 * @param {number} blobSize - Size in bytes of the blob to add
 * @param {number} limit - Cache limit in bytes
 * @returns {Promise<{allowed: boolean, currentSize: number, count: number}>}
 */
export async function canCacheBlob(blobSize, limit) {
  const stats = await getCacheStats();
  return {
    allowed: (stats.totalSize + blobSize) <= limit,
    currentSize: stats.totalSize,
    count: stats.count
  };
}

/**
 * Clear all cached audio
 * @returns {Promise<void>}
 */
export async function clearCache() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(AUDIO_STORE, 'readwrite');
    const store = tx.objectStore(AUDIO_STORE);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Sync favorites to offline cache
 * Downloads uncached favorites sequentially, reports progress
 * @param {string[]} trackIds - IDs to cache
 * @param {Function} fetchTrackBlob - async (trackId) => Blob
 * @param {Function} onProgress - ({completed, total, currentTrackId, error}) => void
 * @param {number} [limit] - Optional cache size limit in bytes
 * @returns {Promise<{synced: number, failed: number, skipped: number}>}
 */
export async function syncFavoritesOffline(trackIds, fetchTrackBlob, onProgress, limit) {
  const cached = await getCachedTrackIds();
  const toDownload = trackIds.filter(id => !cached.has(id));
  const skipped = trackIds.length - toDownload.length;
  let synced = 0;
  let failed = 0;

  onProgress({ completed: 0, total: toDownload.length });

  for (const trackId of toDownload) {
    try {
      const blob = await fetchTrackBlob(trackId);
      // Check storage limit before caching
      if (limit) {
        const { allowed } = await canCacheBlob(blob.size, limit);
        if (!allowed) {
          onProgress({ completed: synced + failed, total: toDownload.length, error: 'Storage limit reached' });
          break;
        }
      }
      await cacheAudio(trackId, blob);
      synced++;
      onProgress({ completed: synced + failed, total: toDownload.length, currentTrackId: trackId });
    } catch (e) {
      failed++;
      console.warn('Failed to cache track:', trackId, e);
      // Stop on quota error
      if (e.name === 'QuotaExceededError') {
        onProgress({ completed: synced + failed, total: toDownload.length, error: 'Storage full' });
        break;
      }
      onProgress({ completed: synced + failed, total: toDownload.length, error: e.message });
    }
  }

  // Remove cached tracks that are no longer in favorites
  const favoriteSet = new Set(trackIds);
  const allCached = await getCachedTrackIds();
  for (const id of allCached) {
    if (!favoriteSet.has(id)) {
      await removeCachedAudio(id).catch(() => {});
    }
  }

  return { synced, failed, skipped };
}

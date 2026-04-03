/**
 * State sync — push/pull encrypted state to/from cloud
 * @module sync
 */

import { state } from './state.js';
import { CONFIG } from './config.js';
import { saveFavoriteTracks, saveHeardTracks, setSecretUnlocked, savePlayHistory, saveListenStats } from './storage.js';
import { deriveKey, encrypt, decrypt, generateWriteHash } from './crypto.js';

const SYNC_ENDPOINT = '/sync';
const SYNC_CREDS_KEY = `${CONFIG.STORAGE_KEY.replace('_heard_tracks', '')}_sync_credentials`;

let syncDebounceTimer = null;

/**
 * Save sync credentials in localStorage
 * @param {string} username
 * @param {string} password
 */
export function saveSyncCredentials(username, password) {
  try {
    localStorage.setItem(SYNC_CREDS_KEY, JSON.stringify({ username, password }));
  } catch (e) { /* ignore */ }
}

/**
 * Get stored sync credentials
 * @returns {{username: string, password: string}|null}
 */
export function getSyncCredentials() {
  try {
    const stored = localStorage.getItem(SYNC_CREDS_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * Clear sync credentials
 */
export function clearSyncCredentials() {
  try { localStorage.removeItem(SYNC_CREDS_KEY); } catch (e) { /* ignore */ }
}

/**
 * Serialize syncable state to JSON
 * @returns {string}
 */
function serializeState() {
  return JSON.stringify({
    favoriteTracks: [...state.favoriteTracks],
    heardTracks: [...state.heardTracks],
    secretUnlocked: state.secretUnlocked,
    playHistory: state.playHistory,
    historyIndex: state.historyIndex,
    totalListenSeconds: state.totalListenSeconds,
    totalUniqueHeard: state.totalUniqueHeard,
    lastPlayedAt: state.lastPlayedAt,
    syncedAt: new Date().toISOString()
  });
}

/**
 * Merge remote state into local state (union merge)
 * @param {Object} remote - Deserialized remote state
 * @returns {{favoritesAdded: number, heardAdded: number, secretChanged: boolean}}
 */
function mergeState(remote) {
  let favoritesAdded = 0;
  let heardAdded = 0;
  let secretChanged = false;

  if (Array.isArray(remote.favoriteTracks)) {
    for (const id of remote.favoriteTracks) {
      if (!state.favoriteTracks.has(id)) {
        state.favoriteTracks.add(id);
        favoritesAdded++;
      }
    }
    if (favoritesAdded > 0) saveFavoriteTracks();
  }

  if (Array.isArray(remote.heardTracks)) {
    for (const id of remote.heardTracks) {
      if (!state.heardTracks.has(id)) {
        state.heardTracks.add(id);
        heardAdded++;
      }
    }
    if (heardAdded > 0) saveHeardTracks();
  }

  if (remote.secretUnlocked && !state.secretUnlocked) {
    state.secretUnlocked = true;
    state.mode = 'secret';
    setSecretUnlocked(true);
    secretChanged = true;
  }

  if (Array.isArray(remote.playHistory) && remote.playHistory.length > state.playHistory.length) {
    state.playHistory = remote.playHistory;
    state.historyIndex = typeof remote.historyIndex === 'number' ? remote.historyIndex : remote.playHistory.length - 1;
    savePlayHistory();
  }

  // Stats: take max for counters, most recent for timestamps
  let statsChanged = false;
  if (typeof remote.totalListenSeconds === 'number' && remote.totalListenSeconds > state.totalListenSeconds) {
    state.totalListenSeconds = remote.totalListenSeconds;
    statsChanged = true;
  }
  if (typeof remote.totalUniqueHeard === 'number' && remote.totalUniqueHeard > state.totalUniqueHeard) {
    state.totalUniqueHeard = remote.totalUniqueHeard;
    statsChanged = true;
  }
  if (remote.lastPlayedAt && (!state.lastPlayedAt || remote.lastPlayedAt > state.lastPlayedAt)) {
    state.lastPlayedAt = remote.lastPlayedAt;
    statsChanged = true;
  }
  if (statsChanged) saveListenStats();

  return { favoritesAdded, heardAdded, secretChanged, statsChanged };
}

/**
 * Pull remote state and merge into local
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{status: 'merged'|'empty'|'error', details?: Object, error?: string}>}
 */
export async function pullState(username, password) {
  try {
    const response = await fetch(`${SYNC_ENDPOINT}/${encodeURIComponent(username)}`);

    if (!response.ok) {
      return { status: 'error', error: `Server error: ${response.status}` };
    }

    const data = await response.json();

    // Lambda returns 200 for everything to avoid CloudFront error page interception
    if (data.error) {
      return { status: 'error', error: data.error };
    }
    if (data.found === false) {
      return { status: 'empty' };
    }

    const key = await deriveKey(password, username);

    let plaintext;
    try {
      plaintext = await decrypt(key, data.ciphertext, data.iv);
    } catch (e) {
      return { status: 'error', error: 'Wrong password' };
    }

    const remote = JSON.parse(plaintext);
    const details = mergeState(remote);
    return { status: 'merged', details };
  } catch (e) {
    console.error('Pull failed:', e);
    return { status: 'error', error: e.message };
  }
}

/**
 * Push local state to server (full replace)
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{status: 'ok'|'error', error?: string}>}
 */
export async function pushState(username, password) {
  try {
    const key = await deriveKey(password, username);
    const plaintext = serializeState();
    const { ciphertext, iv } = await encrypt(key, plaintext);
    const write_hash = await generateWriteHash(password, username);

    const response = await fetch(`${SYNC_ENDPOINT}/${encodeURIComponent(username)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext, iv, salt: username, write_hash })
    });

    if (!response.ok) {
      return { status: 'error', error: `Server error: ${response.status}` };
    }

    const data = await response.json();
    if (data.error) {
      return { status: 'error', error: data.error };
    }

    return { status: 'ok' };
  } catch (e) {
    console.error('Push failed:', e);
    return { status: 'error', error: e.message };
  }
}

/**
 * Full sync: pull (merge), then push (replace with merged state)
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{status: 'ok'|'error', pullResult?: Object, error?: string}>}
 */
export async function fullSync(username, password) {
  const pullResult = await pullState(username, password);
  if (pullResult.status === 'error') return pullResult;

  const pushResult = await pushState(username, password);
  if (pushResult.status === 'error') return pushResult;

  return { status: 'ok', pullResult };
}

/**
 * Debounced push — called after state mutations (favorite toggle, heard track)
 * Only pushes if sync credentials exist. 2-second debounce.
 */
export function debouncedPush() {
  const creds = getSyncCredentials();
  if (!creds) return;

  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    pushState(creds.username, creds.password).catch(e => {
      console.warn('Auto-push failed:', e);
    });
  }, 2000);
}

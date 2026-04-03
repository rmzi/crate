/**
 * Local storage operations for heard tracks and secret mode
 * @module storage
 */

import { CONFIG } from './config.js';
import { state } from './state.js';

/**
 * Get secret mode from localStorage
 * @returns {boolean}
 */
export function getSecretUnlocked() {
  try {
    return localStorage.getItem(CONFIG.SECRET_KEY) === 'true';
  } catch (e) {
    return false;
  }
}

/**
 * Save secret mode to localStorage
 * @param {boolean} unlocked - Whether secret mode is unlocked
 */
export function setSecretUnlocked(unlocked) {
  try {
    if (unlocked) {
      localStorage.setItem(CONFIG.SECRET_KEY, 'true');
    } else {
      localStorage.removeItem(CONFIG.SECRET_KEY);
    }
  } catch (e) {
    console.warn('Failed to save secret mode:', e);
  }
}

/**
 * Load heard tracks from localStorage
 */
export function loadHeardTracks() {
  try {
    const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (stored) {
      state.heardTracks = new Set(JSON.parse(stored));
    }
  } catch (e) {
    console.warn('Failed to load heard tracks:', e);
  }
}

/**
 * Save heard tracks to localStorage
 */
export function saveHeardTracks() {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify([...state.heardTracks]));
  } catch (e) {
    console.warn('Failed to save heard tracks:', e);
  }
}

/**
 * Clear heard tracks from localStorage
 */
export function clearHeardTracks() {
  try {
    localStorage.removeItem(CONFIG.STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear storage:', e);
  }
}

/**
 * Load favorite tracks from localStorage
 */
export function loadFavoriteTracks() {
  try {
    const stored = localStorage.getItem(CONFIG.FAVORITES_KEY);
    if (stored) {
      state.favoriteTracks = new Set(JSON.parse(stored));
    }
  } catch (e) {
    console.warn('Failed to load favorite tracks:', e);
  }
}

/**
 * Save favorite tracks to localStorage
 */
export function saveFavoriteTracks() {
  try {
    localStorage.setItem(CONFIG.FAVORITES_KEY, JSON.stringify([...state.favoriteTracks]));
  } catch (e) {
    console.warn('Failed to save favorite tracks:', e);
  }
}

/**
 * Save play history to localStorage
 */
export function savePlayHistory() {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY.replace('heard_tracks', 'play_history'),
      JSON.stringify({ history: state.playHistory, index: state.historyIndex }));
  } catch (e) {
    console.warn('Failed to save play history:', e);
  }
}

/**
 * Load play history from localStorage
 */
export function loadPlayHistory() {
  try {
    const stored = localStorage.getItem(CONFIG.STORAGE_KEY.replace('heard_tracks', 'play_history'));
    if (stored) {
      const { history, index } = JSON.parse(stored);
      if (Array.isArray(history)) {
        state.playHistory = history;
        state.historyIndex = typeof index === 'number' ? index : history.length - 1;
      }
    }
  } catch (e) {
    console.warn('Failed to load play history:', e);
  }
}

/**
 * Save listening stats to localStorage
 */
export function saveListenStats() {
  try {
    localStorage.setItem(CONFIG.STATS_KEY, JSON.stringify({
      totalListenSeconds: state.totalListenSeconds,
      totalUniqueHeard: state.totalUniqueHeard,
      lastPlayedAt: state.lastPlayedAt,
      currentCircle: state.currentCircle
    }));
  } catch (e) {
    console.warn('Failed to save listen stats:', e);
  }
}

/**
 * Load listening stats from localStorage
 */
export function loadListenStats() {
  try {
    const stored = localStorage.getItem(CONFIG.STATS_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      state.totalListenSeconds = data.totalListenSeconds || 0;
      state.totalUniqueHeard = data.totalUniqueHeard || 0;
      state.lastPlayedAt = data.lastPlayedAt || null;
      state.currentCircle = data.currentCircle || null;
    }
  } catch (e) {
    console.warn('Failed to load listen stats:', e);
  }
}

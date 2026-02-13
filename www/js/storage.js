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

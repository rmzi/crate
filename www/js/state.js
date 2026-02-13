/**
 * Application state management
 * @module state
 */

import { MODES } from './config.js';

/**
 * Screen identifiers for explicit state tracking
 */
export const SCREENS = {
  ENTER: 'enter',
  PLAYER: 'player',
  SEARCH: 'search',
  ERROR: 'error'
};

/**
 * Central application state object
 */
export const state = {
  // Explicit screen tracking
  currentScreen: SCREENS.ENTER,
  previousScreen: null,

  mode: MODES.REGULAR,
  manifest: null,
  tracks: [],
  filteredTracks: [],
  currentTrack: null,
  heardTracks: new Set(),
  favoriteTracks: new Set(),
  isPlaying: false,
  searchQuery: '',
  showFavoritesOnly: false,
  // Konami state
  konamiProgress: 0,
  secretUnlocked: false,
  pressedB: false,
  waitingForBA: false,
  // Touch tracking
  touchStartX: 0,
  touchStartY: 0,
  // Player swipe-to-download tracking
  playerTouchStartY: 0,
  isPlayerSwipe: false,
  // Artwork long-press tracking
  artworkLongPressTriggered: false,
  // Deep link
  pendingTrackPath: null,
  // Password/Konami flow
  passwordShowing: false,
  // Session history for back/forward
  playHistory: [],
  historyIndex: -1,
  // Error tracking for resilience
  consecutiveErrors: 0,
  errorRecoveryMode: false,
  // Audio retry state
  currentRetryAttempts: 0,
  maxRetryAttempts: 3,
  retryDelay: 1000,
  audioUnlocked: false
};

/**
 * Check if current mode is secret
 * @returns {boolean}
 */
export function isSecretMode() {
  return state.mode === MODES.SECRET;
}

/**
 * Set the current screen state
 * @param {string} screen - Screen identifier from SCREENS
 */
export function setScreen(screen) {
  state.previousScreen = state.currentScreen;
  state.currentScreen = screen;
}

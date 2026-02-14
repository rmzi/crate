/**
 * UI management - screens, mini player, error display
 * @module ui
 */

import { elements } from './elements.js';
import { state, isSecretMode, setScreen, SCREENS } from './state.js';

/**
 * Map screen DOM IDs to SCREENS constants
 */
const SCREEN_ID_MAP = {
  'enter-screen': SCREENS.ENTER,
  'player-screen': SCREENS.PLAYER,
  'search-screen': SCREENS.SEARCH,
  'error-screen': SCREENS.ERROR
};

/**
 * Update UI elements based on current mode (secret/regular)
 * Call this when mode changes or when entering player screen
 */
export function updateModeBasedUI() {
  const isSecret = isSecretMode();
  const isDesktop = window.innerWidth >= 600;

  // Search/Browse button: secret only
  if (elements.searchNavBtn) {
    elements.searchNavBtn.classList.toggle('hidden', !isSecret);
  }

  // Favorite + favorites nav: available in ALL modes
  if (elements.favBtn) {
    elements.favBtn.classList.remove('hidden');
  }
  // favsNavBtn stays hidden — favorites are accessible via search screen filter

  // Search input: secret only (regular users can only browse favorites, not search)
  if (elements.trackSearch) {
    elements.trackSearch.classList.toggle('hidden', !isSecret);
  }

  // Favorites filter toggle: secret only
  if (elements.favsFilterBtn) {
    elements.favsFilterBtn.classList.toggle('hidden', !isSecret);
  }

  // Sync offline button: secret only
  if (elements.syncBtn) {
    elements.syncBtn.classList.toggle('hidden', !isSecret);
  }

  // Search trigger: secret only
  if (elements.searchTrigger) {
    elements.searchTrigger.style.display = isSecret ? '' : 'none';
  }

  // Clickable metadata is handled in player.js setupClickableMetadata
}

/**
 * Show a screen by ID
 * @param {string} screenId - ID of screen to show
 * @param {boolean} pushHistory - Whether to push to browser history
 */
export function showScreen(screenId, pushHistory = true) {
  // Update explicit screen state
  const screenState = SCREEN_ID_MAP[screenId];
  if (screenState) {
    setScreen(screenState);
  }

  const currentScreen = document.querySelector('.screen.active');
  const isEnterToPlayer = currentScreen?.id === 'enter-screen' && screenId === 'player-screen';

  // Special transition: enter -> player with slow fade
  if (isEnterToPlayer) {
    // Start fading out enter screen and title
    elements.enterScreen.classList.add('fade-out');
    const titleLogo = document.getElementById('title-logo');
    if (titleLogo) {
      titleLogo.classList.add('at-top');
    }

    // After fade-out, switch screens
    setTimeout(() => {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'fade-out'));
      document.getElementById(screenId).classList.add('active');
    }, 1500);
  } else {
    // Normal instant transition for other screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'fade-out'));
    document.getElementById(screenId).classList.add('active');

    // Animate title position based on screen
    const titleLogo = document.getElementById('title-logo');
    if (titleLogo) {
      if (screenId === 'player-screen' || screenId === 'search-screen') {
        titleLogo.classList.add('at-top');
      } else {
        titleLogo.classList.remove('at-top');
      }
    }
  }

  // Show mini player only on search screen
  if (elements.miniPlayer) {
    if (screenId === 'search-screen' && state.currentTrack) {
      elements.miniPlayer.classList.remove('hidden');
      updateMiniPlayer();
    } else {
      elements.miniPlayer.classList.add('hidden');
    }
  }

  // Push to browser history for back/forward support
  if (pushHistory && history.pushState) {
    const currentState = history.state;
    if (!currentState || currentState.screen !== screenId) {
      history.pushState({ screen: screenId }, '', '');
    }
  }
}

/**
 * Update mini player display
 */
export function updateMiniPlayer() {
  if (!state.currentTrack || !elements.miniMarquee) return;
  const text = `${state.currentTrack.artist} - ${state.currentTrack.title}`;

  // Check if text fits on desktop (no marquee needed)
  const isDesktop = window.innerWidth >= 900;
  if (isDesktop) {
    // Set single text first to measure
    elements.miniMarquee.textContent = text;
    const textWidth = elements.miniMarquee.scrollWidth;
    const containerWidth = elements.miniMarquee.parentElement.clientWidth;

    if (textWidth <= containerWidth) {
      // Text fits, no marquee needed
      elements.miniMarquee.classList.add('no-scroll');
    } else {
      // Text doesn't fit, use marquee
      elements.miniMarquee.textContent = `${text}          ${text}          `;
      elements.miniMarquee.classList.remove('no-scroll');
    }
  } else {
    // Mobile - always use marquee
    elements.miniMarquee.textContent = `${text}          ${text}          `;
    elements.miniMarquee.classList.remove('no-scroll');
  }

  // Sync play state
  if (elements.miniPlayBtn) {
    if (state.isPlaying) {
      elements.miniPlayBtn.classList.remove('paused');
    } else {
      elements.miniPlayBtn.classList.add('paused');
    }
  }

  // Show/hide prev button based on history
  if (elements.miniPrevBtn) {
    if (state.historyIndex > 0) {
      elements.miniPrevBtn.classList.remove('hidden');
    } else {
      elements.miniPrevBtn.classList.add('hidden');
    }
  }
}

/**
 * Show error screen with message
 * @param {string} message - Error message to display
 */
export function showError(message) {
  elements.errorMessage.textContent = message;
  showScreen('error-screen');
}

/**
 * Show auth error and return to enter screen
 */
export function showAuthError() {
  console.error('Authentication error - returning to enter screen');
  showScreen('enter-screen');
  elements.enterBtn.classList.remove('hidden');
}

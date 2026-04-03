/**
 * Event handlers and initialization
 * @module events
 */

import { MODES } from './config.js';
import { SITE } from './site.config.js';
import { state, isSecretMode } from './state.js';
import { elements, initElements } from './elements.js';
import { getSecretUnlocked, setSecretUnlocked, saveListenStats } from './storage.js';
import { clearAllCookies } from './cookies.js';
import { trackEvent } from './analytics.js';
import { getTrackPathFromHash } from './hash.js';
import { checkVersion } from './version.js';
import { showScreen, updateMiniPlayer } from './ui.js';
import {
  unlockAudio,
  setupVisibilityHandler,
  setAudioHandlers
} from './audio.js';
import {
  handleKonamiInput,
  handleBAInput,
  handleTouchStart,
  handleTouchEnd,
  setStartPlayerFn,
  showCashRain
} from './konami.js';
import { startVoiceRecognition, setVoiceCallbacks } from './voice.js';
import {
  playTrack,
  playPreviousTrack,
  playNextTrack,
  downloadTrack,
  handlePlayPause,
  handleNext,
  handleTrackEnded,
  handleTimeUpdate,
  handleProgressClick,
  handleEnter,
  handleRetry,
  handleSearch,
  resetApp,
  fullResetApp,
  startPlayer,
  renderTrackList,
  toggleFavorite,
  toggleFavoritesFilter,
  filterTracks,
  syncFavoritesCache,
  cycleRepeatMode,
  updateModeBasedUI
} from './player.js';
import { initPWA, setOfflineChangeCallback } from './pwa.js';
import { fullSync, getSyncCredentials, saveSyncCredentials, clearSyncCredentials, pullState } from './sync.js';
import { getCurrentCircle, getUnlockedCircles, applyCircleTheme, getCircleIndex, CIRCLES } from './circles.js';

// Set up cross-module function references
setStartPlayerFn(startPlayer);
setVoiceCallbacks({
  startPlayer,
  hidePasswordPrompt: () => {} // No-op, password prompt removed
});
setAudioHandlers({
  handleNext,
  playPreviousTrack
});

/**
 * Handle keyboard events
 * @param {KeyboardEvent} e
 */
function handleKeydown(e) {
  // Don't handle if typing in search
  if (document.activeElement === elements.trackSearch) {
    return;
  }

  // Konami code detection (works on any screen, can retrigger cash rain)
  // On player screen, only start tracking if first input is 'up'
  const isPlayerScreen = elements.playerScreen.classList.contains('active');
  if (isPlayerScreen && state.konamiProgress === 0 && e.code !== 'ArrowUp') {
    // Don't intercept arrow keys on player unless starting Konami
  } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    // If we're mid-Konami or starting with up, handle it
    if (state.konamiProgress > 0 || e.code === 'ArrowUp') {
      const direction = e.code.replace('Arrow', '').toLowerCase();
      handleKonamiInput(direction);
      // Only prevent default if we're actively in Konami sequence
      if (state.konamiProgress > 0) {
        e.preventDefault();
        return;
      }
    }
  }

  // B + A detection for secret mode (after Konami unlocked)
  if (state.waitingForBA && (e.code === 'KeyB' || e.code === 'KeyA')) {
    handleBAInput(e.code);
    return;
  }

  // Enter screen - don't process player controls
  if (elements.enterScreen.classList.contains('active')) {
    return;
  }

  // Space to pause/play
  if (e.code === 'Space' && state.currentTrack) {
    e.preventDefault();
    handlePlayPause();
  }

  // N for next
  if (e.code === 'KeyN' && state.currentTrack) {
    e.preventDefault();
    playNextTrack();
  }

  // Arrow keys for seeking (on player screen, when not entering Konami)
  if (elements.playerScreen.classList.contains('active') && state.currentTrack) {
    if (e.code === 'ArrowRight') {
      e.preventDefault();
      elements.audio.currentTime = Math.min(
        elements.audio.duration,
        elements.audio.currentTime + 10
      );
    }
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      elements.audio.currentTime = Math.max(0, elements.audio.currentTime - 10);
    }
  }

  // R to cycle repeat mode
  if (e.code === 'KeyR' && state.currentTrack) {
    e.preventDefault();
    cycleRepeatMode();
  }

  // F to toggle favorite (secret mode)
  if (e.code === 'KeyF' && isSecretMode() && state.currentTrack) {
    e.preventDefault();
    toggleFavorite();
  }

  // / for search (super modes)
  if (e.code === 'Slash' && isSecretMode()) {
    e.preventDefault();
    elements.trackSearch.focus();
  }

  // P to clear cookies and reset (for testing)
  if (e.code === 'KeyP' && e.shiftKey) {
    e.preventDefault();
    clearAllCookies();
    window.location.reload();
  }
}

/**
 * Setup player swipe-to-download touch handlers
 */
function setupPlayerSwipeHandlers() {
  function handlePlayerTouchStart(e) {
    // Only on player screen, on artwork or player-right area
    if (!elements.playerScreen.classList.contains('active')) return;
    const target = e.target;
    const isPlayerArea = target.closest('.artwork-container') ||
                         target.closest('.player-right') ||
                         target.closest('.track-info-wrapper');
    if (!isPlayerArea) return;

    state.playerTouchStartY = e.touches[0].clientY;
    state.isPlayerSwipe = true;
  }

  function handlePlayerTouchMove(e) {
    if (!state.isPlayerSwipe || !state.currentTrack) return;

    const dy = e.touches[0].clientY - state.playerTouchStartY;
    const indicator = elements.downloadIndicator;

    if (dy > 20) {
      // Show indicator with progress
      const progress = Math.min(dy / 100, 1);
      indicator.style.transform = `translateX(-50%) translateY(${Math.min(dy * 0.5, 50) - 100}%)`;
      indicator.textContent = progress >= 1 ? '^ RELEASE TO SAVE' : '^ PULL TO SAVE';
      indicator.classList.toggle('active', progress >= 1);
    } else {
      indicator.style.transform = 'translateX(-50%) translateY(-100%)';
    }
  }

  function handlePlayerTouchEnd(e) {
    if (!state.isPlayerSwipe) return;

    const dy = e.changedTouches[0].clientY - state.playerTouchStartY;
    const indicator = elements.downloadIndicator;

    if (dy >= 100 && state.currentTrack && isSecretMode()) {
      // Trigger download (secret mode only)
      indicator.textContent = '^ SAVING...';
      indicator.classList.add('downloading');
      downloadTrack(state.currentTrack, 'swipe');

      // Reset after delay
      setTimeout(() => {
        indicator.style.transform = 'translateX(-50%) translateY(-100%)';
        indicator.classList.remove('active', 'downloading');
      }, 1500);
    } else {
      // Reset immediately
      indicator.style.transform = 'translateX(-50%) translateY(-100%)';
      indicator.classList.remove('active');
    }

    state.isPlayerSwipe = false;
  }

  // Add swipe-to-download listeners
  document.addEventListener('touchstart', handlePlayerTouchStart, { passive: true });
  document.addEventListener('touchmove', handlePlayerTouchMove, { passive: true });
  document.addEventListener('touchend', handlePlayerTouchEnd, { passive: true });
}

/**
 * Setup long-press to download on artwork (desktop only)
 */
function setupArtworkLongPress() {
  if (!elements.artworkContainer) return;

  let pressTimer = null;

  elements.artworkContainer.addEventListener('mousedown', (e) => {
    if (!isSecretMode() || !state.currentTrack) return;
    e.preventDefault();

    elements.artworkContainer.classList.add('holding');
    pressTimer = setTimeout(() => {
      state.artworkLongPressTriggered = true;
      elements.artworkContainer.classList.remove('holding');
      downloadTrack(state.currentTrack, 'long_press');
    }, 1500);
  });

  function cancelPress() {
    clearTimeout(pressTimer);
    pressTimer = null;
    elements.artworkContainer.classList.remove('holding');
  }

  elements.artworkContainer.addEventListener('mouseup', cancelPress);
  elements.artworkContainer.addEventListener('mouseleave', cancelPress);
}

/**
 * Setup drawer handlers
 */
function setupDrawerHandlers() {
  function openDrawer() {
    if (elements.searchDrawer) {
      elements.searchDrawer.classList.add('open');
      elements.drawerBackdrop.classList.add('visible');
      elements.trackSearch.focus();
    }
  }

  function closeDrawer() {
    if (elements.searchDrawer) {
      elements.searchDrawer.classList.remove('open');
      elements.drawerBackdrop.classList.remove('visible');
      elements.trackSearch.blur();
    }
  }

  if (elements.searchTrigger) {
    elements.searchTrigger.addEventListener('click', openDrawer);
  }

  if (elements.drawerBackdrop) {
    elements.drawerBackdrop.addEventListener('click', closeDrawer);
  }

  // Drawer handle to close
  const drawerHandle = document.querySelector('.drawer-handle');
  if (drawerHandle) {
    drawerHandle.addEventListener('click', closeDrawer);
  }

  // Close drawer when selecting a track
  if (elements.trackList) {
    elements.trackList.addEventListener('click', (e) => {
      if (e.target.closest('.track-item')) {
        closeDrawer();
      }
    });
  }
}

/**
 * Setup menu drawer handlers
 */
function setupMenuHandlers() {
  const menuTrigger = document.getElementById('menu-trigger');
  const menuDrawer = document.getElementById('menu-drawer');
  const menuBackdrop = document.getElementById('menu-backdrop');
  const menuHelp = document.getElementById('menu-help');
  const menuShare = document.getElementById('menu-share');

  function openMenu() {
    if (menuDrawer) {
      menuDrawer.classList.add('open');
      menuBackdrop.classList.add('visible');
    }
  }

  function closeMenu() {
    if (menuDrawer) {
      menuDrawer.classList.remove('open');
      menuBackdrop.classList.remove('visible');
    }
  }

  if (menuTrigger) {
    menuTrigger.addEventListener('click', openMenu);
  }

  if (menuBackdrop) {
    menuBackdrop.addEventListener('click', closeMenu);
  }

  if (menuHelp) {
    menuHelp.addEventListener('click', () => {
      closeMenu();
      if (elements.infoModal) {
        elements.infoModal.classList.remove('hidden');
        trackEvent('info_modal_open');
      }
    });
  }

  if (menuShare) {
    menuShare.addEventListener('click', async () => {
      closeMenu();
      await shareCurrentTrack();
    });
  }
}

/**
 * Share current track or site
 */
async function shareCurrentTrack() {
  const shareData = {
    title: SITE.name,
    text: state.currentTrack
      ? `${state.currentTrack.artist} - ${state.currentTrack.title}`
      : SITE.name,
    url: window.location.href
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      trackEvent('share', { method: 'native' });
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('Share failed:', e);
      }
    }
  } else {
    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(window.location.href);
      trackEvent('share', { method: 'clipboard' });
      alert('Link copied to clipboard!');
    } catch (e) {
      console.error('Copy failed:', e);
    }
  }
}

/**
 * Setup modal handlers
 */
function setupModalHandlers() {
  // Info modal - clicking title logo opens it (only on enter screen)
  if (elements.titleLogo) {
    elements.titleLogo.addEventListener('click', () => {
      // Only open modal if on enter screen
      if (elements.enterScreen && elements.enterScreen.classList.contains('active')) {
        elements.infoModal.classList.remove('hidden');
        trackEvent('info_modal_open');
      }
    });
  }

  // Player title also opens modal
  if (elements.playerTitle) {
    elements.playerTitle.addEventListener('click', () => {
      elements.infoModal.classList.remove('hidden');
      trackEvent('info_modal_open');
    });
  }

  if (elements.modalClose) {
    elements.modalClose.addEventListener('click', () => {
      elements.infoModal.classList.add('hidden');
    });
  }

  if (elements.modalBackdrop) {
    elements.modalBackdrop.addEventListener('click', () => {
      elements.infoModal.classList.add('hidden');
    });
  }

  // Image modal carousel for Stout Junts artwork
  let carouselImages = [];
  let carouselIndex = 0;

  function updateCarousel() {
    if (!elements.imageModalImg) return;
    elements.imageModalImg.src = carouselImages[carouselIndex];

    // Update arrows
    const prevBtn = document.getElementById('image-modal-prev');
    const nextBtn = document.getElementById('image-modal-next');
    if (prevBtn) prevBtn.classList.toggle('hidden', carouselImages.length <= 1);
    if (nextBtn) nextBtn.classList.toggle('hidden', carouselImages.length <= 1);

    // Update dots
    const dotsContainer = document.getElementById('image-modal-dots');
    if (dotsContainer) {
      dotsContainer.innerHTML = carouselImages.length > 1
        ? carouselImages.map((_, i) =>
            `<span class="carousel-dot ${i === carouselIndex ? 'active' : ''}" data-index="${i}"></span>`
          ).join('')
        : '';
    }
  }

  document.querySelectorAll('.sj-thumb').forEach(thumb => {
    thumb.addEventListener('click', (e) => {
      e.preventDefault();
      if (elements.imageModal && elements.imageModalImg) {
        const imagesAttr = thumb.dataset.images || thumb.src;
        carouselImages = imagesAttr.split(',').map(s => s.trim());
        carouselIndex = 0;
        updateCarousel();
        elements.imageModal.classList.remove('hidden');
      }
    });
  });

  // Carousel navigation
  const prevBtn = document.getElementById('image-modal-prev');
  const nextBtn = document.getElementById('image-modal-next');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      carouselIndex = (carouselIndex - 1 + carouselImages.length) % carouselImages.length;
      updateCarousel();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      carouselIndex = (carouselIndex + 1) % carouselImages.length;
      updateCarousel();
    });
  }

  // Dot navigation
  document.getElementById('image-modal-dots')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('carousel-dot')) {
      carouselIndex = parseInt(e.target.dataset.index);
      updateCarousel();
    }
  });

  if (elements.imageModalClose) {
    elements.imageModalClose.addEventListener('click', () => {
      elements.imageModal.classList.add('hidden');
    });
  }

  if (elements.imageModal) {
    elements.imageModal.querySelector('.modal-backdrop').addEventListener('click', () => {
      elements.imageModal.classList.add('hidden');
    });
  }
}

/**
 * Setup audio error and state handlers
 */
function setupAudioHandlers() {
  // Use system volume - set to 100%
  elements.audio.volume = 1.0;

  // Handle audio errors
  elements.audio.addEventListener('error', (e) => {
    if (state.currentTrack) {
      console.error('Audio error:', e);
      state.consecutiveErrors++;
      if (state.consecutiveErrors >= 2) {
        state.errorRecoveryMode = true;
        showScreen('enter-screen');
        elements.enterBtn.classList.remove('hidden');
      } else {
        playNextTrack();
      }
    }
  });

  // Handle stalled audio - try to recover
  let stallTimeout = null;
  elements.audio.addEventListener('stalled', () => {
    console.log('Audio stalled, attempting recovery...');
    // Give it a moment, then try to recover
    stallTimeout = setTimeout(() => {
      if (state.currentTrack && !elements.audio.paused) {
        const currentTime = elements.audio.currentTime;
        elements.audio.load();
        elements.audio.currentTime = currentTime;
        elements.audio.play().catch(() => {});
      }
    }, 3000);
  });

  elements.audio.addEventListener('playing', () => {
    // Clear stall timeout if audio starts playing
    if (stallTimeout) {
      clearTimeout(stallTimeout);
      stallTimeout = null;
    }
  });

  // Handle waiting (buffering) - show visual feedback if needed
  elements.audio.addEventListener('waiting', () => {
    console.log('Audio buffering...');
  });
}

/**
 * Setup first user interaction audio unlock
 */
function setupFirstInteractionUnlock() {
  const unlockEvents = ['click', 'touchstart', 'touchend'];
  function handleFirstInteraction() {
    unlockAudio();
    // Remove listeners after first interaction
    unlockEvents.forEach(event => {
      document.removeEventListener(event, handleFirstInteraction);
    });
  }
  unlockEvents.forEach(event => {
    document.addEventListener(event, handleFirstInteraction, { once: true, passive: true });
  });
}

/**
 * Format seconds into human-readable time
 */
function formatListenTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * Check if current user is admin (username "rmzi")
 */
function isAdmin() {
  const creds = getSyncCredentials();
  return creds && SITE.admin && creds.username === SITE.admin;
}

/**
 * Activate admin mode — unlock everything, show debug strip
 */
function activateAdminMode() {
  state.adminMode = true;
  // Unlock secret mode
  state.mode = MODES.SECRET;
  state.secretUnlocked = true;
  setSecretUnlocked(true);
  // Unlock all circles
  if (state.totalUniqueHeard < 999) {
    state.totalUniqueHeard = 999;
    state.currentCircle = 'treachery';
    applyCircleTheme('treachery');
    saveListenStats();
  }
  // Show debug strip
  if (elements.debugStrip) {
    elements.debugStrip.classList.remove('hidden');
  }
  updateDebugStrip();
  updateModeBasedUI();
}

/**
 * Update debug strip with current state
 */
function updateDebugStrip() {
  if (!state.adminMode || !elements.debugStrip) return;
  if (elements.debugStripCircle) {
    elements.debugStripCircle.textContent = state.currentCircle || 'limbo';
  }
  if (elements.debugStripHeard) {
    elements.debugStripHeard.textContent = 'heard:' + state.totalUniqueHeard;
  }
  if (elements.debugStripScreen) {
    elements.debugStripScreen.textContent = state.currentScreen;
  }
  if (elements.debugStripOnline) {
    elements.debugStripOnline.textContent = navigator.onLine ? 'online' : 'offline';
  }
}

/**
 * Populate profile screen with current stats and sync status
 */
function populateProfile() {
  const creds = getSyncCredentials();

  // Username
  if (elements.profileUsername) {
    elements.profileUsername.textContent = creds ? creds.username.toUpperCase() : 'GUEST';
  }

  // Stats
  if (elements.profileListenTime) {
    elements.profileListenTime.textContent = formatListenTime(state.totalListenSeconds);
  }
  if (elements.profileHeard) {
    const heard = state.heardTracks.size;
    const total = state.tracks.length;
    const pct = total > 0 ? Math.round((heard / total) * 100) : 0;
    elements.profileHeard.textContent = `${heard} / ${total} (${pct}%)`;
  }
  if (elements.profileFavs) {
    elements.profileFavs.textContent = state.favoriteTracks.size.toString();
  }
  if (elements.profileLastPlayed) {
    if (state.lastPlayedAt) {
      const d = new Date(state.lastPlayedAt);
      elements.profileLastPlayed.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      elements.profileLastPlayed.textContent = '---';
    }
  }

  // Circle progress
  if (elements.circleProgress && elements.circleMarks) {
    const currentCircle = state.currentCircle || getCurrentCircle(state.totalUniqueHeard).id;
    const unlocked = getUnlockedCircles(state.totalUniqueHeard);
    const unlockedIds = new Set(unlocked.map(c => c.id));

    elements.circleMarks.innerHTML = CIRCLES.map(circle => {
      const isUnlocked = unlockedIds.has(circle.id);
      const isCurrent = circle.id === currentCircle;
      const classes = ['circle-mark'];
      if (isUnlocked) classes.push('unlocked');
      if (isCurrent) classes.push('current');
      return `<div class="${classes.join(' ')}" data-circle="${circle.id}" title="${circle.threshold} tracks"></div>`;
    }).join('');

    elements.circleProgress.classList.remove('hidden');

    // Bind click handlers for unlocked marks
    elements.circleMarks.querySelectorAll('.circle-mark.unlocked').forEach(mark => {
      mark.addEventListener('click', () => {
        const circleId = mark.dataset.circle;
        state.currentCircle = circleId;
        applyCircleTheme(circleId);
        saveListenStats();
        populateProfile(); // Re-render to update current highlight
      });
    });
  }

  // Sync section: show creds form or sync info
  if (creds) {
    // Connected — show sync info, hide creds form
    if (elements.profileCreds) elements.profileCreds.classList.add('hidden');
    if (elements.profileSyncInfo) elements.profileSyncInfo.classList.remove('hidden');

    // Sync status
    if (elements.profileSyncDot) {
      elements.profileSyncDot.className = 'sync-status-dot';
      elements.profileSyncDot.classList.add(state.lastSyncResult?.status === 'error' ? 'error' : 'connected');
    }
    if (elements.profileSyncStatus) {
      if (state.lastSyncResult?.status === 'error') {
        elements.profileSyncStatus.textContent = 'Sync error';
      } else {
        elements.profileSyncStatus.textContent = 'Connected';
      }
    }
    if (elements.profileSyncDetail) {
      if (state.lastSyncResult?.error) {
        elements.profileSyncDetail.textContent = state.lastSyncResult.error;
      } else if (state.lastSyncResult?.status === 'ok') {
        elements.profileSyncDetail.textContent = 'Last sync: ' + new Date().toLocaleTimeString();
      } else {
        elements.profileSyncDetail.textContent = '';
      }
    }
  } else {
    // Not connected — show creds form, hide sync info
    if (elements.profileCreds) elements.profileCreds.classList.remove('hidden');
    if (elements.profileSyncInfo) elements.profileSyncInfo.classList.add('hidden');
  }

  // Show/hide sync actions based on connection state
  if (elements.profileSyncBtn) {
    elements.profileSyncBtn.textContent = 'SYNC NOW';
  }
  if (elements.profileDisconnectBtn) {
    elements.profileDisconnectBtn.style.display = '';
  }

  // DEBUG: populate debug info
  populateDebugInfo();
  updateDebugStrip();
}

/** DEBUG: Remove before release */
function populateDebugInfo() {
  if (!elements.debugOutput) return;
  const creds = getSyncCredentials();
  const debug = {
    credentials: creds ? { username: creds.username, hasPassword: !!creds.password } : null,
    syncResult: state.lastSyncResult,
    stats: {
      totalListenSeconds: state.totalListenSeconds,
      totalUniqueHeard: state.totalUniqueHeard,
      lastPlayedAt: state.lastPlayedAt,
      currentCircle: state.currentCircle
    },
    state: {
      heardTracks: state.heardTracks.size,
      favoriteTracks: state.favoriteTracks.size,
      playHistory: state.playHistory.length,
      historyIndex: state.historyIndex,
      secretUnlocked: state.secretUnlocked,
      currentScreen: state.currentScreen
    },
    localStorage: {
      keys: Object.keys(localStorage).length,
      estimatedSize: JSON.stringify(localStorage).length + ' chars'
    },
    network: { online: navigator.onLine },
    serviceWorker: { controlled: !!navigator.serviceWorker?.controller }
  };
  elements.debugOutput.textContent = JSON.stringify(debug, null, 2);
}

/**
 * Initialize the application
 */
export function init() {
  // Initialize DOM element references
  initElements();

  // Check version and auto-refresh if stale
  checkVersion();

  // Setup iOS Safari PWA visibility handler
  setupVisibilityHandler();

  // Restore secret mode from localStorage
  if (getSecretUnlocked()) {
    state.mode = MODES.SECRET;
    state.secretUnlocked = true;
  }
  console.log('Crate initialized - secret mode:', state.secretUnlocked);

  // Check for deep-linked track in URL
  state.pendingTrackPath = getTrackPathFromHash();

  // Bind event listeners
  elements.enterBtn.addEventListener('click', handleEnter);
  elements.enterBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    handleEnter();
  });
  if (elements.backBtn) {
    elements.backBtn.addEventListener('click', playPreviousTrack);
  }
  elements.playPauseBtn.addEventListener('click', handlePlayPause);
  elements.nextBtn.addEventListener('click', handleNext);
  elements.retryBtn.addEventListener('click', handleRetry);
  elements.progressContainer.addEventListener('click', handleProgressClick);
  elements.audio.addEventListener('ended', handleTrackEnded);
  elements.audio.addEventListener('timeupdate', handleTimeUpdate);
  document.addEventListener('keydown', handleKeydown);

  // Touch swipe listeners for Konami on mobile
  document.addEventListener('touchstart', handleTouchStart, { passive: true });
  document.addEventListener('touchend', handleTouchEnd, { passive: true });

  // Setup various handlers
  setupPlayerSwipeHandlers();
  setupArtworkLongPress();
  setupDrawerHandlers();
  setupMenuHandlers();
  setupModalHandlers();
  setupAudioHandlers();
  setupFirstInteractionUnlock();

  if (elements.trackSearch) {
    elements.trackSearch.addEventListener('input', handleSearch);
  }

  // Voice password button
  if (elements.voiceBtn) {
    elements.voiceBtn.addEventListener('click', startVoiceRecognition);
  }

  // Reset buttons
  if (elements.resetBtn) {
    elements.resetBtn.addEventListener('click', resetApp);
    elements.resetBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      resetApp();
    });
  }
  if (elements.passwordResetBtn) {
    elements.passwordResetBtn.addEventListener('click', resetApp);
    elements.passwordResetBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      resetApp();
    });
  }

  // Full reset button (in info modal)
  if (elements.fullResetBtn) {
    elements.fullResetBtn.addEventListener('click', fullResetApp);
  }

  // Share button on player
  if (elements.shareBtn) {
    elements.shareBtn.addEventListener('click', shareCurrentTrack);
  }

  // Search navigation button
  if (elements.searchNavBtn) {
    elements.searchNavBtn.addEventListener('click', () => {
      showScreen('search-screen');
      renderTrackList();
    });
  }

  // Favorite button on player
  if (elements.favBtn) {
    elements.favBtn.addEventListener('click', toggleFavorite);
  }

  // Favorites nav button - opens search screen filtered to favorites
  if (elements.favsNavBtn) {
    elements.favsNavBtn.addEventListener('click', () => {
      state.showFavoritesOnly = true;
      if (elements.favsFilterBtn) {
        elements.favsFilterBtn.classList.add('active');
      }
      if (elements.trackSearch) {
        elements.trackSearch.value = '';
      }
      showScreen('search-screen');
      filterTracks('');
    });
  }

  // Favorites filter toggle in search header
  if (elements.favsFilterBtn) {
    elements.favsFilterBtn.addEventListener('click', toggleFavoritesFilter);
  }

  // Sync favorites offline button
  if (elements.offlineCacheBtn) {
    elements.offlineCacheBtn.addEventListener('click', syncFavoritesCache);
  }

  // Profile nav button — opens profile screen
  if (elements.profileNavBtn) {
    elements.profileNavBtn.addEventListener('click', () => {
      populateProfile();
      showScreen('profile-screen');
    });
  }

  // Profile back button
  if (elements.profileBackBtn) {
    elements.profileBackBtn.addEventListener('click', () => {
      showScreen('player-screen');
    });
  }

  // Profile sync button — force sync (only visible when connected)
  if (elements.profileSyncBtn) {
    elements.profileSyncBtn.addEventListener('click', async () => {
      const creds = getSyncCredentials();
      if (!creds) return; // Shouldn't happen — button only visible when connected

      elements.profileSyncBtn.classList.add('syncing');
      elements.profileSyncBtn.textContent = 'SYNCING...';
      if (elements.profileSyncDot) elements.profileSyncDot.className = 'sync-status-dot syncing';

      const result = await fullSync(creds.username, creds.password);
      state.lastSyncResult = result;

      elements.profileSyncBtn.classList.remove('syncing');
      populateProfile();

      if (result.status === 'ok' && result.pullResult?.details?.secretChanged) {
        updateModeBasedUI();
      }
    });
  }

  // Profile connect button — inline credential form
  if (elements.profileConnectBtn) {
    elements.profileConnectBtn.addEventListener('click', async () => {
      const username = elements.profileCredsUsername?.value?.trim();
      const password = elements.profileCredsPassword?.value;

      if (!username || !password) return;

      elements.profileConnectBtn.classList.add('syncing');
      elements.profileConnectBtn.textContent = 'CONNECTING...';

      const result = await fullSync(username, password);
      state.lastSyncResult = result;

      elements.profileConnectBtn.classList.remove('syncing');
      elements.profileConnectBtn.textContent = 'CONNECT';

      if (result.status === 'ok') {
        saveSyncCredentials(username, password);
        // Check for admin mode
        if (SITE.admin && username === SITE.admin) {
          activateAdminMode();
        }
        if (result.pullResult?.details?.secretChanged) {
          updateModeBasedUI();
        }
      } else {
        // Show error inline — briefly flash the input border red
        elements.profileCredsUsername.style.borderBottomColor = '#f87171';
        elements.profileCredsPassword.style.borderBottomColor = '#f87171';
        setTimeout(() => {
          elements.profileCredsUsername.style.borderBottomColor = '';
          elements.profileCredsPassword.style.borderBottomColor = '';
        }, 2000);
        return;
      }

      // Clear inputs
      if (elements.profileCredsUsername) elements.profileCredsUsername.value = '';
      if (elements.profileCredsPassword) elements.profileCredsPassword.value = '';

      populateProfile();
    });
  }

  // Profile disconnect button
  if (elements.profileDisconnectBtn) {
    elements.profileDisconnectBtn.addEventListener('click', () => {
      if (!confirm('Disconnect sync? Your data stays on this device.')) return;
      clearSyncCredentials();
      state.lastSyncResult = null;
      state.adminMode = false;
      if (elements.debugStrip) elements.debugStrip.classList.add('hidden');
      if (elements.debugMenu) elements.debugMenu.classList.add('hidden');
      populateProfile();
    });
  }

  // Repeat button
  if (elements.repeatBtn) {
    elements.repeatBtn.addEventListener('click', cycleRepeatMode);
  }

  // Search back button
  if (elements.searchBackBtn) {
    elements.searchBackBtn.addEventListener('click', () => {
      // Reset favorites filter when leaving search
      state.showFavoritesOnly = false;
      if (elements.favsFilterBtn) {
        elements.favsFilterBtn.classList.remove('active');
      }
      showScreen('player-screen');
    });
  }

  // Mini player controls
  if (elements.miniPlayBtn) {
    elements.miniPlayBtn.addEventListener('click', handlePlayPause);
  }
  if (elements.miniNextBtn) {
    elements.miniNextBtn.addEventListener('click', handleNext);
  }
  if (elements.miniPrevBtn) {
    elements.miniPrevBtn.addEventListener('click', playPreviousTrack);
  }
  if (elements.miniPlayerInfo) {
    elements.miniPlayerInfo.addEventListener('click', () => {
      showScreen('player-screen');
    });
  }

  // Handle browser back/forward buttons
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.screen) {
      showScreen(e.state.screen, false);
    } else {
      // Default to enter screen if no state
      showScreen('enter-screen', false);
    }
  });

  // Set initial history state
  if (history.replaceState) {
    history.replaceState({ screen: 'enter-screen' }, '', '');
  }

  // Initialize PWA (service worker, offline detection)
  initPWA();
  setOfflineChangeCallback((offline) => {
    const el = document.getElementById('offline-indicator');
    if (el) el.classList.toggle('hidden', !offline);
    filterTracks(state.searchQuery);
  });

  // Auto-sync on load if credentials exist
  const syncCreds = getSyncCredentials();
  if (syncCreds) {
    pullState(syncCreds.username, syncCreds.password).then(result => {
      state.lastSyncResult = result;
      if (result.status === 'merged' && result.details) {
        if (result.details.secretChanged) {
          updateModeBasedUI();
        }
        if (result.details.favoritesAdded > 0) {
          if (typeof renderTrackList === 'function') renderTrackList();
        }
      }
    }).catch(() => {});
  }

  // Activate admin mode if logged in as rmzi
  if (isAdmin()) {
    activateAdminMode();
  }

  // Debug strip toggle
  if (elements.debugStrip) {
    elements.debugStrip.addEventListener('click', () => {
      if (elements.debugMenu) {
        elements.debugMenu.classList.toggle('hidden');
      }
    });
  }

  // Debug menu actions
  if (elements.debugMenu) {
    // Heard count buttons
    elements.debugMenu.querySelectorAll('.debug-action[data-heard]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = parseInt(btn.dataset.heard);
        state.totalUniqueHeard = value;
        const circle = getCurrentCircle(value);
        state.currentCircle = circle.id;
        applyCircleTheme(circle.id);
        saveListenStats();
        updateDebugStrip();
        populateProfile();
      });
    });

    // Cash rain
    const cashRainBtn = document.getElementById('debug-cash-rain');
    if (cashRainBtn) {
      cashRainBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showCashRain();
        elements.debugMenu.classList.add('hidden');
      });
    }

    // Force sync
    const forceSyncBtn = document.getElementById('debug-force-sync');
    if (forceSyncBtn) {
      forceSyncBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const creds = getSyncCredentials();
        if (creds) {
          forceSyncBtn.textContent = 'SYNCING...';
          const result = await fullSync(creds.username, creds.password);
          state.lastSyncResult = result;
          forceSyncBtn.textContent = result.status === 'ok' ? 'SYNCED!' : 'ERROR';
          setTimeout(() => { forceSyncBtn.textContent = 'FORCE SYNC'; }, 1500);
          updateDebugStrip();
        }
      });
    }

    // Toggle secret
    const toggleSecretBtn = document.getElementById('debug-toggle-secret');
    if (toggleSecretBtn) {
      toggleSecretBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.secretUnlocked = !state.secretUnlocked;
        state.mode = state.secretUnlocked ? MODES.SECRET : MODES.REGULAR;
        setSecretUnlocked(state.secretUnlocked);
        updateModeBasedUI();
        toggleSecretBtn.textContent = state.secretUnlocked ? 'SECRET: ON' : 'SECRET: OFF';
        setTimeout(() => { toggleSecretBtn.textContent = 'TOGGLE SECRET'; }, 1000);
        updateDebugStrip();
      });
    }
  }
}

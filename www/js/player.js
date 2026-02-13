/**
 * Core player functionality - playback, track info, artwork
 * @module player
 */

import { CONFIG } from './config.js';
import { state, isSecretMode } from './state.js';
import { elements } from './elements.js';
import { formatTime, getMediaUrl } from './utils.js';
import { trackEvent } from './analytics.js';
import { setSignedCookies, clearAllCookies } from './cookies.js';
import { loadHeardTracks, loadFavoriteTracks, saveFavoriteTracks, setSecretUnlocked } from './storage.js';
import { setTrackInHash } from './hash.js';
import { showScreen, showError, showAuthError, updateMiniPlayer, updateModeBasedUI } from './ui.js';
import {
  isIOSPWA,
  unlockAudio,
  resetAudioElement,
  waitForAudioReady,
  updateMediaSession,
  updatePositionState
} from './audio.js';
import {
  loadManifest,
  getNextTrack,
  markTrackHeard,
  filterTracks,
  renderTrackList,
  updateCatalogProgress,
  setPlayTrackFn,
  setUpdateCatalogProgressFn
} from './tracks.js';

/**
 * Handle playback errors with recovery
 * @param {Error} error
 */
function handlePlaybackError(error) {
  console.error('Playback error:', error);
  state.consecutiveErrors++;
  if (state.consecutiveErrors >= 2) {
    state.errorRecoveryMode = true;
    showAuthError();
  } else {
    playNextTrack();
  }
}

/**
 * Update track info display with marquee for overflow
 * @param {Object} track - Track object
 */
export function updateTrackInfo(track) {
  elements.artist.textContent = track.artist || '???';
  elements.album.textContent = track.album || '???';
  elements.title.textContent = track.title || '???';
  elements.year.textContent = track.year || '???';

  // Setup clickable metadata for super/secret modes
  setupClickableMetadata();

  // Check for overflow and apply continuous marquee with speed based on length
  // Use setTimeout to ensure layout is complete (especially on first load when player fades in)
  const checkOverflow = () => {
    const fields = [
      { el: elements.title, text: track.title || '???' },
      { el: elements.artist, text: track.artist || '???' },
      { el: elements.album, text: track.album || '???' }
    ];

    // First pass: set text and reset overflow
    fields.forEach(({ el, text }) => {
      el.classList.remove('overflow');
      el.style.animationDuration = '';
      el.textContent = text;
    });

    // Use RAF after timeout to ensure layout is calculated
    requestAnimationFrame(() => {
      // Get the actual container width (track-info-wrapper has defined bounds)
      const containerWidth = document.querySelector('.track-info-wrapper')?.offsetWidth || 400;

      fields.forEach(({ el, text }) => {
        // Force reflow and measure
        const textWidth = el.scrollWidth;

        if (textWidth > containerWidth) {
          // Duplicate text for continuous loop
          el.textContent = `${text}          ${text}          `;
          el.classList.add('overflow');
          // Speed based on length: ~0.5s per character, min 10s, max 30s
          const duration = Math.min(30, Math.max(10, text.length * 0.5));
          el.style.animationDuration = `${duration}s`;
        }
      });
    });
  };

  // Delay overflow check to allow fade-in animation to complete on first load
  // The player container fades in over 1.5s, so we wait a bit longer
  setTimeout(checkOverflow, 100);
  // Also re-check after fade-in completes for first track
  setTimeout(checkOverflow, 1600);
}

/**
 * Update artwork display
 * @param {Object} track - Track object
 */
export function updateArtwork(track) {
  if (!elements.artworkContainer || !elements.artworkImage) return;

  if (track.artwork) {
    elements.artworkImage.src = getMediaUrl(track.artwork);
    elements.artworkImage.alt = `${track.artist || 'Unknown'} - ${track.album || 'Unknown'}`;
    elements.artworkContainer.classList.remove('no-art');
  } else {
    elements.artworkImage.src = '';
    elements.artworkImage.alt = '';
    elements.artworkContainer.classList.add('no-art');
  }
}

/**
 * Update progress bar and time display
 */
export function updateProgress() {
  const current = elements.audio.currentTime;
  const duration = elements.audio.duration;

  if (duration && isFinite(duration)) {
    const percent = (current / duration) * 100;
    elements.progressBar.style.width = `${percent}%`;
    elements.currentTime.textContent = formatTime(current);
    elements.duration.textContent = formatTime(duration);
  }
}

/**
 * Update back button state based on history
 */
export function updateBackButton() {
  if (elements.backBtn) {
    elements.backBtn.disabled = state.historyIndex <= 0;
  }
}

/**
 * Clickable metadata search (super/secret modes)
 * @param {string} query - Search query
 */
function searchFor(query) {
  if (!query || !isSecretMode()) return;
  elements.trackSearch.value = query;
  filterTracks(query);
  showScreen('search-screen');
}

/**
 * Setup clickable metadata for search
 */
function setupClickableMetadata() {
  const clickables = [elements.artist, elements.artworkImage];

  if (isSecretMode()) {
    // Add clickable class and handlers in secret mode
    clickables.forEach(el => {
      if (el) el.classList.add('clickable');
    });
    elements.artist.onclick = () => searchFor(state.currentTrack?.artist);
    if (elements.artworkImage) {
      elements.artworkImage.onclick = () => {
        if (state.artworkLongPressTriggered) {
          state.artworkLongPressTriggered = false;
          return;
        }
        searchFor(state.currentTrack?.album);
      };
    }
  } else {
    // Remove clickable class and handlers in regular mode
    clickables.forEach(el => {
      if (el) {
        el.classList.remove('clickable');
        el.onclick = null;
      }
    });
  }
}

/**
 * Play a specific track
 * @param {Object} track - Track to play
 * @param {boolean} fromHistory - Whether navigating from history
 * @param {boolean} isRetry - Whether this is a retry attempt
 */
export async function playTrack(track, fromHistory = false, isRetry = false) {
  state.currentTrack = track;
  updateTrackInfo(track);
  updateArtwork(track);
  updateFavoriteButton();
  setTrackInHash(track);

  // Add to history if not navigating from history and not a retry
  if (!fromHistory && !isRetry) {
    // Truncate forward history if we're not at the end
    if (state.historyIndex < state.playHistory.length - 1) {
      state.playHistory = state.playHistory.slice(0, state.historyIndex + 1);
    }
    state.playHistory.push(track.id);
    state.historyIndex = state.playHistory.length - 1;
    // Reset retry count for new track
    state.currentRetryAttempts = 0;
  }
  updateBackButton();

  const audioUrl = getMediaUrl(track.path);

  try {
    // Set source and load
    elements.audio.src = audioUrl;
    elements.audio.load();

    // For iOS Safari PWA, try playing immediately (it will buffer)
    // For others, wait for ready state first
    if (isIOSPWA()) {
      // iOS Safari PWA - play immediately, it handles buffering
      await elements.audio.play();
    } else {
      await waitForAudioReady();
      await elements.audio.play();
    }

    state.isPlaying = true;
    elements.playPauseBtn.classList.remove('paused');
    markTrackHeard(track.id);

    // Reset error counts on successful playback
    state.consecutiveErrors = 0;
    state.currentRetryAttempts = 0;

    // Track song play
    trackEvent('song_play', {
      artist: track.artist,
      album: track.album,
      title: track.title,
      year: track.year,
      track_id: track.id
    });

    // Update track list highlighting
    if (isSecretMode()) {
      renderTrackList();
    }

    // Update mini player
    updateMiniPlayer();

    // Update media session (lock screen controls)
    updateMediaSession(track);
  } catch (e) {
    // Autoplay blocked by browser - show paused state, let user tap play
    if (e.name === 'NotAllowedError') {
      console.log('Autoplay blocked - waiting for user interaction');
      state.isPlaying = false;
      elements.playPauseBtn.classList.add('paused');
      // Still update media session so controls show
      updateMediaSession(track);
      updateMiniPlayer();
      // Don't count this as an error, track is loaded and ready
      return;
    }

    // Retry logic for recoverable errors
    if (state.currentRetryAttempts < state.maxRetryAttempts) {
      state.currentRetryAttempts++;
      const delay = state.retryDelay * Math.pow(2, state.currentRetryAttempts - 1);
      console.log(`Playback failed (${e.message || e.name}), retrying in ${delay}ms (attempt ${state.currentRetryAttempts}/${state.maxRetryAttempts})`);

      // Reset audio element to clear any bad state
      resetAudioElement();

      setTimeout(() => {
        playTrack(track, fromHistory, true);
      }, delay);
      return;
    }

    // Max retries exceeded - reset audio and show error
    console.error('Max retries exceeded:', e);
    resetAudioElement();
    handlePlaybackError(e);
  }
}

// Set up the playTrack reference in tracks module
setPlayTrackFn(playTrack);
setUpdateCatalogProgressFn(updateCatalogProgress);

/**
 * Play previous track from history
 */
export function playPreviousTrack() {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    const trackId = state.playHistory[state.historyIndex];
    const track = state.tracks.find(t => t.id === trackId);
    if (track) {
      playTrack(track, true);
    }
  }
}

/**
 * Play next track (from history or new)
 */
export function playNextTrack() {
  // If there's forward history, use it
  if (state.historyIndex < state.playHistory.length - 1) {
    state.historyIndex++;
    const trackId = state.playHistory[state.historyIndex];
    const track = state.tracks.find(t => t.id === trackId);
    if (track) {
      playTrack(track, true);
      return;
    }
  }

  // Otherwise pick a new track
  const track = getNextTrack();
  if (track) {
    playTrack(track);
  } else {
    showError('No tracks available.');
  }
}

/**
 * Download current track
 * @param {Object} track - Track to download
 * @param {string} method - Download method for analytics
 */
export function downloadTrack(track, method = 'button') {
  trackEvent('download', {
    artist: track.artist,
    album: track.album,
    title: track.title,
    year: track.year,
    track_id: track.id,
    method: method
  });

  const audioUrl = getMediaUrl(track.path);
  const filename = `${track.artist || 'Unknown'} - ${track.title || 'Unknown'}.mp3`;

  // Fetch the file and trigger download
  fetch(audioUrl, { credentials: 'include' })
    .then(response => response.blob())
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    })
    .catch(e => {
      console.error('Download error:', e);
      alert('Download failed. Make sure you have valid cookies.');
    });
}

/**
 * Seek to position in track
 * @param {number} percent - Position as percentage (0-1)
 */
export function seekTo(percent) {
  const duration = elements.audio.duration;
  if (duration && isFinite(duration)) {
    elements.audio.currentTime = duration * percent;
  }
}

/**
 * Handle play/pause toggle
 */
export function handlePlayPause() {
  if (elements.audio.paused) {
    const playPromise = elements.audio.play();
    if (playPromise) {
      playPromise.then(() => {
        elements.playPauseBtn.classList.remove('paused');
        state.isPlaying = true;
        trackEvent('resume');
        updateMiniPlayer();
      }).catch((e) => {
        console.error('Play failed:', e);
        // If play fails and we have a current track, try reloading it
        if (state.currentTrack && e.name !== 'AbortError') {
          console.log('Attempting to reload track...');
          state.currentRetryAttempts = 0;
          playTrack(state.currentTrack, true, false);
        }
      });
    }
  } else {
    elements.audio.pause();
    elements.playPauseBtn.classList.add('paused');
    state.isPlaying = false;
    trackEvent('pause', {
      artist: state.currentTrack?.artist,
      title: state.currentTrack?.title,
      position_seconds: Math.floor(elements.audio.currentTime)
    });
    updateMiniPlayer();
  }
}

/**
 * Handle next track button
 */
export function handleNext() {
  // Track skip if song wasn't finished
  if (state.currentTrack && elements.audio.currentTime < elements.audio.duration - 5) {
    trackEvent('skip', {
      artist: state.currentTrack?.artist,
      title: state.currentTrack?.title,
      position_seconds: Math.floor(elements.audio.currentTime),
      duration_seconds: Math.floor(elements.audio.duration)
    });
  }
  playNextTrack();
}

/**
 * Handle track ended event
 */
export function handleTrackEnded() {
  // Track completed listen
  if (state.currentTrack) {
    trackEvent('song_complete', {
      artist: state.currentTrack.artist,
      title: state.currentTrack.title,
      duration_seconds: Math.floor(elements.audio.duration)
    });
  }
  playNextTrack();
}

/**
 * Handle time update event
 */
export function handleTimeUpdate() {
  updateProgress();
  // Update lock screen position (throttled - only every 5 seconds to save battery)
  if (Math.floor(elements.audio.currentTime) % 5 === 0) {
    updatePositionState();
  }
}

/**
 * Handle progress bar click
 * @param {MouseEvent} e
 */
export function handleProgressClick(e) {
  const rect = elements.progressContainer.getBoundingClientRect();
  const percent = (e.clientX - rect.left) / rect.width;
  seekTo(Math.max(0, Math.min(1, percent)));
}

/**
 * Reset app - clears auth but preserves heard tracks
 */
export function resetApp() {
  trackEvent('app_reset');
  clearAllCookies();
  setSecretUnlocked(false);
  // Preserve heard tracks - don't clear STORAGE_KEY
  // Preserve hash for deep links
  const hash = window.location.hash;
  window.location.href = window.location.pathname + '?_=' + Date.now() + hash;
}

/**
 * Full reset - clears everything including heard tracks
 */
export function fullResetApp() {
  if (!confirm('This will clear all data including your listening history. Continue?')) {
    return;
  }
  trackEvent('full_reset');
  clearAllCookies();
  setSecretUnlocked(false);
  try {
    localStorage.removeItem(CONFIG.STORAGE_KEY);
    localStorage.removeItem(CONFIG.FAVORITES_KEY);
  } catch (e) {
    console.warn('Failed to clear storage:', e);
  }
  window.location.href = window.location.pathname + '?_=' + Date.now();
}

/**
 * Handle enter button click
 */
export async function handleEnter() {
  // Hide enter button immediately
  elements.enterBtn.classList.add('hidden');

  // Unlock audio on user interaction (critical for mobile)
  await unlockAudio();

  // Set cookies (ensures fresh cookies after reset)
  setSignedCookies();
  startPlayer();
}

/**
 * Start the player after authentication
 */
export async function startPlayer() {
  try {
    await loadManifest();
    loadHeardTracks();
    loadFavoriteTracks();
    updateCatalogProgress();

    // Setup UI based on mode (centralized)
    updateModeBasedUI();

    // Render track list if in secret mode
    if (isSecretMode()) {
      renderTrackList();
    }

    showScreen('player-screen');

    // Check for deep-linked track
    if (state.pendingTrackPath) {
      const linkedTrack = state.tracks.find(t => t.path === state.pendingTrackPath);
      state.pendingTrackPath = null;
      if (linkedTrack) {
        playTrack(linkedTrack);
        return;
      }
    }

    playNextTrack();
  } catch (e) {
    showError(e.message || 'Failed to start player.');
  }
}

/**
 * Handle retry button click
 */
export function handleRetry() {
  showScreen('enter-screen');
  elements.enterBtn.classList.remove('hidden');
}

/**
 * Handle search input
 * @param {Event} e
 */
export function handleSearch(e) {
  filterTracks(e.target.value);
}

/**
 * Toggle favorite status for current track
 */
export function toggleFavorite() {
  if (!state.currentTrack) return;
  const id = state.currentTrack.id;
  if (state.favoriteTracks.has(id)) {
    state.favoriteTracks.delete(id);
    trackEvent('unfavorite', { track_id: id, artist: state.currentTrack.artist, title: state.currentTrack.title });
  } else {
    state.favoriteTracks.add(id);
    trackEvent('favorite', { track_id: id, artist: state.currentTrack.artist, title: state.currentTrack.title });
  }
  saveFavoriteTracks();
  updateFavoriteButton();
  if (isSecretMode()) {
    renderTrackList();
  }
}

/**
 * Update the favorite button state based on current track
 */
export function updateFavoriteButton() {
  if (!elements.favBtn || !state.currentTrack) return;
  const isFav = state.favoriteTracks.has(state.currentTrack.id);
  elements.favBtn.classList.toggle('favorited', isFav);
}

/**
 * Toggle the favorites-only filter on the search screen
 */
export function toggleFavoritesFilter() {
  state.showFavoritesOnly = !state.showFavoritesOnly;
  if (elements.favsFilterBtn) {
    elements.favsFilterBtn.classList.toggle('active', state.showFavoritesOnly);
  }
  if (state.showFavoritesOnly && elements.trackSearch) {
    elements.trackSearch.value = '';
  }
  filterTracks(elements.trackSearch ? elements.trackSearch.value : '');
}

// Re-export for convenience
export { updateCatalogProgress, renderTrackList, filterTracks, updateModeBasedUI };

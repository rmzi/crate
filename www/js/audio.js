/**
 * Audio player controls, media session, and iOS handling
 * @module audio
 */

import { elements } from './elements.js';
import { state } from './state.js';
import { getMediaUrl } from './utils.js';
import { updateMiniPlayer } from './ui.js';

// Forward declarations for circular dependency resolution
let handleNextFn = null;
let playPreviousTrackFn = null;

/**
 * Set handler function references to avoid circular imports
 * @param {Object} handlers - Object containing handleNext and playPreviousTrack
 */
export function setAudioHandlers(handlers) {
  handleNextFn = handlers.handleNext;
  playPreviousTrackFn = handlers.playPreviousTrack;
}

/**
 * Detect iOS Safari PWA mode
 * @returns {boolean}
 */
export function isIOSPWA() {
  return window.navigator.standalone === true && /iPhone|iPad|iPod/.test(navigator.userAgent);
}

/**
 * Unlock audio on iOS/mobile - must be called from user interaction
 * @returns {Promise}
 */
export async function unlockAudio() {
  if (state.audioUnlocked) return Promise.resolve();

  return new Promise((resolve) => {
    // Use a tiny silent MP3 data URL to unlock
    const silentMp3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v/////////////////////////////////' +
      '//////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYCkJDmAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v////////////////////////' +
      '////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYCkJDmAAAA';

    const originalSrc = elements.audio.src;
    elements.audio.src = silentMp3;

    // Also try to unlock WebAudio context (helps on iOS Safari)
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') {
          ctx.resume();
        }
        // Create and play a silent buffer
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      }
    } catch (e) {
      console.log('WebAudio unlock attempt:', e.message);
    }

    const playPromise = elements.audio.play();
    if (playPromise) {
      playPromise.then(() => {
        elements.audio.pause();
        elements.audio.src = originalSrc || '';
        state.audioUnlocked = true;
        console.log('Audio unlocked successfully');
        resolve();
      }).catch((e) => {
        console.log('Audio unlock failed:', e.message);
        elements.audio.src = originalSrc || '';
        // Still mark as attempted so we don't spam
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Reset audio element to clean state
 */
export function resetAudioElement() {
  elements.audio.pause();
  elements.audio.src = '';
  elements.audio.load();
  state.audioUnlocked = false;
}

/**
 * Wait for audio to be ready to play
 * @param {number} timeout - Timeout in ms
 * @returns {Promise}
 */
export function waitForAudioReady(timeout = 10000) {
  return new Promise((resolve, reject) => {
    // If already ready, resolve immediately
    if (elements.audio.readyState >= 3) {
      resolve();
      return;
    }

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Audio load timeout'));
    }, timeout);

    function onCanPlay() {
      cleanup();
      resolve();
    }

    function onError(e) {
      cleanup();
      reject(e);
    }

    function cleanup() {
      clearTimeout(timeoutId);
      elements.audio.removeEventListener('canplay', onCanPlay);
      elements.audio.removeEventListener('error', onError);
    }

    elements.audio.addEventListener('canplay', onCanPlay, { once: true });
    elements.audio.addEventListener('error', onError, { once: true });
  });
}

/**
 * Update position state for lock screen progress bar
 */
export function updatePositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!elements.audio.duration || isNaN(elements.audio.duration)) return;

  try {
    navigator.mediaSession.setPositionState({
      duration: elements.audio.duration,
      playbackRate: elements.audio.playbackRate,
      position: elements.audio.currentTime
    });
  } catch (e) {
    // Position state not supported
  }
}

/**
 * Update Media Session API for lock screen controls
 * @param {Object} track - Current track object
 */
export function updateMediaSession(track) {
  if (!('mediaSession' in navigator)) return;

  const artworkUrl = track.artwork ? getMediaUrl(track.artwork) : '';

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title || 'Unknown',
    artist: track.artist || 'Unknown',
    album: track.album || 'Unknown',
    artwork: artworkUrl ? [
      { src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }
    ] : []
  });

  // Set up action handlers
  navigator.mediaSession.setActionHandler('play', () => {
    elements.audio.play();
    state.isPlaying = true;
    elements.playPauseBtn.classList.remove('paused');
    updateMiniPlayer();
  });

  navigator.mediaSession.setActionHandler('pause', () => {
    elements.audio.pause();
    state.isPlaying = false;
    elements.playPauseBtn.classList.add('paused');
    updateMiniPlayer();
  });

  navigator.mediaSession.setActionHandler('previoustrack', () => {
    if (playPreviousTrackFn) playPreviousTrackFn();
  });

  navigator.mediaSession.setActionHandler('nexttrack', () => {
    if (handleNextFn) handleNextFn();
  });

  // Seek to specific position (enables scrubbing on lock screen)
  try {
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        elements.audio.currentTime = details.seekTime;
        updatePositionState();
      }
    });
  } catch (e) {
    // Seek handler not supported on all platforms
  }
}

/**
 * Setup visibility change handler for iOS Safari PWA
 */
export function setupVisibilityHandler() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.currentTrack) {
      // iOS Safari PWA can suspend audio when backgrounded
      if (isIOSPWA() && elements.audio.paused && state.isPlaying) {
        console.log('Resuming audio after visibility change');
        elements.audio.play().catch(() => {
          // If play fails, user will need to tap play button
          state.isPlaying = false;
          elements.playPauseBtn.classList.add('paused');
          updateMiniPlayer();
        });
      }
    }
  });
}

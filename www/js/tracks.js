/**
 * Track management - manifest loading, track selection, filtering
 * @module tracks
 */

import { state, isSecretMode } from './state.js';
import { elements } from './elements.js';
import { seededRandom, escapeHtml, getMediaUrl } from './utils.js';
import { saveHeardTracks } from './storage.js';
import { trackEvent } from './analytics.js';
import { showAuthError } from './ui.js';
import { networkState, isTrackCached } from './pwa.js';

// Forward declaration for renderTrackList callback
let updateCatalogProgressFn = null;

/**
 * Set the updateCatalogProgress function reference
 * @param {Function} fn
 */
export function setUpdateCatalogProgressFn(fn) {
  updateCatalogProgressFn = fn;
}

/**
 * Load manifest from server
 * @returns {Promise<boolean>} Success status
 */
export async function loadManifest() {
  try {
    const response = await fetch('/manifest.json', {
      credentials: 'include'
    });

    if (!response.ok) {
      if (response.status === 403) {
        state.consecutiveErrors++;
        state.errorRecoveryMode = true;
        showAuthError();
        return false;
      }
      throw new Error(`Failed to load manifest: ${response.status}`);
    }

    state.manifest = await response.json();
    state.tracks = state.manifest.tracks || [];
    state.filteredTracks = [...state.tracks];

    // Reset error state on success
    state.consecutiveErrors = 0;
    state.errorRecoveryMode = false;

    if (state.tracks.length === 0) {
      throw new Error('No tracks available.');
    }

    return true;
  } catch (e) {
    console.error('Manifest load error:', e);
    throw e;
  }
}

/**
 * Get next track to play (prioritizes unheard tracks)
 * @returns {Object|null} Track object
 */
export function getNextTrack() {
  let pool = networkState.offline
    ? state.tracks.filter(t => isTrackCached(t))
    : state.tracks;
  if (pool.length === 0) return null;

  const unheard = pool.filter(t => !state.heardTracks.has(t.id));

  if (unheard.length === 0) {
    state.heardTracks.clear();
    saveHeardTracks();
    return pool[seededRandom(pool.length)];
  }

  return unheard[seededRandom(unheard.length)];
}

/**
 * Mark a track as heard
 * @param {string} trackId - Track ID
 */
export function markTrackHeard(trackId) {
  state.heardTracks.add(trackId);
  saveHeardTracks();
  if (updateCatalogProgressFn) {
    updateCatalogProgressFn();
  }
  renderTrackList();
}

// Debounce search tracking to avoid spam
let searchTrackTimeout = null;

/**
 * Filter tracks by search query
 * @param {string} query - Search query
 */
export function filterTracks(query) {
  state.searchQuery = query.toLowerCase();
  let base = state.showFavoritesOnly
    ? state.tracks.filter(t => state.favoriteTracks.has(t.id))
    : [...state.tracks];

  if (networkState.offline) {
    base = base.filter(t => isTrackCached(t));
  }

  if (!state.searchQuery) {
    state.filteredTracks = base;
  } else {
    state.filteredTracks = base.filter(t => {
      const searchStr = `${t.artist || ''} ${t.album || ''} ${t.title || ''} ${t.year || ''}`.toLowerCase();
      return searchStr.includes(state.searchQuery);
    });
    // Track search after 500ms of no typing
    clearTimeout(searchTrackTimeout);
    searchTrackTimeout = setTimeout(() => {
      trackEvent('search', {
        search_term: state.searchQuery,
        results_count: state.filteredTracks.length
      });
    }, 500);
  }
  renderTrackList();
}

// Forward declaration for playTrack callback
let playTrackFn = null;

/**
 * Set the playTrack function reference
 * @param {Function} fn
 */
export function setPlayTrackFn(fn) {
  playTrackFn = fn;
}

/**
 * Render track list in search view
 */
export function renderTrackList() {
  if (!elements.trackList) return;

  if (state.showFavoritesOnly && state.filteredTracks.length === 0) {
    elements.trackList.innerHTML = '<div class="track-list-empty">No favorites yet</div>';
    return;
  }

  const html = state.filteredTracks.map(track => {
    const isPlaying = state.currentTrack && state.currentTrack.id === track.id;
    const playingClass = isPlaying ? 'playing' : '';
    const isFav = state.favoriteTracks.has(track.id);
    const isCached = state.cachedTracks.has(track.id);
    const artist = track.artist || '???';
    const title = track.title || '???';
    const album = track.album || '';
    const year = track.year || '';
    const artworkSrc = track.artwork ? getMediaUrl(track.artwork) : '';
    const thumbClass = artworkSrc ? '' : 'no-art';

    return `
      <div class="track-item ${playingClass}" data-id="${track.id}">
        <img class="track-item-thumb ${thumbClass}" src="${artworkSrc}" alt="" loading="lazy">
        <div class="track-item-info">
          <span class="track-item-title">${escapeHtml(title)}</span>
          ${album ? `<span class="track-item-album">${escapeHtml(album)}${year ? ` (${escapeHtml(year)})` : ''}</span>` : (year ? `<span class="track-item-year">${escapeHtml(year)}</span>` : '')}
          <span class="track-item-artist">${escapeHtml(artist)}</span>
        </div>
        ${isFav ? '<span class="track-item-fav">&#9829;</span>' : ''}
        ${isCached ? '<span class="track-item-cached" title="Available offline">&#9660;</span>' : ''}
      </div>
    `;
  }).join('');

  elements.trackList.innerHTML = html;

  // Bind play buttons
  elements.trackList.querySelectorAll('.play-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const trackId = btn.dataset.id;
      const track = state.tracks.find(t => t.id === trackId);
      if (track && playTrackFn) {
        playTrackFn(track);
      }
    });
  });

  // Bind row clicks
  elements.trackList.querySelectorAll('.track-item').forEach(row => {
    row.addEventListener('click', () => {
      const trackId = row.dataset.id;
      const track = state.tracks.find(t => t.id === trackId);
      if (track && playTrackFn) {
        playTrackFn(track);
      }
    });
  });
}

/**
 * Update catalog progress display
 */
export function updateCatalogProgress() {
  const total = state.tracks.length;
  const heard = state.heardTracks.size;
  const percent = total > 0 ? Math.round((heard / total) * 100) : 0;

  elements.heardCount.textContent = heard;
  elements.totalCount.textContent = total;
  elements.heardPercent.textContent = percent;
}

/**
 * DOM element references
 * @module elements
 */

/**
 * Cached DOM element references
 * Initialized after DOMContentLoaded
 */
export const elements = {
  enterScreen: null,
  playerScreen: null,
  errorScreen: null,
  enterBtn: null,
  backBtn: null,
  playPauseBtn: null,
  nextBtn: null,
  retryBtn: null,
  audio: null,
  artist: null,
  album: null,
  title: null,
  year: null,
  progressBar: null,
  progressContainer: null,
  currentTime: null,
  duration: null,
  heardCount: null,
  totalCount: null,
  heardPercent: null,
  errorMessage: null,
  searchDrawer: null,
  searchTrigger: null,
  drawerBackdrop: null,
  trackList: null,
  trackSearch: null,
  konamiProgress: null,
  artworkContainer: null,
  artworkImage: null,
  passwordContainer: null,
  passwordInput: null,
  passwordError: null,
  titleLogo: null,
  playerTitle: null,
  infoModal: null,
  modalClose: null,
  modalBackdrop: null,
  imageModal: null,
  imageModalImg: null,
  imageModalClose: null,
  resetBtn: null,
  passwordResetBtn: null,
  voiceBtn: null,
  fullResetBtn: null,
  shareBtn: null,
  favBtn: null,
  favsNavBtn: null,
  favsFilterBtn: null,
  searchNavBtn: null,
  searchScreen: null,
  searchBackBtn: null,
  miniPlayer: null,
  miniMarquee: null,
  miniPlayBtn: null,
  miniPrevBtn: null,
  miniNextBtn: null,
  miniPlayerInfo: null,
  downloadIndicator: null
};

/**
 * Initialize DOM element references
 * Must be called after DOMContentLoaded
 */
export function initElements() {
  elements.enterScreen = document.getElementById('enter-screen');
  elements.playerScreen = document.getElementById('player-screen');
  elements.errorScreen = document.getElementById('error-screen');
  elements.enterBtn = document.getElementById('enter-btn');
  elements.backBtn = document.getElementById('back-btn');
  elements.playPauseBtn = document.getElementById('play-pause-btn');
  elements.nextBtn = document.getElementById('next-btn');
  elements.retryBtn = document.getElementById('retry-btn');
  elements.audio = document.getElementById('audio-player');
  elements.artist = document.getElementById('artist');
  elements.album = document.getElementById('album');
  elements.title = document.getElementById('title');
  elements.year = document.getElementById('year');
  elements.progressBar = document.getElementById('progress-bar');
  elements.progressContainer = document.getElementById('progress-container');
  elements.currentTime = document.getElementById('current-time');
  elements.duration = document.getElementById('duration');
  elements.heardCount = document.getElementById('heard-count');
  elements.totalCount = document.getElementById('total-count');
  elements.heardPercent = document.getElementById('heard-percent');
  elements.errorMessage = document.getElementById('error-message');
  elements.searchDrawer = document.getElementById('search-drawer');
  elements.searchTrigger = document.getElementById('search-trigger');
  elements.drawerBackdrop = document.getElementById('drawer-backdrop');
  elements.trackList = document.getElementById('track-list');
  elements.trackSearch = document.getElementById('track-search');
  elements.konamiProgress = document.getElementById('konami-progress');
  elements.artworkContainer = document.getElementById('artwork-container');
  elements.artworkImage = document.getElementById('artwork-image');
  elements.passwordContainer = document.getElementById('password-container');
  elements.passwordInput = document.getElementById('password-input');
  elements.passwordError = document.getElementById('password-error');
  elements.titleLogo = document.getElementById('title-logo');
  elements.playerTitle = document.querySelector('.player-title');
  elements.infoModal = document.getElementById('info-modal');
  elements.modalClose = document.getElementById('modal-close');
  elements.modalBackdrop = document.querySelector('.modal-backdrop');
  elements.imageModal = document.getElementById('image-modal');
  elements.imageModalImg = document.getElementById('image-modal-img');
  elements.imageModalClose = document.getElementById('image-modal-close');
  elements.resetBtn = document.getElementById('reset-btn');
  elements.passwordResetBtn = document.getElementById('password-reset-btn');
  elements.voiceBtn = document.getElementById('voice-btn');
  elements.fullResetBtn = document.getElementById('full-reset-btn');
  elements.shareBtn = document.getElementById('share-btn');
  elements.favBtn = document.getElementById('fav-btn');
  elements.favsNavBtn = document.getElementById('favs-nav-btn');
  elements.favsFilterBtn = document.getElementById('favs-filter-btn');
  elements.searchNavBtn = document.getElementById('search-nav-btn');
  elements.searchScreen = document.getElementById('search-screen');
  elements.searchBackBtn = document.getElementById('search-back-btn');
  elements.miniPlayer = document.getElementById('mini-player');
  elements.miniMarquee = document.getElementById('mini-marquee');
  elements.miniPlayBtn = document.getElementById('mini-play-btn');
  elements.miniPrevBtn = document.getElementById('mini-prev-btn');
  elements.miniNextBtn = document.getElementById('mini-next-btn');
  elements.miniPlayerInfo = document.getElementById('mini-player-info');
  elements.downloadIndicator = document.getElementById('download-indicator');
}

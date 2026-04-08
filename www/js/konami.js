/**
 * Konami code detection and secret mode handling
 * @module konami
 */

import { KONAMI_SEQUENCE, SWIPE_THRESHOLD, MODES } from './config.js';
import { state } from './state.js';
import { elements } from './elements.js';
import { setSecretUnlocked } from './storage.js';
import { setSignedCookies } from './cookies.js';
import { trackEvent } from './analytics.js';
import { updateModeBasedUI } from './ui.js';

// Forward declaration - will be set by player module
let startPlayerFn = null;

// Plugin hook - custom reward function (e.g., cash rain for 36247)
let konamiRewardFn = null;

/**
 * Set the startPlayer function reference
 * @param {Function} fn - The startPlayer function
 */
export function setStartPlayerFn(fn) {
  startPlayerFn = fn;
}

/**
 * Set a custom Konami reward function (replaces default cash rain)
 * @param {Function} fn - The reward function to call on Konami success
 */
export function setKonamiReward(fn) {
  konamiRewardFn = fn;
}

/**
 * Get Konami arrow elements
 * @returns {NodeList}
 */
function getKonamiArrows() {
  return elements.konamiProgress ? elements.konamiProgress.querySelectorAll('.konami-arrow') : [];
}

/**
 * Update Konami arrow display
 */
export function updateKonamiArrows() {
  const arrows = getKonamiArrows();
  arrows.forEach((arrow, i) => {
    arrow.classList.remove('filled', 'error', 'success');
    if (i < state.konamiProgress) {
      arrow.classList.add('filled');
    }
  });
  // Show arrows as active once user starts entering
  if (elements.konamiProgress && state.konamiProgress > 0) {
    elements.konamiProgress.classList.add('active');
  }
}

/**
 * Flash Konami arrows red for error
 */
export function flashKonamiError() {
  const arrows = getKonamiArrows();
  arrows.forEach(arrow => {
    arrow.classList.add('error');
  });
  if (elements.konamiProgress) {
    elements.konamiProgress.classList.add('active');
  }
  setTimeout(() => {
    arrows.forEach(arrow => arrow.classList.remove('error', 'filled'));
    if (elements.konamiProgress) {
      elements.konamiProgress.classList.remove('active');
    }
  }, 300);
}

/**
 * Flash Konami arrows green for success
 */
export function flashKonamiSuccess() {
  const arrows = getKonamiArrows();
  arrows.forEach(arrow => {
    arrow.classList.remove('filled');
    arrow.classList.add('success');
  });
  setTimeout(() => {
    arrows.forEach(arrow => arrow.classList.remove('success'));
    if (elements.konamiProgress) {
      elements.konamiProgress.classList.remove('active');
    }
  }, 500);
}

/**
 * Show secret hint for B+A input
 */
export function showSecretHint() {
  // Add hint element if not exists
  if (!document.querySelector('.secret-hint')) {
    const hint = document.createElement('div');
    hint.className = 'secret-hint visible';
    hint.textContent = 'q + a';  // Upside down hint for B + A
    const enterContent = document.querySelector('.enter-content');
    if (enterContent) {
      enterContent.appendChild(hint);
    }
  }
}

/**
 * Fire the Konami reward animation (custom or default cash rain)
 */
function fireKonamiReward() {
  if (konamiRewardFn) {
    konamiRewardFn();
  } else {
    showCashRain();
  }
}

/**
 * Show cash rain animation — deep 3D pour
 */
export function showCashRain() {
  const overlay = document.createElement('div');
  overlay.className = 'cash-rain';

  const billImages = ['/img/benj_front.jpeg', '/img/benj_back.jpeg'];

  // Size tiers for parallax depth (small = far away, large = close)
  const sizeTiers = [
    { w: 30, h: 13, opacity: 0.4, zIndex: 1 },   // far background
    { w: 45, h: 19, opacity: 0.6, zIndex: 2 },   // mid-back
    { w: 60, h: 25, opacity: 0.75, zIndex: 3 },  // middle
    { w: 80, h: 34, opacity: 0.9, zIndex: 4 },   // mid-front
    { w: 100, h: 42, opacity: 1, zIndex: 5 },     // foreground
  ];

  const totalBills = 150;
  const numWaves = 5;
  const billsPerWave = Math.floor(totalBills / numWaves);

  for (let wave = 0; wave < numWaves; wave++) {
    const waveDelay = wave * 0.3;

    for (let i = 0; i < billsPerWave; i++) {
      const bill = document.createElement('div');
      bill.className = 'bill';

      // Weight distribution: more small bills (far) than large (close)
      const tierRoll = Math.random();
      let tier;
      if (tierRoll < 0.3) tier = sizeTiers[0];       // 30% tiny
      else if (tierRoll < 0.55) tier = sizeTiers[1];  // 25% small
      else if (tierRoll < 0.75) tier = sizeTiers[2];  // 20% medium
      else if (tierRoll < 0.9) tier = sizeTiers[3];   // 15% large
      else tier = sizeTiers[4];                        // 10% huge

      const img = billImages[Math.floor(Math.random() * billImages.length)];

      bill.style.setProperty('--bill-width', tier.w + 'px');
      bill.style.setProperty('--bill-height', tier.h + 'px');
      bill.style.setProperty('--bill-img', `url(${img})`);
      bill.style.setProperty('--bill-opacity', tier.opacity);
      bill.style.zIndex = tier.zIndex;
      bill.style.left = (-10 + Math.random() * 120) + 'vw';

      // Slower fall for small (far) bills, faster for large (close)
      const baseDuration = 2 + (5 - tier.zIndex) * 0.4;
      bill.style.setProperty('--fall-duration', (baseDuration + Math.random() * 1.5) + 's');
      bill.style.setProperty('--fall-delay', (waveDelay + Math.random() * 0.5) + 's');

      // Random 3D tumble
      bill.style.setProperty('--spin-x', (360 + Math.random() * 720) * (Math.random() > 0.5 ? 1 : -1) + 'deg');
      bill.style.setProperty('--spin-y', (360 + Math.random() * 720) * (Math.random() > 0.5 ? 1 : -1) + 'deg');
      bill.style.setProperty('--spin-z', (180 + Math.random() * 360) * (Math.random() > 0.5 ? 1 : -1) + 'deg');
      bill.style.setProperty('--start-rot', (Math.random() * 360) + 'deg');

      overlay.appendChild(bill);
    }
  }

  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 4500);
}

/**
 * Handle Konami code input
 * @param {string} direction - Arrow direction
 */
export function handleKonamiInput(direction) {
  // On enter screen before unlock - full Konami flow
  const isEnterScreen = elements.enterScreen.classList.contains('active');

  if (KONAMI_SEQUENCE[state.konamiProgress] === direction) {
    state.konamiProgress++;
    if (isEnterScreen) updateKonamiArrows();

    if (state.konamiProgress === KONAMI_SEQUENCE.length) {
      state.konamiProgress = 0; // Reset for next time

      // If already unlocked, just show reward (and go to player if on enter screen)
      if (state.secretUnlocked) {
        fireKonamiReward();
        if (isEnterScreen && startPlayerFn) {
          setTimeout(() => startPlayerFn(), 2500);
        }
        return;
      }

      // First time unlock
      state.secretUnlocked = true;
      state.mode = MODES.SECRET;
      setSecretUnlocked(true);
      trackEvent('secret_unlock', { method: 'konami' });
      flashKonamiSuccess();
      setSignedCookies();
      fireKonamiReward();
      // Update UI immediately for mode change
      updateModeBasedUI();
      // Go to player after animation
      if (startPlayerFn) {
        setTimeout(() => startPlayerFn(), 2500);
      }
    }
  } else if (direction) {
    flashKonamiError();
    state.konamiProgress = 0;
  }
}

/**
 * Handle B+A input for secret mode
 * @param {string} input - Key code or direction
 */
export function handleBAInput(input) {
  if (!state.waitingForBA || state.secretUnlocked) return;

  if (input === 'KeyB' || input === 'down') {
    state.pressedB = true;
  } else if ((input === 'KeyA' || input === 'up') && state.pressedB) {
    // B+A on desktop, or down+up swipe on mobile
    if (input === 'KeyA') {
      unlockSecretDesktop();
    } else {
      unlockSecretMobile();
    }
  } else {
    state.pressedB = false;
  }
}

/**
 * Unlock secret mode on desktop (B+A keys)
 */
function unlockSecretDesktop() {
  state.secretUnlocked = true;
  state.waitingForBA = false;
  state.mode = MODES.SECRET;
  setSecretUnlocked(true);
  setSignedCookies();
  fireKonamiReward();
  // Update UI immediately for mode change
  updateModeBasedUI();
  // Go to player after animation
  if (startPlayerFn) {
    setTimeout(() => startPlayerFn(), 2500);
  }
}

/**
 * Unlock secret mode on mobile (down+up swipe)
 */
function unlockSecretMobile() {
  state.secretUnlocked = true;
  state.waitingForBA = false;
  state.mode = MODES.SECRET;
  setSecretUnlocked(true);
  setSignedCookies();
  fireKonamiReward();
  // Update UI immediately for mode change
  updateModeBasedUI();
  // Go to player after animation
  if (startPlayerFn) {
    setTimeout(() => startPlayerFn(), 2500);
  }
}

/**
 * Handle touch start for swipe detection
 * @param {TouchEvent} e
 */
export function handleTouchStart(e) {
  state.touchStartX = e.touches[0].clientX;
  state.touchStartY = e.touches[0].clientY;
}

/**
 * Handle touch end for swipe detection
 * @param {TouchEvent} e
 */
export function handleTouchEnd(e) {
  const dx = e.changedTouches[0].clientX - state.touchStartX;
  const dy = e.changedTouches[0].clientY - state.touchStartY;

  let direction = null;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
    direction = dx > 0 ? 'right' : 'left';
  } else if (Math.abs(dy) > SWIPE_THRESHOLD) {
    direction = dy > 0 ? 'down' : 'up';
  }

  if (direction) {
    // After Konami, swipes go to B+A handler (down=B, up=A)
    if (state.waitingForBA) {
      handleBAInput(direction);
    } else {
      handleKonamiInput(direction);
    }
  }
}

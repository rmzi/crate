/**
 * Dante's Circles — smoke theme progression system
 * @module circles
 */

import { SITE } from './site.config.js';

/**
 * Circle definitions with thresholds and default colors.
 * Colors are arrays of 3 rgba strings for --smoke-1, --smoke-2, --smoke-3.
 * Site config can override via SITE.theme.circles.{id}
 */
const DEFAULT_COLORS = {
  limbo:     ['rgba(255,255,255,0.25)', 'rgba(255,255,255,0.22)', 'rgba(255,255,255,0.18)'],
  lust:      ['rgba(200,50,80,0.25)',   'rgba(180,40,70,0.22)',   'rgba(160,30,60,0.18)'],
  gluttony:  ['rgba(212,175,55,0.25)',  'rgba(190,155,45,0.22)',  'rgba(170,140,35,0.18)'],
  greed:     ['rgba(50,180,80,0.25)',   'rgba(40,160,70,0.22)',   'rgba(30,140,60,0.18)'],
  wrath:     ['rgba(220,30,30,0.25)',   'rgba(200,20,20,0.22)',   'rgba(180,15,15,0.18)'],
  heresy:    ['rgba(230,120,20,0.25)',  'rgba(210,100,15,0.22)',  'rgba(190,85,10,0.18)'],
  violence:  ['rgba(140,20,30,0.25)',   'rgba(120,15,25,0.22)',   'rgba(100,10,20,0.18)'],
  fraud:     ['rgba(120,40,180,0.25)',  'rgba(100,30,160,0.22)',  'rgba(85,20,140,0.18)'],
  treachery: ['rgba(100,180,255,0.25)', 'rgba(80,160,235,0.22)', 'rgba(60,140,215,0.18)'],
};

export const CIRCLES = [
  { id: 'limbo',     threshold: 0 },
  { id: 'lust',      threshold: 5 },
  { id: 'gluttony',  threshold: 12 },
  { id: 'greed',     threshold: 20 },
  { id: 'wrath',     threshold: 35 },
  { id: 'heresy',    threshold: 50 },
  { id: 'violence',  threshold: 65 },
  { id: 'fraud',     threshold: 80 },
  { id: 'treachery', threshold: 100 },
];

/**
 * Get colors for a circle, checking site config overrides first
 * @param {string} circleId
 * @returns {string[]} Array of 3 rgba color strings
 */
function getCircleColors(circleId) {
  // Check site config override
  const siteColors = SITE.theme?.circles?.[circleId];
  if (siteColors) {
    // Site config can provide a single color string or array of 3
    if (Array.isArray(siteColors)) return siteColors;
    // Single color — derive variants with slightly lower opacity
    return [siteColors, siteColors.replace(/[\d.]+\)$/, m => (parseFloat(m) * 0.88).toFixed(2) + ')'), siteColors.replace(/[\d.]+\)$/, m => (parseFloat(m) * 0.72).toFixed(2) + ')')];
  }
  return DEFAULT_COLORS[circleId] || DEFAULT_COLORS.limbo;
}

/**
 * Get the current circle based on unique tracks heard
 * @param {number} uniqueHeard
 * @returns {Object} Circle object {id, threshold}
 */
export function getCurrentCircle(uniqueHeard) {
  let current = CIRCLES[0];
  for (const circle of CIRCLES) {
    if (uniqueHeard >= circle.threshold) {
      current = circle;
    }
  }
  return current;
}

/**
 * Get all unlocked circles
 * @param {number} uniqueHeard
 * @returns {Object[]} Array of unlocked circle objects
 */
export function getUnlockedCircles(uniqueHeard) {
  return CIRCLES.filter(c => uniqueHeard >= c.threshold);
}

/**
 * Apply a circle's smoke theme by setting CSS custom properties
 * @param {string} circleId - Circle ID to apply
 */
export function applyCircleTheme(circleId) {
  const colors = getCircleColors(circleId || 'limbo');
  const root = document.documentElement;
  root.style.setProperty('--smoke-1', colors[0]);
  root.style.setProperty('--smoke-2', colors[1]);
  root.style.setProperty('--smoke-3', colors[2]);
}

/**
 * Check if a new circle was unlocked between prev and new heard counts
 * @param {number} prevHeard - Previous totalUniqueHeard
 * @param {number} newHeard - New totalUniqueHeard
 * @returns {Object|null} Newly unlocked circle, or null
 */
export function checkCircleAdvancement(prevHeard, newHeard) {
  const prevCircle = getCurrentCircle(prevHeard);
  const newCircle = getCurrentCircle(newHeard);
  if (newCircle.id !== prevCircle.id) {
    return newCircle;
  }
  return null;
}

/**
 * Get circle index (0-8) for a given circle ID
 * @param {string} circleId
 * @returns {number}
 */
export function getCircleIndex(circleId) {
  const idx = CIRCLES.findIndex(c => c.id === circleId);
  return idx >= 0 ? idx : 0;
}

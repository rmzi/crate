/**
 * Application configuration constants
 * Derived from site.config.js — edit that file to customize.
 * @module config
 */

import { SITE } from './site.config.js';

export const APP_VERSION = '1.0.0';

// Derive storage keys from site name
const prefix = SITE.name.toLowerCase().replace(/[^a-z0-9]/g, '_');

export const CONFIG = {
  STORAGE_KEY: `${prefix}_heard_tracks`,
  FAVORITES_KEY: `${prefix}_favorite_tracks`,
  SECRET_KEY: `${prefix}_secret_unlocked`,
  COOKIE_NAMES: ['CloudFront-Policy', 'CloudFront-Signature', 'CloudFront-Key-Pair-Id'],
  PASSWORD: SITE.password
};

// COOKIES_PLACEHOLDER - replaced by deploy-cookies.py
export const SIGNED_COOKIES = null;

export const MODES = {
  REGULAR: 'regular',
  SECRET: 'secret'
};

// Konami code sequence: up up down down left right left right
export const KONAMI_SEQUENCE = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right'];
export const SWIPE_THRESHOLD = 50;

// Production URL for media
export const PROD_URL = SITE.url;

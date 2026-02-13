/**
 * Analytics tracking functions
 * @module analytics
 */

/**
 * Track an event to Google Analytics
 * @param {string} eventName - Event name
 * @param {Object} params - Event parameters
 */
export function trackEvent(eventName, params = {}) {
  if (typeof gtag === 'function') {
    gtag('event', eventName, params);
  }
}

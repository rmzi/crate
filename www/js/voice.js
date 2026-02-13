/**
 * Voice recognition for password authentication
 * @module voice
 */

import { CONFIG } from './config.js';
import { state } from './state.js';
import { elements } from './elements.js';
import { setSignedCookies } from './cookies.js';
import { trackEvent } from './analytics.js';

// Forward declaration for startPlayer callback
let startPlayerFn = null;
let hidePasswordPromptFn = null;

/**
 * Set callback function references
 * @param {Object} callbacks - Object with startPlayer and hidePasswordPrompt functions
 */
export function setVoiceCallbacks(callbacks) {
  startPlayerFn = callbacks.startPlayer;
  hidePasswordPromptFn = callbacks.hidePasswordPrompt;
}

let activeRecognition = null;

/**
 * Handle successful voice login
 */
function handleVoiceLoginSuccess() {
  console.log('Voice login success! Setting cookies...');
  const cookieResult = setSignedCookies();
  console.log('Cookie result:', cookieResult);
  if (cookieResult) {
    trackEvent('login', { method: 'voice' });
    if (hidePasswordPromptFn) hidePasswordPromptFn();
    state.consecutiveErrors = 0;
    state.errorRecoveryMode = false;
    if (startPlayerFn) startPlayerFn();
  } else {
    console.error('Failed to set cookies. SIGNED_COOKIES:', CONFIG.SIGNED_COOKIES);
    alert('Voice recognized! But cookies failed to set. Try refreshing.');
  }
}

/**
 * Start voice recognition for password
 */
export function startVoiceRecognition() {
  // If already listening, stop
  if (activeRecognition) {
    activeRecognition.stop();
    activeRecognition = null;
    elements.voiceBtn.classList.remove('listening');
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Voice not supported in this browser');
    return;
  }

  const recognition = new SpeechRecognition();
  activeRecognition = recognition;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  elements.voiceBtn.classList.add('listening');

  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map(result => result[0].transcript)
      .join('')
      .toLowerCase();

    console.log('Heard:', transcript);

    // Very generous matching - "ay mayne, say mayne"
    const hasMainSound = transcript.includes('main') || transcript.includes('mane') || transcript.includes('mayne') || transcript.includes('man') || transcript.includes('maine');
    const hasAySound = transcript.includes('aye') || transcript.includes('hey') || transcript.includes(' ay') || transcript.includes('ay ');
    const hasSaySound = transcript.includes('say') || transcript.includes('sei') || transcript.includes('sey');

    // Accept if we hear the key sounds
    if ((hasMainSound && hasAySound) || (hasMainSound && hasSaySound) || transcript.includes('aymane') || transcript.includes('saymane') || transcript.includes('aymayne') || transcript.includes('saymayne')) {
      recognition.stop();
      activeRecognition = null;
      elements.voiceBtn.classList.remove('listening');
      handleVoiceLoginSuccess();
    }
  };

  recognition.onerror = (event) => {
    console.log('Voice error:', event.error);
    elements.voiceBtn.classList.remove('listening');
    activeRecognition = null;
  };

  recognition.onend = () => {
    elements.voiceBtn.classList.remove('listening');
    activeRecognition = null;
  };

  recognition.start();
}

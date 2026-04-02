/**
 * Client-side encryption for state sync
 * Uses PBKDF2 for key derivation and AES-GCM for encryption.
 * Zero-knowledge: the server never sees plaintext or password.
 * @module crypto
 */

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 256;

/**
 * Derive an AES-GCM key from password + username
 * @param {string} password
 * @param {string} username - used as PBKDF2 salt
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKey(password, username) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(username), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext with AES-GCM
 * @param {CryptoKey} key
 * @param {string} plaintext
 * @returns {Promise<{ciphertext: string, iv: string}>} base64-encoded
 */
export async function encrypt(key, plaintext) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key, enc.encode(plaintext)
  );
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv))
  };
}

/**
 * Decrypt ciphertext with AES-GCM
 * @param {CryptoKey} key
 * @param {string} ciphertextB64 - base64 ciphertext
 * @param {string} ivB64 - base64 IV
 * @returns {Promise<string>} decrypted plaintext
 */
export async function decrypt(key, ciphertextB64, ivB64) {
  const ciphertext = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key, ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Generate write_hash for write authorization
 * write_hash = SHA-256(password + username) — prevents unauthorized overwrites
 * @param {string} password
 * @param {string} username
 * @returns {Promise<string>} hex-encoded hash
 */
export async function generateWriteHash(password, username) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(password + username));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

# State-Sharing Implementation Plan

## Architecture Overview

```
Browser                          CloudFront                    Lambda                   S3
  |                                  |                           |                      |
  |-- PUT /sync/{username} --------->|-- /sync/* behavior ------>|-- PutObject --------->|
  |   (encrypted blob + write_hash)  |   (Lambda Function URL)   |   sync/{user}.json   |
  |                                  |                           |                      |
  |-- GET /sync/{username} --------->|-------------------------->|-- GetObject --------->|
  |   (returns ciphertext)           |                           |                      |
```

**Client-side encryption flow:**
```
password --> PBKDF2(password, username_salt, 100k iters) --> 256-bit AES key
state JSON --> AES-GCM encrypt(key, iv) --> base64 ciphertext
write_hash = SHA-256(password + username) --> sent alongside blob for write auth
```

---

## Task Decomposition (5 parallelizable work units)

| # | Task | Deps | Parallelizable With |
|---|------|------|---------------------|
| T1 | Terraform: Lambda + CloudFront behavior + IAM | None | T2, T3, T4 |
| T2 | Lambda handler code | None | T1, T3, T4 |
| T3 | Client: crypto module + sync module | None | T1, T2, T4 |
| T4 | Client: UI (modal, button, animations, CSS) | None | T1, T2, T3 |
| T5 | Client: wiring + offline bug fix | T3, T4 | None |

---

## T1: Terraform Infrastructure

### New file: `terraform/lambda-sync.tf`

```hcl
# Lambda function for state sync read/write
resource "aws_lambda_function" "sync" {
  function_name = "${var.subdomain}-state-sync"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 10
  memory_size   = 128

  filename         = "${path.module}/lambda/sync.zip"
  source_code_hash = filebase64sha256("${path.module}/lambda/sync.zip")

  role = aws_iam_role.sync_lambda.arn

  environment {
    variables = {
      BUCKET_NAME = aws_s3_bucket.tracks.id
      SYNC_PREFIX = "sync/"
    }
  }
}

# Lambda Function URL (no API Gateway needed)
resource "aws_lambda_function_url" "sync" {
  function_name      = aws_lambda_function.sync.function_name
  authorization_type = "NONE"

  cors {
    allow_origins     = ["https://${local.domain_name}"]
    allow_methods     = ["GET", "PUT"]
    allow_headers     = ["Content-Type"]
    max_age           = 3600
  }
}

# IAM role for Lambda
resource "aws_iam_role" "sync_lambda" {
  name = "${var.subdomain}-sync-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# Lambda basic execution (CloudWatch logs)
resource "aws_iam_role_policy_attachment" "sync_lambda_logs" {
  role       = aws_iam_role.sync_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# S3 access for sync/ prefix only
resource "aws_iam_role_policy" "sync_lambda_s3" {
  name = "${var.subdomain}-sync-lambda-s3"
  role = aws_iam_role.sync_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject"]
      Resource = "${aws_s3_bucket.tracks.arn}/sync/*"
    }]
  })
}
```

### Modified file: `terraform/cloudfront.tf`

Add new ordered_cache_behavior BEFORE the audio behavior (line ~98), and a new Lambda origin:

```hcl
# New origin: Lambda Function URL for sync
origin {
  domain_name = replace(replace(aws_lambda_function_url.sync.function_url, "https://", ""), "/", "")
  origin_id   = "sync-lambda"

  custom_origin_config {
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "https-only"
    origin_ssl_protocols   = ["TLSv1.2"]
  }
}

# Sync API behavior: Lambda Function URL
ordered_cache_behavior {
  path_pattern           = "/sync/*"
  allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
  cached_methods         = ["GET", "HEAD"]
  target_origin_id       = "sync-lambda"
  viewer_protocol_policy = "redirect-to-https"
  compress               = true

  # No caching for sync requests
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 0

  forwarded_values {
    query_string = false
    headers      = ["Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"]
    cookies {
      forward = "none"
    }
  }
}
```

### Modified file: `terraform/outputs.tf`

Add:
```hcl
output "sync_lambda_url" {
  description = "Lambda Function URL for state sync"
  value       = aws_lambda_function_url.sync.function_url
}
```

### New directory: `terraform/lambda/`

Lambda code lives here, zipped for deployment (see T2).

---

## T2: Lambda Handler

### New file: `terraform/lambda/index.mjs`

```javascript
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME;
const PREFIX = process.env.SYNC_PREFIX || 'sync/';

export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod;
  // Extract username from path: /sync/{username}
  const path = event.rawPath || event.path || '';
  const username = path.replace(/^\/sync\//, '').replace(/\.json$/, '');

  if (!username || username.includes('/') || username.includes('..')) {
    return respond(400, { error: 'Invalid username' });
  }

  const key = `${PREFIX}${username}.json`;

  if (method === 'GET') {
    return handleGet(key);
  } else if (method === 'PUT') {
    return handlePut(key, event);
  } else {
    return respond(405, { error: 'Method not allowed' });
  }
}

async function handleGet(key) {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await result.Body.transformToString();
    return respond(200, JSON.parse(body));
  } catch (e) {
    if (e.name === 'NoSuchKey') {
      return respond(404, { error: 'No sync data found' });
    }
    console.error('GET error:', e);
    return respond(500, { error: 'Internal error' });
  }
}

async function handlePut(key, event) {
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  const { ciphertext, iv, salt, write_hash } = body;
  if (!ciphertext || !iv || !salt || !write_hash) {
    return respond(400, { error: 'Missing required fields: ciphertext, iv, salt, write_hash' });
  }

  // Check existing write_hash (if file exists, must match)
  try {
    const existing = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const existingData = JSON.parse(await existing.Body.transformToString());
    if (existingData.write_hash && existingData.write_hash !== write_hash) {
      return respond(403, { error: 'Invalid credentials' });
    }
  } catch (e) {
    if (e.name !== 'NoSuchKey') {
      console.error('Auth check error:', e);
      return respond(500, { error: 'Internal error' });
    }
    // NoSuchKey = new user, allow creation
  }

  // Write the blob
  const record = {
    ciphertext,
    iv,
    salt,
    write_hash,
    updated_at: new Date().toISOString()
  };

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(record),
    ContentType: 'application/json'
  }));

  return respond(200, { ok: true, updated_at: record.updated_at });
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
```

**Build step:** `cd terraform/lambda && zip sync.zip index.mjs` (no node_modules needed — AWS SDK v3 is built into nodejs20.x runtime).

---

## T3: Client Crypto + Sync Module

### New file: `www/js/crypto.js`

Encryption and hashing using only Web Crypto API (no dependencies).

```javascript
/**
 * Client-side encryption for state sync
 * Uses PBKDF2 for key derivation and AES-GCM for encryption
 * @module crypto
 */

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 256;

/**
 * Derive an AES-GCM key from password + username
 * @param {string} password
 * @param {string} username - used as salt
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
 * Encrypt plaintext JSON string with AES-GCM
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
 * Generate write_hash = SHA-256(password + username) for write authorization
 * @param {string} password
 * @param {string} username
 * @returns {Promise<string>} hex-encoded hash
 */
export async function generateWriteHash(password, username) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(password + username));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### New file: `www/js/sync.js`

State sync orchestration — push/pull/merge logic.

```javascript
/**
 * State sync — push/pull encrypted state to cloud
 * @module sync
 */

import { state } from './state.js';
import { saveFavoriteTracks, saveHeardTracks, setSecretUnlocked } from './storage.js';
import { deriveKey, encrypt, decrypt, generateWriteHash } from './crypto.js';
import { trackEvent } from './analytics.js';

const SYNC_ENDPOINT = '/sync';
const SYNC_CREDS_KEY = 'crate_sync_credentials';

/**
 * Store sync credentials in localStorage (username only, not password)
 */
export function saveSyncUsername(username) {
  try {
    localStorage.setItem(SYNC_CREDS_KEY, JSON.stringify({ username }));
  } catch (e) { /* ignore */ }
}

/**
 * Get stored sync username
 * @returns {string|null}
 */
export function getSyncUsername() {
  try {
    const stored = localStorage.getItem(SYNC_CREDS_KEY);
    if (stored) return JSON.parse(stored).username;
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * Clear sync credentials
 */
export function clearSyncCredentials() {
  try { localStorage.removeItem(SYNC_CREDS_KEY); } catch (e) { /* ignore */ }
}

/**
 * Serialize current state to JSON for encryption
 * @returns {string}
 */
function serializeState() {
  return JSON.stringify({
    favoriteTracks: [...state.favoriteTracks],
    heardTracks: [...state.heardTracks],
    secretUnlocked: state.secretUnlocked,
    syncedAt: new Date().toISOString()
  });
}

/**
 * Merge remote state into local state (union merge)
 * @param {Object} remote - Deserialized remote state
 * @returns {{favoritesAdded: number, heardAdded: number, secretChanged: boolean}}
 */
function mergeState(remote) {
  let favoritesAdded = 0;
  let heardAdded = 0;
  let secretChanged = false;

  // Favorites: union merge
  if (Array.isArray(remote.favoriteTracks)) {
    for (const id of remote.favoriteTracks) {
      if (!state.favoriteTracks.has(id)) {
        state.favoriteTracks.add(id);
        favoritesAdded++;
      }
    }
    saveFavoriteTracks();
  }

  // Heard: union merge (never un-hear)
  if (Array.isArray(remote.heardTracks)) {
    for (const id of remote.heardTracks) {
      if (!state.heardTracks.has(id)) {
        state.heardTracks.add(id);
        heardAdded++;
      }
    }
    saveHeardTracks();
  }

  // Secret: OR (once unlocked, stays unlocked)
  if (remote.secretUnlocked && !state.secretUnlocked) {
    state.secretUnlocked = true;
    state.mode = 'secret';
    setSecretUnlocked(true);
    secretChanged = true;
  }

  return { favoritesAdded, heardAdded, secretChanged };
}

/**
 * Pull state from server and merge
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{status: 'merged'|'empty'|'error', details?: Object, error?: string}>}
 */
export async function pullState(username, password) {
  try {
    const response = await fetch(`${SYNC_ENDPOINT}/${encodeURIComponent(username)}`);

    if (response.status === 404) {
      return { status: 'empty' };
    }
    if (!response.ok) {
      return { status: 'error', error: `Server error: ${response.status}` };
    }

    const data = await response.json();
    const key = await deriveKey(password, username);

    let plaintext;
    try {
      plaintext = await decrypt(key, data.ciphertext, data.iv);
    } catch (e) {
      return { status: 'error', error: 'Wrong password — could not decrypt' };
    }

    const remote = JSON.parse(plaintext);
    const details = mergeState(remote);

    trackEvent('sync_pull', {
      favorites_added: details.favoritesAdded,
      heard_added: details.heardAdded,
      secret_changed: details.secretChanged
    });

    return { status: 'merged', details };
  } catch (e) {
    console.error('Pull failed:', e);
    return { status: 'error', error: e.message };
  }
}

/**
 * Push current state to server (full replace)
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{status: 'ok'|'error', error?: string}>}
 */
export async function pushState(username, password) {
  try {
    const key = await deriveKey(password, username);
    const plaintext = serializeState();
    const { ciphertext, iv } = await encrypt(key, plaintext);
    const write_hash = await generateWriteHash(password, username);

    const response = await fetch(`${SYNC_ENDPOINT}/${encodeURIComponent(username)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext, iv, salt: username, write_hash })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { status: 'error', error: err.error || `Server error: ${response.status}` };
    }

    trackEvent('sync_push', {
      favorites: state.favoriteTracks.size,
      heard: state.heardTracks.size
    });

    return { status: 'ok' };
  } catch (e) {
    console.error('Push failed:', e);
    return { status: 'error', error: e.message };
  }
}

/**
 * Full sync: pull (merge), then push (replace)
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{status: 'ok'|'error', pullResult?: Object, error?: string}>}
 */
export async function fullSync(username, password) {
  const pullResult = await pullState(username, password);
  if (pullResult.status === 'error') return pullResult;

  const pushResult = await pushState(username, password);
  if (pushResult.status === 'error') return pushResult;

  return { status: 'ok', pullResult };
}
```

---

## T4: UI — Modal, Button, Animations, CSS

### Modified file: `www/index.html`

**1. Rename existing sync button** (line 152):

```html
<!-- BEFORE -->
<button id="sync-btn" class="search-sync-btn hidden" aria-label="Sync favorites offline">
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
  </svg>
</button>

<!-- AFTER: rename to offline-cache-btn, add state-sync-btn -->
<button id="state-sync-btn" class="search-sync-btn state-sync-btn hidden" aria-label="Sync state">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 4v5h5"/>
    <path d="M20 20v-5h-5"/>
    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L4 7"/>
    <path d="M3.51 15a9 9 0 0 0 14.85 3.36L20 17"/>
  </svg>
</button>
<button id="offline-cache-btn" class="search-sync-btn hidden" aria-label="Cache favorites offline">
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
  </svg>
</button>
```

**2. Add sync modal** (after `#info-modal`, before `</div><!-- #app -->`):

```html
<!-- Sync modal -->
<div id="sync-modal" class="modal hidden">
  <div class="modal-backdrop"></div>
  <div class="modal-content sync-modal-content">
    <button id="sync-modal-close" class="modal-close">&times;</button>
    <div class="sync-modal-body">
      <h2 class="sync-modal-title">SYNC</h2>
      <p class="sync-modal-subtitle">Sync favorites across devices</p>
      <form id="sync-form" class="sync-form" autocomplete="off">
        <input type="text" id="sync-username" class="sync-input" placeholder="USERNAME" autocomplete="username" required>
        <input type="password" id="sync-password" class="sync-input" placeholder="PASSWORD" autocomplete="current-password" required>
        <div id="sync-error" class="sync-error hidden"></div>
        <div class="sync-actions">
          <button type="submit" id="sync-submit" class="sync-action-btn">SYNC</button>
        </div>
      </form>
      <div id="sync-status" class="sync-status hidden">
        <div class="sync-status-icon"></div>
        <span class="sync-status-text"></span>
      </div>
      <button id="sync-logout" class="sync-logout hidden">DISCONNECT</button>
    </div>
  </div>
</div>
```

### Modified file: `www/main.css`

**New CSS additions** (add after the existing `.sync-progress-text` block, ~line 751):

```css
/* ============================================
   State Sync UI
   ============================================ */

/* Sync button — two rotating arrows icon */
.state-sync-btn {
  position: relative;
}

.state-sync-btn svg {
  width: 20px;
  height: 20px;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.state-sync-btn:hover svg {
  transform: rotate(30deg);
}

.state-sync-btn:active svg {
  transform: rotate(180deg);
  transition-duration: 0.15s;
}

/* Syncing state — continuous rotation */
.state-sync-btn.syncing svg {
  animation: sync-spin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

/* Synced indicator — green dot */
.state-sync-btn.connected::after {
  content: '';
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  background: #4a4;
  border: 1px solid var(--bg);
}

/* Success flash */
.state-sync-btn.sync-success {
  color: #4a4;
  border-color: #4a4;
}

.state-sync-btn.sync-error {
  color: var(--accent);
  border-color: var(--accent);
}

@keyframes sync-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

@keyframes sync-success-flash {
  0%   { opacity: 1; transform: scale(1); }
  50%  { opacity: 0.7; transform: scale(1.15); }
  100% { opacity: 1; transform: scale(1); }
}

/* ---- Sync Modal ---- */
.sync-modal-content {
  max-width: 360px;
  padding: 40px 30px;
  text-align: center;
  /* Slide up from below */
  animation: sync-modal-enter 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

@keyframes sync-modal-enter {
  from {
    opacity: 0;
    transform: translateY(40px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Backdrop fade */
.sync-modal-content ~ .modal-backdrop,
#sync-modal .modal-backdrop {
  animation: sync-backdrop-in 0.25s ease-out both;
}

@keyframes sync-backdrop-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.sync-modal-title {
  font-family: 'Anton', Impact, sans-serif;
  font-size: 32px;
  letter-spacing: 0.15em;
  color: var(--fg);
  margin: 0 0 5px;
}

.sync-modal-subtitle {
  font-family: 'Special Elite', cursive;
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 30px;
}

/* Form inputs */
.sync-input {
  width: 100%;
  padding: 12px 15px;
  background: transparent;
  border: 1px solid var(--muted);
  color: var(--fg);
  font-family: 'Bebas Neue', sans-serif;
  font-size: 16px;
  letter-spacing: 0.1em;
  margin-bottom: 12px;
  outline: none;
  transition: border-color 0.2s ease-out;
  box-sizing: border-box;
  -webkit-appearance: none;
}

.sync-input:focus {
  border-color: var(--fg);
}

.sync-input::placeholder {
  color: var(--muted);
  opacity: 0.6;
}

/* Error message */
.sync-error {
  color: var(--accent);
  font-family: 'Special Elite', cursive;
  font-size: 12px;
  margin-bottom: 12px;
  text-align: left;
}

/* Action buttons */
.sync-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

.sync-action-btn {
  flex: 1;
  padding: 12px;
  background: transparent;
  border: 2px solid var(--fg);
  color: var(--fg);
  font-family: 'Anton', Impact, sans-serif;
  font-size: 16px;
  letter-spacing: 0.15em;
  cursor: pointer;
  transition: all 0.15s ease-out;
}

.sync-action-btn:hover {
  background: var(--fg);
  color: var(--bg);
}

.sync-action-btn:active {
  transform: scale(0.97);
}

.sync-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Status indicator */
.sync-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 20px;
  font-family: 'Special Elite', cursive;
  font-size: 13px;
}

.sync-status-icon {
  width: 16px;
  height: 16px;
  border: 2px solid var(--muted);
  animation: sync-spin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.sync-status.success .sync-status-icon {
  border-color: #4a4;
  background: #4a4;
  animation: sync-success-flash 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.sync-status.error .sync-status-icon {
  border-color: var(--accent);
  background: var(--accent);
  animation: none;
}

.sync-status-text {
  color: var(--muted);
}

/* Logout/disconnect button */
.sync-logout {
  margin-top: 25px;
  padding: 8px 20px;
  background: transparent;
  border: 1px solid var(--muted);
  color: var(--muted);
  font-family: 'Special Elite', cursive;
  font-size: 11px;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: all 0.15s ease-out;
}

.sync-logout:hover {
  border-color: var(--accent);
  color: var(--accent);
}
```

**Note:** No `border-radius` anywhere. Brutalist aesthetic maintained.

### Modified file: `www/js/elements.js`

Add new element references (in the `elements` object, ~line 69-71):

```javascript
// Replace line 69:
syncBtn: null,         // RENAME: this becomes offlineCacheBtn
// Add:
stateSyncBtn: null,
offlineCacheBtn: null,
syncModal: null,
syncModalClose: null,
syncForm: null,
syncUsername: null,
syncPassword: null,
syncError: null,
syncSubmit: null,
syncStatus: null,
syncLogout: null,
```

In `initElements()`, update (~line 137):

```javascript
// Replace line 137:
elements.syncBtn = document.getElementById('sync-btn');
// With:
elements.offlineCacheBtn = document.getElementById('offline-cache-btn');
elements.stateSyncBtn = document.getElementById('state-sync-btn');
elements.syncModal = document.getElementById('sync-modal');
elements.syncModalClose = document.getElementById('sync-modal-close');
elements.syncForm = document.getElementById('sync-form');
elements.syncUsername = document.getElementById('sync-username');
elements.syncPassword = document.getElementById('sync-password');
elements.syncError = document.getElementById('sync-error');
elements.syncSubmit = document.getElementById('sync-submit');
elements.syncStatus = document.getElementById('sync-status');
elements.syncLogout = document.getElementById('sync-logout');
```

### Modified file: `www/js/ui.js`

In `updateModeBasedUI()` (~lines 48-51), replace `syncBtn` references:

```javascript
// BEFORE:
if (elements.syncBtn) {
  elements.syncBtn.classList.toggle('hidden', !isSecret);
}

// AFTER:
// Offline cache button: secret mode only
if (elements.offlineCacheBtn) {
  elements.offlineCacheBtn.classList.toggle('hidden', !isSecret);
}
// State sync button: always visible (all users can sync)
if (elements.stateSyncBtn) {
  elements.stateSyncBtn.classList.remove('hidden');
}
```

### Modified file: `www/js/player.js`

In `updateSyncUI()` (~line 722), update references from `syncBtn` to `offlineCacheBtn`:

```javascript
export function updateSyncUI() {
  if (!elements.offlineCacheBtn) return;

  const allCached = state.favoriteTracks.size > 0 &&
    [...state.favoriteTracks].every(id => state.cachedTracks.has(id));

  elements.offlineCacheBtn.classList.toggle('syncing', state.cacheSyncing);
  elements.offlineCacheBtn.classList.toggle('synced', allCached && !state.cacheSyncing);
  // ... rest unchanged
}
```

### Modified file: `www/js/events.js`

**1. Replace sync button binding** (~line 682):

```javascript
// BEFORE:
if (elements.syncBtn) {
  elements.syncBtn.addEventListener('click', syncFavoritesCache);
}

// AFTER:
// Offline cache button (renamed from sync-btn)
if (elements.offlineCacheBtn) {
  elements.offlineCacheBtn.addEventListener('click', syncFavoritesCache);
}

// State sync button — opens sync modal
if (elements.stateSyncBtn) {
  elements.stateSyncBtn.addEventListener('click', openSyncModal);
}
```

**2. Add sync modal handler setup** in `init()`:

```javascript
import { pullState, pushState, fullSync, getSyncUsername, saveSyncUsername, clearSyncCredentials } from './sync.js';

// ... inside init():
setupSyncModalHandlers();
```

**3. Add `setupSyncModalHandlers` function and `openSyncModal`:**

```javascript
function openSyncModal() {
  if (!elements.syncModal) return;
  const savedUsername = getSyncUsername();
  if (savedUsername && elements.syncUsername) {
    elements.syncUsername.value = savedUsername;
  }
  elements.syncModal.classList.remove('hidden');
  // Focus first empty field
  if (elements.syncUsername.value) {
    elements.syncPassword.focus();
  } else {
    elements.syncUsername.focus();
  }
}

function closeSyncModal() {
  if (!elements.syncModal) return;
  elements.syncModal.classList.add('hidden');
  // Reset status
  if (elements.syncError) elements.syncError.classList.add('hidden');
  if (elements.syncStatus) elements.syncStatus.classList.add('hidden');
}

function setupSyncModalHandlers() {
  if (elements.syncModalClose) {
    elements.syncModalClose.addEventListener('click', closeSyncModal);
  }
  // Backdrop closes modal
  const backdrop = elements.syncModal?.querySelector('.modal-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', closeSyncModal);
  }

  if (elements.syncForm) {
    elements.syncForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = elements.syncUsername.value.trim();
      const password = elements.syncPassword.value;
      if (!username || !password) return;

      // Show loading
      elements.syncSubmit.disabled = true;
      elements.syncSubmit.textContent = 'SYNCING...';
      elements.syncError.classList.add('hidden');
      elements.syncStatus.classList.remove('hidden', 'success', 'error');
      elements.syncStatus.querySelector('.sync-status-text').textContent = 'Syncing...';

      // State sync button spinner
      elements.stateSyncBtn?.classList.add('syncing');

      const result = await fullSync(username, password);

      elements.stateSyncBtn?.classList.remove('syncing');
      elements.syncSubmit.disabled = false;
      elements.syncSubmit.textContent = 'SYNC';

      if (result.status === 'ok') {
        saveSyncUsername(username);
        elements.syncStatus.classList.add('success');
        elements.syncStatus.querySelector('.sync-status-text').textContent = 'Synced!';
        elements.stateSyncBtn?.classList.add('connected');
        elements.syncLogout?.classList.remove('hidden');

        // Flash success on button
        elements.stateSyncBtn?.classList.add('sync-success');
        setTimeout(() => elements.stateSyncBtn?.classList.remove('sync-success'), 1500);

        // Refresh UI
        renderTrackList();
        updateCatalogProgress();
        updateModeBasedUI();

        // Auto-close after success
        setTimeout(closeSyncModal, 1200);
      } else {
        elements.syncStatus.classList.add('error');
        elements.syncStatus.querySelector('.sync-status-text').textContent = result.error || 'Sync failed';
        elements.syncError.textContent = result.error || 'Sync failed';
        elements.syncError.classList.remove('hidden');

        // Flash error on button
        elements.stateSyncBtn?.classList.add('sync-error');
        setTimeout(() => elements.stateSyncBtn?.classList.remove('sync-error'), 1500);
      }
    });
  }

  if (elements.syncLogout) {
    elements.syncLogout.addEventListener('click', () => {
      clearSyncCredentials();
      elements.syncUsername.value = '';
      elements.syncPassword.value = '';
      elements.stateSyncBtn?.classList.remove('connected');
      elements.syncLogout.classList.add('hidden');
      elements.syncStatus.classList.add('hidden');
    });
  }
}
```

---

## T5: Wiring + Offline Bug Fix

### Offline Cache Bug Fix

**The bug:** `isTrackCached()` in `pwa.js` only checks the Service Worker Cache API (`audio-v1`), but `syncFavoritesCache()` writes to IndexedDB (`crate_cache`). When offline, `getNextTrack()` and `filterTracks()` call `isTrackCached()` and find nothing.

**The fix:** Make `isTrackCached()` check BOTH systems. Since IndexedDB cached track IDs are already loaded into `state.cachedTracks` (a Set of track IDs), the simplest fix is:

### Modified file: `www/js/pwa.js`

Update `isTrackCached()` (~line 31):

```javascript
// BEFORE:
export function isTrackCached(track) {
  if (!track || !track.path) return false;
  return cachedTracks.has(getMediaUrl(track.path));
}

// AFTER:
export function isTrackCached(track) {
  if (!track || !track.path) return false;
  // Check SW Cache API (auto-cached on play)
  if (cachedTracks.has(getMediaUrl(track.path))) return true;
  // Check IndexedDB cache (manually synced via offline cache button)
  if (state.cachedTracks && state.cachedTracks.has(track.id)) return true;
  return false;
}
```

This is the minimal fix. The import for `state` already exists in pwa.js.

**Why this works:** `state.cachedTracks` is populated from IndexedDB at startup in `startPlayer()` (player.js line 623-628). The SW cache is populated in `populateCachedTracks()`. By checking both, offline filtering sees all cached tracks regardless of which cache system stored them.

---

## Encryption Flow (detailed)

```
1. User enters: username="alice", password="hunter2"

2. Key derivation:
   PBKDF2(
     password: "hunter2",
     salt: TextEncoder.encode("alice"),    // username IS the salt
     iterations: 100,000,
     hash: SHA-256
   ) → 256-bit AES-GCM CryptoKey

3. Serialize state:
   JSON.stringify({
     favoriteTracks: ["track_001", "track_042"],
     heardTracks: ["track_001", "track_003", ...],
     secretUnlocked: true,
     syncedAt: "2026-03-31T..."
   })

4. Encrypt:
   iv = crypto.getRandomValues(12 bytes)
   ciphertext = AES-GCM.encrypt(key, iv, plaintext_bytes)
   → base64(ciphertext), base64(iv)

5. Write hash:
   write_hash = hex(SHA-256("hunter2" + "alice"))
   → "a1b2c3d4..." (64 hex chars)

6. PUT /sync/alice:
   {
     ciphertext: "base64...",
     iv: "base64...",
     salt: "alice",
     write_hash: "a1b2c3d4..."
   }

7. Server stores at s3://tracks-bucket/sync/alice.json
   Server validates write_hash matches existing (if any)
```

---

## Merge Logic (pseudocode)

```
function merge(local, remote):
  // Favorites: UNION on pull, FULL REPLACE on push
  for id in remote.favoriteTracks:
    local.favoriteTracks.add(id)     // union: add remote favorites locally

  // Heard tracks: UNION (never un-hear a track)
  for id in remote.heardTracks:
    local.heardTracks.add(id)        // union: add remote heard locally

  // Secret unlocked: OR (once unlocked, stays unlocked)
  if remote.secretUnlocked:
    local.secretUnlocked = true

  // After merge, push replaces remote with merged local state
  push(local)   // full replace — merged state becomes source of truth
```

**Edge case: unfavoriting.** If Device A unfavorites track X, then syncs, Device B still has X as favorite. Next sync from B will re-add X. This is intentional (union merge = favorites only grow). To support deletions, you'd need a tombstone/vector clock system. For v1, union-only is the right tradeoff.

---

## CSS Animation Design

All animations use `transform` and `opacity` only (GPU-composited, no layout thrashing).

### 1. Modal slide-in
```css
@keyframes sync-modal-enter {
  from { opacity: 0; transform: translateY(40px) scale(0.95); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
/* Easing: cubic-bezier(0.2, 0.8, 0.2, 1) — overshoots slightly, snappy */
/* Duration: 350ms — fast but perceptible */
```

### 2. Sync spinner (button icon rotation)
```css
@keyframes sync-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
/* Easing: cubic-bezier(0.4, 0, 0.2, 1) — accelerates into rotation */
/* Duration: 800ms — fast enough to feel active, not frantic */
```

### 3. Success confirmation (button flash)
```css
@keyframes sync-success-flash {
  0%   { opacity: 1; transform: scale(1); }
  50%  { opacity: 0.7; transform: scale(1.15); }
  100% { opacity: 1; transform: scale(1); }
}
/* Duration: 400ms — quick pop, similar to existing fav-pop */
/* Plus color transition to green (#4a4), reverts after 1.5s via JS */
```

### 4. Button hover/active feedback
```css
/* Hover: gentle rotation hint */
.state-sync-btn:hover svg { transform: rotate(30deg); }
/* Active: fast snap rotation */
.state-sync-btn:active svg { transform: rotate(180deg); transition-duration: 0.15s; }
```

### 5. Connected indicator (green dot)
```css
/* Small green dot in bottom-right corner of button, no animation — always present when connected */
.state-sync-btn.connected::after {
  content: '';
  position: absolute; bottom: 4px; right: 4px;
  width: 6px; height: 6px; background: #4a4;
}
```

---

## Sync Button Conflict — Analysis & Recommendation

**Analysis of the three options:**

1. **Separate buttons (recommended, matches your preference):** The offline cache button becomes `#offline-cache-btn` with the cloud-download icon (existing). The state sync button becomes `#state-sync-btn` with a two-arrow refresh icon (new). The existing `#sync-btn` ID and all references (`elements.syncBtn`, the event listener in events.js line 682, the `updateSyncUI()` calls in player.js) are renamed to `offlineCacheBtn` / `offline-cache-btn`.

2. **Combined button:** Would save header space but conflates two different operations with different mental models (one is "make audio available offline," the other is "sync my library state to the cloud"). Confusing UX.

3. **Replace:** Offline caching has a real use case (airplane mode), even if the current implementation is buggy. Removing it would lose functionality.

**Recommendation: Option 1 (separate buttons).** The header has room — it currently has: back-btn, search-input, favs-filter-btn, sync-btn. Adding one more button is fine. On mobile the search input can flex to accommodate.

**Migration checklist for existing `#sync-btn` references:**

| File | Location | Current Reference | New Reference |
|------|----------|-------------------|---------------|
| `index.html` | line 152 | `id="sync-btn"` | `id="offline-cache-btn"` |
| `elements.js` | line 69 | `syncBtn: null` | `offlineCacheBtn: null` + `stateSyncBtn: null` |
| `elements.js` | line 137 | `getElementById('sync-btn')` | `getElementById('offline-cache-btn')` |
| `events.js` | line 682 | `elements.syncBtn` | `elements.offlineCacheBtn` |
| `player.js` | line 722-743 | `elements.syncBtn` (in `updateSyncUI`) | `elements.offlineCacheBtn` |
| `ui.js` | line 48-51 | `elements.syncBtn` | `elements.offlineCacheBtn` |
| `main.css` | line 683 | `.search-sync-btn` | keep (shared class), add `.state-sync-btn` |

---

## Integration Sequence (build order)

```
Phase 1 — Foundation (all parallel)
├── T1: terraform apply (Lambda + CloudFront behavior)
├── T2: Write Lambda handler, zip, deploy
├── T3: Write crypto.js + sync.js modules
└── T4: HTML/CSS changes, elements.js updates

Phase 2 — Wiring (after T3 + T4)
├── T5a: events.js — import sync module, wire modal handlers
├── T5b: events.js — rename offline cache button binding
├── T5c: player.js — rename syncBtn → offlineCacheBtn in updateSyncUI
├── T5d: ui.js — update updateModeBasedUI for new buttons
└── T5e: pwa.js — fix isTrackCached() to check both caches

Phase 3 — Test + polish
├── Manual test: login, push, pull on different browser
├── Verify offline playback works after cache bug fix
├── Verify modal animations are smooth
└── Verify sync button shows connected state on reload
```

---

## New Files Summary

| File | Purpose |
|------|---------|
| `www/js/crypto.js` | PBKDF2 key derivation, AES-GCM encrypt/decrypt, SHA-256 write hash |
| `www/js/sync.js` | Push/pull/merge orchestration, credential storage |
| `terraform/lambda-sync.tf` | Lambda function, IAM role, Function URL, CloudFront behavior |
| `terraform/lambda/index.mjs` | Lambda handler — GET/PUT encrypted blobs to S3 |

## Modified Files Summary

| File | Changes |
|------|---------|
| `www/index.html` | Rename sync-btn to offline-cache-btn, add state-sync-btn, add sync-modal |
| `www/main.css` | Add ~120 lines: sync button states, modal styles, keyframes |
| `www/js/elements.js` | Replace `syncBtn` with `offlineCacheBtn` + `stateSyncBtn`, add modal elements |
| `www/js/events.js` | Import sync module, add sync modal handlers, rename cache button binding |
| `www/js/player.js` | Rename `syncBtn` to `offlineCacheBtn` in `updateSyncUI()` |
| `www/js/ui.js` | Update `updateModeBasedUI()` for new button names |
| `www/js/pwa.js` | Fix `isTrackCached()` to check IndexedDB cache too |
| `terraform/cloudfront.tf` | Add Lambda origin + `/sync/*` cache behavior |
| `terraform/outputs.tf` | Add `sync_lambda_url` output |

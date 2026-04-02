# State Sharing + Offline Bug Fix

## Context

Crate stores favorites, heard tracks, and secret-unlocked state in browser localStorage — device-local and lost on clear. The goal is to sync this state across devices using a username + password that derives a client-side encryption key (zero-knowledge — the server never sees plaintext). Additionally, offline listening is broken due to two disconnected cache systems that need unification.

## Architecture

```
Browser                          CloudFront                    Lambda                   S3
  |                                  |                           |                      |
  |-- PUT /sync/{username} --------->|-- /sync/* behavior ------>|-- PutObject --------->|
  |   (encrypted blob + write_hash)  |   (Lambda Function URL)   |   sync/{user}.json   |
  |                                  |                           |                      |
  |-- GET /sync/{username} --------->|-------------------------->|-- GetObject --------->|
  |   (returns ciphertext)           |                           |                      |
```

**Encryption**: `password → PBKDF2(100k iters, username as salt) → AES-256-GCM` via Web Crypto API.  
**Write protection**: `write_hash = SHA-256(password + username)` — stored alongside blob, validated on PUT.  
**Storage**: Existing tracks S3 bucket under `sync/` prefix. No new bucket.  
**Compute**: Single Lambda with Function URL, fronted by CloudFront `/sync/*` behavior. No API Gateway.

## What Syncs

| State | Strategy | Priority |
|-------|----------|----------|
| `favoriteTracks` (Set) | Union merge on pull, full replace on push | Must |
| `heardTracks` (Set) | Union merge (never un-hear) | Should |
| `secretUnlocked` (bool) | OR (once unlocked, stays unlocked) | Must |

## Bug Fix: Offline Listening

**Root cause**: Two disconnected cache systems:
- **Service Worker Cache API** (`audio-v1`) — auto-caches on play, queried by `isTrackCached()` in pwa.js
- **IndexedDB** (`crate_cache`) — populated by manual sync button, queried by `playTrack()` in player.js

`getNextTrack()` and `filterTracks()` call `isTrackCached()` which only checks SW cache. After syncing favorites offline via the button (IndexedDB), going offline shows no playable tracks.

**Fix**: One-line addition to `isTrackCached()` in pwa.js — also check `state.cachedTracks` (IndexedDB track IDs, already loaded at startup).

---

## Tasks (5 units, T1-T4 parallelizable)

### T1: Terraform Infrastructure
**New file**: `terraform/lambda-sync.tf`
- `aws_lambda_function.sync` — nodejs20.x, 128MB, 10s timeout
- `aws_lambda_function_url.sync` — NONE auth, CORS for crate domain
- `aws_iam_role.sync_lambda` — assume role for Lambda service
- `aws_iam_role_policy_attachment` — CloudWatch basic execution
- `aws_iam_role_policy.sync_lambda_s3` — GetObject + PutObject on `tracks-bucket/sync/*`

**Modified**: `terraform/cloudfront.tf`
- Add Lambda Function URL as custom origin (`sync-lambda`)
- Add ordered_cache_behavior for `/sync/*` — allowed methods include PUT, `default_ttl = 0`

**Modified**: `terraform/outputs.tf` — add `sync_lambda_url`

### T2: Lambda Handler
**New file**: `terraform/lambda/index.mjs` (~50 lines)
- GET `/sync/{username}` → read `sync/{username}.json` from S3, return JSON
- PUT `/sync/{username}` → validate `write_hash` against existing (if any), write to S3
- Input validation (no path traversal, required fields check)
- No node_modules needed — AWS SDK v3 built into nodejs20.x

**Build**: `cd terraform/lambda && zip sync.zip index.mjs`

### T3: Client Crypto + Sync Module
**New file**: `www/js/crypto.js`
- `deriveKey(password, username)` — PBKDF2 → AES-GCM CryptoKey
- `encrypt(key, plaintext)` → `{ciphertext, iv}` (base64)
- `decrypt(key, ciphertextB64, ivB64)` → plaintext string
- `generateWriteHash(password, username)` → hex SHA-256

**New file**: `www/js/sync.js`
- `serializeState()` — JSON of favorites + heard + secretUnlocked
- `mergeState(remote)` — union merge favorites/heard, OR secretUnlocked
- `pullState(username, password)` — GET, decrypt, merge
- `pushState(username, password)` — encrypt, PUT with write_hash
- `fullSync(username, password)` — pull then push
- `saveSyncUsername()` / `getSyncUsername()` / `clearSyncCredentials()` — localStorage

### T4: UI — HTML, CSS, Animations
**Modified**: `www/index.html`
- Rename `#sync-btn` → `#offline-cache-btn` (existing cloud-download icon)
- Add `#state-sync-btn` (two-arrow refresh icon, SVG) in search-header, rightmost position
- Add `#sync-modal` after info-modal: form with username/password, status indicator, disconnect button

**Modified**: `www/main.css` (~120 new lines)

Sync button states:
- `.state-sync-btn` — hover: `rotate(30deg)`, active: `rotate(180deg) 0.15s`
- `.state-sync-btn.syncing` — `sync-spin` 0.8s `cubic-bezier(0.4, 0, 0.2, 1)` infinite
- `.state-sync-btn.connected::after` — 6px green dot, bottom-right
- `.state-sync-btn.sync-success` — green border/color flash
- `.state-sync-btn.sync-error` — red border/color flash

Modal:
- `.sync-modal-content` — `sync-modal-enter` 0.35s `cubic-bezier(0.2, 0.8, 0.2, 1)` (slide up + scale)
- `sync-backdrop-in` — 0.25s `ease-out` fade
- Inputs: transparent bg, `1px solid --muted`, focus → `--fg` border, `Bebas Neue` font
- Submit button: `2px solid --fg`, hover inverts, active `scale(0.97)`
- **No border-radius anywhere** — brutalist aesthetic maintained

Keyframes:
- `sync-spin` — `rotate(0→360deg)`, `cubic-bezier(0.4, 0, 0.2, 1)` 0.8s
- `sync-modal-enter` — `translateY(40px) scale(0.95) → translateY(0) scale(1)`, 0.35s
- `sync-success-flash` — `scale(1→1.15→1)`, 0.4s
- `sync-backdrop-in` — `opacity 0→1`, 0.25s

All animations: `transform` + `opacity` only (GPU composited, no layout thrash).

**Modified**: `www/js/elements.js`
- Replace `syncBtn` → `offlineCacheBtn`, add `stateSyncBtn`
- Add modal element refs: `syncModal`, `syncForm`, `syncUsername`, `syncPassword`, `syncError`, `syncSubmit`, `syncStatus`, `syncLogout`, `syncModalClose`

### T5: Wiring + Offline Bug Fix (depends on T3, T4)

**Modified**: `www/js/events.js`
- Import sync module
- Rename `syncBtn` → `offlineCacheBtn` event binding
- Add `stateSyncBtn` click → `openSyncModal()`
- Add `setupSyncModalHandlers()` — form submit, backdrop close, disconnect
- Form submit: call `fullSync()`, update button states (syncing/success/error), auto-close on success after 1.2s, refresh track list + mode UI on secret unlock

**Modified**: `www/js/player.js`
- Rename all `elements.syncBtn` → `elements.offlineCacheBtn` in `updateSyncUI()`

**Modified**: `www/js/ui.js`
- `updateModeBasedUI()`: `offlineCacheBtn` hidden unless secret, `stateSyncBtn` always visible

**Modified**: `www/js/pwa.js` — offline bug fix
```javascript
// BEFORE:
export function isTrackCached(track) {
  if (\!track || \!track.path) return false;
  return cachedTracks.has(getMediaUrl(track.path));
}

// AFTER:
export function isTrackCached(track) {
  if (\!track || \!track.path) return false;
  if (cachedTracks.has(getMediaUrl(track.path))) return true;
  if (state.cachedTracks && state.cachedTracks.has(track.id)) return true;
  return false;
}
```

---

## File Summary

### New Files (4)
| File | Purpose |
|------|---------|
| `www/js/crypto.js` | PBKDF2 key derivation, AES-GCM encrypt/decrypt, SHA-256 write hash |
| `www/js/sync.js` | Push/pull/merge orchestration, credential storage |
| `terraform/lambda-sync.tf` | Lambda, IAM, Function URL, CloudFront behavior |
| `terraform/lambda/index.mjs` | Lambda handler — GET/PUT encrypted blobs to S3 |

### Modified Files (8)
| File | Changes |
|------|---------|
| `www/index.html` | Rename sync-btn → offline-cache-btn, add state-sync-btn + sync-modal |
| `www/main.css` | ~120 lines: sync button states, modal styles, 4 keyframe animations |
| `www/js/elements.js` | Replace syncBtn, add stateSyncBtn + modal element refs |
| `www/js/events.js` | Import sync, wire modal handlers, rename cache button binding |
| `www/js/player.js` | Rename syncBtn → offlineCacheBtn in updateSyncUI() |
| `www/js/ui.js` | Update updateModeBasedUI() for new button names |
| `www/js/pwa.js` | Fix isTrackCached() to check both cache systems |
| `terraform/cloudfront.tf` | Add Lambda origin + /sync/* behavior |

---

## Verification

1. **Terraform**: `terraform plan` shows expected resources (Lambda, IAM role, CloudFront behavior)
2. **Lambda**: Deploy zip, test with curl — `PUT /sync/testuser` then `GET /sync/testuser`
3. **Encryption roundtrip**: In browser console, verify encrypt→decrypt with same key returns original
4. **Sync flow**: Open app on two browsers, login with same creds, favorite tracks on A, sync on B → favorites appear
5. **Write protection**: Try PUT with wrong write_hash → 403
6. **Wrong password**: Try pull with wrong password → decryption fails with clear error message
7. **Offline bug fix**: Sync favorites cache, go offline (DevTools), verify tracks still appear and auto-advance works
8. **Animations**: Modal slides up smoothly, spinner rotates during sync, green dot appears after connect
9. **Secret unlock sync**: Unlock secret on device A, sync, login on device B → secret mode activates
10. **No regression**: Existing offline cache button still works, favorites toggle still works, Konami still works

---

## Credential Storage Decision

**Store both username + password in localStorage.** No checkbox, no re-entry friction. On app load, if credentials exist → auto-pull + merge silently. KISS.

In `sync.js`:
- `saveSyncCredentials(username, password)` — stores both
- `getSyncCredentials()` → `{username, password}` or null
- On app init: if credentials exist, `pullState()` silently in background
- On favorite toggle / heard track: debounced `pushState()` (~2s)

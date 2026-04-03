# Profile Screen + Stats Dashboard + Debug-in-UI Principle

## Context

The sync button (↻) is an implementation detail masquerading as a feature. Users don't think in terms of "sync" — they think in terms of "me" and "my stuff." The sync button should become a **profile screen** — a personal dashboard showing listening stats, sync health, and (during development) debug information. 

Additionally, this work introduces a **debug-in-UI** design principle: during UI development, render debug state visually in the page itself (not just console.log), organized for easy removal when the feature is stable.

---

## Profile Screen — What It Shows

### Identity
- **Username** (large, top, `Bebas Neue`) — from `getSyncCredentials().username`
- No profile pic, no avatar — just the name

### Stats (computed from state + new tracking fields)
| Stat | Source | New? |
|------|--------|------|
| Tracks heard | `state.heardTracks.size` | No |
| Catalog % | `heardTracks.size / tracks.length` | No |
| Favorites count | `state.favoriteTracks.size` | No |
| Total listen time | **New**: `state.totalListenSeconds` | Yes |
| Last played | **New**: `state.lastPlayedAt` | Yes |
| Total unique tracks (non-resetting) | **New**: `state.totalUniqueHeard` | Yes |

### Sync Status
- **Status indicator**: Connected / Disconnected / Error
- **Last synced**: timestamp from `syncedAt` (already in serialized state)
- **Sync problems**: clear text explaining issues ("Wrong password", "Server unreachable", etc.)
- **Remediation**: actionable text ("Tap to retry", "Re-enter credentials", "Check network")
- **Manual sync button**: force push/pull from this screen
- **Disconnect button**: clear credentials, return to "new user" state

### Debug Panel (development only, organized for removal)
- All debug items wrapped in a single `<div id="profile-debug" class="profile-debug">`
- Easy to hide with one CSS rule or remove the entire div
- Shows: raw sync credentials status, localStorage keys/sizes, SW cache state, last push/pull result, network state, service worker registration status

---

## New Data Tracking

### State additions (`www/js/state.js`)
```js
totalListenSeconds: 0,    // cumulative, never resets
totalUniqueHeard: 0,      // cumulative, never resets (heardTracks resets on full cycle)
lastPlayedAt: null,       // ISO timestamp
lastSyncResult: null,     // { status, error?, timestamp }
```

### Storage additions (`www/js/storage.js`)
- `saveListenStats()` / `loadListenStats()` — persists `totalListenSeconds`, `totalUniqueHeard`, `lastPlayedAt`

### Sync additions (`www/js/sync.js`)
- `serializeState()` — include `totalListenSeconds`, `totalUniqueHeard`, `lastPlayedAt`
- `mergeState()` — take `max()` for counters, most-recent for timestamps

### Player instrumentation (`www/js/player.js`)
- `playTrack()`: set `state.lastPlayedAt = new Date().toISOString()`, record `state._playStartTime = Date.now()`
- `handleTrackEnded()`: add elapsed seconds to `state.totalListenSeconds`, save
- `handlePlayPause()`: on pause, add elapsed since `_playStartTime`; on play, reset `_playStartTime`
- `markTrackHeard()` (in `tracks.js`): increment `state.totalUniqueHeard` only when ID is genuinely new

---

## Tasks (5 units, T1-T3 parallelizable)

### T1: Stats Tracking Infrastructure
**Modified files**: `state.js`, `storage.js`, `sync.js`, `config.js`

- Add 4 new state fields
- Add `saveListenStats()` / `loadListenStats()` to storage
- Add new config keys for localStorage
- Extend `serializeState()` and `mergeState()` in sync.js
- Merge strategy: `max()` for counters, most-recent for timestamps

### T2: Player Instrumentation
**Modified files**: `player.js`, `tracks.js`

- Track play start time in `playTrack()`
- Accumulate listen seconds in `handleTrackEnded()` and pause handler
- Set `lastPlayedAt` on each play
- Increment `totalUniqueHeard` in `markTrackHeard()` (only for new IDs)
- Call `saveListenStats()` after mutations

### T3: Profile Screen HTML + CSS
**Modified files**: `index.html`, `main.css`

HTML structure:
```html
<div id="profile-screen" class="screen">
  <div class="profile-container">
    <button id="profile-back-btn" class="profile-back-btn" aria-label="Back">
      <svg><\!-- back arrow --></svg>
    </button>
    
    <h2 id="profile-username" class="profile-username">---</h2>
    
    <div class="profile-stats">
      <div class="stat-row">
        <span class="stat-label">LISTENED</span>
        <span id="profile-listen-time" class="stat-value">0h 0m</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">TRACKS HEARD</span>
        <span id="profile-heard" class="stat-value">0 / 0</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">FAVORITES</span>
        <span id="profile-favs" class="stat-value">0</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">LAST PLAYED</span>
        <span id="profile-last-played" class="stat-value">---</span>
      </div>
    </div>
    
    <div class="profile-sync">
      <div class="sync-status-row">
        <span class="sync-status-dot" id="profile-sync-dot"></span>
        <span id="profile-sync-status">Not connected</span>
      </div>
      <span id="profile-sync-detail" class="sync-detail"></span>
      <div class="profile-sync-actions">
        <button id="profile-sync-btn" class="profile-action-btn">SYNC NOW</button>
        <button id="profile-disconnect-btn" class="profile-action-btn danger">DISCONNECT</button>
      </div>
    </div>
    
    <\!-- DEBUG: Remove before release -->
    <div id="profile-debug" class="profile-debug">
      <h3 class="debug-heading">DEBUG</h3>
      <pre id="debug-output" class="debug-output"></pre>
    </div>
  </div>
</div>
```

CSS:
- Brutalist: no border-radius, monospace for values, `Bebas Neue` for labels
- `.profile-container` — `max-width: 400px`, centered, `padding-top: 80px`
- `.stat-row` — flex between label and value, `border-bottom: 1px solid var(--muted)`
- `.sync-status-dot` — 8px circle, green/red/yellow based on class
- `.profile-debug` — `border: 1px dashed var(--muted)`, `font-size: 11px`, monospace, slightly dimmed
- All `.profile-debug` items use a `[data-debug]` attribute for easy querySelectorAll removal

### T4: Profile Screen Wiring
**Modified files**: `elements.js`, `events.js`, `state.js`, `ui.js`, `sw.js`

- Add `SCREENS.PROFILE` and `SCREEN_ID_MAP['profile-screen']`
- Add element refs: `profileScreen`, `profileBackBtn`, `profileUsername`, stat elements, sync elements, debug output
- Replace sync button click handler: now opens profile screen instead of prompting
- `showScreen('profile-screen')` → populate stats, sync status, debug info
- Profile back button → `showScreen('player-screen')`
- Profile sync button → force `fullSync()` with visual feedback
- Profile disconnect → `clearSyncCredentials()`, update UI, show "enter creds" state
- Title logo: add `'profile-screen'` to the `at-top` condition in `ui.js:98`
- Bump SW shell cache to `shell-v3`

### T5: Enter Screen Personalization
**Modified files**: `index.html`, `elements.js`, `events.js`, `main.css`

- Add `#enter-greeting` and `#enter-username-display` elements (hidden by default)
- Add `#enter-creds` form (username + password inputs, hidden by default)
- In `init()`: if creds exist → show "WELCOME BACK" + username, button = "ENTER"
- In `init()`: if no creds → show credential inputs, button = "CONNECT"
- On CONNECT click: save creds, kick off non-blocking `fullSync()`, enter player
- On ENTER click (returning user): proceed as normal (auto-pull already fired)

### T6: GitHub Issues
1. **Account recovery** — zero-knowledge means no server-side recovery. Options to explore: recovery codes, local export/import, "just create new account"
2. **PDS ethos: Debug-in-UI** — design principle for rendering debug state visually during development, organized for removal

### T7: Debug-in-UI Skill
**New file**: `.claude/skills/debug-in-ui.md`

Principle: When building UI features, render relevant debug state in the page itself — not just `console.log`. Rules:
- Wrap all debug elements in a single container with a predictable ID pattern (`#*-debug`)
- Use `data-debug` attributes on individual items
- Use `class="debug-*"` for styling (dashed borders, monospace, dimmed)
- CSS: `.debug-*` styles grouped in one block with `/* DEBUG STYLES — REMOVE */` comment
- JS: debug population logic in clearly marked functions (`populateDebugInfo()`)
- Removal checklist: delete HTML container, delete CSS block, delete JS function, grep for `debug` to verify clean

---

## Files Summary

### New Files
| File | Purpose |
|------|---------|
| `.claude/skills/debug-in-ui.md` | Design principle skill for visual debug during UI dev |

### Modified Files
| File | Changes |
|------|---------|
| `www/index.html` | Profile screen HTML, enter screen greeting + creds form |
| `www/main.css` | ~100 lines: profile layout, stat rows, sync status, debug panel, enter creds |
| `www/js/state.js` | Add `SCREENS.PROFILE`, 4 new tracking fields |
| `www/js/storage.js` | `saveListenStats()` / `loadListenStats()` |
| `www/js/sync.js` | Extend serialize/merge with new stats fields |
| `www/js/config.js` | New localStorage key for listen stats |
| `www/js/player.js` | Listen time tracking, lastPlayedAt, play start time |
| `www/js/tracks.js` | `totalUniqueHeard` increment in markTrackHeard |
| `www/js/elements.js` | ~15 new element refs (profile + enter screen) |
| `www/js/events.js` | Profile screen navigation, enter flow personalization, sync → profile redirect |
| `www/js/ui.js` | Add profile to SCREEN_ID_MAP, title logo handling |
| `www/sw.js` | Bump to shell-v3 (no new JS module needed — profile logic lives in events.js) |

---

## Verification

1. **New user**: Clear localStorage → see username/password inputs + "CONNECT"
2. **Connect**: Fill creds, click CONNECT → creds saved, player starts, background sync
3. **Returning user**: Reload → "WELCOME BACK" + username, "ENTER" button
4. **Profile screen**: Tap sync/profile icon → see name, stats, sync status
5. **Stats update**: Play tracks → listen time increments, heard count grows, last played updates
6. **Stats persist**: Reload → stats survive (localStorage)
7. **Stats sync**: Sync from device A → pull on device B → stats merge (max counters)
8. **Sync status**: Profile shows green dot when connected, error details on failure
9. **Force sync**: Tap "SYNC NOW" on profile → spinner → success/error feedback
10. **Disconnect**: Tap disconnect → creds cleared, next reload shows new user state
11. **Debug panel**: Visible during dev, shows localStorage state, SW status, sync result
12. **Debug removal**: Delete `#profile-debug` div + CSS block + JS function → clean removal
13. **Konami**: Still works on enter screen (inputs don't capture arrow keys)

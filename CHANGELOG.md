# Changelog

## [1.3.0] - 2026-04-03

### Added
- Smoke background: layered animated radial gradients with CSS custom properties, `prefers-reduced-motion` support
- Dante's Circles: 9 unlockable smoke color themes tied to unique tracks heard (0–100 milestones)
- Circle progress on profile screen: 9 dot marks, tappable to switch between unlocked themes
- Generative artwork: canvas-based animated placeholder for tracks without cover art, unique per track
- Cash rain depth: 150 bills across 5 parallax size tiers with weighted distribution
- Inline credential form on profile screen for sync opt-in (replaces prompt-based flow)
- Theme config: `site.md` frontmatter supports `theme.circles` for per-instance color overrides
- Circle state syncs across devices (highest circle wins on merge)

### Changed
- Enter screen stripped to just ENTER button — no credential inputs, no greeting
- Profile screen: unconnected users see stats + credential form; connected users see stats + sync status + circle progress
- Artwork long-press download and click-to-search gestures bind to container (works with both real artwork and generated art)
- Service worker bumped to shell-v4 with circles.js, genart.js, and bill images

## [1.2.0] - 2026-04-02

### Added
- Profile screen with stats dashboard (listen time, tracks heard, favorites, last played)
- Enter screen personalization: returning users see "WELCOME BACK", new users see credential inputs
- Listen stats tracking: cumulative time, unique tracks, last played timestamp
- Stats sync across devices using max() merge strategy
- Debug-in-UI skill for visual debug panels during development
- Sync status with remediation on profile screen (connected/error/disconnect)

### Changed
- Sync button replaced with profile icon (person silhouette) in player bar
- Profile screen is the new home for sync controls and status

## [1.1.0] - 2026-03-31

### Added
- Cross-device state sync with zero-knowledge encryption (PBKDF2 + AES-256-GCM)
- Lambda sync endpoint with S3 storage (`/sync/*` via CloudFront)
- Client-side crypto module (Web Crypto API) for key derivation, encrypt/decrypt
- Sync button in player secondary controls (always visible, prompt-based auth)
- Auto-pull on app load when credentials exist; debounced push on state changes
- Play history persistence and sync across devices
- Terraform infrastructure for sync Lambda, IAM, and CloudFront behavior

### Fixed
- Offline listening broken: unified SW Cache API and IndexedDB cache checks in `isTrackCached()`

## [0.1.0] - 2026-02-14T01:12:36+00:00

### Added
- Deploy to crate.rmzi.world with full AWS infrastructure (S3, CloudFront, Route53, signed cookies)
- Offline favorites caching via IndexedDB with sync button
- Favorites and favorites browsing in regular (non-secret) mode
- App entry point (main.js) for module initialization
- Cropped and centered PWA icons from crate logo
- Logo in README

### Changed
- Update info modal with F.A.T. Lab / Crate philosophy narrative
- Configure site for crate.rmzi.world
- Relax PDS permission rules to allow production deployment commands

### Fixed
- Fix Python 3.12+ global syntax error in upload.py
- Remove duplicate favorites navigation button from player controls
- Center logo by cropping to bounding box with padding

# Changelog

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

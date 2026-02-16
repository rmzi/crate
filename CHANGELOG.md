# Changelog

## [0.2.0] - 2026-02-15T20:41:35-05:00

### Added
- Metadata enrichment pipeline via MusicBrainz, Cover Art Archive, and iTunes Search API
- Single entrypoint `pipeline.sh` for extract, upload, enrich, and publish steps
- Confidence-based matching with auto-accept, review, and skip thresholds
- Resume and dry-run support for idempotent re-runs
- Publish step uploads artwork to S3 and pushes enriched manifest
- Generative CSS gradient backgrounds for tracks without album artwork
- Archivist agent and enrich skill for future curation workflows

### Changed
- `batch_upload.py` accepts enriched metadata format with `--enriched` flag

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

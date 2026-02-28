# Enrich — Metadata Enrichment Pipeline

## When to Use

- After adding new music to the library
- When tracks have incomplete or incorrect metadata
- To fetch album art for tracks missing artwork
- Periodically to re-enrich with improved matching

## Pipeline

```
./tools/pipeline.sh [/path/to/new/music]
```

That single command handles everything:

```
[extract] → [upload] → [enrich] → [publish]
```

| Step | What it does | When it runs |
|------|-------------|--------------|
| Extract | Scans audio files for ID3/Vorbis tags | Only with a path argument |
| Upload | Uploads new audio to S3 | Only with a path argument |
| Enrich | Queries MusicBrainz + Cover Art Archive | Always |
| Publish | Uploads artwork to S3, pushes manifest | Always (unless `--skip-publish`) |

## Common Usage

```bash
# Re-enrich entire library (idempotent — skips already-processed tracks)
./tools/pipeline.sh

# Add new music and enrich everything
./tools/pipeline.sh /path/to/new/tracks

# Preview what enrichment would do (writes dry_run_report.json)
./tools/pipeline.sh --dry-run

# Apply a previous dry run (reads cached results, no re-querying)
./tools/pipeline.sh

# Re-process everything from scratch
./tools/pipeline.sh --no-resume

# Limit to first N tracks (useful for testing)
./tools/pipeline.sh --limit 10
```

## Options

| Flag | Effect |
|------|--------|
| `--dry-run` | Preview matches, write `dry_run_report.json`, don't modify anything |
| `--skip-publish` | Enrich locally but don't push to S3 |
| `--skip-upload` | Skip uploading new audio files |
| `--skip-artwork` | Skip album art fetching |
| `--no-resume` | Re-process all tracks from scratch |
| `--limit N` | Only process first N tracks |

## How It Works

### Matching
1. Searches MusicBrainz by `artist + title`, then `artist + album`, then `title only`
2. Scores candidates (0.0–1.0) using weighted field similarity
3. Thresholds: **>= 0.85** auto-accept, **0.50–0.85** flag for review, **< 0.50** skip

### Dry-Run → Real Run
- `--dry-run` saves all match results to `dry_run_report.json`
- A subsequent real run loads cached results — zero API re-queries
- After applying, the report is deleted

### Resume
- `.enrichment_state.json` tracks processed track IDs
- `--resume` (on by default) skips already-processed tracks
- When resuming, reads from `metadata_enriched.json` to preserve prior work

## Output Files

| File | Purpose |
|------|---------|
| `metadata/metadata_enriched.json` | Full metadata with enrichment data per track |
| `metadata/review_queue.json` | Tracks needing human review |
| `metadata/dry_run_report.json` | Dry-run results (consumed by next real run) |
| `metadata/.enrichment_state.json` | Resume checkpoint |
| `metadata/manifest_enriched.json` | Clean manifest built during publish |
| `metadata/artwork/*_enriched.jpg` | Downloaded album art |

## Review Queue

Tracks are flagged for review when:
- Match confidence is between 0.50 and 0.85
- Multiple sources disagree with existing tags (`likely_correction`)
- Multiple high-confidence candidates disagree with each other
- Album art upgrade available when existing art is present
- Track has neither artist nor title

Use the **archivist agent** to walk through flagged tracks interactively.

## Conflict Classifications

| Classification | Meaning | Action |
|---------------|---------|--------|
| `confirmed` | External data matches existing | No change |
| `supplement` | Empty field filled | Auto-filled |
| `likely_correction` | Multiple sources disagree with tag | Flagged |
| `alternative` | One source offers different value | Noted, kept existing |

## Individual Scripts

For fine-grained control, run scripts directly:

```bash
# Enrich only
python tools/enrich_metadata.py --input metadata/manifest.json --output metadata/ --resume

# Publish only (after manual edits to metadata_enriched.json)
python tools/publish_manifest.py --metadata-dir metadata/

# Extract only
python tools/extract_metadata.py /path/to/audio --output metadata/
```

## Rate Limits

- MusicBrainz: 1 req/sec (enforced)
- Cover Art Archive: 1 req/sec (enforced)
- Full run: ~2-3 seconds per track
- 118 tracks ≈ 4-6 minutes

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "MusicBrainz API is unreachable" | Check internet; falls back to offline mode |
| Many "no match" results | Tracks may have poor/missing metadata |
| Interrupted mid-run | Just re-run — `--resume` is default |
| Want to re-process one track | Remove its ID from `.enrichment_state.json` |
| Artwork not showing in app | Check CloudFront invalidation completed |

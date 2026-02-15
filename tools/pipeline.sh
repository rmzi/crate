#!/usr/bin/env bash
set -euo pipefail

# Crate Music Pipeline
#
# Single entrypoint for the full metadata pipeline:
#   extract → upload → enrich → publish
#
# Usage:
#   ./tools/pipeline.sh /path/to/new/music     # Ingest new files, enrich, publish
#   ./tools/pipeline.sh                         # Re-enrich + publish existing library
#   ./tools/pipeline.sh --dry-run               # Preview without changes

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
METADATA_DIR="${METADATA_DIR:-$PROJECT_DIR/metadata}"
export AWS_PROFILE="${AWS_PROFILE:-personal}"
export TRACKS_BUCKET="${TRACKS_BUCKET:-crate-tracks.rmzi.world}"

# --- Defaults ---
DRY_RUN=false
SKIP_UPLOAD=false
SKIP_ARTWORK=false
SKIP_PUBLISH=false
RESUME=true  # Always resume by default (idempotent)
LIMIT=0
INPUT_DIR=""

# --- Parse args ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)        DRY_RUN=true; shift ;;
        --skip-upload)    SKIP_UPLOAD=true; shift ;;
        --skip-artwork)   SKIP_ARTWORK=true; shift ;;
        --skip-publish)   SKIP_PUBLISH=true; shift ;;
        --no-resume)      RESUME=false; shift ;;
        --limit)          LIMIT="$2"; shift 2 ;;
        --help|-h)
            echo "Usage: $(basename "$0") [OPTIONS] [/path/to/new/music]"
            echo ""
            echo "With a path:    extract → upload → enrich → publish to S3"
            echo "Without a path: re-enrich existing library → publish to S3"
            echo ""
            echo "Options:"
            echo "  --dry-run       Preview all steps without writing or uploading"
            echo "  --skip-upload   Skip uploading new audio files to S3"
            echo "  --skip-publish  Enrich only, don't publish manifest to S3"
            echo "  --skip-artwork  Skip album art fetching during enrichment"
            echo "  --no-resume     Re-process all tracks (ignore previous state)"
            echo "  --limit N       Limit enrichment to N tracks"
            echo "  -h, --help      Show this help"
            echo ""
            echo "Environment:"
            echo "  METADATA_DIR    Override metadata directory (default: ./metadata)"
            echo "  TRACKS_BUCKET   S3 bucket (default: crate-tracks.rmzi.world)"
            echo "  AWS_PROFILE     AWS profile (default: personal)"
            exit 0
            ;;
        -*)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
        *)
            INPUT_DIR="$1"; shift ;;
    esac
done

mkdir -p "$METADATA_DIR"

echo "=== Crate Pipeline ==="
echo "  Metadata dir: $METADATA_DIR"
[[ -n "$INPUT_DIR" ]] && echo "  Input dir:    $INPUT_DIR"
echo "  Dry run:      $DRY_RUN"
echo ""

# --- Step 1: Extract (only if new music provided) ---
if [[ -n "$INPUT_DIR" ]]; then
    if [[ ! -d "$INPUT_DIR" ]]; then
        echo "Error: $INPUT_DIR is not a directory" >&2
        exit 1
    fi

    echo "--- Step 1: Extract metadata ---"
    python3 "$SCRIPT_DIR/extract_metadata.py" "$INPUT_DIR" --output "$METADATA_DIR" --resume
    echo ""

    # --- Step 2: Upload new tracks to S3 ---
    if [[ "$SKIP_UPLOAD" == false && "$DRY_RUN" == false ]]; then
        echo "--- Step 2: Upload new tracks to S3 ---"
        python3 "$SCRIPT_DIR/batch_upload.py" --metadata-dir "$METADATA_DIR"
        echo ""
    else
        echo "--- Step 2: Upload (skipped) ---"
        echo ""
    fi
else
    echo "--- No input directory — skipping extract and upload ---"
    echo ""
fi

# --- Step 3: Enrich entire library ---
# Find the best available metadata source
ENRICH_INPUT=""
if [[ -f "$METADATA_DIR/metadata_base.json" ]]; then
    ENRICH_INPUT="$METADATA_DIR/metadata_base.json"
elif [[ -f "$METADATA_DIR/manifest.json" ]]; then
    ENRICH_INPUT="$METADATA_DIR/manifest.json"
else
    echo "No local metadata found — pulling manifest.json from S3..."
    if aws s3 cp "s3://${TRACKS_BUCKET}/manifest.json" "$METADATA_DIR/manifest.json" 2>/dev/null; then
        ENRICH_INPUT="$METADATA_DIR/manifest.json"
        TRACK_COUNT=$(python3 -c "import json; print(len(json.load(open('$METADATA_DIR/manifest.json')).get('tracks', [])))" 2>/dev/null || echo '?')
        echo "  Downloaded manifest.json ($TRACK_COUNT tracks)"
    else
        echo "No metadata found locally or in S3. Run extract_metadata.py first."
        exit 1
    fi
fi
echo ""

echo "--- Step 3: Enrich metadata (entire library) ---"
echo "  Input: $ENRICH_INPUT"
ENRICH_ARGS=(--input "$ENRICH_INPUT" --output "$METADATA_DIR")

[[ "$DRY_RUN" == true ]]      && ENRICH_ARGS+=(--dry-run)
[[ "$RESUME" == true ]]        && ENRICH_ARGS+=(--resume)
[[ "$SKIP_ARTWORK" == true ]]  && ENRICH_ARGS+=(--skip-artwork)
[[ "$LIMIT" -gt 0 ]]          && ENRICH_ARGS+=(--limit "$LIMIT")

python3 "$SCRIPT_DIR/enrich_metadata.py" "${ENRICH_ARGS[@]}"
echo ""

# --- Step 4: Publish to S3 ---
if [[ "$SKIP_PUBLISH" == false && -f "$METADATA_DIR/metadata_enriched.json" ]]; then
    echo "--- Step 4: Publish enriched metadata to S3 ---"
    PUBLISH_ARGS=(--metadata-dir "$METADATA_DIR")
    [[ "$DRY_RUN" == true ]] && PUBLISH_ARGS+=(--dry-run)

    python3 "$SCRIPT_DIR/publish_manifest.py" "${PUBLISH_ARGS[@]}"
    echo ""
elif [[ "$DRY_RUN" == true && -f "$METADATA_DIR/dry_run_report.json" ]]; then
    echo "--- Step 4: Publish (skipped — dry run, no enriched file) ---"
    echo ""
else
    echo "--- Step 4: Publish (skipped) ---"
    echo ""
fi

# --- Summary ---
echo "=== Pipeline complete ==="
echo ""
echo "Files:"
for f in metadata_base.json manifest.json metadata_enriched.json manifest_enriched.json dry_run_report.json review_queue.json; do
    [[ -f "$METADATA_DIR/$f" ]] && echo "  $METADATA_DIR/$f"
done
echo ""

if [[ -f "$METADATA_DIR/review_queue.json" ]]; then
    REVIEW_COUNT=$(python3 -c "import json; print(len(json.load(open('$METADATA_DIR/review_queue.json')).get('items', [])))" 2>/dev/null || echo "?")
    echo "$REVIEW_COUNT tracks flagged for review."
    echo "  Inspect: cat metadata/review_queue.json | python3 -m json.tool"
    echo "  Or run the archivist agent to review interactively."
    echo ""
fi

echo "To re-run: ./tools/pipeline.sh"

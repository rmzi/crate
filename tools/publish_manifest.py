#!/usr/bin/env python3
"""
Publish enriched metadata to S3.

Reads metadata_enriched.json, uploads new artwork to S3,
builds a clean manifest.json, and pushes it to the tracks bucket.

Usage:
  python tools/publish_manifest.py --metadata-dir metadata/
  python tools/publish_manifest.py --metadata-dir metadata/ --dry-run
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

AWS_PROFILE = os.environ.get('AWS_PROFILE', 'personal')
TRACKS_BUCKET = os.environ.get('TRACKS_BUCKET', 'crate-tracks.rmzi.world')


def get_s3_client():
    session = boto3.Session(profile_name=AWS_PROFILE)
    return session.client('s3')


def upload_file(s3_client, local_path: Path, s3_key: str, content_type: str) -> bool:
    try:
        s3_client.upload_file(
            str(local_path), TRACKS_BUCKET, s3_key,
            ExtraArgs={'ContentType': content_type},
        )
        return True
    except ClientError as e:
        print(f"  Error uploading {local_path.name}: {e}", file=sys.stderr)
        return False


def load_enriched(metadata_dir: Path) -> dict:
    """Load enriched metadata, falling back to manifest.json."""
    enriched = metadata_dir / 'metadata_enriched.json'
    if enriched.exists():
        with open(enriched) as f:
            return json.load(f)
    manifest = metadata_dir / 'manifest.json'
    if manifest.exists():
        with open(manifest) as f:
            return json.load(f)
    raise FileNotFoundError(f"No metadata_enriched.json or manifest.json in {metadata_dir}")


def normalize_tracks(data: dict) -> list:
    """Return tracks as a list regardless of input format."""
    tracks = data.get('tracks', [])
    if isinstance(tracks, dict):
        return list(tracks.values())
    return tracks


def build_manifest(tracks: list) -> dict:
    """Build a clean manifest.json from enriched tracks."""
    clean_tracks = []
    for track in tracks:
        clean = {
            'id': track['id'],
            'path': track.get('path') or track.get('s3_path', ''),
            'artist': track.get('artist'),
            'album': track.get('album'),
            'title': track.get('title'),
            'year': track.get('year'),
            'duration': track.get('duration'),
            'artwork': track.get('artwork'),
            'tagged': track.get('tagged', False),
            'original_filename': track.get('original_filename', ''),
            'uploaded': track.get('uploaded', True),
        }
        # Include genre if present (enrichment may have added it)
        if track.get('genre'):
            clean['genre'] = track['genre']
        clean_tracks.append(clean)

    return {
        'version': 1,
        'generated': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'tracks': clean_tracks,
    }


def main():
    parser = argparse.ArgumentParser(description='Publish enriched metadata to S3')
    parser.add_argument(
        '--metadata-dir', type=Path, required=True,
        help='Directory containing metadata_enriched.json and artwork/',
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help='Show what would be uploaded without actually uploading',
    )
    args = parser.parse_args()

    # Load enriched data
    print(f"Loading enriched metadata from {args.metadata_dir}...")
    data = load_enriched(args.metadata_dir)
    tracks = normalize_tracks(data)
    print(f"Found {len(tracks)} tracks")

    artwork_dir = args.metadata_dir / 'artwork'
    artwork_uploaded = 0
    artwork_skipped = 0

    if not args.dry_run:
        s3_client = get_s3_client()
    else:
        s3_client = None

    # Step 1: Upload enriched artwork to S3 and update track references
    print("\n--- Uploading enriched artwork ---")
    for track in tracks:
        artwork_path = track.get('artwork_path', '')

        # Check if this is a local enriched artwork file
        if not artwork_path or not artwork_path.endswith(('.jpg', '.jpeg', '.png')):
            continue

        local_path = Path(artwork_path)
        if not local_path.exists():
            # Maybe it's already an S3 path
            continue

        # This is a local file — upload it
        s3_key = f"artwork/{local_path.name}"
        content_type = 'image/jpeg' if local_path.suffix in ('.jpg', '.jpeg') else 'image/png'

        if args.dry_run:
            print(f"  Would upload: {local_path.name} -> s3://{TRACKS_BUCKET}/{s3_key}")
            track['artwork'] = s3_key
            artwork_uploaded += 1
        else:
            if upload_file(s3_client, local_path, s3_key, content_type):
                print(f"  Uploaded: {local_path.name} -> {s3_key}")
                track['artwork'] = s3_key
                artwork_uploaded += 1
            else:
                artwork_skipped += 1

    # Step 2: Ensure existing artwork references are preserved
    for track in tracks:
        # If track already had artwork from a previous upload (s3_artwork_path)
        if not track.get('artwork') and track.get('s3_artwork_path'):
            track['artwork'] = track['s3_artwork_path']

    print(f"  Artwork uploaded: {artwork_uploaded}, skipped: {artwork_skipped}")

    # Step 3: Build clean manifest
    print("\n--- Building manifest ---")
    manifest = build_manifest(tracks)
    manifest_path = args.metadata_dir / 'manifest_enriched.json'
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f"  Wrote {manifest_path}")

    # Count stats
    with_art = sum(1 for t in manifest['tracks'] if t.get('artwork'))
    without_art = sum(1 for t in manifest['tracks'] if not t.get('artwork'))
    print(f"  Tracks with artwork: {with_art}")
    print(f"  Tracks without artwork: {without_art}")

    # Step 4: Upload manifest to S3
    print("\n--- Publishing manifest.json ---")
    if args.dry_run:
        print(f"  Would upload: manifest.json -> s3://{TRACKS_BUCKET}/manifest.json")
    else:
        try:
            s3_client.put_object(
                Bucket=TRACKS_BUCKET,
                Key='manifest.json',
                Body=json.dumps(manifest, indent=2),
                ContentType='application/json',
            )
            print(f"  Uploaded manifest.json ({len(manifest['tracks'])} tracks)")
        except ClientError as e:
            print(f"  Error uploading manifest: {e}", file=sys.stderr)
            return 1

    # Also update the local enriched file with correct artwork paths
    if not args.dry_run:
        enriched_path = args.metadata_dir / 'metadata_enriched.json'
        if enriched_path.exists():
            with open(enriched_path, 'w') as f:
                json.dump(data, f, indent=2)
            print(f"  Updated {enriched_path} with S3 artwork paths")

    print(f"\nDone! {'[DRY RUN]' if args.dry_run else 'Published to S3.'}")
    return 0


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""
Crate Batch Upload Tool

Uploads all tracks from metadata_base.json to S3, along with artwork.
Deletes original files after successful upload.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

# Configuration
AWS_PROFILE = os.environ.get('AWS_PROFILE', 'default')
TRACKS_BUCKET = os.environ.get('TRACKS_BUCKET', '')
METADATA_FILE = 'metadata_base.json'
ENRICHED_METADATA_FILE = 'metadata_enriched.json'
MANIFEST_FILE = 'manifest.json'


def get_s3_client():
    """Get boto3 S3 client with personal profile."""
    session = boto3.Session(profile_name=AWS_PROFILE)
    return session.client('s3')


def upload_file(s3_client, local_path: Path, s3_key: str, content_type: str = None) -> bool:
    """Upload a file to S3. Returns True on success."""
    extra_args = {}
    if content_type:
        extra_args['ContentType'] = content_type

    try:
        s3_client.upload_file(str(local_path), TRACKS_BUCKET, s3_key, ExtraArgs=extra_args)
        return True
    except ClientError as e:
        print(f"  Error uploading {local_path.name}: {e}", file=sys.stderr)
        return False


def get_content_type(filepath: Path) -> str:
    """Get MIME type for file."""
    ext = filepath.suffix.lower()
    types = {
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
        '.wav': 'audio/wav',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
    }
    return types.get(ext, 'application/octet-stream')


def load_metadata(metadata_dir: Path, enriched: bool = False) -> dict:
    """Load metadata JSON. Prefers enriched if --enriched flag is set.

    Normalizes tracks to dict format regardless of input shape (list or dict).
    """
    if enriched:
        enriched_file = metadata_dir / ENRICHED_METADATA_FILE
        if enriched_file.exists():
            print(f"Using enriched metadata: {enriched_file}")
            with open(enriched_file) as f:
                data = json.load(f)
            return _normalize_tracks(data)
        print(f"Enriched metadata not found, falling back to base")
    metadata_file = metadata_dir / METADATA_FILE
    with open(metadata_file) as f:
        data = json.load(f)
    return _normalize_tracks(data)


def _normalize_tracks(data: dict) -> dict:
    """Ensure tracks is a dict keyed by path/id (handles manifest list format)."""
    tracks = data.get('tracks', {})
    if isinstance(tracks, list):
        tracks_dict = {}
        for track in tracks:
            key = track.get('path') or track.get('original_path') or track['id']
            tracks_dict[key] = track
        data['tracks'] = tracks_dict
    return data


def save_metadata(metadata_dir: Path, metadata: dict):
    """Save metadata_base.json."""
    metadata_file = metadata_dir / METADATA_FILE
    with open(metadata_file, 'w') as f:
        json.dump(metadata, f, indent=2)


def build_manifest(metadata: dict) -> dict:
    """Build manifest.json from metadata_base."""
    tracks = []
    for file_path, track in metadata['tracks'].items():
        if not track.get('uploaded'):
            continue

        tracks.append({
            'id': track['id'],
            'path': track['s3_path'],
            'artist': track.get('artist'),
            'album': track.get('album'),
            'title': track.get('title'),
            'year': track.get('year'),
            'duration': track.get('duration'),
            'artwork': track.get('s3_artwork_path'),
            'tagged': track.get('tagged', False)
        })

    return {
        'version': 1,
        'generated': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'tracks': tracks
    }


def upload_manifest(s3_client, manifest: dict) -> bool:
    """Upload manifest.json to S3."""
    try:
        s3_client.put_object(
            Bucket=TRACKS_BUCKET,
            Key=MANIFEST_FILE,
            Body=json.dumps(manifest, indent=2),
            ContentType='application/json'
        )
        return True
    except ClientError as e:
        print(f"Error uploading manifest: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Batch upload audio files to S3 from metadata_base.json'
    )
    parser.add_argument(
        '--metadata-dir',
        type=Path,
        default=Path(__file__).parent.parent / 'metadata',
        help='Directory containing metadata_base.json and artwork'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be uploaded without actually uploading'
    )
    parser.add_argument(
        '--no-delete',
        action='store_true',
        help='Do not delete original files after upload'
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=0,
        help='Limit number of tracks to upload (0 = unlimited)'
    )
    parser.add_argument(
        '--skip-artwork',
        action='store_true',
        help='Skip uploading artwork files'
    )
    parser.add_argument(
        '--enriched',
        action='store_true',
        help='Use metadata_enriched.json instead of metadata_base.json'
    )

    args = parser.parse_args()

    # Load metadata
    print(f"Loading metadata from {args.metadata_dir}...")
    metadata = load_metadata(args.metadata_dir, enriched=args.enriched)

    total_tracks = len(metadata['tracks'])
    print(f"Found {total_tracks} tracks in metadata")

    # Filter to unuploaded tracks
    to_upload = {k: v for k, v in metadata['tracks'].items() if not v.get('uploaded')}
    print(f"Tracks to upload: {len(to_upload)}")

    if args.limit > 0:
        to_upload = dict(list(to_upload.items())[:args.limit])
        print(f"Limited to {len(to_upload)} tracks")

    if len(to_upload) == 0:
        print("Nothing to upload!")
        return 0

    if args.dry_run:
        print("\n[DRY RUN] Would upload:")
        for i, (file_path, track) in enumerate(to_upload.items(), 1):
            print(f"  {i}. {track['original_filename']}")
            print(f"      -> audio/{track['id']}.mp3")
            if track.get('artwork_path'):
                print(f"      -> artwork/{track['id']}.*")
        return 0

    # Initialize S3 client
    print("\nInitializing S3 client...")
    s3_client = get_s3_client()

    # Upload tracks
    uploaded = 0
    failed = 0
    deleted = 0

    artwork_dir = args.metadata_dir / 'artwork'

    for i, (file_path, track) in enumerate(to_upload.items(), 1):
        original_path = Path(file_path)
        track_id = track['id']

        print(f"[{i}/{len(to_upload)}] {track['original_filename'][:60]}...")

        # Upload audio file
        s3_audio_key = f"audio/{track_id}.mp3"

        if not original_path.exists():
            print(f"  SKIP: Original file not found")
            failed += 1
            continue

        if not upload_file(s3_client, original_path, s3_audio_key, get_content_type(original_path)):
            failed += 1
            continue

        # Update metadata with S3 path
        metadata['tracks'][file_path]['s3_path'] = s3_audio_key
        metadata['tracks'][file_path]['uploaded'] = True

        # Upload artwork if exists
        if not args.skip_artwork and track.get('artwork_path'):
            artwork_path = Path(track['artwork_path'])
            if artwork_path.exists():
                s3_artwork_key = f"artwork/{artwork_path.name}"
                if upload_file(s3_client, artwork_path, s3_artwork_key, get_content_type(artwork_path)):
                    metadata['tracks'][file_path]['s3_artwork_path'] = s3_artwork_key

        uploaded += 1

        # Delete original file
        if not args.no_delete:
            try:
                original_path.unlink()
                deleted += 1
                print(f"  Uploaded and deleted")
            except OSError as e:
                print(f"  Uploaded (delete failed: {e})")
        else:
            print(f"  Uploaded")

        # Save checkpoint every 50 tracks
        if uploaded % 50 == 0:
            print(f"  Checkpoint: saving metadata and manifest...")
            save_metadata(args.metadata_dir, metadata)
            manifest = build_manifest(metadata)
            upload_manifest(s3_client, manifest)

    # Final save
    print("\nSaving final metadata and manifest...")
    save_metadata(args.metadata_dir, metadata)
    manifest = build_manifest(metadata)
    upload_manifest(s3_client, manifest)

    print(f"\nDone!")
    print(f"  Uploaded: {uploaded}")
    print(f"  Failed: {failed}")
    if not args.no_delete:
        print(f"  Deleted: {deleted}")
    print(f"  Manifest tracks: {len(manifest['tracks'])}")

    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())

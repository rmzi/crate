#!/usr/bin/env python3
"""
Crate Audio Upload Tool

Upload audio files to the tracks S3 bucket and update the manifest.
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import boto3
from mutagen import File as MutagenFile
from mutagen.id3 import ID3
from mutagen.mp3 import MP3

# Configuration
AWS_PROFILE = os.environ.get('AWS_PROFILE', 'personal')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
TRACKS_BUCKET = os.environ.get('TRACKS_BUCKET', '')
MANIFEST_KEY = 'manifest.json'
AUDIO_PREFIX = 'audio/'

# Supported audio formats
SUPPORTED_EXTENSIONS = {'.mp3', '.m4a', '.ogg', '.flac', '.wav'}


def get_s3_client():
    """Get boto3 S3 client using the configured profile."""
    session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
    return session.client('s3')


def compute_file_hash(filepath: Path) -> str:
    """Compute SHA256 hash of file for unique naming."""
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256.update(chunk)
    return sha256.hexdigest()[:12]


def extract_metadata(filepath: Path) -> dict:
    """Extract metadata from audio file using mutagen."""
    metadata = {
        'artist': None,
        'album': None,
        'title': None,
        'year': None,
        'duration': None,
        'tagged': False
    }

    try:
        audio = MutagenFile(filepath)
        if audio is None:
            return metadata

        # Get duration
        if hasattr(audio, 'info') and hasattr(audio.info, 'length'):
            metadata['duration'] = int(audio.info.length)

        # Try to get ID3 tags (MP3)
        if isinstance(audio, MP3) or filepath.suffix.lower() == '.mp3':
            try:
                tags = ID3(filepath)
                metadata['artist'] = str(tags.get('TPE1', [''])[0]) or None
                metadata['album'] = str(tags.get('TALB', [''])[0]) or None
                metadata['title'] = str(tags.get('TIT2', [''])[0]) or None

                # Year can be in TDRC (recording date) or TYER (year)
                year = tags.get('TDRC') or tags.get('TYER')
                if year:
                    year_str = str(year[0])
                    if year_str:
                        try:
                            metadata['year'] = int(year_str[:4])
                        except ValueError:
                            pass
            except Exception:
                pass

        # Try generic tag access for other formats
        elif hasattr(audio, 'tags') and audio.tags:
            tags = audio.tags

            # Common tag mappings
            artist_keys = ['artist', 'ARTIST', 'TPE1', '\xa9ART']
            album_keys = ['album', 'ALBUM', 'TALB', '\xa9alb']
            title_keys = ['title', 'TITLE', 'TIT2', '\xa9nam']
            year_keys = ['date', 'DATE', 'year', 'YEAR', 'TDRC', '\xa9day']

            for key in artist_keys:
                if key in tags:
                    val = tags[key]
                    metadata['artist'] = str(val[0] if isinstance(val, list) else val) or None
                    break

            for key in album_keys:
                if key in tags:
                    val = tags[key]
                    metadata['album'] = str(val[0] if isinstance(val, list) else val) or None
                    break

            for key in title_keys:
                if key in tags:
                    val = tags[key]
                    metadata['title'] = str(val[0] if isinstance(val, list) else val) or None
                    break

            for key in year_keys:
                if key in tags:
                    val = tags[key]
                    year_str = str(val[0] if isinstance(val, list) else val)
                    if year_str:
                        try:
                            metadata['year'] = int(year_str[:4])
                        except ValueError:
                            pass
                    break

        # Check if we have meaningful tags
        metadata['tagged'] = bool(
            metadata['artist'] or metadata['title']
        )

    except Exception as e:
        print(f"Warning: Could not read metadata from {filepath}: {e}", file=sys.stderr)

    return metadata


def get_manifest(s3_client) -> dict:
    """Fetch current manifest from S3."""
    try:
        response = s3_client.get_object(Bucket=TRACKS_BUCKET, Key=MANIFEST_KEY)
        return json.loads(response['Body'].read().decode('utf-8'))
    except s3_client.exceptions.NoSuchKey:
        # Return empty manifest if doesn't exist
        return {
            'version': 1,
            'generated': datetime.utcnow().isoformat() + 'Z',
            'tracks': []
        }
    except Exception as e:
        print(f"Warning: Could not fetch manifest: {e}", file=sys.stderr)
        return {
            'version': 1,
            'generated': datetime.utcnow().isoformat() + 'Z',
            'tracks': []
        }


def save_manifest(s3_client, manifest: dict):
    """Save manifest to S3."""
    manifest['generated'] = datetime.utcnow().isoformat() + 'Z'
    body = json.dumps(manifest, indent=2)

    s3_client.put_object(
        Bucket=TRACKS_BUCKET,
        Key=MANIFEST_KEY,
        Body=body.encode('utf-8'),
        ContentType='application/json'
    )


def get_content_type(filepath: Path) -> str:
    """Get MIME type for audio file."""
    ext = filepath.suffix.lower()
    types = {
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
        '.wav': 'audio/wav'
    }
    return types.get(ext, 'application/octet-stream')


def upload_file(s3_client, filepath: Path, manifest: dict, dry_run: bool = False) -> bool:
    """Upload a single audio file to S3 and update manifest."""
    # Compute file hash for unique ID
    file_hash = compute_file_hash(filepath)

    # Check if already in manifest
    existing_ids = {t['id'] for t in manifest['tracks']}
    if file_hash in existing_ids:
        print(f"Skipping {filepath.name} (already uploaded as {file_hash})")
        return False

    # Extract metadata
    metadata = extract_metadata(filepath)

    # Generate S3 key - preserve original extension
    ext = filepath.suffix.lower()
    s3_key = f"{AUDIO_PREFIX}{file_hash}{ext}"

    # Create track entry
    track = {
        'id': file_hash,
        'path': s3_key,
        'artist': metadata['artist'],
        'album': metadata['album'],
        'title': metadata['title'] or filepath.stem,  # Fallback to filename
        'year': metadata['year'],
        'duration': metadata['duration'],
        'tagged': metadata['tagged'],
        'original_filename': filepath.name,
        'uploaded': datetime.utcnow().isoformat() + 'Z'
    }

    if dry_run:
        print(f"Would upload: {filepath.name} -> {s3_key}")
        print(f"  Metadata: {json.dumps({k: v for k, v in track.items() if k != 'path'}, indent=4)}")
        return True

    # Upload to S3
    print(f"Uploading {filepath.name} -> {s3_key}...")

    try:
        s3_client.upload_file(
            str(filepath),
            TRACKS_BUCKET,
            s3_key,
            ExtraArgs={
                'ContentType': get_content_type(filepath),
                'CacheControl': 'max-age=31536000'  # 1 year cache
            }
        )
    except Exception as e:
        print(f"Error uploading {filepath.name}: {e}", file=sys.stderr)
        return False

    # Add to manifest
    manifest['tracks'].append(track)

    print(f"  Uploaded: {track['artist'] or '???'} - {track['title']}")
    return True


def find_audio_files(path: Path) -> list:
    """Find all audio files in path (file or directory)."""
    files = []

    if path.is_file():
        if path.suffix.lower() in SUPPORTED_EXTENSIONS:
            files.append(path)
    elif path.is_dir():
        for ext in SUPPORTED_EXTENSIONS:
            files.extend(path.rglob(f'*{ext}'))
            files.extend(path.rglob(f'*{ext.upper()}'))

    return sorted(set(files))


def main():
    parser = argparse.ArgumentParser(
        description='Upload audio files to tracks bucket'
    )
    parser.add_argument(
        'paths',
        nargs='+',
        type=Path,
        help='Files or directories to upload'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be uploaded without actually uploading'
    )
    parser.add_argument(
        '--bucket',
        default=TRACKS_BUCKET,
        help=f'S3 bucket name (default: {TRACKS_BUCKET})'
    )
    parser.add_argument(
        '--profile',
        default=AWS_PROFILE,
        help=f'AWS profile (default: {AWS_PROFILE})'
    )

    args = parser.parse_args()

    # Update globals from args
    global TRACKS_BUCKET, AWS_PROFILE
    TRACKS_BUCKET = args.bucket
    AWS_PROFILE = args.profile

    # Collect all audio files
    audio_files = []
    for path in args.paths:
        if not path.exists():
            print(f"Warning: {path} does not exist", file=sys.stderr)
            continue
        audio_files.extend(find_audio_files(path))

    if not audio_files:
        print("No audio files found.")
        return 1

    print(f"Found {len(audio_files)} audio file(s)")

    # Initialize S3 client
    s3_client = get_s3_client()

    # Get current manifest
    manifest = get_manifest(s3_client)
    print(f"Current manifest has {len(manifest['tracks'])} track(s)")

    # Upload files
    uploaded = 0
    for filepath in audio_files:
        if upload_file(s3_client, filepath, manifest, args.dry_run):
            uploaded += 1

    # Save updated manifest
    if uploaded > 0 and not args.dry_run:
        save_manifest(s3_client, manifest)
        print(f"\nUploaded {uploaded} new track(s)")
        print(f"Manifest now has {len(manifest['tracks'])} total track(s)")
    elif args.dry_run and uploaded > 0:
        print(f"\nWould upload {uploaded} new track(s)")
    else:
        print("\nNo new tracks to upload")

    return 0


if __name__ == '__main__':
    sys.exit(main())

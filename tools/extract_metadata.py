#!/usr/bin/env python3
"""
Crate Metadata Extractor

Scans a directory of audio files and extracts all metadata into a JSON database.
Extracts embedded album art and saves to a separate directory.
"""

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from mutagen import File as MutagenFile
from mutagen.id3 import ID3
from mutagen.mp3 import MP3

# Configuration
SUPPORTED_EXTENSIONS = {'.mp3', '.m4a', '.ogg', '.flac', '.wav'}
METADATA_FILE = 'metadata_base.json'
ARTWORK_DIR = 'artwork'


def compute_file_hash(filepath: Path) -> str:
    """Compute SHA256 hash of file for unique ID."""
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256.update(chunk)
    return sha256.hexdigest()[:12]


def parse_filename(filename: str) -> dict:
    """
    Try to extract metadata from filename patterns.

    Common patterns:
    - "01. Artist - Title.mp3"
    - "01 - Artist - Title.mp3"
    - "Artist - Title.mp3"
    - "01-artist-title.mp3"
    """
    result = {'artist': None, 'title': None, 'track_num': None}

    # Remove extension
    name = os.path.splitext(filename)[0]

    # Try to extract track number
    track_match = re.match(r'^(\d{1,2})[\.\-\s]+(.+)$', name)
    if track_match:
        result['track_num'] = int(track_match.group(1))
        name = track_match.group(2).strip()

    # Try "Artist - Title" pattern
    if ' - ' in name:
        parts = name.split(' - ', 1)
        if len(parts) == 2:
            result['artist'] = parts[0].strip()
            result['title'] = parts[1].strip()
    elif '-' in name and ' ' not in name.split('-')[0]:
        # Handle "artist-title" pattern (no spaces)
        parts = name.split('-', 1)
        if len(parts) == 2:
            result['artist'] = parts[0].replace('_', ' ').strip().title()
            result['title'] = parts[1].replace('_', ' ').strip().title()
    else:
        # Just use as title
        result['title'] = name

    return result


def extract_album_art(audio, track_id: str, artwork_dir: Path) -> str | None:
    """Extract embedded album art and save to file. Returns path if found."""
    artwork_path = None

    try:
        # Try ID3 (MP3)
        if hasattr(audio, 'tags') and audio.tags:
            tags = audio.tags

            # ID3 APIC frames
            for key in tags.keys():
                if key.startswith('APIC'):
                    apic = tags[key]
                    if apic.data and len(apic.data) > 1000:  # At least 1KB
                        ext = 'jpg' if apic.mime == 'image/jpeg' else 'png'
                        artwork_path = artwork_dir / f"{track_id}.{ext}"
                        artwork_path.write_bytes(apic.data)
                        return str(artwork_path)

            # MP4/M4A cover art
            if 'covr' in tags:
                cover = tags['covr'][0]
                if len(cover) > 1000:
                    artwork_path = artwork_dir / f"{track_id}.jpg"
                    artwork_path.write_bytes(bytes(cover))
                    return str(artwork_path)

            # FLAC pictures
            if hasattr(audio, 'pictures'):
                for pic in audio.pictures:
                    if pic.data and len(pic.data) > 1000:
                        ext = 'jpg' if pic.mime == 'image/jpeg' else 'png'
                        artwork_path = artwork_dir / f"{track_id}.{ext}"
                        artwork_path.write_bytes(pic.data)
                        return str(artwork_path)

    except Exception as e:
        print(f"  Warning: Could not extract artwork: {e}", file=sys.stderr)

    return artwork_path


def extract_metadata(filepath: Path, artwork_dir: Path) -> dict:
    """Extract all metadata from an audio file."""
    track_id = compute_file_hash(filepath)

    metadata = {
        'id': track_id,
        'original_path': str(filepath),
        'original_filename': filepath.name,
        'file_size': filepath.stat().st_size,
        'artist': None,
        'album': None,
        'title': None,
        'year': None,
        'track_num': None,
        'genre': None,
        'duration': None,
        'bitrate': None,
        'sample_rate': None,
        'artwork_path': None,
        'tagged': False,
        'extracted_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    }

    # Parse filename for fallback metadata
    filename_meta = parse_filename(filepath.name)

    try:
        audio = MutagenFile(filepath)
        if audio is None:
            # Use filename metadata as fallback
            metadata.update({k: v for k, v in filename_meta.items() if v})
            return metadata

        # Get audio info
        if hasattr(audio, 'info'):
            info = audio.info
            if hasattr(info, 'length'):
                metadata['duration'] = int(info.length)
            if hasattr(info, 'bitrate'):
                metadata['bitrate'] = info.bitrate
            if hasattr(info, 'sample_rate'):
                metadata['sample_rate'] = info.sample_rate

        # Try to get ID3 tags (MP3)
        if isinstance(audio, MP3) or filepath.suffix.lower() == '.mp3':
            try:
                tags = ID3(filepath)

                # Artist
                for key in ['TPE1', 'TPE2']:
                    if key in tags:
                        metadata['artist'] = str(tags[key].text[0]) if tags[key].text else None
                        break

                # Album
                if 'TALB' in tags:
                    metadata['album'] = str(tags['TALB'].text[0]) if tags['TALB'].text else None

                # Title
                if 'TIT2' in tags:
                    metadata['title'] = str(tags['TIT2'].text[0]) if tags['TIT2'].text else None

                # Year
                for key in ['TDRC', 'TYER', 'TDOR']:
                    if key in tags:
                        year_str = str(tags[key].text[0]) if tags[key].text else ''
                        if year_str:
                            try:
                                metadata['year'] = int(str(year_str)[:4])
                            except ValueError:
                                pass
                        break

                # Track number
                if 'TRCK' in tags:
                    track_str = str(tags['TRCK'].text[0]) if tags['TRCK'].text else ''
                    if track_str:
                        try:
                            metadata['track_num'] = int(track_str.split('/')[0])
                        except ValueError:
                            pass

                # Genre
                if 'TCON' in tags:
                    metadata['genre'] = str(tags['TCON'].text[0]) if tags['TCON'].text else None

            except Exception:
                pass

        # Generic tag access for other formats
        elif hasattr(audio, 'tags') and audio.tags:
            tags = audio.tags

            # Common mappings
            tag_map = {
                'artist': ['artist', 'ARTIST', '\xa9ART', 'Author'],
                'album': ['album', 'ALBUM', '\xa9alb'],
                'title': ['title', 'TITLE', '\xa9nam'],
                'year': ['date', 'DATE', 'year', 'YEAR', '\xa9day'],
                'track_num': ['tracknumber', 'TRACKNUMBER', 'trkn'],
                'genre': ['genre', 'GENRE', '\xa9gen']
            }

            for field, keys in tag_map.items():
                for key in keys:
                    if key in tags:
                        val = tags[key]
                        if isinstance(val, list):
                            val = val[0]
                        val_str = str(val)

                        if field == 'year':
                            try:
                                metadata[field] = int(val_str[:4])
                            except ValueError:
                                pass
                        elif field == 'track_num':
                            try:
                                metadata[field] = int(val_str.split('/')[0])
                            except ValueError:
                                pass
                        else:
                            metadata[field] = val_str
                        break

        # Extract album art
        artwork_path = extract_album_art(audio, track_id, artwork_dir)
        if artwork_path:
            metadata['artwork_path'] = artwork_path

    except Exception as e:
        print(f"  Warning: Error reading {filepath.name}: {e}", file=sys.stderr)

    # Fall back to filename metadata for missing fields
    if not metadata['artist'] and filename_meta.get('artist'):
        metadata['artist'] = filename_meta['artist']
    if not metadata['title'] and filename_meta.get('title'):
        metadata['title'] = filename_meta['title']
    if not metadata['track_num'] and filename_meta.get('track_num'):
        metadata['track_num'] = filename_meta['track_num']

    # If still no title, use filename
    if not metadata['title']:
        metadata['title'] = filepath.stem

    # Mark as tagged if we have artist or meaningful title
    metadata['tagged'] = bool(metadata['artist'])

    return metadata


def scan_directory(directory: Path, output_dir: Path, resume: bool = False) -> dict:
    """Scan directory and extract metadata from all audio files."""
    metadata_file = output_dir / METADATA_FILE
    artwork_dir = output_dir / ARTWORK_DIR
    artwork_dir.mkdir(parents=True, exist_ok=True)

    # Load existing metadata if resuming
    metadata_base = {'version': 1, 'generated': None, 'tracks': {}}
    if resume and metadata_file.exists():
        with open(metadata_file) as f:
            metadata_base = json.load(f)
        print(f"Resuming: {len(metadata_base['tracks'])} tracks already processed")

    # Find all audio files
    audio_files = []
    for ext in SUPPORTED_EXTENSIONS:
        audio_files.extend(directory.glob(f'*{ext}'))
        audio_files.extend(directory.glob(f'*{ext.upper()}'))

    audio_files = sorted(set(audio_files))
    print(f"Found {len(audio_files)} audio files")

    # Process files
    processed = 0
    skipped = 0

    for i, filepath in enumerate(audio_files):
        # Skip if already processed
        file_key = str(filepath)
        if file_key in metadata_base['tracks']:
            skipped += 1
            continue

        print(f"[{i+1}/{len(audio_files)}] Processing: {filepath.name[:60]}...")

        try:
            meta = extract_metadata(filepath, artwork_dir)
            metadata_base['tracks'][file_key] = meta
            processed += 1

            # Save periodically
            if processed % 50 == 0:
                metadata_base['generated'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                with open(metadata_file, 'w') as f:
                    json.dump(metadata_base, f, indent=2)
                print(f"  Checkpoint saved ({processed} new, {skipped} skipped)")

        except Exception as e:
            print(f"  Error: {e}", file=sys.stderr)

    # Final save
    metadata_base['generated'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    with open(metadata_file, 'w') as f:
        json.dump(metadata_base, f, indent=2)

    print(f"\nDone! Processed {processed} new files, skipped {skipped}")
    print(f"Total tracks in database: {len(metadata_base['tracks'])}")
    print(f"Metadata saved to: {metadata_file}")

    return metadata_base


def main():
    parser = argparse.ArgumentParser(
        description='Extract metadata from audio files into a database'
    )
    parser.add_argument(
        'directory',
        type=Path,
        help='Directory containing audio files'
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=Path('.'),
        help='Output directory for metadata and artwork'
    )
    parser.add_argument(
        '--resume',
        action='store_true',
        help='Resume from existing metadata file'
    )

    args = parser.parse_args()

    if not args.directory.is_dir():
        print(f"Error: {args.directory} is not a directory", file=sys.stderr)
        return 1

    args.output.mkdir(parents=True, exist_ok=True)

    scan_directory(args.directory, args.output, args.resume)
    return 0


if __name__ == '__main__':
    sys.exit(main())

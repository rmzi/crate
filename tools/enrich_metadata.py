#!/usr/bin/env python3
"""
Crate Metadata Enrichment Pipeline

Enriches track metadata using free external APIs (MusicBrainz, Cover Art Archive).
Auto-accepts high-confidence matches and flags uncertain ones for manual review.

Pipeline position:
  extract_metadata.py → enrich_metadata.py → batch_upload.py
  metadata_base.json    metadata_enriched.json   manifest.json + S3
                        review_queue.json
"""

import argparse
import json
import os
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from typing import Dict, List, Optional, Set, Tuple

import requests

# --- Configuration ---

MB_BASE_URL = "https://musicbrainz.org/ws/2"
CAA_BASE_URL = "https://coverartarchive.org"
MB_USER_AGENT = "CrateEnrichment/1.0 (https://crate.rmzi.world)"

# Thresholds
AUTO_ACCEPT_THRESHOLD = 0.85
REVIEW_THRESHOLD = 0.50

# Field weights for scoring
FIELD_WEIGHTS = {
    'artist': 0.35,
    'title': 0.35,
    'album': 0.15,
    'year': 0.10,
    'duration': 0.05,
}

# Artwork scoring
ART_RESOLUTION_SCORES = [(1200, 40), (1000, 35), (500, 20), (250, 10)]
ART_SOURCE_SCORES = {'coverartarchive': 30, 'itunes': 25, 'discogs': 20, 'existing': 15}
ART_TYPE_SCORES = {'front': 20, 'unknown': 10}
ART_FORMAT_SCORES = {'jpeg': 10, 'jpg': 10, 'png': 7}
ART_UPGRADE_MARGIN = 10


# --- Rate Limiter ---

class RateLimiter:
    """Token-bucket rate limiter per API."""

    def __init__(self, rate: float = 1.0):
        self._rate = rate
        self._lock = threading.Lock()
        self._last_call = 0.0

    def wait(self):
        with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_call
            wait_time = (1.0 / self._rate) - elapsed
            if wait_time > 0:
                time.sleep(wait_time)
            self._last_call = time.monotonic()


# --- Enrichment State (resume support) ---

class EnrichmentState:
    """Tracks which track IDs have been processed for resume support."""

    def __init__(self, state_file: Path):
        self._file = state_file
        self._processed: Set[str] = set()
        self._load()

    def _load(self):
        if self._file.exists():
            try:
                data = json.loads(self._file.read_text())
                self._processed = set(data.get('processed', []))
            except (json.JSONDecodeError, KeyError):
                self._processed = set()

    def save(self):
        self._file.write_text(json.dumps({
            'processed': sorted(self._processed),
            'updated_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        }, indent=2))

    def is_processed(self, track_id: str) -> bool:
        return track_id in self._processed

    def mark_processed(self, track_id: str):
        self._processed.add(track_id)

    @property
    def count(self) -> int:
        return len(self._processed)


# --- String Similarity ---

def normalize(s: str) -> str:
    """Normalize a string for comparison."""
    if not s:
        return ""
    s = s.lower().strip()
    # Remove common noise: "feat.", "ft.", parenthetical info
    for noise in ['feat.', 'ft.', 'featuring']:
        s = s.replace(noise, ' ')
    # Collapse whitespace
    return ' '.join(s.split())


def token_set(s: str) -> Set[str]:
    """Split normalized string into token set."""
    return set(normalize(s).split())


def string_similarity(a: str, b: str) -> float:
    """Compute similarity between two strings (0.0–1.0).

    Uses exact match (1.0) or token Jaccard overlap.
    """
    if not a or not b:
        return 0.0
    na, nb = normalize(a), normalize(b)
    if na == nb:
        return 1.0
    ta, tb = token_set(a), token_set(b)
    if not ta or not tb:
        return 0.0
    intersection = ta & tb
    union = ta | tb
    return len(intersection) / len(union)


# --- Match Scorer ---

class MatchScorer:
    """Scores candidate matches against existing track metadata."""

    def score(self, existing: dict, candidate: dict, source_count: int = 1) -> float:
        """Compute weighted match score (0.0–1.0)."""
        total = 0.0
        for field, weight in FIELD_WEIGHTS.items():
            existing_val = existing.get(field)
            candidate_val = candidate.get(field)

            if field == 'year':
                total += weight * self._year_similarity(existing_val, candidate_val)
            elif field == 'duration':
                total += weight * self._duration_similarity(existing_val, candidate_val)
            else:
                total += weight * string_similarity(
                    str(existing_val) if existing_val else '',
                    str(candidate_val) if candidate_val else '',
                )

        # Multi-source bonus
        if source_count >= 3:
            total = min(1.0, total + 0.10)
        elif source_count >= 2:
            total = min(1.0, total + 0.05)

        return round(total, 4)

    @staticmethod
    def _year_similarity(a, b) -> float:
        if a is None or b is None:
            return 0.0
        try:
            diff = abs(int(a) - int(b))
        except (ValueError, TypeError):
            return 0.0
        if diff == 0:
            return 1.0
        if diff == 1:
            return 0.8
        if diff <= 3:
            return 0.4
        return 0.0

    @staticmethod
    def _duration_similarity(a, b) -> float:
        if a is None or b is None:
            return 0.0
        try:
            diff = abs(int(a) - int(b))
        except (ValueError, TypeError):
            return 0.0
        if diff <= 2:
            return 1.0
        if diff <= 5:
            return 0.7
        if diff <= 10:
            return 0.3
        return 0.0


# --- Conflict Resolver ---

class ConflictResolver:
    """Categorizes disagreements between existing tags and external data."""

    def resolve(self, field: str, existing_val, enriched_val,
                source_count: int = 1) -> dict:
        """Classify a field conflict.

        Returns dict with 'classification', 'action', and details.
        """
        has_existing = existing_val is not None and str(existing_val).strip() != ''
        has_enriched = enriched_val is not None and str(enriched_val).strip() != ''

        if not has_enriched:
            return {'classification': 'no_data', 'action': 'keep'}

        if not has_existing and has_enriched:
            return {
                'classification': 'supplement',
                'action': 'auto_fill',
                'value': enriched_val,
            }

        # Both exist — compare
        sim = string_similarity(str(existing_val), str(enriched_val))
        if sim >= 0.9:
            return {'classification': 'confirmed', 'action': 'keep'}

        if source_count >= 2:
            return {
                'classification': 'likely_correction',
                'action': 'flag_review',
                'existing': existing_val,
                'suggested': enriched_val,
                'similarity': round(sim, 3),
            }

        return {
            'classification': 'alternative',
            'action': 'keep',
            'alternative': enriched_val,
        }


# --- Artwork Selector ---

class ArtworkSelector:
    """Scores and selects best available album art."""

    @staticmethod
    def score_artwork(width: int = 0, source: str = 'unknown',
                      art_type: str = 'unknown', fmt: str = 'jpeg') -> int:
        """Score artwork on a 0–100 scale."""
        score = 0

        # Resolution (40 pts)
        for threshold, pts in ART_RESOLUTION_SCORES:
            if width >= threshold:
                score += pts
                break

        # Source (30 pts)
        score += ART_SOURCE_SCORES.get(source, 0)

        # Type (20 pts)
        score += ART_TYPE_SCORES.get(art_type, 0)

        # Format (10 pts)
        score += ART_FORMAT_SCORES.get(fmt.lower(), 0)

        return score

    def should_upgrade(self, existing_score: int, new_score: int) -> bool:
        return new_score > existing_score + ART_UPGRADE_MARGIN


# --- MusicBrainz Client ---

class MusicBrainzClient:
    """Primary lookup via MusicBrainz recording search."""

    def __init__(self, limiter: RateLimiter):
        self._limiter = limiter
        self._session = requests.Session()
        self._session.headers.update({
            'User-Agent': MB_USER_AGENT,
            'Accept': 'application/json',
        })

    def ping(self) -> bool:
        """Check if MusicBrainz API is reachable."""
        try:
            self._limiter.wait()
            resp = self._session.get(f"{MB_BASE_URL}/recording", params={
                'query': 'test', 'limit': 1, 'fmt': 'json',
            }, timeout=10)
            return resp.status_code == 200
        except requests.RequestException:
            return False

    def search_recordings(self, artist: str = None, title: str = None,
                          album: str = None) -> List[dict]:
        """Search MusicBrainz for recordings matching the given fields.

        Returns a list of candidate dicts with normalized fields.
        """
        candidates = []

        # Strategy 1: artist + title (primary)
        if artist and title:
            results = self._query(f'artist:"{artist}" AND recording:"{title}"')
            candidates.extend(results)

        # Strategy 2: artist + album (fallback)
        if artist and album and not candidates:
            results = self._query(f'artist:"{artist}" AND release:"{album}"')
            candidates.extend(results)

        # Strategy 3: title only (last resort)
        if title and not candidates:
            results = self._query(f'recording:"{title}"')
            candidates.extend(results)

        return candidates

    def _query(self, query: str, limit: int = 5) -> List[dict]:
        """Execute a MusicBrainz recording search query."""
        self._limiter.wait()
        try:
            resp = self._session.get(f"{MB_BASE_URL}/recording", params={
                'query': query, 'limit': limit, 'fmt': 'json',
            }, timeout=15)
            if resp.status_code != 200:
                return []
            data = resp.json()
        except (requests.RequestException, json.JSONDecodeError):
            return []

        candidates = []
        for rec in data.get('recordings', []):
            candidate = {
                'title': rec.get('title'),
                'artist': None,
                'album': None,
                'year': None,
                'duration': None,
                'mb_recording_id': rec.get('id'),
                'mb_release_id': None,
                'mb_score': rec.get('score', 0),
                'source': 'musicbrainz',
            }

            # Artist from artist-credit
            credits = rec.get('artist-credit', [])
            if credits:
                candidate['artist'] = credits[0].get('name') or credits[0].get('artist', {}).get('name')

            # Duration in seconds
            length_ms = rec.get('length')
            if length_ms:
                candidate['duration'] = length_ms // 1000

            # Release info (first release)
            releases = rec.get('releases', [])
            if releases:
                rel = releases[0]
                candidate['album'] = rel.get('title')
                candidate['mb_release_id'] = rel.get('id')
                date = rel.get('date', '')
                if date and len(date) >= 4:
                    try:
                        candidate['year'] = int(date[:4])
                    except ValueError:
                        pass

            candidates.append(candidate)

        return candidates


# --- Cover Art Archive Client ---

class CoverArtArchiveClient:
    """Fetches album art via MusicBrainz release IDs."""

    def __init__(self, limiter: RateLimiter):
        self._limiter = limiter
        self._session = requests.Session()
        self._session.headers.update({
            'User-Agent': MB_USER_AGENT,
            'Accept': 'application/json',
        })

    def get_cover_art(self, release_id: str) -> Optional[dict]:
        """Fetch cover art info for a MusicBrainz release.

        Returns dict with 'url', 'width', 'type', 'format' or None.
        """
        if not release_id:
            return None

        self._limiter.wait()
        try:
            resp = self._session.get(
                f"{CAA_BASE_URL}/release/{release_id}",
                timeout=15,
                allow_redirects=True,
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
        except (requests.RequestException, json.JSONDecodeError):
            return None

        images = data.get('images', [])
        if not images:
            return None

        # Prefer front cover
        best = None
        for img in images:
            if img.get('front', False):
                best = img
                break
        if not best:
            best = images[0]

        # Get the best thumbnail URL (prefer 1200, fall back to large, then original)
        thumbnails = best.get('thumbnails', {})
        url = thumbnails.get('1200') or thumbnails.get('large') or best.get('image')
        if not url:
            return None

        # Estimate width from thumbnail key
        width = 1200 if '1200' in str(thumbnails.get('1200', '')) else 500

        art_type = 'front' if best.get('front', False) else 'unknown'
        fmt = 'jpeg' if url.endswith('.jpg') or url.endswith('.jpeg') else 'png'

        return {
            'url': url,
            'width': width,
            'type': art_type,
            'format': fmt,
            'source': 'coverartarchive',
        }

    def download_art(self, url: str, output_path: Path) -> bool:
        """Download artwork to a file. Returns True on success."""
        try:
            resp = self._session.get(url, timeout=30, stream=True)
            if resp.status_code != 200:
                return False
            with open(output_path, 'wb') as f:
                for chunk in resp.iter_content(8192):
                    f.write(chunk)
            return True
        except requests.RequestException:
            return False


# --- iTunes Search API Client ---

class ITunesArtworkClient:
    """Fetches album art via iTunes Search API as a fallback source."""

    def __init__(self, limiter: RateLimiter):
        self._limiter = limiter
        self._session = requests.Session()
        self._session.headers.update({
            'User-Agent': MB_USER_AGENT,
            'Accept': 'application/json',
        })

    def search_artwork(self, artist: str, title: str) -> Optional[dict]:
        """Search iTunes for artwork matching artist and title.

        Returns dict with 'url', 'width', 'type', 'format', 'source' or None.
        """
        if not artist or not title:
            return None

        self._limiter.wait()
        try:
            # Build search query
            query = f"{artist} {title}"
            resp = self._session.get(
                "https://itunes.apple.com/search",
                params={
                    'term': query,
                    'media': 'music',
                    'limit': 3,
                },
                timeout=15,
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
        except (requests.RequestException, json.JSONDecodeError):
            return None

        results = data.get('results', [])
        if not results:
            return None

        # Find best matching result (validate artist similarity)
        for result in results:
            result_artist = result.get('artistName', '')
            if not result_artist:
                continue

            # Validate artist match
            artist_sim = string_similarity(artist, result_artist)
            if artist_sim < 0.5:
                continue

            # Get artwork URL and resize to 1200x1200
            artwork_url = result.get('artworkUrl100')
            if not artwork_url:
                continue

            # Replace 100x100 with 1200x1200
            artwork_url_hires = artwork_url.replace('100x100', '1200x1200')

            return {
                'url': artwork_url_hires,
                'width': 1200,
                'type': 'front',
                'format': 'jpeg',
                'source': 'itunes',
            }

        return None

    def download_art(self, url: str, output_path: Path) -> bool:
        """Download artwork to a file. Returns True on success."""
        try:
            resp = self._session.get(url, timeout=30, stream=True)
            if resp.status_code != 200:
                return False
            with open(output_path, 'wb') as f:
                for chunk in resp.iter_content(8192):
                    f.write(chunk)
            return True
        except requests.RequestException:
            return False


# --- Main Enrichment Logic ---

def enrich_track(track: dict, mb_client: MusicBrainzClient,
                 caa_client: CoverArtArchiveClient,
                 itunes_client: ITunesArtworkClient,
                 scorer: MatchScorer, resolver: ConflictResolver,
                 artwork_selector: ArtworkSelector,
                 output_dir: Path, skip_artwork: bool = False,
                 dry_run: bool = False) -> dict:
    """Enrich a single track's metadata.

    Returns dict with:
      - 'enrichment': enrichment details to attach to track
      - 'review': review queue entry or None
      - 'updates': dict of field updates to apply to top-level track
    """
    track_id = track['id']
    enrichment = {
        'status': 'processed',
        'timestamp': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'match_confidence': 0.0,
        'source': None,
        'fields_updated': [],
        'fields_confirmed': [],
        'conflicts': [],
    }
    review = None
    updates = {}
    review_reasons = []

    artist = track.get('artist')
    title = track.get('title')

    # If no artist and no title, flag for review immediately
    if not artist and not title:
        enrichment['status'] = 'no_metadata'
        review = {
            'track_id': track_id,
            'filename': track.get('original_filename', ''),
            'reason': ['no_artist_or_title'],
            'existing': {f: track.get(f) for f in FIELD_WEIGHTS},
            'suggestions': [],
        }
        return {'enrichment': enrichment, 'review': review, 'updates': updates}

    # Search MusicBrainz
    candidates = mb_client.search_recordings(artist=artist, title=title,
                                              album=track.get('album'))
    if not candidates:
        enrichment['status'] = 'no_match'
        return {'enrichment': enrichment, 'review': None, 'updates': updates}

    # Score candidates
    scored = []
    for cand in candidates:
        score = scorer.score(track, cand)
        scored.append((score, cand))
    scored.sort(key=lambda x: x[0], reverse=True)

    best_score, best_candidate = scored[0]
    enrichment['match_confidence'] = best_score
    enrichment['source'] = best_candidate.get('source', 'musicbrainz')

    # Check for multiple high-confidence disagreements
    if len(scored) >= 2:
        second_score, second_candidate = scored[1]
        if second_score >= REVIEW_THRESHOLD and best_score - second_score < 0.10:
            if normalize(str(best_candidate.get('title', ''))) != normalize(str(second_candidate.get('title', ''))):
                review_reasons.append('multiple_high_confidence_disagree')

    # Apply threshold decisions
    if best_score >= AUTO_ACCEPT_THRESHOLD:
        enrichment['status'] = 'auto_accepted'
    elif best_score >= REVIEW_THRESHOLD:
        enrichment['status'] = 'review_needed'
        review_reasons.append('confidence_between_0.50_and_0.85')
    else:
        enrichment['status'] = 'below_threshold'
        return {'enrichment': enrichment, 'review': None, 'updates': updates}

    # Resolve conflicts per field
    for field in ['artist', 'title', 'album', 'year', 'genre']:
        existing_val = track.get(field)
        enriched_val = best_candidate.get(field)

        resolution = resolver.resolve(field, existing_val, enriched_val)
        classification = resolution['classification']

        if classification == 'confirmed':
            enrichment['fields_confirmed'].append(field)
        elif classification == 'supplement' and best_score >= REVIEW_THRESHOLD:
            if not dry_run:
                updates[field] = resolution['value']
            enrichment['fields_updated'].append(field)
        elif classification == 'likely_correction':
            enrichment['conflicts'].append({
                'field': field,
                'existing': resolution['existing'],
                'suggested': resolution['suggested'],
                'similarity': resolution.get('similarity'),
            })
            review_reasons.append(f'likely_correction:{field}')
        elif classification == 'alternative':
            enrichment['conflicts'].append({
                'field': field,
                'existing': existing_val,
                'alternative': resolution.get('alternative'),
            })

        # Auto-accept updates for high-confidence matches
        if best_score >= AUTO_ACCEPT_THRESHOLD and classification == 'supplement':
            pass  # already handled above
        if best_score >= AUTO_ACCEPT_THRESHOLD and classification in ('likely_correction', 'alternative'):
            # Even auto-accepted tracks flag corrections for review
            pass

    # Store MB IDs for reference
    enrichment['mb_recording_id'] = best_candidate.get('mb_recording_id')
    enrichment['mb_release_id'] = best_candidate.get('mb_release_id')

    # Artwork enrichment
    art_info = None
    if not skip_artwork and best_candidate.get('mb_release_id'):
        art_info = caa_client.get_cover_art(best_candidate['mb_release_id'])

    # Fallback to iTunes if CAA has no art
    if not skip_artwork and not art_info and artist and title:
        art_info = itunes_client.search_artwork(artist, title)

    if not skip_artwork and art_info:
        new_score = artwork_selector.score_artwork(
            width=art_info.get('width', 0),
            source=art_info.get('source', 'coverartarchive'),
            art_type=art_info.get('type', 'unknown'),
            fmt=art_info.get('format', 'jpeg'),
        )

        existing_art_score = 0
        if track.get('artwork_path'):
            existing_art_score = artwork_selector.score_artwork(
                width=500, source='existing', art_type='front', fmt='jpeg',
            )

        should_upgrade = artwork_selector.should_upgrade(existing_art_score, new_score)
        enrichment['artwork'] = {
            'available': True,
            'new_score': new_score,
            'existing_score': existing_art_score,
            'upgrade': should_upgrade,
            'source': art_info.get('source', 'unknown'),
        }

        if should_upgrade and track.get('artwork_path'):
            review_reasons.append('artwork_upgrade_with_existing')

        if should_upgrade and not dry_run:
            art_ext = 'jpg' if art_info['format'] in ('jpeg', 'jpg') else 'png'
            art_path = output_dir / 'artwork' / f"{track_id}_enriched.{art_ext}"
            art_path.parent.mkdir(parents=True, exist_ok=True)

            # Use appropriate download method based on source
            download_success = False
            if art_info['source'] == 'itunes':
                download_success = itunes_client.download_art(art_info['url'], art_path)
            else:
                download_success = caa_client.download_art(art_info['url'], art_path)

            if download_success:
                updates['artwork_path'] = str(art_path)
                enrichment['fields_updated'].append('artwork')

    # Build review entry if needed
    if review_reasons:
        suggestions = [{
            'source': best_candidate.get('source', 'musicbrainz'),
            'confidence': best_score,
            'fields': {f: best_candidate.get(f) for f in FIELD_WEIGHTS},
        }]
        # Add second candidate if close
        if len(scored) >= 2 and scored[1][0] >= REVIEW_THRESHOLD:
            suggestions.append({
                'source': scored[1][1].get('source', 'musicbrainz'),
                'confidence': scored[1][0],
                'fields': {f: scored[1][1].get(f) for f in FIELD_WEIGHTS},
            })

        review = {
            'track_id': track_id,
            'filename': track.get('original_filename', ''),
            'reason': review_reasons,
            'existing': {f: track.get(f) for f in ['artist', 'title', 'album', 'year', 'genre']},
            'suggestions': suggestions,
            'conflicts': enrichment['conflicts'],
        }

    return {'enrichment': enrichment, 'review': review, 'updates': updates}


def check_connectivity(mb_client: MusicBrainzClient) -> bool:
    """Ping MusicBrainz to verify connectivity."""
    print("Checking MusicBrainz connectivity...")
    if mb_client.ping():
        print("  MusicBrainz API is reachable.")
        return True
    print("  MusicBrainz API is unreachable.", file=sys.stderr)
    return False


def _normalize_input(raw: dict) -> Tuple[dict, str]:
    """Normalize input to dict-keyed tracks format.

    Supports:
      - metadata_base.json: tracks is a dict keyed by file path
      - manifest.json: tracks is a list of track objects

    Returns (normalized_metadata, format_name).
    """
    tracks = raw.get('tracks', {})
    if isinstance(tracks, list):
        # manifest.json format — convert list to dict keyed by track id
        tracks_dict = {}
        for track in tracks:
            key = track.get('path') or track['id']
            tracks_dict[key] = track
            # Ensure required fields exist
            track.setdefault('original_filename', key.split('/')[-1])
        raw['tracks'] = tracks_dict
        return raw, 'manifest'
    return raw, 'metadata_base'


def _denormalize_output(metadata: dict, fmt: str) -> dict:
    """Convert back to original format for output."""
    if fmt == 'manifest':
        output = dict(metadata)
        output['tracks'] = list(metadata['tracks'].values())
        output['generated'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        return output
    return metadata


def run_offline_fallback(input_path: Path, output_dir: Path):
    """Copy base metadata as enriched with status=skipped."""
    print("Running in offline mode — copying base metadata as-is.")
    with open(input_path) as f:
        raw = json.load(f)

    metadata, fmt = _normalize_input(raw)

    for track in metadata['tracks'].values():
        track['enrichment'] = {
            'status': 'skipped',
            'reason': 'offline',
            'timestamp': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        }

    output = _denormalize_output(metadata, fmt)
    out_path = output_dir / 'metadata_enriched.json'
    with open(out_path, 'w') as f:
        json.dump(output, f, indent=2)
    print(f"Wrote {out_path} (offline fallback, {len(metadata['tracks'])} tracks)")


def main():
    parser = argparse.ArgumentParser(
        description='Enrich track metadata using external APIs'
    )
    parser.add_argument(
        '--input', type=Path, required=True,
        help='Path to metadata_base.json',
    )
    parser.add_argument(
        '--output', type=Path, required=True,
        help='Output directory for enriched metadata and artwork',
    )
    parser.add_argument(
        '--resume', action='store_true',
        help='Resume from previous enrichment state',
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help='Score and match without writing updates',
    )
    parser.add_argument(
        '--skip-artwork', action='store_true',
        help='Skip album art fetching',
    )
    parser.add_argument(
        '--discogs-token', type=str, default=os.environ.get('DISCOGS_TOKEN'),
        help='Discogs API token (optional, for future use)',
    )
    parser.add_argument(
        '--lastfm-key', type=str, default=os.environ.get('LASTFM_API_KEY'),
        help='Last.fm API key (optional, for future use)',
    )
    parser.add_argument(
        '--limit', type=int, default=0,
        help='Limit number of tracks to process (0 = unlimited)',
    )

    args = parser.parse_args()

    # Validate input
    if not args.input.exists():
        print(f"Error: Input file not found: {args.input}", file=sys.stderr)
        return 1

    args.output.mkdir(parents=True, exist_ok=True)

    # When resuming, prefer the enriched output (preserves prior work)
    enriched_path = args.output / 'metadata_enriched.json'
    if args.resume and enriched_path.exists():
        print(f"Resuming from enriched output: {enriched_path}")
        with open(enriched_path) as f:
            raw = json.load(f)
    else:
        print(f"Loading metadata from {args.input}...")
        with open(args.input) as f:
            raw = json.load(f)

    metadata, input_format = _normalize_input(raw)
    total_tracks = len(metadata.get('tracks', {}))
    print(f"Found {total_tracks} tracks (format: {input_format})")

    # Initialize clients
    mb_limiter = RateLimiter(rate=1.0)
    mb_client = MusicBrainzClient(mb_limiter)

    # Connectivity check
    if not check_connectivity(mb_client):
        run_offline_fallback(args.input, args.output)
        return 0

    caa_limiter = RateLimiter(rate=1.0)
    caa_client = CoverArtArchiveClient(caa_limiter)
    itunes_limiter = RateLimiter(rate=1.0)
    itunes_client = ITunesArtworkClient(itunes_limiter)
    scorer = MatchScorer()
    resolver = ConflictResolver()
    artwork_selector = ArtworkSelector()

    # Resume state
    state_file = args.output / '.enrichment_state.json'
    state = EnrichmentState(state_file) if args.resume else EnrichmentState(state_file)
    if args.resume:
        print(f"Resuming: {state.count} tracks already processed")

    # Load dry-run report if available (replay cached results instead of re-querying)
    dry_run_cache = {}
    if not args.dry_run:
        report_path = args.output / 'dry_run_report.json'
        if report_path.exists():
            try:
                with open(report_path) as f:
                    report = json.load(f)
                if report.get('mode') == 'dry_run':
                    for entry in report.get('tracks', []):
                        tid = entry.get('track_id')
                        if tid:
                            dry_run_cache[tid] = entry
                    print(f"Loaded dry-run report: {len(dry_run_cache)} cached results")
            except (json.JSONDecodeError, KeyError):
                pass

    # Prepare track list
    track_items = list(metadata['tracks'].items())
    if args.limit > 0:
        track_items = track_items[:args.limit]

    # Process tracks
    review_queue = []
    dry_run_results = []  # Collect proposed changes for dry-run report
    processed = 0
    skipped = 0
    auto_accepted = 0
    flagged = 0
    no_match = 0
    from_cache = 0

    for i, (file_key, track) in enumerate(track_items):
        track_id = track.get('id', '')

        # Skip already processed (resume)
        if args.resume and state.is_processed(track_id):
            skipped += 1
            continue

        print(f"[{i+1}/{len(track_items)}] {track.get('original_filename', track_id)[:60]}...")

        # Check dry-run cache first (avoid re-querying APIs)
        cached = dry_run_cache.get(track_id) if not args.dry_run else None
        if cached:
            enrichment = cached['enrichment']
            enrichment['timestamp'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            updates = dict(cached.get('proposed_updates', {}))

            # Artwork was skipped during dry-run — download now if upgrade was flagged
            art_info = enrichment.get('artwork', {})
            if (not args.skip_artwork and art_info.get('upgrade')
                    and enrichment.get('mb_release_id')
                    and 'artwork_path' not in updates):
                caa_art = caa_client.get_cover_art(enrichment['mb_release_id'])
                if caa_art:
                    art_ext = 'jpg' if caa_art['format'] in ('jpeg', 'jpg') else 'png'
                    art_path = args.output / 'artwork' / f"{track_id}_enriched.{art_ext}"
                    art_path.parent.mkdir(parents=True, exist_ok=True)
                    if caa_client.download_art(caa_art['url'], art_path):
                        updates['artwork_path'] = str(art_path)
                        enrichment.setdefault('fields_updated', []).append('artwork')

            result = {
                'enrichment': enrichment,
                'updates': updates,
                'review': cached.get('review'),
            }
            from_cache += 1
        else:
            try:
                result = enrich_track(
                    track, mb_client, caa_client, itunes_client, scorer, resolver,
                    artwork_selector, args.output,
                    skip_artwork=args.skip_artwork,
                    dry_run=args.dry_run,
                )
            except Exception as e:
                print(f"  Error: {e}", file=sys.stderr)
                metadata['tracks'][file_key]['enrichment'] = {
                    'status': 'error',
                    'error': str(e),
                    'timestamp': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                }
                state.mark_processed(track_id)
                continue

        # Apply enrichment
        enrichment = result['enrichment']
        metadata['tracks'][file_key]['enrichment'] = enrichment

        # Apply field updates (unless dry-run)
        if not args.dry_run:
            for field, value in result['updates'].items():
                metadata['tracks'][file_key][field] = value

        # Collect dry-run proposed changes (store full result for replay)
        if args.dry_run:
            dry_run_results.append({
                'track_id': track_id,
                'filename': track.get('original_filename', ''),
                'enrichment': enrichment,
                'proposed_updates': result['updates'],
                'review': result['review'],
            })

        # Collect review items
        if result['review']:
            review_queue.append(result['review'])
            flagged += 1

        # Stats
        status = enrichment.get('status', '')
        if status == 'auto_accepted':
            auto_accepted += 1
            conf = enrichment.get('match_confidence', 0)
            updated = enrichment.get('fields_updated', [])
            print(f"  ✓ Auto-accepted (confidence: {conf:.2f}, updated: {updated})")
        elif status == 'review_needed':
            conf = enrichment.get('match_confidence', 0)
            print(f"  ? Review needed (confidence: {conf:.2f})")
        elif status == 'no_match':
            no_match += 1
            print(f"  - No match found")
        elif status == 'no_metadata':
            print(f"  ! No artist or title — flagged")
        elif status == 'below_threshold':
            no_match += 1
            conf = enrichment.get('match_confidence', 0)
            print(f"  - Below threshold (confidence: {conf:.2f})")

        state.mark_processed(track_id)
        processed += 1

        # Checkpoint every 25 tracks
        if processed % 25 == 0:
            if args.dry_run:
                _save_dry_run_report(dry_run_results, args.output)
            else:
                _save_checkpoint(metadata, review_queue, state, args.output, input_format)
            print(f"  Checkpoint saved ({processed} processed)")

    # Final save
    if args.dry_run:
        _save_dry_run_report(dry_run_results, args.output)
    else:
        _save_checkpoint(metadata, review_queue, state, args.output, input_format)
        # Clean up dry-run report after successful apply
        report_path = args.output / 'dry_run_report.json'
        if report_path.exists():
            report_path.unlink()
            print("Dry-run report consumed and removed.")

    # Summary
    print(f"\n{'=' * 50}")
    print(f"Enrichment complete{'  [DRY RUN]' if args.dry_run else ''}")
    print(f"  Total tracks:    {len(track_items)}")
    print(f"  Processed:       {processed}")
    if from_cache:
        print(f"  From cache:      {from_cache} (via dry-run report)")
    print(f"  Skipped (resume):{skipped}")
    print(f"  Auto-accepted:   {auto_accepted}")
    print(f"  Flagged review:  {flagged}")
    print(f"  No match:        {no_match}")
    print(f"\nOutput:")
    if args.dry_run:
        print(f"  {args.output / 'dry_run_report.json'} ({len(dry_run_results)} tracks with proposed changes)")
    else:
        print(f"  {args.output / 'metadata_enriched.json'}")
        if review_queue:
            print(f"  {args.output / 'review_queue.json'} ({len(review_queue)} items)")
        print(f"  {state_file}")

    return 0


def _save_checkpoint(metadata: dict, review_queue: list, state: EnrichmentState,
                     output_dir: Path, fmt: str = 'metadata_base'):
    """Save enriched metadata, review queue, and state."""
    output = _denormalize_output(metadata, fmt)
    enriched_path = output_dir / 'metadata_enriched.json'
    with open(enriched_path, 'w') as f:
        json.dump(output, f, indent=2)

    if review_queue:
        review_path = output_dir / 'review_queue.json'
        with open(review_path, 'w') as f:
            json.dump({
                'version': 1,
                'generated': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                'items': review_queue,
            }, f, indent=2)

    state.save()


def _save_dry_run_report(results: list, output_dir: Path):
    """Save dry-run report with all proposed changes."""
    report_path = output_dir / 'dry_run_report.json'
    with open(report_path, 'w') as f:
        json.dump({
            'version': 1,
            'generated': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'mode': 'dry_run',
            'summary': {
                'total': len(results),
                'auto_accept': sum(1 for r in results if r['enrichment'].get('status') == 'auto_accepted'),
                'review_needed': sum(1 for r in results if r['enrichment'].get('status') == 'review_needed'),
                'with_updates': sum(1 for r in results if r['proposed_updates']),
                'with_conflicts': sum(1 for r in results if r['enrichment'].get('conflicts')),
            },
            'tracks': results,
        }, f, indent=2)


if __name__ == '__main__':
    sys.exit(main())

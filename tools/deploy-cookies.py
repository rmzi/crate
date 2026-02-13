#!/usr/bin/env python3
"""
Crate Cookie Deployer

Generates signed cookies and deploys config.js with them embedded.
"""

import argparse
import base64
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

# Configuration
AWS_PROFILE = os.environ.get('AWS_PROFILE', 'personal')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
SECRET_NAME = os.environ.get('SECRET_NAME', 'crate-cloudfront-signing-key')


def get_env_config(env_name):
    """Get environment config from environment variables."""
    prefix = env_name.upper()
    domain = os.environ.get(f'{prefix}_DOMAIN')
    bucket = os.environ.get(f'{prefix}_BUCKET')
    dist_id = os.environ.get(f'{prefix}_DISTRIBUTION_ID')

    if not all([domain, bucket, dist_id]):
        print(f"Error: Missing environment variables for '{env_name}'.")
        print(f"Required: {prefix}_DOMAIN, {prefix}_BUCKET, {prefix}_DISTRIBUTION_ID")
        print(f"\nExample:")
        print(f"  export {prefix}_DOMAIN=music.example.com")
        print(f"  export {prefix}_BUCKET=music-site.example.com")
        print(f"  export {prefix}_DISTRIBUTION_ID=E1234567890")
        sys.exit(1)

    return {
        'domain': domain,
        'bucket': bucket,
        'distribution_id': dist_id,
    }


def get_signing_key():
    """Fetch signing key from Secrets Manager."""
    session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
    client = session.client('secretsmanager')
    response = client.get_secret_value(SecretId=SECRET_NAME)
    secret = json.loads(response['SecretString'])
    return secret['private_key'], secret['key_pair_id']


def rsa_sign(message: bytes, private_key_pem: str) -> bytes:
    """Sign a message using RSA-SHA1 (required by CloudFront)."""
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode(),
        password=None,
        backend=default_backend()
    )
    return private_key.sign(message, padding.PKCS1v15(), hashes.SHA1())


def make_cloudfront_safe(s: str) -> str:
    """Make base64 string safe for CloudFront cookies."""
    return s.replace('+', '-').replace('=', '_').replace('/', '~')


def generate_signed_cookies(key_pair_id: str, private_key_pem: str, hours: int, domain: str) -> dict:
    """Generate CloudFront signed cookies."""
    expires = datetime.now(timezone.utc) + timedelta(hours=hours)
    resource = f"https://{domain}/*"

    policy = {
        "Statement": [{
            "Resource": resource,
            "Condition": {
                "DateLessThan": {
                    "AWS:EpochTime": int(expires.timestamp())
                }
            }
        }]
    }

    policy_json = json.dumps(policy, separators=(',', ':'))
    policy_b64 = make_cloudfront_safe(base64.b64encode(policy_json.encode()).decode())

    signature = rsa_sign(policy_json.encode(), private_key_pem)
    signature_b64 = make_cloudfront_safe(base64.b64encode(signature).decode())

    return {
        'CloudFront-Policy': policy_b64,
        'CloudFront-Signature': signature_b64,
        'CloudFront-Key-Pair-Id': key_pair_id
    }, expires


def main():
    parser = argparse.ArgumentParser(description='Deploy auth page with fresh signed cookies')
    parser.add_argument('--env', choices=['prod', 'dev'], default='prod', help='Environment to deploy to (default: prod)')
    parser.add_argument('--hours', type=int, default=8760, help='Cookie validity in hours (default: 8760 = 1 year)')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be deployed without deploying')
    args = parser.parse_args()

    # Get environment config
    env = get_env_config(args.env)
    domain = env['domain']
    bucket = env['bucket']
    distribution_id = env['distribution_id']

    print(f"Deploying to {args.env}: {domain}")

    # Get signing key
    print("Fetching signing key from Secrets Manager...")
    private_key, key_pair_id = get_signing_key()

    # Generate cookies
    print(f"Generating cookies valid for {args.hours} hours...")
    cookies, expires = generate_signed_cookies(key_pair_id, private_key, args.hours, domain)

    print(f"Cookies valid until: {expires.isoformat()}")

    # Read config.js template (modular structure)
    script_dir = Path(__file__).parent
    config_js_path = script_dir.parent / 'www' / 'js' / 'config.js'

    with open(config_js_path) as f:
        js = f.read()

    # Embed cookies (handles both 'const' and 'export const')
    cookies_js = json.dumps(cookies, indent=2)
    js = re.sub(
        r'(export )?const SIGNED_COOKIES = null;',
        f'\\1const SIGNED_COOKIES = {cookies_js};',
        js
    )

    if args.dry_run:
        print("\n[DRY RUN] Would deploy js/config.js with cookies:")
        print(f"  Expires: {expires.isoformat()}")
        print(f"  Key-Pair-Id: {key_pair_id}")
        return 0

    # Upload to S3
    print(f"Uploading js/config.js to S3 ({bucket})...")
    session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
    s3 = session.client('s3')

    s3.put_object(
        Bucket=bucket,
        Key='js/config.js',
        Body=js,
        ContentType='application/javascript',
        CacheControl='no-cache, no-store, must-revalidate'
    )

    # Invalidate CloudFront cache
    print("Invalidating CloudFront cache...")
    cf = session.client('cloudfront')
    cf.create_invalidation(
        DistributionId=distribution_id,
        InvalidationBatch={
            'Paths': {'Quantity': 1, 'Items': ['/js/config.js']},
            'CallerReference': str(datetime.now(timezone.utc).timestamp())
        }
    )

    print(f"\nDone! js/config.js deployed with cookies.")
    print(f"  URL: https://{domain}/")
    print(f"  Valid until: {expires.isoformat()}")

    return 0


if __name__ == '__main__':
    sys.exit(main())

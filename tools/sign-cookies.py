#!/usr/bin/env python3
"""
Crate Signed Cookie Generator

Generates CloudFront signed cookies for audio streaming access.
"""

import argparse
import base64
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import boto3
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

# Configuration
AWS_PROFILE = os.environ.get('AWS_PROFILE', 'personal')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
SECRET_NAME = os.environ.get('SECRET_NAME', 'crate-cloudfront-signing-key')
DOMAIN = os.environ.get('DOMAIN', 'example.com')


def get_signing_key():
    """Fetch signing key from Secrets Manager."""
    session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
    client = session.client('secretsmanager')

    response = client.get_secret_value(SecretId=SECRET_NAME)
    secret = json.loads(response['SecretString'])

    return secret['private_key'], secret['key_pair_id']


def rsa_sign(message: bytes, private_key_pem: str) -> bytes:
    """Sign a message using RSA-SHA1 (required by CloudFront)."""
    from cryptography.hazmat.backends import default_backend

    private_key = serialization.load_pem_private_key(
        private_key_pem.encode(),
        password=None,
        backend=default_backend()
    )

    signature = private_key.sign(
        message,
        padding.PKCS1v15(),
        hashes.SHA1()
    )

    return signature


def make_cloudfront_safe(s: str) -> str:
    """Make base64 string safe for CloudFront cookies."""
    return s.replace('+', '-').replace('=', '_').replace('/', '~')


def generate_signed_cookies(
    resource: str,
    key_pair_id: str,
    private_key_pem: str,
    expires: datetime
) -> dict:
    """Generate CloudFront signed cookies."""
    # Create policy
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
    policy_b64 = make_cloudfront_safe(
        base64.b64encode(policy_json.encode()).decode()
    )

    # Sign policy
    signature = rsa_sign(policy_json.encode(), private_key_pem)
    signature_b64 = make_cloudfront_safe(
        base64.b64encode(signature).decode()
    )

    return {
        'CloudFront-Policy': policy_b64,
        'CloudFront-Signature': signature_b64,
        'CloudFront-Key-Pair-Id': key_pair_id
    }


def main():
    parser = argparse.ArgumentParser(
        description='Generate CloudFront signed cookies for Crate'
    )
    parser.add_argument(
        '--hours',
        type=int,
        default=24,
        help='Cookie validity in hours (default: 24)'
    )
    parser.add_argument(
        '--format',
        choices=['js', 'curl', 'env', 'json'],
        default='js',
        help='Output format (default: js)'
    )

    args = parser.parse_args()

    # Get signing key
    print("Fetching signing key from Secrets Manager...", file=sys.stderr)
    private_key, key_pair_id = get_signing_key()

    # Generate cookies
    expires = datetime.now(timezone.utc) + timedelta(hours=args.hours)
    resource = f"https://{DOMAIN}/*"

    cookies = generate_signed_cookies(
        resource=resource,
        key_pair_id=key_pair_id,
        private_key_pem=private_key,
        expires=expires
    )

    print(f"Generated cookies valid until {expires.isoformat()}Z", file=sys.stderr)

    # Output in requested format
    if args.format == 'js':
        print("// Paste this in browser console to set cookies:")
        for name, value in cookies.items():
            print(f"document.cookie = '{name}={value}; path=/; secure; samesite=strict';")

    elif args.format == 'curl':
        cookie_header = '; '.join(f"{k}={v}" for k, v in cookies.items())
        print(f"curl -H 'Cookie: {cookie_header}' https://{DOMAIN}/audio/test.mp3")

    elif args.format == 'env':
        for name, value in cookies.items():
            print(f"export {name.replace('-', '_')}='{value}'")

    elif args.format == 'json':
        print(json.dumps(cookies, indent=2))

    return 0


if __name__ == '__main__':
    sys.exit(main())

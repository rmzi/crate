#!/usr/bin/env bash
set -euo pipefail

# Load config from environment or .env
SITE_BUCKET="${SITE_BUCKET:?Set SITE_BUCKET env var (e.g. music-site.example.com)}"
CF_DISTRIBUTION_ID="${CF_DISTRIBUTION_ID:?Set CF_DISTRIBUTION_ID env var}"
AWS_PROFILE="${AWS_PROFILE:-default}"

echo "Deploying to s3://${SITE_BUCKET}..."

# Sync all files except config (has cookies)
AWS_PROFILE="$AWS_PROFILE" aws s3 sync dist/ "s3://${SITE_BUCKET}/" \
  --exclude '*.html' --exclude 'js/config.js'

# Upload HTML with no-cache
AWS_PROFILE="$AWS_PROFILE" aws s3 cp dist/index.html "s3://${SITE_BUCKET}/index.html"

# Upload service worker with no-cache
AWS_PROFILE="$AWS_PROFILE" aws s3 cp dist/sw.js "s3://${SITE_BUCKET}/sw.js" \
  --cache-control 'max-age=0,no-cache'

# Upload manifest with correct content type
AWS_PROFILE="$AWS_PROFILE" aws s3 cp dist/app.webmanifest "s3://${SITE_BUCKET}/app.webmanifest" \
  --content-type 'application/manifest+json'

# Invalidate CloudFront cache
echo "Invalidating CloudFront cache..."
AWS_PROFILE="$AWS_PROFILE" aws cloudfront create-invalidation \
  --distribution-id "$CF_DISTRIBUTION_ID" --paths '/*'

echo "Done!"

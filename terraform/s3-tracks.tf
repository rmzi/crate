# ============================================================================
# Tracks Bucket - Private audio files (accessible only via CloudFront + signed cookies)
# ============================================================================

resource "aws_s3_bucket" "tracks" {
  bucket = local.tracks_bucket
}

# Block ALL public access - this bucket is completely private
resource "aws_s3_bucket_public_access_block" "tracks" {
  bucket = aws_s3_bucket.tracks.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable versioning for manifest.json protection
resource "aws_s3_bucket_versioning" "tracks" {
  bucket = aws_s3_bucket.tracks.id
  versioning_configuration {
    status = "Enabled"
  }
}

# CORS configuration for audio streaming
resource "aws_s3_bucket_cors_configuration" "tracks" {
  bucket = aws_s3_bucket.tracks.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = [
      "https://${local.domain_name}"
    ]
    expose_headers  = ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"]
    max_age_seconds = 3600
  }
}

# Only CloudFront can access this bucket
resource "aws_s3_bucket_policy" "tracks" {
  bucket = aws_s3_bucket.tracks.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontServicePrincipal"
        Effect    = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.tracks.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.main.arn
          }
        }
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.tracks]
}

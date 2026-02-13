# ============================================================================
# CloudFront Distribution
# ============================================================================

# Origin Access Control for site bucket
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${local.site_bucket}-oac"
  description                       = "OAC for ${local.site_bucket}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Origin Access Control for tracks bucket
resource "aws_cloudfront_origin_access_control" "tracks" {
  name                              = "${local.tracks_bucket}-oac"
  description                       = "OAC for ${local.tracks_bucket}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Response headers policy for security
resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${var.subdomain}-security-headers"
  comment = "Security headers for ${local.domain_name}"

  security_headers_config {
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }
  }
}

# Main CloudFront distribution
resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = [local.domain_name]
  price_class         = "PriceClass_100"
  comment             = "${var.site_name} - Crate Streaming"

  # Origin 1: Site bucket (static files)
  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  # Origin 2: Tracks bucket (audio files)
  origin {
    domain_name              = aws_s3_bucket.tracks.bucket_regional_domain_name
    origin_id                = "tracks"
    origin_access_control_id = aws_cloudfront_origin_access_control.tracks.id
  }

  # Default behavior: Site bucket (public)
  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "site"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # Audio behavior: Tracks bucket (requires signed cookies)
  ordered_cache_behavior {
    path_pattern               = "/audio/*"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "tracks"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = false  # Don't compress audio files
    trusted_key_groups         = [aws_cloudfront_key_group.signing.id]
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    forwarded_values {
      query_string = false
      headers      = ["Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"]
      cookies {
        forward = "all"  # Forward cookies for signed cookie validation
      }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 604800  # 7 days for audio files
  }

  # Manifest.json behavior: Tracks bucket (requires signed cookies)
  ordered_cache_behavior {
    path_pattern               = "/manifest.json"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "tracks"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    trusted_key_groups         = [aws_cloudfront_key_group.signing.id]
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    forwarded_values {
      query_string = false
      headers      = ["Origin"]
      cookies {
        forward = "all"
      }
    }

    min_ttl     = 0
    default_ttl = 60     # Short TTL for manifest updates
    max_ttl     = 300
  }

  # Artwork behavior: Tracks bucket (requires signed cookies)
  ordered_cache_behavior {
    path_pattern               = "/artwork/*"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "tracks"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    trusted_key_groups         = [aws_cloudfront_key_group.signing.id]
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    forwarded_values {
      query_string = false
      headers      = ["Origin"]
      cookies {
        forward = "all"
      }
    }

    min_ttl     = 0
    default_ttl = 86400   # 1 day for images
    max_ttl     = 604800  # 7 days
  }

  # Handle SPA routing
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 403
    response_code      = 403
    response_page_path = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.wildcard.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

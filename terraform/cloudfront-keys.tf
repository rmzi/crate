# ============================================================================
# CloudFront Signing Key Pair for Signed Cookies
# ============================================================================

# Generate RSA key pair for CloudFront signed cookies
resource "tls_private_key" "signing" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

# Create CloudFront public key
resource "aws_cloudfront_public_key" "signing" {
  name        = "${var.subdomain}-signing-key"
  comment     = "Public key for ${local.domain_name} signed cookies"
  encoded_key = tls_private_key.signing.public_key_pem
}

# Create CloudFront key group
resource "aws_cloudfront_key_group" "signing" {
  name    = "${var.subdomain}-key-group"
  comment = "Key group for ${local.domain_name} signed cookies"
  items   = [aws_cloudfront_public_key.signing.id]
}

# Store private key in Secrets Manager for the upload tool and frontend
resource "aws_secretsmanager_secret" "signing_private_key" {
  name        = "${var.subdomain}-cloudfront-signing-key"
  description = "Private key for signing CloudFront cookies for ${local.domain_name}"
}

resource "aws_secretsmanager_secret_version" "signing_private_key" {
  secret_id = aws_secretsmanager_secret.signing_private_key.id
  secret_string = jsonencode({
    private_key  = tls_private_key.signing.private_key_pem
    key_pair_id  = aws_cloudfront_public_key.signing.id
    domain       = local.domain_name
    cookie_ttl_hours = var.cookie_ttl_hours
  })
}

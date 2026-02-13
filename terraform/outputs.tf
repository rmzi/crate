output "site_url" {
  description = "URL of the music streaming site"
  value       = "https://${local.domain_name}"
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.main.id
}

output "cloudfront_domain_name" {
  description = "CloudFront domain name"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "site_bucket_name" {
  description = "Name of the site S3 bucket"
  value       = aws_s3_bucket.site.id
}

output "tracks_bucket_name" {
  description = "Name of the tracks S3 bucket"
  value       = aws_s3_bucket.tracks.id
}

output "cloudfront_key_pair_id" {
  description = "CloudFront key pair ID for signing cookies"
  value       = aws_cloudfront_public_key.signing.id
}

output "signing_private_key_secret_arn" {
  description = "ARN of the Secrets Manager secret containing the signing private key"
  value       = aws_secretsmanager_secret.signing_private_key.arn
}

output "upload_role_arn" {
  description = "ARN of the IAM role for upload tool"
  value       = aws_iam_role.upload.arn
}

output "metadata_agent_role_arn" {
  description = "ARN of the IAM role for metadata agent"
  value       = aws_iam_role.metadata_agent.arn
}

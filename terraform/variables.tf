variable "aws_profile" {
  description = "AWS profile to use"
  type        = string
  default     = "personal"
}

variable "aws_region" {
  description = "AWS region (must be us-east-1 for CloudFront)"
  type        = string
  default     = "us-east-1"
}

variable "root_domain" {
  description = "Root domain for the site"
  type        = string
  default     = ""
}

variable "subdomain" {
  description = "Subdomain for the streaming site"
  type        = string
  default     = ""
}

variable "site_name" {
  description = "Human-readable name for the site"
  type        = string
  default     = "Crate"
}

variable "secret_name" {
  description = "AWS Secrets Manager secret name for CloudFront signing key"
  type        = string
  default     = "crate-cloudfront-signing-key"
}

variable "cookie_ttl_hours" {
  description = "TTL for signed cookies in hours"
  type        = number
  default     = 24
}

locals {
  domain_name    = "${var.subdomain}.${var.root_domain}"
  site_bucket    = "${var.subdomain}-site.${var.root_domain}"
  tracks_bucket  = "${var.subdomain}-tracks.${var.root_domain}"
}

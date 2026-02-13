terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

# Get current AWS account info
data "aws_caller_identity" "current" {}

# Get existing Route53 zone from rmzi.world
data "aws_route53_zone" "main" {
  name         = var.root_domain
  private_zone = false
}

# Get existing wildcard certificate from rmzi.world infrastructure
data "aws_acm_certificate" "wildcard" {
  domain      = var.root_domain
  statuses    = ["ISSUED"]
  most_recent = true
}

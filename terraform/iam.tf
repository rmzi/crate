# ============================================================================
# IAM Roles and Policies
# ============================================================================

# Upload Tool Role - for uploading audio to S3
resource "aws_iam_role" "upload" {
  name = "${var.subdomain}-upload-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "upload" {
  name = "${var.subdomain}-upload-policy"
  role = aws_iam_role.upload.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "UploadAudio"
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.tracks.arn}/audio/*"
      },
      {
        Sid    = "ManageManifest"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.tracks.arn}/manifest.json"
      },
      {
        Sid    = "GetSigningKey"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = aws_secretsmanager_secret.signing_private_key.arn
      }
    ]
  })
}

# Metadata Agent Role - for scanning and tagging files
resource "aws_iam_role" "metadata_agent" {
  name = "${var.subdomain}-metadata-agent-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "metadata_agent" {
  name = "${var.subdomain}-metadata-agent-policy"
  role = aws_iam_role.metadata_agent.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ListBucket"
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.tracks.arn
      },
      {
        Sid    = "ReadAudioFiles"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectTagging"
        ]
        Resource = "${aws_s3_bucket.tracks.arn}/*"
      },
      {
        Sid    = "UpdateTags"
        Effect = "Allow"
        Action = [
          "s3:PutObjectTagging"
        ]
        Resource = "${aws_s3_bucket.tracks.arn}/audio/*"
      },
      {
        Sid    = "ManageManifest"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.tracks.arn}/manifest.json"
      }
    ]
  })
}

# IAM user for local development (optional - can use profile instead)
resource "aws_iam_user" "developer" {
  name = "${var.subdomain}-developer"
}

resource "aws_iam_user_policy" "developer" {
  name = "${var.subdomain}-developer-policy"
  user = aws_iam_user.developer.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AssumeUploadRole"
        Effect = "Allow"
        Action = "sts:AssumeRole"
        Resource = aws_iam_role.upload.arn
      },
      {
        Sid    = "AssumeMetadataAgentRole"
        Effect = "Allow"
        Action = "sts:AssumeRole"
        Resource = aws_iam_role.metadata_agent.arn
      },
      {
        Sid    = "SyncSiteBucket"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.site.arn,
          "${aws_s3_bucket.site.arn}/*"
        ]
      },
      {
        Sid    = "InvalidateCloudFront"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateInvalidation"
        ]
        Resource = aws_cloudfront_distribution.main.arn
      }
    ]
  })
}

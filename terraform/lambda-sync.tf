# ============================================================================
# Lambda Function - State Sync
# ============================================================================

resource "aws_lambda_function" "sync" {
  function_name = "${var.subdomain}-state-sync"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 10
  memory_size   = 128
  filename         = "${path.module}/lambda/sync.zip"
  source_code_hash = filebase64sha256("${path.module}/lambda/sync.zip")
  role = aws_iam_role.sync_lambda.arn

  environment {
    variables = {
      BUCKET_NAME = aws_s3_bucket.tracks.id
      SYNC_PREFIX = "sync/"
    }
  }
}

resource "aws_lambda_function_url" "sync" {
  function_name      = aws_lambda_function.sync.function_name
  authorization_type = "NONE"

  cors {
    allow_origins     = ["https://${local.domain_name}"]
    allow_methods     = ["GET", "PUT"]
    allow_headers     = ["Content-Type"]
    max_age           = 3600
  }
}

resource "aws_iam_role" "sync_lambda" {
  name = "${var.subdomain}-sync-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "sync_lambda_logs" {
  role       = aws_iam_role.sync_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "sync_lambda_s3" {
  name = "${var.subdomain}-sync-lambda-s3"
  role = aws_iam_role.sync_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.tracks.arn}/sync/*"
      }
    ]
  })
}

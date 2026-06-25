terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ---------------------------------------------------------------------------
# Networking — minimal VPC for Aurora. Two subnets across AZs (RDS requires
# at least 2 for a subnet group), one security group scoped to Postgres only.
# ---------------------------------------------------------------------------

resource "aws_vpc" "sybil" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "sybil-vpc" }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_subnet" "sybil_a" {
  vpc_id                  = aws_vpc.sybil.id
  cidr_block              = "10.42.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
  tags                    = { Name = "sybil-subnet-a" }
}

resource "aws_subnet" "sybil_b" {
  vpc_id                  = aws_vpc.sybil.id
  cidr_block              = "10.42.2.0/24"
  availability_zone       = data.aws_availability_zones.available.names[1]
  map_public_ip_on_launch = true
  tags                    = { Name = "sybil-subnet-b" }
}

resource "aws_internet_gateway" "sybil" {
  vpc_id = aws_vpc.sybil.id
  tags   = { Name = "sybil-igw" }
}

resource "aws_route_table" "sybil" {
  vpc_id = aws_vpc.sybil.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.sybil.id
  }
  tags = { Name = "sybil-rt" }
}

resource "aws_route_table_association" "a" {
  subnet_id      = aws_subnet.sybil_a.id
  route_table_id = aws_route_table.sybil.id
}

resource "aws_route_table_association" "b" {
  subnet_id      = aws_subnet.sybil_b.id
  route_table_id = aws_route_table.sybil.id
}

resource "aws_db_subnet_group" "sybil" {
  name       = "sybil-db-subnet-group"
  subnet_ids = [aws_subnet.sybil_a.id, aws_subnet.sybil_b.id]
}

# Security group for Aurora. Rules are defined as separate
# aws_vpc_security_group_(ingress|egress)_rule resources rather than inline
# blocks: the AWS provider forbids mixing inline ingress/egress with standalone
# rule resources on the same SG (they conflict and silently overwrite each
# other). One style only, so the rules stay stable across applies.
#
# No separate proxy SG: RDS Proxy was deliberately removed because it holds open
# connections, which blocks Aurora Serverless v2 scale-to-zero. The tradeoff is
# that Vercel's functions connect directly over TCP, so the Drizzle client uses a
# pooled/serverless-friendly mode (see src/db/index.ts) instead of leaning on a
# proxy for pooling.
resource "aws_security_group" "sybil_db" {
  name_prefix = "sybil-db-"
  vpc_id      = aws_vpc.sybil.id
  tags        = { Name = "sybil-db-sg" }
}

# Your laptop — for running migrations/seed directly against the cluster.
resource "aws_vpc_security_group_ingress_rule" "admin" {
  security_group_id = aws_security_group.sybil_db.id
  description       = "Postgres from local admin IP (migrations/seed)"
  cidr_ipv4         = var.local_admin_cidr
  from_port         = 5432
  to_port           = 5432
  ip_protocol       = "tcp"
}

# App layer. Vercel has no fixed IP range, so direct TCP needs broad ingress;
# access is still credential-gated via Secrets Manager. SECURITY: this exposes
# Postgres to the public internet. The correct hardening is the RDS Data API
# (HTTPS + IAM, no open port) — the IAM user below is provisioned for it. Once
# the app is cut over (USE_DATA_API=true on Vercel) set enable_public_db_access
# = false to remove this rule and close the port. See README.
resource "aws_vpc_security_group_ingress_rule" "app" {
  count             = var.enable_public_db_access ? 1 : 0
  security_group_id = aws_security_group.sybil_db.id
  description       = "Postgres from app layer (Vercel - no fixed IP range)"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 5432
  to_port           = 5432
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.sybil_db.id
  description       = "All outbound"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# ---------------------------------------------------------------------------
# Secrets — DB credentials, referenced by the cluster.
# ---------------------------------------------------------------------------

resource "random_password" "db_password" {
  length  = 24
  special = false # avoid characters that need extra URL-encoding in DATABASE_URL
}

resource "aws_secretsmanager_secret" "sybil_db" {
  name = "sybil/aurora/credentials"
}

resource "aws_secretsmanager_secret_version" "sybil_db" {
  secret_id = aws_secretsmanager_secret.sybil_db.id
  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db_password.result
  })
}

# ---------------------------------------------------------------------------
# Aurora Serverless v2 (PostgreSQL-compatible)
# ---------------------------------------------------------------------------

resource "aws_rds_cluster" "sybil" {
  cluster_identifier     = "sybil-aurora"
  engine                 = "aurora-postgresql"
  engine_mode            = "provisioned" # required mode for Serverless v2
  engine_version         = var.aurora_engine_version
  database_name          = "sybil"
  master_username        = var.db_username
  master_password        = random_password.db_password.result
  db_subnet_group_name   = aws_db_subnet_group.sybil.name
  vpc_security_group_ids = [aws_security_group.sybil_db.id]
  storage_encrypted      = true # encryption at rest (default aws/rds KMS key; free)
  skip_final_snapshot    = true # fine for a hackathon; remove for production

  # RDS Data API (HTTPS + IAM, no open port). NOTE: the app currently talks TCP
  # via the `pg` driver (src/db/index.ts), so this is NOT a drop-in fallback —
  # using it requires switching Drizzle to the aws-data-api/pg driver. Left
  # enabled so that migration is a config change, not a redeploy.
  enable_http_endpoint = true

  serverlessv2_scaling_configuration {
    min_capacity             = var.aurora_min_acu
    max_capacity             = var.aurora_max_acu
    seconds_until_auto_pause = var.aurora_auto_pause_seconds
  }
}

resource "aws_rds_cluster_instance" "sybil" {
  identifier         = "sybil-aurora-instance-1"
  cluster_identifier = aws_rds_cluster.sybil.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.sybil.engine
  engine_version     = aws_rds_cluster.sybil.engine_version
  # Gives the instance a public endpoint so a direct TCP connection (Vercel on the
  # default path, or your laptop for seeding) can reach it over the internet —
  # despite the public subnets/IGW/SG, the instance defaults to private without it.
  # Flip to false once the app is on the RDS Data API (HTTPS + IAM, no public
  # endpoint at all) for the fully hardened end-state; see README "harden" step.
  # Defaults to true so first-time seeding over TCP stays easy.
  publicly_accessible = var.publicly_accessible
}

# ---------------------------------------------------------------------------
# IAM for the RDS Data API path — the secure way for Vercel (which lives outside
# the VPC, with no fixed egress IP) to reach a private Aurora over HTTPS instead
# of an open 5432. The app authenticates as this user and calls rds-data, which
# reads the master credentials from Secrets Manager on its behalf.
#
# These credentials go into Vercel env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
# + the cluster/secret ARNs below). Least-privilege: only rds-data on THIS
# cluster and GetSecretValue on THIS secret.
# ---------------------------------------------------------------------------

resource "aws_iam_user" "data_api" {
  name = "sybil-data-api"
}

resource "aws_iam_access_key" "data_api" {
  user = aws_iam_user.data_api.name
}

data "aws_iam_policy_document" "data_api" {
  statement {
    sid    = "RdsDataApi"
    effect = "Allow"
    actions = [
      "rds-data:ExecuteStatement",
      "rds-data:BatchExecuteStatement",
      "rds-data:BeginTransaction",
      "rds-data:CommitTransaction",
      "rds-data:RollbackTransaction",
    ]
    resources = [aws_rds_cluster.sybil.arn]
  }
  statement {
    sid       = "ReadDbSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.sybil_db.arn]
  }
}

resource "aws_iam_user_policy" "data_api" {
  name   = "sybil-data-api"
  user   = aws_iam_user.data_api.name
  policy = data.aws_iam_policy_document.data_api.json
}

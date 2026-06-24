output "aurora_cluster_endpoint" {
  description = "Aurora cluster (writer) endpoint — use this as the host in DATABASE_URL for both migrations/seeding and the deployed app. There is no separate proxy endpoint; RDS Proxy was deliberately removed because it blocks scale-to-zero."
  value       = aws_rds_cluster.sybil.endpoint
}

output "database_url" {
  description = "Connection string for both local migrations/seeding and Vercel env vars — password omitted, pull from Secrets Manager. Use a pooled/serverless-friendly Drizzle driver since there's no RDS Proxy in front of this."
  value       = "postgresql://${var.db_username}:<PASSWORD_FROM_SECRETS_MANAGER>@${aws_rds_cluster.sybil.endpoint}:5432/sybil?sslmode=no-verify"
}

output "rds_data_api_enabled" {
  description = "RDS Data API is enabled on this cluster (enable_http_endpoint=true) as a fallback — lets you query over HTTPS without holding a TCP connection, if direct pooled connections from Vercel ever prove flaky. Not used by default; the app should use database_url unless you hit connection issues."
  value       = aws_rds_cluster.sybil.cluster_resource_id
}

output "secrets_manager_secret_arn" {
  description = "Where the actual password lives — fetch with: aws secretsmanager get-secret-value --secret-id <this arn>. Also the RDS_SECRET_ARN for the Data API path."
  value       = aws_secretsmanager_secret.sybil_db.arn
}

# ── RDS Data API cutover values (set these as Vercel env vars) ────────────────
output "rds_cluster_arn" {
  description = "RDS_RESOURCE_ARN for the Data API path (USE_DATA_API=true)."
  value       = aws_rds_cluster.sybil.arn
}

output "data_api_access_key_id" {
  description = "AWS_ACCESS_KEY_ID for the sybil-data-api IAM user — set in Vercel env when USE_DATA_API=true."
  value       = aws_iam_access_key.data_api.id
}

output "data_api_secret_access_key" {
  description = "AWS_SECRET_ACCESS_KEY for the sybil-data-api IAM user. Sensitive — read with: terraform output -raw data_api_secret_access_key"
  value       = aws_iam_access_key.data_api.secret
  sensitive   = true
}

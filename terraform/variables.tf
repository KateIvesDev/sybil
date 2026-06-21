variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "db_username" {
  description = "Master username for Aurora"
  type        = string
  default     = "sybil_admin"
}

variable "aurora_engine_version" {
  description = "Aurora PostgreSQL engine version. Must be 15.7+ (or 13.15+/14.12+/16.3+) to support scaling to 0 ACUs — versions below this silently can't auto-pause."
  type        = string
  default     = "15.7"
}

variable "aurora_min_acu" {
  description = "Minimum Aurora Capacity Units. 0 enables true scale-to-zero (auto-pause) — near-zero idle cost, but the first request after a pause pays a cold-start penalty (~15s typically, up to 30s+ if paused over 24 hours). Requires engine version 15.7+ and NO RDS Proxy (a proxy holding open connections blocks auto-pause entirely)."
  type        = number
  default     = 0
}

variable "aurora_max_acu" {
  description = "Maximum Aurora Capacity Units — keep low for a hackathon workload"
  type        = number
  default     = 2
}

variable "aurora_auto_pause_seconds" {
  description = "Seconds of inactivity before Aurora pauses (scale-to-zero only). Min 300 (5 min), max 86400 (24h). Lower = cheaper but more frequent cold starts; higher = fewer cold starts but pays for more idle time before pausing."
  type        = number
  default     = 3600 # 1h — for a 30-day unattended judging window: keeps the cluster
  # warm through a judge's whole session (so they don't hit a cold
  # start mid-review), then pauses. Idle cost of staying warm 1h
  # after each visit is ~$0.06 — negligible vs the UX win.
}

variable "enable_public_db_access" {
  description = "Open Postgres 5432 to 0.0.0.0/0 so Vercel (no fixed egress IP) can connect over TCP. SECURITY: exposes the DB to the public internet. Set FALSE once the app is cut over to the RDS Data API (HTTPS + IAM, no open port) — see README. The local-admin-IP ingress (for seeding) stays regardless."
  type        = bool
  default     = true
}

variable "local_admin_cidr" {
  description = "Your local IP in CIDR form (e.g. 1.2.3.4/32) — allowed to connect directly for migrations/seeding. Find yours at https://whatismyip.com"
  type        = string
}

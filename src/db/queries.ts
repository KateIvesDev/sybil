/**
 * The dual-signal correlation — this is the product.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ Two detectors over ONE normalized identity-telemetry landing table,      │
 * │ blended into one revenue-weighted risk score — all in the database:      │
 * │                                                                          │
 * │   • RATE ANOMALY  — recent deprovisioning-sync failures vs each tenant's │
 * │                     own 7-day hourly baseline (z-score). Leading signal. │
 * │   • EXPOSURE       — discrete stale-access violations scored by blast    │
 * │                     radius × sensitivity × dwell time. Confirmed signal. │
 * │                                                                          │
 * │   risk_score = 0.35·ARR + 0.30·exposure + 0.20·anomaly + 0.15·renewal    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * A tenant surfaces when it is anomalous OR carries an open exposure, ranked by
 * risk_score so a whale with a confirmed stale Super-Admin session near renewal
 * outranks a bigger tenant whose pipeline is merely wobbling.
 */
import { sql } from "drizzle-orm";
import { db } from "./index";

export interface RevenueAtRiskRow {
  accountId: string;
  accountName: string;
  tier: "enterprise" | "mid" | "smb";
  arr: number;
  csmOwner: string;
  region: string;
  renewalDate: string;
  renewalDays: number;
  riskScore: number;
  signalKind: "anomaly" | "exposure" | "both";
  // Rate-anomaly side (deprovisioning-sync failures)
  zScore: number;
  baselinePerHour: number;
  syncFailures: number;
  maxSeverity: number;
  failingEndpoint: string | null;
  errorSignature: string | null;
  firstSeen: string | null;
  // Exposure side (discrete stale-access violations)
  exposureCount: number;
  dwellHours: number | null;
  subject: string | null;
  exposureEntitlement: string | null;
  exposureSignature: string | null;
}

// The real query as a string so the "View query" affordance shows judges exactly
// what runs (not a paraphrase). `buildRevenueAtRiskSql` is the single source — the
// executed query and the displayed query are literally the same text.
export function buildRevenueAtRiskSql(windowMinutes: number): string {
  const win = Math.max(1, Math.round(windowMinutes));
  return `-- Sybil dual-signal correlation: two detectors, one landing table, one risk score.
WITH
-- (1) Per-tenant BASELINE of normal sync failures: hourly 'error' counts over the
--     trailing 7 days, EXCLUDING the live window so the spike can't bias its own
--     baseline. sigma floored at 1 so near-constant tenants don't explode the z.
--
--     The hourly rollup is read from the materialized view mv_hourly_error_counts
--     (refreshed out of band via /api/cron/refresh-baseline) instead of rescanning
--     a week of raw events on every 5s poll — the baseline is a 7-day average, so
--     it does not need per-request recomputation. The LIVE window (sync_recent /
--     exposure below) stays on raw telemetry_events so a fresh burst still
--     surfaces within one poll. See src/db/migrations/manual/0003_baseline_matview.sql.
baseline AS (
  SELECT account_id,
         AVG(cnt)                                  AS mu,
         GREATEST(COALESCE(STDDEV_POP(cnt), 0), 1) AS sigma
  FROM mv_hourly_error_counts
  WHERE hour >= date_trunc('hour', now()) - interval '7 days'
    AND hour <  date_trunc('hour', now() - interval '${win} minutes')
  GROUP BY account_id
),
-- (2) RECENT sync failures in the live window — the anomaly numerator.
sync_recent AS (
  SELECT account_id,
         COUNT(*)::int                                  AS sync_failures,
         MAX(severity)::int                             AS max_severity,
         MODE() WITHIN GROUP (ORDER BY endpoint)        AS failing_endpoint,
         MODE() WITHIN GROUP (ORDER BY error_signature) AS error_signature,
         MIN(occurred_at)                               AS first_seen
  FROM telemetry_events
  WHERE event_type = 'error'
    AND occurred_at >= now() - interval '${win} minutes'
  GROUP BY account_id
),
-- (3) Open identity EXPOSURES — discrete, rare, high-severity. Scored by blast
--     radius × sensitivity × dwell, NOT by rate: a baseline of zero makes z-score
--     the wrong tool. One stale Super-Admin session is already a P1.
exposure AS (
  SELECT account_id,
         COUNT(*)::int                                          AS exposure_count,
         MAX(severity)::int                                     AS exposure_severity,
         EXTRACT(EPOCH FROM (now() - MIN(occurred_at))) / 3600.0 AS dwell_hours,
         (ARRAY_AGG(subject         ORDER BY severity DESC, occurred_at))[1] AS subject,
         (ARRAY_AGG(endpoint        ORDER BY severity DESC, occurred_at))[1] AS entitlement,
         (ARRAY_AGG(error_signature ORDER BY severity DESC, occurred_at))[1] AS exposure_signature
  FROM telemetry_events
  WHERE event_type IN ('stale_access', 'policy_violation')
    AND occurred_at >= now() - interval '30 days'
  GROUP BY account_id
),
-- (4) Join to revenue and compute the z-score + normalized risk factors per tenant.
scored AS (
  SELECT
    a.id, a.name, a.tier, a.arr, a.csm_owner, a.region, a.renewal_date,
    GREATEST(0, EXTRACT(DAY FROM (a.renewal_date - now())))::int AS renewal_days,
    COALESCE(sr.sync_failures, 0) AS sync_failures,
    COALESCE(sr.max_severity, 0)  AS max_severity,
    sr.failing_endpoint, sr.error_signature, sr.first_seen,
    COALESCE(b.mu, 0) AS mu,
    (COALESCE(sr.sync_failures, 0) - COALESCE(b.mu, 0)) / COALESCE(b.sigma, 1) AS z,
    COALESCE(e.exposure_count, 0) AS exposure_count,
    e.exposure_severity, e.dwell_hours, e.subject, e.entitlement, e.exposure_signature,
    a.arr / NULLIF((SELECT MAX(arr) FROM accounts), 0)                 AS arr_norm,
    GREATEST(0, 1 - EXTRACT(DAY FROM (a.renewal_date - now())) / 90.0) AS renewal_urgency
  FROM accounts a
  LEFT JOIN baseline    b  ON b.account_id  = a.id
  LEFT JOIN sync_recent sr ON sr.account_id = a.id
  LEFT JOIN exposure    e  ON e.account_id  = a.id
)
SELECT
  id AS "accountId", name AS "accountName", tier, arr, csm_owner AS "csmOwner",
  region, renewal_date AS "renewalDate", renewal_days AS "renewalDays",
  sync_failures AS "syncFailures", max_severity AS "maxSeverity",
  failing_endpoint AS "failingEndpoint", error_signature AS "errorSignature",
  first_seen AS "firstSeen",
  ROUND(z, 1) AS "zScore", ROUND(mu, 2) AS "baselinePerHour",
  exposure_count AS "exposureCount", ROUND(dwell_hours::numeric, 1) AS "dwellHours",
  subject AS "subject", entitlement AS "exposureEntitlement",
  exposure_signature AS "exposureSignature",
  CASE
    WHEN (sync_failures >= 8 AND z >= 3) AND exposure_count > 0 THEN 'both'
    WHEN exposure_count > 0                                     THEN 'exposure'
    ELSE 'anomaly'
  END AS "signalKind",
  -- exposure_factor = 0.5·sensitivity + 0.3·dwell(≤24h) + 0.2·blast-radius
  -- risk_score (0–100) = 0.35·ARR + 0.30·exposure + 0.20·anomaly + 0.15·renewal
  ROUND(100 * (
      0.35 * COALESCE(arr_norm, 0)
    + 0.30 * CASE WHEN exposure_count > 0
               THEN 0.5 * COALESCE(exposure_severity, 0) / 5.0
                  + 0.3 * LEAST(COALESCE(dwell_hours, 0) / 24.0, 1)
                  + 0.2 * LEAST(exposure_count / 5.0, 1)
               ELSE 0 END
    + 0.20 * LEAST(GREATEST(z, 0) / 10.0, 1)
    + 0.15 * renewal_urgency
  ))::int AS "riskScore"
FROM scored
WHERE (sync_failures >= 8 AND z >= 3)  -- rate anomaly (floored to ignore tiny bumps)
   OR exposure_count > 0               -- or a confirmed open exposure
ORDER BY "riskScore" DESC;`;
}

// Display constant (default window) for the "View query" dialog.
export const REVENUE_AT_RISK_SQL = buildRevenueAtRiskSql(60);

// ── Baseline rollup refresh ────────────────────────────────────────────────
// Recompute the materialized hourly-error rollup the baseline CTE reads from
// (see src/db/migrations/manual/0003_baseline_matview.sql). Called by
// /api/cron/refresh-baseline (wire it to a Vercel Cron job) and after a re-seed.
// CONCURRENTLY keeps reads live during the refresh (needs the unique index on
// account_id,hour) and is a single statement, so it works over both the pg and
// Data API drivers.
export async function refreshBaselineMatview(): Promise<void> {
  await db.execute(
    sql.raw("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hourly_error_counts"),
  );
}

export async function getRevenueAtRisk(
  windowMinutes = 60,
): Promise<RevenueAtRiskRow[]> {
  // Same text we show in "View query" — executed verbatim, window substituted.
  const result = await db.execute(sql.raw(buildRevenueAtRiskSql(windowMinutes)));

  return (result.rows as Record<string, unknown>[]).map((r) => ({
    accountId: String(r.accountId),
    accountName: String(r.accountName),
    tier: r.tier as RevenueAtRiskRow["tier"],
    arr: Number(r.arr),
    csmOwner: String(r.csmOwner),
    region: String(r.region),
    renewalDate: new Date(r.renewalDate as string).toISOString(),
    renewalDays: Number(r.renewalDays),
    riskScore: Number(r.riskScore),
    signalKind: r.signalKind as RevenueAtRiskRow["signalKind"],
    zScore: Number(r.zScore),
    baselinePerHour: Number(r.baselinePerHour),
    syncFailures: Number(r.syncFailures),
    maxSeverity: Number(r.maxSeverity),
    failingEndpoint: r.failingEndpoint ? String(r.failingEndpoint) : null,
    errorSignature: r.errorSignature ? String(r.errorSignature) : null,
    firstSeen: r.firstSeen ? new Date(r.firstSeen as string).toISOString() : null,
    exposureCount: Number(r.exposureCount),
    dwellHours: r.dwellHours != null ? Number(r.dwellHours) : null,
    subject: r.subject ? String(r.subject) : null,
    exposureEntitlement: r.exposureEntitlement
      ? String(r.exposureEntitlement)
      : null,
    exposureSignature: r.exposureSignature
      ? String(r.exposureSignature)
      : null,
  }));
}

// ── Fleet error pulse ─────────────────────────────────────────────────────────
// A fleet-wide, per-minute heartbeat for the command-center sparkline. Continuous
// (generate_series fills empty minutes with zero) so the line never has gaps, and
// alive even at rest — the seed keeps benign latency noise, so `events` has a
// baseline shape while `errors` stays flat until an incident fires.
export interface PulsePoint {
  bucket: string;
  events: number;
  errors: number;
}

export async function getErrorPulse(windowMinutes = 60): Promise<PulsePoint[]> {
  const result = await db.execute(sql`
    SELECT
      g.bucket                                                       AS "bucket",
      COUNT(e.id)::int                                               AS "events",
      COUNT(e.id) FILTER (WHERE e.event_type = 'error')::int         AS "errors"
    FROM generate_series(
      date_trunc('minute', now()) - ((${windowMinutes} - 1) || ' minutes')::interval,
      date_trunc('minute', now()),
      '1 minute'
    ) AS g(bucket)
    LEFT JOIN telemetry_events e
      ON date_trunc('minute', e.occurred_at) = g.bucket
    GROUP BY g.bucket
    ORDER BY g.bucket ASC
  `);

  return (result.rows as Record<string, unknown>[]).map((r) => ({
    bucket: new Date(r.bucket as string).toISOString(),
    events: Number(r.events),
    errors: Number(r.errors),
  }));
}

// ── Account roster ───────────────────────────────────────────────────────────
// Every monitored account, for the always-on account-status table. The feed
// merges this roster with the revenue-at-risk set client-side: an account renders
// "Impacted" if it has qualifying errors in the window, "Healthy" otherwise.
// This does not touch the correlation query — it just supplies the calm baseline
// of accounts that aren't erroring.
export interface AccountRosterRow {
  accountId: string;
  accountName: string;
  tier: "enterprise" | "mid" | "smb";
  arr: number;
  csmOwner: string;
  region: string;
  // Renewal is master data on every account (not incident detail), so the roster
  // carries it — the account-status table shows renewal proximity for every row,
  // making the renewal-weighted risk ranking legible even at rest.
  renewalDate: string;
  renewalDays: number;
}

export async function getAllAccounts(): Promise<AccountRosterRow[]> {
  const result = await db.execute(sql`
    SELECT
      id          AS "accountId",
      name        AS "accountName",
      tier        AS "tier",
      arr         AS "arr",
      csm_owner   AS "csmOwner",
      region      AS "region",
      renewal_date                                          AS "renewalDate",
      GREATEST(0, EXTRACT(DAY FROM (renewal_date - now())))::int AS "renewalDays"
    FROM accounts
    ORDER BY arr DESC
  `);

  return (result.rows as Record<string, unknown>[]).map((r) => ({
    accountId: String(r.accountId),
    accountName: String(r.accountName),
    tier: r.tier as AccountRosterRow["tier"],
    arr: Number(r.arr),
    csmOwner: String(r.csmOwner),
    region: String(r.region),
    renewalDate: String(r.renewalDate),
    renewalDays: Number(r.renewalDays),
  }));
}

// ── Incident lifecycle ───────────────────────────────────────────────────────
// One row per account that has an incident record (an outreach row). The account
// table merges this with the roster to derive each account's display status:
// no record → Healthy; otherwise computed from the two fields (see
// src/lib/incident-status.ts). Lightweight on purpose — no draft body, no join
// to telemetry. The correlation query is untouched.
export interface IncidentLifecycleRow {
  accountId: string;
  incidentStatus: "active" | "resolved";
  outreachStatus: "none" | "initial_sent" | "resolution_sent";
  resolvedAt: string | null;
  resolutionSentAt: string | null;
}

export async function getIncidents(): Promise<IncidentLifecycleRow[]> {
  const result = await db.execute(sql`
    SELECT
      account_id          AS "accountId",
      incident_status     AS "incidentStatus",
      outreach_status     AS "outreachStatus",
      resolved_at         AS "resolvedAt",
      resolution_sent_at  AS "resolutionSentAt"
    FROM outreach
  `);

  return (result.rows as Record<string, unknown>[]).map((r) => ({
    accountId: String(r.accountId),
    incidentStatus: r.incidentStatus as IncidentLifecycleRow["incidentStatus"],
    outreachStatus: r.outreachStatus as IncidentLifecycleRow["outreachStatus"],
    resolvedAt: r.resolvedAt
      ? new Date(r.resolvedAt as string).toISOString()
      : null,
    resolutionSentAt: r.resolutionSentAt
      ? new Date(r.resolutionSentAt as string).toISOString()
      : null,
  }));
}

// ── Account drill-down ──────────────────────────────────────────────────────
// Error spike bucketed per minute for the recharts timeline, plus the account
// row and any existing outreach draft.
export interface AccountDrilldown {
  account: {
    id: string;
    name: string;
    tier: string;
    arr: number;
    csmOwner: string;
    region: string;
    renewalDate: string;
  };
  series: { bucket: string; errors: number; maxSeverity: number }[];
  topEndpoint: string | null;
  firstSeen: string | null;
  totalErrors: number;
}

export async function getAccountDrilldown(
  accountId: string,
  windowMinutes = 60,
): Promise<AccountDrilldown | null> {
  const accountRes = await db.execute(sql`
    SELECT id, name, tier, arr, csm_owner AS "csmOwner", region,
           renewal_date AS "renewalDate"
    FROM accounts WHERE id = (${accountId})::uuid
  `);
  if (accountRes.rows.length === 0) return null;
  const a = accountRes.rows[0] as Record<string, unknown>;

  // Bucket errors into 1-minute slots so the chart shows the spike shape.
  const seriesRes = await db.execute(sql`
    SELECT
      date_trunc('minute', occurred_at) AS bucket,
      COUNT(*)::int                     AS errors,
      MAX(severity)::int                AS "maxSeverity"
    FROM telemetry_events
    WHERE account_id = (${accountId})::uuid
      AND event_type = 'error'
      AND occurred_at >= now() - (${windowMinutes} || ' minutes')::interval
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const metaRes = await db.execute(sql`
    SELECT
      MODE() WITHIN GROUP (ORDER BY endpoint) AS "topEndpoint",
      MIN(occurred_at)                        AS "firstSeen",
      COUNT(*)::int                           AS "totalErrors"
    FROM telemetry_events
    WHERE account_id = (${accountId})::uuid
      AND event_type = 'error'
      AND occurred_at >= now() - (${windowMinutes} || ' minutes')::interval
  `);
  const meta = metaRes.rows[0] as Record<string, unknown>;

  return {
    account: {
      id: String(a.id),
      name: String(a.name),
      tier: String(a.tier),
      arr: Number(a.arr),
      csmOwner: String(a.csmOwner),
      region: String(a.region),
      renewalDate: new Date(a.renewalDate as string).toISOString(),
    },
    series: (seriesRes.rows as Record<string, unknown>[]).map((r) => ({
      bucket: new Date(r.bucket as string).toISOString(),
      errors: Number(r.errors),
      maxSeverity: Number(r.maxSeverity),
    })),
    topEndpoint: meta.topEndpoint ? String(meta.topEndpoint) : null,
    firstSeen: meta.firstSeen
      ? new Date(meta.firstSeen as string).toISOString()
      : null,
    totalErrors: Number(meta.totalErrors),
  };
}

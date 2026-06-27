-- 0003_baseline_matview.sql  (manual migration — apply with `pnpm db:matview`)
-- ---------------------------------------------------------------------------
-- W1: make the dual-signal correlation query cheap at poll cadence.
--
-- The dashboard polls /api/revenue-at-risk every 5s. The expensive part of that
-- query is the per-tenant BASELINE: hourly COUNT(*) of 'error' events over a
-- trailing 7 days. That answer changes slowly (it's a 7-day average) yet was
-- recomputed from raw events on every poll, for every client.
--
-- Here we (1) pre-aggregate that hourly rollup into a materialized view so the
-- baseline reads a few hundred cached rows instead of scanning a week of raw
-- events, and (2) add partial indexes matched to the two detectors' hot WHERE
-- clauses. The LIVE window (last N minutes) deliberately stays on raw events in
-- queries.ts so a freshly-ingested burst still lights up within one poll.
--
-- Idempotent: safe to run repeatedly. DDL is run over admin TCP (like db:push /
-- db:seed), not the Data API — drizzle does not model matviews/pg_cron.
-- ===========================================================================

-- (1) Partial indexes — one per detector access pattern. Smaller and faster than
--     indexing the whole table; Postgres only stores rows matching the predicate.
--     The anomaly path filters event_type='error'; the exposure path filters the
--     two governance types. Both always filter by account_id + occurred_at.
CREATE INDEX IF NOT EXISTS idx_events_error_account_time
  ON telemetry_events (account_id, occurred_at)
  WHERE event_type = 'error';

CREATE INDEX IF NOT EXISTS idx_events_exposure_account_time
  ON telemetry_events (account_id, occurred_at)
  WHERE event_type IN ('stale_access', 'policy_violation');

-- (2) The materialized baseline: per-tenant hourly 'error' counts.
--     Window is 8 DAYS even though the query reads 7 — the extra day absorbs the
--     drift between refresh time and query time, so the trailing-7d query window
--     is never starved at its tail between refreshes. now() is evaluated at
--     REFRESH time (that is exactly the point of materializing it).
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hourly_error_counts AS
  SELECT account_id,
         date_trunc('hour', occurred_at) AS hour,
         COUNT(*)::numeric               AS cnt
  FROM telemetry_events
  WHERE event_type = 'error'
    AND occurred_at >= now() - interval '8 days'
  GROUP BY account_id, date_trunc('hour', occurred_at)
WITH DATA;

-- Unique index is REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY (which
-- lets reads keep working during a refresh — no read lock).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_hourly_error_counts
  ON mv_hourly_error_counts (account_id, hour);

-- (3) Refresh is scheduled OUT OF BAND, not in this migration — the baseline is a
--     7-day average, so a periodic `REFRESH MATERIALIZED VIEW CONCURRENTLY` keeps
--     it current (the live anomaly window in queries.ts reads raw events, so the
--     view being a little stale never delays detection). The portable scheduler is
--     the /api/cron/refresh-baseline route wired to a Vercel Cron job; also hit it
--     after a re-seed. See docs/PERFORMANCE.md.
--
--     pg_cron is intentionally NOT set up here: on Aurora it requires a custom
--     cluster parameter group (shared_preload_libraries) plus cron.database_name,
--     and the extension can only be created in that one database — none of which a
--     SQL migration can do. It's an optional advanced path, documented in
--     docs/PERFORMANCE.md for clusters already configured for it.

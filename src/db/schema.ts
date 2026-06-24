/**
 * Sybil data model
 * ----------------
 * Four tables, one job: correlate live product errors against the customers
 * they hurt, weighted by revenue, and surface the ones costing the most.
 *
 *   accounts ──< telemetry_events   (who is erroring, and how badly)
 *   accounts ──< tickets            (who has already raised their hand)
 *   accounts ──< outreach           (the proactive message we want to send)
 *
 * "Revenue at risk" is every account with a qualifying error event in the
 * window, ranked by ARR at risk. That query lives in src/db/queries.ts. Sybil
 * alerts on any impacted account; ticket status does not gate the feed — it is
 * fetched live and on demand on the incident page (src/lib/ticket-context.ts),
 * so the `tickets` table is no longer load-bearing for the correlation query.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  integer,
  index,
  check,
} from "drizzle-orm/pg-core";

// ── Enumerated value sets ──────────────────────────────────────────────────
// Stored as plain `text` columns (not native pg enum TYPEs) with a CHECK
// constraint for DB-level validation. Native pg enums can't be bound as
// parameters over the RDS Data API (it sends params as text with no cast for
// custom types, so inserts fail with "column is of type X but expression is of
// type text"); text + CHECK is the Data-API-compatible equivalent. Each array is
// reused as both the column's `{ enum }` (compile-time union type) and the CHECK.
export const ACCOUNT_TIERS = ["enterprise", "mid", "smb"] as const;
// Telemetry semantics on the one landing table. `error`/`latency` are the high-
// volume infra signals (deprovisioning-sync failures arrive as `error`); the two
// identity-governance types are discrete, rare, high-severity findings that Sybil
// scores by exposure, not by rate:
//   stale_access     — a terminated/contractor user retains a live session/entitlement
//   policy_violation — lower-severity governance finding (orphaned account, over-entitlement)
export const EVENT_TYPES = [
  "error",
  "latency",
  "stale_access",
  "policy_violation",
] as const;
// Where a telemetry event was ingested from. Sybil sits on top of existing
// observability tools, so every normalized event carries its provider of origin.
export const EVENT_SOURCES = ["sentry", "datadog", "cloudwatch", "custom"] as const;
// Two-dimensional incident lifecycle, stored on the incident record (the
// outreach row). `incident_status` tracks the engineering reality (is it still
// broken?); `outreach_status` tracks the customer conversation (have we told
// them, and have we told them it's fixed?). The single display status the
// account table shows is DERIVED from these two — see src/lib/incident-status.ts.
export const INCIDENT_STATUSES = ["active", "resolved"] as const;
// How far the customer conversation has gone: nothing → initial heads-up →
// resolution confirmation.
export const OUTREACH_STATUSES = ["none", "initial_sent", "resolution_sent"] as const;

// ── accounts ───────────────────────────────────────────────────────────────
// The book of business. ARR is the weight that turns "an error" into
// "an error that costs us $1.4M of renewal risk".
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    tier: text("tier", { enum: ACCOUNT_TIERS }).notNull(),
    arr: numeric("arr", { precision: 12, scale: 2 }).notNull(),
    csmOwner: text("csm_owner").notNull(),
    renewalDate: timestamp("renewal_date", { withTimezone: true }).notNull(),
    region: text("region").notNull(),
    // The external tenant/org/api-key identifier providers send in their payloads.
    // Ingestion resolves account_ref → accounts.id through this. Nullable so legacy
    // rows survive the migration; the seed backfills it for every account.
    externalRef: text("external_ref").unique(),
  },
  (t) => [check("account_tier_chk", sql`${t.tier} IN ('enterprise','mid','smb')`)],
);

// ── telemetry_events ─────────────────────────────────────────────────────
// Raw product signal: every error/latency event a customer's usage produced.
// error_signature groups events into a single failure mode (e.g. the same
// 500 on the same endpoint) so the feed reads "what is broken", not noise.
export const telemetryEvents = pgTable(
  "telemetry_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Provider of origin + that provider's own unique id for the event. The
    // UNIQUE on external_event_id is what makes ingestion idempotent: receiving
    // the same webhook twice is a no-op (ON CONFLICT DO NOTHING). Both are
    // nullable so the seed's benign latency noise (not provider-sourced) is fine.
    source: text("source", { enum: EVENT_SOURCES }),
    externalEventId: text("external_event_id").unique(),
    endpoint: text("endpoint").notNull(),
    eventType: text("event_type", { enum: EVENT_TYPES }).notNull(),
    severity: integer("severity").notNull(), // 1 (notice) → 5 (critical)
    statusCode: integer("status_code"),
    errorSignature: text("error_signature"),
    // The identity actor an event concerns, for governance findings — e.g.
    // "jane.doe@acme (terminated 2026-06-18)". Null for infra error/latency events.
    subject: text("subject"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The correlation query filters by account + time window constantly.
    index("idx_events_account_time").on(t.accountId, t.occurredAt),
    check(
      "event_source_chk",
      sql`${t.source} IS NULL OR ${t.source} IN ('sentry','datadog','cloudwatch','custom')`,
    ),
    check(
      "event_type_chk",
      sql`${t.eventType} IN ('error','latency','stale_access','policy_violation')`,
    ),
  ],
);

// ── tickets ────────────────────────────────────────────────────────────────
// The customer's own voice. An OPEN ticket means they already know and asked.
// Its ABSENCE next to live errors is the entire product thesis.
export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // open | closed
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── outreach (the incident record) ───────────────────────────────────────────
// The human-in-the-loop artifact AND the incident record: one row per impacted
// account, created when the incident is detected. It carries the proactive
// message a CSM reviews and sends, plus the two-dimensional lifecycle
// (incident_status × outreach_status). Nothing sends without a human's name on it.
export const outreach = pgTable(
  "outreach",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    draftBody: text("draft_body").notNull(),
    // Is the underlying problem still live, or has a CSM marked it fixed?
    incidentStatus: text("incident_status", { enum: INCIDENT_STATUSES })
      .notNull()
      .default("active"),
    // How far the customer conversation has gone: nothing → initial heads-up →
    // resolution confirmation. Replaces the prior pending/approved/sent column.
    outreachStatus: text("outreach_status", { enum: OUTREACH_STATUSES })
      .notNull()
      .default("none"),
    approvedBy: text("approved_by"),
    // Stamped when a human clicks "Send" on the initial outreach (none → initial_sent).
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // Stamped when a CSM marks the incident resolved (active → resolved).
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    // Stamped when the resolution update is sent (initial_sent → resolution_sent).
    resolutionSentAt: timestamp("resolution_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "incident_status_chk",
      sql`${t.incidentStatus} IN ('active','resolved')`,
    ),
    check(
      "outreach_status_chk",
      sql`${t.outreachStatus} IN ('none','initial_sent','resolution_sent')`,
    ),
  ],
);

// Inferred row types for use across the app.
export type Account = typeof accounts.$inferSelect;
export type TelemetryEvent = typeof telemetryEvents.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type Outreach = typeof outreach.$inferSelect;

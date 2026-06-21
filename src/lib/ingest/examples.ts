/**
 * Representative RAW webhook payloads, one per provider, exactly as the provider
 * would POST them. These are the inputs to the adapters in ./adapters.ts — the
 * proof that two completely different provider dialects collapse into the one
 * normalized contract and land in the same telemetry_events table.
 *
 * `account_ref` here matches the `external_ref` the seed assigns to accounts
 * (see externalRefFor() in src/lib/demo-data.ts), so these examples actually
 * resolve to a tenant when POSTed to /api/ingest against a seeded database.
 */
import type { SentryRawPayload, DatadogRawPayload } from "./adapters";

/**
 * Sentry — shape of an issue-alert / error-event webhook. The signal is nested
 * under data.event; the failing route comes from the request URL + method, the
 * severity from the event level, and the tenant from a custom tag.
 */
export const sentryExamplePayload: SentryRawPayload = {
  action: "triggered",
  data: {
    event: {
      event_id: "evt_9f8b7c6d5e4f3a2b1c0d4e5f6a7b8c9d",
      project: "northwind-prod",
      level: "fatal",
      platform: "node",
      timestamp: "2026-06-20T17:42:03.000Z",
      request: {
        url: "https://api.acme.io/v2/shipments/batch?async=true",
        method: "POST",
      },
      exception: {
        values: [
          {
            type: "ShipmentBatchTimeout",
            value: "upstream rate-plan service 504",
          },
        ],
      },
      contexts: { response: { status_code: 500 } },
      tags: [
        ["environment", "production"],
        ["account_ref", "ext_northwind_logistics"],
      ],
    },
  },
};

/**
 * Datadog — a custom webhook payload template (Datadog lets you author the JSON
 * body yourself). Completely different shape: flat-ish, priority instead of
 * level, epoch-seconds timestamp, tenant under org.name.
 */
export const datadogExamplePayload: DatadogRawPayload = {
  alert_id: "8273611",
  alert_transition: "Triggered",
  alert_type: "error",
  priority: "P1",
  date_happened: 1750441323, // epoch SECONDS
  title: "[Triggered] 5xx surge on ledger reconcile",
  org: { id: "88212", name: "ext_helios_financial" },
  event_type: "error",
  resource: {
    method: "POST",
    path: "/v2/ledger/reconcile",
    status_code: 503,
  },
  error: { signature: "ReconcileWorkerCrash: OOM in settlement job" },
};

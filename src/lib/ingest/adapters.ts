/**
 * Provider adapters — the lightweight mappers that turn a provider's raw webhook
 * into the one normalized contract (see ./normalized.ts). Each provider speaks a
 * different dialect; an adapter is the only place that knows that dialect. Add a
 * new provider = add one mapper, and it lands in the same telemetry_events table
 * as every other source.
 *
 * Run the examples through these to see it: see ./examples.ts.
 */
import type { NormalizedEvent } from "./normalized";

// ── Sentry ────────────────────────────────────────────────────────────────
// The slice of a Sentry issue-alert / error-event webhook the adapter reads.
export interface SentryRawPayload {
  action: string;
  data: {
    event: {
      event_id: string;
      project: string;
      level: string;
      platform: string;
      timestamp: string;
      request: { url: string; method: string };
      exception: { values: { type: string; value: string }[] };
      contexts: { response: { status_code: number } };
      tags: [string, string][];
    };
  };
}

// Sentry "level" → our severity scale.
const SENTRY_LEVEL_SEVERITY: Record<string, NormalizedEvent["severity"]> = {
  fatal: "critical",
  error: "high",
  warning: "medium",
  info: "low",
  debug: "low",
};

export function sentryToNormalized(payload: SentryRawPayload): NormalizedEvent {
  const e = payload.data.event;

  // "POST /v2/shipments/batch" from method + URL pathname.
  const path = new URL(e.request.url).pathname;
  const endpoint = `${e.request.method.toUpperCase()} ${path}`;

  const accountRef =
    e.tags.find(([k]) => k === "account_ref")?.[1] ?? "unknown";
  const exc = e.exception.values[0];

  return {
    source: "sentry",
    external_event_id: e.event_id,
    account_ref: accountRef,
    event_type: "error",
    endpoint,
    status_code: e.contexts.response.status_code,
    severity: SENTRY_LEVEL_SEVERITY[e.level] ?? "medium",
    error_signature: `${exc.type}: ${exc.value}`,
    occurred_at: new Date(e.timestamp).toISOString(),
  };
}

// ── Datadog ──────────────────────────────────────────────────────────────
// A Datadog custom-webhook payload template (you author the JSON yourself).
export interface DatadogRawPayload {
  alert_id: string;
  alert_transition: string;
  alert_type: string;
  priority: string;
  date_happened: number; // epoch seconds
  title: string;
  org: { id: string; name: string };
  event_type: string;
  resource: { method: string; path: string; status_code: number };
  error: { signature: string };
}

// Datadog monitor priority → our severity scale.
const DATADOG_PRIORITY_SEVERITY: Record<string, NormalizedEvent["severity"]> = {
  P1: "critical",
  P2: "high",
  P3: "medium",
  P4: "low",
  P5: "low",
};

export function datadogToNormalized(payload: DatadogRawPayload): NormalizedEvent {
  const endpoint = `${payload.resource.method.toUpperCase()} ${payload.resource.path}`;

  return {
    source: "datadog",
    external_event_id: payload.alert_id,
    account_ref: payload.org.name,
    event_type: payload.event_type === "latency" ? "latency" : "error",
    endpoint,
    status_code: payload.resource.status_code,
    severity: DATADOG_PRIORITY_SEVERITY[payload.priority] ?? "medium",
    error_signature: payload.error.signature,
    occurred_at: new Date(payload.date_happened * 1000).toISOString(),
  };
}

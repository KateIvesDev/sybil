/**
 * POST /api/webhooks/[provider] — the REAL provider front door.
 *
 * A Sentry / Datadog webhook POSTs its own raw, provider-specific JSON here. The
 * matching adapter (src/lib/ingest/adapters.ts) maps that dialect into the one
 * normalized contract, which then flows through the exact same ingestion core as
 * /api/ingest. This is the "same landing table, any source" thesis made literal:
 *
 *   raw Sentry JSON ─▶ sentryToNormalized ─▶ normalized ─▶ ingest ─▶ telemetry_events
 *   raw Datadog JSON ▶ datadogToNormalized ▶ normalized ─▶ ingest ─▶ telemetry_events
 *
 * Contract:
 *   404  unknown provider
 *   422  raw payload didn't fit the provider's shape (adapter threw / failed zod)
 *   202  account_ref didn't resolve to a tenant
 *   200  created | ignored (idempotent on the provider's own event id)
 */
import { NextResponse } from "next/server";
import {
  sentryToNormalized,
  datadogToNormalized,
  type SentryRawPayload,
  type DatadogRawPayload,
} from "@/lib/ingest/adapters";
import { normalizedEventSchema } from "@/lib/ingest/normalized";
import { ingestNormalizedEvent } from "@/lib/ingest/ingest-event";

export const dynamic = "force-dynamic";
// Allow the first request after a scale-to-zero pause to wait out Aurora's resume.
export const maxDuration = 60;

// One mapper per supported provider dialect. Adding a provider = adding a line.
const ADAPTERS: Record<string, (raw: unknown) => unknown> = {
  sentry: (raw) => sentryToNormalized(raw as SentryRawPayload),
  datadog: (raw) => datadogToNormalized(raw as DatadogRawPayload),
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    return NextResponse.json(
      { ok: false, error: `unknown provider "${provider}"` },
      { status: 404 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 422 },
    );
  }

  // Run the provider adapter, then re-validate the normalized result with zod so
  // a partial/odd raw payload can never produce a malformed row.
  let normalized;
  try {
    normalized = normalizedEventSchema.parse(adapter(raw));
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "adapter_failed",
        provider,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 422 },
    );
  }

  const result = await ingestNormalizedEvent(normalized);

  if (result.status === "unmapped") {
    return NextResponse.json(
      { ok: true, status: "unmapped", account_ref: normalized.account_ref },
      { status: 202 },
    );
  }

  return NextResponse.json(
    { ok: true, provider, status: result.status, id: result.id },
    { status: 200 },
  );
}

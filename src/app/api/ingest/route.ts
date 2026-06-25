/**
 * POST /api/ingest — the single front door for telemetry.
 *
 * This is what a real observability webhook (Sentry/Datadog/CloudWatch) POSTs
 * into, already normalized by a provider adapter. Even Sybil's own "Trigger
 * incident" control flows through here, so there is exactly one ingestion path.
 *
 * Contract (see src/lib/ingest/normalized.ts):
 *   422  invalid body                — never write a malformed row
 *   202  account_ref didn't resolve  — log as "unmapped", don't hard-fail
 *   200  created | ignored           — idempotent insert (dedupe on external_event_id)
 */
import { NextResponse } from "next/server";
import { normalizedEventSchema } from "@/lib/ingest/normalized";
import { ingestNormalizedEvent } from "@/lib/ingest/ingest-event";

export const dynamic = "force-dynamic";
// Allow the first request after a scale-to-zero pause to wait out Aurora's
// resume (~15–30s) instead of timing out at the platform default.
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 422 },
    );
  }

  const parsed = normalizedEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const evt = parsed.data;

  // Resolve + idempotent insert through the shared ingestion core.
  const result = await ingestNormalizedEvent(evt);

  if (result.status === "unmapped") {
    return NextResponse.json(
      { ok: true, status: "unmapped", account_ref: evt.account_ref },
      { status: 202 },
    );
  }

  return NextResponse.json(
    { ok: true, status: result.status, id: result.id },
    { status: 200 },
  );
}

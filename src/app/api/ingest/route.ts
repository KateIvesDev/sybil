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
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, telemetryEvents } from "@/db/schema";
import { normalizedEventSchema, severityToInt } from "@/lib/ingest/normalized";

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

  // Resolve the external tenant identifier → our account. Real ingestion
  // tolerates unknown tenants: a webhook for an account we don't track yet
  // shouldn't 500 the provider into retry storms. Accept, log, move on.
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.externalRef, evt.account_ref))
    .limit(1);

  if (!account) {
    console.warn(
      `[ingest] unmapped account_ref="${evt.account_ref}" source=${evt.source} external_event_id=${evt.external_event_id}`,
    );
    return NextResponse.json(
      { ok: true, status: "unmapped", account_ref: evt.account_ref },
      { status: 202 },
    );
  }

  // Idempotent insert: receiving the same webhook twice is a no-op. The UNIQUE
  // on external_event_id backs the ON CONFLICT — a returned row means we created
  // it, an empty result means we'd already seen this event id.
  const inserted = await db
    .insert(telemetryEvents)
    .values({
      accountId: account.id,
      source: evt.source,
      externalEventId: evt.external_event_id,
      endpoint: evt.endpoint,
      eventType: evt.event_type,
      severity: severityToInt(evt.severity),
      statusCode: evt.status_code ?? null,
      errorSignature: evt.error_signature,
      subject: evt.subject ?? null,
      occurredAt: new Date(evt.occurred_at),
    })
    .onConflictDoNothing({ target: telemetryEvents.externalEventId })
    .returning({ id: telemetryEvents.id });

  const created = inserted.length > 0;
  return NextResponse.json(
    {
      ok: true,
      status: created ? "created" : "ignored",
      id: created ? inserted[0].id : null,
    },
    { status: 200 },
  );
}

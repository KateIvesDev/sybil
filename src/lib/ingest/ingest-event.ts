/**
 * The shared ingestion core: resolve a normalized event to a tenant and write it
 * idempotently. Both the normalized front door (/api/ingest) and the per-provider
 * webhook routes (/api/webhooks/[provider]) funnel through this, so there is
 * exactly one path from "a telemetry event exists" to "a row in telemetry_events".
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, telemetryEvents } from "@/db/schema";
import { severityToInt, type NormalizedEvent } from "./normalized";

export type IngestResult =
  | { status: "created"; id: string }
  | { status: "ignored"; id: null } // duplicate external_event_id (idempotent no-op)
  | { status: "unmapped"; id: null }; // account_ref didn't resolve to a tenant

export async function ingestNormalizedEvent(
  evt: NormalizedEvent,
): Promise<IngestResult> {
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
    return { status: "unmapped", id: null };
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

  return inserted.length > 0
    ? { status: "created", id: inserted[0].id }
    : { status: "ignored", id: null };
}

/**
 * Incident mechanics — the live demo's flip from green to "one red truth".
 *
 * triggerIncident(): simulates a real provider webhook burst. Instead of writing
 * telemetry rows directly, it builds NORMALIZED events against the high-ARR
 * enterprise targets (no matching tickets) and POSTs them at /api/ingest — the
 * exact same path a Sentry/Datadog/CloudWatch webhook takes. Even our own demo
 * trigger flows through the real ingestion endpoint. It still drafts a pending
 * outreach message per account so the dashboard goes red end-to-end.
 *
 * resetToCalm(): clears just the incident — the sync-failure burst and the
 * identity findings — plus open tickets and outreach drafts, preserving the
 * 7-day baseline history so detection keeps its reference point.
 */
import { eq, inArray, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { accounts, telemetryEvents, tickets, outreach } from "@/db/schema";
import {
  INCIDENT_TARGETS,
  INCIDENT_PROFILES,
  INCIDENT_SIGNATURES,
  externalRefFor,
  draftOutreach,
} from "@/lib/demo-data";
import type { NormalizedEvent } from "@/lib/ingest/normalized";
import { notifyIncident } from "@/lib/slack";

// Burst severities skew high so MAX(severity) reads critical, like a real outage.
const BURST_SEVERITIES: NormalizedEvent["severity"][] = [
  "medium",
  "high",
  "high",
  "critical",
];

/**
 * @param baseUrl absolute origin of this deployment (e.g. http://localhost:3000),
 *   so the server can POST to its own /api/ingest. Passed in from the route,
 *   which derives it from the incoming request headers.
 */
export async function triggerIncident(baseUrl: string) {
  const targets = await db
    .select()
    .from(accounts)
    .where(inArray(accounts.name, INCIDENT_TARGETS));

  if (targets.length === 0) {
    throw new Error("No target accounts found — run `pnpm db:seed` first.");
  }

  const now = Date.now();
  const normalized: NormalizedEvent[] = [];
  const drafts: (typeof outreach.$inferInsert)[] = [];
  // Slack notices to post on detection — notify-and-link-out, not approve.
  const notices: Parameters<typeof notifyIncident>[0][] = [];

  for (const acct of targets) {
    const profile = INCIDENT_PROFILES[acct.name];
    if (!profile) continue;
    const { sync, exposure } = profile;

    // (a) The deprovisioning-sync FAILURE burst: 18–32 errors over the last ~6
    //     minutes, escalating severity — this is what trips the RATE-ANOMALY
    //     detector against the tenant's 7-day baseline.
    const burst = 18 + Math.floor(Math.random() * 15);
    for (let i = 0; i < burst; i++) {
      const ageMs = Math.random() * 6 * 60_000; // within last 6 min
      normalized.push({
        source: sync.source,
        // The provider's unique id; fresh per event so re-triggering doesn't
        // collide, while a literal re-send would dedupe via ON CONFLICT.
        external_event_id: `${sync.source}_${randomUUID()}`,
        account_ref: externalRefFor(acct.name),
        event_type: "error",
        endpoint: sync.endpoint,
        status_code: sync.statusCode,
        severity:
          BURST_SEVERITIES[Math.floor(Math.random() * BURST_SEVERITIES.length)],
        error_signature: sync.signature,
        occurred_at: new Date(now - ageMs).toISOString(),
      });
    }

    // (b) The discrete stale-access EXPOSURE the failed sync caused — a terminated
    //     identity still holding live access, dated to its termination so dwell
    //     time reads correctly. Only some tenants carry one, which is what lets
    //     the risk score separate "pipeline failing" from "confirmed exposure".
    if (exposure) {
      normalized.push({
        source: exposure.source,
        external_event_id: `${exposure.source}_${randomUUID()}`,
        account_ref: externalRefFor(acct.name),
        event_type: "stale_access",
        endpoint: exposure.entitlement,
        severity: exposure.severity,
        error_signature: exposure.signature,
        subject: exposure.subject,
        occurred_at: new Date(
          now - exposure.termedHoursAgo * 3_600_000,
        ).toISOString(),
      });
    }

    // Draft proactive outreach (pending human review on the incident page).
    // Skip if one already exists.
    const existing = await db
      .select({ id: outreach.id })
      .from(outreach)
      .where(eq(outreach.accountId, acct.id));
    if (existing.length === 0) {
      drafts.push({
        accountId: acct.id,
        draftBody: draftOutreach(
          acct.name,
          acct.csmOwner,
          sync.endpoint,
          burst,
          Boolean(exposure),
          exposure?.subject,
        ),
        // Defaults apply: incident_status='active', outreach_status='none' —
        // i.e. "Impacted". The CSM advances the lifecycle from the incident page.
      });
    }

    // Heads-up to #sybil-alert with a link out to the incident page. Slack only
    // notifies; the CSM reviews and sends from /incidents/[accountId].
    notices.push({
      csmOwner: acct.csmOwner,
      accountName: acct.name,
      arr: acct.arr,
      endpoint: sync.endpoint,
      accountId: acct.id,
      baseUrl,
    });
  }

  // Fire the burst at the real ingestion endpoint, exactly like a provider would.
  const results = await Promise.all(
    normalized.map((event) =>
      fetch(`${baseUrl}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      }).then((res) => res.json().catch(() => ({ status: "error" }))),
    ),
  );
  const eventsWritten = results.filter((r) => r?.status === "created").length;

  if (drafts.length > 0) await db.insert(outreach).values(drafts);

  // Post the Slack heads-up for every impacted account (notify-only).
  await Promise.all(notices.map(notifyIncident));

  return {
    accountsImpacted: targets.length,
    eventsWritten,
    draftsCreated: drafts.length,
  };
}

export async function resetToCalm() {
  // Clear only the incident, never the baseline. Delete (a) the sync-failure
  // burst by its distinctive incident signatures, and (b) every identity finding
  // (stale_access / policy_violation only ever exist from a trigger). The 7-day
  // baseline error history — and the benign latency noise — are preserved so the
  // anomaly detector keeps its reference point and the charts stay alive.
  await db
    .delete(telemetryEvents)
    .where(inArray(telemetryEvents.errorSignature, INCIDENT_SIGNATURES));
  await db
    .delete(telemetryEvents)
    .where(
      inArray(telemetryEvents.eventType, ["stale_access", "policy_violation"]),
    );
  // Drop any open tickets and all outreach drafts.
  await db.delete(tickets).where(eq(tickets.status, "open"));
  await db.delete(outreach);
  return { ok: true };
}

/**
 * Demo helper for "the customer finally noticed": file an open ticket for an
 * impacted account and mark its outreach as sent. The ticket no longer affects
 * the feed (Sybil alerts on any impact) — it surfaces as live context on the
 * incident page (src/lib/ticket-context.ts). Not wired to a button by default.
 */
export async function fileTicketFor(accountId: string) {
  await db.insert(tickets).values({ accountId, status: "open" });
  await db
    .update(outreach)
    .set({ outreachStatus: "initial_sent", sentAt: new Date() })
    .where(
      and(
        eq(outreach.accountId, accountId),
        eq(outreach.outreachStatus, "none"),
      ),
    );
  return { ok: true };
}

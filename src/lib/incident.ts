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
import { eq, inArray, and, gte } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { accounts, telemetryEvents, tickets, outreach } from "@/db/schema";
import {
  INCIDENT_TARGETS,
  INCIDENT_PROFILES,
  externalRefFor,
  draftOutreach,
} from "@/lib/demo-data";
import type { NormalizedEvent } from "@/lib/ingest/normalized";
import { notifyIncident } from "@/lib/slack";
import { refreshBaselineMatview } from "@/db/queries";

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

/**
 * Open an incident for any account DETECTION surfaced that doesn't already have
 * one. This is what lets the *real* pipeline — a provider webhook landing through
 * /api/webhooks → /api/ingest, e.g. `pnpm demo:webhook` — drive the dashboard
 * lifecycle, not just the scripted Trigger button: revenue-at-risk decides who is
 * impacted, and this reconciles an incident record (the thing deriveDisplayStatus
 * reads) into existence so the row goes red and the human-in-the-loop outreach can
 * begin. Idempotent: accounts that already have a record (from the Trigger, or a
 * prior poll) are skipped, so a CSM's in-progress lifecycle is never overwritten.
 *
 * Called from the /api/revenue-at-risk read path (polled every 5s), so a freshly
 * detected account opens its incident within a poll or two.
 *
 * @param baseUrl absolute origin so the Slack heads-up's Review link is clickable.
 */
export async function openIncidentsForDetected(
  detected: {
    accountId: string;
    accountName: string;
    arr: number;
    csmOwner: string;
    failingEndpoint?: string | null;
    syncFailures?: number;
    exposureCount?: number;
    subject?: string | null;
  }[],
  baseUrl: string,
): Promise<number> {
  if (detected.length === 0) return 0;

  const ids = detected.map((d) => d.accountId);
  const existing = await db
    .select({ accountId: outreach.accountId })
    .from(outreach)
    .where(inArray(outreach.accountId, ids));
  const have = new Set(existing.map((e) => e.accountId));

  const fresh = detected.filter((d) => !have.has(d.accountId));
  if (fresh.length === 0) return 0;

  await db.insert(outreach).values(
    fresh.map((d) => ({
      accountId: d.accountId,
      draftBody: draftOutreach(
        d.accountName,
        d.csmOwner,
        d.failingEndpoint ?? "the affected deprovisioning endpoint",
        d.syncFailures ?? 0,
        (d.exposureCount ?? 0) > 0,
        d.subject ?? undefined,
      ),
      // Defaults: incident_status='active', outreach_status='none' → "Impacted".
    })),
  );

  // Heads-up to #sybil-alert for each newly opened incident (notify-only).
  await Promise.all(
    fresh.map((d) =>
      notifyIncident({
        csmOwner: d.csmOwner,
        accountName: d.accountName,
        arr: d.arr,
        endpoint: d.failingEndpoint ?? "deprovisioning sync",
        accountId: d.accountId,
        baseUrl,
      }),
    ),
  );

  return fresh.length;
}

export async function resetToCalm() {
  // Clear only the incident, never the baseline. Delete (a) the error BURST and
  // (b) every identity finding (stale_access / policy_violation only ever exist
  // from a trigger). The 7-day baseline error history — and the benign latency
  // noise — are preserved so the anomaly detector keeps its reference point and
  // the charts stay alive.
  //
  // The burst is matched by SEVERITY (≥ 3), not by signature: the in-app Trigger
  // writes INCIDENT_SIGNATURES, but a real provider webhook (demo:webhook → the
  // Sentry adapter) writes its own arbitrary signature, so signature-matching
  // would leave those errors in the live window and — now that detection auto-
  // opens incidents — the next poll would just re-open the incident ("keeps
  // firing" after reset). The seed baseline is severity 1–2; every burst, from
  // either source, is severity ≥ 3, so severity cleanly separates the two.
  await db
    .delete(telemetryEvents)
    .where(and(eq(telemetryEvents.eventType, "error"), gte(telemetryEvents.severity, 3)));
  await db
    .delete(telemetryEvents)
    .where(
      inArray(telemetryEvents.eventType, ["stale_access", "policy_violation"]),
    );
  // Drop any open tickets and all outreach drafts.
  await db.delete(tickets).where(eq(tickets.status, "open"));
  await db.delete(outreach);

  // Recompute the baseline rollup now that the incident rows are gone. Without
  // this, a burst that was ever folded into mv_hourly_error_counts (e.g. the cron
  // or a manual db:matview ran while an incident was live) stays baked into each
  // tenant's mu/sigma for 7 days — inflating the baseline so a fresh burst no
  // longer clears z>=3, and an anomaly-only target (Atlas, Vertex) fires an
  // incident record but never surfaces in revenue-at-risk → it reads as "signal
  // subsided" while its telemetry is minutes old. Refreshing on reset (every
  // sign-in) self-heals that. Best-effort: a missing matview (matview step never
  // run) must not wedge the reset.
  try {
    await refreshBaselineMatview();
  } catch {
    // No matview yet (local dev without db:matview) — detection falls back to
    // the COALESCE(sigma,1) default; nothing to clean.
  }

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

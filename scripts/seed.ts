/**
 * Seed Sybil with a healthy book of business.
 *
 *   pnpm db:seed
 *
 * Inserts ~20 accounts (all green), a little benign latency noise, and ONE
 * closed historical ticket so the data looks lived-in. No active errors, no
 * open tickets — the dashboard should read all-green until you trigger an
 * incident from the UI.
 */
import { config } from "dotenv";
// Load env BEFORE importing the db client (which reads DATABASE_URL at import).
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const { db } = await import("../src/db");
  const { accounts, telemetryEvents, tickets, outreach } = await import(
    "../src/db/schema"
  );
  const {
    SEED_ACCOUNTS,
    HEALTHY_ENDPOINTS,
    BASELINE_SYNC_SIGNATURES,
    externalRefFor,
  } = await import("../src/lib/demo-data");

  const PROVIDERS = ["sentry", "datadog", "cloudwatch", "custom"] as const;

  console.log("🌱 Seeding Sybil…");

  // Clean slate (cascade clears child rows).
  await db.delete(outreach);
  await db.delete(tickets);
  await db.delete(telemetryEvents);
  await db.delete(accounts);

  // Accounts.
  const now = Date.now();
  const inserted = await db
    .insert(accounts)
    .values(
      SEED_ACCOUNTS.map((a) => ({
        name: a.name,
        tier: a.tier,
        arr: a.arr.toFixed(2),
        csmOwner: a.csmOwner,
        region: a.region,
        renewalDate: new Date(now + a.renewalInDays * 86_400_000),
        // The external_ref providers send as account_ref; the resolution key
        // /api/ingest uses to map a webhook back to this account.
        externalRef: externalRefFor(a.name),
      })),
    )
    .returning({ id: accounts.id, name: accounts.name });

  console.log(`  ✓ ${inserted.length} accounts`);

  // Benign latency noise over the last hour so charts aren't dead-empty.
  const noise: (typeof telemetryEvents.$inferInsert)[] = [];
  for (const acct of inserted) {
    const samples = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < samples; i++) {
      noise.push({
        accountId: acct.id,
        endpoint:
          HEALTHY_ENDPOINTS[
            Math.floor(Math.random() * HEALTHY_ENDPOINTS.length)
          ],
        eventType: "latency",
        severity: 1,
        statusCode: 200,
        errorSignature: null,
        occurredAt: new Date(now - Math.random() * 3_600_000),
      });
    }
  }
  await db.insert(telemetryEvents).values(noise);
  console.log(`  ✓ ${noise.length} benign latency events`);

  // 7 days of LOW background deprovisioning-sync errors per tenant. Every identity
  // pipeline has a normal hum of transient failures (downstream 429s, sync lag);
  // this is the baseline the anomaly detector learns, so a real malformed-payload
  // burst reads as N× normal rather than just "an error happened". Each tenant gets
  // its own rate so baselines genuinely differ. Severity stays low (2) — well below
  // the incident burst — so MAX(severity) also separates normal from incident.
  const SEVEN_DAYS_MS = 7 * 86_400_000;
  const TRANSIENT_CODES = [429, 503, 502, 408];
  const baseline: (typeof telemetryEvents.$inferInsert)[] = [];
  for (const acct of inserted) {
    const ratePerHour = 0.8 + Math.random() * 2.2; // ~0.8–3.0/hr, varied per tenant
    const total = Math.round(ratePerHour * 24 * 7);
    for (let i = 0; i < total; i++) {
      baseline.push({
        accountId: acct.id,
        source: PROVIDERS[Math.floor(Math.random() * PROVIDERS.length)],
        endpoint:
          HEALTHY_ENDPOINTS[Math.floor(Math.random() * HEALTHY_ENDPOINTS.length)],
        eventType: "error",
        severity: 2,
        statusCode:
          TRANSIENT_CODES[Math.floor(Math.random() * TRANSIENT_CODES.length)],
        errorSignature:
          BASELINE_SYNC_SIGNATURES[
            Math.floor(Math.random() * BASELINE_SYNC_SIGNATURES.length)
          ],
        occurredAt: new Date(now - Math.random() * SEVEN_DAYS_MS),
      });
    }
  }
  // Chunked insert — a single multi-thousand-row VALUES is unfriendly to the driver.
  for (let i = 0; i < baseline.length; i += 1000) {
    await db.insert(telemetryEvents).values(baseline.slice(i, i + 1000));
  }
  console.log(`  ✓ ${baseline.length} baseline sync-error events (7-day history)`);

  // One closed historical ticket — proves the join filters on status='open'.
  await db.insert(tickets).values({
    accountId: inserted[5].id,
    status: "closed",
    createdAt: new Date(now - 9 * 86_400_000),
  });
  console.log("  ✓ 1 closed historical ticket");

  console.log("✅ Seed complete — dashboard should be all green.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

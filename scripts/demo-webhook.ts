/**
 * Fire a realistic burst of RAW Sentry webhooks at the live deployment, exactly
 * as Sentry would — the "this is a real provider pipeline, not a scripted demo"
 * moment. Each event gets a unique id (so they don't dedupe) and a timestamp in
 * the last few minutes (so it lands in the live anomaly window).
 *
 *   pnpm demo:webhook                         # defaults to http://localhost:3000
 *   pnpm demo:webhook https://sybil-psi.vercel.app
 *   pnpm demo:webhook https://sybil-psi.vercel.app 25 ext_acme_industries
 *
 * Sends to /api/webhooks/sentry → sentryToNormalized → ingest → telemetry_events.
 * Watch the dashboard flip the target tenant to Impacted within one 5s poll.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const baseUrl = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const count = Number(process.argv[3] ?? 22);
const accountRef = process.argv[4] ?? "ext_acme_industries";

const template = JSON.parse(
  readFileSync(join(process.cwd(), "scripts/payloads/sentry-deprovision-fail.json"), "utf8"),
);

// Severities skew high so MAX(severity) reads critical, like a real outage.
const LEVELS = ["warning", "error", "error", "fatal"];

async function main() {
  console.log(`→ POSTing ${count} raw Sentry webhooks to ${baseUrl}/api/webhooks/sentry (account_ref=${accountRef})`);
  const counts: Record<string, number> = {};

  for (let i = 0; i < count; i++) {
    // Clone the template, then stamp a unique id, a recent time, and the tenant.
    const payload = structuredClone(template);
    const ev = payload.data.event;
    ev.event_id = `evt_${randomUUID().replace(/-/g, "")}`;
    ev.level = LEVELS[Math.floor(Math.random() * LEVELS.length)];
    ev.timestamp = new Date(Date.now() - Math.random() * 6 * 60_000).toISOString();
    ev.tags = ev.tags.map((t: [string, string]) =>
      t[0] === "account_ref" ? ["account_ref", accountRef] : t,
    );

    const res = await fetch(`${baseUrl}/api/webhooks/sentry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({ status: `http_${res.status}` }));
    const key = body.status ?? `http_${res.status}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }

  console.log("✓ done:", counts);
  if (counts.unmapped) {
    console.log(
      `  note: ${counts.unmapped} unmapped — is the DB seeded and does account_ref="${accountRef}" exist?`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Apply the manual materialized-view migration over direct TCP.
 *   pnpm db:matview
 *
 * Run this AFTER `pnpm db:push` (it depends on telemetry_events existing) and
 * whenever the matview/index DDL changes. It uses the `pg` driver against
 * DATABASE_URL — NOT the RDS Data API, which can't run multi-statement DDL.
 * This matches how db:push / db:seed are run (admin TCP) per the README.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const SQL_FILE = join(
  process.cwd(),
  "src/db/migrations/manual/0003_baseline_matview.sql",
);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (run over direct TCP).");

  const sql = readFileSync(SQL_FILE, "utf8");
  const client = new Client({
    connectionString: url,
    // Aurora's RDS CA chain trips strict verification; match the app's posture.
    ssl: url.includes("sslmode=no-verify") ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  try {
    // pg runs the whole file (multiple statements incl. the DO block) in one call.
    await client.query(sql);
    console.log("✓ applied 0003_baseline_matview.sql");

    const { rows } = await client.query(
      "SELECT count(*)::int AS buckets, count(DISTINCT account_id)::int AS accounts FROM mv_hourly_error_counts",
    );
    console.log(
      `  mv_hourly_error_counts: ${rows[0].buckets} hourly buckets across ${rows[0].accounts} accounts`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

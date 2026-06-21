/**
 * Database client — two interchangeable drivers behind one `db` export.
 *
 * Default (local Docker, seeding, direct-to-Aurora): pooled `pg` over TCP. On
 * Vercel each warm container reuses a single Pool cached on globalThis instead
 * of opening a connection per request (which would exhaust Aurora's limit).
 *
 * USE_DATA_API=true: the RDS Data API (HTTPS + IAM, no open 5432, no pool to
 * keep warm) — the secure way for Vercel (outside the VPC, no fixed egress IP)
 * to reach a private Aurora, and a natural fit for scale-to-zero. The app code
 * is unchanged: both drivers expose the same Drizzle API and an `execute()` that
 * returns `{ rows }`, so queries.ts works either way.
 *
 * NOTE: the Data API path can't be exercised against local Postgres — validate
 * it against real Aurora before flipping enable_public_db_access off (see README).
 */
import {
  drizzle as drizzlePg,
  type NodePgDatabase,
} from "drizzle-orm/node-postgres";
import { drizzle as drizzleDataApi } from "drizzle-orm/aws-data-api/pg";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { Pool } from "pg";
import * as schema from "./schema";

// Both drivers are PgDatabase subtypes with identical call sites in this app;
// we expose the node-postgres type as the common shape and cast the Data API
// one to it (its execute() returns the same `{ rows }`, verified against the
// driver's AwsDataApiPgQueryResult type).
type DB = NodePgDatabase<typeof schema>;

const useDataApi = process.env.USE_DATA_API === "true";

let db: DB;

if (useDataApi) {
  const resourceArn = process.env.RDS_RESOURCE_ARN;
  const secretArn = process.env.RDS_SECRET_ARN;
  if (!resourceArn || !secretArn) {
    throw new Error(
      "USE_DATA_API=true requires RDS_RESOURCE_ARN and RDS_SECRET_ARN (terraform outputs). AWS creds come from AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION.",
    );
  }
  // RDSDataClient resolves credentials + region from the standard AWS env vars.
  const rds = new RDSDataClient({ region: process.env.AWS_REGION });
  db = drizzleDataApi(rds, {
    database: process.env.RDS_DATABASE ?? "sybil",
    resourceArn,
    secretArn,
    schema,
  }) as unknown as DB;
} else {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and point it at your (pooled) Postgres/Aurora endpoint — or set USE_DATA_API=true with the RDS_* vars.",
    );
  }

  // Reuse the pool across hot invocations to stay under Aurora's max_connections.
  const globalForDb = globalThis as unknown as { pool?: Pool };

  const pool =
    globalForDb.pool ??
    new Pool({
      connectionString,
      max: 5, // small per-instance cap; the pooled endpoint fans these in
      idleTimeoutMillis: 30_000,
      // A scale-to-zero Aurora cluster takes ~15–30s to resume; give the first
      // connection after a pause room to wait rather than erroring immediately.
      connectionTimeoutMillis: 50_000,
      // Aurora/managed Postgres require TLS; relax verification for demo simplicity.
      ssl: connectionString.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
    });

  if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

  db = drizzlePg(pool, { schema });
}

export { db, schema };

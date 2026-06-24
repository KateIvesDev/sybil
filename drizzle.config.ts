import { defineConfig } from "drizzle-kit";

// NOTE: drizzle-kit ignores a separate `ssl` option when a `url` is given — it
// reads SSL behavior straight from the connection string. For Aurora, use
// `?sslmode=no-verify` (encrypted, but skips RDS CA-chain verification, which
// newer `pg` enforces for sslmode=require and fails with
// UNABLE_TO_GET_ISSUER_CERT_LOCALLY). Local Docker needs no sslmode.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});

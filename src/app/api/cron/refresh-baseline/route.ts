/**
 * POST|GET /api/cron/refresh-baseline — recompute the baseline rollup.
 *
 * This is the portable refresh scheduler: wire it to a Vercel Cron job (the
 * baseline is a 7-day average, so even a daily refresh is fine), and hit it
 * manually after a re-seed. (pg_cron is an optional advanced alternative on
 * Aurora clusters already configured for it — see docs/PERFORMANCE.md.)
 *
 * Optionally protect it with CRON_SECRET: if that env var is set, the caller must
 * send `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this automatically).
 */
import { NextResponse } from "next/server";
import { refreshBaselineMatview } from "@/db/queries";

export const dynamic = "force-dynamic";
// Allow the first request after a scale-to-zero pause to wait out Aurora's resume.
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unprotected if no secret configured
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  await refreshBaselineMatview();
  return NextResponse.json({ ok: true, refreshed: "mv_hourly_error_counts" });
}

export async function POST(request: Request) {
  return handle(request);
}

// GET so it can be wired as a Vercel Cron job (which issues GET requests).
export async function GET(request: Request) {
  return handle(request);
}

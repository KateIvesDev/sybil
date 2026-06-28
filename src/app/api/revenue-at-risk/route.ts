import { NextResponse } from "next/server";
import {
  getRevenueAtRisk,
  getErrorPulse,
  REVENUE_AT_RISK_SQL,
} from "@/db/queries";
import { openIncidentsForDetected } from "@/lib/incident";

export const dynamic = "force-dynamic";
// Allow the first request after a scale-to-zero pause to wait out Aurora's
// resume (~15–30s) instead of timing out at the platform default.
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const windowMinutes = Number(searchParams.get("window") ?? 60);
  // Correlation set + a fleet-wide per-minute pulse for the hero sparkline.
  const [rows, pulse] = await Promise.all([
    getRevenueAtRisk(windowMinutes),
    getErrorPulse(60),
  ]);

  // Detection drives the lifecycle: open an incident for any surfaced account that
  // doesn't have one yet, so a REAL provider webhook (not just the scripted
  // Trigger) makes the board go red. Idempotent and best-effort — a hiccup here
  // must never break the read the dashboard polls on.
  try {
    const host = request.headers.get("host") ?? "localhost:3000";
    const proto =
      request.headers.get("x-forwarded-proto") ??
      (host.startsWith("localhost") ? "http" : "https");
    await openIncidentsForDetected(rows, `${proto}://${host}`);
  } catch (err) {
    console.error("[revenue-at-risk] incident reconcile failed:", err);
  }

  // Ship the SQL alongside the data so the "View query" affordance is honest.
  return NextResponse.json({ rows, pulse, sql: REVENUE_AT_RISK_SQL, windowMinutes });
}

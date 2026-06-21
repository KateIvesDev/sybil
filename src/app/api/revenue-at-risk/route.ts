import { NextResponse } from "next/server";
import {
  getRevenueAtRisk,
  getErrorPulse,
  REVENUE_AT_RISK_SQL,
} from "@/db/queries";

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
  // Ship the SQL alongside the data so the "View query" affordance is honest.
  return NextResponse.json({ rows, pulse, sql: REVENUE_AT_RISK_SQL, windowMinutes });
}

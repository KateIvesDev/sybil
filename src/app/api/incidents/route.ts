import { NextResponse } from "next/server";
import { getIncidents } from "@/db/queries";

export const dynamic = "force-dynamic";
// Allow the first request after a scale-to-zero pause to wait out Aurora's
// resume (~15–30s) instead of timing out at the platform default.
export const maxDuration = 60;

// The incident lifecycle per account (incident_status × outreach_status). The
// client merges this with /api/accounts to derive each row's display status.
export async function GET() {
  const rows = await getIncidents();
  return NextResponse.json({ rows });
}

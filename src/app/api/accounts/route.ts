import { NextResponse } from "next/server";
import { getAllAccounts } from "@/db/queries";

export const dynamic = "force-dynamic";
// Allow the first request after a scale-to-zero pause to wait out Aurora's
// resume (~15–30s) instead of timing out at the platform default.
export const maxDuration = 60;

// The full account roster for the always-on account-status table. The client
// merges this with /api/revenue-at-risk to mark which accounts are impacted.
export async function GET() {
  const rows = await getAllAccounts();
  return NextResponse.json({ rows });
}

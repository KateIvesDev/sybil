import { NextResponse } from "next/server";
import { getTicketContext } from "@/lib/ticket-context";

export const dynamic = "force-dynamic";
// Allow the first request after a scale-to-zero pause to wait out Aurora's
// resume (~15–30s) instead of timing out at the platform default.
export const maxDuration = 60;

// On-demand, CSM-initiated related-ticket lookup for the incident page.
// Deliberately NOT called on page load or from Slack — the client hits this only
// when a CSM clicks "Check for related tickets". Help-desk-agnostic: this route
// talks to the TicketContextProvider abstraction, not to any specific vendor.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const windowDays = Number(searchParams.get("windowDays") ?? 30);
  // The account name lets the mock pin confirmed-exposure tenants to the silent
  // (empty) state deterministically across reseeds.
  const accountName = searchParams.get("accountName") ?? undefined;

  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  const context = await getTicketContext(accountId, windowDays, accountName);
  return NextResponse.json(context);
}

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outreach, accounts } from "@/db/schema";

export const dynamic = "force-dynamic";
// Allow the first request after a scale-to-zero pause to wait out Aurora's
// resume (~15–30s) instead of timing out at the platform default.
export const maxDuration = 60;

// List outreach drafts joined to their account (name + ARR for context).
// Pass ?accountId= to fetch the single draft for the incident page.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");

  const base = db
    .select({
      id: outreach.id,
      accountId: outreach.accountId,
      accountName: accounts.name,
      arr: accounts.arr,
      csmOwner: accounts.csmOwner,
      draftBody: outreach.draftBody,
      incidentStatus: outreach.incidentStatus,
      outreachStatus: outreach.outreachStatus,
      approvedBy: outreach.approvedBy,
      sentAt: outreach.sentAt,
      resolvedAt: outreach.resolvedAt,
      resolutionSentAt: outreach.resolutionSentAt,
      createdAt: outreach.createdAt,
    })
    .from(outreach)
    .innerJoin(accounts, eq(outreach.accountId, accounts.id));

  const rows = accountId
    ? await base.where(eq(outreach.accountId, accountId))
    : await base;

  // arr is highest-first for the UI.
  rows.sort((a, b) => Number(b.arr) - Number(a.arr));
  return NextResponse.json({ rows });
}

/**
 * Advance the incident lifecycle on a single record. Four moves, composable:
 *   - draftBody          edit the (initial) message before it's sent
 *   - sendInitial        none → initial_sent  ("Notified"), stamps sentAt
 *   - resolve            active → resolved     ("Resolved"), stamps resolvedAt
 *   - sendResolution     initial_sent → resolution_sent, stamps resolutionSentAt
 *
 * Slack is not involved — it fired a notify-only heads-up at detection time.
 * Customer-facing sends are stubbed; the point is the human-reviewed transition.
 */
export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    id: string;
    draftBody?: string;
    sendInitial?: boolean;
    resolve?: boolean;
    sendResolution?: boolean;
    resolutionBody?: string;
    approvedBy?: string;
  };

  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Save any edits to the initial draft first.
  if (typeof body.draftBody === "string") {
    await db
      .update(outreach)
      .set({ draftBody: body.draftBody })
      .where(eq(outreach.id, body.id));
  }

  const [ctx] = await db
    .select({ draftBody: outreach.draftBody, accountName: accounts.name })
    .from(outreach)
    .innerJoin(accounts, eq(outreach.accountId, accounts.id))
    .where(eq(outreach.id, body.id));

  if (body.sendInitial) {
    sendToCustomer(ctx?.accountName ?? "account", ctx?.draftBody ?? "");
    await db
      .update(outreach)
      .set({
        outreachStatus: "initial_sent",
        approvedBy: body.approvedBy ?? "CSM (demo)",
        sentAt: new Date(),
      })
      .where(eq(outreach.id, body.id));
  }

  if (body.resolve) {
    await db
      .update(outreach)
      .set({ incidentStatus: "resolved", resolvedAt: new Date() })
      .where(eq(outreach.id, body.id));
  }

  if (body.sendResolution) {
    sendToCustomer(
      ctx?.accountName ?? "account",
      body.resolutionBody ?? "Resolution update.",
    );
    await db
      .update(outreach)
      .set({ outreachStatus: "resolution_sent", resolutionSentAt: new Date() })
      .where(eq(outreach.id, body.id));
  }

  const [updated] = await db
    .select()
    .from(outreach)
    .where(eq(outreach.id, body.id));
  return NextResponse.json({ ok: true, outreach: updated });
}

// The customer-facing send is stubbed: log to console. Real email/delivery would
// slot in here. Nothing reaches a customer without a human clicking Send.
function sendToCustomer(accountName: string, message: string) {
  console.log(`\n────────── [OUTREACH SENT] ${accountName} ──────────`);
  console.log(message);
  console.log("──────────────────────────────────────────────────\n");
}

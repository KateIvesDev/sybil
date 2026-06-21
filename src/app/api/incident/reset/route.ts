import { NextResponse } from "next/server";
import { resetToCalm } from "@/lib/incident";

export const dynamic = "force-dynamic";
// Allow the first request after a scale-to-zero pause to wait out Aurora's
// resume (~15–30s) instead of timing out at the platform default.
export const maxDuration = 60;

export async function POST() {
  await resetToCalm();
  return NextResponse.json({ ok: true });
}

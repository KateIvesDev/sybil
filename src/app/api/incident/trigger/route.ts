import { NextResponse } from "next/server";
import { triggerIncident } from "@/lib/incident";

export const dynamic = "force-dynamic";
// Allow the first request after a scale-to-zero pause to wait out Aurora's
// resume (~15–30s) instead of timing out at the platform default.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    // Derive this deployment's own origin so the incident can POST its burst at
    // /api/ingest — the same front door real provider webhooks come through.
    const host = request.headers.get("host") ?? "localhost:3000";
    const proto =
      request.headers.get("x-forwarded-proto") ??
      (host.startsWith("localhost") ? "http" : "https");
    const baseUrl = `${proto}://${host}`;

    const result = await triggerIncident(baseUrl);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 400 },
    );
  }
}

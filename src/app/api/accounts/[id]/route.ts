import { NextResponse } from "next/server";
import { getAccountDrilldown } from "@/db/queries";

export const dynamic = "force-dynamic";
// Allow the first request after a scale-to-zero pause to wait out Aurora's
// resume (~15–30s) instead of timing out at the platform default.
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const windowMinutes = Number(searchParams.get("window") ?? 60);
  const data = await getAccountDrilldown(id, windowMinutes);
  if (!data) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}

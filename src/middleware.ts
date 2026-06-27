import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, expectedToken } from "@/lib/auth-gate";

/**
 * Password gate for the demo (so only judges with the access code can drive the
 * site). Deliberately app-level, NOT Vercel's built-in protection: that
 * intercepts every request — including the incident trigger's server-to-server
 * self-fetch to /api/ingest, the /api/webhooks/* endpoints, and /api/cron/* —
 * which would break the demo (we hit exactly that 302-to-sso bug before).
 *
 * This guards PAGE routes only. The matcher below excludes /api, Next internals,
 * and static files, so all API routes stay open and the demo mechanics are
 * untouched. The gate is opt-in: with no SITE_PASSWORD set (e.g. local dev) it
 * passes everything through.
 */
export async function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next(); // gate disabled

  // The login page is the gate itself — always reachable.
  if (req.nextUrl.pathname === "/login") return NextResponse.next();

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (token && token === (await expectedToken(password))) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // Pages only — exclude api, _next, and any path with a file extension.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

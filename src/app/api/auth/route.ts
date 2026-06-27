/**
 * POST /api/auth — validate the demo access password and set the gate cookie.
 *
 * Lives under /api so it is exempt from the middleware gate (it has to be
 * reachable before you're authenticated). On a correct password it sets an
 * httpOnly cookie holding a hash of SITE_PASSWORD; the middleware checks that
 * same hash. Changing SITE_PASSWORD invalidates existing cookies automatically.
 */
import { NextResponse } from "next/server";
import { AUTH_COOKIE, expectedToken } from "@/lib/auth-gate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const password = process.env.SITE_PASSWORD;

  let submitted = "";
  try {
    const body = await request.json();
    if (typeof body?.password === "string") submitted = body.password;
  } catch {
    /* empty body → treated as wrong password below */
  }

  // Gate disabled (no password configured, e.g. local dev): accept so the
  // login flow still works without a password.
  if (!password) return NextResponse.json({ ok: true, gated: false });

  if (submitted !== password) {
    return NextResponse.json(
      { ok: false, error: "incorrect_password" },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ ok: true, gated: true });
  res.cookies.set(AUTH_COOKIE, await expectedToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return res;
}

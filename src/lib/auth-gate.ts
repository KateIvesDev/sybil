/**
 * Shared bits for the demo access-code gate, used by both the middleware (edge)
 * and the /api/auth route. Kept driver/runtime-agnostic: only Web Crypto, which
 * is available in both the edge and Node runtimes.
 */
export const AUTH_COOKIE = "sybil_auth";

// The cookie value is a hash of SITE_PASSWORD, so changing the password
// invalidates existing cookies automatically and the raw password is never
// stored in the cookie.
export async function expectedToken(secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${secret}:sybil-gate`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

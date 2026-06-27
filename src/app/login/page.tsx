"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Activity, ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Demo access gate + on-ramp. The themed "Sign in with SSO" card doubles as the
 * real password gate (the access code is checked by /api/auth, enforced by
 * middleware) so only judges with the code can drive the site. On a correct
 * code we reset (which also wakes a scaled-to-zero cluster behind the
 * "Signing in…" spinner) and hand off to /dashboard?demo=1, which holds green a
 * beat then auto-fires the incident. With no SITE_PASSWORD configured (local
 * dev) any code is accepted, so the flow is unchanged.
 */
export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      // Validate the access code first; on success this sets the gate cookie.
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Incorrect access code.");
        setBusy(false);
        return;
      }
      // Best-effort reset so every visitor gets a fresh green→red arc. Also warms
      // Aurora from a scale-to-zero pause while the "Signing in…" state is shown.
      await fetch("/api/incident/reset", { method: "POST" });
    } catch {
      // Even if the reset blips, still enter the demo — the board self-heals.
    }
    router.push("/dashboard?demo=1");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="container flex h-14 items-center">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center"
        >
          <div className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-md bg-foreground/90">
            <Activity className="h-5 w-5 text-background" />
          </div>
          <h1 className="text-lg font-semibold">Sign in to Sybil</h1>
          <p className="mt-1 text-sm text-muted-foreground">
           Churn detection for your book of customers.
          </p>

          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) signIn();
            }}
            placeholder="Access code"
            autoComplete="current-password"
            disabled={busy}
            aria-label="Access code"
            className="mt-6 w-full rounded-md border border-border bg-background px-3 py-2 text-center text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          {error && (
            <p className="mt-2 text-sm text-destructive">{error}</p>
          )}

          <Button
            className="mt-3 w-full gap-2"
            size="lg"
            onClick={signIn}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4" />
                Continue with SSO
              </>
            )}
          </Button>
          <div className="mt-2 text-sm text-muted-foreground">
            as <span className="font-medium text-foreground">Priya Nair</span> ·
            Customer Success
          </div>

          {busy && (
            <p className="mt-4 text-sm text-muted-foreground">
              Establishing session — waking the database if it was idle…
            </p>
          )}

          <p className="mt-6 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
            Demo environment — access-code protected. Enter the code from the
            submission to continue.
          </p>
        </motion.div>
      </main>
    </div>
  );
}

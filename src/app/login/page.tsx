"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Activity, ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Demo SSO gate — theatre, not real auth. Sybil's customers are SSO/IGA vendors,
 * so "Sign in with SSO" is on-thesis: a single click, prefilled identity, clearly
 * labelled as a demo. It doubles as the on-ramp that primes the self-running demo:
 * on continue we reset (which also wakes a scaled-to-zero cluster behind
 * the "Signing in…" spinner) and hand off to /dashboard?demo=1, which holds green
 * a beat then auto-fires the incident.
 */
export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    try {
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
            Identity-impact detection for your book of tenants.
          </p>

          <Button
            className="mt-6 w-full gap-2"
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

          <p className="mt-6 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
            Demo environment — single-click SSO, no real authentication. Sybil&apos;s
            actual customers authenticate their tenants via SSO; this mirrors that.
          </p>
        </motion.div>
      </main>
    </div>
  );
}

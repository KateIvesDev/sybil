"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Activity, AlertTriangle, Loader2 } from "lucide-react";
import { AccountStatusFeed } from "@/components/account-status-feed";
import { CommandCenterHero } from "@/components/command-center-hero";
import { FleetConstellation } from "@/components/fleet-constellation";
import { DemoControls } from "@/components/demo-controls";
import { formatCurrency } from "@/lib/utils";
import {
  deriveDisplayStatus,
  STATUS_SORT_WEIGHT,
} from "@/lib/incident-status";
import type {
  AccountRow,
  AccountStatusRow,
  IncidentRow,
  PulsePoint,
  RevenueAtRiskRow,
} from "@/lib/types";

// The revenue-at-risk query runs over a 60-minute window (the default the
// /api/revenue-at-risk route applies), so error counts divide by 60 → errors/min.
const WINDOW_MINUTES = 60;

const POLL_MS = 5000;

// How long the calm-green board holds before the demo auto-trigger fires. Long
// enough that a judge registers "green = normal" so the red flip reads as a
// real escalation, not a page that just loads red.
const DEMO_DWELL_MS = 9000;

export function Dashboard({ demoArmed = false }: { demoArmed?: boolean }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [impact, setImpact] = useState<RevenueAtRiskRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [pulse, setPulse] = useState<PulsePoint[]>([]);
  const [sql, setSql] = useState("");
  // False until the first successful load. On a cold start the API routes block
  // while Aurora Serverless v2 resumes from zero (~15–30s); we show a "warming"
  // screen until data arrives rather than flashing an empty $0 dashboard.
  const [ready, setReady] = useState(false);

  // Track impact count across polls to fire a toast/banner only on transition.
  const prevImpact = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    let a, si, inc;
    try {
      [a, si, inc] = await Promise.all([
        fetch("/api/accounts").then((r) => r.json()),
        fetch("/api/revenue-at-risk").then((r) => r.json()),
        fetch("/api/incidents").then((r) => r.json()),
      ]);
    } catch {
      // Likely the cold-start resume window — keep the warming screen up and let
      // the next poll retry. Never tear down a loaded dashboard on a blip.
      return;
    }
    setAccounts(a.rows);
    setImpact(si.rows);
    setIncidents(inc.rows);
    setPulse(si.pulse ?? []);
    setSql(si.sql);
    setReady(true);

    // Fire the alert toast exactly when impact appears (green → red edge).
    if (
      prevImpact.current !== null &&
      prevImpact.current === 0 &&
      si.rows.length > 0
    ) {
      toast.error("Revenue at risk detected", {
        description: `${si.rows.length} accounts erroring · ${formatCurrency(
          si.rows.reduce((s: number, r: RevenueAtRiskRow) => s + r.arr, 0),
        )} at risk`,
      });
    }
    prevImpact.current = si.rows.length;
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Self-running demo: arrived from the SSO gate (which already reset and
  // warmed the cluster), so the board loads green. Hold that beat, then fire the
  // incident so an unattended judge sees the full green→red arc without clicking.
  // Fires once per mount; we strip ?demo=1 afterwards so a refresh won't re-arm.
  const demoFired = useRef(false);
  // Latched once self-heal has evaluated the *first* load (or once the demo path
  // takes over). Declared here so the demo-fire effect can claim it — a mount that
  // runs the demo never needs (and must not run) the self-heal arc.
  const healed = useRef(false);
  useEffect(() => {
    if (!demoArmed || !ready || demoFired.current) return;
    demoFired.current = true;
    healed.current = true; // demo drives a fresh arc; disable self-heal for this mount
    toast("Live · monitoring 20 tenants", {
      description: "All clear. Watching product telemetry.",
    });
    const t = setTimeout(async () => {
      try {
        await fetch("/api/incident/trigger", { method: "POST" });
        await refresh();
      } catch {
        // Leave the manual controls; never wedge the board on a failed auto-fire.
      } finally {
        router.replace("/dashboard");
      }
    }, DEMO_DWELL_MS);
    return () => clearTimeout(t);
  }, [demoArmed, ready, refresh, router]);

  // Self-heal a stale board. A returning, already-authenticated judge can land on
  // /dashboard *without* ?demo=1 (so the demo-fire effect above never arms) and
  // find a previous session's incident whose burst has aged out of the live
  // 60-minute window — an "Impacted"/"Notified" row with no live signal, which the
  // feed renders as "signal subsided · monitoring". Detect that contradiction
  // (active incident, no matching live row) on load and replay the arc: reset to
  // calm, hold green a beat, then re-fire — so every visit shows a fresh green→red
  // instead of a stale half-state. Evaluated exactly once, against the FIRST loaded
  // state — we latch `healed` immediately so later polls (and the demo path's
  // ?demo=1 → /dashboard URL swap, which flips demoArmed to false) can never make a
  // freshly-fired incident look "stale" and reset it out from under the judge.
  useEffect(() => {
    if (demoArmed || !ready || healed.current) return;
    healed.current = true; // evaluate the initial load only, then never again
    const hasStaleIncident = incidents.some(
      (i) =>
        i.incidentStatus === "active" &&
        !impact.some((r) => r.accountId === i.accountId),
    );
    if (!hasStaleIncident) return;
    let cancelled = false;
    (async () => {
      try {
        await fetch("/api/incident/reset", { method: "POST" });
        if (cancelled) return;
        await refresh(); // board returns to calm green
        await new Promise((res) => setTimeout(res, DEMO_DWELL_MS));
        if (cancelled) return;
        await fetch("/api/incident/trigger", { method: "POST" });
        if (cancelled) return;
        await refresh();
      } catch {
        // Leave whatever's on screen; the manual controls still work.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demoArmed, ready, incidents, impact, refresh]);

  function openAccount(id: string) {
    router.push(`/incidents/${id}`);
  }

  // Warm the incident route (code + data) on hover so the click feels instant.
  function prefetchAccount(id: string) {
    router.prefetch(`/incidents/${id}`);
  }

  // Cold-start screen: while the first load is in flight (Aurora resuming from a
  // scale-to-zero pause), show what's happening instead of an empty $0 board.
  if (!ready) return <WarmingScreen />;

  // Merge three sources into one table: the roster (every account), the incident
  // lifecycle (derives each row's display status), and the revenue-at-risk set
  // (live-error detail shown while an incident is active). Then sort: active
  // incidents float to the top, then resolved, then the calm healthy book —
  // ARR desc within each band. The same table, re-sorted.
  const impactById = new Map(impact.map((r) => [r.accountId, r]));
  const incidentById = new Map(incidents.map((i) => [i.accountId, i]));

  const statusRows: AccountStatusRow[] = accounts
    .map((a) => {
      const displayStatus = deriveDisplayStatus(
        incidentById.get(a.accountId) ?? null,
      );
      const det = impactById.get(a.accountId);
      return {
        accountId: a.accountId,
        accountName: a.accountName,
        tier: a.tier,
        arr: a.arr,
        csmOwner: a.csmOwner,
        region: a.region,
        renewalDate: a.renewalDate,
        renewalDays: a.renewalDays,
        displayStatus,
        riskScore: det?.riskScore,
        signalKind: det?.signalKind,
        zScore: det?.zScore,
        baselinePerHour: det?.baselinePerHour,
        syncFailures: det?.syncFailures,
        failingEndpoint: det?.failingEndpoint ?? undefined,
        firstSeen: det?.firstSeen ?? undefined,
        exposureCount: det?.exposureCount,
        dwellHours: det?.dwellHours,
        subject: det?.subject,
        exposureEntitlement: det?.exposureEntitlement,
      };
    })
    .sort(
      (x, y) =>
        STATUS_SORT_WEIGHT[x.displayStatus] -
          STATUS_SORT_WEIGHT[y.displayStatus] ||
        // Within a band, rank by risk score (active rows) then ARR.
        (y.riskScore ?? -1) - (x.riskScore ?? -1) ||
        y.arr - x.arr,
    );

  // The banner reflects live incidents (active = Impacted or Notified), not the
  // raw error set — a resolved account still has its error history on file.
  const activeRows = statusRows.filter(
    (r) => r.displayStatus === "Impacted" || r.displayStatus === "Notified",
  );
  const impacted = activeRows.length > 0;
  const arrAtRisk = activeRows.reduce((s, r) => s + r.arr, 0);

  // Command-center aggregates: the calm book of business + the live failure rate
  // (recent deprovisioning-sync failures across flagged tenants, per minute).
  const monitoredArr = statusRows.reduce((s, r) => s + r.arr, 0);
  const errorRate =
    impact.reduce((s, r) => s + r.syncFailures, 0) / WINDOW_MINUTES;

  return (
    <div className="min-h-screen bg-background">
      {/* Ambient incident glow — the whole screen subtly reddens while live. */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-50"
        style={{ boxShadow: "inset 0 0 180px 30px hsl(0 78% 56% / 0.45)" }}
        initial={false}
        animate={{ opacity: impacted ? 1 : 0 }}
        transition={{ duration: 0.8, ease: "easeInOut" }}
      />

      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground/90">
              <Activity className="h-4 w-4 text-background" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-none">Sybil</div>
              <div className="text-[11px] text-muted-foreground">
                Failure impact detection
              </div>
            </div>
          </div>
          <DemoControls onChanged={refresh} />
        </div>
      </header>

      {/* Alert banner — the single moment of drama, only when impact fires. */}
      {impacted && (
        <div className="border-b border-destructive/40 bg-destructive/10">
          <div className="container flex items-center gap-2 py-2.5 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            <span className="font-medium text-destructive">
              {activeRows.length} {activeRows.length === 1 ? "tenant" : "tenants"} at risk
            </span>
            <span className="text-muted-foreground">
              — deprovisioning failing · {formatCurrency(arrAtRisk)} ARR at risk
            </span>
          </div>
        </div>
      )}

      <main className="container space-y-6 py-6">
        <CommandCenterHero
          monitoredArr={monitoredArr}
          accountCount={statusRows.length}
          errorRate={errorRate}
          revenueAtRisk={arrAtRisk}
          activeCount={activeRows.length}
          pulse={pulse}
        />
        <FleetConstellation
          rows={statusRows}
          onRowClick={openAccount}
          onRowHover={prefetchAccount}
        />
        <AccountStatusFeed
          rows={statusRows}
          sql={sql}
          onRowClick={openAccount}
          onRowHover={prefetchAccount}
        />
      </main>

      <footer className="border-t border-border">
        <div className="container py-4 text-center text-sm text-muted-foreground">
          Sybil · Aurora PostgreSQL · Drizzle ORM · polling every{" "}
          {POLL_MS / 1000}s
        </div>
      </footer>
    </div>
  );
}

/**
 * Cold-start screen. Aurora Serverless v2 scales to zero when idle, so the first
 * request after a quiet spell waits ~15–30s for the cluster to resume. Rather
 * than hide that as a broken-looking empty dashboard, we name it — for an AWS
 * database audience, "resuming from zero" is the feature, not a fault.
 */
function WarmingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-foreground/90">
        <Activity className="h-5 w-5 text-background" />
      </div>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        Resuming Aurora Serverless v2 from zero…
      </div>
      <p className="max-w-sm text-sm text-muted-foreground">
        The database scales to zero when idle to keep costs near zero. The first
        request wakes it — this takes a few seconds, then the live telemetry
        streams in.
      </p>
    </div>
  );
}

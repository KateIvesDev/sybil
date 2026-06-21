"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  Send,
  CheckCircle2,
  CircleCheck,
  Activity,
  AlertTriangle,
  Loader2,
  Ticket as TicketIcon,
  Inbox,
  Gauge,
  TrendingUp,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { draftResolution } from "@/lib/demo-data";
import { deriveDisplayStatus, type DisplayStatus } from "@/lib/incident-status";
import type {
  AccountDrilldown,
  OutreachRow,
  RevenueAtRiskRow,
} from "@/lib/types";
import type { TicketContext } from "@/lib/ticket-context";

/**
 * Dedicated incident page — /incidents/[accountId].
 *
 * The consolidation of what used to be two separate surfaces: the account
 * drill-down (a Sheet) and the outreach approval (a Dialog). Both now live here,
 * together on one screen: account context + error-spike chart on the left, the
 * AI-drafted outreach with an inline review + Send on the right. No modals.
 */
/**
 * Why Sybil flagged this tenant — the dual signal made legible. Left: the rate
 * anomaly (deprovisioning-sync failing N× its own baseline). Right: the confirmed
 * exposure it caused — a terminated identity still holding live access — or, if
 * none yet, an honest "leading indicator" note. The risk score sits up top.
 */
function DetectionPanel({ s }: { s: RevenueAtRiskRow }) {
  const mult = Math.round(s.syncFailures / Math.max(s.baselinePerHour, 1));
  const hasExposure = s.exposureCount > 0;
  return (
    <Card className="border-destructive/30">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4 text-destructive" />
          Why Sybil flagged this tenant
        </CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-sm uppercase tracking-wide text-muted-foreground">
            Risk score
          </span>
          <span className="tnum text-2xl font-bold text-destructive">
            {s.riskScore}
          </span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {/* Rate anomaly — the leading indicator */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-amber-500">
            <TrendingUp className="h-3.5 w-3.5" /> Rate anomaly
          </div>
          <div className="mt-1.5 text-sm">
            <span className="font-semibold text-foreground">
              {mult}× baseline
            </span>{" "}
            — {s.syncFailures} deprovisioning-sync failures in the last hour vs a{" "}
            {s.baselinePerHour}/hr norm (z {s.zScore}).
          </div>
          {s.failingEndpoint && (
            <div className="mt-1.5 font-mono text-sm text-muted-foreground">
              {s.failingEndpoint}
            </div>
          )}
          {s.errorSignature && (
            <div className="mt-1 font-mono text-[11px] text-amber-600 dark:text-amber-500/90">
              {s.errorSignature}
            </div>
          )}
        </div>

        {/* Exposure — the confirmed consequence */}
        {hasExposure ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/[0.06] p-3">
            <div className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-destructive">
              <ShieldAlert className="h-3.5 w-3.5" /> Confirmed exposure
            </div>
            <div className="mt-1.5 text-sm font-semibold text-foreground">
              {s.subject}
            </div>
            <div className="text-sm text-destructive">
              {s.exposureEntitlement}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Exposed {s.dwellHours != null ? Math.round(s.dwellHours) : "?"}h ·
              flagged at the first failures · {s.exposureCount} open violation
              {s.exposureCount === 1 ? "" : "s"}
            </div>
            {s.exposureSignature && (
              <div className="mt-1.5 font-mono text-[11px] text-destructive/80">
                {s.exposureSignature}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Exposure
            </div>
            <div className="mt-1.5 text-sm text-muted-foreground">
              No confirmed stale-access violation yet — this is a leading
              indicator. Reprocess the failed offboarding records before access
              leaks.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function IncidentPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = use(params);
  const [data, setData] = useState<AccountDrilldown | null>(null);
  const [draft, setDraft] = useState<OutreachRow | null>(null);
  const [signal, setSignal] = useState<RevenueAtRiskRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [d, o, sig] = await Promise.all([
      fetch(`/api/accounts/${accountId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/outreach?accountId=${accountId}`).then((r) => r.json()),
      fetch(`/api/revenue-at-risk`).then((r) => r.json()),
    ]);
    setData(d);
    setDraft((o.rows as OutreachRow[])[0] ?? null);
    setSignal(
      (sig.rows as RevenueAtRiskRow[]).find((x) => x.accountId === accountId) ??
        null,
    );
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  const chartData =
    data?.series.map((s) => ({
      t: new Date(s.bucket).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      errors: s.errors,
    })) ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground/90">
              <Activity className="h-4 w-4 text-background" />
            </div>
            <div className="text-sm font-semibold leading-none">Sybil</div>
          </div>
        </div>
      </header>

      <main className="container space-y-6 py-6">
        {loading && (
          <div className="py-24 text-center text-sm text-muted-foreground">
            Loading incident…
          </div>
        )}

        {!loading && !data && (
          <div className="py-24 text-center">
            <div className="text-sm font-medium">Account not found</div>
            <Link
              href="/dashboard"
              className="mt-2 inline-block text-sm text-muted-foreground underline"
            >
              Return to dashboard
            </Link>
          </div>
        )}

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold">{data.account.name}</h1>
              <HeadingStatusBadge
                status={
                  draft
                    ? deriveDisplayStatus(draft)
                    : data.totalErrors > 0
                      ? "Impacted"
                      : "Healthy"
                }
              />
              <span className="text-sm text-muted-foreground">
                {data.account.tier.toUpperCase()} · {data.account.region} · owner{" "}
                {data.account.csmOwner}
              </span>
            </div>

            {signal && <DetectionPanel s={signal} />}

            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              {/* ── Account context + error spike ───────────────────────── */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Account context</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-3 gap-3">
                    <Stat
                      label="ARR"
                      value={formatCurrency(data.account.arr)}
                    />
                    <Stat
                      label="Sync fails (1h)"
                      value={String(data.totalErrors)}
                      alert
                    />
                    <Stat
                      label="First seen"
                      value={data.firstSeen ? timeAgo(data.firstSeen) : "—"}
                    />
                  </div>

                  <div>
                    <div className="mb-2 text-sm font-medium text-muted-foreground">
                      Sync-failure spike — last hour (per minute)
                    </div>
                    <div className="h-56 rounded-lg border border-border bg-card p-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData}>
                          <defs>
                            <linearGradient
                              id="errGrad"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                stopColor="hsl(0 78% 56%)"
                                stopOpacity={0.6}
                              />
                              <stop
                                offset="100%"
                                stopColor="hsl(0 78% 56%)"
                                stopOpacity={0.05}
                              />
                            </linearGradient>
                          </defs>
                          <XAxis
                            dataKey="t"
                            stroke="hsl(220 9% 55%)"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            stroke="hsl(220 9% 55%)"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            width={28}
                            allowDecimals={false}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "hsl(224 16% 9%)",
                              border: "1px solid hsl(222 14% 16%)",
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                            labelStyle={{ color: "hsl(220 14% 88%)" }}
                          />
                          <Area
                            type="monotone"
                            dataKey="errors"
                            stroke="hsl(0 78% 56%)"
                            strokeWidth={2}
                            fill="url(#errGrad)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3">
                      <div className="text-sm uppercase tracking-wide text-muted-foreground">
                        Failing endpoint
                      </div>
                      <div className="mt-1 font-mono text-sm text-destructive">
                        {data.topEndpoint ?? "—"}
                      </div>
                    </div>
                    <TicketContextCheck
                      accountId={accountId}
                      accountName={data.account.name}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* ── Outreach lifecycle: initial send → resolve → resolution ── */}
              <div className="space-y-6">
                <OutreachReview draft={draft} onChanged={load} />
                {draft?.incidentStatus === "resolved" && (
                  <ResolutionReview
                    draft={draft}
                    accountName={data.account.name}
                    hasExposure={(signal?.exposureCount ?? 0) > 0}
                    onChanged={load}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/**
 * Initial proactive outreach — the first message in the conversation, plus the
 * "Mark resolved" control. Sending advances none → initial_sent ("Notified");
 * marking resolved advances active → resolved and reveals the ResolutionReview
 * section below. The resolve control is only shown while the incident is active.
 */
function OutreachReview({
  draft,
  onChanged,
}: {
  draft: OutreachRow | null;
  onChanged: () => void;
}) {
  const [body, setBody] = useState(draft?.draftBody ?? "");
  const [busy, setBusy] = useState<"send" | "resolve" | null>(null);

  // Keep the editable body in sync when the draft (re)loads.
  useEffect(() => {
    setBody(draft?.draftBody ?? "");
  }, [draft?.id, draft?.draftBody]);

  const initialSent = draft ? draft.outreachStatus !== "none" : false;
  const active = draft?.incidentStatus === "active";

  async function send() {
    if (!draft) return;
    setBusy("send");
    try {
      const res = await fetch("/api/outreach", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draft.id,
          draftBody: body,
          sendInitial: true,
          approvedBy: "Demo CSM",
        }),
      });
      if (!res.ok) throw new Error("send failed");
      toast.success(`Outreach sent — ${draft.accountName}`, {
        description: "Reviewed and sent by Demo CSM",
      });
      onChanged();
    } catch {
      toast.error("Could not send outreach");
    } finally {
      setBusy(null);
    }
  }

  async function resolve() {
    if (!draft) return;
    setBusy("resolve");
    try {
      const res = await fetch("/api/outreach", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id, resolve: true }),
      });
      if (!res.ok) throw new Error("resolve failed");
      toast.success(`Marked resolved — ${draft.accountName}`, {
        description: "Send a resolution update to close the loop.",
      });
      onChanged();
    } catch {
      toast.error("Could not mark resolved");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Proactive outreach</CardTitle>
        <OutreachStageBadge
          stage={draft?.outreachStatus}
          approvedBy={draft?.approvedBy}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        {!draft ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No draft for this account yet.
          </div>
        ) : (
          <>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={initialSent}
              className="min-h-[260px] resize-y font-sans text-[13px] leading-relaxed"
            />
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {initialSent
                  ? "This message has been sent."
                  : "Nothing sends without your review."}
              </p>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={send}
                disabled={busy !== null || initialSent}
              >
                <Send className="h-3.5 w-3.5" />
                {initialSent ? "Sent" : busy === "send" ? "Sending…" : "Send"}
              </Button>
            </div>

            {/* Mark resolved — only while the incident is still active. */}
            {active && (
              <div className="flex items-center justify-between border-t border-border pt-4">
                <p className="text-sm text-muted-foreground">
                  Engineering confirmed the fix?
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={resolve}
                  disabled={busy !== null}
                >
                  {busy === "resolve" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CircleCheck className="h-3.5 w-3.5" />
                  )}
                  Mark resolved
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Resolution follow-up — appears only once the incident is marked resolved.
 * Sends a closing message and advances outreach_status → resolution_sent.
 */
function ResolutionReview({
  draft,
  accountName,
  hasExposure,
  onChanged,
}: {
  draft: OutreachRow;
  accountName: string;
  hasExposure: boolean;
  onChanged: () => void;
}) {
  const resolvedDate = new Date(
    draft.resolvedAt ?? Date.now(),
  ).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const [body, setBody] = useState(() =>
    draftResolution(accountName, draft.csmOwner, resolvedDate, hasExposure),
  );
  const [busy, setBusy] = useState(false);

  const resolutionSent = draft.outreachStatus === "resolution_sent";
  // Honest edge case: resolved, but the customer was never sent the initial
  // heads-up. Surface it plainly rather than inventing a separate state.
  const noInitial = draft.outreachStatus === "none";

  async function send() {
    setBusy(true);
    try {
      const res = await fetch("/api/outreach", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draft.id,
          sendResolution: true,
          resolutionBody: body,
        }),
      });
      if (!res.ok) throw new Error("send failed");
      toast.success(`Resolution update sent — ${accountName}`);
      onChanged();
    } catch {
      toast.error("Could not send resolution update");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-ok/30">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Resolution update</CardTitle>
        {resolutionSent ? (
          <Badge variant="ok" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Sent
          </Badge>
        ) : (
          <Badge variant="secondary">Not sent</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {noInitial && !resolutionSent && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-sm text-amber-600 dark:text-amber-500">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            No initial outreach was sent for this incident — this will be the
            customer&apos;s first message about it.
          </div>
        )}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={resolutionSent}
          className="min-h-[200px] resize-y font-sans text-[13px] leading-relaxed"
        />
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {resolutionSent
              ? "The resolution update has been sent."
              : "Closes the loop with the customer."}
          </p>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={send}
            disabled={busy || resolutionSent}
          >
            <Send className="h-3.5 w-3.5" />
            {resolutionSent
              ? "Sent"
              : busy
                ? "Sending…"
                : "Send resolution update"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// The outreach-stage chip on the initial-outreach card header.
function OutreachStageBadge({
  stage,
  approvedBy,
}: {
  stage?: OutreachRow["outreachStatus"];
  approvedBy?: string | null;
}) {
  if (stage === "resolution_sent") {
    return (
      <Badge variant="ok" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Resolution sent
      </Badge>
    );
  }
  if (stage === "initial_sent") {
    return (
      <Badge variant="ok" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Sent{approvedBy ? ` · ${approvedBy}` : ""}
      </Badge>
    );
  }
  return <Badge variant="secondary">Not sent</Badge>;
}

// The display-status chip beside the account name in the page heading.
function HeadingStatusBadge({ status }: { status: DisplayStatus }) {
  switch (status) {
    case "Impacted":
      return (
        <Badge variant="alert" className="gap-1 animate-pulse-red">
          <AlertTriangle className="h-3 w-3" />
          Impacted
        </Badge>
      );
    case "Notified":
      return (
        <Badge variant="warn" className="gap-1">
          <Send className="h-3 w-3" />
          Notified
        </Badge>
      );
    case "Resolved":
      return (
        <Badge variant="ok" className="gap-1 font-semibold">
          <CircleCheck className="h-3 w-3" />
          Resolved
        </Badge>
      );
    default:
      return <Badge variant="ok">No active incident</Badge>;
  }
}

function Stat({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div
        className={`tnum mt-1 text-lg font-semibold ${
          alert ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Related-ticket context — CSM-initiated, help-desk-agnostic.
 *
 * Ticket status no longer gates whether this account surfaced (Part 1). This is
 * purely additive context: a CSM clicks to pull related tickets from the help
 * desk on demand. It never auto-fetches and never blocks the Send action.
 */
function TicketContextCheck({
  accountId,
  accountName,
}: {
  accountId: string;
  accountName: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [ctx, setCtx] = useState<TicketContext | null>(null);

  async function check() {
    setState("loading");
    try {
      const res = await fetch(
        `/api/tickets?accountId=${accountId}&accountName=${encodeURIComponent(
          accountName,
        )}`,
      );
      const data = (await res.json()) as TicketContext;
      setCtx(data);
    } catch {
      // The server falls back to mock, so this only trips on a transport error.
      setCtx({ openCount: 0, tickets: [], source: "unavailable" });
    } finally {
      setState("done");
    }
  }

  const empty = ctx && ctx.openCount === 0 && ctx.tickets.length === 0;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm uppercase tracking-wide text-muted-foreground">
          Related tickets
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5"
          onClick={check}
          disabled={state === "loading"}
        >
          {state === "loading" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <TicketIcon className="h-3.5 w-3.5" />
          )}
          {state === "idle"
            ? "Check for related tickets"
            : state === "loading"
              ? "Checking…"
              : "Re-check"}
        </Button>
      </div>

      {state === "loading" && (
        <div className="mt-3 space-y-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-9 animate-pulse rounded-md bg-muted/60"
            />
          ))}
        </div>
      )}

      {state === "done" && ctx && (
        <div className="mt-3 space-y-3">
          {empty ? (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <Inbox className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{ctx.note ?? "No related tickets found."}</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Badge variant={ctx.openCount > 0 ? "alert" : "secondary"}>
                  {ctx.openCount} open
                </Badge>
                <span className="text-muted-foreground">
                  {ctx.tickets.length} ticket
                  {ctx.tickets.length === 1 ? "" : "s"} · via {ctx.source}
                </span>
              </div>
              <ul className="space-y-1.5">
                {ctx.tickets.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm">{t.subject}</div>
                      <div className="text-sm text-muted-foreground">
                        {t.id} · {new Date(t.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Badge
                      variant={
                        t.status === "open" || t.status === "pending"
                          ? "alert"
                          : "secondary"
                      }
                      className="shrink-0 capitalize"
                    >
                      {t.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

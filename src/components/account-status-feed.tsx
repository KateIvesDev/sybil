"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleCheck,
  Send,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ViewQueryDialog } from "@/components/view-query-dialog";
import { formatCurrency } from "@/lib/utils";
import type { AccountStatusRow } from "@/lib/types";
import type { DisplayStatus } from "@/lib/incident-status";

// A table row that slides into place when the sort order changes — active
// incidents floating to the top on trigger animate instead of snapping.
const MotionTableRow = motion(TableRow);

/**
 * The one top-level view: a single account-status table over the whole book of
 * business. Default is a calm sea of green "Healthy" badges. As an incident
 * moves through its lifecycle, the affected account's badge walks across four
 * derived states — Impacted (red) → Notified (amber) → Resolved (calm green) —
 * and active incidents float to the top. The same table changing, not a
 * navigation to another screen.
 *
 * Rows are already sorted by the caller (active first, then resolved, then
 * healthy; ARR desc within each).
 */

// "Active" = the incident is still live (red or amber): these get row emphasis
// and show the failing-endpoint detail.
function isActive(s: DisplayStatus) {
  return s === "Impacted" || s === "Notified";
}

function StatusBadge({ status }: { status: DisplayStatus }) {
  switch (status) {
    case "Impacted":
      return (
        <Badge variant="alert" className="gap-1">
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
      // Healthy — muted green, no icon, so a freshly-resolved row (green +
      // checkmark) reads as distinct from a never-impacted one.
      return (
        <Badge variant="ok" className="font-normal opacity-80">
          Healthy
        </Badge>
      );
  }
}

function rowClass(status: DisplayStatus) {
  switch (status) {
    case "Impacted":
      return "cursor-pointer border-l-2 border-l-destructive bg-destructive/[0.06] hover:bg-destructive/[0.10]";
    case "Notified":
      return "cursor-pointer border-l-2 border-l-amber-500 bg-amber-500/[0.05] hover:bg-amber-500/[0.10]";
    default:
      return "cursor-pointer hover:bg-muted/40";
  }
}

// Risk-score tone: the saturated red is reserved for the highest-risk tenants.
function riskTone(score: number) {
  if (score >= 75) return "text-destructive";
  if (score >= 50) return "text-amber-500";
  return "text-foreground";
}

// Renewal-proximity tone — amber escalates as renewal nears, but never red:
// saturated red stays reserved for genuine impact (see the design discipline in
// the README), so a calm account renewing soon reads as "watch", not "alarm".
function renewalTone(days: number) {
  if (days <= 14) return "text-amber-500 font-semibold";
  if (days <= 30) return "text-amber-500";
  return "text-muted-foreground";
}

// Compact renewal date for the secondary line, e.g. "Jul 17".
function formatRenewalDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// The little chip naming which detector(s) fired. Exposure (a confirmed security
// violation) is the alarming red; a pure rate anomaly is amber.
function SignalChip({ kind }: { kind: "anomaly" | "exposure" | "both" }) {
  const label = kind === "both" ? "exposure + anomaly" : kind;
  const cls =
    kind === "anomaly"
      ? "bg-amber-500/15 text-amber-500"
      : "bg-destructive/15 text-destructive";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

// One-line "why": the rate-anomaly multiple and/or the confirmed exposure.
function signalWhy(r: AccountStatusRow): string {
  const parts: string[] = [];
  if ((r.syncFailures ?? 0) > 0 && r.signalKind !== "exposure") {
    const mult = Math.round(
      (r.syncFailures ?? 0) / Math.max(r.baselinePerHour ?? 1, 1),
    );
    parts.push(`${mult}× baseline sync fails`);
  }
  if ((r.exposureCount ?? 0) > 0) {
    const who = r.subject ?? "stale access";
    const dwell =
      r.dwellHours != null ? ` · live ${Math.round(r.dwellHours)}h` : "";
    parts.push(`${who}${dwell}`);
  }
  return parts.join(" · ");
}

export function AccountStatusFeed({
  rows,
  sql,
  onRowClick,
  onRowHover,
}: {
  rows: AccountStatusRow[];
  sql: string;
  onRowClick: (accountId: string) => void;
  // Prefetch the incident route on hover so the click navigates instantly.
  onRowHover?: (accountId: string) => void;
}) {
  const activeCount = rows.filter((r) => isActive(r.displayStatus)).length;
  const active = activeCount > 0;

  return (
    <Card className={active ? "border-destructive/30" : ""}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Account status</CardTitle>
          {active ? (
            <Badge variant="alert" className="gap-1 animate-pulse-red">
              <AlertTriangle className="h-3 w-3" />
              {activeCount} active
            </Badge>
          ) : (
            <Badge variant="ok" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              All clear
            </Badge>
          )}
        </div>
        <ViewQueryDialog sql={sql} />
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-6">Tenant</TableHead>
              <TableHead className="text-right">ARR</TableHead>
              <TableHead className="text-right">Renewal</TableHead>
              <TableHead>Signal · risk</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const live = isActive(r.displayStatus);
              return (
                <MotionTableRow
                  key={r.accountId}
                  layout
                  transition={{ type: "spring", stiffness: 220, damping: 26 }}
                  onClick={() => onRowClick(r.accountId)}
                  onMouseEnter={() => onRowHover?.(r.accountId)}
                  className={rowClass(r.displayStatus)}
                >
                  <TableCell className="pl-6">
                    <div className="font-medium text-foreground">
                      {r.accountName}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {r.tier.toUpperCase()} · {r.csmOwner}
                    </div>
                  </TableCell>
                  <TableCell
                    className={`tnum text-right font-semibold ${
                      r.displayStatus === "Impacted"
                        ? "text-destructive"
                        : "text-foreground"
                    }`}
                  >
                    {formatCurrency(r.arr)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className={`tnum text-sm ${renewalTone(r.renewalDays)}`}>
                      {r.renewalDays}d
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatRenewalDate(r.renewalDate)}
                    </div>
                  </TableCell>
                  <TableCell>
                    {!live ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : r.riskScore != null ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`tnum text-sm font-bold ${riskTone(r.riskScore)}`}
                          >
                            {r.riskScore}
                          </span>
                          {r.signalKind && <SignalChip kind={r.signalKind} />}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {signalWhy(r)}
                        </div>
                      </div>
                    ) : (
                      // Active incident whose triggering telemetry has aged out of
                      // the live detection window (e.g. an anomaly-only account an
                      // hour after the burst). The incident record persists, so the
                      // status badge still reads Impacted/Notified — show that the
                      // acute signal has passed rather than a bare "—".
                      <span className="text-sm italic text-muted-foreground">
                        signal subsided · monitoring
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.displayStatus} />
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </MotionTableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

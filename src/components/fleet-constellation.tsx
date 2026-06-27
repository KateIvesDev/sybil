"use client";

import { motion } from "framer-motion";
import { formatCurrency } from "@/lib/utils";
import { STATUS_DOT } from "@/lib/incident-status";
import type { AccountStatusRow } from "@/lib/types";

/**
 * The fleet constellation — the whole book of business as a field of living dots,
 * one per account, sized by ARR (the biggest customers are literally the biggest
 * dots). At rest it's a calm, gently breathing sea of green. When an incident
 * fires the affected dots flare red and float to the front (framer-motion `layout`
 * animates the re-sort). Click a dot to open its incident page — the same gesture
 * as clicking a table row.
 */

// Perceptual sizing: area ∝ ARR (so we scale the radius on a sqrt curve) clamped
// to a tasteful diameter range.
const MIN_PX = 22;
const MAX_PX = 64;
function sizer(rows: AccountStatusRow[]) {
  const arrs = rows.map((r) => r.arr);
  const lo = Math.sqrt(Math.min(...arrs));
  const hi = Math.sqrt(Math.max(...arrs));
  const span = hi - lo || 1;
  return (arr: number) =>
    MIN_PX + ((Math.sqrt(arr) - lo) / span) * (MAX_PX - MIN_PX);
}

export function FleetConstellation({
  rows,
  onRowClick,
  onRowHover,
}: {
  rows: AccountStatusRow[];
  onRowClick: (accountId: string) => void;
  // Prefetch the incident route on hover so the click navigates instantly.
  onRowHover?: (accountId: string) => void;
}) {
  if (rows.length === 0) return null;
  const sizeFor = sizer(rows);
  const impacted = rows.filter(
    (r) => r.displayStatus === "Impacted" || r.displayStatus === "Notified",
  ).length;
  const monitored = rows.reduce((s, r) => s + r.arr, 0);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-baseline gap-2 text-sm">
        <span className="font-semibold">The fleet</span>
        <span className="text-muted-foreground">
          {rows.length} accounts · {formatCurrency(monitored)} monitored ·{" "}
          {impacted > 0 ? (
            <span className="font-medium text-destructive">
              {impacted} impacted
            </span>
          ) : (
            <span className="text-[hsl(152_58%_48%)]">all green</span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 py-2">
        {rows.map((r, i) => {
          const px = sizeFor(r.arr);
          const dot = STATUS_DOT[r.displayStatus];
          return (
            <motion.button
              key={r.accountId}
              layout
              type="button"
              onClick={() => onRowClick(r.accountId)}
              onMouseEnter={() => onRowHover?.(r.accountId)}
              aria-label={`${r.accountName} — ${r.displayStatus}, ${formatCurrency(r.arr)} ARR`}
              title={`${r.accountName} · ${formatCurrency(r.arr)} · ${r.displayStatus}`}
              transition={{ layout: { type: "spring", stiffness: 220, damping: 26 } }}
              whileHover={{ scale: 1.18, zIndex: 10 }}
              className="group relative flex shrink-0 items-center justify-center rounded-full outline-none"
              style={{ width: px, height: px }}
            >
              {/* The dot itself: breathing at rest, flaring when active. */}
              <motion.span
                className="block h-full w-full rounded-full"
                style={{
                  backgroundColor: dot.fill,
                  boxShadow:
                    dot.glow === "transparent"
                      ? "none"
                      : `0 0 ${dot.pulse ? 16 : 10}px ${dot.glow}`,
                }}
                animate={
                  dot.pulse
                    ? { opacity: [1, 0.55, 1], scale: [1, 1.08, 1] }
                    : { opacity: [0.7, 1, 0.7] }
                }
                transition={{
                  duration: dot.pulse ? 1.6 : 4,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: (i % 8) * 0.18,
                }}
              />
              {/* Hover label */}
              <span className="pointer-events-none absolute -top-7 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                {r.accountName}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { Activity, TrendingUp } from "lucide-react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { formatCurrency, cn } from "@/lib/utils";
import type { PulsePoint } from "@/lib/types";

/**
 * The command-center hero band — the first thing a judge sees. Three calm stat
 * readouts (the book of business) sit beside the emotional centerpiece: a large
 * Revenue-at-Risk figure that rests at a green $0 ("all systems normal") and turns
 * red + pulses the instant real dollars are erroring. A continuous, latency-fed
 * sparkline keeps the whole band alive even at rest.
 */

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="tnum text-2xl font-semibold leading-none text-foreground">
        {children}
      </div>
    </div>
  );
}

export function CommandCenterHero({
  monitoredArr,
  accountCount,
  errorRate,
  revenueAtRisk,
  activeCount,
  pulse,
}: {
  monitoredArr: number;
  accountCount: number;
  errorRate: number;
  revenueAtRisk: number;
  activeCount: number;
  pulse: PulsePoint[];
}) {
  const atRisk = revenueAtRisk > 0;
  // Tint red on an active INCIDENT, not on raw errors — every tenant has a low
  // baseline failure hum at rest, so colouring on `pulse.errors` would always be
  // red. The incident (revenueAtRisk > 0) is the real escalation signal.
  const hot = atRisk;
  const stroke = hot ? "hsl(0 78% 56%)" : "hsl(152 58% 48%)";

  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-[1.4fr_1fr]">
      {/* Left: the calm book of business + the live heartbeat */}
      <div className="space-y-5 bg-card p-5">
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Monitored ARR">
            <AnimatedNumber value={monitoredArr} format={formatCurrency} />
          </Stat>
          <Stat label="Accounts">
            <AnimatedNumber
              value={accountCount}
              format={(n) => String(Math.round(n))}
            />
          </Stat>
          <Stat label="Sync fails / min">
            <AnimatedNumber
              value={errorRate}
              format={(n) => n.toFixed(1)}
              className={hot ? "text-destructive" : undefined}
            />
          </Stat>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Activity className="h-3 w-3" />
            Identity-sync telemetry · last 60 min
          </div>
          <div className="h-16 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={pulse}
                margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={[0, "dataMax + 2"]} />
                <Area
                  type="monotone"
                  dataKey="events"
                  stroke={stroke}
                  strokeWidth={1.75}
                  fill="url(#pulseFill)"
                  isAnimationActive={false}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Right: the emotional centerpiece — revenue at risk */}
      <div
        className={cn(
          "flex flex-col justify-center gap-1 p-5 transition-colors duration-700",
          atRisk ? "bg-destructive/10" : "bg-card",
        )}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <TrendingUp className="h-3 w-3" />
          Revenue at risk
        </div>
        <AnimatedNumber
          value={revenueAtRisk}
          format={formatCurrency}
          className={cn(
            "tnum text-5xl font-bold leading-none tracking-tight transition-colors duration-500",
            atRisk
              ? "animate-pulse-red text-destructive"
              : "text-[hsl(152_58%_48%)]",
          )}
        />
        <div
          className={cn(
            "text-sm",
            atRisk ? "font-medium text-destructive/90" : "text-muted-foreground",
          )}
        >
          {atRisk
            ? `${activeCount} ${activeCount === 1 ? "account" : "accounts"} erroring right now`
            : "All systems normal"}
        </div>
      </div>
    </div>
  );
}

/**
 * Derived display status — the single status the account table shows, computed
 * (never stored) from the two real lifecycle fields on the incident record.
 *
 *   incident_status × outreach_status            → display
 *   ─────────────────────────────────────────────────────────
 *   (no incident record at all)                  → Healthy
 *   active   · none                              → Impacted   (red)
 *   active   · initial_sent                      → Notified   (amber)
 *   resolved · resolution_sent                   → Resolved   (calm green)
 *   resolved · none | initial_sent               → Resolved   (still — but the
 *     incident page surfaces honestly that no resolution message was sent yet;
 *     we don't invent an extra display state for that edge.)
 *
 * Keep this pure and dependency-free so both client components and server code
 * can share one source of truth.
 */
export type DisplayStatus = "Healthy" | "Impacted" | "Notified" | "Resolved";

export interface IncidentLifecycle {
  incidentStatus: "active" | "resolved";
  outreachStatus: "none" | "initial_sent" | "resolution_sent";
}

export function deriveDisplayStatus(
  incident: IncidentLifecycle | null | undefined,
): DisplayStatus {
  if (!incident) return "Healthy";
  if (incident.incidentStatus === "resolved") return "Resolved";
  if (incident.outreachStatus === "initial_sent") return "Notified";
  return "Impacted";
}

// Table sort weight: active incidents float to the top (most urgent first),
// resolved sit below, the calm healthy book of business last. Ties broken by
// ARR descending in the caller.
export const STATUS_SORT_WEIGHT: Record<DisplayStatus, number> = {
  Impacted: 0,
  Notified: 1,
  Resolved: 2,
  Healthy: 3,
};

// The one place the four status colors live, as raw HSL tokens so canvas/SVG/box-
// shadow (the fleet dots) and Tailwind classes alike can read them. Mirrors the
// semantic palette in globals.css: destructive (red), amber (notified), ok (green).
// `glow` is the box-shadow color used for the dot halo; `dim` is the resting fill.
export const STATUS_DOT: Record<
  DisplayStatus,
  { fill: string; glow: string; pulse: boolean }
> = {
  // erroring now — saturated red, the only alarming color, and it pulses.
  Impacted: { fill: "hsl(0 78% 56%)", glow: "hsl(0 78% 56%)", pulse: true },
  // told the customer — amber, still active so it keeps a soft pulse.
  Notified: { fill: "hsl(38 92% 55%)", glow: "hsl(38 92% 55%)", pulse: true },
  // fixed — calm green, brighter than the resting book so it reads as "just healed".
  Resolved: { fill: "hsl(152 58% 48%)", glow: "hsl(152 58% 48%)", pulse: false },
  // never impacted — muted green baseline; gentle ambient breathing only.
  Healthy: { fill: "hsl(152 30% 42%)", glow: "transparent", pulse: false },
};

/**
 * The normalized event contract — the differentiating bit.
 *
 * Sybil is a customer-observability layer that sits ON TOP of Sentry / Datadog /
 * CloudWatch rather than generating its own telemetry. Every provider speaks a
 * different webhook dialect; this is the single provider-agnostic shape they all
 * get mapped into before anything touches the database. "Same landing table, any
 * source" is true precisely because everything funnels through this contract.
 *
 * Validated with zod at the ingestion boundary so a malformed webhook is a 422,
 * never a corrupt row.
 */
import { z } from "zod";

export const NORMALIZED_SOURCES = [
  "sentry",
  "datadog",
  "cloudwatch",
  "custom",
] as const;

export const NORMALIZED_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const normalizedEventSchema = z.object({
  source: z.enum(NORMALIZED_SOURCES),
  external_event_id: z.string().min(1), // provider's unique id → idempotency key
  account_ref: z.string().min(1), // external tenant/org/api-key identifier
  // Same landing table, four semantics: high-volume infra signals (error/latency)
  // and discrete identity-governance findings (stale_access/policy_violation).
  event_type: z.enum(["error", "latency", "stale_access", "policy_violation"]),
  endpoint: z.string().min(1),
  status_code: z.number().int().optional(),
  severity: z.enum(NORMALIZED_SEVERITIES),
  error_signature: z.string().min(1),
  // The identity actor a governance finding concerns; omitted for infra events.
  subject: z.string().min(1).optional(),
  occurred_at: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), {
      message: "occurred_at must be an ISO 8601 datetime string",
    }),
});

export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;

/**
 * The landing table stores severity as an integer (1 notice → 5 critical) and
 * the correlation query does MAX(severity) on it — we must not change that. So
 * the normalized string severity is ranked into that existing scale on the way
 * in. `low` maps to 2 (above seed's benign latency noise at 1).
 */
export const SEVERITY_RANK: Record<NormalizedEvent["severity"], number> = {
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

export function severityToInt(severity: NormalizedEvent["severity"]): number {
  return SEVERITY_RANK[severity];
}

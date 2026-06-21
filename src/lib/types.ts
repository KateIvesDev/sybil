// Shared client-facing shapes (mirror the API route responses).
import type { DisplayStatus } from "@/lib/incident-status";

// One at-risk tenant from the dual-signal correlation (/api/revenue-at-risk).
// Mirrors RevenueAtRiskRow in src/db/queries.ts.
export interface RevenueAtRiskRow {
  accountId: string;
  accountName: string;
  tier: "enterprise" | "mid" | "smb";
  arr: number;
  csmOwner: string;
  region: string;
  renewalDate: string;
  renewalDays: number;
  riskScore: number;
  signalKind: "anomaly" | "exposure" | "both";
  zScore: number;
  baselinePerHour: number;
  syncFailures: number;
  maxSeverity: number;
  failingEndpoint: string | null;
  errorSignature: string | null;
  firstSeen: string | null;
  exposureCount: number;
  dwellHours: number | null;
  subject: string | null;
  exposureEntitlement: string | null;
  exposureSignature: string | null;
}

// The account roster from /api/accounts — every monitored account, no impact
// signal. The dashboard merges this with the revenue-at-risk set into
// AccountStatusRow.
export interface AccountRow {
  accountId: string;
  accountName: string;
  tier: "enterprise" | "mid" | "smb";
  arr: number;
  csmOwner: string;
  region: string;
}

// One minute of fleet-wide telemetry, from /api/revenue-at-risk's `pulse` field.
// Feeds the command-center sparkline: `events` is the alive baseline, `errors`
// the red spike.
export interface PulsePoint {
  bucket: string;
  events: number;
  errors: number;
}

// The incident lifecycle per account, from /api/incidents (one entry per account
// that has an incident record). Merged with the roster to derive display status.
export interface IncidentRow {
  accountId: string;
  incidentStatus: "active" | "resolved";
  outreachStatus: "none" | "initial_sent" | "resolution_sent";
  resolvedAt: string | null;
  resolutionSentAt: string | null;
}

// A row in the always-on account-status table: every monitored account, carrying
// its derived display status. The live-error detail fields (from revenue-at-risk)
// are populated only while the incident is active.
export interface AccountStatusRow {
  accountId: string;
  accountName: string;
  tier: "enterprise" | "mid" | "smb";
  arr: number;
  csmOwner: string;
  region: string;
  displayStatus: DisplayStatus;
  // Detection detail, populated from the signal set while an incident is active.
  riskScore?: number;
  signalKind?: "anomaly" | "exposure" | "both";
  zScore?: number;
  baselinePerHour?: number;
  syncFailures?: number;
  failingEndpoint?: string;
  firstSeen?: string;
  exposureCount?: number;
  dwellHours?: number | null;
  subject?: string | null;
  exposureEntitlement?: string | null;
}

export interface AccountDrilldown {
  account: {
    id: string;
    name: string;
    tier: string;
    arr: number;
    csmOwner: string;
    region: string;
    renewalDate: string;
  };
  series: { bucket: string; errors: number; maxSeverity: number }[];
  topEndpoint: string | null;
  firstSeen: string | null;
  totalErrors: number;
}

export interface OutreachRow {
  id: string;
  accountId: string;
  accountName: string;
  arr: string;
  csmOwner: string;
  draftBody: string;
  incidentStatus: "active" | "resolved";
  outreachStatus: "none" | "initial_sent" | "resolution_sent";
  approvedBy: string | null;
  sentAt: string | null;
  resolvedAt: string | null;
  resolutionSentAt: string | null;
  createdAt: string;
}

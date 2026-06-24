/**
 * Demo fixtures shared by the seed script and the "Trigger incident" route.
 * Keeping them in one place means the incident always targets accounts that
 * actually exist and are the high-ARR whales we want the demo to spotlight.
 */

export interface SeedAccount {
  name: string;
  tier: "enterprise" | "mid" | "smb";
  arr: number;
  csmOwner: string;
  region: string;
  renewalInDays: number;
}

// ~20 realistic accounts, all healthy at seed time. Varied ARR with a few whales.
export const SEED_ACCOUNTS: SeedAccount[] = [
  // Enterprise whales — these are the demo's stars.
  { name: "Acme Industries", tier: "enterprise", arr: 1_450_000, csmOwner: "Priya Nair", region: "us-east-1", renewalInDays: 23 },
  { name: "Helios Financial", tier: "enterprise", arr: 1_220_000, csmOwner: "Marcus Reed", region: "us-east-1", renewalInDays: 27 },
  { name: "Atlas Manufacturing", tier: "enterprise", arr: 980_000, csmOwner: "Priya Nair", region: "eu-west-1", renewalInDays: 63 },
  { name: "Vertex Health Systems", tier: "enterprise", arr: 910_000, csmOwner: "Dana Whitfield", region: "us-west-2", renewalInDays: 19 },
  { name: "Sterling Retail Group", tier: "enterprise", arr: 760_000, csmOwner: "Marcus Reed", region: "us-east-1", renewalInDays: 88 },
  // Mid-market.
  { name: "Cobalt Media", tier: "mid", arr: 240_000, csmOwner: "Dana Whitfield", region: "eu-west-1", renewalInDays: 52 },
  { name: "Brightline Travel", tier: "mid", arr: 210_000, csmOwner: "Priya Nair", region: "us-west-2", renewalInDays: 31 },
  { name: "Quanta Robotics", tier: "mid", arr: 185_000, csmOwner: "Marcus Reed", region: "us-east-1", renewalInDays: 74 },
  { name: "Meridian Insurance", tier: "mid", arr: 172_000, csmOwner: "Dana Whitfield", region: "us-east-1", renewalInDays: 12 },
  { name: "Fathom Analytics Co", tier: "mid", arr: 150_000, csmOwner: "Priya Nair", region: "ap-southeast-2", renewalInDays: 47 },
  { name: "Greenfield Energy", tier: "mid", arr: 138_000, csmOwner: "Marcus Reed", region: "eu-west-1", renewalInDays: 66 },
  { name: "Pioneer Foods", tier: "mid", arr: 120_000, csmOwner: "Dana Whitfield", region: "us-west-2", renewalInDays: 23 },
  // SMB.
  { name: "Tinker & Co", tier: "smb", arr: 48_000, csmOwner: "Priya Nair", region: "us-east-1", renewalInDays: 39 },
  { name: "Lumen Studios", tier: "smb", arr: 42_000, csmOwner: "Marcus Reed", region: "eu-west-1", renewalInDays: 58 },
  { name: "Harbor Point Labs", tier: "smb", arr: 36_000, csmOwner: "Dana Whitfield", region: "us-west-2", renewalInDays: 15 },
  { name: "Maple Grove SaaS", tier: "smb", arr: 31_000, csmOwner: "Priya Nair", region: "us-east-1", renewalInDays: 71 },
  { name: "Driftwood Apps", tier: "smb", arr: 27_000, csmOwner: "Marcus Reed", region: "ap-southeast-2", renewalInDays: 44 },
  { name: "Civic Software", tier: "smb", arr: 22_000, csmOwner: "Dana Whitfield", region: "us-east-1", renewalInDays: 33 },
  { name: "Pebble Commerce", tier: "smb", arr: 19_000, csmOwner: "Priya Nair", region: "eu-west-1", renewalInDays: 61 },
  { name: "Acorn Ventures", tier: "smb", arr: 15_000, csmOwner: "Marcus Reed", region: "us-west-2", renewalInDays: 28 },
];

// The external tenant identifier a provider sends in its webhook (the org /
// api-key handle). Stored on accounts.external_ref and how /api/ingest resolves
// account_ref → accounts.id. Derived from the name so it's stable and re-seedable.
export function externalRefFor(accountName: string): string {
  return (
    "ext_" +
    accountName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
  );
}

type Provider = "sentry" | "datadog" | "cloudwatch" | "custom";
type Severity = "low" | "medium" | "high" | "critical";

// The tenants the incident hits — high-ARR enterprises, by name, so the demo
// flips the dashboard to "one red truth" against the biggest renewals.
export const INCIDENT_TARGETS = [
  "Acme Industries",
  "Helios Financial",
  "Vertex Health Systems",
  "Atlas Manufacturing",
];

/**
 * The dual-signal incident profile per target tenant.
 *
 *  · `sync`     — the high-volume deprovisioning-sync FAILURE that bursts during
 *                 the incident. Detected as a RATE ANOMALY vs the tenant's 7-day
 *                 baseline. Every target has one. `source` spreads across
 *                 providers so the demo can say "same landing table, any source".
 *  · `exposure` — the DISCRETE stale-access violation the failed sync caused: a
 *                 terminated user who still holds a live session/entitlement.
 *                 Only some targets carry one — that's what makes the risk score
 *                 separate "pipeline failing" from "failing WITH confirmed exposure".
 */
export interface IncidentProfile {
  sync: {
    endpoint: string; // the deprovisioning webhook/SCIM route that's failing
    statusCode: number;
    signature: string; // the malformed-payload root cause — the "view query" hook
    source: Provider;
  };
  exposure?: {
    subject: string; // the terminated identity still holding access
    entitlement: string; // what they can still reach (shown as the event endpoint)
    signature: string;
    termedHoursAgo: number; // dwell: hours the access has stayed live since term —
    // kept to hours, not days, so the demo reads as "Sybil caught it at the first
    // failure", not "Sybil sat on a breach for days".
    severity: Severity;
    source: Provider;
  };
}

export const INCIDENT_PROFILES: Record<string, IncidentProfile> = {
  // The hero: failing deprovisioning AND a terminated super-admin still live.
  "Acme Industries": {
    sync: {
      endpoint: "POST /scim/v2/deprovision",
      statusCode: 422,
      signature:
        "DeprovisionPayloadInvalid: HRIS webhook missing 'effective_date' — termination record skipped",
      source: "custom",
    },
    exposure: {
      subject: "jane.doe@acme.com",
      entitlement: "Super Admin · live SSO session",
      signature:
        "StaleAccess: terminated employee retains active session + Super Admin entitlement",
      termedHoursAgo: 4,
      severity: "critical",
      source: "sentry",
    },
  },
  // Also confirmed exposure — a contractor offboarded but never desynced.
  "Helios Financial": {
    sync: {
      endpoint: "PATCH /scim/v2/Users",
      statusCode: 500,
      signature:
        "GroupSyncWorkerCrash: OOM reconciling HRIS leaver batch",
      source: "datadog",
    },
    exposure: {
      subject: "m.okafor@contractor.helios.com",
      entitlement: "Ledger Admin role · API token active",
      signature:
        "StaleAccess: contractor end-dated in HRIS but never desynced — token still valid",
      termedHoursAgo: 9,
      severity: "high",
      source: "cloudwatch",
    },
  },
  // Anomaly only — the sync is failing, no confirmed violation yet (leading indicator).
  "Vertex Health Systems": {
    sync: {
      endpoint: "POST /scim/v2/deprovision",
      statusCode: 502,
      signature:
        "DeprovisionWebhookTimeout: HRIS callback 504 on leaver event",
      source: "cloudwatch",
    },
  },
  "Atlas Manufacturing": {
    sync: {
      endpoint: "POST /sso/saml/jit-deprovision",
      statusCode: 500,
      signature:
        "JitDeprovisionDeadlock: lock wait timeout on entitlement table",
      source: "custom",
    },
  },
};

// Every distinct signature an incident writes — reset deletes exactly these so the
// 7-day baseline survives. Derived from the profiles so it can never drift.
export const INCIDENT_SIGNATURES: string[] = Object.values(INCIDENT_PROFILES)
  .flatMap((p) => [p.sync.signature, p.exposure?.signature])
  .filter((s): s is string => Boolean(s));

// Identity-sync endpoints used for healthy baseline (latency) noise.
export const HEALTHY_ENDPOINTS = [
  "POST /scim/v2/Users",
  "GET /scim/v2/Groups",
  "POST /sso/saml/acs",
  "GET /api/v1/sessions",
];

// Low-severity, transient deprovisioning-sync hiccups — the normal background
// error rate every tenant's pipeline produces. This is what the anomaly detector
// baselines against, so a real malformed-payload burst reads as N× normal.
export const BASELINE_SYNC_SIGNATURES = [
  "DeprovisionRetryScheduled: downstream HRIS 429, requeued",
  "SyncLagWarning: HRIS poll behind by one cycle",
  "PartialSyncRecovered: 1 leaver record requeued and reconciled",
];

/**
 * A drafted proactive outreach message, templated per tenant. Branches on whether
 * Sybil has CONFIRMED an exposure: an anomaly-only tenant (sync failing, no stale
 * session found yet) must NOT claim a terminated identity holds live access — that
 * would be a false statement to the customer. Exposure tenants get the security copy.
 */
export function draftOutreach(
  accountName: string,
  csmOwner: string,
  endpoint: string,
  errorCount: number,
  hasExposure: boolean,
  subject?: string | null,
): string {
  if (hasExposure) {
    const who = subject ? ` (${subject})` : "";
    return `Hi ${accountName} team,

This is ${csmOwner} from your account team. We detected a burst of ${errorCount} failed deprovisioning events on ${endpoint} in the last hour, and has confirmed at least one terminated identity${who} that still holds live access as a result. We caught it at the first failures and are reaching out before it becomes a security exposure on your side.

Our team is already reprocessing the affected offboarding records and revoking the stale sessions. You don't need to do anything; we'll confirm once every entitlement is fully cleared.

Apologies for the disruption, and thank you for your partnership.

— ${csmOwner}`;
  }

  // Anomaly only — no confirmed exposure. This is a leading indicator; say so.
  return `Hi ${accountName} team,

This is ${csmOwner} from your account team. We detected an abnormal spike — ${errorCount} failed deprovisioning events on ${endpoint} in the last hour. No terminated identity has been confirmed exposed yet, and we're investigating now to keep it that way.

Our team is already reprocessing the affected offboarding records before any access can leak. You don't need to do anything; we'll confirm once the sync pipeline is healthy again.

Apologies for the disruption, and thank you for your partnership.

— ${csmOwner}`;
}

/**
 * The resolution follow-up, drafted once an incident is marked resolved. Sent as
 * the second, closing message in the conversation (initial_sent → resolution_sent).
 * Mirrors the initial draft's branch so a resolution doesn't claim we "revoked
 * stale sessions" for a tenant that never had a confirmed exposure.
 */
export function draftResolution(
  accountName: string,
  csmOwner: string,
  resolvedDate: string,
  hasExposure: boolean,
): string {
  const fixDetail = hasExposure
    ? "reprocessed the offboarding records, revoked the stale sessions and entitlements,"
    : "reprocessed the offboarding records, confirmed no access leaked,";
  return `Hi ${accountName} team,

Following up — the deprovisioning failures affecting your tenant have been resolved as of ${resolvedDate}. We've ${fixDetail} and confirmed the sync pipeline is healthy again. No action is needed on your end.

Thank you for your patience, and please reach out if you notice anything unexpected.

— ${csmOwner}`;
}

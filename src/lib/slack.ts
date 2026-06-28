/**
 * Slack — notification only.
 *
 * Sybil posts a heads-up to #sybil-alert the moment it detects an impacted
 * account (an error burst against a customer). The message is purely
 * informational: it @-mentions the CSM owner and links out to the incident page
 * where the human actually reviews the AI draft and sends it. There are NO
 * interactive Slack buttons — Slack never approves anything; it just notifies and
 * links out. The review + send gesture lives only on /incidents/[accountId].
 *
 * Stubbed transport, same as before: POST to SLACK_WEBHOOK_URL if configured,
 * otherwise log to the console. The point is the notify-and-link-out role, not
 * the wire.
 */
import { formatCurrency } from "@/lib/utils";

const SLACK_CHANNEL = "#sybil-alert";

export interface IncidentNotice {
  csmOwner: string;
  accountName: string;
  arr: number | string;
  endpoint: string;
  accountId: string;
  /** Absolute origin so the Review link is clickable from Slack. */
  baseUrl: string;
}

/**
 * Notify #sybil-alert that an account is impacted. Fire-and-forget; a
 * Slack hiccup must never block incident detection.
 */
export async function notifyIncident(notice: IncidentNotice): Promise<void> {
  const reviewLink = `${notice.baseUrl}/incidents/${notice.accountId}`;
  const text =
    `<@U0715Q9SD1D> — ${notice.accountName} (${formatCurrency(notice.arr)} ARR) ` +
    `is hitting errors on ${notice.endpoint}. ` +
    `Review: ${reviewLink}`;

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: SLACK_CHANNEL, text }),
      });
    } catch (err) {
      console.error("[slack] webhook failed:", err);
    }
    return;
  }

  console.log(`\n────────── [SLACK STUB] ${SLACK_CHANNEL} ──────────`);
  console.log(text);
  console.log("────────────────────────────────────────────────\n");
}

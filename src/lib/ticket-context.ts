/**
 * Ticket context — the help-desk-agnostic read path.
 *
 * Part 1 removed ticket status from the correlation query: an account surfaces
 * on the feed because it is *erroring*, full stop. Whether the customer has
 * also filed a ticket is now *context*, not a gate — and a CSM pulls it
 * deliberately from the incident page (never auto-fetched, never on Slack).
 *
 * The incident page talks only to the TicketContextProvider interface below. It
 * does not know or care which help desk is behind it. Today two implementations
 * exist:
 *
 *   • MockTicketProvider     — realistic canned data; the demo's source of truth.
 *   • ZendeskTicketProvider  — the real-integration shape, left as a documented
 *                              stub until a Zendesk MCP server is wired in.
 *
 * `getTicketContext()` tries the live provider and falls back to the mock on any
 * error/timeout, so the UI never renders a broken state.
 */

// ── Normalized shapes (what every provider must return) ──────────────────────
export interface TicketSummary {
  id: string;
  subject: string;
  status: string; // provider-native, e.g. "open" | "pending" | "solved"
  createdAt: string; // ISO 8601
}

export interface TicketContext {
  openCount: number;
  tickets: TicketSummary[];
  source: string; // which help desk answered, e.g. "zendesk" | "mock"
  // Optional empty-state framing. When a tenant Sybil has flagged for a confirmed
  // exposure has filed NO support ticket, that silence is the point — the failure
  // was silent, the customer doesn't know yet. The UI surfaces this note instead
  // of a bare "none found".
  note?: string;
}

export interface TicketContextProvider {
  /**
   * @param accountRef   stable account identifier (we pass accounts.id; a real
   *                     provider would map it to the help desk's org/tenant id).
   * @param windowDays   how far back to look for related tickets.
   */
  getTicketContext(
    accountRef: string,
    windowDays: number,
    accountName?: string,
  ): Promise<TicketContext>;
}

// ── Zendesk implementation (stub) ────────────────────────────────────────────
// The real integration calls our Zendesk MCP server and maps its response into
// the normalized TicketContext shape. No MCP server is wired into this repo yet,
// so this throws — `getTicketContext()` catches it and falls back to the mock,
// which keeps the demo working. When the MCP server lands, implement the call
// here (search org's tickets in the window → map to TicketSummary[]); nothing
// else in the app needs to change.
export class ZendeskTicketProvider implements TicketContextProvider {
  async getTicketContext(
    accountRef: string,
    windowDays: number,
    accountName?: string,
  ): Promise<TicketContext> {
    // TODO(zendesk-mcp): call the Zendesk MCP server here, then map its tickets
    // into { openCount, tickets, source: "zendesk" }. Until then, signal
    // "unavailable" so the fallback to MockTicketProvider engages.
    throw new Error("ZendeskTicketProvider: MCP server not configured");
  }
}

// ── Mock implementation (demo source of truth) ───────────────────────────────
// Returns realistic, deterministic-per-account canned data so the feature looks
// real and is reproducible across reloads. A small minority of accounts return
// zero tickets to exercise the empty state.
const MOCK_TICKETS: Omit<TicketSummary, "createdAt">[][] = [
  [
    {
      id: "ZD-48213",
      subject: "SCIM deprovision returning 422 for offboarded users",
      status: "open",
    },
    {
      id: "ZD-48190",
      subject: "Webhook retries climbing since this morning's HRIS sync",
      status: "pending",
    },
  ],
  [
    {
      id: "ZD-39072",
      subject: "Group reconciliation job failing intermittently",
      status: "open",
    },
    {
      id: "ZD-38951",
      subject: "Question about SCIM rate limits",
      status: "solved",
    },
  ],
  [
    {
      id: "ZD-51120",
      subject: "Users report SSO timeout on login",
      status: "pending",
    },
  ],
  [], // empty-state bucket — exercises the "No related tickets found" path
];

// Tenants Sybil has flagged for a CONFIRMED exposure always come back empty: the
// scenario's whole premise is that the offboarding failed SILENTLY — if the
// customer had filed a ticket, it wasn't silent. Forcing these to the empty state
// (with a note) makes that the punchline, not a dead end. By NAME so it's stable
// across reseeds (account ids are random per seed).
const SILENT_ACCOUNTS = new Set(["Acme Industries", "Helios Financial"]);
const SILENT_NOTE =
  "No case on file — the customer hasn't reported this. The offboarding failed silently; Sybil caught it before they knew.";

// Stable hash so the same account always maps to the same canned bucket.
function hashRef(ref: string): number {
  let h = 0;
  for (let i = 0; i < ref.length; i++) {
    h = (h * 31 + ref.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export class MockTicketProvider implements TicketContextProvider {
  async getTicketContext(
    accountRef: string,
    windowDays: number,
    accountName?: string,
  ): Promise<TicketContext> {
    if (accountName && SILENT_ACCOUNTS.has(accountName)) {
      return { openCount: 0, tickets: [], source: "mock", note: SILENT_NOTE };
    }
    // Key on the (stable) name when we have it, else fall back to the id ref.
    const bucket =
      MOCK_TICKETS[hashRef(accountName ?? accountRef) % MOCK_TICKETS.length];
    const now = Date.now();
    const tickets: TicketSummary[] = bucket.map((t, i) => ({
      ...t,
      // Spread created dates across the window so the list looks plausible.
      createdAt: new Date(
        now - ((i + 1) * windowDays * 86_400_000) / (bucket.length + 1),
      ).toISOString(),
    }));
    const openCount = tickets.filter(
      (t) => t.status === "open" || t.status === "pending",
    ).length;
    return { openCount, tickets, source: "mock" };
  }
}

// ── Resolver ─────────────────────────────────────────────────────────────────
// Try the live provider; fall back to mock on any error or timeout so the UI
// never shows a broken state. Set TICKET_PROVIDER=mock to skip the live attempt
// entirely (the default for demos, since no Zendesk MCP server is configured).
const LIVE_TIMEOUT_MS = 4000;

export async function getTicketContext(
  accountRef: string,
  windowDays = 30,
  accountName?: string,
): Promise<TicketContext> {
  const mock = new MockTicketProvider();

  if (process.env.TICKET_PROVIDER === "mock") {
    return mock.getTicketContext(accountRef, windowDays, accountName);
  }

  const live = new ZendeskTicketProvider();
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("ticket provider timeout")),
        LIVE_TIMEOUT_MS,
      ),
    );
    return await Promise.race([
      live.getTicketContext(accountRef, windowDays, accountName),
      timeout,
    ]);
  } catch (err) {
    console.warn(
      `[ticket-context] live provider unavailable, using mock: ${
        (err as Error).message
      }`,
    );
    return mock.getTicketContext(accountRef, windowDays, accountName);
  }
}

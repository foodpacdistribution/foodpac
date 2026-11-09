// Quote states for lists and badges. Client-safe. "Expired" isn't stored: a draft or sent quote
// past its valid-until date shows as expired, and can still be accepted or copied.

import type { QuoteStatus } from "./db/schema";

export type QuoteState = QuoteStatus | "expired";

export const QUOTE_STATUS: Record<QuoteState, { label: string; tone: "slate" | "blue" | "green" | "red" | "amber" }> = {
  draft: { label: "Draft", tone: "slate" },
  sent: { label: "Sent", tone: "blue" },
  accepted: { label: "Accepted", tone: "green" },
  declined: { label: "Declined", tone: "red" },
  expired: { label: "Expired", tone: "amber" },
};

export function quoteState(q: { status: QuoteStatus; validUntil: string }, today: string): QuoteState {
  return (q.status === "draft" || q.status === "sent") && q.validUntil < today ? "expired" : q.status;
}

/** How long a new quote is valid by default. */
export const QUOTE_VALID_DAYS = 30;

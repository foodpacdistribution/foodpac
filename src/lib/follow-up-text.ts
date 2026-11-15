// Why a customer is due a follow-up, in words. Client-safe: the pipeline and the customer map use it.

import type { DueFollowUp } from "./follow-up";
import { aud } from "./money";

type Tr = (text: string, vars?: Record<string, string | number>) => string;

/** Why a customer is due, in a few words: something to open the call with. */
export function dueText(due: DueFollowUp, tr: Tr) {
  switch (due.kind) {
    case "quiet":
      return tr("No order for {n} days", { n: due.days });
    case "first_order":
      return tr("Account opened {n} days ago, no first order yet", { n: due.days });
    case "slipping":
      return (
        tr("Usually buys {product} every {every} days, none for {n} days", { product: due.product, every: due.everyDays, n: due.days }) +
        (due.more ? ` ${tr(due.more === 1 ? "(and 1 more product)" : "(and {n} more products)", { n: due.more })}` : "")
      );
    case "spend_drop":
      return tr("Spending down {pct}%: {recent} in the last 60 days, usually {usual}", { pct: due.pct, recent: aud(due.recentCents), usual: aud(due.usualCents) });
    case "reminder":
      if (due.late === 0) return tr("Reminder for today");
      return tr(due.late === 1 ? "Reminder was due yesterday" : "Reminder was due {n} days ago", { n: due.late });
  }
}

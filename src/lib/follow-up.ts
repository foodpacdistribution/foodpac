// Follow-up reminders for the sales pipeline. Pure date logic on "YYYY-MM-DD" strings, safe anywhere.

/** Quick choices when setting a reminder, in days from today. */
export const REMIND_IN = [
  { days: 1, label: "Tomorrow" },
  { days: 2, label: "In 2 days" },
  { days: 7, label: "In 1 week" },
  { days: 14, label: "In 2 weeks" },
] as const;

/** Choices for "remind me when a customer hasn't ordered for…". */
export const QUIET_CHOICES = [7, 14, 21, 30, 60] as const;

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A store opened this many days ago without a first order is due a call (and stays due until this many days). */
export const FIRST_ORDER_DAYS = 7;
const FIRST_ORDER_UNTIL = 60;
/** After a follow-up, "buying less" signals wait this long before coming back. */
export const BUYING_LESS_SNOOZE = 21;
/** Spend is compared over this many days: the latest stretch against the three before it. */
export const SPEND_WINDOW = 60;
/** Below this usual spend per window (cents), a drop isn't worth a call. */
const SPEND_FLOOR_CENTS = 30_000;
/** How far spend has to fall, against usual, to count. */
const SPEND_DROP = 0.4;

/** One product a customer has bought: the days they bought it (oldest first) and what they spent on it. */
export type ProductHistory = { name: string; days: string[]; cents: number };

/** Signs a customer still buying from us is buying less: a regular product stopped, or spend fell. */
export type BuyingLess =
  | { kind: "product"; product: string; everyDays: number; days: number; more: number }
  | { kind: "spend"; pct: number; recentCents: number; usualCents: number };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Looks for a customer buying less, from the last year of orders.
 * - A product bought at least 3 times at a steady rhythm that they've now gone without for at
 *   least twice that gap (and two weeks over it), while still ordering other things: they're
 *   probably getting it elsewhere. The one worth most to us is named.
 * - Otherwise, spend in the last 60 days at least 40% under their usual 60 days (from the 180
 *   before), for customers who usually spend enough for it to matter.
 */
export function buyingLess(
  products: ProductHistory[],
  spend: { recentCents: number; priorCents: number; firstOrderOn: string | null },
  lastOrderOn: string | null,
  today: string,
): BuyingLess | null {
  if (!lastOrderOn) return null;
  const lapsed = products
    .map((p) => {
      if (p.days.length < 3) return null;
      const gaps = p.days.slice(1).map((d, i) => daysBetween(p.days[i], d));
      const every = Math.round(median(gaps));
      const last = p.days[p.days.length - 1];
      const days = daysBetween(last, today);
      // Weekly to every two months; still ordering other things since; gone well past the rhythm,
      // but not so long ago that it's old news.
      if (every < 3 || every > 60 || lastOrderOn <= last || days < Math.max(2 * every, every + 14) || days > 180) return null;
      return { product: p.name, everyDays: every, days, value: p.cents / p.days.length };
    })
    .filter((x) => x !== null)
    .sort((a, b) => b.value - a.value);
  if (lapsed.length) {
    const { product, everyDays, days } = lapsed[0];
    return { kind: "product", product, everyDays, days, more: lapsed.length - 1 };
  }
  // A full usual stretch is needed to compare with.
  if (!spend.firstOrderOn || daysBetween(spend.firstOrderOn, today) < SPEND_WINDOW * 4) return null;
  const usual = Math.round(spend.priorCents / 3);
  if (usual < SPEND_FLOOR_CENTS || spend.recentCents > usual * (1 - SPEND_DROP)) return null;
  return { kind: "spend", pct: Math.round((1 - spend.recentCents / usual) * 100), recentCents: spend.recentCents, usualCents: usual };
}

export type FollowUpFacts = {
  /** Reminder date someone set, if any. */
  followUpOn: string | null;
  /** Day of the customer's latest order (shop or delivery), if they've ever ordered. */
  lastOrderOn: string | null;
  /** Day someone last marked a follow-up done. */
  contactedOn: string | null;
  /** The day the account was opened (approved and won), for a customer that can order. */
  openedOn?: string | null;
  /** From their order history (see buyingLess). */
  buyingLess?: BuyingLess | null;
};

export type DueFollowUp =
  | { kind: "reminder"; on: string; late: number }
  | { kind: "quiet"; days: number }
  | { kind: "first_order"; days: number }
  | { kind: "slipping"; product: string; everyDays: number; days: number; more: number }
  | { kind: "spend_drop"; pct: number; recentCents: number; usualCents: number };

/**
 * Whether a customer needs a follow-up today, and why.
 * - A reminder is due on its day and stays due until it's done or moved.
 * - A reminder set for later holds off every other nudge until then.
 * - A store opened a week or more ago (up to two months) that hasn't placed a first order is due,
 *   unless someone followed up in the last week.
 * - A customer who has ordered before but not for `quietDays` is due, unless someone followed up
 *   within the last `quietDays` (then it waits for another quiet spell).
 * - A customer still ordering but buying less (a regular product stopped, or spend down) is due,
 *   unless someone followed up in the last three weeks.
 */
export function dueFollowUp(c: FollowUpFacts, today: string, quietDays: number): DueFollowUp | null {
  if (c.followUpOn) return c.followUpOn <= today ? { kind: "reminder", on: c.followUpOn, late: daysBetween(c.followUpOn, today) } : null;
  const since = (d: string | null | undefined) => (d ? daysBetween(d, today) : Infinity);
  if (!c.lastOrderOn) {
    const days = since(c.openedOn);
    if (days < FIRST_ORDER_DAYS || days > FIRST_ORDER_UNTIL || since(c.contactedOn) < FIRST_ORDER_DAYS) return null;
    return { kind: "first_order", days };
  }
  const days = daysBetween(c.lastOrderOn, today);
  if (days >= quietDays) return since(c.contactedOn) < quietDays ? null : { kind: "quiet", days };
  const less = c.buyingLess;
  if (!less || since(c.contactedOn) < BUYING_LESS_SNOOZE) return null;
  return less.kind === "product"
    ? { kind: "slipping", product: less.product, everyDays: less.everyDays, days: less.days, more: less.more }
    : { kind: "spend_drop", pct: less.pct, recentCents: less.recentCents, usualCents: less.usualCents };
}

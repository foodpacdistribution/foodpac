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

export type FollowUpFacts = {
  /** Reminder date someone set, if any. */
  followUpOn: string | null;
  /** Day of the customer's latest order (shop or delivery), if they've ever ordered. */
  lastOrderOn: string | null;
  /** Day someone last marked a follow-up done. */
  contactedOn: string | null;
};

export type DueFollowUp = { kind: "reminder"; on: string; late: number } | { kind: "quiet"; days: number };

/**
 * Whether a customer needs a follow-up today, and why.
 * - A reminder is due on its day and stays due until it's done or moved.
 * - A reminder set for later holds off the quiet-customer nudge until then.
 * - A customer who has ordered before but not for `quietDays` is due, unless someone followed up
 *   within the last `quietDays` (then it waits for another quiet spell).
 */
export function dueFollowUp(c: FollowUpFacts, today: string, quietDays: number): DueFollowUp | null {
  if (c.followUpOn) return c.followUpOn <= today ? { kind: "reminder", on: c.followUpOn, late: daysBetween(c.followUpOn, today) } : null;
  if (!c.lastOrderOn) return null;
  const days = daysBetween(c.lastOrderOn, today);
  if (days < quietDays) return null;
  if (c.contactedOn && daysBetween(c.contactedOn, today) < quietDays) return null;
  return { kind: "quiet", days };
}

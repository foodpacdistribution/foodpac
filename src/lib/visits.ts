// Logging a visit to a store (or a call): what each result means for the customer's stage and
// the next reminder. Pure, safe for client components.

import type { NotNowReason, SalesStage, VisitOutcome } from "./db/schema";
import { shiftDate } from "./dates";

/** Each result, in the order the form shows them, with the reminder it suggests (days; null = none). */
export const OUTCOMES: Record<VisitOutcome, { label: string; hint: string; remindIn: number | null; tone: "green" | "blue" | "amber" | "slate" | "red" }> = {
  ordered: { label: "Placed an order", hint: "Order taken", remindIn: null, tone: "green" },
  interested: { label: "Interested", hint: "Keen, wants to know more", remindIn: 3, tone: "blue" },
  thinking: { label: "Thinking it over", hint: "Will think about it", remindIn: 7, tone: "amber" },
  samples: { label: "Left samples", hint: "Check how they went", remindIn: 3, tone: "blue" },
  not_in: { label: "Boss not in", hint: "Nobody to talk to", remindIn: 2, tone: "slate" },
  not_now: { label: "Not now", hint: "Said no for now", remindIn: 90, tone: "red" },
};
export const VISIT_OUTCOMES = Object.keys(OUTCOMES) as VisitOutcome[];
export const isVisitOutcome = (v: unknown): v is VisitOutcome => typeof v === "string" && Object.hasOwn(OUTCOMES, v);

/** Why a store said no, for "not now". */
export const NOT_NOW_REASONS: Record<NotNowReason, string> = {
  price: "Price",
  supplier: "Happy with their supplier",
  too_small: "Uses too little",
  range: "We don't have what they need",
  other: "Other",
};
export const isNotNowReason = (v: unknown): v is NotNowReason => typeof v === "string" && Object.hasOwn(NOT_NOW_REASONS, v);

/** Quick choices for the next reminder, in days from today. */
export const VISIT_REMIND_IN = [2, 3, 7, 14, 30, 90] as const;

/** Most photos on one visit. */
export const MAX_VISIT_PHOTOS = 6;

/** The reminder a result suggests, as a date (null = none). */
export function suggestedFollowUp(outcome: VisitOutcome, today: string) {
  const days = OUTCOMES[outcome].remindIn;
  return days === null ? null : shiftDate(today, days);
}

/**
 * Where the customer stands after a visit. Results only move a customer forward, never back:
 * - ordered → won
 * - interested, thinking, samples → interested, for a new lead or one that had said "not now"
 * - not now → not now
 * - boss not in → no change
 */
export function stageAfter(outcome: VisitOutcome, stage: SalesStage): SalesStage {
  if (outcome === "ordered") return "won";
  if (outcome === "not_now") return "not_now";
  if (outcome === "not_in") return stage;
  return stage === "new" || stage === "not_now" ? "interested" : stage;
}

/** The reminder's note: what was said, or what the result means when nothing was typed. */
export function followUpNoteFor(outcome: VisitOutcome, note: string, reason: NotNowReason | null) {
  const said = note.trim();
  if (outcome === "not_now") {
    const why = reason && reason !== "other" ? NOT_NOW_REASONS[reason] : null;
    return [why, said].filter(Boolean).join(": ").slice(0, 300) || "Said no for now";
  }
  if (said) return said.slice(0, 300);
  return { ordered: null, interested: "Interested", thinking: "Thinking it over", samples: "Samples left: how did they go?", not_in: "Boss wasn't in" }[outcome];
}

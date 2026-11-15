import { describe, expect, it } from "vitest";
import { buyingLess, daysBetween, dueFollowUp } from "./follow-up";

const today = "2026-11-20";
const none = { followUpOn: null, lastOrderOn: null, contactedOn: null };

describe("dueFollowUp", () => {
  it("counts calendar days", () => {
    expect(daysBetween("2026-11-06", today)).toBe(14);
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
  });

  it("is due on the reminder day and after it, not before", () => {
    expect(dueFollowUp({ ...none, followUpOn: "2026-11-21" }, today, 14)).toBeNull();
    expect(dueFollowUp({ ...none, followUpOn: today }, today, 14)).toEqual({ kind: "reminder", on: today, late: 0 });
    expect(dueFollowUp({ ...none, followUpOn: "2026-11-17" }, today, 14)).toEqual({ kind: "reminder", on: "2026-11-17", late: 3 });
  });

  it("nudges about customers who stopped ordering", () => {
    expect(dueFollowUp({ ...none, lastOrderOn: "2026-11-07" }, today, 14)).toBeNull();
    expect(dueFollowUp({ ...none, lastOrderOn: "2026-11-06" }, today, 14)).toEqual({ kind: "quiet", days: 14 });
    // Never ordered: a lead, not a quiet customer.
    expect(dueFollowUp(none, today, 14)).toBeNull();
  });

  it("waits a full quiet spell after someone followed up", () => {
    const quiet = { ...none, lastOrderOn: "2026-10-01" };
    expect(dueFollowUp({ ...quiet, contactedOn: "2026-11-10" }, today, 14)).toBeNull();
    expect(dueFollowUp({ ...quiet, contactedOn: "2026-11-06" }, today, 14)).toEqual({ kind: "quiet", days: 50 });
  });

  it("lets a planned reminder hold off the quiet nudge", () => {
    expect(dueFollowUp({ ...none, lastOrderOn: "2026-10-01", followUpOn: "2026-11-25" }, today, 14)).toBeNull();
  });
});

describe("new stores without a first order", () => {
  const opened = { ...none, openedOn: "2026-11-10" };
  it("waits a week, then nudges until two months", () => {
    expect(dueFollowUp(opened, "2026-11-16", 14)).toBeNull();
    expect(dueFollowUp(opened, "2026-11-17", 14)).toEqual({ kind: "first_order", days: 7 });
    expect(dueFollowUp(opened, "2027-01-15", 14)).toBeNull();
  });
  it("gives the salesperson a week after a call", () => {
    expect(dueFollowUp({ ...opened, contactedOn: "2026-11-15" }, today, 14)).toBeNull();
    expect(dueFollowUp({ ...opened, contactedOn: "2026-11-12" }, today, 14)).toEqual({ kind: "first_order", days: 10 });
  });
  it("is only for open accounts", () => {
    expect(dueFollowUp(none, today, 14)).toBeNull();
  });
});

describe("buyingLess", () => {
  // Cups every two weeks until early October; still ordering lids since.
  const cups = { name: "Cup 8 oz", days: ["2026-08-01", "2026-08-15", "2026-08-29", "2026-09-12", "2026-09-26", "2026-10-10"], cents: 60000 };
  const lids = { name: "Lid 8 oz", days: ["2026-10-24", "2026-11-07", "2026-11-14"], cents: 9000 };
  const steady = { recentCents: 50000, priorCents: 150000, firstOrderOn: "2026-01-01" };

  it("names a regular product they've stopped buying while still ordering", () => {
    // Every 14 days; 41 days since the last cups.
    expect(buyingLess([cups, lids], steady, "2026-11-14", today)).toEqual({ kind: "product", product: "Cup 8 oz", everyDays: 14, days: 41, more: 0 });
  });

  it("leaves a product alone until it's well past its rhythm", () => {
    expect(buyingLess([{ ...cups, days: [...cups.days.slice(0, -1), "2026-10-24"] }], steady, "2026-11-14", today)).toBeNull();
  });

  it("doesn't call it slipping when they've stopped ordering altogether", () => {
    expect(buyingLess([cups], steady, "2026-10-10", today)).toBeNull();
  });

  it("needs three purchases to know a rhythm", () => {
    expect(buyingLess([{ ...cups, days: cups.days.slice(0, 2) }], steady, "2026-11-14", today)).toBeNull();
  });

  it("spots spend falling well under usual", () => {
    // Usually $500 per 60 days; $250 lately is down 50%.
    expect(buyingLess([], { recentCents: 25000, priorCents: 150000, firstOrderOn: "2026-01-01" }, "2026-11-14", today)).toEqual({ kind: "spend", pct: 50, recentCents: 25000, usualCents: 50000 });
    // Down 30% isn't enough; small customers and new ones are left alone.
    expect(buyingLess([], { recentCents: 35000, priorCents: 150000, firstOrderOn: "2026-01-01" }, "2026-11-14", today)).toBeNull();
    expect(buyingLess([], { recentCents: 0, priorCents: 60000, firstOrderOn: "2026-01-01" }, "2026-11-14", today)).toBeNull();
    expect(buyingLess([], { recentCents: 0, priorCents: 150000, firstOrderOn: "2026-08-01" }, "2026-11-14", today)).toBeNull();
  });

  it("becomes a follow-up, snoozed for three weeks after a call", () => {
    const less = buyingLess([cups, lids], steady, "2026-11-14", today);
    const facts = { ...none, lastOrderOn: "2026-11-14", buyingLess: less };
    expect(dueFollowUp(facts, today, 14)).toMatchObject({ kind: "slipping", product: "Cup 8 oz" });
    expect(dueFollowUp({ ...facts, contactedOn: "2026-11-05" }, today, 14)).toBeNull();
    expect(dueFollowUp({ ...facts, contactedOn: "2026-10-25" }, today, 14)).toMatchObject({ kind: "slipping" });
  });
});

import { describe, expect, it } from "vitest";
import { daysBetween, dueFollowUp } from "./follow-up";

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

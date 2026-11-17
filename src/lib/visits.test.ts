import { describe, expect, it } from "vitest";
import { dueFollowUp } from "./follow-up";
import { followUpNoteFor, stageAfter, suggestedFollowUp } from "./visits";

describe("what a visit means for the customer", () => {
  it("moves customers forward, never back", () => {
    expect(stageAfter("ordered", "new")).toBe("won");
    expect(stageAfter("interested", "new")).toBe("interested");
    expect(stageAfter("samples", "not_now")).toBe("interested");
    expect(stageAfter("thinking", "negotiating")).toBe("negotiating");
    expect(stageAfter("interested", "won")).toBe("won");
    expect(stageAfter("not_in", "negotiating")).toBe("negotiating");
    expect(stageAfter("not_now", "interested")).toBe("not_now");
  });

  it("suggests when to follow up", () => {
    expect(suggestedFollowUp("samples", "2026-11-17")).toBe("2026-11-20");
    expect(suggestedFollowUp("not_in", "2026-11-17")).toBe("2026-11-19");
    expect(suggestedFollowUp("not_now", "2026-11-17")).toBe("2027-02-15");
    expect(suggestedFollowUp("ordered", "2026-11-17")).toBeNull();
  });

  it("writes the reminder's note from what was said, or the result", () => {
    expect(followUpNoteFor("samples", "", null)).toBe("Samples left: how did they go?");
    expect(followUpNoteFor("samples", "  8oz cups  ", null)).toBe("8oz cups");
    expect(followUpNoteFor("not_now", "", "price")).toBe("Price");
    expect(followUpNoteFor("not_now", "pays $30", "supplier")).toBe("Happy with their supplier: pays $30");
    expect(followUpNoteFor("not_now", "", "other")).toBe("Said no for now");
  });
});

describe("customers who said not now", () => {
  it("only come back on the day set to try again", () => {
    const quiet = { followUpOn: null, lastOrderOn: "2026-01-01", contactedOn: null, parked: true };
    expect(dueFollowUp(quiet, "2026-11-17", 30)).toBeNull();
    expect(dueFollowUp({ ...quiet, followUpOn: "2026-11-17" }, "2026-11-17", 30)).toMatchObject({ kind: "reminder" });
    expect(dueFollowUp({ ...quiet, parked: false }, "2026-11-17", 30)).toMatchObject({ kind: "quiet" });
  });
});

import { describe, expect, it } from "vitest";
import { marginFloor, needsApproval, savings, suggestedPrice } from "./price-match-rules";

describe("suggestedPrice", () => {
  it("matches their price, or beats it by the set percent", () => {
    expect(suggestedPrice(2000, 2500, 0)).toBe(2000);
    expect(suggestedPrice(2000, 2500, 3)).toBe(1940);
  });

  it("never goes above our list price", () => {
    expect(suggestedPrice(3000, 2500, 0)).toBe(2500);
  });
});

describe("marginFloor", () => {
  it("keeps the minimum margin over cost", () => {
    // 15% margin on a $17.00 cost: 17 / 0.85 = $20.00
    expect(marginFloor(1700, 15)).toBe(2000);
    expect(marginFloor(1000, 0)).toBe(1000);
    expect(marginFloor(1001, 15)).toBe(1178);
  });

  it("is unknown without a cost", () => {
    expect(marginFloor(null, 15)).toBeNull();
    expect(marginFloor(0, 15)).toBeNull();
  });
});

describe("needsApproval", () => {
  it("lets sales staff go down to the floor", () => {
    expect(needsApproval({ office: false, priceCents: 2000, listCents: 2500, floorCents: 2000 })).toBe(false);
    expect(needsApproval({ office: false, priceCents: 1999, listCents: 2500, floorCents: 2000 })).toBe(true);
  });

  it("asks the office when the cost isn't known, unless it's the list price", () => {
    expect(needsApproval({ office: false, priceCents: 2400, listCents: 2500, floorCents: null })).toBe(true);
    expect(needsApproval({ office: false, priceCents: 2500, listCents: 2500, floorCents: null })).toBe(false);
  });

  it("never holds up the office", () => {
    expect(needsApproval({ office: true, priceCents: 100, listCents: 2500, floorCents: 2000 })).toBe(false);
  });
});

describe("savings", () => {
  it("per unit, as a percent, and per month", () => {
    expect(savings(2500, 2000, 10)).toEqual({ perUnitCents: 500, pct: 20, monthlyCents: 5000 });
    expect(savings(2500, 2000, null).monthlyCents).toBeNull();
  });
});

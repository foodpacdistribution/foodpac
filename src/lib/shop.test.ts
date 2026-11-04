import { describe, expect, it } from "vitest";
import { parseDollars } from "./money";
import { deliveryDates, deliveryPromise, quote } from "./shop";

const settings = {
  deliveryFeeCents: 1500,
  freeDeliveryOverCents: 30000,
  minOrderCents: 5000,
  orderCutoffMin: 14 * 60,
  deliveryDays: [1, 2, 3, 4, 5],
  timezone: "Australia/Brisbane",
} as Parameters<typeof quote>[1];

describe("quote", () => {
  it("adds GST on taxable lines and the delivery fee", () => {
    const q = quote(
      [
        { lineCents: 10000, gst: true },
        { lineCents: 5000, gst: false },
      ],
      settings,
    );
    expect(q.subtotalCents).toBe(15000);
    expect(q.deliveryFeeCents).toBe(1500);
    expect(q.gstCents).toBe(1150); // 10% of (100 + 15 delivery)
    expect(q.totalCents).toBe(17650);
    expect(q.belowMinimum).toBe(false);
  });

  it("makes delivery free at the threshold and flags orders under the minimum", () => {
    expect(quote([{ lineCents: 30000, gst: true }], settings).deliveryFeeCents).toBe(0);
    expect(quote([{ lineCents: 4999, gst: true }], settings).belowMinimum).toBe(true);
  });
});

describe("deliveryDates", () => {
  it("skips weekends and the next day after the cut-off", () => {
    // Friday 10:00 Brisbane (UTC+10) → before cut-off → Monday is first.
    expect(deliveryDates(settings, 2, new Date("2026-11-06T00:00:00Z"))).toEqual(["2026-11-09", "2026-11-10"]);
    // Monday 15:00 → after cut-off → Wednesday is first.
    expect(deliveryDates(settings, 1, new Date("2026-11-09T05:00:00Z"))).toEqual(["2026-11-11"]);
  });
});

describe("deliveryPromise", () => {
  it("promises tomorrow before the cut-off on a weekday", () => {
    // Tuesday 10:00 Brisbane.
    expect(deliveryPromise(settings, new Date("2026-11-10T00:00:00Z"))).toMatchObject({ beforeCutoff: true, day: "2026-11-11", tomorrow: true });
  });
  it("moves on a day after the cut-off, and over the weekend", () => {
    // Tuesday 15:00 → Thursday.
    expect(deliveryPromise(settings, new Date("2026-11-10T05:00:00Z"))).toMatchObject({ beforeCutoff: false, day: "2026-11-12", tomorrow: false });
    // Friday 10:00 → Monday, not "tomorrow".
    expect(deliveryPromise(settings, new Date("2026-11-06T00:00:00Z"))).toMatchObject({ beforeCutoff: true, day: "2026-11-09", tomorrow: false });
  });
  it("has nothing to promise without delivery days", () => {
    expect(deliveryPromise({ ...settings, deliveryDays: [] })).toBeNull();
  });
});

describe("parseDollars", () => {
  it("reads amounts into cents", () => {
    expect(parseDollars("$1,234.5")).toBe(123450);
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("-3")).toBeNull();
  });
});

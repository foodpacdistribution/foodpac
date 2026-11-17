import { describe, expect, it } from "vitest";
import { formatCartons, parseCount, perCarton } from "./stock-units";

describe("cartons and packs", () => {
  it("reads the carton size from the pack size", () => {
    expect(perCarton("8 packets / carton")).toBe(8);
    expect(perCarton("20 sleeves / carton")).toBe(20);
    expect(perCarton("5 per carton")).toBe(5);
    expect(perCarton("")).toBeNull();
    expect(perCarton("1 roll")).toBeNull();
  });

  it("shows stock as cartons plus loose packs", () => {
    expect(formatCartons(167, 8)).toBe("20 ctn + 7 pk");
    expect(formatCartons(160, 8)).toBe("20 ctn");
    expect(formatCartons(5, 8)).toBe("5 pk");
    expect(formatCartons(12, null)).toBe("12");
  });

  it("reads counts as written on the stocktake sheet", () => {
    expect(parseCount("20CTN+7P", 8, "packet")).toEqual({ ok: true, units: 167, dropped: 0 });
    expect(parseCount("21 ctn + 3p + 3ctn", 6, "packet")).toEqual({ ok: true, units: 147, dropped: 0 });
    expect(parseCount("14P", null, "packet")).toEqual({ ok: true, units: 14, dropped: 0 });
    expect(parseCount("0", 10, "packet")).toEqual({ ok: true, units: 0, dropped: 0 });
    expect(parseCount("58 bag", null, "bag")).toEqual({ ok: true, units: 58, dropped: 0 });
  });

  it("keeps whole cartons for products sold by the carton and reports loose packs", () => {
    expect(parseCount("33CTN+10PK", null, "carton")).toEqual({ ok: true, units: 33, dropped: 10 });
    expect(parseCount("6", null, "carton")).toEqual({ ok: true, units: 6, dropped: 0 });
  });

  it("refuses what it can't convert", () => {
    expect(parseCount("2ctn", null, "bottle").ok).toBe(false);
    expect(parseCount("lots", 10, "packet").ok).toBe(false);
    expect(parseCount("", 10, "packet").ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { stripUnit } from "./geo/geocode";
import { geocodeQuery, guessMapping, multiStopNavigation, navigationUrls, parseDate, validateImportRow } from "./orders";

describe("guessMapping", () => {
  it("maps common spreadsheet headers", () => {
    const m = guessMapping(["Order No.", "Customer Name", "Delivery Address", "Suburb", "Post Code", "Delivery Window", "Qty"]);
    expect(m).toMatchObject({ orderNumber: 0, customerName: 1, address: 2, suburb: 3, postcode: 4, timeWindow: 5, demand: 6 });
  });
});

describe("parseDate", () => {
  it("reads ISO and day-first dates", () => {
    expect(parseDate("2026-10-27")).toBe("2026-10-27");
    expect(parseDate("27/10/2026")).toBe("2026-10-27");
    expect(parseDate("1/2/26")).toBe("2026-02-01");
    expect(parseDate("31/02/2026")).toBeNull();
  });

  it("reads dates with month names, as order PDFs print them", () => {
    expect(parseDate("Nov 09, 2026")).toBe("2026-11-09");
    expect(parseDate("9 November 2026")).toBe("2026-11-09");
    expect(parseDate("09-Nov-26")).toBe("2026-11-09");
    expect(parseDate("Mon, 9 Nov 2026")).toBe("2026-11-09");
    expect(parseDate("Feb 30, 2026")).toBeNull();
    expect(parseDate("Novx 9 2026")).toBeNull();
  });
});

describe("validateImportRow", () => {
  it("normalises a full row", () => {
    const r = validateImportRow(
      { orderNumber: "A1", address: "12 Smith St", timeWindow: "9am-12pm", demand: "3", priority: "Urgent" },
      "2026-10-27",
      0,
    );
    expect(r.ok && r.value).toMatchObject({ orderNumber: "A1", windowStartMin: 540, windowEndMin: 720, demand: 3, priority: 1 });
  });
  it("rejects rows without an address or with bad windows", () => {
    expect(validateImportRow({ orderNumber: "A1" }, "2026-10-27", 0).ok).toBe(false);
    expect(validateImportRow({ address: "x", timeWindow: "lunchtime" }, "2026-10-27", 0).ok).toBe(false);
  });
  it("generates stable order numbers so re-importing the same file is deduplicated", () => {
    const a = validateImportRow({ address: "x" }, "2026-10-27", 4);
    expect(a.ok && a.value.orderNumber).toBe("IMP-20261027-0005");
  });
});

describe("Google Maps navigation links", () => {
  it("opens turn-by-turn to a single stop", () => {
    expect(navigationUrls(-27.4, 153.1).google).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-27.4,153.1&travelmode=driving&dir_action=navigate",
    );
  });
  it("routes through the next stops in order, capped at Google's waypoint limit", () => {
    const pts = Array.from({ length: 14 }, (_, i) => ({ lat: -27 - i / 100, lng: 153 }));
    const nav = multiStopNavigation(pts)!;
    expect(nav.count).toBe(10);
    const url = new URL(nav.url);
    expect(url.searchParams.get("destination")).toBe("-27.09,153");
    expect(url.searchParams.get("waypoints")!.split("|")).toHaveLength(9);
    expect(url.searchParams.get("waypoints")!.startsWith("-27,153|-27.01,153")).toBe(true);
  });
});

describe("address helpers", () => {
  it("builds the geocoder query without repeating parts", () => {
    expect(geocodeQuery({ address: "12 Smith St", suburb: "Toowong", postcode: "4066" })).toBe("12 Smith St, Toowong, 4066");
    expect(geocodeQuery({ address: "12 Smith St, Toowong QLD 4066", suburb: "Toowong", postcode: "4066" })).toBe(
      "12 Smith St, Toowong QLD 4066",
    );
  });
  it("strips unit prefixes", () => {
    expect(stripUnit("Unit 3, 12 Smith St")).toBe("12 Smith St");
    expect(stripUnit("3/12 Smith St")).toBe("12 Smith St");
    expect(stripUnit("12 Smith St")).toBe("12 Smith St");
  });
});

import { describe, expect, it } from "vitest";
import { sniffImage } from "./proofs";
import { parseFeed } from "./sync";
import { stationarySeconds, trackDistance } from "./tracking";

const at = (min: number) => new Date(Date.UTC(2026, 9, 27, 0, min));

describe("GPS tracking maths", () => {
  it("sums driven distance and ignores inaccurate fixes and jumps", () => {
    const fixes = [
      { lat: -27.47, lng: 153.02, accuracyM: 10, at: at(0) },
      { lat: -27.48, lng: 153.02, accuracyM: 10, at: at(2) }, // ~1.1 km
      { lat: -27.6, lng: 153.3, accuracyM: 500, at: at(3) }, // bad accuracy, ignored
      { lat: -28.5, lng: 153.02, accuracyM: 10, at: at(4) }, // 100+ km in 2 min: teleport, ignored
      { lat: -27.49, lng: 153.02, accuracyM: 10, at: at(6) }, // ~1.1 km from the last good fix
    ];
    const d = trackDistance(fixes);
    expect(d).toBeGreaterThan(2100);
    expect(d).toBeLessThan(2400);
  });

  it("measures how long a vehicle has stayed in one spot", () => {
    const here = { lat: -27.47, lng: 153.02 };
    const fixes = [
      { lat: -27.5, lng: 153.02, at: at(0) },
      { ...here, at: at(5) },
      { lat: here.lat + 0.0002, lng: here.lng, at: at(15) }, // ~22 m drift
      { ...here, at: at(30) },
    ];
    expect(stationarySeconds(fixes)).toBe(25 * 60);
  });
});

describe("feed parsing", () => {
  it("auto-detects CSV columns", () => {
    const rows = parseFeed("Order No,Customer,Delivery Address,Postcode\nA1,Acme,12 Example St,4066\n", "csv", {});
    expect(rows).toEqual([{ orderNumber: "A1", customerName: "Acme", address: "12 Example St", postcode: "4066" }]);
  });
  it("applies an explicit mapping to JSON and coerces values to text", () => {
    const body = JSON.stringify({ orders: [{ so: 991, shipTo: "1 Main Rd", qty: 3 }] });
    const rows = parseFeed(body, "json", { orderNumber: "so", address: "shipTo" });
    expect(rows[0]).toMatchObject({ orderNumber: "991", address: "1 Main Rd", demand: "3" });
  });
  it("rejects JSON that isn't a list of orders", () => {
    expect(() => parseFeed('{"hello":1}', "json", {})).toThrow(/array of orders/);
  });
});

describe("proof uploads", () => {
  it("identifies images by content, not by the claimed type", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});

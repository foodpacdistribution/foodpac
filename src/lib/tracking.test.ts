import { describe, expect, it } from "vitest";
import { worthKeeping, type Fix as PhoneFix } from "@/app/driver/use-location-sharing";
import { bestFix, cleanTrail, pathProgress, stopIndexes } from "./tracking";

const at = (s: number) => new Date(Date.UTC(2026, 10, 9, 0, 0, s));
// ~111 m per 0.001° of latitude.
const fix = (lat: number, s: number, accuracyM: number | null = 10) => ({ lat, lng: 153, accuracyM, at: at(s) });

describe("bestFix", () => {
  it("keeps the last precise fix over a newer rough one", () => {
    const f = [fix(-27.5, 0, 8), fix(-27.6, 30, 1500)];
    expect(bestFix(f)).toBe(f[0]);
  });
  it("uses a rough fix once nothing precise has come for two minutes", () => {
    const f = [fix(-27.5, 0, 8), fix(-27.6, 200, 1500)];
    expect(bestFix(f)).toBe(f[1]);
  });
});

describe("cleanTrail", () => {
  it("drops rough fixes, GPS jumps and points piled on one spot", () => {
    const trail = cleanTrail([
      fix(-27.5, 0),
      fix(-27.50001, 5), // 1 m away: nothing new
      fix(-27.5, 6, 500), // rough
      fix(-27.8, 10), // 33 km in 10 s: a jump
      fix(-27.501, 20), // 111 m on: kept
    ]);
    expect(trail).toEqual([
      [-27.5, 153],
      [-27.501, 153],
    ]);
  });
});

describe("pathProgress", () => {
  // A straight road south: 11 points 111 m apart; stops at points 3 and 8.
  const path: [number, number][] = Array.from({ length: 11 }, (_, i) => [-27.5 - i * 0.001, 153]);
  const stops = [
    { lat: -27.503, lng: 153 },
    { lat: -27.508, lng: 153 },
  ];
  it("finds each stop on the path in order", () => {
    expect(stopIndexes(path, stops)).toEqual([3, 8]);
  });
  it("places the driver between the last finished stop and the next", () => {
    expect(pathProgress(path, stops, 1, { lat: -27.5061, lng: 153.0002 })).toBe(6);
  });
  it("falls back to the last finished stop without a position, or when far off the route", () => {
    expect(pathProgress(path, stops, 1, null)).toBe(3);
    expect(pathProgress(path, stops, 1, { lat: -27.506, lng: 153.05 })).toBe(3);
  });
  it("doesn't grey out past the next stop when the driver is somewhere beyond it", () => {
    expect(pathProgress(path, stops, 0, { lat: -27.5029, lng: 153 })).toBe(3);
    expect(pathProgress(path, stops, 0, { lat: -27.51, lng: 153 })).toBe(0);
  });
});

describe("worthKeeping (phone)", () => {
  const p = (lat: number, ts: number, accuracy: number | null = 10): PhoneFix => ({ lat, lng: 153, accuracy, speed: null, heading: null, ts });
  it("keeps the first fix, movement and the odd heartbeat, and skips the rest", () => {
    expect(worthKeeping(p(-27.5, 0), null)).toBe(true);
    expect(worthKeeping(p(-27.50005, 5_000), p(-27.5, 0))).toBe(false); // 5 m, 5 s
    expect(worthKeeping(p(-27.5002, 5_000), p(-27.5, 0))).toBe(true); // 22 m
    expect(worthKeeping(p(-27.5, 31_000), p(-27.5, 0))).toBe(true); // parked, 31 s
    expect(worthKeeping(p(-27.5, 5_000, 4), p(-27.5, 0, 20))).toBe(true); // much more precise
  });
  it("drops very rough fixes while precise ones are coming in", () => {
    expect(worthKeeping(p(-27.6, 5_000, 900), p(-27.5, 0))).toBe(false);
    expect(worthKeeping(p(-27.6, 70_000, 900), p(-27.5, 0))).toBe(true);
  });
});

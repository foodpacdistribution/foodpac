import { describe, expect, it } from "vitest";
import { fitTiming, type Leg, MIN_LEGS } from "./calibrate";

// Deterministic spread of leg lengths between 3 and 25 minutes.
const drives = Array.from({ length: 40 }, (_, i) => 180 + ((i * 337) % 1320));

describe("fitTiming", () => {
  it("needs enough deliveries", () => {
    expect(fitTiming(drives.slice(0, MIN_LEGS - 1).map((d) => ({ driveS: d, gapS: d + 300 })))).toBeNull();
  });

  it("recovers driving speed and unloading time", () => {
    const legs: Leg[] = drives.map((d, i) => ({ driveS: d, gapS: 1.25 * d + 420 + (i % 2 ? 30 : -30) }));
    const t = fitTiming(legs)!;
    expect(Math.abs(t.trafficFactor - 1.25)).toBeLessThanOrEqual(0.05);
    expect(t.serviceMin).toBe(7);
    expect(t.legs).toBe(40);
  });

  it("ignores breaks and taps made in a burst", () => {
    const legs: Leg[] = drives.map((d) => ({ driveS: d, gapS: 1.2 * d + 300 }));
    legs[3] = { driveS: drives[3], gapS: drives[3] + 50 * 60 }; // lunch
    legs[7] = { driveS: drives[7], gapS: 20 }; // tapped through
    legs[9] = { driveS: drives[9], gapS: 5 * 3600 };
    const t = fitTiming(legs)!;
    expect(t.trafficFactor).toBe(1.2);
    expect(t.serviceMin).toBe(5);
    expect(t.legs).toBe(37);
  });

  it("never plans faster than road data or beyond double", () => {
    expect(fitTiming(drives.map((d) => ({ driveS: d, gapS: 0.6 * d + 600 })))!.trafficFactor).toBe(1);
    expect(fitTiming(drives.map((d) => ({ driveS: d, gapS: 3 * d + 120 })))!.trafficFactor).toBe(2);
  });

  it("falls back to unloading time when every leg is the same length", () => {
    const t = fitTiming(Array.from({ length: 25 }, () => ({ driveS: 600, gapS: 600 + 480 })))!;
    expect(t).toEqual({ trafficFactor: 1, serviceMin: 8, legs: 25 });
  });
});

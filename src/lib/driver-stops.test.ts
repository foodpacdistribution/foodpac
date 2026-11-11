import { describe, expect, it } from "vitest";
import { doneAt } from "./driver-stops";

describe("doneAt", () => {
  const now = new Date("2026-11-11T05:00:00Z");

  it("keeps the time the driver confirmed, when the upload had to wait for signal", () => {
    const signed = now.getTime() - 3 * 3600 * 1000;
    expect(doneAt(String(signed), now).getTime()).toBe(signed);
  });

  it("uses the upload time when the phone's time is missing or can't be right", () => {
    expect(doneAt(null, now)).toBe(now);
    expect(doneAt("not a time", now)).toBe(now);
    expect(doneAt(String(now.getTime() + 60_000), now)).toBe(now);
    expect(doneAt(String(now.getTime() - 8 * 24 * 3600 * 1000), now)).toBe(now);
  });
});

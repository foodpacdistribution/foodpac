import { describe, expect, it, vi } from "vitest";
import { shortCache } from "./short-cache";

describe("shortCache", () => {
  it("reads once for everyone asking within the time, then again", async () => {
    let t = 0;
    const cached = shortCache<number>(5_000, () => t);
    const read = vi.fn(async () => t);
    expect(await Promise.all([cached("admin", read), cached("admin", read)])).toEqual([0, 0]);
    t = 4_999;
    expect(await cached("admin", read)).toBe(0);
    expect(read).toHaveBeenCalledTimes(1);
    t = 5_000;
    expect(await cached("admin", read)).toBe(5_000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps each screen's answer apart", async () => {
    const cached = shortCache<string>(5_000);
    expect(await cached("admin", async () => "a")).toBe("a");
    expect(await cached("tracking", async () => "b")).toBe("b");
  });

  it("doesn't keep a failed read", async () => {
    const cached = shortCache<string>(5_000);
    await expect(cached("admin", async () => Promise.reject(new Error("no answer")))).rejects.toThrow("no answer");
    expect(await cached("admin", async () => "fine")).toBe("fine");
  });
});

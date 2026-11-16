import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, nowSecondsIn, parseTime, parseTimeWindow, startOfDayIn, todayIn } from "./time";

describe("parseTime", () => {
  it.each([
    ["9", 540],
    ["9:30", 570],
    ["0930", 570],
    ["9am", 540],
    ["12pm", 720],
    ["12am", 0],
    ["1:15 pm", 795],
    ["13:00", 780],
  ])("%s → %d", (input, expected) => expect(parseTime(input)).toBe(expected));

  it("rejects nonsense", () => {
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("13pm")).toBeNull();
    expect(parseTime("noon-ish")).toBeNull();
  });
});

describe("parseTimeWindow", () => {
  it("parses ranges", () => {
    expect(parseTimeWindow("9am-12pm")).toEqual({ start: 540, end: 720 });
    expect(parseTimeWindow("09:00 – 12:00")).toEqual({ start: 540, end: 720 });
    expect(parseTimeWindow("1 to 4pm")).toEqual({ start: 780, end: 960 });
  });
  it("parses open-ended windows", () => {
    expect(parseTimeWindow("before 11am")).toEqual({ start: null, end: 660 });
    expect(parseTimeWindow("after 2pm")).toEqual({ start: 840, end: null });
  });
  it("treats blank as no window and garbage as invalid", () => {
    expect(parseTimeWindow("")).toEqual({ start: null, end: null });
    expect(parseTimeWindow("whenever")).toBeNull();
    expect(parseTimeWindow("12:00-09:00")).toBeNull();
  });
});

describe("timezone helpers", () => {
  const t = new Date("2026-10-26T22:30:00Z"); // 8:30am next day in Brisbane (UTC+10)
  it("uses the company timezone for today and now", () => {
    expect(todayIn("Australia/Brisbane", t)).toBe("2026-10-27");
    expect(nowSecondsIn("Australia/Brisbane", t)).toBe(8 * 3600 + 30 * 60);
  });
  it("formats", () => {
    expect(formatClock(13 * 3600 + 5 * 60)).toBe("1:05pm");
    expect(formatDuration(3 * 3600 + 45 * 60)).toBe("3h 45m");
  });
});

describe("startOfDayIn", () => {
  it("finds local midnight, daylight saving included", () => {
    expect(startOfDayIn("Australia/Brisbane", "2026-11-16").toISOString()).toBe("2026-11-15T14:00:00.000Z");
    expect(startOfDayIn("Australia/Sydney", "2026-11-16").toISOString()).toBe("2026-11-15T13:00:00.000Z");
    expect(startOfDayIn("Australia/Sydney", "2026-06-16").toISOString()).toBe("2026-06-15T14:00:00.000Z");
    expect(startOfDayIn("UTC", "2026-01-01").toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

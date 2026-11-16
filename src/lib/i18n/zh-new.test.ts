import { describe, expect, it } from "vitest";
import { translate } from ".";
import * as zh from "./zh";

describe("margins and new customers in Chinese", () => {
  it("translates the report's lines", () => {
    expect(translate(zh, "FP-1001 · 12 units · 23% margin")).toBe("FP-1001 · 12 件 · 毛利 23%");
    expect(translate(zh, " · $1,234.00 gross profit · 18% margin")).toBe(" · 毛利 $1,234.00 · 毛利率 18%");
    expect(translate(zh, "approved in 2 days (median)")).toBe("审批用时 2 天(中位数)");
    expect(translate(zh, "Margin {pct}%", { pct: 30 })).toBe("毛利 30%");
  });
});

import { describe, expect, it } from "vitest";
import { translate } from ".";
import { zhDates } from "./zh-dates";

describe("translate", () => {
  it("leaves English alone", () => {
    expect(translate("en", "Place order")).toBe("Place order");
    expect(translate("en", "{n} units over capacity", { n: 3 })).toBe("3 units over capacity");
  });

  it("uses the dictionary, then patterns, and fills variables", () => {
    expect(translate("zh", "Place order")).toBe("提交订单");
    expect(translate("zh", "{n} units over capacity", { n: 3 })).toBe("超出载量 3 件");
    expect(translate("zh", "Welcome back, Alex")).toBe("欢迎回来,Alex");
  });

  it("keeps unknown text in English", () => {
    expect(translate("zh", "Kraft takeaway box No.8")).toBe("Kraft takeaway box No.8");
  });

  it("rewrites dates and times inside a pattern match", () => {
    expect(translate("zh", "Est. finish 2:44pm")).toBe("预计完成 14:44");
  });
});

describe("zhDates", () => {
  it("handles the app's date formats", () => {
    expect(zhDates("Mon, 2 Nov 2026")).toBe("2026年11月2日 周一");
    expect(zhDates("Monday 2 November")).toBe("11月2日 周一");
    expect(zhDates("Sun")).toBe("周日");
    expect(zhDates("12:05am")).toBe("0:05");
  });

  it("converts durations but not distances", () => {
    expect(zhDates("1h 05m")).toBe("1小时5分");
    expect(zhDates("34 min ago")).toBe("34 分钟前");
    expect(zhDates("Baking paper 40 cm x 120 m")).toBe("Baking paper 40 cm x 120 m");
  });
});

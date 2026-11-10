import { describe, expect, it } from "vitest";
import { translate } from ".";
import * as zh from "./zh";
import { zhDates } from "./zh-dates";

describe("translate", () => {
  it("leaves English alone", () => {
    expect(translate(null, "Place order")).toBe("Place order");
    expect(translate(null, "{n} units over capacity", { n: 3 })).toBe("3 units over capacity");
  });

  it("uses the dictionary, then patterns, and fills variables", () => {
    expect(translate(zh, "Place order")).toBe("提交订单");
    expect(translate(zh, "{n} units over capacity", { n: 3 })).toBe("超出载量 3 件");
    expect(translate(zh, "Welcome back, Alex")).toBe("欢迎回来,Alex");
    expect(translate(zh, "2 new stop(s) added · route re-ordered for the fastest drive")).toBe("新增 2 个站点 · 已重新排出最快路线");
    expect(translate(zh, "3 products added to cart")).toBe("已将 3 个商品加入购物车");
    expect(translate(zh, "4 items added to cart")).toBe("已加入购物车:4 件商品");
    expect(translate(zh, "Cling wrap added to cart")).toBe("已加入购物车:Cling wrap");
  });

  it("keeps unknown text in English", () => {
    expect(translate(zh, "Kraft takeaway box No.8")).toBe("Kraft takeaway box No.8");
  });

  it("rewrites dates and times inside a pattern match", () => {
    expect(translate(zh, "Est. finish 2:44pm")).toBe("预计完成 14:44");
  });
});

describe("missed delivery days", () => {
  it("translates the tab and the move messages, dates included", () => {
    expect(translate(zh, "Missed day (3)")).toBe("错过送货日 (3)");
    expect(translate(zh, "Moved 2 order(s) to Thu, 12 Nov")).toBe("已将 2 个订单改到 11月12日 周四");
    expect(translate(zh, "Moved 1 order(s) to Thu, 12 Nov · not moved: FP-10001")).toBe("已将 1 个订单改到 11月12日 周四 · 未改期:FP-10001");
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

describe("sales pipeline messages", () => {
  it("translates stage changes and saves", () => {
    expect(translate(zh, "Lucky Noodle Bar: In talks")).toBe("Lucky Noodle Bar:洽谈中");
    expect(translate(zh, "Customer added: Corner Bakehouse")).toBe("已添加客户:Corner Bakehouse");
    expect(translate(zh, "{n} days ago", { n: 3 })).toBe("3 天前");
  });
});

describe("follow-up messages", () => {
  it("translates reminders, dates included", () => {
    expect(translate(zh, "Reminder set for Sun, 8 Nov 2026")).toBe("已设置提醒:2026年11月8日 周日");
    expect(translate(zh, "Followed up: Lucky Noodle Bar")).toBe("已回访:Lucky Noodle Bar");
    expect(translate(zh, "No order for {n} days", { n: 16 })).toBe("已经 16 天没下单");
  });
});

describe("staff order messages", () => {
  it("translates order and stock messages", () => {
    expect(translate(zh, "Order FP-10023 placed")).toBe("订单 FP-10023 已提交");
    expect(translate(zh, "Cup 8 oz: 3 to waiting orders, 7 in stock")).toBe("Cup 8 oz:3 件分给了等货的订单,库存 7");
  });
});

describe("purchasing and store credit messages", () => {
  it("translates document messages and database refusals", () => {
    expect(translate(zh, "PO-10001 confirmed by the supplier")).toBe("PO-10001 供应商已确认");
    expect(translate(zh, "Not enough store credit: $150.00 available.")).toBe("客户余额不足：可用 $150.00。");
    expect(translate(zh, "Not enough free stock of CUP8 to send back: 2 free, 5 to go. The rest is reserved for customer orders.")).toBe("CUP8 可用库存不足，无法退货：可用 2，需退 5。其余库存已被客户订单占用。");
    expect(translate(zh, "Pending supplier confirmation")).toBe("等待供应商确认");
  });
});

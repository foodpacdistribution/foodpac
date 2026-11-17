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

describe("price match in Chinese", () => {
  it("translates the messages after saving and deciding", () => {
    expect(translate(zh, "Paper bowl 750ml: their price is now $20.90")).toBe("Paper bowl 750ml：专属价已改为 $20.90");
    expect(translate(zh, "Paper bowl 750ml: $1,019.50 sent to the office to approve")).toBe("Paper bowl 750ml：$1,019.50 已提交办公室审批");
    expect(translate(zh, "Approved: Cling wrap")).toBe("已批准：Cling wrap");
    expect(translate(zh, "3 products added to their list")).toBe("已将 3 个商品加入客户清单");
    expect(translate(zh, "They save {amount} each ({pct}%)", { amount: "$1.00", pct: 5 })).toBe("每件省 $1.00（5%）");
  });
});

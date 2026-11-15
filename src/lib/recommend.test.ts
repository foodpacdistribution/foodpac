import { describe, expect, it } from "vitest";
import { suggest } from "./recommend";

const rows = (m: Record<string, string[]>) => Object.entries(m).flatMap(([customerId, ps]) => ps.map((productId) => ({ customerId, productId })));

describe("suggest", () => {
  it("offers what alike stores buy that this one doesn't", () => {
    const bought = rows({
      me: ["cup", "lid"],
      tea1: ["cup", "lid", "straw", "bag"],
      tea2: ["cup", "lid", "straw"],
      bakery: ["box", "paper"],
    });
    // Straws: both tea shops; bags: one; the bakery shares nothing, so its products don't count.
    expect(suggest(bought, "me", 5)).toEqual([
      { productId: "straw", stores: 2, of: 2 },
      { productId: "bag", stores: 1, of: 2 },
    ]);
  });

  it("falls back to what sells to the most stores for a customer with no orders", () => {
    const bought = rows({ a: ["cup", "lid"], b: ["cup"], c: ["cup", "box"] });
    expect(suggest(bought, "new", 2)).toEqual([
      { productId: "cup", stores: 3, of: 0 },
      { productId: "box", stores: 1, of: 0 },
    ]);
  });
});

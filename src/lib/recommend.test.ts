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
      { productId: "straw", stores: 2, of: 2, basis: "alike" },
      { productId: "bag", stores: 1, of: 2, basis: "alike" },
    ]);
  });

  it("falls back to what sells to the most stores for a customer with no orders", () => {
    const bought = rows({ a: ["cup", "lid"], b: ["cup"], c: ["cup", "box"] });
    expect(suggest(bought, "new", 2)).toEqual([
      { productId: "cup", stores: 3, of: 0, basis: "all" },
      { productId: "box", stores: 1, of: 0, basis: "all" },
    ]);
  });

  it("offers a new store what stores of its kind buy", () => {
    const bought = rows({ tea1: ["cup", "straw", "film"], tea2: ["cup", "straw"], bakery1: ["box", "paper", "cup"], bakery2: ["box", "paper"] });
    expect(suggest(bought, "newTea", 3, new Set(["tea1", "tea2", "newTea"]))).toEqual([
      { productId: "cup", stores: 2, of: 2, basis: "type" },
      { productId: "straw", stores: 2, of: 2, basis: "type" },
      { productId: "film", stores: 1, of: 2, basis: "type" },
    ]);
    // Its kind doesn't buy from us yet: what sells to the most stores.
    expect(suggest(bought, "newCafe", 1, new Set(["newCafe", "cafe2"]))[0]).toMatchObject({ basis: "all" });
  });

  it("counts alike stores of the same kind a little more", () => {
    const bought = rows({ me: ["cup", "lid"], a: ["cup", "lid", "straw"], b: ["cup", "lid", "bag"] });
    expect(suggest(bought, "me", 2, new Set(["me", "b"])).map((x) => x.productId)).toEqual(["bag", "straw"]);
    expect(suggest(bought, "me", 2).map((x) => x.productId)).toEqual(["bag", "straw"].sort());
  });
});

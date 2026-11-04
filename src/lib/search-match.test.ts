import { describe, expect, it } from "vitest";
import { matchProducts, type SearchEntry } from "./search-match";

const p = (sku: string, name: string, extra: Partial<SearchEntry> = {}): SearchEntry => ({
  id: sku,
  sku,
  name,
  category: "Takeaway Containers",
  packSize: "500 / ctn",
  barcode: null,
  hasImage: false,
  updatedAt: "2026-01-01T00:00:00Z",
  ...extra,
});

const catalogue = [
  p("BOX-12", "Kraft noodle box 16oz"),
  p("CUP-08", "Double wall coffee cup 8oz", { category: "Cups & Lids", barcode: "9312345678901" }),
  p("CUP-12", "Double wall coffee cup 12oz", { category: "Cups & Lids" }),
  p("LID-90", "Sip lid for cups 90mm", { category: "Cups & Lids" }),
  p("CAFE-1", "Café napkins", { category: "Serviettes" }),
];

describe("matchProducts", () => {
  it("needs every word, in any order and case", () => {
    expect(matchProducts(catalogue, "12oz CUP").map((e) => e.sku)).toEqual(["CUP-12"]);
    expect(matchProducts(catalogue, "noodle pizza")).toEqual([]);
  });

  it("puts an exact SKU or barcode first, then SKU and name prefixes", () => {
    expect(matchProducts(catalogue, "cup-12")[0].sku).toBe("CUP-12");
    expect(matchProducts(catalogue, "9312345678901").map((e) => e.sku)).toEqual(["CUP-08"]);
    expect(matchProducts(catalogue, "cup").map((e) => e.sku)).toEqual(["CUP-08", "CUP-12", "LID-90"]);
  });

  it("matches pack size and category, ignores accents, and limits the list", () => {
    expect(matchProducts(catalogue, "serviettes").map((e) => e.sku)).toEqual(["CAFE-1"]);
    expect(matchProducts(catalogue, "cafe").map((e) => e.sku)).toEqual(["CAFE-1"]);
    expect(matchProducts(catalogue, "ctn", 2)).toHaveLength(2);
    expect(matchProducts(catalogue, "   ")).toEqual([]);
  });
});

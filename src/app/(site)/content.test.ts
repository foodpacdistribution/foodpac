import { describe, expect, it } from "vitest";
import { CATEGORIES, categoryHref, categorySlug, linksToStock } from "./content";

describe("category addresses", () => {
  it("reads well and keeps the meaning of &", () => {
    expect(categorySlug("Cups & lids")).toBe("cups-and-lids");
    expect(categoryHref("Pantry & dry goods")).toBe("/categories/pantry-and-dry-goods");
    expect(categorySlug("  Gloves (nitrile) / vinyl ")).toBe("gloves-nitrile-vinyl");
  });

  it("gives every standard category its own address", () => {
    const slugs = CATEGORIES.map((c) => categorySlug(c.title));
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("linksToStock", () => {
  const counts = [
    { name: "Takeaway containers", n: 1 },
    { name: "Cups & lids", n: 0 },
  ];
  it("keeps links to categories with products and to other pages", () => {
    expect(linksToStock("/categories/takeaway-containers", counts)).toBe(true);
    expect(linksToStock("/products", counts)).toBe(true);
    expect(linksToStock("/register", counts)).toBe(true);
  });
  it("drops links to empty or unknown categories", () => {
    expect(linksToStock("/categories/cups-and-lids", counts)).toBe(false);
    expect(linksToStock("/categories/bags-and-wraps", counts)).toBe(false);
  });
});

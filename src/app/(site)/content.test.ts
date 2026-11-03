import { describe, expect, it } from "vitest";
import { CATEGORIES, categoryHref, categorySlug } from "./content";

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

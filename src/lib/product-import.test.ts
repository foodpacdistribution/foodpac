import { describe, expect, it } from "vitest";
import { checkProductRow, duplicateSkus, guessProductMapping, parseMoney, parseYesNo, toCsv } from "./product-import";

describe("guessProductMapping", () => {
  it("matches English, Chinese and messy headers", () => {
    expect(guessProductMapping(["Item Code", "Product Name", "Unit Price (ex GST)", "Qty on hand", "Pack Size"])).toEqual({ sku: 0, name: 1, price: 2, stock: 3, packSize: 4 });
    expect(guessProductMapping(["货号", "品名", "单价", "库存", "规格", "分类"])).toEqual({ sku: 0, name: 1, price: 2, stock: 3, packSize: 4, category: 5 });
  });
});

describe("parsing", () => {
  it("reads money and yes/no", () => {
    expect(parseMoney("$1,234.50")).toBe(123450);
    expect(parseMoney("AUD 12")).toBe(1200);
    expect(parseMoney("12,5")).toBeNull();
    expect(parseYesNo("Y")).toBe(true);
    expect(parseYesNo("否")).toBe(false);
    expect(parseYesNo("maybe")).toBeNull();
  });
});

describe("checkProductRow", () => {
  it("normalises the SKU and keeps only filled cells", () => {
    expect(checkProductRow({ sku: " fp 100 ", price: "10", name: "" })).toEqual({ ok: true, value: { sku: "FP-100", priceCents: 1000 } });
  });
  it("rejects bad values with a reason", () => {
    expect(checkProductRow({ sku: "" })).toEqual({ ok: false, error: "No SKU" });
    expect(checkProductRow({ sku: "A1", price: "ten" }).ok).toBe(false);
    expect(checkProductRow({ sku: "A1", stock: "3.5" }).ok).toBe(false);
    expect(checkProductRow({ sku: "A/1" }).ok).toBe(false);
  });
  it("takes GST out of GST-inclusive prices, but not for GST-free lines", () => {
    expect(checkProductRow({ sku: "A", price: "11" }, { pricesIncGst: true })).toMatchObject({ value: { priceCents: 1000 } });
    expect(checkProductRow({ sku: "A", price: "11", gst: "no" }, { pricesIncGst: true })).toMatchObject({ value: { priceCents: 1100, gst: false } });
  });
  it("flips a 'GST free' column", () => {
    expect(checkProductRow({ sku: "A", gst: "yes" }, { gstColumnHeader: "GST free" })).toMatchObject({ value: { gst: false } });
  });
});

describe("duplicateSkus / toCsv", () => {
  it("finds repeated SKUs and escapes CSV", () => {
    expect([...duplicateSkus([{ sku: "a" }, { sku: "B" }, { sku: "A " }])]).toEqual([[2, 0]]);
    expect(toCsv([["a,b", 'say "hi"', 3]])).toBe('﻿"a,b","say ""hi""",3');
  });
});

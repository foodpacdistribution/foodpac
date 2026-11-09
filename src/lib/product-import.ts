// Bulk product import: column matching and row checks. Client-safe, so the browser can preview
// and the server re-checks every row with the same rules.

import { GST_RATE } from "./money";

export const PRODUCT_FIELDS = [
  { key: "sku", label: "SKU *", synonyms: ["sku", "code", "product code", "item code", "item no", "item number", "product id", "article", "编号", "货号", "产品编号", "商品编码", "编码"] },
  { key: "name", label: "Product name *", synonyms: ["name", "product", "product name", "item", "item name", "title", "名称", "产品名称", "商品名称", "品名", "产品"] },
  { key: "price", label: "Price per unit *", synonyms: ["price", "unit price", "price ex gst", "sell price", "wholesale price", "trade price", "list price", "价格", "单价", "批发价", "售价"] },
  { key: "category", label: "Category", synonyms: ["category", "group", "department", "range", "type", "分类", "类别", "类目"] },
  { key: "packSize", label: "Pack size", synonyms: ["pack size", "pack", "packing", "size", "carton size", "carton", "pack qty", "规格", "包装", "装箱"] },
  { key: "unit", label: "Sold by (unit)", synonyms: ["unit", "uom", "sold by", "sell unit", "单位"] },
  { key: "minQty", label: "Minimum order", synonyms: ["min qty", "minimum", "minimum order", "moq", "min order", "起订量", "最低起订", "最小起订"] },
  { key: "stock", label: "Stock on hand", synonyms: ["stock", "stock on hand", "soh", "on hand", "qty on hand", "inventory", "quantity", "qty", "库存", "数量", "现货"] },
  { key: "barcode", label: "Barcode", synonyms: ["barcode", "ean", "upc", "gtin", "条码", "条形码"] },
  { key: "description", label: "Description", synonyms: ["description", "details", "desc", "notes", "描述", "说明", "介绍"] },
  { key: "gst", label: "GST applies (yes/no)", synonyms: ["gst", "tax", "taxable", "gst applies", "gst free", "含税", "gst适用"] },
  { key: "featured", label: "Featured (yes/no)", synonyms: ["featured", "popular", "highlight", "推荐", "热门"] },
  { key: "active", label: "Show in shop (yes/no)", synonyms: ["active", "visible", "show in shop", "online", "enabled", "上架", "显示"] },
] as const;

export type ProductField = (typeof PRODUCT_FIELDS)[number]["key"];
export type ProductImportRow = Partial<Record<ProductField, string>>;
export type ProductMapping = Partial<Record<ProductField, number>>;

/** The values a row sets. Fields left out (empty cells) keep their current value on update. */
export type ProductValues = {
  sku: string;
  name?: string;
  priceCents?: number;
  category?: string;
  packSize?: string;
  unit?: string;
  minQty?: number;
  stock?: number;
  barcode?: string;
  description?: string;
  gst?: boolean;
  featured?: boolean;
  active?: boolean;
};

export type RowCheck = { ok: true; value: ProductValues } | { ok: false; error: string };

export const MAX_IMPORT_ROWS = 5000;

const norm = (s: string) => s.toLowerCase().replace(/[_\-.:#()（）/]+/g, " ").replace(/\s+/g, " ").trim();

export function guessProductMapping(headers: string[]): ProductMapping {
  return guessMapping(PRODUCT_FIELDS, headers);
}

/** Which spreadsheet column holds each field, guessed from the column names. */
export function guessMapping<K extends string>(fields: readonly { key: K; synonyms: readonly string[] }[], headers: string[]): Partial<Record<K, number>> {
  const mapping: Partial<Record<K, number>> = {};
  const used = new Set<number>();
  // Exact matches first, then "header contains synonym" (long or non-Latin synonyms only, to avoid false hits).
  for (const pass of ["exact", "contains"] as const) {
    for (const f of fields) {
      if (mapping[f.key] !== undefined) continue;
      const idx = headers.findIndex((h, i) => {
        if (used.has(i)) return false;
        const n = norm(h);
        return f.synonyms.some((s) => (pass === "exact" ? n === s : (s.length > 3 || /[^\x00-\x7f]/.test(s)) && n.includes(s)));
      });
      if (idx >= 0) {
        mapping[f.key] = idx;
        used.add(idx);
      }
    }
  }
  return mapping;
}

export function parseMoney(raw: string): number | null {
  const s = raw.replace(/aud|\$|\s/gi, "").replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function parseYesNo(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (["yes", "y", "true", "1", "x", "✓", "✔", "on", "是", "有", "对"].includes(s)) return true;
  if (["no", "n", "false", "0", "off", "-", "否", "无", "不"].includes(s)) return false;
  return null;
}

function parseWhole(raw: string): number | null {
  const s = raw.replace(/[,\s]/g, "");
  if (!/^\d+(\.0+)?$/.test(s)) return null;
  return Number(s);
}

/**
 * Checks one row. New products need SKU, name and price; for existing SKUs any subset updates.
 * `gstFree` columns ("GST free: yes") are flipped. With `pricesIncGst`, taxable prices are divided by 1.1.
 */
export function checkProductRow(row: ProductImportRow, opts: { pricesIncGst?: boolean; gstColumnHeader?: string } = {}): RowCheck {
  const v = (k: ProductField) => (row[k] ?? "").trim();
  const sku = v("sku").toUpperCase().replace(/\s+/g, "-");
  if (!sku) return { ok: false, error: "No SKU" };
  if (!/^[A-Z0-9._-]+$/.test(sku)) return { ok: false, error: `SKU "${v("sku")}" can only use letters, numbers, - . _` };
  if (sku.length > 64) return { ok: false, error: "SKU is longer than 64 characters" };

  const out: ProductValues = { sku };
  const text = (k: "name" | "category" | "packSize" | "unit" | "barcode" | "description", max: number) => {
    const t = v(k);
    if (t) out[k] = t.slice(0, max);
  };
  text("name", 200);
  text("category", 80);
  text("packSize", 80);
  text("unit", 30);
  text("barcode", 64);
  text("description", 4000);

  for (const k of ["minQty", "stock"] as const) {
    if (!v(k)) continue;
    const n = parseWhole(v(k));
    if (n === null) return { ok: false, error: `${k === "minQty" ? "Minimum order" : "Stock"} "${v(k)}" isn't a whole number` };
    out[k] = k === "minQty" ? Math.max(1, n) : n;
  }

  for (const k of ["gst", "featured", "active"] as const) {
    if (!v(k)) continue;
    const b = parseYesNo(v(k));
    if (b === null) return { ok: false, error: `${PRODUCT_FIELDS.find((f) => f.key === k)!.label.replace(/ \(.*/, "")} "${v(k)}" should be yes or no` };
    out[k] = k === "gst" && /free|免/.test((opts.gstColumnHeader ?? "").toLowerCase()) ? !b : b;
  }

  if (v("price")) {
    const cents = parseMoney(v("price"));
    if (cents === null) return { ok: false, error: `Price "${v("price")}" isn't an amount` };
    out.priceCents = opts.pricesIncGst && out.gst !== false ? Math.round(cents / (1 + GST_RATE)) : cents;
  }
  return { ok: true, value: out };
}

/** Rows whose SKU already appeared earlier in the file. Returns row index → first row index. */
export function duplicateSkus(rows: ProductImportRow[]) {
  const first = new Map<string, number>();
  const dupes = new Map<number, number>();
  rows.forEach((r, i) => {
    const sku = (r.sku ?? "").trim().toUpperCase().replace(/\s+/g, "-");
    if (!sku) return;
    if (first.has(sku)) dupes.set(i, first.get(sku)!);
    else first.set(sku, i);
  });
  return dupes;
}

const csvCell = (v: string | number | boolean | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const TEMPLATE_HEADERS = ["SKU", "Name", "Price", "Category", "Pack size", "Unit", "Min qty", "Stock", "Barcode", "Description", "GST", "Featured", "Active"];

export function toCsv(rows: (string | number | boolean | null | undefined)[][]) {
  // BOM so Excel opens UTF-8 (e.g. Chinese product names) correctly.
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

import "server-only";
import { eq, inArray } from "drizzle-orm";
import type { DB } from "./db";
import { products } from "./db/schema";
import { fillProductPhotosFromInvoices } from "./goods-photos";
import { checkProductRow, duplicateSkus, type ProductImportRow, type ProductValues } from "./product-import";
import { fillWaiting } from "./stock-allocation";
import { withStockContext } from "./stock-ledger";

export type ProductImportResult = { created: number; updated: number; errors: { row: number; message: string }[]; /** Products given the photo printed on an invoice. */ photos?: number };

/**
 * Creates new products and updates existing ones, matched by SKU. Empty cells leave the current
 * value alone. Every row is checked; nothing is saved if any row has a problem. `by` is who did
 * it, for the stock history (null from a script).
 */
export async function applyProductImport(
  db: DB,
  rows: ProductImportRow[],
  opts: { pricesIncGst: boolean; gstColumnHeader?: string },
  by: string | null,
): Promise<ProductImportResult> {
  const errors: ProductImportResult["errors"] = [];
  const values: ProductValues[] = [];
  const dupes = duplicateSkus(rows);
  rows.forEach((r, i) => {
    if (dupes.has(i)) return errors.push({ row: i + 2, message: `Same SKU as row ${dupes.get(i)! + 2}` });
    const c = checkProductRow(r, opts);
    if (c.ok) values.push(c.value);
    else errors.push({ row: i + 2, message: c.error });
  });

  const existing = new Set<string>();
  for (let i = 0; i < values.length; i += 500) {
    const skus = values.slice(i, i + 500).map((v) => v.sku);
    for (const r of await db.select({ sku: products.sku }).from(products).where(inArray(products.sku, skus))) existing.add(r.sku);
  }
  values.forEach((v) => {
    if (existing.has(v.sku)) return;
    const missing = [!v.name && "name", v.priceCents === undefined && "price"].filter(Boolean);
    if (missing.length) errors.push({ row: rows.findIndex((r) => (r.sku ?? "").trim().toUpperCase().replace(/\s+/g, "-") === v.sku) + 2, message: `New product ${v.sku} needs a ${missing.join(" and ")}` });
  });
  if (errors.length) return { created: 0, updated: 0, errors: errors.sort((a, b) => a.row - b.row) };

  const toCreate = values.filter((v) => !existing.has(v.sku));
  const toUpdate = values.filter((v) => existing.has(v.sku));
  await db.transaction(async (t) => withStockContext(t as unknown as DB, { type: "import", note: "Product import", by }, async (tx) => {
    for (let i = 0; i < toCreate.length; i += 200) {
      await tx.insert(products).values(
        toCreate.slice(i, i + 200).map((v) => ({
          sku: v.sku,
          name: v.name!,
          priceCents: v.priceCents!,
          category: v.category ?? "Other",
          packSize: v.packSize ?? "",
          unit: v.unit ?? "carton",
          minQty: v.minQty ?? 1,
          stock: v.stock ?? 0,
          barcode: v.barcode ?? null,
          description: v.description ?? "",
          gst: v.gst ?? true,
          featured: v.featured ?? false,
          active: v.active ?? true,
        })),
      );
    }
    const restocked: string[] = [];
    for (const { sku, ...set } of toUpdate) {
      if (!Object.keys(set).length) continue;
      const [row] = await tx.update(products).set({ ...set, updatedAt: new Date() }).where(eq(products.sku, sku)).returning({ id: products.id });
      if (row && set.stock !== undefined) restocked.push(row.id);
    }
    // Imported stock counts go to waiting customers first.
    await fillWaiting(tx, restocked);
  }));
  // New products without a photo take the one printed on an imported invoice, if there is one.
  const photos = await fillProductPhotosFromInvoices(db);
  return { created: toCreate.length, updated: toUpdate.length, errors: [], photos };
}

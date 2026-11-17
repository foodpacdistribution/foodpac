import "server-only";
import { eq, inArray } from "drizzle-orm";
import type { DB } from "./db";
import { products } from "./db/schema";
import { heldForOrders } from "./purchasing/inventory";
import { fillWaiting } from "./stock-allocation";
import { withStockContext } from "./stock-ledger";
import { parseCount, perCarton } from "./stock-units";

export type StocktakeLine = { sku: string; count: string };

export type StocktakeRow = {
  sku: string;
  count: string;
  /** Missing when the SKU isn't a product or the count can't be read. */
  product?: { id: string; name: string; unit: string; perCarton: number | null };
  error?: string;
  /** What was counted on the shelf, in the unit the product is sold by. */
  counted?: number;
  /** Loose packs of a product sold by the carton, which can't be kept as stock. */
  dropped?: number;
  /** Already sold to customers but not yet delivered, so still on the shelf. */
  reserved?: number;
  /** Free to sell after the count: counted less what's reserved. */
  newStock?: number;
  oldStock?: number;
  /** Counted less than customers are already owed. */
  short?: boolean;
};

/**
 * A stocktake: what was counted on the shelf for each product. Stock in this system is what's free
 * to sell, and goods for orders not yet delivered have already been taken off it, so the new stock
 * is the count less those. Without `apply` it only works out the changes; with it, it saves them as
 * stock counts in the ledger and passes any new stock to customers waiting for it.
 */
export async function stocktake(db: DB, lines: StocktakeLine[], opts: { apply: boolean; by?: string | null }) {
  const skus = [...new Set(lines.map((l) => l.sku.trim().toUpperCase()).filter(Boolean))];
  const found = skus.length
    ? await db
        .select({ id: products.id, sku: products.sku, name: products.name, unit: products.unit, packSize: products.packSize, stock: products.stock })
        .from(products)
        .where(inArray(products.sku, skus))
    : [];
  const bySku = new Map(found.map((p) => [p.sku.toUpperCase(), p]));
  const held = new Map((await heldForOrders(db)).map((h) => [h.id, Number(h.reserved) || 0]));

  const seen = new Set<string>();
  const rows: StocktakeRow[] = lines.map(({ sku, count }) => {
    const p = bySku.get(sku.trim().toUpperCase());
    if (!p) return { sku, count, error: "No product has this SKU" };
    const product = { id: p.id, name: p.name, unit: p.unit, perCarton: perCarton(p.packSize) };
    if (seen.has(p.id)) return { sku, count, product, error: "Counted twice in this list" };
    seen.add(p.id);
    const parsed = parseCount(count, product.perCarton, p.unit);
    if (!parsed.ok) return { sku, count, product, error: parsed.error };
    const reserved = held.get(p.id) ?? 0;
    const newStock = Math.max(0, parsed.units - reserved);
    return { sku, count, product, counted: parsed.units, dropped: parsed.dropped, reserved, newStock, oldStock: p.stock, short: parsed.units < reserved };
  });

  const changes = rows.filter((r) => !r.error && r.newStock !== r.oldStock);
  if (opts.apply && changes.length) {
    await withStockContext(db, { type: "count", note: "Stocktake", by: opts.by ?? null }, async (tx) => {
      for (const r of changes) await tx.update(products).set({ stock: r.newStock!, updatedAt: new Date() }).where(eq(products.id, r.product!.id));
      // More stock than before may be goods that waiting customers are owed.
      await fillWaiting(tx, changes.filter((r) => r.newStock! > r.oldStock!).map((r) => r.product!.id));
    });
  }
  return { rows, changed: changes.length };
}

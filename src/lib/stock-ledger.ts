import "server-only";
import { eq, sql } from "drizzle-orm";
import type { DB } from "./db";
import { type MovementType, products } from "./db/schema";

// products.stock is only ever changed through here (or by the purchasing triggers in the
// database). A trigger on products writes every change to inventory_movements; this says *why*,
// through the transaction-local setting app.stock_ctx the trigger reads.

export type StockContext = {
  type: MovementType;
  refType?: string;
  refId?: string;
  refNumber?: string;
  note?: string;
  by?: string | null;
};

/** Runs `fn` with the ledger told why stock is changing. Nested in a caller's transaction it becomes a savepoint. */
export async function withStockContext<T>(db: DB, ctx: StockContext, fn: (tx: DB) => Promise<T>): Promise<T> {
  return db.transaction(async (t) => {
    const tx = t as unknown as DB;
    await tx.execute(sql`select set_config('app.stock_ctx', ${JSON.stringify(ctx)}, true)`);
    const r = await fn(tx);
    // Don't let the reason leak onto a later change in the same transaction.
    await tx.execute(sql`select set_config('app.stock_ctx', '', true)`);
    return r;
  });
}

/** Adds `delta` (negative takes away) to a product's stock. `floorZero` stops it going below zero. Returns the new stock. */
export async function changeStock(db: DB, productId: string, delta: number, ctx: StockContext, opts: { floorZero?: boolean } = {}) {
  if (!delta) return null;
  return withStockContext(db, ctx, async (tx) => {
    const [row] = await tx
      .update(products)
      .set({ stock: opts.floorZero ? sql`greatest(0, ${products.stock} + ${delta})` : sql`${products.stock} + ${delta}` })
      .where(eq(products.id, productId))
      .returning({ stock: products.stock, name: products.name });
    return row ?? null;
  });
}

/** Sets a product's stock to a counted figure (stocktake, product form). */
export async function setStock(db: DB, productId: string, stock: number, ctx: StockContext) {
  return withStockContext(db, ctx, async (tx) => {
    const [row] = await tx.update(products).set({ stock }).where(eq(products.id, productId)).returning({ stock: products.stock });
    return row ?? null;
  });
}

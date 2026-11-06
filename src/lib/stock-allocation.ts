import "server-only";
import { and, asc, eq, gt, inArray, ne } from "drizzle-orm";
import type { DB } from "./db";
import { customers, products, salesOrderItems, salesOrders } from "./db/schema";
import { changeStock, type StockContext } from "./stock-ledger";

// Stock on a product is what's free to sell. An order reserves from it; anything staff order
// beyond it is kept on the order line as "waiting for stock" (backorderQty), and goods received
// later go to those waiting lines first, oldest order first. Stock itself never goes below zero.
// Every change goes through stock-ledger.ts, so the stock ledger says which order it was for.

/** Which sales order a stock change was for, as far as it's known (a new order has no number yet). */
export type SaleRef = { id?: string; number?: string; note?: string; by?: string | null };

const saleCtx = (type: "sale_reserved" | "sale_released", ref?: SaleRef): StockContext => ({
  type,
  ...(ref?.id || ref?.number ? { refType: "sales_order", refId: ref.id, refNumber: ref.number } : {}),
  note: ref?.note,
  by: ref?.by,
});

/** Takes up to `qty` from stock. Returns how many were reserved and how many have to wait. */
export async function reserveStock(tx: DB, productId: string, qty: number, ref?: SaleRef) {
  if (qty <= 0) return { reserved: 0, short: 0 };
  const [p] = await tx.select({ stock: products.stock }).from(products).where(eq(products.id, productId)).for("update");
  const reserved = Math.min(qty, Math.max(0, p?.stock ?? 0));
  if (reserved > 0) await changeStock(tx, productId, -reserved, saleCtx("sale_reserved", ref));
  return { reserved, short: qty - reserved };
}

/** Puts reserved units back on the shelf (cancelled or reduced orders). Call fillWaiting afterwards. */
export async function returnStock(tx: DB, productId: string, qty: number, ref?: SaleRef) {
  if (qty > 0) await changeStock(tx, productId, qty, saleCtx("sale_released", ref));
}

export type Filled = { productId: string; orderId: string; number: string; customer: string; qty: number };

/**
 * Hands free stock to orders waiting for it, oldest first, and returns who got what. Run after
 * anything that adds stock: goods received, a cancelled order, a reduced quantity.
 */
export async function fillWaiting(tx: DB, productIds: (string | null)[]): Promise<Filled[]> {
  const ids = [...new Set(productIds.filter((x): x is string => !!x))];
  const filled: Filled[] = [];
  for (const productId of ids) {
    const [p] = await tx.select({ stock: products.stock }).from(products).where(eq(products.id, productId)).for("update");
    let free = p?.stock ?? 0;
    if (free <= 0) continue;
    const waiting = await tx
      .select({ id: salesOrderItems.id, waiting: salesOrderItems.backorderQty, orderId: salesOrders.id, number: salesOrders.number, customer: customers.name })
      .from(salesOrderItems)
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.salesOrderId))
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(and(eq(salesOrderItems.productId, productId), gt(salesOrderItems.backorderQty, 0), ne(salesOrders.status, "cancelled")))
      .orderBy(asc(salesOrders.createdAt), asc(salesOrderItems.id));
    for (const w of waiting) {
      if (free <= 0) break;
      const n = Math.min(free, w.waiting);
      await tx.update(salesOrderItems).set({ backorderQty: w.waiting - n }).where(eq(salesOrderItems.id, w.id));
      await changeStock(tx, productId, -n, saleCtx("sale_reserved", { id: w.orderId, number: w.number, note: `Waiting order filled · ${w.customer}` }));
      free -= n;
      filled.push({ productId, orderId: w.orderId, number: w.number, customer: w.customer, qty: n });
    }
  }
  return filled;
}

/** Everyone waiting for stock, by product: which customer, which order, how many. */
export async function listWaiting(db: DB, productIds?: string[]) {
  return db
    .select({
      productId: salesOrderItems.productId,
      qty: salesOrderItems.backorderQty,
      orderId: salesOrders.id,
      number: salesOrders.number,
      customer: customers.name,
      phone: customers.phone,
      deliveryDate: salesOrders.deliveryDate,
      createdAt: salesOrders.createdAt,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(
      and(
        gt(salesOrderItems.backorderQty, 0),
        ne(salesOrders.status, "cancelled"),
        ...(productIds ? [inArray(salesOrderItems.productId, productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"])] : []),
      ),
    )
    .orderBy(asc(salesOrders.createdAt));
}

/** "3 went to waiting orders (Lucky Noodle Bar FP-10012)" for a stock message. */
export function describeFilled(filled: Filled[]) {
  if (!filled.length) return "";
  const n = filled.reduce((t, f) => t + f.qty, 0);
  const who = [...new Set(filled.map((f) => `${f.customer} ${f.number}`))].join(", ");
  return `${n} went to waiting orders (${who})`;
}

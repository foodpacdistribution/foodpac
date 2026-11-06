import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "../db";
import { inventoryMovements, type MovementType, orders, users, products, purchaseOrderItems, purchaseOrders, purchaseReturnItems, purchaseReturns, salesOrderItems, salesOrders } from "../db/schema";

/**
 * Stock by product. `stock` is free to sell (the figure the shop uses); `reserved` is held for
 * confirmed customer orders not yet delivered, so on hand = stock + reserved. `onOrder` is still
 * to come from suppliers; `toReturn` is accepted by a supplier but not yet sent back.
 */
export async function stockOverview(db: DB) {
  const [rows, reserved, onOrder, toReturn] = await Promise.all([
    db
      .select({ id: products.id, sku: products.sku, name: products.name, unit: products.unit, category: products.category, stock: products.stock, active: products.active })
      .from(products)
      .orderBy(asc(products.category), asc(products.name)),
    db
      .select({
        id: salesOrderItems.productId,
        reserved: sql<number>`sum(${salesOrderItems.qty} - ${salesOrderItems.backorderQty})::int`,
        waiting: sql<number>`sum(${salesOrderItems.backorderQty})::int`,
      })
      .from(salesOrderItems)
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.salesOrderId))
      .leftJoin(orders, eq(orders.id, salesOrders.deliveryOrderId))
      .where(and(inArray(salesOrders.status, ["pending", "confirmed"]), sql`coalesce(${orders.status}, '') <> 'delivered'`))
      .groupBy(salesOrderItems.productId),
    db
      .select({ id: purchaseOrderItems.productId, qty: sql<number>`sum(${purchaseOrderItems.orderedQty} - ${purchaseOrderItems.receivedQty})::float8` })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
      .where(inArray(purchaseOrders.status, ["sent", "confirmed", "partially_received"]))
      .groupBy(purchaseOrderItems.productId),
    db
      .select({ id: purchaseReturnItems.productId, qty: sql<number>`sum(coalesce(${purchaseReturnItems.acceptedQty}, 0))::float8` })
      .from(purchaseReturnItems)
      .innerJoin(purchaseReturns, eq(purchaseReturns.id, purchaseReturnItems.purchaseReturnId))
      .where(eq(purchaseReturns.status, "open"))
      .groupBy(purchaseReturnItems.productId),
  ]);
  const by = <T extends { id: string | null }>(list: T[]) => new Map(list.filter((x) => x.id).map((x) => [x.id!, x]));
  const r = by(reserved);
  const o = by(onOrder);
  const t = by(toReturn);
  return rows.map((p) => ({
    ...p,
    reserved: Number(r.get(p.id)?.reserved ?? 0),
    waiting: Number(r.get(p.id)?.waiting ?? 0),
    onOrder: Number(o.get(p.id)?.qty ?? 0),
    toReturn: Number(t.get(p.id)?.qty ?? 0),
  }));
}

export async function movements(db: DB, f: { productId?: string; type?: MovementType; from?: string; to?: string; limit?: number }) {
  const rows = await db
    .select({ m: inventoryMovements, by: users.name })
    .from(inventoryMovements)
    .leftJoin(users, eq(users.id, inventoryMovements.createdBy))
    .where(
      and(
        f.productId ? eq(inventoryMovements.productId, f.productId) : undefined,
        f.type ? eq(inventoryMovements.movementType, f.type) : undefined,
        f.from ? gte(inventoryMovements.createdAt, sql`${f.from}::date`) : undefined,
        f.to ? lte(inventoryMovements.createdAt, sql`(${f.to}::date + 1)`) : undefined,
      ),
    )
    .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
    .limit(f.limit ?? 300);
  return rows.map((r) => ({ ...r.m, by: r.by }));
}

import "server-only";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { DB } from "./db";
import { products, salesOrderItems, salesOrders } from "./db/schema";

// "Worth offering": products a customer doesn't buy from us yet but stores like them do. Stores
// are alike when they buy the same things; the more they share, the more their other products
// count. A customer with no orders yet gets what sells to the most stores.

export type Suggestion = {
  productId: string;
  /** How many of the alike stores buy it (or, with no history, how many stores in all). */
  stores: number;
  /** How many alike stores there are, to put `stores` in proportion (0 when there's no history). */
  of: number;
};

/** The pure part, for testing: who bought what → what to offer `customerId`. */
export function suggest(bought: { customerId: string; productId: string }[], customerId: string, limit: number): Suggestion[] {
  const by = new Map<string, Set<string>>();
  for (const r of bought) {
    if (!by.has(r.customerId)) by.set(r.customerId, new Set());
    by.get(r.customerId)!.add(r.productId);
  }
  const mine = by.get(customerId) ?? new Set<string>();
  const score = new Map<string, number>();
  const stores = new Map<string, number>();
  let alike = 0;
  for (const [other, theirs] of by) {
    if (other === customerId) continue;
    let shared = 0;
    for (const p of theirs) if (mine.has(p)) shared++;
    // No history: every store counts the same. Otherwise only stores with something in common
    // (two things, once there's enough to go on), weighted by how much they share.
    const weight = mine.size === 0 ? 1 : shared >= Math.min(2, mine.size) ? shared / Math.sqrt(theirs.size) : 0;
    if (!weight) continue;
    alike++;
    for (const p of theirs) {
      if (mine.has(p)) continue;
      score.set(p, (score.get(p) ?? 0) + weight);
      stores.set(p, (stores.get(p) ?? 0) + 1);
    }
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || stores.get(b[0])! - stores.get(a[0])! || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([productId]) => ({ productId, stores: stores.get(productId)!, of: mine.size === 0 ? 0 : alike }));
}

/** What to offer this customer next, from the last year of orders (products still on sale only). */
export async function worthOffering(db: DB, customerId: string, limit = 6) {
  const bought = await db
    .selectDistinct({ customerId: salesOrders.customerId, productId: sql<string>`${salesOrderItems.productId}` })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.salesOrderId))
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .where(and(ne(salesOrders.status, "cancelled"), isNotNull(salesOrderItems.productId), eq(products.active, true), sql`${salesOrders.createdAt} > now() - interval '365 days'`));
  return suggest(bought, customerId, limit);
}

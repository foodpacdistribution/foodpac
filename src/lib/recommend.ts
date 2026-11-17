import "server-only";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { DB } from "./db";
import { customers, products, salesOrderItems, salesOrders } from "./db/schema";

// "Worth offering": products a customer doesn't buy from us yet but stores like them do. Stores
// are alike when they buy the same things; the more they share, the more their other products
// count, and a little more again when they're the same kind of business. A customer with no
// orders yet gets what stores of its kind buy most (or, with none to go on, what sells to the
// most stores).

export type Suggestion = {
  productId: string;
  /** How many of the alike stores buy it (or, with no history, how many stores in all). */
  stores: number;
  /** How many alike stores there are, to put `stores` in proportion (0 when there's no history). */
  of: number;
  /** Stores that buy what this one buys; stores of its kind (no orders yet); or all stores. */
  basis: "alike" | "type" | "all";
};

/** How much more a store of the same kind counts, among stores that buy alike. */
const SAME_TYPE_WEIGHT = 1.5;

/** The pure part, for testing: who bought what → what to offer `customerId`. `peers`: stores of the same kind. */
export function suggest(bought: { customerId: string; productId: string }[], customerId: string, limit: number, peers: Set<string> = new Set()): Suggestion[] {
  const by = new Map<string, Set<string>>();
  for (const r of bought) {
    if (!by.has(r.customerId)) by.set(r.customerId, new Set());
    by.get(r.customerId)!.add(r.productId);
  }
  const mine = by.get(customerId) ?? new Set<string>();
  // No orders yet: stores of the same kind, when any of them buy from us.
  const byType = mine.size === 0 && [...by.keys()].some((id) => id !== customerId && peers.has(id));
  const basis: Suggestion["basis"] = mine.size > 0 ? "alike" : byType ? "type" : "all";
  const score = new Map<string, number>();
  const stores = new Map<string, number>();
  let alike = 0;
  for (const [other, theirs] of by) {
    if (other === customerId) continue;
    let shared = 0;
    for (const p of theirs) if (mine.has(p)) shared++;
    // No history: every store counts the same. Otherwise only stores with something in common
    // (two things, once there's enough to go on), weighted by how much they share.
    const weight =
      basis === "type" ? (peers.has(other) ? 1 : 0)
      : basis === "all" ? 1
      : shared >= Math.min(2, mine.size) ? (shared / Math.sqrt(theirs.size)) * (peers.has(other) ? SAME_TYPE_WEIGHT : 1)
      : 0;
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
    .map(([productId]) => ({ productId, stores: stores.get(productId)!, of: basis === "all" ? 0 : alike, basis }));
}

/** What to offer this customer next, from the last year of orders (products still on sale only). */
export async function worthOffering(db: DB, customerId: string, limit = 6) {
  const [me] = await db.select({ type: customers.storeType }).from(customers).where(eq(customers.id, customerId)).limit(1);
  const peers = me?.type ? new Set((await db.select({ id: customers.id }).from(customers).where(eq(customers.storeType, me.type))).map((r) => r.id)) : new Set<string>();
  const bought = await db
    .selectDistinct({ customerId: salesOrders.customerId, productId: sql<string>`${salesOrderItems.productId}` })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.salesOrderId))
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .where(and(ne(salesOrders.status, "cancelled"), isNotNull(salesOrderItems.productId), eq(products.active, true), sql`${salesOrders.createdAt} > now() - interval '365 days'`));
  return suggest(bought, customerId, limit, peers);
}

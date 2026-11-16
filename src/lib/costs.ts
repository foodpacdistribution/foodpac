import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { shiftDate } from "./dates";
import type { DB } from "./db";
import { goodsReceiptItems, goodsReceipts, products, purchaseOrderItems, purchaseOrders } from "./db/schema";

// What a product costs us, per sale unit, in cents ex GST, for margins and "below cost" warnings.
// Purchase lines are in the product's own unit, so their unit costs compare with sale prices.
//
//  1. received: the average cost of the goods received over the last year (weighted by quantity),
//     or of everything ever received if nothing came in this year;
//  2. manual: the cost typed in on the product;
//  3. ordered: the price on the latest purchase order.
//
// Margins use today's cost for past sales too: close enough for deciding what to sell and at what
// price, and it needs no cost history.

export type CostSource = "received" | "manual" | "ordered";
export type Cost = { cents: number; source: CostSource };

/** How far back received goods count towards the average cost. */
const RECENT_DAYS = 365;

/** Costs of the given products (all of them when `ids` is left out). Products with no cost are missing. */
export async function productCosts(db: DB, today: string, ids?: string[]): Promise<Map<string, Cost>> {
  const out = new Map<string, Cost>();
  if (ids && !ids.length) return out;
  const since = shiftDate(today, -RECENT_DAYS);
  const recent = sql`${goodsReceipts.receiptDate} >= ${since}`;
  const [received, manual, ordered] = await Promise.all([
    db
      .select({
        productId: goodsReceiptItems.productId,
        recent: sql<string | null>`sum(${goodsReceiptItems.receivedQty} * ${goodsReceiptItems.unitCost}) filter (where ${recent}) / nullif(sum(${goodsReceiptItems.receivedQty}) filter (where ${recent}), 0)`,
        ever: sql<string | null>`sum(${goodsReceiptItems.receivedQty} * ${goodsReceiptItems.unitCost}) / nullif(sum(${goodsReceiptItems.receivedQty}), 0)`,
      })
      .from(goodsReceiptItems)
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptItems.goodsReceiptId))
      .where(
        and(
          eq(goodsReceipts.status, "posted"),
          gt(goodsReceiptItems.receivedQty, 0),
          isNotNull(goodsReceiptItems.productId),
          ids ? inArray(goodsReceiptItems.productId, ids) : undefined,
        ),
      )
      .groupBy(goodsReceiptItems.productId),
    db
      .select({ productId: products.id, cents: products.costCents })
      .from(products)
      .where(and(isNotNull(products.costCents), ids ? inArray(products.id, ids) : undefined)),
    db
      .selectDistinctOn([purchaseOrderItems.productId], { productId: purchaseOrderItems.productId, unitCost: purchaseOrderItems.unitCost })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
      .where(
        and(
          notInArray(purchaseOrders.status, ["draft", "cancelled"]),
          isNotNull(purchaseOrderItems.productId),
          ids ? inArray(purchaseOrderItems.productId, ids) : undefined,
        ),
      )
      .orderBy(purchaseOrderItems.productId, desc(purchaseOrders.orderDate), desc(purchaseOrders.createdAt)),
  ]);
  for (const o of ordered) if (o.productId) out.set(o.productId, { cents: Number(o.unitCost) * 100, source: "ordered" });
  for (const m of manual) if (m.cents !== null) out.set(m.productId, { cents: m.cents, source: "manual" });
  for (const r of received) {
    const avg = r.recent ?? r.ever;
    if (r.productId && avg !== null) out.set(r.productId, { cents: Number(avg) * 100, source: "received" });
  }
  return out;
}

/** Gross margin as a whole percentage of the price, or null with nothing to go on. */
export function marginPct(priceCents: number, costCents: number) {
  return priceCents > 0 ? Math.round(((priceCents - costCents) / priceCents) * 100) : null;
}

/**
 * Profit on sold lines: what was sold with a known cost, its cost, and what was sold with no
 * cost (left out of the margin rather than counted as pure profit).
 */
export function profitOf(lines: { productId: string | null; qty: number; cents: number }[], costs: Map<string, Cost>) {
  let soldCents = 0;
  let costCents = 0;
  let uncostedCents = 0;
  for (const l of lines) {
    const c = l.productId ? costs.get(l.productId) : undefined;
    if (!c) {
      uncostedCents += l.cents;
      continue;
    }
    soldCents += l.cents;
    costCents += c.cents * l.qty;
  }
  const profitCents = Math.round(soldCents - costCents);
  return { soldCents, costCents: Math.round(costCents), profitCents, uncostedCents, marginPct: soldCents > 0 ? Math.round((profitCents / soldCents) * 100) : null };
}

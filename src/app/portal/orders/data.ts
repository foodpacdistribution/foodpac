import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { salesOrderItems, salesOrders } from "@/lib/db/schema";
import { deliveryStatuses } from "@/lib/portal";

/** A customer's purchases with item counts and the delivery stage of each. */
export async function listSalesOrders(db: DB, customerId: string, limit = 100) {
  const rows = await db
    .select({
      so: salesOrders,
      items: sql<number>`(select coalesce(sum(soi.qty), 0)::int from ${salesOrderItems} soi where soi.sales_order_id = ${salesOrders}.id)`,
      lines: sql<number>`(select count(*)::int from ${salesOrderItems} soi where soi.sales_order_id = ${salesOrders}.id)`,
    })
    .from(salesOrders)
    .where(eq(salesOrders.customerId, customerId))
    .orderBy(desc(salesOrders.createdAt))
    .limit(limit);
  const delivery = await deliveryStatuses(db, rows.map((r) => r.so.deliveryOrderId).filter((x): x is string => !!x));
  return rows.map(({ so, items, lines }) => ({ ...so, items, lines, delivery: so.deliveryOrderId ? (delivery.get(so.deliveryOrderId) ?? null) : null }));
}

/** The customer's latest order that wasn't cancelled, for "order the same again". */
export async function lastOrder(db: DB, customerId: string) {
  const [row] = await db
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      createdAt: salesOrders.createdAt,
      totalCents: salesOrders.totalCents,
      products: sql<number>`(select count(*)::int from ${salesOrderItems} soi where soi.sales_order_id = ${salesOrders}.id)`,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.customerId, customerId), ne(salesOrders.status, "cancelled")))
    .orderBy(desc(salesOrders.createdAt))
    .limit(1);
  return row ?? null;
}

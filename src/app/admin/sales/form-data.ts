import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { customerPrices, customers, products, salesOrderItems } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { deliveryDates } from "@/lib/shop";
import { listWaiting } from "@/lib/stock-allocation";
import { shiftDate } from "@/lib/dates";
import { todayIn } from "@/lib/time";
import type { FormCustomer, FormProduct } from "./order-form";

/** Everything the order form needs: customers, products with stock and who's waiting, prices, fees. */
export async function orderFormData(db: DB, opts: { customerId?: string } = {}) {
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const [custRows, productRows, priceRows, waiting] = await Promise.all([
    db
      .select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email, address: customers.address, paymentTerms: customers.paymentTerms, approved: customers.approved, active: customers.active })
      .from(customers)
      .orderBy(asc(customers.name)),
    db
      .select({ id: products.id, sku: products.sku, name: products.name, packSize: products.packSize, unit: products.unit, priceCents: products.priceCents, gst: products.gst, stock: products.stock, minQty: products.minQty, active: products.active })
      .from(products)
      .orderBy(sql`${products.active} desc`, asc(products.name)),
    db
      .select({ customerId: customerPrices.customerId, productId: customerPrices.productId, priceCents: customerPrices.priceCents })
      .from(customerPrices)
      .where(opts.customerId ? eq(customerPrices.customerId, opts.customerId) : undefined),
    listWaiting(db),
  ]);
  const prices: Record<string, Record<string, number>> = {};
  for (const r of priceRows) (prices[r.customerId] ??= {})[r.productId] = r.priceCents;
  const waitingBy = new Map<string, number>();
  for (const w of waiting) if (w.productId) waitingBy.set(w.productId, (waitingBy.get(w.productId) ?? 0) + w.qty);
  return {
    today,
    defaultDate: deliveryDates(s)[0] ?? shiftDate(today, 1),
    fees: { deliveryFeeCents: s.deliveryFeeCents, freeDeliveryOverCents: s.freeDeliveryOverCents },
    customers: custRows.filter((c) => c.active || c.id === opts.customerId) satisfies FormCustomer[],
    products: productRows.map((p) => ({ ...p, waiting: waitingBy.get(p.id) ?? 0 })) satisfies FormProduct[],
    prices,
  };
}

/** Stock an order already holds per product (ordered minus still waiting). */
export async function reservedBy(db: DB, salesOrderId: string) {
  const items = await db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, salesOrderId));
  const reserved: Record<string, number> = {};
  for (const it of items) if (it.productId) reserved[it.productId] = (reserved[it.productId] ?? 0) + it.qty - it.backorderQty;
  return { items, reserved };
}


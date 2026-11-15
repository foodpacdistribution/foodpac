import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/dal";
import type { DB } from "@/lib/db";
import { customerCreditAccounts, customerPrices, customers, products, salesOrderItems } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { deliveryDates } from "@/lib/shop";
import { myCustomers } from "@/lib/rep-scope";
import { openOffer } from "@/lib/first-order-offer";
import { listWaiting } from "@/lib/stock-allocation";
import { shiftDate } from "@/lib/dates";
import { todayIn } from "@/lib/time";
import type { FormCustomer, FormProduct } from "./order-form";

/**
 * Everything the order form needs: customers, products with stock and who's waiting, prices, fees.
 * For sales staff (`user`), only the customers they may quote and take orders for.
 */
export async function orderFormData(db: DB, opts: { customerId?: string; user?: Pick<CurrentUser, "id" | "role"> } = {}) {
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const [custRows, productRows, priceRows, waiting, creditRows] = await Promise.all([
    db
      .select({
        id: customers.id,
        code: customers.code,
        name: customers.name,
        phone: customers.phone,
        email: customers.email,
        address: customers.address,
        paymentTerms: customers.paymentTerms,
        approved: customers.approved,
        active: customers.active,
        firstOrderMinCents: customers.firstOrderMinCents,
        firstOrderOffCents: customers.firstOrderOffCents,
        firstOrderOfferOrderId: customers.firstOrderOfferOrderId,
      })
      .from(customers)
      .where(opts.user ? myCustomers(opts.user) : undefined)
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
    db.select({ customerId: customerCreditAccounts.customerId, balance: customerCreditAccounts.balance }).from(customerCreditAccounts),
  ]);
  /** Store credit each customer can spend, in cents. */
  const credits: Record<string, number> = {};
  for (const c of creditRows) if (c.balance > 0) credits[c.customerId] = Math.round(c.balance * 100);
  const prices: Record<string, Record<string, number>> = {};
  for (const r of priceRows) (prices[r.customerId] ??= {})[r.productId] = r.priceCents;
  const waitingBy = new Map<string, number>();
  for (const w of waiting) if (w.productId) waitingBy.set(w.productId, (waitingBy.get(w.productId) ?? 0) + w.qty);
  return {
    today,
    defaultDate: deliveryDates(s)[0] ?? shiftDate(today, 1),
    fees: { deliveryFeeCents: s.deliveryFeeCents, freeDeliveryOverCents: s.freeDeliveryOverCents },
    customers: custRows
      .filter((c) => c.active || c.id === opts.customerId)
      .map(({ firstOrderMinCents, firstOrderOffCents, firstOrderOfferOrderId, ...c }) => ({
        ...c,
        firstOrderOffer: openOffer({ id: c.id, firstOrderMinCents, firstOrderOffCents, firstOrderOfferOrderId }),
      })) satisfies FormCustomer[],
    products: productRows.map((p) => ({ ...p, waiting: waitingBy.get(p.id) ?? 0 })) satisfies FormProduct[],
    prices,
    credits,
  };
}

/** Stock an order already holds per product (ordered minus still waiting). */
export async function reservedBy(db: DB, salesOrderId: string) {
  const items = await db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, salesOrderId));
  const reserved: Record<string, number> = {};
  for (const it of items) if (it.productId) reserved[it.productId] = (reserved[it.productId] ?? 0) + it.qty - it.backorderQty;
  return { items, reserved };
}


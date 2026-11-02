import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { DB } from "./db";
import { orders } from "./db/schema";

const digits = (v: string | null) => (v ?? "").replace(/\D/g, "");

/**
 * Links unlinked orders to a customer when the order's customer name matches exactly
 * (ignoring case and spacing) or its phone number matches (last 9 digits, so +61 4xx and
 * 04xx are the same). Runs when a customer is saved and when they open the portal, so
 * orders from imports, the API and feeds show up without extra work.
 */
export async function linkOrdersToCustomer(db: DB, c: { id: string; name: string; phone: string | null }) {
  const name = c.name.trim().toLowerCase().replace(/\s+/g, " ");
  const phone = digits(c.phone).slice(-9);
  const byName = sql`lower(regexp_replace(trim(${orders.customerName}), '\\s+', ' ', 'g')) = ${name}`;
  const byPhone = sql`right(regexp_replace(coalesce(${orders.phone}, ''), '\\D', '', 'g'), 9) = ${phone}`;
  await db
    .update(orders)
    .set({ customerId: c.id })
    .where(and(isNull(orders.customerId), phone.length >= 8 ? or(byName, byPhone) : byName));
}

export async function unlinkCustomerOrders(db: DB, customerId: string) {
  await db.update(orders).set({ customerId: null }).where(eq(orders.customerId, customerId));
}

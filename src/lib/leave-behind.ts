import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { signingKey } from "./auth/session";
import type { DB } from "./db";
import { customers, products, salesOrderItems, salesOrders, users } from "./db/schema";

// The sales leave-behind: a printed page a salesperson leaves at a store, whose QR code opens
// the sign-up form. The code carries a short signed reference: who left it, and (when printed
// from a store's own page) which store, so the sign-up joins that store's record and is looked
// after by that salesperson. Kept short so the QR stays coarse and scans from a phone easily.

const ID8 = /^[0-9a-f]{8}$/;

function sign(repId: string, customerId: string | null) {
  return createHmac("sha256", signingKey()).update(`leave-behind:${repId}:${customerId ?? ""}`).digest("base64url").slice(0, 12);
}

/** "abcd1234" (the salesperson), plus "ef567890" (the store) when there is one, ".", signature. */
export function leaveBehindRef(repId: string, customerId: string | null = null) {
  return `${repId.slice(0, 8)}${customerId ? customerId.slice(0, 8) : ""}.${sign(repId, customerId)}`;
}

export type LeaveBehindRef = { rep: { id: string; name: string }; customer: { id: string; name: string; hasLogin: boolean } | null };

/** Who a reference is from (and for), or null when it isn't one of ours. */
export async function readLeaveBehindRef(db: DB, ref: string | null | undefined): Promise<LeaveBehindRef | null> {
  const m = /^([0-9a-f]{8})([0-9a-f]{8})?\.([A-Za-z0-9_-]{12})$/.exec(ref?.trim() ?? "");
  if (!m || !ID8.test(m[1])) return null;
  const [, rep8, cust8, sig] = m;
  const reps = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(sql`${users.id}::text like ${`${rep8}%`}`, inArray(users.role, ["sales", "admin", "dispatcher"])));
  const found = cust8 ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(sql`${customers.id}::text like ${`${cust8}%`}`) : [];
  const logins = found.length ? await db.select({ customerId: users.customerId }).from(users).where(inArray(users.customerId, found.map((c) => c.id))) : [];
  const stores = cust8 ? found.map((c) => ({ ...c, login: logins.some((l) => l.customerId === c.id) ? c.id : null })) : [null];
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  // Eight characters of an id are as good as unique here; any clash is settled by the signature.
  for (const r of reps) {
    for (const c of stores) {
      if (same(sign(r.id, c?.id ?? null), sig)) return { rep: r, customer: c ? { id: c.id, name: c.name, hasLogin: c.login !== null } : null };
    }
  }
  return null;
}

/**
 * Products to show on the page by default: what sells to the most stores over the last year,
 * in stock and with a photo first.
 */
export async function popularProducts(db: DB, limit: number) {
  const stores = sql<number>`count(distinct ${salesOrders.customerId})`;
  return db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      packSize: products.packSize,
      category: products.category,
      hasImage: sql<boolean>`${products.image} is not null`,
      stores: sql<number>`coalesce(${stores}, 0)::int`,
    })
    .from(products)
    .leftJoin(salesOrderItems, eq(salesOrderItems.productId, products.id))
    .leftJoin(salesOrders, and(eq(salesOrders.id, salesOrderItems.salesOrderId), ne(salesOrders.status, "cancelled"), sql`${salesOrders.createdAt} > now() - interval '365 days'`))
    .where(eq(products.active, true))
    .groupBy(products.id)
    .orderBy(sql`${products.image} is null`, sql`${products.stock} <= 0`, sql`${stores} desc`, products.name)
    .limit(limit);
}

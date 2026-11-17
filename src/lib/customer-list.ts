import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "./db";
import { customerPrices, favourites, products, users } from "./db/schema";
import { UserError } from "./planning";

// A customer's list ("My list" in their portal), set up by staff: the products they'll order and
// how many, so on first sign-in it's all there at their prices, ready to add to the cart.

export type ListItem = {
  productId: string;
  sku: string;
  name: string;
  packSize: string;
  unit: string;
  minQty: number;
  stock: number;
  active: boolean;
  qty: number | null;
  /** Their price: their own, or list. */
  priceCents: number;
  listCents: number;
  addedByName: string | null;
  /** Put there by the customer themselves. */
  byCustomer: boolean;
};

export async function customerList(db: DB, customerId: string): Promise<ListItem[]> {
  const rows = await db
    .select({
      productId: products.id,
      sku: products.sku,
      name: products.name,
      packSize: products.packSize,
      unit: products.unit,
      minQty: products.minQty,
      stock: products.stock,
      active: products.active,
      qty: favourites.qty,
      listCents: products.priceCents,
      ownCents: customerPrices.priceCents,
      addedBy: favourites.addedBy,
      addedByName: users.name,
    })
    .from(favourites)
    .innerJoin(products, eq(products.id, favourites.productId))
    .leftJoin(customerPrices, and(eq(customerPrices.customerId, favourites.customerId), eq(customerPrices.productId, favourites.productId)))
    .leftJoin(users, eq(users.id, favourites.addedBy))
    .where(eq(favourites.customerId, customerId))
    .orderBy(desc(favourites.createdAt));
  return rows.map(({ ownCents, addedBy, ...r }) => ({ ...r, priceCents: ownCents ?? r.listCents, byCustomer: addedBy === null }));
}

const checkQty = (qty: number | null) => {
  if (qty !== null && (!Number.isInteger(qty) || qty < 1 || qty > 9999)) throw new UserError("Quantity must be a whole number from 1 to 9999.");
  return qty;
};

/** Puts products on the list (a quantity given replaces the one there). Products no longer on sale are skipped. */
export async function addToList(db: DB, by: { id: string }, customerId: string, items: { productId: string; qty: number | null }[]) {
  if (!items.length) throw new UserError("Choose at least one product.");
  if (items.length > 500) throw new UserError("Add at most 500 products at a time.");
  items.forEach((i) => checkQty(i.qty));
  const ok = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.active, true), inArray(products.id, items.map((i) => i.productId))));
  const live = new Set(ok.map((p) => p.id));
  const rows = items.filter((i) => live.has(i.productId));
  if (!rows.length) throw new UserError("Those products aren't on sale.");
  for (const i of rows) {
    const insert = db.insert(favourites).values({ customerId, productId: i.productId, qty: i.qty, addedBy: by.id });
    await (i.qty === null ? insert.onConflictDoNothing() : insert.onConflictDoUpdate({ target: [favourites.customerId, favourites.productId], set: { qty: i.qty } }));
  }
  return rows.length;
}

export async function setListQty(db: DB, customerId: string, productId: string, qty: number | null) {
  checkQty(qty);
  const r = await db
    .update(favourites)
    .set({ qty })
    .where(and(eq(favourites.customerId, customerId), eq(favourites.productId, productId)))
    .returning({ productId: favourites.productId });
  if (!r.length) throw new UserError("That product isn't on their list any more.");
}

export async function removeFromList(db: DB, customerId: string, productId: string) {
  await db.delete(favourites).where(and(eq(favourites.customerId, customerId), eq(favourites.productId, productId)));
}

/** How many products are on each of these customers' lists. */
export async function listCounts(db: DB, customerIds: string[]) {
  if (!customerIds.length) return new Map<string, number>();
  const rows = await db
    .select({ customerId: favourites.customerId, n: sql<number>`count(*)::int` })
    .from(favourites)
    .where(inArray(favourites.customerId, customerIds))
    .groupBy(favourites.customerId);
  return new Map(rows.map((r) => [r.customerId, r.n]));
}

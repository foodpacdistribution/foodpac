import "server-only";
import { and, asc, isNotNull, ne, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { type DB, getDb } from "./db";
import { customers } from "./db/schema";
import { geocodeAddress } from "./geo/geocode";

/** Customers with an address that hasn't been placed on the map (new, imported, or address changed). */
export const needsLocating = and(
  isNotNull(customers.address),
  ne(sql`trim(${customers.address})`, ""),
  sql`${customers.geocodedAddress} is distinct from ${customers.address}`,
);

/**
 * Places customers on the map until `budgetMs` is used up, and clears the pin of any customer
 * whose address was removed. Each address is looked up once (the geocode cache keeps it), so
 * running this again, or alongside another run, only repeats what's left. Returns how many are
 * still waiting.
 */
export async function locateCustomers(db: DB, { budgetMs = 8000 }: { budgetMs?: number } = {}) {
  const start = Date.now();
  await db
    .update(customers)
    .set({ lat: null, lng: null, geocodeStatus: null, geocodeLabel: null, geocodedAddress: null })
    .where(and(or(sql`${customers.address} is null`, sql`trim(${customers.address}) = ''`), isNotNull(customers.geocodedAddress)));

  let located = 0;
  while (Date.now() - start < budgetMs) {
    const batch = await db.select({ id: customers.id, address: customers.address }).from(customers).where(needsLocating).orderBy(asc(customers.createdAt)).limit(20);
    if (!batch.length) break;
    for (const c of batch) {
      if (Date.now() - start >= budgetMs) break;
      const address = c.address!;
      const r = await geocodeAddress(db, address);
      await db
        .update(customers)
        .set({ lat: r.lat, lng: r.lng, geocodeStatus: r.status, geocodeLabel: r.label, geocodedAddress: address })
        // Only if the address wasn't changed meanwhile; a changed one is picked up next time.
        .where(and(sql`${customers.id} = ${c.id}`, sql`${customers.address} = ${address}`));
      located++;
    }
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(customers).where(needsLocating);
  return { located, remaining: n };
}

/**
 * After the response is sent, places customers whose address is new or changed. An import of
 * hundreds of customers takes a few minutes; whatever doesn't fit is finished when someone opens
 * the customer map.
 */
export function locateCustomersLater(budgetMs = 20_000) {
  after(async () => {
    try {
      await locateCustomers(await getDb(), { budgetMs });
    } catch (err) {
      console.warn(`[customer-map] placing customers failed: ${(err as Error).message}`);
    }
  });
}

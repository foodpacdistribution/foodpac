import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { productCosts } from "./costs";
import type { DB } from "./db";
import { customerPrices, customers, favourites, priceMatches, products, users } from "./db/schema";
import { getSettings, UserError } from "./planning";
import { marginFloor, needsApproval } from "./price-match-rules";

// Price match at a store: the salesperson types what the store pays now for one of our products
// and offers a price. Within the margin floor it's the customer's price straight away; below it
// (or with no cost known) the office approves it first. Every matched product goes on the
// customer's list, so it's there to order when they first sign in.

type Who = { id: string; role: string };
const isOffice = (u: Who) => u.role !== "sales";

/** What the form needs for one product: our list price, their price now, and the margin floor. */
export type MatchProduct = {
  id: string;
  sku: string;
  name: string;
  packSize: string;
  unit: string;
  gst: boolean;
  listCents: number;
  /** Their own price now, when they have one. */
  ownCents: number | null;
  /** Lowest price sales staff can give without asking (null: cost unknown, so anything under list asks). */
  floorCents: number | null;
  /** What it costs us: only sent to the office. */
  costCents: number | null;
};

/** Every product on sale, priced for this customer, for the price match form. */
export async function matchProducts(db: DB, customerId: string, today: string, office: boolean): Promise<{ products: MatchProduct[]; beatPct: number; minMarginPct: number }> {
  const [rows, own, costs, s] = await Promise.all([
    db
      .select({ id: products.id, sku: products.sku, name: products.name, packSize: products.packSize, unit: products.unit, gst: products.gst, listCents: products.priceCents })
      .from(products)
      .where(eq(products.active, true))
      .orderBy(asc(products.name)),
    db.select({ productId: customerPrices.productId, cents: customerPrices.priceCents }).from(customerPrices).where(eq(customerPrices.customerId, customerId)),
    productCosts(db, today),
    getSettings(db),
  ]);
  const ownOf = new Map(own.map((o) => [o.productId, o.cents]));
  return {
    beatPct: s.priceMatchBeatPct,
    minMarginPct: s.salesMinMarginPct,
    products: rows.map((r) => {
      const cost = costs.get(r.id)?.cents ?? null;
      return { ...r, ownCents: ownOf.get(r.id) ?? null, floorCents: marginFloor(cost, s.salesMinMarginPct), costCents: office && cost !== null ? Math.round(cost) : null };
    }),
  };
}

export type MatchInput = {
  customerId: string;
  productId: string;
  competitorCents: number;
  competitor?: string | null;
  priceCents: number;
  monthlyQty?: number | null;
  note?: string | null;
};

/**
 * Records a price match. Applies it (sets the customer's price) when allowed, otherwise leaves it
 * for the office; an earlier match of the same product still waiting is replaced. The product
 * goes on the customer's list either way.
 */
export async function savePriceMatch(db: DB, by: Who, input: MatchInput, today: string) {
  const { customerId, productId } = input;
  if (!Number.isInteger(input.competitorCents) || input.competitorCents <= 0) throw new UserError("Enter what they pay now, e.g. 21.50.");
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) throw new UserError("Enter the price you're offering, e.g. 20.90.");
  const monthlyQty = input.monthlyQty ?? null;
  if (monthlyQty !== null && (!Number.isInteger(monthlyQty) || monthlyQty <= 0 || monthlyQty > 100000)) throw new UserError("Monthly quantity must be a whole number, e.g. 20.");

  const [[p], [c], s, costs] = await Promise.all([
    db.select({ id: products.id, name: products.name, listCents: products.priceCents, active: products.active }).from(products).where(eq(products.id, productId)).limit(1),
    db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1),
    getSettings(db),
    productCosts(db, today, [productId]),
  ]);
  if (!p || !p.active) throw new UserError("Product not found.");
  if (!c) throw new UserError("Customer not found.");
  const cost = costs.get(productId)?.cents ?? null;
  const costCents = cost === null ? null : Math.round(cost);
  const pending = needsApproval({ office: isOffice(by), priceCents: input.priceCents, listCents: p.listCents, floorCents: marginFloor(cost, s.salesMinMarginPct) });

  return db.transaction(async (t) => {
    const tx = t as unknown as DB;
    // Only the latest offer for a product waits for the office.
    await tx.delete(priceMatches).where(and(eq(priceMatches.customerId, customerId), eq(priceMatches.productId, productId), eq(priceMatches.status, "pending")));
    const [row] = await tx
      .insert(priceMatches)
      .values({
        customerId,
        productId,
        competitorCents: input.competitorCents,
        competitor: input.competitor?.trim().slice(0, 120) || null,
        priceCents: input.priceCents,
        listCents: p.listCents,
        costCents,
        monthlyQty,
        note: input.note?.trim().slice(0, 300) || null,
        status: pending ? "pending" : "approved",
        requestedBy: by.id,
        ...(pending ? {} : { decidedBy: by.id, decidedAt: new Date() }),
      })
      .returning();
    if (!pending) await applyPrice(tx, customerId, productId, input.priceCents, p.listCents);
    await tx.insert(favourites).values({ customerId, productId, addedBy: by.id }).onConflictDoNothing();
    return { match: row, product: p.name, pending };
  });
}

/** The match's price becomes the customer's own price (at list price or above, their own price goes: list it is). */
async function applyPrice(tx: DB, customerId: string, productId: string, priceCents: number, listCents: number) {
  if (priceCents >= listCents) {
    await tx.delete(customerPrices).where(and(eq(customerPrices.customerId, customerId), eq(customerPrices.productId, productId)));
    return;
  }
  await tx
    .insert(customerPrices)
    .values({ customerId, productId, priceCents })
    .onConflictDoUpdate({ target: [customerPrices.customerId, customerPrices.productId], set: { priceCents } });
}

/** The office approves (the customer gets the price) or turns down a match waiting for it. */
export async function decidePriceMatch(db: DB, by: Who, id: string, approve: boolean) {
  if (!isOffice(by)) throw new UserError("Only the office can approve price matches.");
  return db.transaction(async (t) => {
    const tx = t as unknown as DB;
    const [m] = await tx.select().from(priceMatches).where(eq(priceMatches.id, id)).for("update");
    if (!m) throw new UserError("Price match not found.");
    if (m.status !== "pending") throw new UserError("This price match was already decided.");
    await tx.update(priceMatches).set({ status: approve ? "approved" : "rejected", decidedBy: by.id, decidedAt: new Date() }).where(eq(priceMatches.id, id));
    if (approve) await applyPrice(tx, m.customerId, m.productId, m.priceCents, m.listCents);
    const [p] = await tx.select({ name: products.name }).from(products).where(eq(products.id, m.productId));
    return { customerId: m.customerId, product: p?.name ?? "Product" };
  });
}

/** Deletes a match still waiting (the salesperson changed their mind). Decided ones stay as the record. */
export async function withdrawPriceMatch(db: DB, by: Who, id: string) {
  const [m] = await db.select().from(priceMatches).where(eq(priceMatches.id, id)).limit(1);
  if (!m) throw new UserError("Price match not found.");
  if (m.status !== "pending") throw new UserError("Only a price match still waiting can be withdrawn.");
  if (!isOffice(by) && m.requestedBy !== by.id) throw new UserError("Someone else asked for this price.");
  await db.delete(priceMatches).where(eq(priceMatches.id, id));
  return { customerId: m.customerId };
}

const matchColumns = {
  id: priceMatches.id,
  customerId: priceMatches.customerId,
  productId: priceMatches.productId,
  name: products.name,
  sku: products.sku,
  packSize: products.packSize,
  unit: products.unit,
  competitorCents: priceMatches.competitorCents,
  competitor: priceMatches.competitor,
  priceCents: priceMatches.priceCents,
  listCents: priceMatches.listCents,
  costCents: priceMatches.costCents,
  monthlyQty: priceMatches.monthlyQty,
  note: priceMatches.note,
  status: priceMatches.status,
  requestedBy: priceMatches.requestedBy,
  requestedByName: users.name,
  createdAt: priceMatches.createdAt,
  decidedAt: priceMatches.decidedAt,
};

export type MatchRow = Awaited<ReturnType<typeof customerMatches>>[number];

/** A customer's price matches, newest first. */
export async function customerMatches(db: DB, customerId: string) {
  return db
    .select(matchColumns)
    .from(priceMatches)
    .innerJoin(products, eq(products.id, priceMatches.productId))
    .leftJoin(users, eq(users.id, priceMatches.requestedBy))
    .where(eq(priceMatches.customerId, customerId))
    .orderBy(desc(priceMatches.createdAt));
}

/** Matches waiting for the office, oldest first, with the customer's name. */
export async function pendingMatches(db: DB) {
  return db
    .select({ ...matchColumns, customer: customers.name, customerCode: customers.code })
    .from(priceMatches)
    .innerJoin(products, eq(products.id, priceMatches.productId))
    .innerJoin(customers, eq(customers.id, priceMatches.customerId))
    .leftJoin(users, eq(users.id, priceMatches.requestedBy))
    .where(eq(priceMatches.status, "pending"))
    .orderBy(asc(priceMatches.createdAt));
}

export async function pendingMatchCount(db: DB) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(priceMatches).where(eq(priceMatches.status, "pending"));
  return r?.n ?? 0;
}

/**
 * The savings sheet: for each product with an approved match (latest one), what they pay now and
 * what they pay us today (their own price, or list), where we're no dearer.
 */
export async function savingsLines(db: DB, customerId: string) {
  const latest = await db
    .selectDistinctOn([priceMatches.productId], {
      productId: priceMatches.productId,
      competitorCents: priceMatches.competitorCents,
      competitor: priceMatches.competitor,
      monthlyQty: priceMatches.monthlyQty,
    })
    .from(priceMatches)
    .where(and(eq(priceMatches.customerId, customerId), eq(priceMatches.status, "approved")))
    .orderBy(priceMatches.productId, desc(priceMatches.createdAt));
  if (!latest.length) return [];
  const ids = latest.map((l) => l.productId);
  const [rows, own] = await Promise.all([
    db
      .select({ id: products.id, sku: products.sku, name: products.name, packSize: products.packSize, unit: products.unit, listCents: products.priceCents })
      .from(products)
      .where(inArray(products.id, ids)),
    db
      .select({ productId: customerPrices.productId, cents: customerPrices.priceCents })
      .from(customerPrices)
      .where(and(eq(customerPrices.customerId, customerId), inArray(customerPrices.productId, ids))),
  ]);
  return latest
    .flatMap((l) => {
      const p = rows.find((r) => r.id === l.productId);
      if (!p) return [];
      const ours = own.find((o) => o.productId === p.id)?.cents ?? p.listCents;
      return ours <= l.competitorCents ? [{ ...p, ...l, ourCents: ours }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

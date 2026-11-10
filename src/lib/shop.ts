import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { after } from "next/server";
import type { DB } from "./db";
import {
  cartItems,
  customerPrices,
  customers,
  favourites,
  orders,
  type PaymentMethod,
  products,
  routeStops,
  salesOrderItems,
  salesOrderNo,
  salesOrders,
  type settings,
} from "./db/schema";
import { shiftDate } from "./dates";
import { GST_RATE } from "./money";
import { orderConfirmed } from "./notify";
import { UserError } from "./planning";
import { fillWaiting, returnStock } from "./stock-allocation";
import { withStockContext } from "./stock-ledger";
import { releaseOrderCredit } from "./credit";
import { nowSecondsIn, todayIn } from "./time";

type Settings = typeof settings.$inferSelect;
export type Customer = typeof customers.$inferSelect;

// Every price a customer sees or pays is worked out here on the server from their
// own price list, never taken from the browser.

export type CatalogItem = {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  packSize: string;
  unit: string;
  minQty: number;
  stock: number;
  hasImage: boolean;
  /** For the versioned (cacheable) photo URL. */
  updatedAt: Date;
  featured: boolean;
  gst: boolean;
  /** null when the viewer can't see prices (signed out or not approved yet). */
  priceCents: number | null;
  listPriceCents: number | null;
  /** On the signed-in customer's own list ("My list"). */
  favourite: boolean;
};

/** Prices are shown only to signed-in, approved, active customers. */
export const canSeePrices = (c: Customer | null) => !!c && c.approved && c.active;

const catalogColumns = {
  id: products.id,
  sku: products.sku,
  name: products.name,
  category: products.category,
  description: products.description,
  packSize: products.packSize,
  unit: products.unit,
  minQty: products.minQty,
  stock: products.stock,
  hasImage: sql<boolean>`${products.image} is not null`,
  updatedAt: products.updatedAt,
  featured: products.featured,
  gst: products.gst,
  priceCents: products.priceCents,
};

async function withPrices(
  db: DB,
  rows: (Omit<CatalogItem, "listPriceCents" | "priceCents" | "favourite"> & { priceCents: number })[],
  customer: Customer | null,
): Promise<CatalogItem[]> {
  const ids = rows.map((r) => r.id);
  // Their own prices and their list, looked up side by side.
  const [own, faves] = await Promise.all([
    canSeePrices(customer) && ids.length
      ? db
          .select()
          .from(customerPrices)
          .where(and(eq(customerPrices.customerId, customer!.id), inArray(customerPrices.productId, ids)))
      : [],
    customer && ids.length
      ? db
          .select({ productId: favourites.productId })
          .from(favourites)
          .where(and(eq(favourites.customerId, customer.id), inArray(favourites.productId, ids)))
      : [],
  ]);
  const fave = new Set(faves.map((f) => f.productId));
  if (!canSeePrices(customer)) return rows.map((r) => ({ ...r, priceCents: null, listPriceCents: null, favourite: fave.has(r.id) }));
  return rows.map((r) => ({
    ...r,
    listPriceCents: r.priceCents,
    priceCents: own.find((p) => p.productId === r.id)?.priceCents ?? r.priceCents,
    favourite: fave.has(r.id),
  }));
}

export const SORTS = { name: "Name A–Z", "price-asc": "Price: low to high", "price-desc": "Price: high to low", newest: "Newest" } as const;
export type Sort = keyof typeof SORTS;

export async function listCatalog(
  db: DB,
  customer: Customer | null,
  opts: { q?: string; category?: string; featured?: boolean; inStock?: boolean; sort?: Sort; limit?: number } = {},
) {
  const q = opts.q?.trim();
  const where = [eq(products.active, true)];
  if (opts.inStock) where.push(gte(products.stock, 1));
  if (opts.category) where.push(eq(products.category, opts.category));
  if (opts.featured) where.push(eq(products.featured, true));
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    where.push(or(ilike(products.name, like), ilike(products.sku, like), ilike(products.barcode, like), ilike(products.description, like))!);
  }
  const rows = await db
    .select(catalogColumns)
    .from(products)
    .where(and(...where))
    .orderBy(...(opts.sort === "newest" ? [desc(products.createdAt)] : opts.sort === "name" ? [asc(products.name)] : [asc(products.category), asc(products.name)]))
    .limit(opts.limit ?? 200);
  const priced = await withPrices(db, rows, customer);
  // Price sorts use each customer's own price, so they happen after pricing.
  if (opts.sort === "price-asc" || opts.sort === "price-desc") {
    const dir = opts.sort === "price-asc" ? 1 : -1;
    priced.sort((a, b) => dir * ((a.priceCents ?? a.listPriceCents ?? 0) - (b.priceCents ?? b.listPriceCents ?? 0)));
  }
  return priced;
}

export async function getProductBySku(db: DB, customer: Customer | null, sku: string) {
  const [row] = await db
    .select(catalogColumns)
    .from(products)
    .where(and(eq(products.active, true), eq(products.sku, sku)))
    .limit(1);
  return row ? (await withPrices(db, [row], customer))[0] : null;
}

/** Most products the search box matches in the browser; above this it asks the server per search. */
export const SEARCH_INDEX_LIMIT = 3000;

/** Every active product's searchable fields (no prices), for instant suggestions in the browser. */
export async function searchIndex(db: DB) {
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      category: products.category,
      packSize: products.packSize,
      barcode: products.barcode,
      hasImage: sql<boolean>`${products.image} is not null`,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(eq(products.active, true))
    .orderBy(asc(products.category), asc(products.name))
    .limit(SEARCH_INDEX_LIMIT + 1);
  return { products: rows.slice(0, SEARCH_INDEX_LIMIT), complete: rows.length <= SEARCH_INDEX_LIMIT };
}

/** Up to `limit` product photos for a home page poster, taken in turn from each category (no prices). */
export async function posterPhotos(db: DB, categories: string[], limit = 3) {
  if (!categories.length) return [];
  const rows = await db
    .select({ id: products.id, sku: products.sku, name: products.name, category: products.category, updatedAt: products.updatedAt })
    .from(products)
    .where(and(eq(products.active, true), isNotNull(products.image), inArray(products.category, categories)))
    .orderBy(desc(products.featured), desc(products.updatedAt))
    .limit(limit * categories.length * 2);
  const picked: (typeof rows)[number][] = [];
  for (let round = 0; picked.length < limit && round < limit; round++) {
    for (const c of categories) {
      const next = rows.filter((r) => r.category === c)[round];
      if (next && picked.length < limit) picked.push(next);
    }
  }
  return picked.map((r) => ({ ...r, hasImage: true }));
}

export async function listCategories(db: DB) {
  return db
    .select({ name: products.category, n: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.active, true))
    .groupBy(products.category)
    .orderBy(asc(products.category));
}

/** Products this customer bought before, most recent first. */
/** The customer's own list, newest first, priced for them. */
export async function listFavourites(db: DB, customer: Customer) {
  const items = await db
    .select(catalogColumns)
    .from(favourites)
    .innerJoin(products, eq(products.id, favourites.productId))
    .where(and(eq(favourites.customerId, customer.id), eq(products.active, true)))
    .orderBy(desc(favourites.createdAt));
  return withPrices(db, items, customer);
}

export async function recentlyBought(db: DB, customer: Customer, limit = 8) {
  const rows = await db
    .select({ productId: salesOrderItems.productId, last: sql<string>`max(${salesOrders.createdAt})` })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.salesOrderId))
    .where(and(eq(salesOrders.customerId, customer.id), ne(salesOrders.status, "cancelled")))
    .groupBy(salesOrderItems.productId)
    .orderBy(desc(sql`max(${salesOrders.createdAt})`))
    .limit(limit);
  const ids = rows.map((r) => r.productId).filter((x): x is string => !!x);
  if (!ids.length) return [];
  const items = await db
    .select(catalogColumns)
    .from(products)
    .where(and(eq(products.active, true), inArray(products.id, ids)));
  const priced = await withPrices(db, items, customer);
  return ids.map((id) => priced.find((p) => p.id === id)).filter((x): x is CatalogItem => !!x);
}

/**
 * The customer's usual products for the order sheet: what they've ordered most often first, each
 * with the quantity on their latest order of it.
 */
export async function usualItems(db: DB, customer: Customer, limit = 40) {
  const rows = await db
    .select({
      productId: salesOrderItems.productId,
      orders: sql<number>`count(distinct ${salesOrders.id})::int`,
      lastQty: sql<number>`(array_agg(${salesOrderItems.qty} order by ${salesOrders.createdAt} desc))[1]`,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.salesOrderId))
    .where(and(eq(salesOrders.customerId, customer.id), ne(salesOrders.status, "cancelled"), sql`${salesOrderItems.productId} is not null`))
    .groupBy(salesOrderItems.productId)
    .orderBy(desc(sql`count(distinct ${salesOrders.id})`), desc(sql`max(${salesOrders.createdAt})`))
    .limit(limit);
  if (!rows.length) return [];
  const items = await db
    .select(catalogColumns)
    .from(products)
    .where(and(eq(products.active, true), inArray(products.id, rows.map((r) => r.productId!))));
  const priced = await withPrices(db, items, customer);
  return rows.flatMap((r) => {
    const p = priced.find((x) => x.id === r.productId);
    return p ? [{ ...p, lastQty: r.lastQty, timesOrdered: r.orders }] : [];
  });
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export type CartLine = CatalogItem & { qty: number; lineCents: number; issue: string | null };

export async function getCart(db: DB, customer: Customer) {
  const rows = await db.select().from(cartItems).where(eq(cartItems.customerId, customer.id));
  if (!rows.length) return [] as CartLine[];
  const items = await db
    .select({ ...catalogColumns, active: products.active })
    .from(products)
    .where(inArray(products.id, rows.map((r) => r.productId)))
    .orderBy(asc(products.name));
  const priced = await withPrices(db, items, customer);
  return priced.map((p): CartLine => {
    const qty = rows.find((r) => r.productId === p.id)!.qty;
    const active = items.find((i) => i.id === p.id)!.active;
    const issue = !active
      ? "No longer available"
      : p.stock <= 0
        ? "Out of stock"
        : qty > p.stock
          ? `Only ${p.stock} in stock`
          : qty < p.minQty
            ? `Minimum order is ${p.minQty}`
            : null;
    return { ...p, qty, lineCents: (p.priceCents ?? 0) * qty, issue };
  });
}

export type Quote = { subtotalCents: number; deliveryFeeCents: number; gstCents: number; totalCents: number; belowMinimum: boolean };

/** Totals for a cart: subtotal ex GST, delivery fee (free above the threshold), GST on taxable lines and delivery. */
export function quote(lines: { lineCents: number; gst: boolean }[], s: Settings): Quote {
  const subtotalCents = lines.reduce((t, l) => t + l.lineCents, 0);
  const deliveryFeeCents = subtotalCents === 0 || (s.freeDeliveryOverCents > 0 && subtotalCents >= s.freeDeliveryOverCents) ? 0 : s.deliveryFeeCents;
  const taxable = lines.filter((l) => l.gst).reduce((t, l) => t + l.lineCents, 0) + deliveryFeeCents;
  const gstCents = Math.round(taxable * GST_RATE);
  return { subtotalCents, deliveryFeeCents, gstCents, totalCents: subtotalCents + deliveryFeeCents + gstCents, belowMinimum: subtotalCents < s.minOrderCents };
}

/** The next delivery days a customer can choose: after today's cut-off, only on delivery weekdays. */
export function deliveryDates(s: Pick<Settings, "timezone" | "orderCutoffMin" | "deliveryDays">, count = 10, now = new Date()) {
  const today = todayIn(s.timezone, now);
  const first = nowSecondsIn(s.timezone, now) < s.orderCutoffMin * 60 ? 1 : 2;
  const out: string[] = [];
  for (let d = first; out.length < count && d < 60; d++) {
    const date = shiftDate(today, d);
    const iso = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    if (s.deliveryDays.includes(iso)) out.push(date);
  }
  return out;
}

export type DeliveryPromise = {
  /** Order cut-off, minutes after midnight. */
  cutoffMin: number;
  /** Still before today's cut-off (so "order by …" applies). */
  beforeCutoff: boolean;
  /** The first delivery day an order placed now can go on (YYYY-MM-DD). */
  day: string;
  tomorrow: boolean;
  deliveryFeeCents: number;
  freeDeliveryOverCents: number;
};

/** What the shop can promise about delivery right now ("order by 2pm for delivery tomorrow"). */
export function deliveryPromise(
  s: Pick<Settings, "timezone" | "orderCutoffMin" | "deliveryDays" | "deliveryFeeCents" | "freeDeliveryOverCents">,
  now = new Date(),
): DeliveryPromise | null {
  const [day] = deliveryDates(s, 1, now);
  if (!day) return null;
  return {
    cutoffMin: s.orderCutoffMin,
    beforeCutoff: nowSecondsIn(s.timezone, now) < s.orderCutoffMin * 60,
    day,
    tomorrow: day === shiftDate(todayIn(s.timezone, now), 1),
    deliveryFeeCents: s.deliveryFeeCents,
    freeDeliveryOverCents: s.freeDeliveryOverCents,
  };
}

export function allowedMethods(c: Customer, stripeOn: boolean): PaymentMethod[] {
  const m: PaymentMethod[] = [];
  if (stripeOn) m.push("card");
  m.push("bank_transfer");
  if (c.paymentTerms !== "prepay") m.push("invoice");
  return m;
}

/** Unpaid balance on open invoice orders, for the credit limit check. */
export async function openBalance(db: DB, customerId: string) {
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${salesOrders.totalCents} - ${salesOrders.creditAppliedCents}), 0)::int` })
    .from(salesOrders)
    .where(and(eq(salesOrders.customerId, customerId), ne(salesOrders.status, "cancelled"), eq(salesOrders.paymentStatus, "unpaid")));
  return r.n;
}

// ---------------------------------------------------------------------------
// Placing and cancelling orders
// ---------------------------------------------------------------------------

export type Checkout = {
  idempotencyKey: string;
  method: PaymentMethod;
  deliveryDate: string;
  recipient: string;
  phone: string | null;
  address: string;
  instructions: string | null;
  windowStartMin: number | null;
  windowEndMin: number | null;
  notes: string | null;
};

export const dueIn = { prepay: 0, net7: 7, net14: 14, net30: 30 } as const;

/**
 * Creates the order in one transaction: re-prices the cart, reserves stock with a
 * conditional update (so two customers can't buy the last carton), writes the order and
 * clears the cart. Card orders stay pending until Stripe confirms payment; the others are
 * confirmed straight away and go to the planner.
 */
export async function placeOrder(db: DB, customer: Customer, userId: string, c: Checkout, s: Settings, stripeOn: boolean) {
  const [existing] = await db.select().from(salesOrders).where(eq(salesOrders.idempotencyKey, c.idempotencyKey)).limit(1);
  if (existing) return existing;

  if (!canSeePrices(customer)) throw new UserError("Your account is waiting for approval. We'll email you once you can order.");
  if (!allowedMethods(customer, stripeOn).includes(c.method)) throw new UserError("That payment method isn't available on your account.");
  if (!deliveryDates(s).includes(c.deliveryDate)) throw new UserError("Choose one of the available delivery days.");

  const lines = await getCart(db, customer);
  if (!lines.length) throw new UserError("Your cart is empty.");
  const problem = lines.find((l) => l.issue);
  if (problem) throw new UserError(`${problem.name}: ${problem.issue}.`);
  const totals = quote(lines, s);
  if (totals.belowMinimum) throw new UserError(`The minimum order is $${(s.minOrderCents / 100).toFixed(2)} before GST.`);

  if (c.method === "invoice" && customer.creditLimitCents !== null) {
    const balance = await openBalance(db, customer.id);
    if (balance + totals.totalCents > customer.creditLimitCents) {
      throw new UserError("This order would go over your account's credit limit. Please pay by card or bank transfer, or contact us.");
    }
  }

  const order = await db.transaction(async (tx) => {
    await withStockContext(tx as unknown as DB, { type: "sale_reserved", note: `Online order · ${customer.name}`, by: userId }, async (t) => {
      for (const l of lines) {
        const ok = await t
          .update(products)
          .set({ stock: sql`${products.stock} - ${l.qty}` })
          .where(and(eq(products.id, l.id), eq(products.active, true), gte(products.stock, l.qty)))
          .returning({ id: products.id });
        if (!ok.length) throw new UserError(`${l.name} just sold out. Please update your cart.`);
      }
    });
    const confirmed = c.method !== "card";
    const [so] = await tx
      .insert(salesOrders)
      .values({
        number: sql`'FP-' || nextval('${sql.raw(salesOrderNo.seqName!)}')`,
        customerId: customer.id,
        userId,
        status: confirmed ? "confirmed" : "pending",
        paymentStatus: "unpaid",
        paymentMethod: c.method,
        subtotalCents: totals.subtotalCents,
        deliveryFeeCents: totals.deliveryFeeCents,
        gstCents: totals.gstCents,
        totalCents: totals.totalCents,
        deliveryDate: c.deliveryDate,
        recipient: c.recipient,
        phone: c.phone,
        address: c.address,
        instructions: c.instructions,
        windowStartMin: c.windowStartMin,
        windowEndMin: c.windowEndMin,
        notes: c.notes,
        dueDate: c.method === "invoice" ? shiftDate(c.deliveryDate, dueIn[customer.paymentTerms]) : null,
        idempotencyKey: c.idempotencyKey,
      })
      .returning();
    await tx.insert(salesOrderItems).values(
      lines.map((l) => ({
        salesOrderId: so.id,
        productId: l.id,
        sku: l.sku,
        name: l.name,
        packSize: l.packSize,
        unit: l.unit,
        unitPriceCents: l.priceCents!,
        qty: l.qty,
        gst: l.gst,
        lineCents: l.lineCents,
      })),
    );
    await tx.delete(cartItems).where(eq(cartItems.customerId, customer.id));
    return confirmed ? { ...so, deliveryOrderId: await createDeliveryOrder(tx as unknown as DB, so, customer, lines) } : so;
  });
  return order;
}

/** The stop the planner routes. Same number as the sales order so drivers and customers see one reference. */
export async function createDeliveryOrder(db: DB, so: typeof salesOrders.$inferSelect, customer: Customer, lines?: { qty: number }[]) {
  const qty = lines ? lines.reduce((t, l) => t + l.qty, 0) : await itemCount(db, so.id);
  const [row] = await db
    .insert(orders)
    .values({
      orderNumber: so.number,
      deliveryDate: so.deliveryDate,
      customerName: customer.name,
      phone: so.phone,
      address: so.address,
      windowStartMin: so.windowStartMin,
      windowEndMin: so.windowEndMin,
      demand: Math.max(1, qty),
      notes: [so.recipient && `Deliver to ${so.recipient}`, so.instructions].filter(Boolean).join(" · ") || null,
      customerId: customer.id,
      source: "shop",
    })
    .onConflictDoNothing()
    .returning({ id: orders.id });
  // Already a delivery with this number and date (e.g. left over from before it was unlinked): use it.
  const id =
    row?.id ??
    (await db.select({ id: orders.id }).from(orders).where(and(eq(orders.orderNumber, so.number), eq(orders.deliveryDate, so.deliveryDate))).limit(1))[0]?.id;
  if (!id) return null;
  await db.update(salesOrders).set({ deliveryOrderId: id }).where(eq(salesOrders.id, so.id));
  return id;
}

/**
 * Confirmed shop orders for `fromDate` onwards that have lost their delivery (it was deleted,
 * or creating it failed) get one again, so they show up in Orders, Shipments and the planner.
 * One that had already been loaded goes back to "Packed": it's no longer on a van.
 * Returns the new delivery order ids, which still need their address located.
 */
export async function restoreMissingDeliveries(db: DB, fromDate: string) {
  const lost = await db
    .select({ so: salesOrders, customer: customers })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.status, "confirmed"), sql`${salesOrders.deliveryOrderId} is null`, gte(salesOrders.deliveryDate, fromDate)));
  const ids: string[] = [];
  for (const { so, customer } of lost) {
    const id = await createDeliveryOrder(db, so, customer);
    if (!id) continue;
    ids.push(id);
    if (so.fulfilment === "loaded") await db.update(salesOrders).set({ fulfilment: "packed" }).where(eq(salesOrders.id, so.id));
  }
  return ids;
}

async function itemCount(db: DB, salesOrderId: string) {
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${salesOrderItems.qty}), 0)::int` })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.salesOrderId, salesOrderId));
  return r.n;
}

/** Card payment succeeded (Stripe webhook or return page). Safe to call more than once. */
export async function markCardPaid(db: DB, salesOrderId: string) {
  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, salesOrderId)).limit(1);
  if (!so || so.paymentStatus === "paid" || so.status === "cancelled") return so ?? null;
  const [customer] = await db.select().from(customers).where(eq(customers.id, so.customerId)).limit(1);
  const [updated] = await db
    .update(salesOrders)
    // Paid up front, so nothing is left to change: the invoice is final straight away.
    .set({ status: "confirmed", paymentStatus: "paid", paidAt: new Date(), invoiceStatus: "final", invoicedAt: new Date() })
    .where(and(eq(salesOrders.id, so.id), ne(salesOrders.paymentStatus, "paid")))
    .returning();
  if (updated && !updated.deliveryOrderId) await createDeliveryOrder(db, updated, customer);
  // Only the call that actually marked it paid sends the emails (webhook and return page can both get here).
  if (updated) after(() => orderConfirmed(updated.id, { office: true }));
  return updated ?? so;
}

/** Confirms a pending order without payment (e.g. staff accept it). */
export async function confirmOrder(db: DB, salesOrderId: string) {
  const [so] = await db
    .update(salesOrders)
    .set({ status: "confirmed" })
    .where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.status, "pending")))
    .returning();
  if (!so) return;
  const [customer] = await db.select().from(customers).where(eq(customers.id, so.customerId)).limit(1);
  if (!so.deliveryOrderId) await createDeliveryOrder(db, so, customer);
}

/**
 * Cancels an order: gives the stock back and removes its delivery from the planner. Refused
 * once the van has left or it's been delivered, because the goods are no longer in the warehouse.
 */
export async function cancelOrder(db: DB, salesOrderId: string) {
  return db.transaction(async (tx) => {
    const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, salesOrderId)).limit(1);
    if (!so) throw new UserError("Order not found.");
    if (so.status === "cancelled") return so;
    if (so.deliveryOrderId) {
      const [d] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, so.deliveryOrderId)).limit(1);
      if (d && (d.status === "dispatched" || d.status === "delivered")) {
        throw new UserError("This order is already out for delivery or delivered, so it can't be cancelled here.");
      }
      await tx.delete(routeStops).where(and(eq(routeStops.orderId, so.deliveryOrderId), eq(routeStops.status, "pending")));
      await tx.delete(orders).where(eq(orders.id, so.deliveryOrderId));
    }
    // Only what was actually reserved goes back; units still waiting for stock never left the shelf.
    const items = await tx.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, so.id));
    for (const it of items) if (it.productId) await returnStock(tx as unknown as DB, it.productId, it.qty - it.backorderQty, { id: so.id, number: so.number, note: "Order cancelled" });
    // Store credit spent on it goes back to the customer.
    await releaseOrderCredit(tx as unknown as DB, so, 0, "Order cancelled", null);
    const [updated] = await tx
      .update(salesOrders)
      .set({ status: "cancelled", cancelledAt: new Date(), deliveryOrderId: null })
      .where(eq(salesOrders.id, so.id))
      .returning();
    // The returned stock may be what another customer is waiting for.
    await fillWaiting(tx as unknown as DB, items.map((it) => it.productId));
    return updated;
  });
}

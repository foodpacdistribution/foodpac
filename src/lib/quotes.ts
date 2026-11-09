import "server-only";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { DB } from "./db";
import { customers, products, quoteItems, quoteNo, quotes, salesOrders } from "./db/schema";
import { orderTotals } from "./order-totals";
import { UserError } from "./planning";
import { nextNumber } from "./purchasing/common";

/** A quote as staff type it: who for, until when, which products at what price. */
export type QuoteInput = {
  customerId: string;
  validUntil: string;
  deliveryFeeCents: number;
  notes: string | null;
  internalNote: string | null;
  lines: { productId: string; qty: number; unitPriceCents: number }[];
};

function check(input: QuoteInput, today: string, keepDate?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil) || Number.isNaN(Date.parse(input.validUntil))) throw new UserError("Choose until when the quote is valid.");
  if (input.validUntil < today && input.validUntil !== keepDate) throw new UserError("The valid-until date can't be in the past.");
  if (!Number.isInteger(input.deliveryFeeCents) || input.deliveryFeeCents < 0) throw new UserError("The delivery fee must be $0 or more.");
  // One line per product, in the order they were added: the same product twice is added together.
  const merged = new Map<string, { productId: string; qty: number; unitPriceCents: number }>();
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty < 0 || l.qty > 99999) throw new UserError("Quantities must be whole numbers.");
    if (!Number.isInteger(l.unitPriceCents) || l.unitPriceCents < 0) throw new UserError("Prices must be $0 or more.");
    if (l.qty === 0) continue;
    const m = merged.get(l.productId);
    merged.set(l.productId, m ? { ...m, qty: m.qty + l.qty } : { ...l });
  }
  if (!merged.size) throw new UserError("Add at least one product.");
  if (merged.size > 300) throw new UserError("A quote can have at most 300 products.");
  return [...merged.values()];
}

async function itemsFor(db: DB, lines: ReturnType<typeof check>) {
  const rows = await db.select().from(products).where(inArray(products.id, lines.map((l) => l.productId)));
  const byId = new Map(rows.map((p) => [p.id, p]));
  return lines.map((l, position) => {
    const p = byId.get(l.productId);
    if (!p) throw new UserError("One of the products no longer exists. Reload the page and try again.");
    return { productId: p.id, sku: p.sku, name: p.name, packSize: p.packSize, unit: p.unit, gst: p.gst, qty: l.qty, unitPriceCents: l.unitPriceCents, lineCents: l.qty * l.unitPriceCents, position };
  });
}

/** Why a quote can't be changed any more, or null if it can. */
export function quoteEditBlocker(q: Pick<typeof quotes.$inferSelect, "status" | "salesOrderId">) {
  if (q.salesOrderId) return "This quote has become a sales order, so it can't be changed. Copy it to make a new quote.";
  return null;
}

/** Creates a quote (id null) or replaces an open quote's lines and details. Returns the quote. */
export async function saveQuote(db: DB, userId: string, id: string | null, input: QuoteInput, today: string) {
  const [before] = id ? await db.select().from(quotes).where(eq(quotes.id, id)).limit(1) : [];
  if (id && !before) throw new UserError("Quote not found.");
  if (before) {
    const blocked = quoteEditBlocker(before);
    if (blocked) throw new UserError(blocked);
    if (before.customerId !== input.customerId) throw new UserError("A quote stays with its customer. Copy it to quote someone else.");
  }
  const lines = check(input, today, before?.validUntil);
  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, input.customerId)).limit(1);
  if (!customer) throw new UserError("Choose a customer.");
  const items = await itemsFor(db, lines);
  const totals = orderTotals(items, input.deliveryFeeCents);
  const details = { validUntil: input.validUntil, notes: input.notes, internalNote: input.internalNote, ...totals };

  return db.transaction(async (t) => {
    const tx = t as unknown as DB;
    let q: typeof quotes.$inferSelect;
    if (before) {
      [q] = await tx.update(quotes).set({ ...details, updatedAt: new Date() }).where(eq(quotes.id, before.id)).returning();
      await tx.delete(quoteItems).where(eq(quoteItems.quoteId, before.id));
    } else {
      [q] = await tx
        .insert(quotes)
        .values({ number: nextNumber("QT-", quoteNo.seqName!), customerId: customer.id, createdBy: userId, ...details })
        .returning();
    }
    await tx.insert(quoteItems).values(items.map((it) => ({ ...it, quoteId: q.id })));
    return q;
  });
}

export async function quoteWithItems(db: DB, id: string) {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
  if (!q) return null;
  const items = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, id)).orderBy(asc(quoteItems.position));
  return { quote: q, items };
}

/**
 * The quote a new sales order is made from, checked before the order is placed: it's for this
 * customer and hasn't already become another order (a retry of the same order is fine).
 */
export async function quoteForOrder(db: DB, quoteId: string, customerId: string, idempotencyKey: string) {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!q) throw new UserError("That quote no longer exists.");
  if (q.customerId !== customerId) throw new UserError("The quote is for a different customer.");
  if (q.salesOrderId) {
    const [so] = await db.select({ number: salesOrders.number, key: salesOrders.idempotencyKey }).from(salesOrders).where(eq(salesOrders.id, q.salesOrderId)).limit(1);
    if (so && so.key !== idempotencyKey) throw new UserError(`Quote ${q.number} has already become order ${so.number}.`);
  }
  return q;
}

/** Marks the quote accepted and links it to the order it became. */
export async function linkQuoteToOrder(db: DB, quoteId: string, salesOrderId: string) {
  await db
    .update(quotes)
    .set({ status: "accepted", salesOrderId, acceptedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(quotes.id, quoteId), or(isNull(quotes.salesOrderId), eq(quotes.salesOrderId, salesOrderId))));
}

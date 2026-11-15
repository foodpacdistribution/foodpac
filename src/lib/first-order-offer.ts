import "server-only";
import { and, eq, isNull, ne } from "drizzle-orm";
import { applyCreditToOrder, creditBalance, postCredit } from "./credit";
import type { DB } from "./db";
import { customers, salesOrders } from "./db/schema";
import { UserError } from "./planning";

// A first-order offer ("$30 off your first order over $200") to get a newly signed store ordering.
// It's set when the account is opened and given as store credit on the order that qualifies, so
// it goes through the same ledger as all other credit and shows on the invoice as credit used.

/** The most a first-order offer can take off. */
export const MAX_OFFER_CENTS = 50_000;

type OfferCustomer = { id: string; firstOrderMinCents: number | null; firstOrderOffCents: number | null; firstOrderOfferOrderId: string | null };

/** The offer as it stands for this customer: null when there isn't one or it's been used. */
export function openOffer(c: OfferCustomer) {
  if (!c.firstOrderOffCents || c.firstOrderMinCents === null || c.firstOrderOfferOrderId) return null;
  return { minCents: c.firstOrderMinCents, offCents: c.firstOrderOffCents };
}

/** Checks an offer typed in when opening an account; null for "no offer". */
export function checkOffer(minCents: number | null, offCents: number | null) {
  if (!offCents) return null;
  if (minCents === null || minCents <= 0) throw new UserError("Say how much the first order has to come to for the offer.");
  if (offCents > MAX_OFFER_CENTS) throw new UserError("A first-order offer can take at most $500 off.");
  if (offCents >= minCents) throw new UserError("The offer has to be less than the order it's for.");
  return { minCents, offCents };
}

/**
 * How much the offer takes off this order, in cents: the full offer when it's still open, this is
 * their first order (nothing else placed and not cancelled) and the goods come to the minimum
 * before GST; otherwise 0. `placingOrderId` is the order being placed, when it's already saved.
 */
export async function firstOrderOfferFor(db: DB, c: OfferCustomer, subtotalCents: number, placingOrderId?: string) {
  const offer = openOffer(c);
  if (!offer || subtotalCents < offer.minCents) return 0;
  const [earlier] = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(and(eq(salesOrders.customerId, c.id), ne(salesOrders.status, "cancelled"), ...(placingOrderId ? [ne(salesOrders.id, placingOrderId)] : [])))
    .limit(1);
  return earlier ? 0 : offer.offCents;
}

/** Inside the order's transaction: gives the offer as store credit, spends it on the order, and marks it used. */
export async function useFirstOrderOffer(tx: DB, so: { id: string; number: string; customerId: string }, offCents: number, by: string | null) {
  // Only one order can take it, even if two are placed at once.
  const [taken] = await tx
    .update(customers)
    .set({ firstOrderOfferOrderId: so.id })
    .where(and(eq(customers.id, so.customerId), isNull(customers.firstOrderOfferOrderId)))
    .returning({ id: customers.id });
  if (!taken) return 0;
  await postCredit(tx, { customerId: so.customerId, type: "promotion_credit", amount: offCents / 100, sourceType: "sales_order", sourceId: so.id, sourceNumber: so.number, description: "First-order offer", by });
  return applyCreditToOrder(tx, so.id, offCents, by);
}

/**
 * The order that used the offer was cancelled: its credit came back to the customer with the
 * rest, so the offer's share is taken off again, and the offer is open for their next first order.
 */
export async function returnFirstOrderOffer(tx: DB, so: { id: string; number: string; customerId: string }, by: string | null) {
  const [c] = await tx
    .select({ off: customers.firstOrderOffCents })
    .from(customers)
    .where(and(eq(customers.id, so.customerId), eq(customers.firstOrderOfferOrderId, so.id)))
    .for("update");
  if (!c) return;
  const back = Math.min(Math.round((await creditBalance(tx, so.customerId)) * 100), c.off ?? 0);
  if (back > 0) await postCredit(tx, { customerId: so.customerId, type: "credit_reversal", amount: -back / 100, sourceType: "sales_order", sourceId: so.id, sourceNumber: so.number, description: "First-order offer: order cancelled", by });
  await tx.update(customers).set({ firstOrderOfferOrderId: null }).where(eq(customers.id, so.customerId));
}

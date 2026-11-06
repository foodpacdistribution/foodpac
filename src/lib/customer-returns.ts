import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "./db";
import {
  customerReturnItems,
  customerReturnNo,
  customerReturns,
  type CustomerRefundMethod,
  type CustomerReturnReason,
  type CustomerReturnResolution,
  orders,
  type ReturnedCondition,
  salesOrderItems,
  salesOrders,
} from "./db/schema";
import { postCredit } from "./credit";
import { CUSTOMER_RETURN_REASON } from "./customer-return-labels";
import { UserError } from "./planning";
import { guarded, nextNumber } from "./purchasing/common";
import { lineTotal, purchaseTotals, toCents } from "./purchasing/labels";
import { fillWaiting } from "./stock-allocation";
import { refundPayment, stripeEnabled, getCheckoutSession } from "./stripe";

// A customer sends goods back (bought the wrong thing, doesn't want it, wrong item sent, damaged,
// faulty). Steps:
//   1. return created against a delivered order: what, how many, why, and refund/credit/exchange
//   2. goods checked in: back on the shelf (stock + ledger) or not sellable (damaged / written off)
//   3. completed: money refunded, or store credit given (exchange = credit put towards a new order)
// Submitting a return never adds stock by itself; only step 2's "restock" does.

const CUSTOMER_RETURN_REASONS = CUSTOMER_RETURN_REASON;

/** Why an order can't take a return, or null if it can. */
export async function orderReturnBlocker(db: DB, so: typeof salesOrders.$inferSelect) {
  if (so.status === "cancelled") return "This order is cancelled.";
  if (so.status !== "confirmed") return "This order isn't confirmed yet.";
  const [d] = so.deliveryOrderId ? await db.select({ status: orders.status }).from(orders).where(eq(orders.id, so.deliveryOrderId)).limit(1) : [];
  if (d?.status !== "delivered") return "Returns are for delivered orders. Before delivery, change or cancel the order instead.";
  return null;
}

/** The order's lines, with how many have already gone back on other returns. */
export async function returnableOrderLines(db: DB, salesOrderId: string, exceptReturnId?: string) {
  const items = await db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, salesOrderId));
  if (!items.length) return [];
  const used = await db
    .select({ id: customerReturnItems.salesOrderItemId, qty: sql<number>`sum(${customerReturnItems.qty})::float8` })
    .from(customerReturnItems)
    .innerJoin(customerReturns, eq(customerReturns.id, customerReturnItems.customerReturnId))
    .where(and(inArray(customerReturnItems.salesOrderItemId, items.map((i) => i.id)), ne(customerReturns.status, "cancelled"), exceptReturnId ? ne(customerReturns.id, exceptReturnId) : undefined))
    .groupBy(customerReturnItems.salesOrderItemId);
  return items.map((i) => {
    const already = Number(used.find((u) => u.id === i.id)?.qty ?? 0);
    return { ...i, alreadyReturned: already, returnable: Math.max(0, i.qty - already) };
  });
}

export type CustomerReturnInput = {
  salesOrderId: string;
  reason: CustomerReturnReason;
  resolution: CustomerReturnResolution;
  notes: string | null;
  lines: { salesOrderItemId: string; qty: number }[];
};

/** Step 1: record what the customer is sending back and how they'll be paid back. Stock doesn't change. */
export async function createCustomerReturn(db: DB, userId: string, input: CustomerReturnInput) {
  if (!(input.reason in CUSTOMER_RETURN_REASONS)) throw new UserError("Choose why it's coming back.");
  if (!["refund", "credit", "exchange"].includes(input.resolution)) throw new UserError("Choose refund, store credit or exchange.");
  const lines = input.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new UserError("Choose at least one product and how many are coming back.");
  if (lines.some((l) => !Number.isInteger(l.qty))) throw new UserError("Quantities must be whole numbers.");
  return guarded(() =>
    db.transaction(async (t) => {
      const tx = t as unknown as DB;
      const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, input.salesOrderId)).for("update");
      if (!so) throw new UserError("Order not found.");
      const blocked = await orderReturnBlocker(tx, so);
      if (blocked) throw new UserError(blocked);
      // Money back only makes sense once they've paid; on account, store credit takes it off what they owe.
      if (input.resolution === "refund" && so.paymentStatus !== "paid") throw new UserError("This order hasn't been paid, so there's nothing to refund. Give store credit instead and apply it to the order.");
      const available = await returnableOrderLines(tx, so.id);
      const items = lines.map((l) => {
        const a = available.find((x) => x.id === l.salesOrderItemId);
        if (!a) throw new UserError("A product isn't on this order.");
        if (l.qty > a.returnable) throw new UserError(`${a.sku}: only ${a.returnable} of the ${a.qty} ordered can still come back.`);
        const unitPrice = a.unitPriceCents / 100;
        return { salesOrderItemId: a.id, productId: a.productId, sku: a.sku, name: a.name, unit: a.unit, qty: l.qty, unitPrice, gst: a.gst, lineTotal: lineTotal(l.qty, unitPrice) };
      });
      const totals = purchaseTotals(items);
      const [r] = await tx
        .insert(customerReturns)
        .values({ returnNumber: nextNumber("CR-", customerReturnNo.seqName!), salesOrderId: so.id, customerId: so.customerId, reason: input.reason, resolution: input.resolution, notes: input.notes, ...totals, createdBy: userId })
        .returning();
      await tx.insert(customerReturnItems).values(items.map((it) => ({ ...it, customerReturnId: r.id })));
      return r;
    }),
  );
}

/**
 * Step 2: the warehouse checks what came back. Restocked goods go back on the shelf (the database
 * trigger adds the stock and writes the ledger) and go to anyone waiting for them; damaged or
 * written-off goods are recorded but never become sellable. 0 received is fine (e.g. kept by the customer).
 */
export async function receiveCustomerReturn(db: DB, userId: string, id: string, lines: { id: string; receivedQty: number; condition: ReturnedCondition }[]) {
  return guarded(() =>
    db.transaction(async (t) => {
      const tx = t as unknown as DB;
      const [r] = await tx.select().from(customerReturns).where(eq(customerReturns.id, id)).for("update");
      if (!r) throw new UserError("Return not found.");
      if (r.status !== "requested") throw new UserError("These goods have already been checked in.");
      const items = await tx.select().from(customerReturnItems).where(eq(customerReturnItems.customerReturnId, id));
      // Parent first: the restock trigger records who did it.
      await tx.update(customerReturns).set({ status: "received", receivedBy: userId, receivedAt: new Date() }).where(eq(customerReturns.id, id));
      const restocked: (string | null)[] = [];
      for (const it of items) {
        const l = lines.find((x) => x.id === it.id) ?? { receivedQty: 0, condition: "damaged" as const };
        if (!Number.isInteger(l.receivedQty) || l.receivedQty < 0 || l.receivedQty > it.qty) throw new UserError(`${it.sku}: received must be between 0 and ${it.qty}.`);
        if (!["restock", "damaged", "write_off"].includes(l.condition)) throw new UserError("Choose what happens to each product.");
        const back = l.condition === "restock" ? l.receivedQty : 0;
        await tx.update(customerReturnItems).set({ receivedQty: l.receivedQty, condition: l.condition, restockedQty: back }).where(eq(customerReturnItems.id, it.id));
        if (back > 0) restocked.push(it.productId);
      }
      const filled = await fillWaiting(tx, restocked);
      return { r, filled };
    }),
  );
}

/** Step 3: pay the customer back. Refund = money out (card refunds go through Stripe); credit / exchange = store credit. */
export async function completeCustomerReturn(db: DB, userId: string, id: string, refund?: { method: CustomerRefundMethod; reference: string | null }) {
  return guarded(() =>
    db.transaction(async (t) => {
      const tx = t as unknown as DB;
      const [r] = await tx.select().from(customerReturns).where(eq(customerReturns.id, id)).for("update");
      if (!r) throw new UserError("Return not found.");
      if (r.status === "requested") throw new UserError("Check the goods in first.");
      if (r.status !== "received") throw new UserError("This return is already completed.");
      if (r.resolution === "refund") {
        if (!refund) throw new UserError("Choose how the money went back.");
        const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, r.salesOrderId)).limit(1);
        let reference = refund.reference;
        // A card order paid through Stripe is refunded there, for just this amount.
        if (refund.method === "card" && so?.paymentMethod === "card" && so.stripeSessionId && stripeEnabled()) {
          const session = await getCheckoutSession(so.stripeSessionId);
          if (!session.payment_intent) throw new UserError("Stripe has no payment for this order to refund.");
          const re = await refundPayment(session.payment_intent, toCents(r.total)).catch((e: Error) => {
            throw new UserError(`The card refund didn't go through: ${e.message.replace(/^Stripe: /, "")}`);
          });
          reference = `Stripe ${re.id}`;
        }
        await tx
          .update(customerReturns)
          .set({ status: "completed", refundAmount: r.total, refundMethod: refund.method, refundReference: reference, completedBy: userId, completedAt: new Date() })
          .where(eq(customerReturns.id, id));
      } else {
        await postCredit(tx, {
          customerId: r.customerId,
          type: "return_credit",
          amount: r.total,
          sourceType: "customer_return",
          sourceId: r.id,
          sourceNumber: r.returnNumber,
          description: r.resolution === "exchange" ? "Exchange: towards replacement goods" : "Returned goods",
          by: userId,
        });
        await tx.update(customerReturns).set({ status: "completed", creditAmount: r.total, completedBy: userId, completedAt: new Date() }).where(eq(customerReturns.id, id));
      }
      return r;
    }),
  );
}

export async function cancelCustomerReturn(db: DB, id: string) {
  const [row] = await db.update(customerReturns).set({ status: "cancelled" }).where(and(eq(customerReturns.id, id), eq(customerReturns.status, "requested"))).returning();
  if (!row) throw new UserError("Only a return whose goods haven't been checked in can be cancelled.");
  return row;
}

/** Exchange: link the replacement order (paid with the return's credit) back to the return. */
export async function linkExchangeOrder(db: DB, returnId: string, salesOrderId: string) {
  await db.update(customerReturns).set({ exchangeOrderId: salesOrderId }).where(and(eq(customerReturns.id, returnId), eq(customerReturns.resolution, "exchange")));
}

"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { applyCreditToOrder, releaseOrderCredit } from "@/lib/credit";
import { linkExchangeOrder } from "@/lib/customer-returns";
import { finaliseInvoice, reopenInvoice } from "@/lib/invoices";
import { orderConfirmed, sendInvoice } from "@/lib/notify";
import { type FulfilmentStatus, orders, type PaymentMethod, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { aud, parseDollars } from "@/lib/money";
import { linkQuoteToOrder, quoteForOrder } from "@/lib/quotes";
import { createStaffOrder, moveSalesToDay, updateStaffOrder } from "@/lib/staff-orders";
import { inputToMinutes, todayIn } from "@/lib/time";
import { prettyDate } from "@/lib/dates";
import { refundOrExpire } from "@/lib/payments";
import { getSettings, UserError } from "@/lib/planning";
import { cancelOrder, confirmOrder, deliveryDates } from "@/lib/shop";
import { pruneEmptyRoutes } from "@/lib/shipments";
import { fillWaiting, returnStock } from "@/lib/stock-allocation";
import type { DB } from "@/lib/db";
import { geocodeOrderIds } from "@/lib/sync";

function revalidate(id?: string) {
  revalidatePath("/admin/sales");
  if (id) revalidatePath(`/admin/sales/${id}`);
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
}

async function load(id: string) {
  await assertUser(STAFF);
  const db = await getDb();
  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, id)).limit(1);
  if (!so) throw new UserError("Order not found.");
  return { db, so };
}

/** Accept a pending order without waiting for card payment (e.g. paid over the phone). Sends it to the planner. */
export async function confirmSale(id: string) {
  return attempt(async () => {
    const { db, so } = await load(id);
    if (so.status !== "pending") throw new UserError("Only pending orders can be confirmed.");
    await confirmOrder(db, id);
    after(() => orderConfirmed(id, { office: false }));
    const [after_] = await db.select({ d: salesOrders.deliveryOrderId }).from(salesOrders).where(eq(salesOrders.id, id));
    if (after_?.d) {
      const deliveryId = after_.d;
      after(async () => geocodeOrderIds(await getDb(), [deliveryId]));
    }
    revalidate(id);
    return { message: "Order confirmed and sent to the planner" };
  });
}

/** Makes the proforma the final tax invoice (locks the order), and with `email` sends it to the customer straight away. */
export async function finaliseSaleInvoice(id: string, opts: { email: boolean }) {
  return attempt(async () => {
    const { db } = await load(id);
    const so = await finaliseInvoice(db, id);
    revalidate(id);
    revalidatePath(`/portal/orders/${id}`);
    if (!opts.email) return { message: `Invoice ${so.number} is final` };
    const r = await sendInvoice(db, id);
    revalidate(id);
    if (!r.sent) throw new UserError(`Invoice ${so.number} is final, but it wasn't emailed: ${r.reason}`);
    return { message: `Invoice ${so.number} is final and emailed to ${r.to}` };
  });
}

/** Emails (or re-emails) the final invoice with the customer's statement of account. */
export async function emailSaleInvoice(id: string) {
  return attempt(async () => {
    const { db, so } = await load(id);
    const r = await sendInvoice(db, id);
    if (!r.sent) throw new UserError(r.reason);
    revalidate(id);
    return { message: `Invoice ${so.number} emailed to ${r.to}` };
  });
}

/** Turns a final invoice back into a proforma so the order can be corrected. */
export async function reopenSaleInvoice(id: string) {
  return attempt(async () => {
    const { db, so } = await load(id);
    await reopenInvoice(db, id);
    revalidate(id);
    revalidatePath(`/portal/orders/${id}`);
    return { message: `Invoice ${so.number} is a proforma again` };
  });
}

/** Pays (part of) an unpaid order with the customer's store credit. */
export async function applyOrderCredit(id: string, amount: string) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    const { db } = await load(id);
    const cents = parseDollars(String(amount ?? "").trim());
    if (!cents) throw new UserError("Enter how much credit to use.");
    const used = await db.transaction(async (tx) => applyCreditToOrder(tx as unknown as DB, id, cents, user.id));
    revalidate(id);
    revalidatePath("/admin/customers");
    return { message: `${aud(used)} store credit used on this order` };
  });
}

/** Record a bank transfer or invoice payment received. */
export async function markPaid(id: string, paid: boolean) {
  return attempt(async () => {
    const { db, so } = await load(id);
    if (so.status === "cancelled") throw new UserError("This order is cancelled.");
    if (so.paymentMethod === "card" && !paid) throw new UserError("Card payments are refunded by cancelling the order.");
    await db
      .update(salesOrders)
      .set(paid ? { paymentStatus: "paid", paidAt: new Date() } : { paymentStatus: "unpaid", paidAt: null })
      .where(eq(salesOrders.id, id));
    revalidate(id);
    return { message: paid ? "Marked as paid" : "Marked as unpaid" };
  });
}

/** Marks several bank-transfer / invoice orders as paid at once. Cancelled and card orders are skipped. */
export async function markManyPaid(ids: string[]) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    const rows = await db
      .update(salesOrders)
      .set({ paymentStatus: "paid", paidAt: new Date() })
      .where(
        and(
          inArray(salesOrders.id, ids.slice(0, 500)),
          ne(salesOrders.status, "cancelled"),
          ne(salesOrders.paymentMethod, "card"),
          eq(salesOrders.paymentStatus, "unpaid"),
        ),
      )
      .returning({ id: salesOrders.id });
    revalidate();
    return { message: `${rows.length} order${rows.length === 1 ? "" : "s"} marked as paid` };
  });
}

/** Warehouse progress: picking → packed → loaded. Applies to several orders at once from the list. */
export async function setFulfilment(ids: string[], status: FulfilmentStatus) {
  return attempt(async () => {
    await assertUser(STAFF);
    if (!["new", "picking", "packed", "loaded"].includes(status)) throw new UserError("Unknown status.");
    const db = await getDb();
    const rows = await db
      .update(salesOrders)
      .set({ fulfilment: status })
      .where(and(inArray(salesOrders.id, ids.slice(0, 500)), eq(salesOrders.status, "confirmed")))
      .returning({ id: salesOrders.id });
    revalidate(ids.length === 1 ? ids[0] : undefined);
    return { message: `${rows.length} order${rows.length === 1 ? "" : "s"} updated` };
  });
}

/**
 * Moves orders to another delivery day ("next" = the next delivery day after today's cut-off),
 * delivery and all. For orders whose day passed without a delivery, or a drop that failed.
 */
export async function moveSalesDay(ids: string[], date: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    const s = await getSettings(db);
    const today = todayIn(s.timezone);
    const day = date === "next" ? deliveryDates(s, 1)[0] : date;
    if (!day) throw new UserError("No delivery days are set up. Choose them in Settings → Online shop.");
    const r = await moveSalesToDay(db, ids, day, today);
    if (r.created.length) after(async () => geocodeOrderIds(await getDb(), r.created));
    await pruneEmptyRoutes(db, r.previousDates);
    revalidate(ids.length === 1 ? ids[0] : undefined);
    revalidatePath("/admin/planner");
    if (!r.moved) throw new UserError(r.skipped.length ? "These orders can't be moved: they're delivered, cancelled, on a van out today or already on that day." : "Order not found.");
    const to = prettyDate(day, { weekday: "short", day: "numeric", month: "short" });
    return { message: r.skipped.length ? `Moved ${r.moved} order(s) to ${to} · not moved: ${r.skipped.join(", ")}` : `Moved ${r.moved} order(s) to ${to}`, data: { day } };
  });
}

/** Cancels, gives stock back, removes the delivery from the planner and refunds card payments. */
export async function cancelSale(id: string) {
  return attempt(async () => {
    const { db, so } = await load(id);
    if (so.status === "cancelled") return { message: "Already cancelled" };
    // Cancel first (it refuses once the van has left), then refund. If the refund call fails the
    // order shows as cancelled but still paid, so staff can see it needs refunding by hand.
    await cancelOrder(db, id);
    await refundOrExpire(so);
    revalidate(id);
    return { message: so.paymentMethod === "card" && so.paymentStatus === "paid" ? "Cancelled and refunded" : "Order cancelled" };
  });
}

/**
 * Admin only: permanently deletes shop orders (e.g. test orders) with their items and their
 * delivery (stop, photo, signature). Stock goes back on the shelf unless the goods were delivered.
 */
export async function deleteSales(ids: string[]) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    if (user.role !== "admin") throw new UserError("Only an admin can delete orders.");
    const db = await getDb();
    const rows = await db.select().from(salesOrders).where(inArray(salesOrders.id, ids.slice(0, 500)));
    const dates: string[] = [];
    for (const so of rows) {
      await db.transaction(async (tx) => {
        const [d] = so.deliveryOrderId ? await tx.select().from(orders).where(eq(orders.id, so.deliveryOrderId)).limit(1) : [];
        let returned: (string | null)[] = [];
        if (so.status !== "cancelled" && d?.status !== "delivered") {
          // Only reserved units go back; anything still waiting for stock was never taken.
          const items = await tx.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, so.id));
          for (const it of items) if (it.productId) await returnStock(tx as unknown as DB, it.productId, it.qty - it.backorderQty, { number: so.number, note: "Order deleted", by: user.id });
          returned = items.map((it) => it.productId);
        }
        if (d) {
          dates.push(d.deliveryDate);
          await tx.delete(orders).where(eq(orders.id, d.id));
        }
        if (so.status !== "cancelled") await releaseOrderCredit(tx as unknown as DB, so, 0, "Order deleted", user.id);
        await tx.delete(salesOrders).where(eq(salesOrders.id, so.id));
        await fillWaiting(tx as unknown as DB, returned);
      });
    }
    await pruneEmptyRoutes(db, dates);
    revalidate();
    revalidatePath("/admin/shipments");
    revalidatePath("/admin/products");
    return { message: `Deleted ${rows.length} order${rows.length === 1 ? "" : "s"}` };
  });
}

/** What the order form sends. Checked again on the server (staff-orders.ts). */
export type StaffOrderPayload = {
  customerId: string;
  method: PaymentMethod;
  deliveryDate: string;
  recipient: string;
  phone: string;
  address: string;
  instructions: string;
  windowStart: string;
  windowEnd: string;
  notes: string;
  deliveryFee: string;
  lines: { productId: string; qty: number; unitPrice: string }[];
  emailCustomer: boolean;
  idempotencyKey: string;
  /** New orders: store credit to put towards it, in cents. */
  creditCents?: number;
  /** New orders: the customer return this is the exchange for. */
  exchangeReturnId?: string;
  /** New orders: the quote the customer accepted. */
  quoteId?: string;
};

function parsePayload(p: StaffOrderPayload) {
  const cents = (v: string, what: string) => {
    const n = parseDollars(String(v ?? "").trim() || "0");
    if (n === null) throw new UserError(`${what} must be an amount, e.g. 12.50.`);
    return n;
  };
  const text = (v: string, max: number) => String(v ?? "").trim().slice(0, max) || null;
  return {
    deliveryDate: String(p.deliveryDate ?? ""),
    recipient: String(p.recipient ?? "").slice(0, 120),
    phone: text(p.phone, 40),
    address: String(p.address ?? "").slice(0, 300),
    instructions: text(p.instructions, 500),
    windowStartMin: inputToMinutes(text(p.windowStart, 10)),
    windowEndMin: inputToMinutes(text(p.windowEnd, 10)),
    notes: text(p.notes, 1000),
    deliveryFeeCents: cents(p.deliveryFee, "Delivery fee"),
    lines: (Array.isArray(p.lines) ? p.lines : []).slice(0, 300).map((l) => ({ productId: String(l.productId), qty: Math.round(Number(l.qty)), unitPriceCents: cents(l.unitPrice, "Price") })),
  };
}

/** Staff enter an order for a customer (phone, email, or something that's out of stock and has to wait). */
export async function createOrderForCustomer(p: StaffOrderPayload) {
  return attempt<{ id: string }>(async () => {
    const user = await assertUser(STAFF);
    const db = await getDb();
    const s = await getSettings(db);
    const creditCents = Math.max(0, Math.round(Number(p.creditCents) || 0));
    const customerId = String(p.customerId ?? "");
    const idempotencyKey = String(p.idempotencyKey ?? "").slice(0, 80);
    const quoteId = p.quoteId && /^[0-9a-f-]{36}$/i.test(p.quoteId) ? p.quoteId : null;
    if (quoteId) await quoteForOrder(db, quoteId, customerId, idempotencyKey);
    const so = await createStaffOrder(db, user.id, { ...parsePayload(p), customerId, method: p.method, idempotencyKey, creditCents }, todayIn(s.timezone));
    if (quoteId) {
      await linkQuoteToOrder(db, quoteId, so.id);
      revalidatePath("/admin/quotes");
      revalidatePath(`/admin/quotes/${quoteId}`);
    }
    if (p.exchangeReturnId && /^[0-9a-f-]{36}$/i.test(p.exchangeReturnId)) await linkExchangeOrder(db, p.exchangeReturnId, so.id);
    if (so.deliveryOrderId) {
      const id = so.deliveryOrderId;
      after(async () => geocodeOrderIds(await getDb(), [id]));
    }
    if (p.emailCustomer) after(() => orderConfirmed(so.id, { office: false }));
    revalidate(so.id);
    revalidatePath("/admin/products");
    revalidatePath("/", "layout");
    return { message: `Order ${so.number} placed`, data: { id: so.id } };
  });
}

/** Staff change an order: lines, quantities, prices, delivery details. Stock follows the change. */
export async function updateOrderForCustomer(id: string, p: StaffOrderPayload) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    const s = await getSettings(db);
    const r = await updateStaffOrder(db, id, parsePayload(p), todayIn(s.timezone));
    if (r.regeocode && r.deliveryOrderId) {
      const deliveryId = r.deliveryOrderId;
      after(async () => geocodeOrderIds(await getDb(), [deliveryId]));
    }
    await pruneEmptyRoutes(db, [r.previousDate]);
    revalidate(id);
    revalidatePath("/admin/products");
    revalidatePath("/admin/planner");
    revalidatePath("/", "layout");
    return { message: "Order updated" };
  });
}

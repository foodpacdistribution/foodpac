"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { type FulfilmentStatus, salesOrders } from "@/lib/db/schema";
import { refundOrExpire } from "@/lib/payments";
import { UserError } from "@/lib/planning";
import { cancelOrder, confirmOrder } from "@/lib/shop";
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
    const [after_] = await db.select({ d: salesOrders.deliveryOrderId }).from(salesOrders).where(eq(salesOrders.id, id));
    if (after_?.d) {
      const deliveryId = after_.d;
      after(async () => geocodeOrderIds(await getDb(), [deliveryId]));
    }
    revalidate(id);
    return { message: "Order confirmed and sent to the planner" };
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

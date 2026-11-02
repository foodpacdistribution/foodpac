import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { salesOrders } from "./db/schema";
import { markCardPaid } from "./shop";
import { expireCheckoutSession, getCheckoutSession, refundPayment, stripeEnabled } from "./stripe";

/** Return from Stripe: confirm straight away if the payment went through (the webhook may lag or not be set up). */
export async function confirmCardReturn(salesOrderId: string, sessionId: string) {
  const db = await getDb();
  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, salesOrderId)).limit(1);
  if (!so || so.stripeSessionId !== sessionId || so.paymentStatus === "paid" || !stripeEnabled()) return;
  const session = await getCheckoutSession(sessionId);
  if (session.payment_status === "paid" && session.metadata?.sales_order_id === so.id) await markCardPaid(db, so.id);
}

/** Before cancelling a card order: refund it if paid, or close the open checkout so it can't be paid later. */
export async function refundOrExpire(so: typeof salesOrders.$inferSelect) {
  if (so.paymentMethod !== "card" || !so.stripeSessionId || !stripeEnabled()) return;
  const db = await getDb();
  const session = await getCheckoutSession(so.stripeSessionId);
  if (session.payment_status === "paid" && session.payment_intent) {
    await refundPayment(session.payment_intent);
    await db.update(salesOrders).set({ paymentStatus: "refunded" }).where(eq(salesOrders.id, so.id));
  } else {
    await expireCheckoutSession(so.stripeSessionId).catch(() => {});
  }
}

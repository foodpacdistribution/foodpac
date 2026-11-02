import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { salesOrders } from "@/lib/db/schema";
import { cancelOrder, markCardPaid } from "@/lib/shop";
import { verifyWebhook } from "@/lib/stripe";

/** Stripe calls this for Checkout events. Only signed events are trusted. */
export async function POST(req: Request) {
  const event = verifyWebhook(await req.text(), req.headers.get("stripe-signature"));
  if (!event) return new Response("Invalid signature", { status: 400 });

  const session = event.data.object;
  const orderId = session.metadata?.sales_order_id;
  if (!orderId) return Response.json({ ignored: true });
  const db = await getDb();

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    if (session.payment_status === "paid") await markCardPaid(db, orderId);
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1);
    // Only release the stock if the order never got paid (and is still waiting for it).
    if (so && so.status === "pending" && so.paymentStatus === "unpaid") {
      await cancelOrder(db, orderId);
      await db.update(salesOrders).set({ paymentStatus: "failed" }).where(eq(salesOrders.id, orderId));
    }
  }
  return Response.json({ received: true });
}

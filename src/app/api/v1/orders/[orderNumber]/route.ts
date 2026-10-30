import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { orders, routeStops } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { verifyApiKey } from "@/lib/sync";
import { todayIn } from "@/lib/time";

/** DELETE /api/v1/orders/{orderNumber}?date=YYYY-MM-DD — cancel an order that hasn't been delivered. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/v1/orders/[orderNumber]">) {
  const db = await getDb();
  if (!(await verifyApiKey(db, req))) return Response.json({ error: "Missing or invalid API key" }, { status: 401 });
  const { orderNumber } = await ctx.params;
  const s = await getSettings(db);
  const date = new URL(req.url).searchParams.get("date") ?? todayIn(s.timezone);

  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderNumber, decodeURIComponent(orderNumber)), eq(orders.deliveryDate, date)))
    .limit(1);
  if (!o) return Response.json({ error: "Order not found" }, { status: 404 });
  if (o.status === "delivered" || o.status === "failed") {
    return Response.json({ error: `Order already ${o.status}; it can't be cancelled` }, { status: 409 });
  }
  // Removing the order also removes its pending stop; the dispatcher re-optimises to tighten the route.
  await db.delete(routeStops).where(and(eq(routeStops.orderId, o.id), eq(routeStops.status, "pending")));
  await db.delete(orders).where(eq(orders.id, o.id));
  return Response.json({ cancelled: o.orderNumber, wasDispatched: o.status === "dispatched" });
}

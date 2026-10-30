import { asc, eq } from "drizzle-orm";
import { getCurrentUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { deliveryEvents, deliveryProofs, drivers, orders } from "@/lib/db/schema";

/** Timeline of driver events for one order, with proof-of-delivery images. */
export async function GET(_req: Request, ctx: RouteContext<"/api/orders/[id]/record">) {
  const user = await getCurrentUser();
  if (!user || !STAFF.includes(user.role)) return new Response("Unauthorised", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const db = await getDb();
  const [order] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) return new Response("Not found", { status: 404 });

  const events = await db
    .select({ e: deliveryEvents, driverName: drivers.name })
    .from(deliveryEvents)
    .leftJoin(drivers, eq(drivers.id, deliveryEvents.driverId))
    .where(eq(deliveryEvents.orderId, id))
    .orderBy(asc(deliveryEvents.createdAt));
  const proofs = await db
    .select({ id: deliveryProofs.id, eventId: deliveryProofs.eventId, kind: deliveryProofs.kind })
    .from(deliveryProofs)
    .where(eq(deliveryProofs.orderId, id));

  return Response.json({
    events: events.map(({ e, driverName }) => ({
      id: e.id,
      type: e.type,
      at: e.createdAt.toISOString(),
      driverName,
      recipient: e.recipient,
      reason: e.reason,
      note: e.note,
      proofs: proofs.filter((p) => p.eventId === e.id).map((p) => ({ id: p.id, kind: p.kind })),
    })),
  });
}

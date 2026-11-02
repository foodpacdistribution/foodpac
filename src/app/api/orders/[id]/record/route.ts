import { asc, eq } from "drizzle-orm";
import { getCurrentUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { deliveryEvents, deliveryProofs, drivers, orders } from "@/lib/db/schema";
import { haversine } from "@/lib/geo/routing";
import { sha256 } from "@/lib/proofs";

/** Timeline of driver events for one order, with proof-of-delivery images. */
export async function GET(_req: Request, ctx: RouteContext<"/api/orders/[id]/record">) {
  const user = await getCurrentUser();
  if (!user || !STAFF.includes(user.role)) return new Response("Unauthorised", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const db = await getDb();
  const [order] = await db.select({ id: orders.id, lat: orders.lat, lng: orders.lng }).from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) return new Response("Not found", { status: 404 });

  const events = await db
    .select({ e: deliveryEvents, driverName: drivers.name })
    .from(deliveryEvents)
    .leftJoin(drivers, eq(drivers.id, deliveryEvents.driverId))
    .where(eq(deliveryEvents.orderId, id))
    .orderBy(asc(deliveryEvents.createdAt));
  const proofs = await db
    .select({ id: deliveryProofs.id, eventId: deliveryProofs.eventId, kind: deliveryProofs.kind, data: deliveryProofs.data, sha256: deliveryProofs.sha256, at: deliveryProofs.createdAt })
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
      place:
        e.lat !== null && e.lng !== null
          ? {
              lat: e.lat,
              lng: e.lng,
              accuracyM: e.accuracyM,
              distanceM: order.lat !== null && order.lng !== null ? Math.round(haversine(order as { lat: number; lng: number }, e as { lat: number; lng: number })) : null,
            }
          : null,
      // Re-hash the stored image: "intact" means it's byte-for-byte what the driver uploaded.
      proofs: proofs
        .filter((p) => p.eventId === e.id)
        .map((p) => ({ id: p.id, kind: p.kind, at: p.at.toISOString(), sha256: p.sha256, intact: p.sha256 ? sha256(p.data) === p.sha256 : null })),
    })),
  });
}

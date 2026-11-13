import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { DB } from "./db";
import { deliveryEvents, deliveryProofs, orders, plans, routes, routeStops } from "./db/schema";
import { shownAddress } from "./geo/geocode";
import { haversine } from "./geo/routing";

export type HistoryItem = {
  stopId: string;
  status: "delivered" | "failed";
  completedAt: string;
  orderNumber: string;
  customerName: string;
  address: string;
  recipient: string | null;
  reason: string | null;
  note: string | null;
  /** How far from the address the outcome was confirmed (GPS), if recorded. */
  placeM: number | null;
  /** Taken at the door first, then any added later. */
  photoIds: string[];
  signatureId: string | null;
};

export type HistoryDay = { date: string; shipment: string; delivered: number; failed: number; items: HistoryItem[] };

/** One driver's finished stops since `from` (YYYY-MM-DD), newest day first, with proof of delivery. */
export async function driverHistory(db: DB, driverId: string, from: string): Promise<HistoryDay[]> {
  const rows = await db
    .select({ stop: routeStops, order: orders, date: plans.deliveryDate, number: routes.number })
    .from(routeStops)
    .innerJoin(routes, eq(routes.id, routeStops.routeId))
    .innerJoin(plans, eq(plans.id, routes.planId))
    .innerJoin(orders, eq(orders.id, routeStops.orderId))
    .where(and(eq(routes.driverId, driverId), gte(plans.deliveryDate, from), inArray(routeStops.status, ["delivered", "failed"])))
    .orderBy(desc(plans.deliveryDate), desc(routeStops.completedAt));
  if (!rows.length) return [];

  const orderIds = rows.map((r) => r.order.id);
  const events = await db
    .select()
    .from(deliveryEvents)
    .where(and(inArray(deliveryEvents.orderId, orderIds), eq(deliveryEvents.driverId, driverId), inArray(deliveryEvents.type, ["delivered", "failed"])))
    .orderBy(desc(deliveryEvents.createdAt));
  const proofs = events.length
    ? await db
        .select({ id: deliveryProofs.id, eventId: deliveryProofs.eventId, kind: deliveryProofs.kind, at: deliveryProofs.createdAt })
        .from(deliveryProofs)
        .where(inArray(deliveryProofs.eventId, events.map((e) => e.id)))
    : [];

  const days = new Map<string, HistoryDay>();
  for (const { stop, order, date, number } of rows) {
    // The event closest in time to this stop's completion (an order can be attempted more than once).
    const ev = events
      .filter((e) => e.orderId === order.id)
      .sort((a, b) => Math.abs(a.createdAt.getTime() - (stop.completedAt?.getTime() ?? 0)) - Math.abs(b.createdAt.getTime() - (stop.completedAt?.getTime() ?? 0)))[0];
    const own = ev ? proofs.filter((p) => p.eventId === ev.id) : [];
    const day = days.get(date) ?? { date, shipment: number, delivered: 0, failed: 0, items: [] };
    const status = stop.status as "delivered" | "failed";
    day[status] += 1;
    day.items.push({
      stopId: stop.id,
      status,
      completedAt: (stop.completedAt ?? ev?.createdAt ?? new Date()).toISOString(),
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      address: shownAddress(order),
      recipient: ev?.recipient ?? null,
      reason: ev?.reason ?? null,
      note: ev?.note ?? null,
      placeM:
        ev && ev.lat !== null && ev.lng !== null && order.lat !== null && order.lng !== null
          ? Math.round(haversine({ lat: ev.lat, lng: ev.lng }, { lat: order.lat, lng: order.lng }))
          : null,
      photoIds: own.filter((p) => p.kind === "photo").sort((a, b) => a.at.getTime() - b.at.getTime()).map((p) => p.id),
      signatureId: own.find((p) => p.kind === "signature")?.id ?? null,
    });
    days.set(date, day);
  }
  return [...days.values()];
}

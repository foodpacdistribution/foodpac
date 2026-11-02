import "server-only";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { DB } from "./db";
import { deliveryEvents, deliveryProofs, drivers, type OrderStatus, orders, plans, routes, routeStops, vehicleLocations } from "./db/schema";
import { haversine } from "./geo/routing";
import { depotFor, getDepots } from "./planning";
import { nowSecondsIn } from "./time";
import { STALE_AFTER_S } from "./tracking";

// Read model for the customer portal. Every query is scoped to one customer's orders.
// Customers never see other customers' stops: while the van is out they get a count of
// stops before theirs, and the live van position and driven trail are only shown for the
// final leg to their own address.

/** What the customer sees, in order. */
export type PortalStage = "received" | "scheduled" | "out_for_delivery" | "delivered" | "failed";

export const STAGES: { key: Exclude<PortalStage, "failed">; label: string }[] = [
  { key: "received", label: "Order received" },
  { key: "scheduled", label: "Scheduled" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
];

type StopRow = {
  stop: typeof routeStops.$inferSelect;
  route: typeof routes.$inferSelect;
  plan: typeof plans.$inferSelect;
  driverName: string;
  driverDepotId: string | null;
};

function stageOf(status: OrderStatus, s: StopRow | undefined): PortalStage {
  if (status === "delivered") return "delivered";
  if (status === "failed") return "failed";
  if (s && s.route.dispatchedAt && s.route.status === "in_progress" && s.stop.status === "pending") return "out_for_delivery";
  if (status === "planned" || status === "dispatched") return "scheduled";
  return "received";
}

/** The newest stop for each order on its delivery day (a failed order rescheduled to another day gets a new one). */
async function stopsFor(db: DB, orderRows: { id: string; deliveryDate: string }[]) {
  if (!orderRows.length) return new Map<string, StopRow>();
  const rows = await db
    .select({ stop: routeStops, route: routes, plan: plans, driverName: drivers.name, driverDepotId: drivers.depotId })
    .from(routeStops)
    .innerJoin(routes, eq(routes.id, routeStops.routeId))
    .innerJoin(plans, eq(plans.id, routes.planId))
    .innerJoin(drivers, eq(drivers.id, routes.driverId))
    .where(inArray(routeStops.orderId, orderRows.map((o) => o.id)));
  const byOrder = new Map<string, StopRow>();
  for (const o of orderRows) {
    const r = rows.find((x) => x.stop.orderId === o.id && x.plan.deliveryDate === o.deliveryDate);
    if (r) byOrder.set(o.id, r);
  }
  return byOrder;
}

/** Planned arrival pushed back by how late the van is running (from its last completed stop, or a late start). */
async function liveEta(db: DB, s: StopRow, timeZone: string) {
  if (s.stop.status !== "pending" || s.route.status !== "in_progress") return { etaS: s.stop.etaS, stopsBefore: null as number | null };
  const all = await db.select().from(routeStops).where(eq(routeStops.routeId, s.route.id)).orderBy(asc(routeStops.seq));
  const before = all.filter((x) => x.seq < s.stop.seq);
  const stopsBefore = before.filter((x) => x.status === "pending").length;
  const lastDone = [...before].reverse().find((x) => x.completedAt);
  let delayS = 0;
  if (lastDone?.completedAt) delayS = nowSecondsIn(timeZone, lastDone.completedAt) - lastDone.etdS;
  else if (s.route.startedAt) delayS = nowSecondsIn(timeZone, s.route.startedAt) - s.route.startS;
  const etaS = Math.max(s.stop.etaS + Math.max(0, delayS), nowSecondsIn(timeZone));
  return { etaS, stopsBefore, legStartedAt: lastDone?.completedAt ?? s.route.startedAt };
}

export async function listPortalOrders(db: DB, customerId: string, today: string, days = 60) {
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - days);
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.customerId, customerId), gte(orders.deliveryDate, from.toISOString().slice(0, 10))))
    .orderBy(desc(orders.deliveryDate), asc(orders.orderNumber))
    .limit(200);
  const stops = await stopsFor(db, rows);
  return rows.map((o) => {
    const s = stops.get(o.id);
    const dispatched = !!s?.route.dispatchedAt;
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      deliveryDate: o.deliveryDate,
      address: o.address,
      stage: stageOf(o.status, s),
      // ETAs are only shown once the plan is final and sent to drivers.
      etaS: dispatched && s.stop.status === "pending" ? s.stop.etaS : null,
      completedAt: s?.stop.completedAt?.toISOString() ?? null,
    };
  });
}

export type PortalOrder = NonNullable<Awaited<ReturnType<typeof getPortalOrder>>>;

export async function getPortalOrder(db: DB, customerId: string, orderId: string, timeZone: string) {
  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.customerId, customerId)))
    .limit(1);
  if (!o) return null;
  const s = (await stopsFor(db, [o])).get(o.id);
  const stage = stageOf(o.status, s);
  const dispatched = !!s?.route.dispatchedAt;
  const live = s && dispatched ? await liveEta(db, s, timeZone) : null;

  const events = await db.select().from(deliveryEvents).where(eq(deliveryEvents.orderId, o.id)).orderBy(desc(deliveryEvents.createdAt));
  const outcome = events.find((e) => e.type === "delivered" || e.type === "failed") ?? null;
  const proofs = outcome
    ? await db.select({ id: deliveryProofs.id, kind: deliveryProofs.kind }).from(deliveryProofs).where(eq(deliveryProofs.eventId, outcome.id))
    : [];

  const address = o.lat !== null && o.lng !== null ? { lat: o.lat, lng: o.lng } : null;
  const place =
    outcome && outcome.lat !== null && outcome.lng !== null
      ? {
          lat: outcome.lat,
          lng: outcome.lng,
          accuracyM: outcome.accuracyM,
          distanceM: address ? Math.round(haversine(address, { lat: outcome.lat, lng: outcome.lng })) : null,
        }
      : null;

  // Final leg only: from when the driver left the previous stop (or the depot) to this delivery.
  let trail: [number, number][] = [];
  let van: { lat: number; lng: number; heading: number | null; ageS: number; stale: boolean } | null = null;
  if (s && dispatched) {
    const legFrom =
      stage === "out_for_delivery" && live?.stopsBefore === 0
        ? (live.legStartedAt ?? null)
        : stage === "delivered" || stage === "failed"
          ? await previousCompletion(db, s)
          : null;
    if (legFrom) {
      const legTo = s.stop.completedAt ?? new Date();
      const fixes = await db
        .select({ lat: vehicleLocations.lat, lng: vehicleLocations.lng, accuracyM: vehicleLocations.accuracyM, heading: vehicleLocations.heading, at: vehicleLocations.recordedAt })
        .from(vehicleLocations)
        .where(and(eq(vehicleLocations.routeId, s.route.id), gte(vehicleLocations.recordedAt, legFrom), lte(vehicleLocations.recordedAt, legTo)))
        .orderBy(asc(vehicleLocations.recordedAt));
      const good = fixes.filter((f) => f.accuracyM === null || f.accuracyM <= 100);
      trail = good.map((f) => [f.lat, f.lng]);
      const last = good.at(-1);
      if (stage === "out_for_delivery" && last) {
        const ageS = Math.round((Date.now() - last.at.getTime()) / 1000);
        van = { lat: last.lat, lng: last.lng, heading: last.heading, ageS, stale: ageS > STALE_AFTER_S };
      }
    }
  }

  const depot = s ? depotFor(await getDepots(db), s.driverDepotId) : null;

  return {
    id: o.id,
    orderNumber: o.orderNumber,
    deliveryDate: o.deliveryDate,
    address: o.address,
    point: address,
    windowStartMin: o.windowStartMin,
    windowEndMin: o.windowEndMin,
    notes: o.notes,
    stage,
    driverFirstName: s ? s.driverName.split(" ")[0] : null,
    pickedUpAt: s?.route.startedAt?.toISOString() ?? null,
    etaS: live?.etaS ?? (dispatched && s.stop.status === "pending" ? s.stop.etaS : null),
    stopsBefore: live?.stopsBefore ?? null,
    outcome: outcome
      ? {
          type: outcome.type as "delivered" | "failed",
          at: outcome.createdAt.toISOString(),
          recipient: outcome.recipient,
          reason: outcome.reason,
          note: outcome.note,
          place,
          proofs,
        }
      : null,
    trail,
    van,
    depot: depot && stage !== "received" ? { lat: depot.lat, lng: depot.lng, name: depot.name } : null,
  };
}

async function previousCompletion(db: DB, s: StopRow) {
  const [prev] = await db
    .select({ completedAt: routeStops.completedAt })
    .from(routeStops)
    .where(and(eq(routeStops.routeId, s.route.id), lte(routeStops.seq, s.stop.seq - 1)))
    .orderBy(desc(routeStops.seq))
    .limit(1);
  return prev?.completedAt ?? s.route.startedAt;
}

export type PodStatus = "pending" | "signed" | "photo" | "not_obtained";

/** Delivery stage and proof-of-delivery status for the delivery orders behind sales orders. */
export async function deliveryStatuses(db: DB, ids: string[]) {
  const out = new Map<string, { stage: PortalStage; pod: PodStatus }>();
  if (!ids.length) return out;
  const rows = await db.select({ id: orders.id, deliveryDate: orders.deliveryDate, status: orders.status }).from(orders).where(inArray(orders.id, ids));
  const stops = await stopsFor(db, rows);
  const proofs = await db
    .select({ orderId: deliveryProofs.orderId, kind: deliveryProofs.kind })
    .from(deliveryProofs)
    .innerJoin(deliveryEvents, eq(deliveryEvents.id, deliveryProofs.eventId))
    .where(and(inArray(deliveryProofs.orderId, ids), eq(deliveryEvents.type, "delivered")));
  for (const o of rows) {
    const stage = stageOf(o.status, stops.get(o.id));
    const kinds = proofs.filter((p) => p.orderId === o.id).map((p) => p.kind);
    const pod: PodStatus = stage !== "delivered" ? "pending" : kinds.includes("signature") ? "signed" : kinds.includes("photo") ? "photo" : "not_obtained";
    out.set(o.id, { stage, pod });
  }
  return out;
}

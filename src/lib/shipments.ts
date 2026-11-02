import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "./db";
import { drivers, orders, plans, routes, routeStops, salesOrders } from "./db/schema";
import { type LatLng, routeGeometry, travelMatrix } from "./geo/routing";
import { depotFor, getDepots, getSettings, refreshPlanSummary, UserError } from "./planning";
import { evaluateRoute } from "./vrp/evaluate";
import { solve } from "./vrp/solver";
import type { Job, Problem, Vehicle } from "./vrp/types";

// A shipment is one driver's route for a day: the orders you hand them, in the best order,
// with a docket to print. Unlike the Route Planner (which re-plans the whole day across all
// drivers), shipments are built and sent one driver at a time and never touch other routes.

export const MAX_SHIPMENT_STOPS = 80;

/**
 * Creates the driver's shipment for the day, or adds orders to it if they already have one
 * that hasn't started. The stop order is optimised with real road times, delivery windows,
 * unload times and vehicle capacity, starting and (optionally) ending at the driver's depot.
 */
export async function buildShipment(db: DB, date: string, driverId: string, addOrderIds: string[], removeOrderIds: string[] = []) {
  const s = await getSettings(db);
  const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  if (!driver || !driver.active) throw new UserError("Choose an active driver.");
  const depot = depotFor(await getDepots(db), driver.depotId);
  if (!depot) throw new UserError("Add a depot address in Settings first: shipments start from the depot.");

  const [plan] = await db.select().from(plans).where(eq(plans.deliveryDate, date)).limit(1);
  const [route] = plan ? await db.select().from(routes).where(and(eq(routes.planId, plan.id), eq(routes.driverId, driverId))).limit(1) : [];
  if (route && route.status !== "planned") throw new UserError(`${driver.name} has already started this shipment. Use the Route Planner to change a route that's on the road.`);

  const current = route ? (await db.select({ orderId: routeStops.orderId }).from(routeStops).where(eq(routeStops.routeId, route.id))).map((r) => r.orderId) : [];
  const wanted = [...new Set([...current.filter((id) => !removeOrderIds.includes(id)), ...addOrderIds])];
  if (wanted.length > MAX_SHIPMENT_STOPS) throw new UserError(`A shipment can hold up to ${MAX_SHIPMENT_STOPS} stops.`);

  const rows = wanted.length ? await db.select().from(orders).where(inArray(orders.id, wanted)) : [];
  for (const id of addOrderIds) {
    const o = rows.find((r) => r.id === id);
    if (!o) throw new UserError("An order no longer exists. Reload the page.");
    if (o.deliveryDate !== date) throw new UserError(`Order ${o.orderNumber} is for another day.`);
    if (o.status !== "pending") throw new UserError(`Order ${o.orderNumber} is already in a shipment.`);
    if (o.lat === null || o.lng === null) throw new UserError(`Order ${o.orderNumber}'s address hasn't been located yet. Verify it on the Orders page first.`);
  }

  // Empty shipment: give the orders back and remove the route.
  if (!rows.length) {
    if (route) await deleteShipmentRoute(db, route.id);
    return null;
  }

  // ----- the single-driver routing problem -----
  const points: LatLng[] = [{ lat: depot.lat, lng: depot.lng }, ...rows.map((o) => ({ lat: o.lat!, lng: o.lng! }))];
  const matrix = await travelMatrix(points);
  const durations = matrix.durations.map((row) => row.map((d) => Math.round(d * s.trafficFactor)));
  const vehicle: Vehicle = {
    id: driver.id,
    startNode: 0,
    endNode: s.returnToDepot ? 0 : null,
    depotNode: 0,
    startTime: (driver.shiftStartMin ?? s.defaultStartMin) * 60,
    maxDuration: (driver.maxShiftMin ?? s.defaultMaxShiftMin) * 60,
    capacity: driver.capacity,
    firstTripCapacity: driver.capacity,
    maxTrips: Math.max(1, driver.maxTrips),
    reloadTime: s.reloadMin * 60,
  };
  const jobs: Job[] = rows.map((o, i) => ({
    id: o.id,
    node: i + 1,
    service: (o.serviceMin ?? s.defaultServiceMin) * 60,
    twStart: o.windowStartMin !== null ? o.windowStartMin * 60 : null,
    twEnd: o.windowEndMin !== null ? o.windowEndMin * 60 : null,
    demand: o.demand,
    priority: o.priority,
  }));
  const problem: Problem = { vehicles: [vehicle], jobs, matrix: { durations, distances: matrix.distances }, objective: "time" };
  const solution = solve(problem, { timeLimitMs: Math.min(6000, 800 + jobs.length * 80) });
  // You chose these orders for this driver, so none are dropped: any the solver couldn't fit
  // (window or shift too tight) go at the end and show as late on the docket.
  const order = solution.routes[0]?.jobIds.map((id) => jobs.findIndex((j) => j.id === id)) ?? [];
  for (let i = 0; i < jobs.length; i++) if (!order.includes(i)) order.push(i);
  const ev = evaluateRoute(problem, vehicle, order);

  const pathPts: LatLng[] = [points[0]];
  ev.stops.forEach((st, i) => {
    if (i > 0 && st.trip !== ev.stops[i - 1].trip) pathPts.push(points[0]);
    pathPts.push(points[jobs.findIndex((j) => j.id === st.jobId) + 1]);
  });
  if (s.returnToDepot) pathPts.push(points[0]);
  const geometry = await routeGeometry(pathPts);

  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(plans)
      .values({ deliveryDate: date })
      .onConflictDoUpdate({ target: plans.deliveryDate, set: { updatedAt: new Date() } })
      .returning();
    const values = {
      startS: ev.start,
      endS: ev.end,
      distanceM: ev.distance,
      driveS: ev.driveTime,
      serviceS: ev.serviceTime,
      waitS: ev.waitTime,
      overtimeS: ev.overtime,
      overCapacity: ev.overCapacity,
      trips: Math.max(1, ev.trips),
      reloads: ev.reloads.map((r) => ({ afterSeq: r.afterIndex + 1, arrivalS: r.arrival, departureS: r.departure })),
      geometry,
    };
    const [r] = await tx
      .insert(routes)
      .values({ planId: p.id, driverId: driver.id, ...values })
      .onConflictDoUpdate({ target: [routes.planId, routes.driverId], set: values })
      .returning();
    await tx.delete(routeStops).where(eq(routeStops.routeId, r.id));
    await tx.insert(routeStops).values(
      ev.stops.map((st, i) => ({
        routeId: r.id,
        orderId: st.jobId,
        seq: i + 1,
        trip: st.trip,
        etaS: st.arrival,
        etdS: st.departure,
        waitS: st.wait,
        lateS: st.late,
        legDistanceM: st.legDistance,
        legDriveS: st.legDuration,
      })),
    );
    await tx
      .update(orders)
      .set({ status: r.dispatchedAt ? "dispatched" : "planned", driverId: driver.id, updatedAt: new Date() })
      .where(inArray(orders.id, rows.map((o) => o.id)));
    if (removeOrderIds.length) {
      await tx.update(orders).set({ status: "pending", driverId: null, updatedAt: new Date() }).where(inArray(orders.id, removeOrderIds));
    }
    // The planner's "unassigned" list no longer applies to orders now on a shipment.
    if (p.unassigned.length) {
      const onRoute = new Set(rows.map((o) => o.id));
      await tx.update(plans).set({ unassigned: p.unassigned.filter((u) => !onRoute.has(u.orderId)) }).where(eq(plans.id, p.id));
    }
    await refreshPlanSummary(tx as unknown as DB, p.id, date);
    return r;
  });
}

async function deleteShipmentRoute(db: DB, routeId: string) {
  const [r] = await db.select().from(routes).where(eq(routes.id, routeId)).limit(1);
  if (!r) return;
  if (r.status !== "planned") throw new UserError("This shipment has started and can't be removed.");
  const [p] = await db.select().from(plans).where(eq(plans.id, r.planId)).limit(1);
  await db.transaction(async (tx) => {
    const stopOrders = await tx.select({ orderId: routeStops.orderId }).from(routeStops).where(eq(routeStops.routeId, routeId));
    if (stopOrders.length) {
      await tx.update(orders).set({ status: "pending", driverId: null, updatedAt: new Date() }).where(inArray(orders.id, stopOrders.map((s) => s.orderId)));
    }
    await tx.delete(routes).where(eq(routes.id, routeId));
    if (p) await refreshPlanSummary(tx as unknown as DB, p.id, p.deliveryDate);
  });
}

export async function deleteShipment(db: DB, routeId: string) {
  await deleteShipmentRoute(db, routeId);
}

/** Puts the shipment on the driver's phone. Linked shop orders move to "Loaded" in the warehouse. */
export async function sendShipment(db: DB, routeId: string) {
  const [r] = await db.select().from(routes).where(eq(routes.id, routeId)).limit(1);
  if (!r) throw new UserError("Shipment not found.");
  const stopOrders = (await db.select({ orderId: routeStops.orderId }).from(routeStops).where(and(eq(routeStops.routeId, routeId), eq(routeStops.status, "pending")))).map(
    (s) => s.orderId,
  );
  if (!stopOrders.length) throw new UserError("This shipment has no stops left to deliver.");
  await db.transaction(async (tx) => {
    await tx.update(routes).set({ dispatchedAt: sql`coalesce(${routes.dispatchedAt}, now())` }).where(eq(routes.id, routeId));
    await tx.update(orders).set({ status: "dispatched", updatedAt: new Date() }).where(inArray(orders.id, stopOrders));
    await tx
      .update(salesOrders)
      .set({ fulfilment: "loaded" })
      .where(and(inArray(salesOrders.deliveryOrderId, stopOrders), eq(salesOrders.status, "confirmed")));
  });
  return r;
}

/** Takes a shipment back off the driver's phone, as long as they haven't started it. */
export async function recallShipment(db: DB, routeId: string) {
  const [r] = await db.select().from(routes).where(eq(routes.id, routeId)).limit(1);
  if (!r) throw new UserError("Shipment not found.");
  if (r.status !== "planned") throw new UserError("The driver has already started this shipment, so it can't be recalled.");
  await db.transaction(async (tx) => {
    await tx.update(routes).set({ dispatchedAt: null }).where(eq(routes.id, routeId));
    const stopOrders = await tx.select({ orderId: routeStops.orderId }).from(routeStops).where(eq(routeStops.routeId, routeId));
    if (stopOrders.length) {
      await tx.update(orders).set({ status: "planned", updatedAt: new Date() }).where(inArray(orders.id, stopOrders.map((s) => s.orderId)));
    }
    // The day as a whole is no longer fully dispatched.
    await tx.update(plans).set({ status: "draft" }).where(and(eq(plans.id, r.planId), eq(plans.status, "dispatched")));
  });
}

/** Orders for the day that aren't on any shipment yet, with their shop order (if any) for warehouse status. */
export async function readyToShip(db: DB, date: string) {
  const rows = await db
    .select({ o: orders, so: salesOrders })
    .from(orders)
    .leftJoin(salesOrders, eq(salesOrders.deliveryOrderId, orders.id))
    .where(and(eq(orders.deliveryDate, date), eq(orders.status, "pending")))
    .orderBy(asc(orders.createdAt), asc(orders.orderNumber));
  return rows.map(({ o, so }) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    address: o.address,
    located: o.lat !== null,
    geocodeStatus: o.geocodeStatus,
    windowStartMin: o.windowStartMin,
    windowEndMin: o.windowEndMin,
    demand: o.demand,
    pinnedDriverId: o.pinnedDriverId,
    fulfilment: so?.fulfilment ?? null,
    paymentStatus: so?.paymentStatus ?? null,
  }));
}

/** After orders are deleted: drop routes left with no stops and refresh those days' totals. */
export async function pruneEmptyRoutes(db: DB, dates: string[]) {
  if (!dates.length) return;
  const ps = await db.select().from(plans).where(inArray(plans.deliveryDate, [...new Set(dates)]));
  for (const p of ps) {
    const rs = await db.select({ id: routes.id }).from(routes).where(eq(routes.planId, p.id));
    for (const r of rs) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(routeStops).where(eq(routeStops.routeId, r.id));
      if (n === 0) await db.delete(routes).where(eq(routes.id, r.id));
    }
    await refreshPlanSummary(db, p.id, p.deliveryDate);
  }
}

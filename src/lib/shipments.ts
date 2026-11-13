import "server-only";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DB } from "./db";
import { drivers, orders, plans, routes, routeStops, salesOrders, vehicleLocations } from "./db/schema";
import { type LatLng, routeGeometry, travelMatrix } from "./geo/routing";
import { depotFor, getDepots, getSettings, learnTiming, refreshPlanSummary, renumberCompleted, UserError } from "./planning";
import { nowSecondsIn, todayIn } from "./time";
import { evaluateRoute } from "./vrp/evaluate";
import { solve } from "./vrp/solver";
import type { Job, Problem, Vehicle } from "./vrp/types";

// A shipment is one driver's route for a day: the orders you hand them, in the best order,
// with a docket to print. Unlike the Route Planner (which re-plans the whole day across all
// drivers), shipments are built and sent one driver at a time and never touch other routes.

export const MAX_SHIPMENT_STOPS = 80;

/**
 * Creates the driver's shipment for the day, or adds orders to the one they already have. The
 * stop order is optimised with real road times, delivery windows, unload times and vehicle
 * capacity, starting and (optionally) ending at the driver's depot. On a shipment the driver
 * has started, delivered stops stay as they are and the rest (with any new orders) is
 * re-ordered from where the driver is now, so their next stop is always the best one.
 *
 * `opts.order` keeps the stops still to do in the order given (order ids) instead of working
 * one out: the driver's own order, re-timed with road times. `opts.keepStart` keeps the route's
 * planned start for a route not yet started (else it's the driver's shift start).
 */
export async function buildShipment(
  db: DB,
  date: string,
  driverId: string,
  addOrderIds: string[],
  removeOrderIds: string[] = [],
  opts: { order?: string[]; keepStart?: boolean } = {},
) {
  const s = await getSettings(db);
  const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  if (!driver || !driver.active) throw new UserError("Choose an active driver.");
  const depot = depotFor(await getDepots(db), driver.depotId);
  if (!depot) throw new UserError("Add a depot address in Settings first: shipments start from the depot.");

  const [plan] = await db.select().from(plans).where(eq(plans.deliveryDate, date)).limit(1);
  const [route] = plan ? await db.select().from(routes).where(and(eq(routes.planId, plan.id), eq(routes.driverId, driverId))).limit(1) : [];
  const started = !!route && route.status !== "planned";

  const stopRows = route
    ? await db
        .select({ stop: routeStops, lat: orders.lat, lng: orders.lng, demand: orders.demand })
        .from(routeStops)
        .innerJoin(orders, eq(orders.id, routeStops.orderId))
        .where(eq(routeStops.routeId, route.id))
        .orderBy(asc(routeStops.seq))
    : [];
  // In the order they were really done: a driver may take a stop out of turn, and the last one
  // finished is where they are now.
  const done = stopRows
    .filter((r) => r.stop.status !== "pending")
    .sort((a, b) => (a.stop.completedAt?.getTime() ?? 0) - (b.stop.completedAt?.getTime() ?? 0) || a.stop.seq - b.stop.seq);
  if (done.some((d) => removeOrderIds.includes(d.stop.orderId))) throw new UserError("That stop has already been completed.");
  const current = stopRows.filter((r) => r.stop.status === "pending").map((r) => r.stop.orderId);
  const wanted = [...new Set([...current.filter((id) => !removeOrderIds.includes(id)), ...addOrderIds])];
  if (done.length + wanted.length > MAX_SHIPMENT_STOPS) throw new UserError(`A shipment can hold up to ${MAX_SHIPMENT_STOPS} stops.`);

  const rows = wanted.length ? await db.select().from(orders).where(inArray(orders.id, wanted)) : [];
  for (const id of addOrderIds) {
    const o = rows.find((r) => r.id === id);
    if (!o) throw new UserError("An order no longer exists. Reload the page.");
    if (o.deliveryDate !== date) throw new UserError(`Order ${o.orderNumber} is for another day.`);
    if (o.status !== "pending") throw new UserError(`Order ${o.orderNumber} is already in a shipment.`);
    if (o.lat === null || o.lng === null) throw new UserError(`Order ${o.orderNumber}'s address hasn't been located yet. Verify it on the Orders page first.`);
  }

  // Nothing left to deliver: an unstarted shipment goes away; a started one keeps its history.
  if (!rows.length) {
    if (route && !started) await deleteShipmentRoute(db, route.id);
    else if (route) await dropPendingStops(db, route.id, removeOrderIds, plan!);
    return route && started ? route : null;
  }

  // ----- where and when the driver sets off -----
  const shiftLength = (driver.maxShiftMin ?? s.defaultMaxShiftMin) * 60;
  const last = done.at(-1);
  let from: LatLng = { lat: depot.lat, lng: depot.lng };
  let startTime = route && opts.keepStart ? route.startS : (driver.shiftStartMin ?? s.defaultStartMin) * 60;
  let maxDuration = shiftLength;
  let maxTrips = Math.max(1, driver.maxTrips);
  let firstTripCapacity = driver.capacity;
  if (started) {
    // Their latest GPS fix if it's fresh, else the stop they last finished, else the depot.
    const [fix] = await db
      .select({ lat: vehicleLocations.lat, lng: vehicleLocations.lng })
      .from(vehicleLocations)
      .where(and(eq(vehicleLocations.routeId, route.id), gte(vehicleLocations.recordedAt, new Date(Date.now() - FRESH_FIX_MS))))
      .orderBy(desc(vehicleLocations.recordedAt))
      .limit(1);
    if (fix) from = fix;
    else if (last?.lat != null && last.lng != null) from = { lat: last.lat, lng: last.lng };
    const nowS = date === todayIn(s.timezone) ? nowSecondsIn(s.timezone) : 0;
    startTime = Math.max(last?.stop.etdS ?? route.startS, nowS);
    maxDuration = Math.max(0, shiftLength - (startTime - route.startS));
    if (last) {
      // Mid-trip: only what's left on the van counts for the first trip; used trips are gone.
      maxTrips = Math.max(1, maxTrips - (last.stop.trip - 1));
      if (driver.capacity !== null) {
        const used = done.filter((d) => d.stop.trip === last.stop.trip).reduce((t, d) => t + d.demand, 0);
        firstTripCapacity = Math.max(0, driver.capacity - used);
      }
    }
  }

  // ----- the single-driver routing problem: node 0 = start, 1..n = orders, n + 1 = depot -----
  const depotNode = rows.length + 1;
  const points: LatLng[] = [from, ...rows.map((o) => ({ lat: o.lat!, lng: o.lng! })), { lat: depot.lat, lng: depot.lng }];
  const [matrix, learned] = await Promise.all([travelMatrix(points), learnTiming(db, s.timezone)]);
  const trafficFactor = learned?.trafficFactor ?? s.trafficFactor;
  const durations = matrix.durations.map((row) => row.map((d) => Math.round(d * trafficFactor)));
  const vehicle: Vehicle = {
    id: driver.id,
    startNode: 0,
    endNode: s.returnToDepot ? depotNode : null,
    depotNode,
    startTime,
    maxDuration,
    capacity: driver.capacity,
    firstTripCapacity,
    maxTrips,
    reloadTime: s.reloadMin * 60,
  };
  const jobs: Job[] = rows.map((o, i) => ({
    id: o.id,
    node: i + 1,
    service: (o.serviceMin ?? learned?.serviceMin ?? s.defaultServiceMin) * 60,
    twStart: o.windowStartMin !== null ? o.windowStartMin * 60 : null,
    twEnd: o.windowEndMin !== null ? o.windowEndMin * 60 : null,
    demand: o.demand,
    priority: o.priority,
  }));
  const problem: Problem = { vehicles: [vehicle], jobs, matrix: { durations, distances: matrix.distances }, objective: "time" };
  // The order given; else the best one. You chose these orders for this driver, so none are
  // dropped: any left out (or the solver couldn't fit: window or shift too tight) go at the end
  // and show as late on the docket.
  const order = opts.order
    ? opts.order.map((id) => jobs.findIndex((j) => j.id === id)).filter((i) => i >= 0)
    : (solve(problem, { timeLimitMs: Math.min(6000, 800 + jobs.length * 80) }).routes[0]?.jobIds.map((id) => jobs.findIndex((j) => j.id === id)) ?? []);
  for (let i = 0; i < jobs.length; i++) if (!order.includes(i)) order.push(i);
  const ev = evaluateRoute(problem, vehicle, order);

  // The line on the map: what's been driven, then the new order from where the driver is.
  const depotPoint = points[depotNode];
  const pathPts: LatLng[] = started ? [depotPoint, ...done.filter((d) => d.lat !== null).map((d) => ({ lat: d.lat!, lng: d.lng! })), from] : [from];
  ev.stops.forEach((st, i) => {
    if (i > 0 && st.trip !== ev.stops[i - 1].trip) pathPts.push(depotPoint);
    pathPts.push(points[jobs.findIndex((j) => j.id === st.jobId) + 1]);
  });
  if (s.returnToDepot) pathPts.push(depotPoint);
  const geometry = await routeGeometry(pathPts);

  const tripOffset = last ? last.stop.trip - 1 : 0;
  const sum = (f: (d: (typeof done)[number]) => number) => done.reduce((t, d) => t + f(d), 0);

  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(plans)
      .values({ deliveryDate: date })
      .onConflictDoUpdate({ target: plans.deliveryDate, set: { updatedAt: new Date() } })
      .returning();
    const values = {
      startS: started ? route.startS : ev.start,
      endS: ev.end,
      distanceM: sum((d) => d.stop.legDistanceM) + ev.distance,
      driveS: sum((d) => d.stop.legDriveS) + ev.driveTime,
      serviceS: sum((d) => Math.max(0, d.stop.etdS - d.stop.etaS - d.stop.waitS)) + ev.serviceTime,
      waitS: sum((d) => d.stop.waitS) + ev.waitTime,
      overtimeS: ev.overtime,
      overCapacity: ev.overCapacity,
      trips: tripOffset + Math.max(1, ev.trips),
      reloads: [
        ...(route?.reloads ?? []).filter((r) => r.afterSeq < done.length),
        ...ev.reloads.map((r) => ({ afterSeq: done.length + r.afterIndex + 1, arrivalS: r.arrival, departureS: r.departure })),
      ],
      geometry,
      matrixSource: matrix.source,
      // Re-planned after setting off: the new plan is what the day is compared with.
      ...(started ? { plannedDurationS: ev.end - route.startS } : {}),
      // New stops on a finished route put the driver back on the road.
      ...(started ? { status: "in_progress" as const, completedAt: null } : {}),
    };
    const [r] = await tx
      .insert(routes)
      .values({ planId: p.id, driverId: driver.id, ...values })
      .onConflictDoUpdate({ target: [routes.planId, routes.driverId], set: values })
      .returning();
    // Completed stops are 1..n in the order they were done; the new ones follow from n+1 without clashing.
    await renumberCompleted(tx, done.map((d) => ({ stopId: d.stop.id, seq: d.stop.seq })));
    const newStops = ev.stops.map((st, i) => ({
      routeId: r.id,
      orderId: st.jobId,
      seq: done.length + i + 1,
      trip: tripOffset + st.trip,
      etaS: st.arrival,
      etdS: st.departure,
      waitS: st.wait,
      lateS: st.late,
      legDistanceM: st.legDistance,
      legDriveS: st.legDuration,
    }));
    // Stops that stay keep their ids, which a delivery still uploading from the driver's phone
    // points at: they're re-ordered and re-timed in place. Stops taken off go; new ones are added.
    // Delivered and failed stops are the record of what happened and aren't touched.
    const stopIdOf = new Map(stopRows.filter((x) => x.stop.status === "pending").map((x) => [x.stop.orderId, x.stop.id]));
    const kept = newStops.filter((st) => stopIdOf.has(st.orderId));
    const added = newStops.filter((st) => !stopIdOf.has(st.orderId));
    const keptOrders = new Set(kept.map((st) => st.orderId));
    const gone = [...stopIdOf].filter(([orderId]) => !keptOrders.has(orderId)).map(([, id]) => id);
    if (gone.length) await tx.delete(routeStops).where(inArray(routeStops.id, gone));
    if (kept.length) {
      await tx.execute(sql`
        update route_stops as s set seq = v.seq, trip = v.trip, eta_s = v.eta, etd_s = v.etd, wait_s = v.wait, late_s = v.late, leg_distance_m = v.dist, leg_drive_s = v.drive
        from (values ${sql.join(
          kept.map(
            (st) =>
              sql`(${stopIdOf.get(st.orderId)}::uuid, ${st.seq}::int, ${st.trip}::int, ${st.etaS}::int, ${st.etdS}::int, ${st.waitS}::int, ${st.lateS}::int, ${st.legDistanceM}::int, ${st.legDriveS}::int)`,
          ),
          sql`, `,
        )}) as v(id, seq, trip, eta, etd, wait, late, dist, drive)
        where s.id = v.id`);
    }
    if (added.length) await tx.insert(routeStops).values(added);
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

/** GPS fixes older than this don't say where the van is now. */
const FRESH_FIX_MS = 20 * 60_000;

/** A started shipment with nothing left to deliver: its remaining stops go back to "ready to ship". */
async function dropPendingStops(db: DB, routeId: string, orderIds: string[], plan: { id: string; deliveryDate: string }) {
  await db.transaction(async (tx) => {
    await tx.delete(routeStops).where(and(eq(routeStops.routeId, routeId), eq(routeStops.status, "pending")));
    if (orderIds.length) await tx.update(orders).set({ status: "pending", driverId: null, updatedAt: new Date() }).where(inArray(orders.id, orderIds));
    await tx.update(routes).set({ status: "completed", completedAt: new Date() }).where(eq(routes.id, routeId));
    await refreshPlanSummary(tx as unknown as DB, plan.id, plan.deliveryDate);
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

/**
 * Hands an order still to be delivered from one driver's shipment to another driver's, also
 * after it has been sent to the first driver's phone or they've set off. The first driver's
 * other stops keep their order (just re-timed); the order is added to the other driver's
 * shipment for the day (made if they have none). If the first shipment had been sent, the
 * order goes onto the other driver's phone too: straight away when their shipment is already
 * sent or holds only this order. A shipment of theirs not yet sent, with other orders on it,
 * stays unsent: sending it is the office's call (`sent` says which happened).
 */
export async function transferOrder(db: DB, routeId: string, orderId: string, toDriverId: string) {
  const [row] = await db
    .select({ route: routes, date: plans.deliveryDate })
    .from(routes)
    .innerJoin(plans, eq(plans.id, routes.planId))
    .where(eq(routes.id, routeId))
    .limit(1);
  if (!row) throw new UserError("Shipment not found. Reload the page.");
  const { route: from, date } = row;
  if (from.driverId === toDriverId) throw new UserError("The order is already with this driver.");

  const stops = await db.select().from(routeStops).where(eq(routeStops.routeId, from.id)).orderBy(asc(routeStops.seq));
  const stop = stops.find((st) => st.orderId === orderId);
  if (!stop) throw new UserError("That order is no longer on this shipment. Reload the page.");
  if (stop.status !== "pending") throw new UserError("That stop has already been completed.");

  // Check the other driver can take it before taking it off the first one.
  const [to] = await db.select().from(drivers).where(eq(drivers.id, toDriverId)).limit(1);
  if (!to || !to.active) throw new UserError("Choose an active driver.");
  if (!depotFor(await getDepots(db), to.depotId)) throw new UserError("Add a depot address in Settings first: shipments start from the depot.");
  const [toRoute] = await db.select().from(routes).where(and(eq(routes.planId, from.planId), eq(routes.driverId, toDriverId))).limit(1);
  if (toRoute) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(routeStops).where(eq(routeStops.routeId, toRoute.id));
    if (n + 1 > MAX_SHIPMENT_STOPS) throw new UserError(`A shipment can hold up to ${MAX_SHIPMENT_STOPS} stops.`);
  }

  const wasSent = !!from.dispatchedAt;
  const fromOrder = stops.filter((st) => st.status === "pending").map((st) => st.orderId);
  // The first driver's remaining stops stay in the order they have them (they may have arranged it).
  await buildShipment(db, date, from.driverId, [], [orderId], { order: fromOrder.filter((id) => id !== orderId), keepStart: true });

  let target: Awaited<ReturnType<typeof buildShipment>>;
  try {
    target = await buildShipment(db, date, toDriverId, [orderId]);
  } catch (e) {
    // Never leave the order off every route: put it back where it was.
    const back = await buildShipment(db, date, from.driverId, [orderId], [], { order: fromOrder, keepStart: true }).catch(() => null);
    if (back && wasSent && !back.dispatchedAt) await sendShipment(db, back.id).catch(() => {});
    throw e;
  }
  if (!target) throw new UserError("The order couldn't be added to the driver's shipment. Reload the page.");

  // Pinned to the first driver: it now belongs with the second, so re-planning doesn't move it back.
  await db.update(orders).set({ pinnedDriverId: toDriverId }).where(and(eq(orders.id, orderId), eq(orders.pinnedDriverId, from.driverId)));

  let sent = !!target.dispatchedAt;
  if (wasSent && !sent) {
    const [{ others }] = await db
      .select({ others: sql<number>`count(*)::int` })
      .from(routeStops)
      .where(and(eq(routeStops.routeId, target.id), sql`${routeStops.orderId} <> ${orderId}`));
    if (others === 0) {
      await sendShipment(db, target.id);
      sent = true;
    }
  }
  return { number: target.number, driver: to.name, sent };
}

/** "12 Smith St, Fortitude Valley QLD 4006" → "Fortitude Valley". Null when the address doesn't say. */
export function suburbOf(address: string): string | null {
  const m = /(?:^|,)\s*([^,]+?)[\s,]+(?:QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b(?:\s+\d{4})?\s*(?:,\s*Australia)?\s*$/i.exec(address.trim());
  const name = m?.[1].replace(/^\d+[a-z]?\s+/i, "").trim();
  return name ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

/**
 * Shares orders out between several drivers: who gets which is worked out like the Route Planner
 * does (road times, delivery windows, van capacity and shifts, keeping the drivers' days even),
 * counting what each already has on their shipment. Each driver's shipment is then built (or
 * added to) as usual. Orders that fit nobody stay ready to ship.
 */
export async function splitIntoShipments(db: DB, date: string, driverIds: string[], orderIds: string[]) {
  if (driverIds.length < 2) throw new UserError("Choose at least two drivers to share the orders between.");
  if (!orderIds.length) throw new UserError("Select the orders to ship.");
  const s = await getSettings(db);
  const depotList = await getDepots(db);
  if (!depotList.length) throw new UserError("Add a depot address in Settings first: shipments start from the depot.");
  const team = await db.select().from(drivers).where(and(inArray(drivers.id, driverIds), eq(drivers.active, true)));
  if (team.length < 2) throw new UserError("Choose at least two active drivers.");

  const fresh = await db.select().from(orders).where(inArray(orders.id, orderIds));
  for (const o of fresh) {
    if (o.deliveryDate !== date) throw new UserError(`Order ${o.orderNumber} is for another day.`);
    if (o.status !== "pending") throw new UserError(`Order ${o.orderNumber} is already in a shipment.`);
    if (o.lat === null || o.lng === null) throw new UserError(`Order ${o.orderNumber}'s address hasn't been located yet. Verify it on the Orders page first.`);
  }
  if (fresh.length !== new Set(orderIds).size) throw new UserError("An order no longer exists. Reload the page.");

  // What each driver already carries today counts against their van and their day.
  const [plan] = await db.select().from(plans).where(eq(plans.deliveryDate, date)).limit(1);
  const carried = plan
    ? await db
        .select({ driverId: routes.driverId, o: orders })
        .from(routeStops)
        .innerJoin(routes, eq(routes.id, routeStops.routeId))
        .innerJoin(orders, eq(orders.id, routeStops.orderId))
        .where(and(eq(routes.planId, plan.id), inArray(routes.driverId, team.map((d) => d.id)), eq(routeStops.status, "pending")))
    : [];

  const points: LatLng[] = [];
  const nodeOf = new Map<string, number>();
  const node = (key: string, p: LatLng) => {
    if (!nodeOf.has(key)) {
      nodeOf.set(key, points.length);
      points.push(p);
    }
    return nodeOf.get(key)!;
  };
  const teamIds = new Set(team.map((d) => d.id));
  const vehicles: Vehicle[] = team.map((d) => {
    const depot = depotFor(depotList, d.depotId)!;
    const n = node(`depot:${depot.id}`, depot);
    return {
      id: d.id,
      startNode: n,
      endNode: s.returnToDepot ? n : null,
      depotNode: n,
      startTime: (d.shiftStartMin ?? s.defaultStartMin) * 60,
      maxDuration: (d.maxShiftMin ?? s.defaultMaxShiftMin) * 60,
      capacity: d.capacity,
      maxTrips: Math.max(1, d.maxTrips),
      reloadTime: s.reloadMin * 60,
    };
  });
  const learned = await learnTiming(db, s.timezone);
  const job = (o: typeof orders.$inferSelect, allowed: string[] | undefined): Job => ({
    id: o.id,
    node: node(`order:${o.id}`, { lat: o.lat!, lng: o.lng! }),
    service: (o.serviceMin ?? learned?.serviceMin ?? s.defaultServiceMin) * 60,
    twStart: o.windowStartMin !== null ? o.windowStartMin * 60 : null,
    twEnd: o.windowEndMin !== null ? o.windowEndMin * 60 : null,
    demand: o.demand,
    priority: o.priority,
    allowedVehicles: allowed,
  });
  const jobs: Job[] = [
    ...carried.filter((c) => c.o.lat !== null).map((c) => job(c.o, [c.driverId])),
    // An order meant for one driver only goes to them (and stays put if they're not in the team).
    ...fresh.map((o) => job(o, o.pinnedDriverId ? [o.pinnedDriverId].filter((id) => teamIds.has(id)) : undefined)),
  ];
  const matrix = await travelMatrix(points);
  const factor = learned?.trafficFactor ?? s.trafficFactor;
  const problem: Problem = {
    vehicles,
    jobs,
    matrix: { durations: matrix.durations.map((row) => row.map((d) => Math.round(d * factor))), distances: matrix.distances },
    objective: "balanced",
  };
  const solution = solve(problem, { timeLimitMs: Math.min(8000, 1000 + jobs.length * 80) });

  const freshIds = new Set(fresh.map((o) => o.id));
  const made: { driver: string; number: string; added: number }[] = [];
  for (const r of solution.routes) {
    const mine = r.jobIds.filter((id) => freshIds.has(id));
    if (!mine.length) continue;
    const route = await buildShipment(db, date, r.vehicleId, mine);
    if (route) made.push({ driver: team.find((d) => d.id === r.vehicleId)!.name, number: route.number, added: mine.length });
  }
  const left = fresh.length - made.reduce((n, m) => n + m.added, 0);
  return { made, left, matrixSource: matrix.source };
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
    lat: o.lat,
    lng: o.lng,
    suburb: o.suburb?.trim() || suburbOf(o.address),
    geocodeStatus: o.geocodeStatus,
    windowStartMin: o.windowStartMin,
    windowEndMin: o.windowEndMin,
    demand: o.demand,
    pinnedDriverId: o.pinnedDriverId,
    fulfilment: so?.fulfilment ?? null,
    paymentStatus: so?.paymentStatus ?? null,
  }));
}

/**
 * After orders are deleted: drop routes left with no stops and refresh those days' totals.
 * A plan with no routes left is deleted too, so test days don't linger in History.
 */
export async function pruneEmptyRoutes(db: DB, dates: string[]) {
  if (!dates.length) return;
  const ps = await db.select().from(plans).where(inArray(plans.deliveryDate, [...new Set(dates)]));
  for (const p of ps) {
    const rs = await db.select({ id: routes.id }).from(routes).where(eq(routes.planId, p.id));
    let left = rs.length;
    for (const r of rs) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(routeStops).where(eq(routeStops.routeId, r.id));
      if (n === 0) {
        await db.delete(routes).where(eq(routes.id, r.id));
        left--;
      }
    }
    if (left === 0) {
      await db.delete(plans).where(eq(plans.id, p.id));
      continue;
    }
    await refreshPlanSummary(db, p.id, p.deliveryDate);
    // Stops were removed: the optimiser's "before" was for a different set of orders.
    const [after] = await db.select({ summary: plans.summary }).from(plans).where(eq(plans.id, p.id));
    if (after.summary?.assigned !== p.summary?.assigned) await db.update(plans).set({ baseline: null }).where(eq(plans.id, p.id));
  }
}

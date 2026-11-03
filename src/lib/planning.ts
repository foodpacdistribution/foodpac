import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { type DB, getDb } from "./db";
import {
  depots,
  drivers,
  optimisationRuns,
  orders,
  type PlanContext,
  plans,
  type PlanSummary,
  type RouteReload,
  routes,
  routeStops,
  settings,
  users,
} from "./db/schema";
import { type LatLng, routeGeometry, travelMatrix } from "./geo/routing";
import { shiftDate } from "./dates";
import { nowSecondsIn, todayIn } from "./time";
import { fitTiming, type Leg, type Timing } from "./vrp/calibrate";
import { evaluateRoute } from "./vrp/evaluate";
import { naivePlan, solve } from "./vrp/solver";
import type { Job, Objective, Problem, RouteEval, Vehicle } from "./vrp/types";

export class UserError extends Error {}

export async function getSettings(db: DB) {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  return s;
}

export type DepotPoint = { id: string; name: string; address: string; lat: number; lng: number };

/** Active, located depots. The first one is the default for drivers without a home depot. */
export async function getDepots(db: DB): Promise<DepotPoint[]> {
  const rows = await db.select().from(depots).where(eq(depots.active, true)).orderBy(asc(depots.createdAt));
  return rows.filter((d) => d.lat !== null && d.lng !== null).map((d) => ({ id: d.id, name: d.name, address: d.address, lat: d.lat!, lng: d.lng! }));
}

/** A driver's home depot, falling back to the default (first) depot. */
export function depotFor(list: DepotPoint[], depotId: string | null | undefined) {
  return list.find((d) => d.id === depotId) ?? list[0] ?? null;
}

/** The signed-in user's depot: a driver's home depot, otherwise the default one. */
export async function depotForUser(db: DB, driverId: string | null) {
  const [d] = driverId ? await db.select({ depotId: drivers.depotId }).from(drivers).where(eq(drivers.id, driverId)).limit(1) : [];
  return depotFor(await getDepots(db), d?.depotId);
}

// ---------------------------------------------------------------------------
// Timing learned from deliveries
// ---------------------------------------------------------------------------

/**
 * Driving speed and unloading time learned from the last 60 days of "Delivered" taps
 * (see vrp/calibrate). Null until drivers have completed enough deliveries in a row.
 */
export async function learnTiming(db: DB, timezone: string): Promise<Timing | null> {
  const rows = await db
    .select({
      routeId: routeStops.routeId,
      seq: routeStops.seq,
      trip: routeStops.trip,
      status: routeStops.status,
      completedAt: routeStops.completedAt,
      legDriveS: routeStops.legDriveS,
      waitS: routeStops.waitS,
      customService: orders.serviceMin,
      trafficFactor: sql<number | null>`(${plans.context}->>'trafficFactor')::float`,
    })
    .from(routeStops)
    .innerJoin(routes, eq(routes.id, routeStops.routeId))
    .innerJoin(plans, eq(plans.id, routes.planId))
    .innerJoin(orders, eq(orders.id, routeStops.orderId))
    .where(and(sql`${routeStops.completedAt} is not null`, sql`${plans.deliveryDate} >= ${shiftDate(todayIn(timezone), -60)}`))
    .orderBy(asc(routeStops.routeId), asc(routeStops.seq));

  const legs: Leg[] = [];
  for (let i = 1; i < rows.length; i++) {
    const [prev, st] = [rows[i - 1], rows[i]];
    // Only a delivery made straight after the planned previous stop measures that leg. Legs with
    // a depot reload, a wait for the delivery window or a custom unloading time don't fit the model.
    if (prev.routeId !== st.routeId || prev.seq !== st.seq - 1 || prev.trip !== st.trip) continue;
    if (st.status !== "delivered" || st.waitS > 0 || st.customService !== null) continue;
    legs.push({
      driveS: st.legDriveS / (st.trafficFactor || 1),
      gapS: (st.completedAt!.getTime() - prev.completedAt!.getTime()) / 1000,
    });
  }
  return fitTiming(legs.slice(-400));
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export type StopView = {
  id: string;
  orderId: string;
  seq: number;
  trip: number;
  etaS: number;
  etdS: number;
  waitS: number;
  lateS: number;
  legDistanceM: number;
  legDriveS: number;
  status: "pending" | "delivered" | "failed";
  completedAt: string | null;
  order: {
    orderNumber: string;
    customerName: string;
    address: string;
    phone: string | null;
    notes: string | null;
    lat: number;
    lng: number;
    windowStartMin: number | null;
    windowEndMin: number | null;
    priority: number;
    demand: number;
    pinnedDriverId: string | null;
  };
};

export type RouteView = {
  id: string;
  driverId: string;
  driverName: string;
  vehicle: string | null;
  color: string;
  capacity: number | null;
  maxShiftS: number;
  startS: number;
  endS: number;
  distanceM: number;
  driveS: number;
  serviceS: number;
  waitS: number;
  overtimeS: number;
  overCapacity: number;
  trips: number;
  reloads: RouteReload[];
  depotId: string | null;
  status: "planned" | "in_progress" | "completed";
  startedAt: string | null;
  /** Shipment number (SH-1001). */
  number: string;
  /** When it was sent to the driver; null = not visible on their phone yet. */
  dispatchedAt: string | null;
  geometry: [number, number][] | null;
  stops: StopView[];
};

export type PlanView = {
  plan: {
    id: string;
    deliveryDate: string;
    status: "draft" | "dispatched";
    summary: PlanSummary | null;
    baseline: PlanSummary | null;
    unassigned: { orderId: string; reason: string }[];
    matrixSource: "osrm" | "estimate" | null;
    objective: Objective | null;
    /** Drivers included in the last optimisation (some may have empty routes). */
    driverIds: string[];
    dispatchedAt: string | null;
    updatedAt: string;
  } | null;
  routes: RouteView[];
  runs: { id: string; kind: string; createdAt: string; userName: string | null; summary: PlanSummary; solverMs: number | null }[];
};

export async function getPlanView(db: DB, date: string): Promise<PlanView> {
  const [plan] = await db.select().from(plans).where(eq(plans.deliveryDate, date)).limit(1);
  if (!plan) return { plan: null, routes: [], runs: [] };
  const s = await getSettings(db);

  const routeRows = await db
    .select({ route: routes, driver: drivers })
    .from(routes)
    .innerJoin(drivers, eq(drivers.id, routes.driverId))
    .where(eq(routes.planId, plan.id))
    .orderBy(asc(drivers.name));
  const stopRows = routeRows.length
    ? await db
        .select({ stop: routeStops, order: orders })
        .from(routeStops)
        .innerJoin(orders, eq(orders.id, routeStops.orderId))
        .where(inArray(routeStops.routeId, routeRows.map((r) => r.route.id)))
        .orderBy(asc(routeStops.seq))
    : [];
  const runRows = await db
    .select({ run: optimisationRuns, userName: users.name })
    .from(optimisationRuns)
    .leftJoin(users, eq(users.id, optimisationRuns.userId))
    .where(eq(optimisationRuns.planId, plan.id))
    .orderBy(desc(optimisationRuns.createdAt))
    .limit(15);

  return {
    plan: {
      id: plan.id,
      deliveryDate: plan.deliveryDate,
      status: plan.status,
      summary: plan.summary,
      baseline: plan.baseline,
      unassigned: plan.unassigned,
      matrixSource: plan.context?.matrixSource ?? null,
      objective: plan.context?.objective ?? null,
      driverIds: plan.context?.vehicles.map((v) => v.driverId) ?? [],
      dispatchedAt: plan.dispatchedAt?.toISOString() ?? null,
      updatedAt: plan.updatedAt.toISOString(),
    },
    routes: routeRows.map(({ route, driver }) => ({
      id: route.id,
      driverId: driver.id,
      driverName: driver.name,
      vehicle: driver.vehicle,
      color: driver.color,
      capacity: driver.capacity,
      maxShiftS: (driver.maxShiftMin ?? s.defaultMaxShiftMin) * 60,
      startS: route.startS,
      endS: route.endS,
      distanceM: route.distanceM,
      driveS: route.driveS,
      serviceS: route.serviceS,
      waitS: route.waitS,
      overtimeS: route.overtimeS,
      overCapacity: route.overCapacity,
      trips: route.trips,
      reloads: route.reloads,
      depotId: driver.depotId,
      status: route.status,
      startedAt: route.startedAt?.toISOString() ?? null,
      number: route.number,
      dispatchedAt: route.dispatchedAt?.toISOString() ?? null,
      geometry: route.geometry,
      stops: stopRows
        .filter((r) => r.stop.routeId === route.id)
        .map(({ stop, order }) => ({
          id: stop.id,
          orderId: order.id,
          seq: stop.seq,
          trip: stop.trip,
          etaS: stop.etaS,
          etdS: stop.etdS,
          waitS: stop.waitS,
          lateS: stop.lateS,
          legDistanceM: stop.legDistanceM,
          legDriveS: stop.legDriveS,
          status: stop.status,
          completedAt: stop.completedAt?.toISOString() ?? null,
          order: {
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            address: order.address,
            phone: order.phone,
            notes: order.notes,
            lat: order.lat!,
            lng: order.lng!,
            windowStartMin: order.windowStartMin,
            windowEndMin: order.windowEndMin,
            priority: order.priority,
            demand: order.demand,
            pinnedDriverId: order.pinnedDriverId,
          },
        })),
    })),
    runs: runRows.map(({ run, userName }) => ({
      id: run.id,
      kind: run.kind,
      createdAt: run.createdAt.toISOString(),
      userName,
      summary: run.summary,
      solverMs: run.solverMs,
    })),
  };
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/** Recomputes a plan's summary from its stored routes (after a single route changes, e.g. a shipment). */
export async function refreshPlanSummary(db: Pick<DB, "select" | "update">, planId: string, date: string) {
  const rs = await db.select().from(routes).where(eq(routes.planId, planId));
  const stops = rs.length
    ? await db.select({ routeId: routeStops.routeId, lateS: routeStops.lateS }).from(routeStops).where(inArray(routeStops.routeId, rs.map((r) => r.id)))
    : [];
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.deliveryDate, date), inArray(orders.status, ["pending", "planned", "dispatched", "delivered", "failed"]), ne(orders.source, "quick_route")));
  const totals: RouteTotals[] = rs.map((r) => {
    const own = stops.filter((st) => st.routeId === r.id);
    return { startS: r.startS, endS: r.endS, distanceM: r.distanceM, driveS: r.driveS, serviceS: r.serviceS, waitS: r.waitS, overtimeS: r.overtimeS, lateStops: own.filter((st) => st.lateS > 0).length, stops: own.length };
  });
  await db.update(plans).set({ summary: summarise(totals, n), updatedAt: new Date() }).where(eq(plans.id, planId));
}

type RouteTotals = {
  startS: number;
  endS: number;
  distanceM: number;
  driveS: number;
  serviceS: number;
  waitS: number;
  overtimeS: number;
  lateStops: number;
  stops: number;
};

function summarise(rs: RouteTotals[], ordersTotal: number): PlanSummary {
  const used = rs.filter((r) => r.stops > 0);
  const assigned = used.reduce((a, r) => a + r.stops, 0);
  return {
    orders: ordersTotal,
    assigned,
    unassigned: Math.max(0, ordersTotal - assigned),
    distance: used.reduce((a, r) => a + r.distanceM, 0),
    driveTime: used.reduce((a, r) => a + r.driveS, 0),
    serviceTime: used.reduce((a, r) => a + r.serviceS, 0),
    waitTime: used.reduce((a, r) => a + r.waitS, 0),
    driverTime: used.reduce((a, r) => a + (r.endS - r.startS), 0),
    fleetStart: used.length ? Math.min(...used.map((r) => r.startS)) : null,
    fleetFinish: used.length ? Math.max(...used.map((r) => r.endS)) : null,
    lateStops: used.reduce((a, r) => a + r.lateStops, 0),
    overtimeRoutes: used.filter((r) => r.overtimeS > 0).length,
  };
}

const evalTotals = (e: RouteEval): RouteTotals => ({
  startS: e.start,
  endS: e.end,
  distanceM: e.distance,
  driveS: e.driveTime,
  serviceS: e.serviceTime,
  waitS: e.waitTime,
  overtimeS: e.overtime,
  lateStops: e.lateStops,
  stops: e.jobIds.length,
});

// ---------------------------------------------------------------------------
// Optimise
// ---------------------------------------------------------------------------

export type OptimiseInput = {
  date: string;
  driverIds: string[];
  startMin: number;
  defaultServiceMin: number;
  objective: Objective;
  trafficFactor: number;
  returnToDepot: boolean;
  /** Use learnTiming's driving speed and unloading time instead of trafficFactor / defaultServiceMin. */
  learnedTiming?: boolean;
};

type CompletedStop = { orderId: string; demand: number; lat: number; lng: number; etdS: number; status: string; trip: number };
type ExistingRoute = { id: string; driverId: string; startS: number; status: string; reloads: RouteReload[]; completed: CompletedStop[] };

async function loadExistingRoutes(db: DB, planId: string | undefined): Promise<Map<string, ExistingRoute>> {
  const map = new Map<string, ExistingRoute>();
  if (!planId) return map;
  const rs = await db.select().from(routes).where(eq(routes.planId, planId));
  if (!rs.length) return map;
  const done = await db
    .select({ stop: routeStops, order: orders })
    .from(routeStops)
    .innerJoin(orders, eq(orders.id, routeStops.orderId))
    .where(and(inArray(routeStops.routeId, rs.map((r) => r.id)), inArray(routeStops.status, ["delivered", "failed"])))
    .orderBy(asc(routeStops.seq));
  for (const r of rs) {
    map.set(r.driverId, {
      id: r.id,
      driverId: r.driverId,
      startS: r.startS,
      status: r.status,
      reloads: r.reloads,
      completed: done
        .filter((d) => d.stop.routeId === r.id)
        .map((d) => ({ orderId: d.order.id, demand: d.order.demand, lat: d.order.lat!, lng: d.order.lng!, etdS: d.stop.etdS, status: d.stop.status, trip: d.stop.trip })),
    });
  }
  return map;
}

/** Pinned driver and/or ship-from depot restrict which vehicles may take an order. */
function allowedFor(
  o: { pinnedDriverId: string | null; depotId: string | null },
  selectedIds: Set<string>,
  driverDepot: Map<string, string>,
): string[] | undefined {
  if (!o.pinnedDriverId && !o.depotId) return undefined;
  let ids = [...selectedIds];
  if (o.pinnedDriverId) ids = ids.filter((id) => id === o.pinnedDriverId);
  if (o.depotId) ids = ids.filter((id) => driverDepot.get(id) === o.depotId);
  return ids;
}

export async function optimisePlan(input: OptimiseInput, userId: string) {
  const db = await getDb();
  const s = await getSettings(db);
  const depotList = await getDepots(db);
  if (!depotList.length) throw new UserError("Add a depot address in Settings before planning routes.");
  if (input.driverIds.length === 0) throw new UserError("Select at least one driver.");

  const selected = await db
    .select()
    .from(drivers)
    .where(and(inArray(drivers.id, input.driverIds), eq(drivers.active, true)));
  if (!selected.length) throw new UserError("None of the selected drivers are active.");

  const [existingPlan] = await db.select().from(plans).where(eq(plans.deliveryDate, input.date)).limit(1);
  const existing = await loadExistingRoutes(db, existingPlan?.id);
  const isToday = input.date === todayIn(s.timezone);
  const nowS = nowSecondsIn(s.timezone);

  const dayOrders = await db
    .select()
    .from(orders)
    .where(and(eq(orders.deliveryDate, input.date), inArray(orders.status, ["pending", "planned", "dispatched"])))
    .orderBy(asc(orders.createdAt), asc(orders.orderNumber));
  const routable = dayOrders.filter((o) => o.lat !== null && o.lng !== null);
  if (!routable.length) throw new UserError("No geocoded orders left to plan for this date.");

  // ----- nodes -----
  const nodeKeys: string[] = [];
  const points: LatLng[] = [];
  const nodeOf = new Map<string, number>();
  const addNode = (key: string, p: LatLng) => {
    if (!nodeOf.has(key)) {
      nodeOf.set(key, nodeKeys.length);
      nodeKeys.push(key);
      points.push(p);
    }
    return nodeOf.get(key)!;
  };

  // ----- vehicles (continuing from the last completed stop when re-planning mid-day) -----
  const vehicleMeta: PlanContext["vehicles"] = [];
  const vehicles: Vehicle[] = selected.map((d) => {
    const prev = existing.get(d.id);
    const last = prev?.completed.at(-1);
    const shiftStart = (d.shiftStartMin ?? input.startMin) * 60;
    const shiftLength = (d.maxShiftMin ?? s.defaultMaxShiftMin) * 60;
    const depot = depotFor(depotList, d.depotId)!;
    const depotKey = `depot:${depot.id}`;
    addNode(depotKey, depot);
    let startKey = depotKey;
    let startTime = shiftStart;
    let maxDuration = shiftLength;
    let maxTrips = Math.max(1, d.maxTrips);
    let firstTripCapacity = d.capacity;
    if (prev && (last || prev.status === "in_progress")) {
      if (last) {
        startKey = `order:${last.orderId}`;
        addNode(startKey, { lat: last.lat, lng: last.lng });
        startTime = last.etdS;
        // Mid-trip: only what's left on the van counts for the first trip; used trips are gone.
        maxTrips = Math.max(1, maxTrips - (last.trip - 1));
        if (d.capacity !== null) {
          const usedThisTrip = prev.completed.filter((c) => c.trip === last.trip).reduce((a, c) => a + c.demand, 0);
          firstTripCapacity = Math.max(0, d.capacity - usedThisTrip);
        }
      }
      if (isToday) startTime = Math.max(startTime, nowS);
      maxDuration = Math.max(0, shiftLength - (startTime - prev.startS));
    }
    const endKey = input.returnToDepot ? depotKey : null;
    const reloadTime = s.reloadMin * 60;
    vehicleMeta.push({ driverId: d.id, startKey, endKey, startTime, maxDuration, capacity: d.capacity, firstTripCapacity, depotKey, maxTrips, reloadTime });
    return {
      id: d.id,
      startNode: nodeOf.get(startKey)!,
      endNode: endKey ? nodeOf.get(endKey)! : null,
      depotNode: nodeOf.get(depotKey)!,
      startTime,
      maxDuration,
      capacity: d.capacity,
      firstTripCapacity,
      maxTrips,
      reloadTime,
    };
  });
  const driverDepot = new Map(selected.map((d) => [d.id, depotFor(depotList, d.depotId)!.id]));

  const selectedIds = new Set(selected.map((d) => d.id));
  const jobs: Job[] = routable.map((o) => ({
    id: o.id,
    node: addNode(`order:${o.id}`, { lat: o.lat!, lng: o.lng! }),
    service: (o.serviceMin ?? input.defaultServiceMin) * 60,
    twStart: o.windowStartMin !== null ? o.windowStartMin * 60 : null,
    twEnd: o.windowEndMin !== null ? o.windowEndMin * 60 : null,
    demand: o.demand,
    priority: o.priority,
    allowedVehicles: allowedFor(o, selectedIds, driverDepot),
  }));

  // ----- matrix + solve -----
  const matrix = await travelMatrix(points);
  const durations = matrix.durations.map((row) => row.map((d) => Math.round(d * input.trafficFactor)));
  const problem: Problem = { vehicles, jobs, matrix: { durations, distances: matrix.distances }, objective: input.objective };
  const timeLimitMs = Math.min(12000, Math.max(1500, 1000 + jobs.length * 60));
  const solution = solve(problem, { timeLimitMs });
  // Compare like with like: the naive plan serves exactly the orders the optimiser could serve.
  const served = new Set(solution.routes.flatMap((r) => r.jobIds));
  const baselineEvals = naivePlan({ ...problem, jobs: jobs.filter((j) => served.has(j.id)) });

  const context: PlanContext = {
    nodeKeys,
    durations,
    distances: matrix.distances,
    matrixSource: matrix.source,
    vehicles: vehicleMeta,
    objective: input.objective,
    trafficFactor: input.trafficFactor,
    defaultServiceMin: input.defaultServiceMin,
  };

  const unassigned = [
    ...solution.unassigned.map((u) => ({ orderId: u.jobId, reason: u.reason })),
    ...dayOrders.filter((o) => o.lat === null).map((o) => ({ orderId: o.id, reason: "not_geocoded" })),
  ];

  const planId = await persistPlan(db, {
    date: input.date,
    context,
    points,
    nodeOf,
    evals: solution.routes,
    unassigned,
    baseline: summarise(baselineEvals.map(evalTotals), served.size),
    ordersTotal: dayOrders.length,
    kind: "optimise",
    userId,
    solverMs: solution.elapsedMs,
    settingsSnapshot: { ...input, iterations: solution.iterations },
  });

  return { planId, matrixSource: matrix.source, unassigned: unassigned.length, solverMs: solution.elapsedMs };
}

// ---------------------------------------------------------------------------
// Manual edits: re-time the dispatcher's sequence with the stored matrix
// ---------------------------------------------------------------------------

export async function applyManualEdit(date: string, assignment: { driverId: string; orderIds: string[] }[], userId: string) {
  const db = await getDb();
  const [plan] = await db.select().from(plans).where(eq(plans.deliveryDate, date)).limit(1);
  if (!plan?.context) throw new UserError("Optimise the plan first.");
  const ctx = plan.context;

  const nodeOf = new Map(ctx.nodeKeys.map((k, i) => [k, i]));
  const planDrivers = new Set(ctx.vehicles.map((v) => v.driverId));
  if (assignment.some((a) => !planDrivers.has(a.driverId))) throw new UserError("A driver isn't part of this plan — run Optimise again.");
  const allIds = assignment.flatMap((a) => a.orderIds);
  if (new Set(allIds).size !== allIds.length) throw new UserError("An order appears in two routes.");

  const dayOrders = await db
    .select()
    .from(orders)
    .where(and(eq(orders.deliveryDate, date), inArray(orders.status, ["pending", "planned", "dispatched"])));
  const byId = new Map(dayOrders.map((o) => [o.id, o]));
  for (const id of allIds) {
    if (!byId.has(id)) throw new UserError("One of the orders is no longer pending. Reload the page.");
    if (!nodeOf.has(`order:${id}`)) throw new UserError("Orders were added after the last optimisation — run Optimise again.");
  }

  const jobs: Job[] = dayOrders
    .filter((o) => nodeOf.has(`order:${o.id}`))
    .map((o) => ({
      id: o.id,
      node: nodeOf.get(`order:${o.id}`)!,
      service: (o.serviceMin ?? ctx.defaultServiceMin) * 60,
      twStart: o.windowStartMin !== null ? o.windowStartMin * 60 : null,
      twEnd: o.windowEndMin !== null ? o.windowEndMin * 60 : null,
      demand: o.demand,
      priority: o.priority,
    }));
  const jobIndex = new Map(jobs.map((j, i) => [j.id, i]));
  const vehicles: Vehicle[] = ctx.vehicles.map((v) => ({
    id: v.driverId,
    startNode: nodeOf.get(v.startKey)!,
    endNode: v.endKey ? nodeOf.get(v.endKey)! : null,
    depotNode: nodeOf.get(v.depotKey ?? v.endKey ?? v.startKey),
    startTime: v.startTime,
    maxDuration: v.maxDuration,
    capacity: v.capacity,
    firstTripCapacity: v.firstTripCapacity ?? v.capacity,
    maxTrips: v.maxTrips ?? 1,
    reloadTime: v.reloadTime ?? 0,
  }));
  const problem: Problem = { vehicles, jobs, matrix: { durations: ctx.durations, distances: ctx.distances }, objective: ctx.objective };

  const evals = vehicles.map((v) => {
    const seq = (assignment.find((a) => a.driverId === v.id)?.orderIds ?? []).map((id) => jobIndex.get(id)!);
    const { cost: _cost, ...ev } = evaluateRoute(problem, v, seq);
    return ev;
  });
  const assigned = new Set(allIds);
  const unassigned = [
    ...dayOrders.filter((o) => o.lat !== null && !assigned.has(o.id)).map((o) => ({ orderId: o.id, reason: "manual" })),
    ...dayOrders.filter((o) => o.lat === null).map((o) => ({ orderId: o.id, reason: "not_geocoded" })),
  ];

  const points = await resolveNodePoints(db, ctx.nodeKeys);

  await persistPlan(db, {
    date,
    context: ctx,
    points,
    nodeOf,
    evals,
    unassigned,
    baseline: plan.baseline,
    ordersTotal: dayOrders.length,
    kind: "manual_edit",
    userId,
    solverMs: null,
    settingsSnapshot: null,
  });
}

/** Coordinates for stored matrix node keys ("depot:<id>", "order:<id>"). */
async function resolveNodePoints(db: DB, keys: string[]): Promise<LatLng[]> {
  const orderIds = keys.filter((k) => k.startsWith("order:")).map((k) => k.slice(6));
  const orderRows = orderIds.length
    ? await db.select({ id: orders.id, lat: orders.lat, lng: orders.lng }).from(orders).where(inArray(orders.id, orderIds))
    : [];
  const depotRows = await db.select().from(depots).orderBy(asc(depots.createdAt));
  return keys.map((k) => {
    if (k.startsWith("order:")) {
      const o = orderRows.find((r) => r.id === k.slice(6));
      return { lat: o?.lat ?? 0, lng: o?.lng ?? 0 };
    }
    // "depot" is the pre-multi-depot key for the single depot.
    const d = k === "depot" ? depotRows[0] : depotRows.find((r) => r.id === k.slice(6));
    return { lat: d?.lat ?? 0, lng: d?.lng ?? 0 };
  });
}

// ---------------------------------------------------------------------------
// Persistence shared by optimise and manual edit
// ---------------------------------------------------------------------------

async function persistPlan(
  db: DB,
  args: {
    date: string;
    context: PlanContext;
    points: LatLng[];
    nodeOf: Map<string, number>;
    evals: RouteEval[];
    unassigned: { orderId: string; reason: string }[];
    baseline: PlanSummary | null;
    ordersTotal: number;
    kind: "optimise" | "manual_edit";
    userId: string;
    solverMs: number | null;
    settingsSnapshot: Record<string, unknown> | null;
  },
) {
  const { context, points, nodeOf } = args;
  const [prev] = await db.select().from(plans).where(eq(plans.deliveryDate, args.date)).limit(1);
  const existing = await loadExistingRoutes(db, prev?.id);

  // Road shapes are fetched outside the transaction (network calls).
  const geometries = new Map<string, [number, number][]>();
  for (const ev of args.evals) {
    if (!ev.jobIds.length) continue;
    const meta = context.vehicles.find((v) => v.driverId === ev.vehicleId)!;
    const done = existing.get(ev.vehicleId)?.completed ?? [];
    const depotPoint = points[nodeOf.get(meta.depotKey ?? meta.endKey ?? meta.startKey)!];
    const pts: LatLng[] = done.length ? [depotPoint, ...done.map((c) => ({ lat: c.lat, lng: c.lng }))] : [points[nodeOf.get(meta.startKey)!]];
    ev.stops.forEach((st, i) => {
      if (i > 0 && st.trip !== ev.stops[i - 1].trip) pts.push(depotPoint); // reload visit
      pts.push(points[nodeOf.get(`order:${st.jobId}`)!]);
    });
    if (meta.endKey) pts.push(points[nodeOf.get(meta.endKey)!]);
    geometries.set(ev.vehicleId, await routeGeometry(pts));
  }

  const routeTotals: RouteTotals[] = [];

  const planId = await db.transaction(async (tx) => {
    const status = prev?.status ?? "draft";
    const [plan] = await tx
      .insert(plans)
      .values({ deliveryDate: args.date, status, context, baseline: args.baseline, unassigned: args.unassigned })
      .onConflictDoUpdate({
        target: plans.deliveryDate,
        set: { context, baseline: args.baseline, unassigned: args.unassigned, updatedAt: new Date() },
      })
      .returning();

    // Drop every not-yet-completed stop; completed ones stay as history.
    const prevRouteIds = [...existing.values()].map((r) => r.id);
    if (prevRouteIds.length) {
      await tx.delete(routeStops).where(and(inArray(routeStops.routeId, prevRouteIds), eq(routeStops.status, "pending")));
    }

    const keepRoutes = new Set<string>();
    const orderStatus = plan.status === "dispatched" ? "dispatched" : "planned";

    for (const ev of args.evals) {
      const prevRoute = existing.get(ev.vehicleId);
      const done = prevRoute?.completed ?? [];
      if (!ev.jobIds.length && !done.length) continue;

      const doneStops = done.length
        ? await tx
            .select()
            .from(routeStops)
            .where(and(eq(routeStops.routeId, prevRoute!.id), inArray(routeStops.status, ["delivered", "failed"])))
        : [];
      // New stops continue the trip numbering of what's already been driven.
      const tripOffset = done.length ? Math.max(...done.map((c) => c.trip)) - 1 : 0;
      const prevReloads = done.length ? (prevRoute!.reloads.filter((r) => r.afterSeq < done.length)) : [];
      const doneTotals = doneStops.reduce(
        (a, st) => ({
          distanceM: a.distanceM + st.legDistanceM,
          driveS: a.driveS + st.legDriveS,
          serviceS: a.serviceS + Math.max(0, st.etdS - st.etaS - st.waitS),
          waitS: a.waitS + st.waitS,
          lateStops: a.lateStops + (st.lateS > 0 ? 1 : 0),
        }),
        { distanceM: 0, driveS: 0, serviceS: 0, waitS: 0, lateStops: 0 },
      );

      const totals: RouteTotals = {
        startS: done.length ? prevRoute!.startS : ev.start,
        endS: ev.jobIds.length ? ev.end : Math.max(...doneStops.map((st) => st.etdS)),
        distanceM: doneTotals.distanceM + ev.distance,
        driveS: doneTotals.driveS + ev.driveTime,
        serviceS: doneTotals.serviceS + ev.serviceTime,
        waitS: doneTotals.waitS + ev.waitTime,
        overtimeS: ev.overtime,
        lateStops: doneTotals.lateStops + ev.lateStops,
        stops: done.length + ev.jobIds.length,
      };
      routeTotals.push(totals);

      const values = {
        startS: totals.startS,
        endS: totals.endS,
        distanceM: totals.distanceM,
        driveS: totals.driveS,
        serviceS: totals.serviceS,
        waitS: totals.waitS,
        overtimeS: totals.overtimeS,
        overCapacity: ev.overCapacity,
        trips: tripOffset + Math.max(1, ev.trips),
        reloads: [
          ...prevReloads,
          ...ev.reloads.map((r) => ({ afterSeq: done.length + r.afterIndex + 1, arrivalS: r.arrival, departureS: r.departure })),
        ],
        geometry: geometries.get(ev.vehicleId) ?? null,
        // Nothing left → finished; new stops on a started/finished route → back on the road.
        ...(ev.jobIds.length
          ? prevRoute && prevRoute.status !== "planned"
            ? { status: "in_progress" as const, completedAt: null }
            : {}
          : { status: "completed" as const, completedAt: new Date() }),
      };
      // Re-planning a day that's already with the drivers keeps every route on their phones.
      const sent = plan.status === "dispatched" ? { dispatchedAt: sql`coalesce(${routes.dispatchedAt}, now())` } : {};
      const [route] = await tx
        .insert(routes)
        .values({ planId: plan.id, driverId: ev.vehicleId, ...values, ...(plan.status === "dispatched" ? { dispatchedAt: new Date() } : {}) })
        .onConflictDoUpdate({ target: [routes.planId, routes.driverId], set: { ...values, ...sent } })
        .returning();
      keepRoutes.add(route.id);

      if (ev.stops.length) {
        await tx.insert(routeStops).values(
          ev.stops.map((st, i) => ({
            routeId: route.id,
            orderId: st.jobId,
            seq: done.length + i + 1,
            trip: tripOffset + st.trip,
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
          .set({ status: orderStatus, driverId: ev.vehicleId, updatedAt: new Date() })
          .where(inArray(orders.id, ev.jobIds));
      }
    }

    // A driver left out of this run who already completed stops keeps a route
    // holding just that history; it's re-totalled from the completed stops.
    const evalDrivers = new Set(args.evals.map((e) => e.vehicleId));
    for (const prevRoute of existing.values()) {
      if (evalDrivers.has(prevRoute.driverId) || !prevRoute.completed.length) continue;
      const doneStops = await tx
        .select()
        .from(routeStops)
        .where(and(eq(routeStops.routeId, prevRoute.id), inArray(routeStops.status, ["delivered", "failed"])));
      const totals: RouteTotals = {
        startS: prevRoute.startS,
        endS: Math.max(...doneStops.map((st) => st.etdS)),
        distanceM: doneStops.reduce((a, st) => a + st.legDistanceM, 0),
        driveS: doneStops.reduce((a, st) => a + st.legDriveS, 0),
        serviceS: doneStops.reduce((a, st) => a + Math.max(0, st.etdS - st.etaS - st.waitS), 0),
        waitS: doneStops.reduce((a, st) => a + st.waitS, 0),
        overtimeS: 0,
        lateStops: doneStops.filter((st) => st.lateS > 0).length,
        stops: doneStops.length,
      };
      routeTotals.push(totals);
      await tx
        .update(routes)
        .set({
          endS: totals.endS,
          distanceM: totals.distanceM,
          driveS: totals.driveS,
          serviceS: totals.serviceS,
          waitS: totals.waitS,
          overtimeS: 0,
          overCapacity: 0,
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(routes.id, prevRoute.id));
      keepRoutes.add(prevRoute.id);
    }

    // Routes with nothing left (driver deselected, no completed stops) go away.
    const drop = prevRouteIds.filter((id) => !keepRoutes.has(id));
    if (drop.length) await tx.delete(routes).where(inArray(routes.id, drop));

    const unassignedIds = args.unassigned.map((u) => u.orderId);
    if (unassignedIds.length) {
      await tx
        .update(orders)
        .set({ status: "pending", driverId: null, updatedAt: new Date() })
        .where(inArray(orders.id, unassignedIds));
    }

    // ordersTotal counts open orders only; completed stops are also part of the day's plan.
    const completedCount = [...existing.values()].reduce((a, r) => a + r.completed.length, 0);
    const summary = summarise(routeTotals, args.ordersTotal + completedCount);
    await tx.update(plans).set({ summary }).where(eq(plans.id, plan.id));
    await tx.insert(optimisationRuns).values({
      planId: plan.id,
      kind: args.kind,
      userId: args.userId,
      summary,
      baseline: args.baseline,
      snapshot: args.evals.filter((e) => e.jobIds.length).map((e) => ({ driverId: e.vehicleId, orderIds: e.jobIds })),
      settings: args.settingsSnapshot,
      solverMs: args.solverMs,
    });
    return plan.id;
  });

  return planId;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Deletes a day's plan (routes, stops and history go with it) and puts its open orders back
 * to unplanned. Days with completed deliveries keep their plan as the record of those deliveries.
 */
export async function deletePlan(db: DB, date: string) {
  const [plan] = await db.select().from(plans).where(eq(plans.deliveryDate, date)).limit(1);
  if (!plan) return;
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(routeStops)
    .innerJoin(routes, eq(routes.id, routeStops.routeId))
    .where(and(eq(routes.planId, plan.id), inArray(routeStops.status, ["delivered", "failed"])));
  if (n > 0) {
    throw new UserError("This day has completed deliveries, so its plan is kept as their record. If they were test data, delete those orders first.");
  }
  await db.transaction(async (tx) => {
    await tx.delete(plans).where(eq(plans.id, plan.id));
    await tx
      .update(orders)
      .set({ status: "pending", driverId: null, updatedAt: new Date() })
      .where(and(eq(orders.deliveryDate, date), inArray(orders.status, ["planned", "dispatched"])));
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function setPlanDispatched(date: string, dispatched: boolean) {
  const db = await getDb();
  const [plan] = await db.select().from(plans).where(eq(plans.deliveryDate, date)).limit(1);
  if (!plan) throw new UserError("No plan for this date.");
  const rs = await db.select().from(routes).where(eq(routes.planId, plan.id));
  if (!dispatched && rs.some((r) => r.status !== "planned")) {
    throw new UserError("A driver has already started — the plan can't be recalled. Re-optimise instead.");
  }
  const routeIds = rs.map((r) => r.id);
  await db.transaction(async (tx) => {
    await tx
      .update(plans)
      .set({ status: dispatched ? "dispatched" : "draft", dispatchedAt: dispatched ? new Date() : null, updatedAt: new Date() })
      .where(eq(plans.id, plan.id));
    if (routeIds.length) {
      await tx
        .update(routes)
        .set({ dispatchedAt: dispatched ? sql`coalesce(${routes.dispatchedAt}, now())` : null })
        .where(inArray(routes.id, routeIds));
      const stopOrders = await tx
        .select({ orderId: routeStops.orderId })
        .from(routeStops)
        .where(and(inArray(routeStops.routeId, routeIds), eq(routeStops.status, "pending")));
      if (stopOrders.length) {
        await tx
          .update(orders)
          .set({ status: dispatched ? "dispatched" : "planned", updatedAt: new Date() })
          .where(inArray(orders.id, stopOrders.map((s) => s.orderId)));
      }
    }
  });
}

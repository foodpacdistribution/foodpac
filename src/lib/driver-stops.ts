import "server-only";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { assertUser } from "./auth/dal";
import { type DB, getDb } from "./db";
import { emailDelivered, emailHeadsUp, emailNextStop, emailRouteStarted } from "./delivery-emails";
import { deliveryEvents, orders, plans, routes, routeStops } from "./db/schema";
import type { Outcome } from "./outcome";
import { getSettings, refreshPlanSummary, UserError, writeStopTimes } from "./planning";
import { saveProof } from "./proofs";
import { nowSecondsIn, todayIn } from "./time";
import { retimeStops } from "./vrp/retime";

export function revalidateDriverPages() {
  revalidatePath("/driver");
  revalidatePath("/admin");
  revalidatePath("/admin/planner");
  revalidatePath("/admin/orders");
}

/** Loads a stop only if it belongs to the signed-in driver's dispatched route. */
async function ownStop(stopId: string) {
  const user = await assertUser(["driver"]);
  if (!user.driverId) throw new UserError("Your login isn't linked to a driver profile.");
  const db = await getDb();
  const [row] = await db
    .select({ stop: routeStops, route: routes, plan: plans })
    .from(routeStops)
    .innerJoin(routes, eq(routes.id, routeStops.routeId))
    .innerJoin(plans, eq(plans.id, routes.planId))
    .where(and(eq(routeStops.id, stopId), eq(routes.driverId, user.driverId)))
    .limit(1);
  if (!row || !row.route.dispatchedAt) throw new UserError("This stop isn't assigned to you.");
  return { db, user, ...row };
}

/** How long a delivery may wait on the phone for signal and still keep the time it was signed. */
const MAX_DELAY_MS = 7 * 24 * 3600 * 1000;

/**
 * When the stop was really done: the phone's clock at the moment the driver confirmed, sent
 * along when the upload had to wait for signal. Upload time if it's missing or implausible.
 */
export function doneAt(raw: FormDataEntryValue | null, now = new Date()) {
  const t = Number(raw);
  if (!raw || !Number.isFinite(t)) return now;
  if (t > now.getTime() || t < now.getTime() - MAX_DELAY_MS) return now;
  return new Date(t);
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type RouteRow = typeof routes.$inferSelect;

/**
 * Re-times the stops still to do from `fromS` (when the van leaves where it is) and saves them.
 * The order stays as dispatched. Returns the route totals that move with them.
 */
async function retimeRemaining(tx: Tx, route: RouteRow, fromS: number) {
  const stops = await tx
    .select({ stop: routeStops, twStart: orders.windowStartMin, twEnd: orders.windowEndMin })
    .from(routeStops)
    .innerJoin(orders, eq(orders.id, routeStops.orderId))
    .where(eq(routeStops.routeId, route.id))
    .orderBy(asc(routeStops.seq));
  const pending = stops.filter((r) => r.stop.status === "pending");
  const timed = retimeStops(
    fromS,
    pending.map(({ stop, twStart, twEnd }) => ({
      id: stop.id,
      seq: stop.seq,
      etaS: stop.etaS,
      etdS: stop.etdS,
      waitS: stop.waitS,
      legDriveS: stop.legDriveS,
      twStart: twStart === null ? null : twStart * 60,
      twEnd: twEnd === null ? null : twEnd * 60,
    })),
    route.reloads,
    route.endS,
  );
  await writeStopTimes(tx, timed.stops);
  const doneWait = stops.filter((r) => r.stop.status !== "pending").reduce((a, r) => a + r.stop.waitS, 0);
  return {
    totals: { endS: timed.endS, waitS: doneWait + timed.stops.reduce((a, st) => a + st.waitS, 0), reloads: timed.reloads },
    firstOrderId: pending[0]?.stop.orderId ?? stops[0]?.stop.orderId ?? null,
  };
}

/**
 * Records a stop as delivered or failed, with its photo and signature. Safe to send twice: a
 * phone that lost signal after the upload went through sends it again, and that's taken as done.
 *
 * The stops still to do are then re-timed from the latest delivery, so every arrival time (on
 * the phone, in the office, on the customer's tracking page) counts from where the van really is.
 */
export async function finishStop(stopId: string, outcome: Outcome, at = new Date()): Promise<{ already: boolean }> {
  const { db, user, stop, route, plan } = await ownStop(stopId);
  if (stop.status === outcome.type) return { already: true };
  if (stop.status !== "pending") throw new UserError("This stop is already completed.");
  const { timezone } = await getSettings(db);
  // Only the delivery day's clock says anything about the stops still to come.
  const sameDay = plan.deliveryDate === todayIn(timezone, at);
  const now = at;
  await db.transaction(async (tx) => {
    await tx.update(routeStops).set({ status: outcome.type, completedAt: now }).where(eq(routeStops.id, stopId));
    await tx.update(orders).set({ status: outcome.type, updatedAt: new Date() }).where(eq(orders.id, stop.orderId));
    const [event] = await tx
      .insert(deliveryEvents)
      .values({
        orderId: stop.orderId,
        driverId: route.driverId,
        userId: user.id,
        type: outcome.type,
        reason: outcome.type === "failed" ? outcome.reason : null,
        recipient: outcome.type === "delivered" ? outcome.recipient : null,
        note: outcome.note,
        lat: outcome.at?.lat ?? null,
        lng: outcome.at?.lng ?? null,
        accuracyM: outcome.at?.accuracy ?? null,
        // Same instant as the stop's completion, so the shipment list and the invoice agree.
        createdAt: now,
      })
      .returning({ id: deliveryEvents.id });
    for (const kind of ["photo", "signature"] as const) {
      const p = outcome[kind];
      if (p) await saveProof(tx, { orderId: stop.orderId, eventId: event.id, kind, mime: p.mime, data: p.data });
    }
    const remaining = await tx
      .select({ id: routeStops.id })
      .from(routeStops)
      .where(and(eq(routeStops.routeId, route.id), eq(routeStops.status, "pending")))
      .limit(1);

    // Delivered without tapping Start: they set off about as long before this as the plan gave them to get here.
    let start: Partial<RouteRow> = {};
    if (!route.startedAt) {
      const startedAt = new Date(now.getTime() - Math.max(0, stop.etdS - route.startS) * 1000);
      start = {
        startedAt,
        plannedDurationS: route.plannedDurationS ?? route.endS - route.startS,
        ...(sameDay ? { startS: nowSecondsIn(timezone, startedAt) } : {}),
      };
    }

    let live: Partial<RouteRow> = {};
    if (remaining.length && sameDay) {
      // From the latest delivery: one that waited on the phone for signal may be older than another already in.
      const [latest] = await tx
        .select({ at: routeStops.completedAt })
        .from(routeStops)
        .where(and(eq(routeStops.routeId, route.id), isNotNull(routeStops.completedAt)))
        .orderBy(desc(routeStops.completedAt))
        .limit(1);
      live = (await retimeRemaining(tx, route, nowSecondsIn(timezone, latest?.at ?? now))).totals;
    }

    await tx
      .update(routes)
      .set({
        ...start,
        ...live,
        ...(remaining.length ? { status: "in_progress" as const } : { status: "completed" as const, completedAt: now }),
      })
      .where(eq(routes.id, route.id));
    if (live.endS !== undefined) await refreshPlanSummary(tx as unknown as DB, plan.id, plan.deliveryDate);
  });
  revalidateDriverPages();
  // Customer emails (when turned on), after the phone has its answer.
  const implicitStart = !route.startedAt && sameDay;
  after(async () => {
    try {
      if (implicitStart) await emailRouteStarted(route.id);
      if (outcome.type === "delivered") await emailDelivered(stopId);
      await emailNextStop(route.id);
    } catch (err) {
      console.warn("[delivery-emails] after a delivery:", (err as Error).message);
    }
  });
  return { already: false };
}

/** The driver's "about 10 minutes away" button for one of their stops. */
export async function sendHeadsUp(stopId: string) {
  const { db, stop } = await ownStop(stopId);
  if (stop.status !== "pending") throw new UserError("This stop is already completed.");
  const r = await emailHeadsUp(db, stop);
  if (!r.sent) throw new UserError(r.reason);
  revalidateDriverPages();
}

/**
 * The driver sets off. Arrival times were planned from the shift start; from here on they count
 * from now, so the phone, the office and the customer's tracking page show when the van will
 * really arrive. The stop order stays exactly as dispatched.
 */
export async function startDriverRoute(routeId: string, at = new Date()) {
  const user = await assertUser(["driver"]);
  if (!user.driverId) throw new UserError("Your login isn't linked to a driver profile.");
  const db = await getDb();
  const [row] = await db
    .select({ route: routes, plan: plans })
    .from(routes)
    .innerJoin(plans, eq(plans.id, routes.planId))
    .where(and(eq(routes.id, routeId), eq(routes.driverId, user.driverId)))
    .limit(1);
  if (!row || !row.route.dispatchedAt) throw new UserError("Route not found.");
  const { route, plan } = row;
  if (route.status !== "planned") return;
  const { timezone } = await getSettings(db);
  if (plan.deliveryDate !== todayIn(timezone, at)) throw new UserError("This shipment is for another day. Start it on the day you deliver it.");
  const startS = nowSecondsIn(timezone, at);

  let didStart = false;
  await db.transaction(async (tx) => {
    // Only the first tap starts the route (a double tap or a second phone does nothing).
    const [started] = await tx
      .update(routes)
      .set({ status: "in_progress", startedAt: at, startS, plannedDurationS: route.endS - route.startS })
      .where(and(eq(routes.id, routeId), eq(routes.status, "planned")))
      .returning({ id: routes.id });
    if (!started) return;
    didStart = true;
    const { totals, firstOrderId } = await retimeRemaining(tx, route, startS);
    await tx.update(routes).set(totals).where(eq(routes.id, routeId));
    if (firstOrderId) {
      await tx.insert(deliveryEvents).values({ orderId: firstOrderId, driverId: route.driverId, userId: user.id, type: "route_started", createdAt: at });
    }
    await refreshPlanSummary(tx as unknown as DB, plan.id, plan.deliveryDate);
  });
  revalidateDriverPages();
  if (didStart) {
    after(() => emailRouteStarted(routeId).catch((err) => console.warn("[delivery-emails] route started:", (err as Error).message)));
  }
}

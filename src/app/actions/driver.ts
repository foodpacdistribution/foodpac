"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { deliveryEvents, orders, plans, routes, routeStops } from "@/lib/db/schema";
import { type Outcome, readOutcome } from "@/lib/outcome";
import { getSettings, UserError } from "@/lib/planning";
import { saveProof } from "@/lib/proofs";

function revalidate() {
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

export async function startRoute(routeId: string) {
  return attempt(async () => {
    const user = await assertUser(["driver"]);
    const db = await getDb();
    const [route] = await db
      .select()
      .from(routes)
      .where(and(eq(routes.id, routeId), eq(routes.driverId, user.driverId ?? "")))
      .limit(1);
    if (!route || !route.dispatchedAt) throw new UserError("Route not found.");
    if (route.status === "planned") {
      await db.update(routes).set({ status: "in_progress", startedAt: new Date() }).where(eq(routes.id, routeId));
      const [first] = await db.select().from(routeStops).where(eq(routeStops.routeId, routeId)).limit(1);
      if (first) {
        await db.insert(deliveryEvents).values({ orderId: first.orderId, driverId: route.driverId, userId: user.id, type: "route_started" });
      }
    }
    revalidate();
  });
}

async function finishStop(stopId: string, outcome: Outcome) {
  const { at } = outcome;
  const { db, user, stop, route } = await ownStop(stopId);
  if (stop.status !== "pending") throw new UserError("This stop is already completed.");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(routeStops).set({ status: outcome.type, completedAt: now }).where(eq(routeStops.id, stopId));
    await tx.update(orders).set({ status: outcome.type, updatedAt: now }).where(eq(orders.id, stop.orderId));
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
        lat: at?.lat ?? null,
        lng: at?.lng ?? null,
        accuracyM: at?.accuracy ?? null,
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
    await tx
      .update(routes)
      .set(
        remaining.length
          ? { status: "in_progress", startedAt: route.startedAt ?? now }
          : { status: "completed", completedAt: now, startedAt: route.startedAt ?? now },
      )
      .where(eq(routes.id, route.id));
  });
  revalidate();
}

export async function markDelivered(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const outcome = await readOutcome(form, "delivered", await getSettings(await getDb()));
    await finishStop(String(form.get("stopId")), outcome);
    return { message: "Marked as delivered" };
  });
}

export async function markFailed(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const outcome = await readOutcome(form, "failed", await getSettings(await getDb()));
    await finishStop(String(form.get("stopId")), outcome);
    return { message: "Delivery issue reported" };
  });
}

import "server-only";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertUser } from "./auth/dal";
import { getDb } from "./db";
import { deliveryEvents, orders, plans, routes, routeStops } from "./db/schema";
import type { Outcome } from "./outcome";
import { UserError } from "./planning";
import { saveProof } from "./proofs";

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

/**
 * Records a stop as delivered or failed, with its photo and signature. Safe to send twice: a
 * phone that lost signal after the upload went through sends it again, and that's taken as done.
 */
export async function finishStop(stopId: string, outcome: Outcome, at = new Date()): Promise<{ already: boolean }> {
  const { db, user, stop, route } = await ownStop(stopId);
  if (stop.status === outcome.type) return { already: true };
  if (stop.status !== "pending") throw new UserError("This stop is already completed.");
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
    await tx
      .update(routes)
      .set(
        remaining.length
          ? { status: "in_progress", startedAt: route.startedAt ?? now }
          : { status: "completed", completedAt: now, startedAt: route.startedAt ?? now },
      )
      .where(eq(routes.id, route.id));
  });
  revalidateDriverPages();
  return { already: false };
}

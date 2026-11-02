"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { deliveryEvents, orders, plans, routes, routeStops } from "@/lib/db/schema";
import { FAILURE_REASONS } from "@/lib/orders";
import { getSettings, UserError } from "@/lib/planning";
import { readUpload, saveProof } from "@/lib/proofs";

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
  if (!row || row.plan.status !== "dispatched") throw new UserError("This stop isn't assigned to you.");
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
    if (!route) throw new UserError("Route not found.");
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

type Upload = { data: Uint8Array; mime: string } | null;

async function finishStop(
  stopId: string,
  outcome: { type: "delivered"; recipient: string | null; note: string | null } | { type: "failed"; reason: string; note: string | null },
  proofs: { photo: Upload; signature: Upload },
  at: Fix | null,
) {
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
      const p = proofs[kind];
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

type Fix = { lat: number; lng: number; accuracy: number | null };

/** The phone's GPS fix sent with the outcome; ignored when missing or not a real coordinate. */
function readFix(form: FormData): Fix | null {
  const lat = Number(form.get("lat"));
  const lng = Number(form.get("lng"));
  const accuracy = Number(form.get("accuracy"));
  if (!form.get("lat") || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null };
}

const clean = (v: FormDataEntryValue | null, max = 500) => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
};

export async function markDelivered(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const photo = await readUpload(form.get("photo"), "Photo");
    const signature = await readUpload(form.get("signature"), "Signature");
    const recipient = clean(form.get("recipient"), 120);
    const s = await getSettings(await getDb());
    if (s.requirePhoto && !photo) throw new UserError("A delivery photo is required.");
    if (s.requireSignature && !signature) throw new UserError("The customer's signature is required.");
    if (signature && !recipient) throw new UserError("Enter the name of the person who signed.");
    await finishStop(String(form.get("stopId")), { type: "delivered", recipient, note: clean(form.get("note")) }, { photo, signature }, readFix(form));
    return { message: "Marked as delivered" };
  });
}

export async function markFailed(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const reason = String(form.get("reason") ?? "");
    if (!FAILURE_REASONS.includes(reason)) throw new UserError("Choose a reason.");
    const photo = await readUpload(form.get("photo"), "Photo");
    await finishStop(String(form.get("stopId")), { type: "failed", reason, note: clean(form.get("note")) }, { photo, signature: null }, readFix(form));
    return { message: "Delivery issue reported" };
  });
}

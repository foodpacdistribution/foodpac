"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { plans, routes } from "@/lib/db/schema";
import { getT } from "@/lib/i18n/server";
import { UserError } from "@/lib/planning";
import { buildShipment, deleteShipment as removeShipment, recallShipment as recall, sendShipment as send } from "@/lib/shipments";

function revalidate() {
  for (const p of ["/admin/shipments", "/admin/orders", "/admin/planner", "/admin", "/admin/sales", "/admin/tracking", "/driver"]) revalidatePath(p);
}

async function routeWithDate(routeId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ route: routes, date: plans.deliveryDate })
    .from(routes)
    .innerJoin(plans, eq(plans.id, routes.planId))
    .where(eq(routes.id, routeId))
    .limit(1);
  if (!row) throw new UserError("Shipment not found. Reload the page.");
  return { db, ...row };
}

/**
 * New shipment for a driver, or adds the orders to the one they already have that day.
 * With `send`, it goes straight to the driver's phone as well.
 */
export async function createShipment(date: string, driverId: string, orderIds: string[], opts: { send?: boolean } = {}) {
  return attempt(async () => {
    await assertUser(STAFF);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError("Choose a date.");
    if (!orderIds.length) throw new UserError("Select the orders to ship.");
    const db = await getDb();
    const r = await buildShipment(db, date, driverId, orderIds);
    if (opts.send && r) await send(db, r.id);
    revalidate();
    const t = await getT();
    return {
      message: [
        opts.send
          ? t("{number} sent to the driver's phone", { number: r?.number ?? "" })
          : t("Shipment {number} ready: print the docket, then send it to the driver.", { number: r?.number ?? "" }),
        r?.matrixSource === "estimate" && t(ESTIMATE_WARNING),
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
}

const ESTIMATE_WARNING = "road data didn't load, so the stop order is from straight-line distances. Re-optimise it before the driver leaves.";

/**
 * Works out the best stop order again for the stops still to do (from where the driver is, if
 * they've set off). For when the road data didn't load the first time, or the day has changed.
 */
export async function reoptimiseShipment(routeId: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    const { db, route, date } = await routeWithDate(routeId);
    const r = await buildShipment(db, date, route.driverId, []);
    revalidate();
    const t = await getT();
    if (r?.matrixSource === "estimate") throw new UserError(t("Road data still didn't load. Try again in a minute."));
    return { message: t("{number} re-optimised with road data", { number: r?.number ?? route.number }) };
  });
}

export async function removeFromShipment(routeId: string, orderId: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    const { db, route, date } = await routeWithDate(routeId);
    await buildShipment(db, date, route.driverId, [], [orderId]);
    revalidate();
    return { message: "Order taken off the shipment" };
  });
}

export async function sendShipment(routeId: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    const r = await send(await getDb(), routeId);
    revalidate();
    return { message: `${r.number} sent to the driver's phone` };
  });
}

export async function recallShipment(routeId: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    await recall(await getDb(), routeId);
    revalidate();
    return { message: "Shipment taken back from the driver" };
  });
}

export async function deleteShipment(routeId: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    await removeShipment(await getDb(), routeId);
    revalidate();
    return { message: "Shipment deleted; its orders are ready to ship again" };
  });
}

"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { plans, routes } from "@/lib/db/schema";
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

/** New shipment for a driver, or adds the orders to the one they already have that day. */
export async function createShipment(date: string, driverId: string, orderIds: string[]) {
  return attempt(async () => {
    await assertUser(STAFF);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError("Choose a date.");
    if (!orderIds.length) throw new UserError("Select the orders to ship.");
    const r = await buildShipment(await getDb(), date, driverId, orderIds);
    revalidate();
    return { message: `Shipment ${r?.number ?? ""} ready: print the docket, then send it to the driver.` };
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

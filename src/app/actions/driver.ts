"use server";

import { attempt } from "@/lib/action";
import { UserError } from "@/lib/planning";
import { reorderDriverRoute, sendHeadsUp, startDriverRoute } from "@/lib/driver-stops";

/** The driver sets off: the route goes live and its arrival times count from now. */
export async function startRoute(routeId: string) {
  return attempt(() => startDriverRoute(routeId));
}

/** Emails the customer that the driver is about 10 minutes away (once per stop). */
export async function tellCustomerArriving(stopId: string) {
  return attempt(async () => {
    await sendHeadsUp(stopId);
    return { message: "Customer told you're about 10 minutes away" };
  });
}

/** The driver's own stop order (stop ids, still to do), or null for the best order from where they are. */
export async function reorderStops(routeId: string, stopIds: string[] | null) {
  return attempt(async () => {
    if (stopIds !== null && (!Array.isArray(stopIds) || stopIds.some((id) => typeof id !== "string"))) throw new UserError("Invalid stop order.");
    await reorderDriverRoute(routeId, stopIds);
    return { message: stopIds ? "Your order is saved; arrival times updated" : "Stops are back in the best order" };
  });
}

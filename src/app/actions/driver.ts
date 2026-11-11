"use server";

import { attempt } from "@/lib/action";
import { sendHeadsUp, startDriverRoute } from "@/lib/driver-stops";

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

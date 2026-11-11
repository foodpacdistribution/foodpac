"use server";

import { attempt } from "@/lib/action";
import { startDriverRoute } from "@/lib/driver-stops";

/** The driver sets off: the route goes live and its arrival times count from now. */
export async function startRoute(routeId: string) {
  return attempt(() => startDriverRoute(routeId));
}

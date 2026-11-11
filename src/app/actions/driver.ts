"use server";

import { and, eq } from "drizzle-orm";
import { attempt } from "@/lib/action";
import { assertUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { deliveryEvents, routes, routeStops } from "@/lib/db/schema";
import { revalidateDriverPages } from "@/lib/driver-stops";
import { UserError } from "@/lib/planning";

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
    revalidateDriverPages();
  });
}

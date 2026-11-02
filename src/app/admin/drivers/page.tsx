import { asc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { depots, drivers, plans, routes, routeStops, users } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { todayIn } from "@/lib/time";
import { DriversClient } from "./drivers-client";

export const metadata: Metadata = { title: "Drivers" };

export default async function DriversPage() {
  const user = await requireUser(STAFF);
  const db = await getDb();
  const s = await getSettings(db);
  const rows = await db
    .select({ d: drivers, email: users.email })
    .from(drivers)
    .leftJoin(users, eq(users.driverId, drivers.id))
    .orderBy(asc(drivers.name));

  const depotRows = await db.select({ id: depots.id, name: depots.name }).from(depots).orderBy(asc(depots.createdAt));
  const [plan] = await db.select().from(plans).where(eq(plans.deliveryDate, todayIn(s.timezone))).limit(1);
  const todays = plan ? await db.select().from(routes).where(eq(routes.planId, plan.id)) : [];
  const stops = todays.length
    ? await db
        .select({ routeId: routeStops.routeId, status: routeStops.status })
        .from(routeStops)
        .where(inArray(routeStops.routeId, todays.map((r) => r.id)))
    : [];

  return (
    <DriversClient
      canEdit={user.role === "admin"}
      depots={depotRows}
      defaults={{ startMin: s.defaultStartMin, maxShiftMin: s.defaultMaxShiftMin }}
      drivers={rows.map(({ d, email }) => {
        const route = todays.find((r) => r.driverId === d.id);
        const own = route ? stops.filter((x) => x.routeId === route.id) : [];
        return {
          ...d,
          createdAt: d.createdAt.toISOString(),
          email,
          today: route
            ? {
                stops: own.length,
                done: own.filter((x) => x.status !== "pending").length,
                endS: route.endS,
                status: route.status,
                dispatched: plan!.status === "dispatched",
              }
            : null,
        };
      })}
    />
  );
}

import { and, asc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { plans, routes, routeStops } from "@/lib/db/schema";
import { depotFor, getDepots, getPlanView, getSettings } from "@/lib/planning";
import { nowSecondsIn, todayIn } from "@/lib/time";
import { DriverClient } from "./driver-client";

export const metadata: Metadata = { title: "My deliveries" };

export default async function DriverPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser(["driver"]);
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  // Every day from today on that has a route sent to this driver.
  const days = user.driverId
    ? await db
        .select({ date: plans.deliveryDate, stops: sql<number>`count(${routeStops.id})::int` })
        .from(routes)
        .innerJoin(plans, eq(plans.id, routes.planId))
        .leftJoin(routeStops, eq(routeStops.routeId, routes.id))
        .where(and(eq(routes.driverId, user.driverId), isNotNull(routes.dispatchedAt), gte(plans.deliveryDate, today)))
        .groupBy(plans.deliveryDate)
        .orderBy(asc(plans.deliveryDate))
        .limit(14)
    : [];
  const asked = (await searchParams).date;
  const date = asked && days.some((d) => d.date === asked) ? asked : today;
  const view = await getPlanView(db, date);
  // Drivers only ever receive their own route, and only once it has been dispatched.
  const route = view.routes.find((r) => r.driverId === user.driverId && r.dispatchedAt) ?? null;
  const depot = depotFor(await getDepots(db), route?.depotId);

  return (
    <DriverClient
      name={user.name.split(" ")[0]}
      linked={!!user.driverId}
      date={date}
      today={today}
      days={days}
      nowS={nowSecondsIn(s.timezone)}
      depot={depot}
      route={route}
      requirePhoto={s.requirePhoto}
      requireSignature={s.requireSignature}
    />
  );
}

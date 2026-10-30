import { and, asc, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { drivers, optimisationRuns, orders } from "@/lib/db/schema";
import { getDepots, getPlanView, getSettings } from "@/lib/planning";
import { todayIn } from "@/lib/time";
import { PlannerClient } from "./planner-client";

export const metadata: Metadata = { title: "Route Planner" };

export default async function PlannerPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;

  const [view, driverRows, orderRows, depotList] = await Promise.all([
    getPlanView(db, date),
    db.select().from(drivers).where(eq(drivers.active, true)).orderBy(asc(drivers.name)),
    db.select().from(orders).where(eq(orders.deliveryDate, date)).orderBy(asc(orders.createdAt), asc(orders.orderNumber)),
    getDepots(db),
  ]);
  const [lastRun] = view.plan
    ? await db
        .select({ settings: optimisationRuns.settings })
        .from(optimisationRuns)
        .where(and(eq(optimisationRuns.planId, view.plan.id), eq(optimisationRuns.kind, "optimise")))
        .orderBy(desc(optimisationRuns.createdAt))
        .limit(1)
    : [];

  return (
    <PlannerClient
      date={date}
      today={today}
      depots={depotList}
      defaults={{
        startMin: s.defaultStartMin,
        serviceMin: s.defaultServiceMin,
        trafficFactor: s.trafficFactor,
        returnToDepot: s.returnToDepot,
        maxShiftMin: s.defaultMaxShiftMin,
      }}
      lastSettings={(lastRun?.settings as Record<string, unknown> | null) ?? null}
      drivers={driverRows.map((d) => ({
        id: d.id,
        name: d.name,
        color: d.color,
        vehicle: d.vehicle,
        capacity: d.capacity,
        shiftStartMin: d.shiftStartMin,
        maxShiftMin: d.maxShiftMin,
        depotId: d.depotId ?? depotList[0]?.id ?? null,
        maxTrips: d.maxTrips,
      }))}
      orders={orderRows.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        address: o.address,
        lat: o.lat,
        lng: o.lng,
        geocodeStatus: o.geocodeStatus,
        status: o.status,
        windowStartMin: o.windowStartMin,
        windowEndMin: o.windowEndMin,
        priority: o.priority,
        demand: o.demand,
        pinnedDriverId: o.pinnedDriverId,
        depotId: o.depotId,
      }))}
      view={view}
    />
  );
}

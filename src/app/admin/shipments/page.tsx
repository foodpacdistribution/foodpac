import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { restoreDeliveries } from "@/lib/deliveries";
import { drivers } from "@/lib/db/schema";
import { getDepots, getPlanView, getSettings } from "@/lib/planning";
import { readyToShip } from "@/lib/shipments";
import { nowSecondsIn, todayIn } from "@/lib/time";
import { ShipmentsClient } from "./shipments-client";

export const metadata: Metadata = { title: "Shipments" };

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const db = await getDb();
  const s = await getSettings(db);
  await restoreDeliveries(db, s.timezone);
  const today = todayIn(s.timezone);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const [ready, view, driverRows, depots] = await Promise.all([
    readyToShip(db, date),
    getPlanView(db, date),
    db.select({ id: drivers.id, name: drivers.name, color: drivers.color, capacity: drivers.capacity }).from(drivers).where(eq(drivers.active, true)).orderBy(asc(drivers.name)),
    getDepots(db),
  ]);

  return (
    <ShipmentsClient
      date={date}
      today={today}
      hasDepot={depots.length > 0}
      ready={ready}
      drivers={driverRows}
      shipments={view.routes.map((r) => ({
        id: r.id,
        number: r.number,
        driverId: r.driverId,
        driverName: r.driverName,
        color: r.color,
        vehicle: r.vehicle,
        capacity: r.capacity,
        status: r.status,
        dispatchedAt: r.dispatchedAt,
        matrixSource: r.matrixSource,
        startS: r.startS,
        endS: r.endS,
        distanceM: r.distanceM,
        overtimeS: r.overtimeS,
        overCapacity: r.overCapacity,
        stops: r.stops.map((st) => ({
          orderId: st.orderId,
          seq: st.seq,
          lateS: st.lateS,
          // When the driver confirmed it (signature / photo); nothing until then. Seconds are dropped
          // (not rounded) so it reads the same minute as the invoice's "Delivered … at".
          doneS: st.completedAt && st.status !== "pending" ? Math.floor(nowSecondsIn(s.timezone, new Date(st.completedAt)) / 60) * 60 : null,
          status: st.status,
          orderNumber: st.order.orderNumber,
          customerName: st.order.customerName,
          address: st.order.address,
          demand: st.order.demand,
        })),
      }))}
    />
  );
}

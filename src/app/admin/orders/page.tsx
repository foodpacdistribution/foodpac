import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { restoreDeliveries } from "@/lib/deliveries";
import { depots, drivers, type OrderStatus, orders, plans, routeStops, routes } from "@/lib/db/schema";
import { relocateMisplacedOrders } from "@/lib/geo/geocode";
import { getSettings } from "@/lib/planning";
import { todayIn } from "@/lib/time";
import { OrdersClient } from "./orders-client";
import { databaseUrl } from "@/lib/db/url";
import { needsAttention } from "@/lib/orders";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser(STAFF);
  const sp = await searchParams;
  const db = await getDb();
  const s = await getSettings(db);
  await restoreDeliveries(db, s.timezone);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIn(s.timezone);
  await relocateMisplacedOrders(db, date);
  const status = sp.status as OrderStatus | "attention" | undefined;
  const q = sp.q?.trim();

  const where: SQL[] = [eq(orders.deliveryDate, date)];
  if (q) where.push(or(ilike(orders.orderNumber, `%${q}%`), ilike(orders.customerName, `%${q}%`), ilike(orders.address, `%${q}%`))!);

  const rows = await db.select().from(orders).where(and(...where)).orderBy(asc(orders.createdAt), asc(orders.orderNumber));
  const driverRows = await db.select({ id: drivers.id, name: drivers.name, color: drivers.color }).from(drivers).orderBy(asc(drivers.name));
  const depotRows = await db.select({ id: depots.id, name: depots.name }).from(depots).orderBy(asc(depots.createdAt));
  // Where each order sits in this day's planned routes, so the list reads in delivery order.
  const stopRows = await db
    .select({ orderId: routeStops.orderId, driverId: routes.driverId, seq: routeStops.seq, etaS: routeStops.etaS })
    .from(routeStops)
    .innerJoin(routes, eq(routes.id, routeStops.routeId))
    .innerJoin(plans, eq(plans.id, routes.planId))
    .where(eq(plans.deliveryDate, date));
  const stopByOrder = new Map(stopRows.map((st) => [st.orderId, st]));
  const driverRank = new Map(driverRows.map((d, i) => [d.id, i]));
  // Routed orders first, one driver's route after another in stop order; orders not on a route keep their added order after them.
  const routed = (o: (typeof rows)[number]) => stopByOrder.get(o.id);
  rows.sort((a, b) => {
    const sa = routed(a);
    const sb = routed(b);
    if (sa && sb) return (driverRank.get(sa.driverId) ?? 0) - (driverRank.get(sb.driverId) ?? 0) || sa.seq - sb.seq;
    return (sa ? 0 : 1) - (sb ? 0 : 1);
  });

  const filtered = rows.filter((o) => {
    if (!status) return true;
    if (status === "attention") return needsAttention(o);
    return o.status === status;
  });

  return (
    <OrdersClient
      isAdmin={me.role === "admin"}
      date={date}
      today={todayIn(s.timezone)}
      status={status ?? ""}
      q={q ?? ""}
      demoMode={!databaseUrl()}
      defaultServiceMin={s.defaultServiceMin}
      counts={{
        all: rows.length,
        attention: rows.filter(needsAttention).length,
        pending: rows.filter((o) => o.status === "pending").length,
        planned: rows.filter((o) => o.status === "planned").length,
        dispatched: rows.filter((o) => o.status === "dispatched").length,
        delivered: rows.filter((o) => o.status === "delivered").length,
        failed: rows.filter((o) => o.status === "failed").length,
      }}
      orders={filtered.map((o) => {
        const st = stopByOrder.get(o.id);
        return { ...o, createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString(), stopSeq: st?.seq ?? null, stopEtaS: st?.etaS ?? null };
      })}
      drivers={driverRows}
      depots={depotRows}
    />
  );
}

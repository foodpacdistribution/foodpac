import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { depots, drivers, type OrderStatus, orders } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { todayIn } from "@/lib/time";
import { OrdersClient } from "./orders-client";
import { databaseUrl } from "@/lib/db/url";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser(STAFF);
  const sp = await searchParams;
  const db = await getDb();
  const s = await getSettings(db);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIn(s.timezone);
  const status = sp.status as OrderStatus | "attention" | undefined;
  const q = sp.q?.trim();

  const where: SQL[] = [eq(orders.deliveryDate, date)];
  if (q) where.push(or(ilike(orders.orderNumber, `%${q}%`), ilike(orders.customerName, `%${q}%`), ilike(orders.address, `%${q}%`))!);

  const rows = await db.select().from(orders).where(and(...where)).orderBy(asc(orders.createdAt), asc(orders.orderNumber));
  const driverRows = await db.select({ id: drivers.id, name: drivers.name, color: drivers.color }).from(drivers).orderBy(asc(drivers.name));
  const depotRows = await db.select({ id: depots.id, name: depots.name }).from(depots).orderBy(asc(depots.createdAt));

  const filtered = rows.filter((o) => {
    if (!status) return true;
    if (status === "attention") return o.geocodeStatus !== "ok";
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
        attention: rows.filter((o) => o.geocodeStatus !== "ok").length,
        pending: rows.filter((o) => o.status === "pending").length,
        planned: rows.filter((o) => o.status === "planned").length,
        dispatched: rows.filter((o) => o.status === "dispatched").length,
        delivered: rows.filter((o) => o.status === "delivered").length,
        failed: rows.filter((o) => o.status === "failed").length,
      }}
      orders={filtered.map((o) => ({ ...o, createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString() }))}
      drivers={driverRows}
      depots={depotRows}
    />
  );
}

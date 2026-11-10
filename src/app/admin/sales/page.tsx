import { and, desc, eq, gte, ilike, lte, ne, or, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { shiftDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { restoreDeliveries } from "@/lib/deliveries";
import { customers, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { deliveryStatuses } from "@/lib/portal";
import { missedDelivery } from "@/lib/staff-orders";
import { todayIn } from "@/lib/time";
import { SalesClient } from "./sales-client";

export const metadata: Metadata = { title: "Sales Orders" };

const VIEWS = ["open", "missed", "invoice", "unpaid", "all", "cancelled"] as const;

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; from?: string; to?: string }> }) {
  const me = await requireUser(STAFF);
  const sp = await searchParams;
  const view = VIEWS.find((v) => v === sp.view) ?? "open";
  const db = await getDb();
  const s = await getSettings(db);
  await restoreDeliveries(db, s.timezone);
  const today = todayIn(s.timezone);
  const q = (sp.q ?? "").trim().slice(0, 100);
  const isDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
  const from = isDate(sp.from);
  const to = isDate(sp.to);
  const where = and(
    view === "open"
      ? and(ne(salesOrders.status, "cancelled"), from ? undefined : or(gte(salesOrders.deliveryDate, shiftDate(today, -1)), missedDelivery(today)))
      : view === "missed"
        ? missedDelivery(today)
      : view === "invoice"
        ? // Confirmed orders whose invoice is still a proforma, waiting to be finalised.
          and(eq(salesOrders.status, "confirmed"), eq(salesOrders.invoiceStatus, "proforma"))
      : view === "unpaid"
        ? and(ne(salesOrders.status, "cancelled"), eq(salesOrders.paymentStatus, "unpaid"))
        : view === "cancelled"
          ? eq(salesOrders.status, "cancelled")
          : undefined,
    q ? or(ilike(salesOrders.number, `%${q}%`), ilike(customers.name, `%${q}%`)) : undefined,
    from ? gte(salesOrders.deliveryDate, from) : undefined,
    to ? lte(salesOrders.deliveryDate, to) : undefined,
  );
  const todaySalesQuery = db
    .select({ todaySales: sql<number>`coalesce(sum(${salesOrders.totalCents}), 0)::int` })
    .from(salesOrders)
    .where(and(ne(salesOrders.status, "cancelled"), gte(salesOrders.createdAt, sql`(${today}::timestamp at time zone ${s.timezone})`)));
  const rows = await db
    .select({
      so: salesOrders,
      customer: customers.name,
      items: sql<number>`(select coalesce(sum(soi.qty), 0)::int from ${salesOrderItems} soi where soi.sales_order_id = ${salesOrders}.id)`,
      waiting: sql<number>`(select coalesce(sum(soi.backorder_qty), 0)::int from ${salesOrderItems} soi where soi.sales_order_id = ${salesOrders}.id)`,
      missed: sql<boolean>`coalesce(${missedDelivery(today)}, false)`,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(where)
    .orderBy(view === "open" || view === "missed" || view === "invoice" ? sql`${salesOrders.deliveryDate} asc, ${salesOrders.createdAt} asc` : desc(salesOrders.createdAt))
    .limit(300);
  const [delivery, [{ todaySales }], [{ missedCount }]] = await Promise.all([
    deliveryStatuses(db, rows.map((r) => r.so.deliveryOrderId).filter((x): x is string => !!x)),
    todaySalesQuery,
    db.select({ missedCount: sql<number>`count(*)::int` }).from(salesOrders).where(missedDelivery(today)),
  ]);
  const unpaidIds = rows.filter((r) => r.so.paymentStatus === "unpaid" && r.so.status !== "cancelled").map((r) => r.so.id);

  return (
    <SalesClient
      isAdmin={me.role === "admin"}
      view={view}
      filters={{ q, from: from ?? "", to: to ?? "" }}
      today={today}
      todaySalesCents={todaySales}
      unpaidCount={unpaidIds.length}
      missedCount={missedCount}
      rows={rows.map(({ so, customer, items, waiting, missed }) => ({
        id: so.id,
        number: so.number,
        customer,
        items,
        totalCents: so.totalCents,
        deliveryDate: so.deliveryDate,
        status: so.status,
        paymentStatus: so.paymentStatus,
        paymentMethod: so.paymentMethod,
        fulfilment: so.fulfilment,
        delivery: so.deliveryOrderId ? (delivery.get(so.deliveryOrderId)?.stage ?? null) : null,
        dueDate: so.dueDate,
        invoiceStatus: so.invoiceStatus,
        waiting,
        missed,
      }))}
    />
  );
}

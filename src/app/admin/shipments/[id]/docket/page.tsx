import { asc, eq, inArray } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { notFound } from "next/navigation";
import { SITE } from "@/app/(site)/content";
import { Logo } from "@/components/brand";
import { PrintButton } from "@/components/print-button";
import { btn } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { drivers, orders, plans, routes, routeStops, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { depotFor, getDepots, getSettings } from "@/lib/planning";
import { formatClock, formatKm, formatMinutesClock } from "@/lib/time";
import { T, Tx } from "@/components/i18n";

export const metadata: Metadata = { title: "Shipment docket" };

/** The paper that goes with the driver: stops in delivery order, items, and a signature box per drop. */
export default async function DocketPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(STAFF);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [row] = await db
    .select({ route: routes, driver: drivers, date: plans.deliveryDate })
    .from(routes)
    .innerJoin(drivers, eq(drivers.id, routes.driverId))
    .innerJoin(plans, eq(plans.id, routes.planId))
    .where(eq(routes.id, id))
    .limit(1);
  if (!row) notFound();
  const { route, driver, date } = row;
  const [s, depotList, stops] = await Promise.all([
    getSettings(db),
    getDepots(db),
    db
      .select({ stop: routeStops, order: orders })
      .from(routeStops)
      .innerJoin(orders, eq(orders.id, routeStops.orderId))
      .where(eq(routeStops.routeId, id))
      .orderBy(asc(routeStops.seq)),
  ]);
  const depot = depotFor(depotList, driver.depotId);
  const orderIds = stops.map((x) => x.order.id);
  const items = orderIds.length
    ? await db
        .select({ deliveryOrderId: salesOrders.deliveryOrderId, item: salesOrderItems })
        .from(salesOrderItems)
        .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.salesOrderId))
        .where(inArray(salesOrders.deliveryOrderId, orderIds))
    : [];
  const units = stops.reduce((t, x) => t + x.order.demand, 0);
  const printed = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date());

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/admin/shipments?date=${date}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="size-4" /> {" "}<T>{"Shipments"}</T></Link>
        <PrintButton className={btn("primary")} label={<T>{"Print docket"}</T>} />
      </div>

      <article className="rounded-xl border border-line bg-white p-6 text-sm text-slate-900 sm:p-8 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-slate-900 pb-4">
          <div className="flex items-center gap-4">
            <Logo className="h-14" />
            <div>
              <p className="text-xl font-bold tracking-tight"><T>{"Shipment docket"}</T></p>
              <p className="text-slate-600">{SITE.name}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-bold">{route.number}</p>
            <p className="font-medium">{<Tx>{prettyDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</Tx>}</p>
          </div>
        </header>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Info label={<T>{"Driver"}</T>} value={driver.name} />
          <Info label={<T>{"Vehicle"}</T>} value={driver.vehicle ?? "—"} />
          <Info label={<T>{"Depot"}</T>} value={depot ? `${depot.name}` : "—"} sub={depot?.address} />
          <Info label={<T>{"Departs → returns"}</T>} value={`${formatClock(route.startS)} → ${formatClock(route.endS)}`} sub={`${stops.length} stops · ${units} units · ${formatKm(route.distanceM)}`} />
        </dl>

        <table className="mt-6 w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-y border-slate-900 text-left text-[11px] uppercase tracking-wide">
              <th className="w-8 py-2">#</th>
              <th className="w-20 py-2"><T>{"ETA"}</T></th>
              <th className="py-2"><T>{"Deliver to"}</T></th>
              <th className="py-2"><T>{"Goods"}</T></th>
              <th className="w-44 py-2"><T>{"Received by / signature"}</T></th>
            </tr>
          </thead>
          <tbody>
            {stops.map(({ stop, order }) => {
              const lines = items.filter((x) => x.deliveryOrderId === order.id);
              const win =
                order.windowStartMin !== null || order.windowEndMin !== null
                  ? `${order.windowStartMin !== null ? formatMinutesClock(order.windowStartMin) : "any"}–${order.windowEndMin !== null ? formatMinutesClock(order.windowEndMin) : "close"}`
                  : null;
              return (
                <tr key={stop.id} className="break-inside-avoid border-b border-slate-300 align-top">
                  <td className="py-2.5 font-bold">{stop.seq}</td>
                  <td className="py-2.5">
                    <span className="font-semibold">{formatClock(stop.etaS)}</span>
                    {win && <span className="block text-[11px] text-slate-500">{win}</span>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <p className="font-semibold">
                      {order.customerName || "—"} <span className="font-mono text-[11px] font-normal text-slate-500">{order.orderNumber}</span>
                    </p>
                    <p>{order.address}</p>
                    {order.phone && <p className="text-slate-600">{order.phone}</p>}
                    {order.notes && <p className="mt-0.5 text-[12px] italic text-slate-600">{order.notes}</p>}
                  </td>
                  <td className="py-2.5 pr-3">
                    {lines.length ? (
                      <ul className="space-y-0.5">
                        {lines.map(({ item }) => (
                          <li key={item.id}>
                            <span className="font-semibold">{item.qty}×</span> {item.name} <span className="text-[11px] text-slate-500">({item.sku})</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span><T>{"Qty"}</T>{" "}{order.demand}</span>
                    )}
                  </td>
                  <td className="py-2.5">
                    <div className="h-12 rounded border border-slate-300" />
                    <p className="mt-0.5 text-[10px] text-slate-400"><T>{"Name · signature · time"}</T></p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-8 grid grid-cols-3 gap-6 text-[12px]">
          {["Loaded by", "Checked by", "Driver signature"].map((l) => (
            <div key={l}>
              <div className="h-10 border-b border-slate-900" />
              <p className="mt-1 text-slate-600">{l}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[11px] text-slate-400">
          <T>{"Printed"}</T>{" "}{printed}<T>{". Deliveries are also confirmed on the driver's phone with a photo, signature and GPS location."}</T></p>
      </article>
    </div>
  );
}

function Info({ label, value, sub }: { label: React.ReactNode; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{<Tx>{label}</Tx>}</dt>
      <dd className="font-semibold">{value}</dd>
      {sub && <dd className="text-[12px] text-slate-600">{sub}</dd>}
    </div>
  );
}

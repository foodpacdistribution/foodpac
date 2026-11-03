import { desc, eq } from "drizzle-orm";
import { CheckCircle2, Circle, Clock, Map as MapIcon, Package, PackageCheck, PackageX, Radio, Truck, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DeliveryMap, type MapStop } from "@/components/map";
import { Badge, btn, Card, CardHeader, ColorDot, cx, EmptyState, PageHeader, Stat } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { deliveryEvents, drivers, orders } from "@/lib/db/schema";
import { prettyDate } from "@/lib/dates";
import { formatAgo, vehicleMarkers } from "@/lib/live-map";
import { getDepots, getPlanView, getSettings } from "@/lib/planning";
import { liveFleet } from "@/lib/tracking";
import { formatClock, nowSecondsIn, todayIn } from "@/lib/time";
import { DemoOrdersButton } from "./demo-orders-button";
import { databaseUrl } from "@/lib/db/url";
import { T, Tx } from "@/components/i18n";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser(STAFF);
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const nowS = nowSecondsIn(s.timezone);
  const [view, dayOrders, depotList] = await Promise.all([
    getPlanView(db, today),
    db.select().from(orders).where(eq(orders.deliveryDate, today)),
    getDepots(db),
  ]);
  const [live, events] = await Promise.all([
    liveFleet(db, view.routes.filter((r) => r.status !== "planned")),
    db
      .select({ e: deliveryEvents, orderNumber: orders.orderNumber, customer: orders.customerName, driver: drivers.name, color: drivers.color })
      .from(deliveryEvents)
      .innerJoin(orders, eq(orders.id, deliveryEvents.orderId))
      .leftJoin(drivers, eq(drivers.id, deliveryEvents.driverId))
      .where(eq(orders.deliveryDate, today))
      .orderBy(desc(deliveryEvents.createdAt))
      .limit(8),
  ]);

  const plan = view.plan;
  const dispatched = plan?.status === "dispatched" || view.routes.some((r) => r.dispatchedAt);
  const count = (st: string) => dayOrders.filter((o) => o.status === st).length;
  const delivered = count("delivered");
  const failed = count("failed");
  const outForDelivery = view.routes.filter((r) => r.dispatchedAt).reduce((a, r) => a + r.stops.filter((x) => x.status === "pending").length, 0);
  const activeDrivers = view.routes.filter((r) => r.status === "in_progress").length;
  const notLocated = dayOrders.filter((o) => o.geocodeStatus !== "ok" && o.status !== "delivered").length;

  // Projected finish = planned finish pushed back by how late the driver is for their next stop right now.
  const routeRows = view.routes.map((r) => {
    const next = r.stops.find((x) => x.status === "pending");
    const delay = r.status === "in_progress" && next ? Math.max(0, nowS - next.etaS) : 0;
    return {
      r,
      done: r.stops.filter((x) => x.status === "delivered").length,
      failed: r.stops.filter((x) => x.status === "failed").length,
      next,
      projected: r.status === "completed" ? null : r.endS + delay,
      delay,
    };
  });
  const projectedFinish = routeRows.length ? Math.max(...routeRows.map((x) => x.projected ?? 0)) : null;

  const steps = [
    { done: dayOrders.length > 0, label: "Import today's orders", href: `/admin/orders/import?date=${today}`, icon: Upload },
    { done: dayOrders.length > 0 && notLocated === 0, label: "Verify delivery addresses", href: `/admin/orders?date=${today}&status=attention`, icon: Package },
    { done: !!plan, label: "Optimise routes", href: `/admin/planner?date=${today}`, icon: MapIcon },
    { done: dispatched, label: "Dispatch to drivers", href: `/admin/planner?date=${today}`, icon: Truck },
  ];
  const nextStep = steps.find((st) => !st.done);

  const mapStops: MapStop[] = view.routes.flatMap((r) =>
    r.stops.map((x) => ({
      id: x.id,
      routeId: r.driverId,
      lat: x.order.lat,
      lng: x.order.lng,
      label: String(x.seq),
      color: r.color,
      status: x.status,
      title: `${x.order.orderNumber} · ${x.order.customerName}`,
      lines: [x.order.address, `${r.driverName} · ETA ${formatClock(x.etaS)}`],
    })),
  );

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        subtitle={`${prettyDate(today, { weekday: "long", day: "numeric", month: "long" })} · ${depotList.map((d) => d.name).join(", ") || "No depot set"}`}
        actions={
          // Always point at the next unfinished step of the day, so it's clear what to do now.
          nextStep ? (
            <Link href={nextStep.href} className={btn("primary")}>
              <nextStep.icon className="size-4" /> {nextStep.label}
            </Link>
          ) : (
            <Link href="/admin/tracking" className={btn("primary")}>
              <Radio className="size-4" /> {" "}<T>{"Follow the drivers live"}</T></Link>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={<T>{"Today's orders"}</T>} value={dayOrders.length} icon={Package} tone="slate" hint={notLocated ? `${notLocated} need an address check` : undefined} />
        <Stat label={<T>{"Unplanned"}</T>} value={count("pending")} icon={Circle} tone="violet" hint={count("planned") ? `${count("planned")} planned, not sent` : undefined} />
        <Stat label={<T>{"Out for delivery"}</T>} value={outForDelivery} icon={Truck} tone="blue" />
        <Stat label={<T>{"Delivered"}</T>} value={delivered} icon={PackageCheck} tone="green" hint={dayOrders.length ? `${Math.round((delivered / dayOrders.length) * 100)}% of today` : undefined} />
        <Stat label={<T>{"Failed"}</T>} value={failed} icon={PackageX} tone={failed ? "red" : "slate"} />
        <Stat
          label={<T>{"Projected completion"}</T>}
          value={projectedFinish ? formatClock(projectedFinish) : "—"}
          icon={Clock}
          tone="amber"
          hint={activeDrivers ? `${activeDrivers} driver(s) on the road` : plan ? "Planned finish" : "No plan yet"}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-4">
          <Card className="overflow-hidden">
            <CardHeader
              title={<T>{"Live delivery map"}</T>}
              subtitle={dispatched ? "Green delivered, red failed, round markers are drivers' live positions" : "Showing today's plan"}
              action={
                <Link href="/admin/tracking" className={btn("ghost", "sm")}>
                  <T>{"Live tracking →"}</T></Link>
              }
            />
            <div className="h-[420px]">
              <DeliveryMap
                fitOnce
                depots={depotList}
                vehicles={vehicleMarkers(view.routes, live)}
                stops={mapStops}
                routes={view.routes.filter((r) => r.geometry).map((r) => ({ id: r.driverId, color: r.color, path: r.geometry! }))}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title={<T>{"Drivers today"}</T>} />
            {routeRows.length === 0 && dayOrders.length === 0 ? (
              <EmptyState icon={Package} title={<T>{"No orders for today yet"}</T>}>
                <T>{"Start by adding today's deliveries. Then the planner builds each driver's route."}</T><div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Link href={`/admin/orders/import?date=${today}`} className={btn("primary", "sm")}>
                    <Upload className="size-3.5" /> {" "}<T>{"Import a spreadsheet"}</T></Link>
                  <Link href={`/admin/orders?date=${today}`} className={btn("secondary", "sm")}>
                    <T>{"Add orders by hand"}</T></Link>
                  {!databaseUrl() && <DemoOrdersButton date={today} />}
                </div>
              </EmptyState>
            ) : routeRows.length === 0 ? (
              <EmptyState icon={Truck} title={<T>{"No routes planned for today"}</T>}>
                {dayOrders.length}{" "}
                <T>{dayOrders.length === 1 ? "order is waiting. The planner turns them into driver routes in a few seconds." : "orders are waiting. The planner turns them into driver routes in a few seconds."}</T><div className="mt-3">
                  <Link href={`/admin/planner?date=${today}`} className={btn("primary", "sm")}>
                    <MapIcon className="size-3.5" /> {" "}<T>{"Plan today's routes"}</T></Link>
                </div>
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2.5"><T>{"Driver"}</T></th>
                      <th className="px-4 py-2.5"><T>{"Progress"}</T></th>
                      <th className="px-4 py-2.5"><T>{"Next stop"}</T></th>
                      <th className="px-4 py-2.5 text-right"><T>{"Planned finish"}</T></th>
                      <th className="px-4 py-2.5 text-right"><T>{"Projected"}</T></th>
                      <th className="px-4 py-2.5"><T>{"Status"}</T></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {routeRows.map(({ r, done, failed: f, next, projected, delay }) => {
                      const gps = live.find((v) => v.routeId === r.id);
                      return (
                      <tr key={r.id}>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2 font-medium text-slate-900">
                            <ColorDot color={r.color} /> {r.driverName}
                          </span>
                          <span className="text-xs text-slate-500">
                            {r.vehicle}
                            {r.trips > 1 && <> <Tx>{`· ${r.trips} trips`}</Tx></>}
                            {gps && r.status === "in_progress" && (
                              <span className={gps.stale ? "text-amber-600" : "text-emerald-600"}> {" "}<T>{"· GPS"}</T>{" "}<Tx>{formatAgo(gps.ageS)}</Tx></span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full bg-emerald-500" style={{ width: `${((done + f) / Math.max(1, r.stops.length)) * 100}%` }} />
                            </div>
                            <span className="text-xs tabular-nums text-slate-600">
                              {done + f}/{r.stops.length}
                            </span>
                            {f > 0 && <Badge tone="red">{f} {" "}<T>{"failed"}</T></Badge>}
                          </div>
                        </td>
                        <td className="max-w-52 px-4 py-3">
                          {next ? (
                            <>
                              <p className="truncate text-slate-800">{next.order.customerName || next.order.orderNumber}</p>
                              <p className="text-xs text-slate-500"><T>{"ETA"}</T>{" "}{formatClock(next.etaS)}</p>
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatClock(r.endS)}</td>
                        <td className={cx("px-4 py-3 text-right tabular-nums", delay > 600 ? "font-semibold text-amber-600" : "text-slate-700")}>
                          {projected ? formatClock(projected) : <T>{"Done"}</T>}
                        </td>
                        <td className="px-4 py-3">
                          {r.status === "completed" ? (
                            <Badge tone="green"><T>{"Finished"}</T></Badge>
                          ) : r.status === "in_progress" ? (
                            <Badge tone="blue"><T>{"On delivery"}</T></Badge>
                          ) : dispatched ? (
                            <Badge tone="slate"><T>{"Not started"}</T></Badge>
                          ) : (
                            <Badge tone="violet"><T>{"Draft"}</T></Badge>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={<T>{"Today's checklist"}</T>} />
            <ol className="space-y-1 p-3">
              {steps.map((st, i) => (
                <li key={st.label}>
                  <Link href={st.href} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                    {st.done ? (
                      <CheckCircle2 className="size-5 text-emerald-500" />
                    ) : (
                      <span className="grid size-5 place-items-center rounded-full border-2 border-slate-300 text-[10px] font-bold text-slate-400">{i + 1}</span>
                    )}
                    <span className={cx("flex-1 text-sm", st.done ? "text-slate-400 line-through" : "font-medium text-slate-800")}>{<Tx>{st.label}</Tx>}</span>
                    <st.icon className="size-4 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardHeader title={<T>{"Recent activity"}</T>} />
            {events.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400"><T>{"Driver updates will appear here."}</T></p>
            ) : (
              <ul className="divide-y divide-line">
                {events.map(({ e, orderNumber, customer, driver, color }) => (
                  <li key={e.id} className="flex gap-3 px-4 py-2.5">
                    <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", e.type === "delivered" ? "bg-emerald-500" : e.type === "failed" ? "bg-red-500" : "bg-blue-500")} />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="text-slate-800">
                        <span className="font-medium" style={{ color: color ?? undefined }}>
                          {driver ?? <T>{"Driver"}</T>}
                        </span>{" "}
                        {e.type === "delivered" ? <T>{"delivered"}</T> : e.type === "failed" ? <T>{"couldn't deliver"}</T> : <T>{"started their route with"}</T>} {orderNumber}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {customer}
                        {e.reason && ` · ${e.reason}`}
                        {e.recipient && <> <Tx>{`· received by ${e.recipient}`}</Tx></>}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">
                      {e.createdAt.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: s.timezone })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

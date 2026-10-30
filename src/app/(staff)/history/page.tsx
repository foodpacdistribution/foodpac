import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { BarChart3, CheckCircle2, Clock, Route as RouteIcon, TrendingDown, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, btn, Card, CardHeader, ColorDot, cx, EmptyState, PageHeader, Stat } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { deliveryEvents, drivers, orders, plans, routes, routeStops } from "@/lib/db/schema";
import { prettyDate, shiftDate } from "@/lib/dates";
import { getSettings } from "@/lib/planning";
import { formatDuration, formatKm, nowSecondsIn, todayIn } from "@/lib/time";
import { loadFixes, trackDistance } from "@/lib/tracking";

export const metadata: Metadata = { title: "Delivery History" };

const RANGES = [7, 30, 90] as const;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const days = RANGES.find((d) => String(d) === sp.days) ?? 30;
  const db = await getDb();
  const s = await getSettings(db);
  const to = todayIn(s.timezone);
  const from = shiftDate(to, -(days - 1));

  const planRows = await db
    .select()
    .from(plans)
    .where(and(gte(plans.deliveryDate, from), lte(plans.deliveryDate, to)))
    .orderBy(desc(plans.deliveryDate));
  const routeRows = planRows.length
    ? await db
        .select({ route: routes, driver: drivers })
        .from(routes)
        .innerJoin(drivers, eq(drivers.id, routes.driverId))
        .where(inArray(routes.planId, planRows.map((p) => p.id)))
        .orderBy(asc(drivers.name))
    : [];
  const stopRows = routeRows.length
    ? await db
        .select({ stop: routeStops, windowEndMin: orders.windowEndMin })
        .from(routeStops)
        .innerJoin(orders, eq(orders.id, routeStops.orderId))
        .where(inArray(routeStops.routeId, routeRows.map((r) => r.route.id)))
    : [];
  const fixes = await loadFixes(db, routeRows.map((r) => r.route.id));
  const gpsM = (routeId: string) => trackDistance(fixes.get(routeId) ?? []);
  const failures = await db
    .select({ reason: deliveryEvents.reason })
    .from(deliveryEvents)
    .innerJoin(orders, eq(orders.id, deliveryEvents.orderId))
    .where(and(eq(deliveryEvents.type, "failed"), gte(orders.deliveryDate, from), lte(orders.deliveryDate, to)));

  // On time = delivered before the window closed (or no window). Uses the driver's "delivered" tap time.
  const onTime = (st: (typeof stopRows)[number]) =>
    st.windowEndMin === null || !st.stop.completedAt || nowSecondsIn(s.timezone, st.stop.completedAt) <= st.windowEndMin * 60;

  const perPlan = planRows.map((p) => {
    const rs = routeRows.filter((r) => r.route.planId === p.id);
    const ids = new Set(rs.map((r) => r.route.id));
    const st = stopRows.filter((x) => ids.has(x.stop.routeId));
    const delivered = st.filter((x) => x.stop.status === "delivered");
    const actual = rs.filter((r) => r.route.startedAt && r.route.completedAt);
    return {
      p,
      routes: rs.length,
      stops: st.length,
      delivered: delivered.length,
      failed: st.filter((x) => x.stop.status === "failed").length,
      onTime: delivered.filter(onTime).length,
      saved: p.baseline && p.summary ? Math.max(0, p.baseline.driveTime - p.summary.driveTime) : 0,
      actualS: actual.reduce((a, r) => a + (r.route.completedAt!.getTime() - r.route.startedAt!.getTime()) / 1000, 0),
      gpsM: rs.reduce((a, r) => a + gpsM(r.route.id), 0),
      gpsPlannedM: rs.filter((r) => fixes.has(r.route.id)).reduce((a, r) => a + r.route.distanceM, 0),
      plannedForActualS: actual.reduce((a, r) => a + (r.route.endS - r.route.startS), 0),
    };
  });

  const total = perPlan.reduce(
    (a, x) => ({
      stops: a.stops + x.stops,
      delivered: a.delivered + x.delivered,
      failed: a.failed + x.failed,
      onTime: a.onTime + x.onTime,
      km: a.km + (x.p.summary?.distance ?? 0),
      drive: a.drive + (x.p.summary?.driveTime ?? 0),
      saved: a.saved + x.saved,
    }),
    { stops: 0, delivered: 0, failed: 0, onTime: 0, km: 0, drive: 0, saved: 0 },
  );

  const byDriver = new Map<string, { name: string; color: string; routes: number; stops: number; delivered: number; failed: number; plannedS: number; distanceM: number }>();
  for (const { route, driver } of routeRows) {
    const d = byDriver.get(driver.id) ?? { name: driver.name, color: driver.color, routes: 0, stops: 0, delivered: 0, failed: 0, plannedS: 0, distanceM: 0 };
    const st = stopRows.filter((x) => x.stop.routeId === route.id);
    d.routes++;
    d.stops += st.length;
    d.delivered += st.filter((x) => x.stop.status === "delivered").length;
    d.failed += st.filter((x) => x.stop.status === "failed").length;
    d.plannedS += route.endS - route.startS;
    d.distanceM += route.distanceM;
    byDriver.set(driver.id, d);
  }

  const reasonCounts = Object.entries(
    failures.reduce<Record<string, number>>((a, f) => ((a[f.reason ?? "Other"] = (a[f.reason ?? "Other"] ?? 0) + 1), a), {}),
  ).sort((a, b) => b[1] - a[1]);
  const completed = total.delivered + total.failed;
  const maxStops = Math.max(1, ...perPlan.map((x) => x.stops));

  return (
    <>
      <PageHeader
        title="Delivery History"
        subtitle={`${prettyDate(from, { day: "numeric", month: "short" })} – ${prettyDate(to, { day: "numeric", month: "short", year: "numeric" })}`}
        actions={
          <div className="flex rounded-lg border border-line bg-white p-0.5 shadow-sm">
            {RANGES.map((d) => (
              <Link key={d} href={`/history?days=${d}`} className={cx(btn(d === days ? "primary" : "ghost", "sm"), d !== days && "shadow-none")}>
                {d} days
              </Link>
            ))}
          </div>
        }
      />

      {perPlan.length === 0 ? (
        <Card>
          <EmptyState icon={BarChart3} title="No delivery days in this period">
            History builds up automatically once you plan and dispatch routes.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Deliveries completed" value={total.delivered} icon={CheckCircle2} tone="green" hint={`${total.stops} planned stops`} />
            <Stat
              label="Failure rate"
              value={completed ? `${((total.failed / completed) * 100).toFixed(1)}%` : "—"}
              icon={XCircle}
              tone={total.failed ? "red" : "slate"}
              hint={`${total.failed} failed`}
            />
            <Stat label="On-time rate" value={total.delivered ? `${Math.round((total.onTime / total.delivered) * 100)}%` : "—"} icon={Clock} tone="blue" hint="Delivered before window closed" />
            <Stat label="Planned driving" value={formatKm(total.km)} icon={RouteIcon} tone="violet" hint={formatDuration(total.drive)} />
            <Stat label="Driving saved" value={formatDuration(total.saved)} icon={TrendingDown} tone="amber" hint="vs. unoptimised order, same road data" />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Card className="min-w-0">
              <CardHeader title="By day" subtitle="Actual time comes from drivers' start and last-stop taps, when available." />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5">Stops</th>
                      <th className="px-4 py-2.5 text-right">Delivered</th>
                      <th className="px-4 py-2.5 text-right">Failed</th>
                      <th className="px-4 py-2.5 text-right">On time</th>
                      <th className="px-4 py-2.5 text-right">Distance</th>
                      <th className="px-4 py-2.5 text-right">Planned vs actual</th>
                      <th className="px-4 py-2.5 text-right">Saved</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {perPlan.map((x) => (
                      <tr key={x.p.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5">
                          <Link href={`/planner?date=${x.p.deliveryDate}`} className="font-medium text-blue-700 hover:underline">
                            {prettyDate(x.p.deliveryDate, { weekday: "short", day: "numeric", month: "short" })}
                          </Link>
                          {x.p.status === "draft" && (
                            <Badge tone="violet" className="ml-2">
                              Draft
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full bg-blue-500" style={{ width: `${(x.stops / maxStops) * 100}%` }} />
                            </div>
                            <span className="tabular-nums text-slate-700">{x.stops}</span>
                            <span className="text-xs text-slate-400">· {x.routes} drivers</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{x.delivered}</td>
                        <td className={cx("px-4 py-2.5 text-right tabular-nums", x.failed && "text-red-600")}>{x.failed}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{x.delivered ? `${Math.round((x.onTime / x.delivered) * 100)}%` : "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatKm(x.p.summary?.distance)}
                          {x.gpsM > 0 && (
                            <span className="block text-[11px] text-slate-500" title="Measured from drivers' GPS, for routes that shared location">
                              GPS {formatKm(x.gpsM)} vs {formatKm(x.gpsPlannedM)} planned
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                          {x.actualS ? (
                            <>
                              {formatDuration(x.plannedForActualS)} →{" "}
                              <span className={x.actualS > x.plannedForActualS * 1.1 ? "text-amber-600" : "text-emerald-600"}>{formatDuration(x.actualS)}</span>
                            </>
                          ) : (
                            <span className="text-slate-400">{formatDuration(x.p.summary?.driverTime)} planned</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">{x.saved ? formatDuration(x.saved) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title="Drivers" />
                <ul className="divide-y divide-line">
                  {[...byDriver.values()].map((d) => (
                    <li key={d.name} className="px-4 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                          <ColorDot color={d.color} /> {d.name}
                        </span>
                        <span className="text-xs text-slate-500">{d.routes} days</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                        {d.delivered} delivered · {d.failed} failed · {(d.stops / d.routes).toFixed(1)} stops/day · {formatKm(d.distanceM / d.routes)}/day
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <CardHeader title="Why deliveries failed" />
                {reasonCounts.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">No failed deliveries 🎉</p>
                ) : (
                  <ul className="space-y-2 p-4">
                    {reasonCounts.map(([reason, n]) => (
                      <li key={reason}>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-700">{reason}</span>
                          <span className="tabular-nums text-slate-500">{n}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full bg-red-400" style={{ width: `${(n / reasonCounts[0][1]) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}

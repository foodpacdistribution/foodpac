import { AlertTriangle, Gauge, Navigation, Radio, SignalZero, Timer } from "lucide-react";
import type { Metadata } from "next";
import { AutoRefresh } from "@/components/auto-refresh";
import { DeliveryMap, type MapStop } from "@/components/map";
import { Badge, Card, ColorDot, cx, EmptyState, PageHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { formatAgo, vehicleMarkers } from "@/lib/live-map";
import { getDepots, getPlanView, getSettings } from "@/lib/planning";
import { formatClock, formatDuration, formatKm, nowSecondsIn, todayIn } from "@/lib/time";
import { liveFleet, STATIONARY_ALERT_S } from "@/lib/tracking";

export const metadata: Metadata = { title: "Live Tracking" };

export default async function TrackingPage() {
  await requireUser(STAFF);
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const nowS = nowSecondsIn(s.timezone);
  const [view, depotList] = await Promise.all([getPlanView(db, today), getDepots(db)]);
  const routes = view.routes.filter((r) => r.dispatchedAt);
  const live = await liveFleet(db, routes);

  const rows = routes.map((r) => {
    const v = live.find((x) => x.routeId === r.id)!;
    const next = r.stops.find((x) => x.status === "pending");
    const done = r.stops.filter((x) => x.status !== "pending").length;
    const behindS = next && r.status === "in_progress" ? nowS - next.etaS : 0;
    const alerts: string[] = [];
    if (r.status === "in_progress") {
      if (!v.last) alerts.push("No GPS received yet");
      else if (v.stale) alerts.push(`No signal for ${formatAgo(v.ageS).replace(" ago", "")}`);
      if (v.last && !v.stale && v.stationaryS > STATIONARY_ALERT_S && !v.nearStop) alerts.push(`Stopped ${formatDuration(v.stationaryS)} away from any stop`);
      if (behindS > 15 * 60) alerts.push(`${formatDuration(behindS)} behind schedule`);
    }
    return { r, v, next, done, alerts };
  });

  const mapStops: MapStop[] = routes.flatMap((r) =>
    r.stops.map((x) => ({
      id: x.id,
      routeId: r.id,
      lat: x.order.lat,
      lng: x.order.lng,
      label: String(x.seq),
      color: r.color,
      status: x.status,
      title: `${x.seq}. ${x.order.customerName || x.order.orderNumber}`,
      lines: [x.order.address, `${r.driverName} · ETA ${formatClock(x.etaS)}`],
    })),
  );

  return (
    <>
      <AutoRefresh seconds={20} />
      <PageHeader
        title="Live Tracking"
        subtitle="Driver positions from the driver app, refreshed every 20 seconds. Location is only shared while a route is in progress."
      />
      {routes.length === 0 ? (
        <Card>
          <EmptyState icon={Radio} title="Nothing to track yet">
            Once today&apos;s plan is dispatched and drivers start their routes, their live positions appear here.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <Card className="h-[480px] overflow-hidden xl:h-[calc(100dvh-10rem)] xl:min-h-[560px]">
            <DeliveryMap
              fitOnce
              depots={depotList}
              stops={mapStops}
              routes={routes.filter((r) => r.geometry).map((r) => ({ id: r.id, color: r.color, path: r.geometry! }))}
              trails={live.filter((v) => v.trail.length > 1).map((v) => ({ id: v.routeId, color: "#0f172a", path: v.trail }))}
              vehicles={vehicleMarkers(routes, live)}
            />
          </Card>

          <div className="space-y-3">
            {rows.map(({ r, v, next, done, alerts }) => (
              <Card key={r.id} className={cx(alerts.length > 0 && "border-amber-300")}>
                <div className="flex items-start gap-3 px-4 py-3">
                  <ColorDot color={r.color} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900">{r.driverName}</p>
                      {r.status === "completed" ? (
                        <Badge tone="green">Finished</Badge>
                      ) : r.status === "in_progress" ? (
                        v.stale ? (
                          <Badge tone="amber">
                            <SignalZero className="size-3" /> Signal lost
                          </Badge>
                        ) : (
                          <Badge tone="blue">
                            <Radio className="size-3" /> Live
                          </Badge>
                        )
                      ) : (
                        <Badge>Not started</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Stop {Math.min(done + 1, r.stops.length)} of {r.stops.length}
                      {r.trips > 1 && ` · ${r.trips} trips`} · last update {formatAgo(v.ageS)}
                    </p>
                    {next && r.status !== "planned" && (
                      <p className="mt-2 truncate text-sm text-slate-700">
                        Next: <span className="font-medium">{next.order.customerName || next.order.orderNumber}</span>
                        <span className="text-slate-400"> · ETA {formatClock(next.etaS)}</span>
                      </p>
                    )}
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <dt className="flex items-center gap-1 text-slate-500">
                          <Navigation className="size-3" /> To next
                        </dt>
                        <dd className="font-semibold tabular-nums text-slate-800">{v.toNextStopM !== null ? formatKm(v.toNextStopM) : "—"}</dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <dt className="flex items-center gap-1 text-slate-500">
                          <Gauge className="size-3" /> Speed
                        </dt>
                        <dd className="font-semibold tabular-nums text-slate-800">{v.last?.speedKmh != null && !v.stale ? `${v.last.speedKmh} km/h` : "—"}</dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <dt className="flex items-center gap-1 text-slate-500">
                          <Timer className="size-3" /> Driven
                        </dt>
                        <dd className="font-semibold tabular-nums text-slate-800">
                          {formatKm(v.gpsDistanceM)}
                          <span className="font-normal text-slate-400"> / {formatKm(r.distanceM)}</span>
                        </dd>
                      </div>
                    </dl>
                    {alerts.map((a) => (
                      <p key={a} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                        <AlertTriangle className="size-3.5" /> {a}
                      </p>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
            <p className="px-1 text-[11px] leading-relaxed text-slate-500">
              Phones pause location when the driver app is in the background or the screen locks. A grey marker means the last known position.
              Distance driven is measured from GPS points and may read slightly low.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

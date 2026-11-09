import { Radio } from "lucide-react";
import type { Metadata } from "next";
import type { MapStop } from "@/components/map";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { darken, formatAgo, vehicleMarkers } from "@/lib/live-map";
import { getDepots, getPlanView, getSettings } from "@/lib/planning";
import { formatClock, formatDuration, formatKm, nowSecondsIn, todayIn } from "@/lib/time";
import { liveFleet, STATIONARY_ALERT_S } from "@/lib/tracking";
import { T } from "@/components/i18n";
import { type TrackingRow, TrackingView } from "./tracking-view";

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

  const rows: TrackingRow[] = routes.map((r) => {
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
    return {
      id: r.id,
      driverName: r.driverName,
      color: r.color,
      status: r.status as TrackingRow["status"],
      stale: v.stale,
      stop: Math.min(done + 1, r.stops.length),
      stops: r.stops.length,
      trips: r.trips,
      ago: formatAgo(v.ageS),
      next: next ? { name: next.order.customerName || next.order.orderNumber, eta: formatClock(next.etaS) } : null,
      toNext: v.toNextStopM !== null ? formatKm(v.toNextStopM) : "—",
      speed: v.last?.speedKmh != null && !v.stale ? `${v.last.speedKmh} km/h` : "—",
      driven: formatKm(v.gpsDistanceM),
      planned: formatKm(r.distanceM),
      alerts,
    };
  });

  const mapStops: MapStop[] = routes.flatMap((r) => {
    // The stop the driver is heading to stands out on the map.
    const nextId = r.status === "in_progress" ? r.stops.find((x) => x.status === "pending")?.id : undefined;
    return r.stops.map((x) => ({
      id: x.id,
      routeId: r.id,
      lat: x.order.lat,
      lng: x.order.lng,
      label: String(x.seq),
      color: r.color,
      status: x.status,
      next: x.id === nextId,
      title: `${x.seq}. ${x.order.customerName || x.order.orderNumber}`,
      lines: [x.order.address, `${r.driverName} · ETA ${formatClock(x.etaS)}`],
    }));
  });

  return (
    <>
      <PageHeader
        title={<T>{"Live Tracking"}</T>}
        subtitle={<T>{"Driver positions from the driver app, updated about every 10 seconds while a route is in progress."}</T>}
      />
      {routes.length === 0 ? (
        <Card>
          <EmptyState icon={Radio} title={<T>{"Nothing to track yet"}</T>}>
            <T>{"Once today's plan is dispatched and drivers start their routes, their live positions appear here."}</T></EmptyState>
        </Card>
      ) : (
        <TrackingView
          rows={rows}
          depots={depotList}
          stops={mapStops}
          routes={routes
            .filter((r) => r.geometry)
            .map((r) => ({ id: r.id, color: r.color, path: r.geometry!, doneUpTo: r.status === "planned" ? 0 : live.find((v) => v.routeId === r.id)?.progressIdx }))}
          trails={live
            .filter((v) => v.trail.length > 1)
            .map((v) => ({ id: v.routeId, color: darken(routes.find((r) => r.id === v.routeId)?.color ?? ""), path: v.trail }))}
          vehicles={vehicleMarkers(routes, live)}
        />
      )}
    </>
  );
}

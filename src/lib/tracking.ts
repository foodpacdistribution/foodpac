import "server-only";
import { asc, inArray } from "drizzle-orm";
import type { DB } from "./db";
import { vehicleLocations } from "./db/schema";
import { haversine } from "./geo/routing";
import type { RouteView } from "./planning";

/** No fix for this long → shown as "signal lost" (grey marker). */
export const STALE_AFTER_S = 5 * 60;
/** Within this radius for this long, away from a stop → flagged as stationary. */
const STATIONARY_RADIUS_M = 75;
export const STATIONARY_ALERT_S = 20 * 60;
/** Fixes worse than this are ignored for distance/trails. */
const MAX_ACCURACY_M = 100;

export type Fix = { lat: number; lng: number; accuracyM: number | null; speedMps: number | null; heading: number | null; at: Date };

export type LiveVehicle = {
  routeId: string;
  driverId: string;
  last: { lat: number; lng: number; heading: number | null; speedKmh: number | null; accuracyM: number | null; at: string } | null;
  ageS: number | null;
  stale: boolean;
  /** How long the vehicle has been within a small radius of its current spot. */
  stationaryS: number;
  nearStop: boolean;
  toNextStopM: number | null;
  gpsDistanceM: number;
  trail: [number, number][];
};

/** Sum of distances between consecutive usable fixes, skipping GPS jumps. */
export function trackDistance(fixes: Pick<Fix, "lat" | "lng" | "accuracyM" | "at">[]) {
  let total = 0;
  let prev: (typeof fixes)[number] | null = null;
  for (const f of fixes) {
    if (f.accuracyM !== null && f.accuracyM > MAX_ACCURACY_M) continue;
    if (prev) {
      const d = haversine(prev, f);
      const dt = Math.max(1, (f.at.getTime() - prev.at.getTime()) / 1000);
      // A jump faster than ~200 km/h is a bad fix: drop it and keep measuring from the last good one.
      if (d / dt >= 55) continue;
      total += d;
    }
    prev = f;
  }
  return Math.round(total);
}

/** Seconds the latest fix has stayed within STATIONARY_RADIUS_M, walking back through history. */
export function stationarySeconds(fixes: Pick<Fix, "lat" | "lng" | "at">[]) {
  if (fixes.length < 2) return 0;
  const last = fixes[fixes.length - 1];
  let since = last.at;
  for (let i = fixes.length - 2; i >= 0; i--) {
    if (haversine(fixes[i], last) > STATIONARY_RADIUS_M) break;
    since = fixes[i].at;
  }
  return Math.round((last.at.getTime() - since.getTime()) / 1000);
}

export async function loadFixes(db: DB, routeIds: string[]) {
  if (!routeIds.length) return new Map<string, Fix[]>();
  const rows = await db
    .select()
    .from(vehicleLocations)
    .where(inArray(vehicleLocations.routeId, routeIds))
    .orderBy(asc(vehicleLocations.recordedAt));
  const map = new Map<string, Fix[]>();
  for (const r of rows) {
    const list = map.get(r.routeId!) ?? [];
    list.push({ lat: r.lat, lng: r.lng, accuracyM: r.accuracyM, speedMps: r.speedMps, heading: r.heading, at: r.recordedAt });
    map.set(r.routeId!, list);
  }
  return map;
}

export async function liveFleet(db: DB, routes: RouteView[], now = new Date()): Promise<LiveVehicle[]> {
  const fixesByRoute = await loadFixes(db, routes.map((r) => r.id));
  return routes.map((r) => {
    const fixes = fixesByRoute.get(r.id) ?? [];
    const good = fixes.filter((f) => f.accuracyM === null || f.accuracyM <= MAX_ACCURACY_M);
    const last = fixes.at(-1) ?? null;
    const ageS = last ? Math.round((now.getTime() - last.at.getTime()) / 1000) : null;
    const next = r.stops.find((s) => s.status === "pending");
    const nearStop = !!last && r.stops.some((s) => haversine(last, { lat: s.order.lat, lng: s.order.lng }) < 150);
    return {
      routeId: r.id,
      driverId: r.driverId,
      last: last
        ? {
            lat: last.lat,
            lng: last.lng,
            heading: last.heading,
            speedKmh: last.speedMps !== null ? Math.round(last.speedMps * 3.6) : null,
            accuracyM: last.accuracyM !== null ? Math.round(last.accuracyM) : null,
            at: last.at.toISOString(),
          }
        : null,
      ageS,
      stale: ageS === null || ageS > STALE_AFTER_S,
      stationaryS: stationarySeconds(good),
      nearStop,
      toNextStopM: last && next ? Math.round(haversine(last, { lat: next.order.lat, lng: next.order.lng })) : null,
      gpsDistanceM: trackDistance(fixes),
      trail: good.map((f) => [Math.round(f.lat * 1e5) / 1e5, Math.round(f.lng * 1e5) / 1e5]),
    };
  });
}

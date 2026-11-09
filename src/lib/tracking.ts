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
/** A coarse fix only replaces the last precise one once nothing better has come for this long. */
const PREFER_PRECISE_FOR_S = 120;
/** Trail points closer together than this add nothing but noise. */
const TRAIL_SPACING_M = 8;
/** Further from the planned route than this, progress along it isn't guessed from the position. */
const OFF_ROUTE_M = 300;

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
  /** Index into the route's planned path the driver has reached (the part before it is driven). */
  progressIdx: number;
};

const usable = (f: Pick<Fix, "accuracyM">) => f.accuracyM === null || f.accuracyM <= MAX_ACCURACY_M;
/** A jump faster than ~200 km/h between fixes is a bad fix. */
const jumped = (a: Pick<Fix, "lat" | "lng" | "at">, b: Pick<Fix, "lat" | "lng" | "at">) =>
  haversine(a, b) / Math.max(1, (b.at.getTime() - a.at.getTime()) / 1000) >= 55;

/**
 * Where to show the driver: the newest precise fix. Phones often send a rough network fix first
 * (just woken up, indoors); that would pull the marker hundreds of metres off the road. A rough
 * fix is only used once nothing precise has arrived for PREFER_PRECISE_FOR_S.
 */
export function bestFix<F extends Pick<Fix, "accuracyM" | "at">>(fixes: F[]): F | null {
  const newest = fixes.at(-1) ?? null;
  const precise = fixes.findLast(usable) ?? null;
  if (!newest || !precise) return newest;
  return newest.at.getTime() - precise.at.getTime() > PREFER_PRECISE_FOR_S * 1000 ? newest : precise;
}

/** The driven path for the map: precise fixes only, without GPS jumps or points piled on one spot. */
export function cleanTrail(fixes: Pick<Fix, "lat" | "lng" | "accuracyM" | "at">[]): [number, number][] {
  const kept: Pick<Fix, "lat" | "lng" | "at">[] = [];
  for (const f of fixes) {
    if (!usable(f)) continue;
    const prev = kept.at(-1);
    if (prev && (jumped(prev, f) || haversine(prev, f) < TRAIL_SPACING_M)) continue;
    kept.push(f);
  }
  return kept.map((f) => [Math.round(f.lat * 1e5) / 1e5, Math.round(f.lng * 1e5) / 1e5]);
}

/** Speed from the last two precise fixes, for phones that don't report it. */
export function derivedSpeedMps(fixes: Pick<Fix, "lat" | "lng" | "accuracyM" | "at">[]) {
  const good = fixes.filter(usable);
  const [a, b] = good.slice(-2);
  if (!a || !b) return null;
  const dt = (b.at.getTime() - a.at.getTime()) / 1000;
  if (dt <= 0 || dt > 60) return null;
  return haversine(a, b) / dt;
}

/** For each stop (in route order), the nearest point of the planned path, never going backwards. */
export function stopIndexes(path: [number, number][], stops: { lat: number; lng: number }[]) {
  let from = 0;
  return stops.map((s) => {
    let best = from;
    let bestD = Infinity;
    for (let i = from; i < path.length; i++) {
      const d = haversine({ lat: path[i][0], lng: path[i][1] }, s);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    from = best;
    return best;
  });
}

/**
 * How far along the planned path the driver is: the closest point to their position between the
 * last finished stop and the next one. Without a usable position, the last finished stop.
 */
export function pathProgress(path: [number, number][], stops: { lat: number; lng: number }[], doneCount: number, at: { lat: number; lng: number } | null) {
  if (path.length < 2) return 0;
  const idx = stopIndexes(path, stops);
  const lo = doneCount > 0 ? idx[Math.min(doneCount, idx.length) - 1] : 0;
  const hi = doneCount < idx.length ? idx[doneCount] : path.length - 1;
  if (!at) return lo;
  let best = lo;
  let bestD = Infinity;
  for (let i = lo; i <= hi; i++) {
    const d = haversine({ lat: path[i][0], lng: path[i][1] }, at);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return bestD <= OFF_ROUTE_M ? best : lo;
}

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
    const good = fixes.filter(usable);
    const last = bestFix(fixes);
    const newest = fixes.at(-1) ?? null;
    // "Last update" is the newest fix of any quality: the phone is still reporting.
    const ageS = newest ? Math.round((now.getTime() - newest.at.getTime()) / 1000) : null;
    const speedMps = last ? (last.speedMps ?? derivedSpeedMps(fixes)) : null;
    const doneCount = r.stops.filter((s) => s.status !== "pending").length;
    const stopPoints = r.stops.map((s) => ({ lat: s.order.lat, lng: s.order.lng }));
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
            speedKmh: speedMps !== null ? Math.round(speedMps * 3.6) : null,
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
      trail: cleanTrail(fixes),
      progressIdx: r.geometry ? pathProgress(r.geometry, stopPoints, doneCount, last && usable(last) ? last : null) : 0,
    };
  });
}

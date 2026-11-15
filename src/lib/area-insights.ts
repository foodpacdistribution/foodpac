import "server-only";
import { and, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import type { DB } from "./db";
import { areaOf, UNKNOWN_AREA } from "./customer-map";
import { orders, plans, routes, salesOrders } from "./db/schema";
import { shiftDate } from "./dates";
import { haversine } from "./geo/routing";

// What the customer map needs to say which areas are worth a visit: what each customer has
// spent lately against before, and where the vans already go each weekday.

/** Each customer's spend in the last 90 days and the 90 before that, in cents. */
export async function recentSales(db: DB) {
  const rows = await db
    .select({
      customerId: salesOrders.customerId,
      last90: sql<number>`coalesce(sum(${salesOrders.totalCents}) filter (where ${salesOrders.createdAt} > now() - interval '90 days'), 0)::int`,
      prev90: sql<number>`coalesce(sum(${salesOrders.totalCents}) filter (where ${salesOrders.createdAt} <= now() - interval '90 days'), 0)::int`,
    })
    .from(salesOrders)
    .where(and(ne(salesOrders.status, "cancelled"), sql`${salesOrders.createdAt} > now() - interval '180 days'`))
    .groupBy(salesOrders.customerId);
  return new Map(rows.map((r) => [r.customerId, { last90: r.last90, prev90: r.prev90 }]));
}

/** A delivery run: the weekday it ran (0 = Sunday) and the road it took, thinned out. */
export type VanRun = { weekday: number; path: [number, number][] };

/** How far back runs count as "where the vans go". */
export const RUN_WEEKS = 4;
/** Points of a road path kept at least this far apart: plenty for drawing, far less to send. */
const THIN_M = 150;

const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** Drops points closer than `minM` to the last one kept (the ends always stay). */
export function thin(path: [number, number][], minM = THIN_M): [number, number][] {
  if (path.length <= 2) return path;
  const out: [number, number][] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const [lat, lng] = out[out.length - 1];
    if (haversine({ lat, lng }, { lat: path[i][0], lng: path[i][1] }) >= minM) out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  return out;
}

/** The delivery runs of the last few weeks (planned or driven), with their weekday. */
export async function vanRuns(db: DB, today: string): Promise<VanRun[]> {
  const rows = await db
    .select({ day: plans.deliveryDate, path: routes.geometry })
    .from(routes)
    .innerJoin(plans, sql`${plans.id} = ${routes.planId}`)
    .where(and(gte(plans.deliveryDate, shiftDate(today, -7 * RUN_WEEKS)), lt(plans.deliveryDate, today), isNotNull(routes.geometry)));
  return rows.filter((r) => r.path && r.path.length > 1).map((r) => ({ weekday: weekdayOf(r.day), path: thin(r.path!) }));
}

/**
 * Which weekdays a van passes within `radiusM` of each place: where a new customer costs little
 * to deliver to. Points are bucketed on a grid about 2 km wide, so each place only checks the
 * points around it.
 */
export function vanDaysNear(runs: VanRun[], places: { lat: number; lng: number }[], radiusM = 1500): number[][] {
  const CELL = 0.02;
  const cell = (lat: number, lng: number) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
  const grid = new Map<string, { lat: number; lng: number; weekday: number }[]>();
  const add = (lat: number, lng: number, weekday: number) => {
    const k = cell(lat, lng);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push({ lat, lng, weekday });
  };
  for (const r of runs)
    r.path.forEach(([lat, lng], i) => {
      add(lat, lng, r.weekday);
      // Long straight stretches have few points: fill them in every 500 m so nothing beside them is missed.
      const next = r.path[i + 1];
      if (!next) return;
      const steps = Math.floor(haversine({ lat, lng }, { lat: next[0], lng: next[1] }) / 500);
      for (let k = 1; k <= steps; k++) add(lat + ((next[0] - lat) * k) / (steps + 1), lng + ((next[1] - lng) * k) / (steps + 1), r.weekday);
    });
  return places.map((p) => {
    const days = new Set<number>();
    const cy = Math.floor(p.lat / CELL);
    const cx = Math.floor(p.lng / CELL);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const q of grid.get(`${cy + dy}:${cx + dx}`) ?? []) if (!days.has(q.weekday) && haversine(p, q) <= radiusM) days.add(q.weekday);
    return [...days].sort((a, b) => a - b);
  });
}

/**
 * The suburbs we've delivered to in the last `days` days, busiest first, from the delivery
 * addresses themselves: the honest answer to "do you deliver to …?".
 */
export async function servedSuburbs(db: DB, today: string, days = 180) {
  const rows = await db
    .select({ address: orders.address, n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.status, "delivered"), gte(orders.deliveryDate, shiftDate(today, -days))))
    .groupBy(orders.address);
  const bySuburb = new Map<string, { name: string; n: number }>();
  for (const r of rows) {
    const a = areaOf(r.address);
    // Only real suburbs ("Sunnybank 4109"), not a bare postcode or an address we couldn't read.
    if (a.key === UNKNOWN_AREA || !a.key.includes("|")) continue;
    const cur = bySuburb.get(a.key) ?? { name: a.name, n: 0 };
    cur.n += r.n;
    bySuburb.set(a.key, cur);
  }
  return [...bySuburb.values()].sort((x, y) => y.n - x.n || x.name.localeCompare(y.name));
}

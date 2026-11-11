import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "./db";
import { depots, drivers, orders, routes, routeStops, settings } from "./db/schema";
import { buildShipment } from "./shipments";

let db: DB;
let driverId: string;
let routeId: string;
const DATE = "2026-11-12";
const stops = () => db.select().from(routeStops).where(eq(routeStops.routeId, routeId)).orderBy(asc(routeStops.seq));
const names = async () => {
  const rows = await db.select({ seq: routeStops.seq, n: orders.orderNumber, status: routeStops.status }).from(routeStops).innerJoin(orders, eq(orders.id, routeStops.orderId)).where(eq(routeStops.routeId, routeId)).orderBy(asc(routeStops.seq));
  return rows.map((r) => r.n);
};

beforeAll(async () => {
  // No routing server in tests: road times fall back to straight-line estimates.
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  await db.insert(depots).values({ name: "Depot", lat: -27.47, lng: 153.02 });
  const [d] = await db.insert(drivers).values({ name: "Sam" }).returning();
  driverId = d.id;
  // North along the highway from the depot: A nearest, D furthest.
  const os = await db
    .insert(orders)
    .values(
      [
        ["A", -27.4],
        ["B", -27.3],
        ["C", -27.2],
        ["D", -27.1],
      ].map(([n, lat]) => ({ orderNumber: n as string, deliveryDate: DATE, address: `${n} Test St`, lat: lat as number, lng: 153.0, geocodeStatus: "ok" as const })),
    )
    .returning();
  await buildShipment(db, DATE, driverId, os.map((o) => o.id));
  const [r] = await db.select().from(routes).limit(1);
  routeId = r.id;
  await db.update(routes).set({ dispatchedAt: new Date() }).where(eq(routes.id, routeId));
}, 30000);

describe("buildShipment with the driver's own order", () => {
  it("keeps the order given, re-timed, and the stops keep their ids", async () => {
    const before = await stops();
    const byName = new Map((await db.select().from(orders)).map((o) => [o.orderNumber, o.id]));
    await buildShipment(db, DATE, driverId, [], [], { order: ["C", "A", "D", "B"].map((n) => byName.get(n)!), keepStart: true });
    expect(await names()).toEqual(["C", "A", "D", "B"]);
    const after = await stops();
    expect(new Set(after.map((s) => s.id))).toEqual(new Set(before.map((s) => s.id)));
    expect(after.map((s) => s.seq)).toEqual([1, 2, 3, 4]);
    // Arrival times follow the new order.
    for (let i = 1; i < after.length; i++) expect(after[i].etaS).toBeGreaterThan(after[i - 1].etdS - 1);
    // The route totals are worked out again too.
    const [r] = await db.select().from(routes).where(eq(routes.id, routeId));
    expect(r.distanceM).toBeGreaterThan(0);
  });

  it("keeps delivered stops first and orders the rest as given", async () => {
    const [first] = await stops();
    await db.update(routeStops).set({ status: "delivered", completedAt: new Date() }).where(eq(routeStops.id, first.id));
    await db.update(routes).set({ status: "in_progress" }).where(eq(routes.id, routeId));
    const byName = new Map((await db.select().from(orders)).map((o) => [o.orderNumber, o.id]));
    await buildShipment(db, DATE, driverId, [], [], { order: ["B", "D", "A"].map((n) => byName.get(n)!), keepStart: true });
    expect(await names()).toEqual(["C", "B", "D", "A"]);
  });

  it("puts the stops back in the best order when none is given", async () => {
    await buildShipment(db, DATE, driverId, [], [], { keepStart: true });
    // From C (where the driver is), the rest in a sensible run, not the driver's zig-zag.
    const order = await names();
    expect(order[0]).toBe("C");
    expect(order.slice(1)).not.toEqual(["B", "D", "A"]);
  });
});

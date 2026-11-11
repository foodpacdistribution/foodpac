import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { type DB, schema } from "./db";
import { drivers, orders, plans, routes, routeStops } from "./db/schema";
import { renumberCompleted, writeStopTimes } from "./planning";

let db: DB;
let routeId: string;

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  const [d] = await db.insert(drivers).values({ name: "Sam" }).returning();
  const [p] = await db.insert(plans).values({ deliveryDate: "2026-11-11" }).returning();
  const [r] = await db
    .insert(routes)
    .values({ planId: p.id, driverId: d.id, startS: 0, endS: 0, distanceM: 0, driveS: 0, serviceS: 0, waitS: 0 })
    .returning();
  routeId = r.id;
  const os = await db
    .insert(orders)
    .values([1, 2, 3, 4].map((n) => ({ orderNumber: `T-${n}`, deliveryDate: "2026-11-11", address: `${n} Test St` })))
    .returning();
  // Planned 1-4; the driver did stop 3 first, then stop 1. Stops 2 and 4 are still to do.
  const at = (min: number) => new Date(Date.UTC(2026, 10, 10, 22, min));
  await db.insert(routeStops).values([
    { routeId, orderId: os[0].id, seq: 1, etaS: 100, etdS: 200, legDistanceM: 1, legDriveS: 1, status: "delivered", completedAt: at(30) },
    { routeId, orderId: os[1].id, seq: 2, etaS: 300, etdS: 400, legDistanceM: 1, legDriveS: 1 },
    { routeId, orderId: os[2].id, seq: 3, etaS: 500, etdS: 600, legDistanceM: 1, legDriveS: 1, status: "delivered", completedAt: at(10) },
    { routeId, orderId: os[3].id, seq: 4, etaS: 700, etdS: 800, legDistanceM: 1, legDriveS: 1 },
  ]);
}, 30000);

const stops = () => db.select().from(routeStops).where(eq(routeStops.routeId, routeId)).orderBy(asc(routeStops.seq));

describe("renumberCompleted", () => {
  it("numbers completed stops in the order they were done, leaving room for the stops after them", async () => {
    const done = (await stops())
      .filter((s) => s.status !== "pending")
      .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime())
      .map((s) => ({ stopId: s.id, seq: s.seq }));
    await renumberCompleted(db, done);
    const after = (await stops()).filter((s) => s.status !== "pending");
    expect(after.map((s) => [s.seq, s.etaS])).toEqual([
      [1, 500],
      [2, 100],
    ]);
  });
});

describe("writeStopTimes", () => {
  it("saves every stop's new times in one go and leaves the others alone", async () => {
    const pending = (await stops()).filter((s) => s.status === "pending");
    await writeStopTimes(db, [
      { id: pending[0].id, etaS: 31000, etdS: 31300, waitS: 0, lateS: 0 },
      { id: pending[1].id, etaS: 32000, etdS: 32900, waitS: 600, lateS: 120 },
    ]);
    const after = await stops();
    const byId = new Map(after.map((s) => [s.id, s]));
    expect([byId.get(pending[0].id)!.etaS, byId.get(pending[0].id)!.etdS]).toEqual([31000, 31300]);
    expect(byId.get(pending[1].id)).toMatchObject({ etaS: 32000, etdS: 32900, waitS: 600, lateS: 120 });
    expect(after.filter((s) => s.status !== "pending").map((s) => s.etaS).sort()).toEqual([100, 500]);
    await writeStopTimes(db, []);
  });
});

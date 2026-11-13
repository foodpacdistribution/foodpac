import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "./db";
import { depots, drivers, orders, routes, routeStops, settings } from "./db/schema";
import { buildShipment, sendShipment, transferOrder } from "./shipments";

let db: DB;
let sam: string;
let kim: string;
let lee: string;
let samRoute: string;
const DATE = "2026-11-12";
const id = new Map<string, string>();

const onRoute = async (driverId: string) => {
  const rows = await db
    .select({ n: orders.orderNumber, stopId: routeStops.id })
    .from(routeStops)
    .innerJoin(routes, eq(routes.id, routeStops.routeId))
    .innerJoin(orders, eq(orders.id, routeStops.orderId))
    .where(eq(routes.driverId, driverId))
    .orderBy(asc(routeStops.seq));
  return rows;
};
const routeOf = async (driverId: string) => (await db.select().from(routes).where(eq(routes.driverId, driverId)))[0];
const order = async (n: string) => (await db.select().from(orders).where(eq(orders.id, id.get(n)!)))[0];

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
  [sam, kim, lee] = (await db.insert(drivers).values([{ name: "Sam" }, { name: "Kim" }, { name: "Lee" }]).returning()).map((d) => d.id);
  const os = await db
    .insert(orders)
    .values(
      [
        ["A", -27.4],
        ["B", -27.3],
        ["C", -27.2],
        ["D", -27.1],
        ["E", -27.5],
      ].map(([n, lat]) => ({ orderNumber: n as string, deliveryDate: DATE, address: `${n} Test St`, lat: lat as number, lng: 153.0, geocodeStatus: "ok" as const })),
    )
    .returning();
  for (const o of os) id.set(o.orderNumber, o.id);
  // Sam's shipment (A–D) is on his phone; Lee has an unsent shipment with E.
  samRoute = (await buildShipment(db, DATE, sam, ["A", "B", "C", "D"].map((n) => id.get(n)!)))!.id;
  await sendShipment(db, samRoute);
  await buildShipment(db, DATE, lee, [id.get("E")!]);
}, 30000);

describe("transferOrder", () => {
  it("moves a sent order to a driver with no shipment and puts it on their phone", async () => {
    const before = await onRoute(sam);
    const r = await transferOrder(db, samRoute, id.get("B")!, kim);
    expect(r.sent).toBe(true);
    expect((await onRoute(kim)).map((x) => x.n)).toEqual(["B"]);
    expect((await routeOf(kim)).dispatchedAt).not.toBeNull();
    const b = await order("B");
    expect(b.driverId).toBe(kim);
    expect(b.status).toBe("dispatched");
    // Sam keeps the rest, in the same order, with the same stop ids (for deliveries still uploading).
    const after = await onRoute(sam);
    expect(after.map((x) => x.n)).toEqual(before.filter((x) => x.n !== "B").map((x) => x.n));
    expect(after.map((x) => x.stopId)).toEqual(before.filter((x) => x.n !== "B").map((x) => x.stopId));
  });

  it("adds to an unsent shipment with other orders without sending it", async () => {
    const r = await transferOrder(db, samRoute, id.get("C")!, lee);
    expect(r.sent).toBe(false);
    expect((await onRoute(lee)).map((x) => x.n).sort()).toEqual(["C", "E"]);
    expect((await routeOf(lee)).dispatchedAt).toBeNull();
    expect((await order("C")).status).toBe("planned");
  });

  it("moves a pinned order's pin along with it", async () => {
    await db.update(orders).set({ pinnedDriverId: sam }).where(eq(orders.id, id.get("D")!));
    await transferOrder(db, samRoute, id.get("D")!, kim);
    expect((await order("D")).pinnedDriverId).toBe(kim);
  });

  it("refuses completed stops and the same driver", async () => {
    const [a] = await onRoute(sam);
    await db.update(routeStops).set({ status: "delivered", completedAt: new Date() }).where(eq(routeStops.id, a.stopId));
    await expect(transferOrder(db, samRoute, id.get("A")!, kim)).rejects.toThrow("already been completed");
    const kimRoute = (await routeOf(kim)).id;
    await expect(transferOrder(db, kimRoute, id.get("B")!, kim)).rejects.toThrow("already with this driver");
  });

  it("puts the order back when the other driver can't take it", async () => {
    await db.update(drivers).set({ active: false }).where(eq(drivers.id, lee));
    const kimRoute = (await routeOf(kim)).id;
    await expect(transferOrder(db, kimRoute, id.get("B")!, lee)).rejects.toThrow("active driver");
    expect((await onRoute(kim)).map((x) => x.n).sort()).toEqual(["B", "D"]);
  });
});

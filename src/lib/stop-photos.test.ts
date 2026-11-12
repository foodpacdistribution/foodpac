import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "./db";
import { deliveryProofs, drivers, orders, plans, routes, routeStops, settings, users } from "./db/schema";
import { addStopPhotos, finishStop } from "./driver-stops";

// A photo the driver forgot at the door, sent later: it goes on the same delivery record.

const state = vi.hoisted(() => ({ db: null as unknown, user: null as unknown }));
vi.mock("./db", async (orig) => ({ ...(await orig<typeof import("./db")>()), getDb: async () => state.db }));
vi.mock("./auth/dal", () => ({ assertUser: async () => state.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const jpeg = (n: number) => ({ mime: "image/jpeg", data: new Uint8Array([0xff, 0xd8, 0xff, n]) });
let db: DB;
let stopIds: string[];
let driverUser: unknown;

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  state.db = db;
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  const [d] = await db.insert(drivers).values({ name: "Sam" }).returning();
  const [u] = await db.insert(users).values({ email: "sam@x.test", name: "Sam", passwordHash: "x", role: "driver", driverId: d.id }).returning();
  driverUser = u;
  state.user = u;
  const [p] = await db.insert(plans).values({ deliveryDate: "2026-11-11", status: "dispatched" }).returning();
  const os = await db
    .insert(orders)
    .values([1, 2].map((n) => ({ orderNumber: `T-${n}`, deliveryDate: "2026-11-11", address: `${n} Test St`, status: "dispatched" as const })))
    .returning();
  const [r] = await db
    .insert(routes)
    .values({ planId: p.id, driverId: d.id, startS: 0, endS: 3600, distanceM: 1, driveS: 1, serviceS: 1, waitS: 0, dispatchedAt: new Date() })
    .returning();
  const rows = await db
    .insert(routeStops)
    .values(os.map((o, i) => ({ routeId: r.id, orderId: o.id, seq: i + 1, etaS: 600 * (i + 1), etdS: 600 * (i + 1) + 300, legDistanceM: 1, legDriveS: 600 })))
    .returning();
  stopIds = rows.map((s) => s.id);
  // Delivered yesterday with one photo at the door.
  await finishStop(stopIds[0], { type: "delivered", recipient: null, note: null, photo: jpeg(1), signature: null, at: null }, new Date(Date.UTC(2026, 10, 10, 23)));
}, 30000);

const photosOf = async (stopId: string) => {
  const [s] = await db.select().from(routeStops).where(eq(routeStops.id, stopId));
  return db.select().from(deliveryProofs).where(eq(deliveryProofs.orderId, s.orderId));
};

describe("addStopPhotos", () => {
  it("adds photos to the delivery record the office sees", async () => {
    const [atDoor] = await photosOf(stopIds[0]);
    expect(await addStopPhotos(stopIds[0], [jpeg(2), jpeg(3)])).toBe(2);
    const all = await photosOf(stopIds[0]);
    expect(all).toHaveLength(3);
    expect(new Set(all.map((p) => p.eventId))).toEqual(new Set([atDoor.eventId]));
  });

  it("doesn't save the same photo twice when the phone sends it again", async () => {
    expect(await addStopPhotos(stopIds[0], [jpeg(2), jpeg(3), jpeg(3)])).toBe(0);
    expect(await photosOf(stopIds[0])).toHaveLength(3);
  });

  it("waits for the delivery itself", async () => {
    await expect(addStopPhotos(stopIds[1], [jpeg(4)])).rejects.toThrow("Confirm the delivery first");
  });

  it("only takes photos for the driver's own stops", async () => {
    const [other] = await db.insert(drivers).values({ name: "Alex" }).returning();
    state.user = { ...(driverUser as object), driverId: other.id };
    await expect(addStopPhotos(stopIds[0], [jpeg(5)])).rejects.toThrow("isn't assigned to you");
    state.user = driverUser;
  });
});

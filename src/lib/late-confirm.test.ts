import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "./db";
import { deliveryEvents, deliveryProofs, drivers, orders, plans, routes, routeStops, settings, users } from "./db/schema";
import { finishStop, finishStopFromOffice, unconfirmedStops } from "./driver-stops";
import type { Outcome } from "./outcome";

// A stop delivered but never confirmed on the phone: the next day the driver, or the office,
// confirms it with the customer's signature photo from the album.

const state = vi.hoisted(() => ({ db: null as unknown, user: null as unknown }));
vi.mock("./db", async (orig) => ({ ...(await orig<typeof import("./db")>()), getDb: async () => state.db }));
vi.mock("./auth/dal", () => ({
  STAFF: ["admin", "dispatcher"],
  assertUser: async (roles: string[]) => {
    const u = state.user as { role: string };
    if (!roles.includes(u.role)) throw new Error("Not authorised");
    return u;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const DAY = "2026-11-11";
const jpeg = (n: number) => ({ mime: "image/jpeg", data: new Uint8Array([0xff, 0xd8, 0xff, n]) });
const delivered = (o: Partial<Outcome> = {}) => ({ type: "delivered", recipient: null, note: null, photo: null, signature: null, at: null, ...o }) as Outcome;
// Brisbane: the next morning, 9am on the 12th.
const nextDay = new Date(Date.UTC(2026, 10, 11, 23));
const rules = { requirePhoto: true, requireSignature: true };

let db: DB;
let stopIds: string[];
let driverUser: { role: string };
let adminUser: { role: string };
let driverId: string;

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  state.db = db;
  await db.insert(settings).values({ id: 1, timezone: "Australia/Brisbane" }).onConflictDoNothing();
  const [d] = await db.insert(drivers).values({ name: "Sam" }).returning();
  driverId = d.id;
  [driverUser] = await db.insert(users).values({ email: "sam@x.test", name: "Sam", passwordHash: "x", role: "driver", driverId: d.id }).returning();
  [adminUser] = await db.insert(users).values({ email: "boss@x.test", name: "Boss", passwordHash: "x", role: "admin" }).returning();
  const [p] = await db.insert(plans).values({ deliveryDate: DAY, status: "dispatched" }).returning();
  const os = await db
    .insert(orders)
    .values([1, 2, 3].map((n) => ({ orderNumber: `T-${n}`, deliveryDate: DAY, address: `${n} Test St`, status: "dispatched" as const })))
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
}, 30000);

const proofsOf = async (stopId: string) => {
  const [s] = await db.select().from(routeStops).where(eq(routeStops.id, stopId));
  return db.select().from(deliveryProofs).where(eq(deliveryProofs.orderId, s.orderId));
};

describe("confirming a delivery the day after", () => {
  it("lists the day's stops still to confirm", async () => {
    expect(await unconfirmedStops(db, "2026-11-12", driverId)).toMatchObject([{ date: DAY, pending: 3 }]);
    // Not before the day is over, nor once it's too long ago.
    expect(await unconfirmedStops(db, DAY, driverId)).toEqual([]);
    expect(await unconfirmedStops(db, "2026-12-30")).toEqual([]);
  });

  it("the driver completes it with the signature photo alone, even when a photo is normally required", async () => {
    state.user = driverUser;
    await finishStop(stopIds[0], delivered({ signature: jpeg(1) }), nextDay, rules);
    const [s] = await db.select().from(routeStops).where(eq(routeStops.id, stopIds[0]));
    expect(s.status).toBe("delivered");
    expect((await proofsOf(stopIds[0])).map((p) => p.kind)).toEqual(["signature"]);
  });

  it("still needs a photo or a signature", async () => {
    await expect(finishStop(stopIds[1], delivered(), nextDay, rules)).rejects.toThrow("Take a photo or get a signature");
  });

  it("keeps the usual rules on the delivery day", async () => {
    const sameDay = new Date(Date.UTC(2026, 10, 11, 2));
    await expect(finishStop(stopIds[1], delivered({ signature: jpeg(2) }), sameDay, rules)).rejects.toThrow("A delivery photo is required");
  });

  it("the office confirms a stop for the driver, on the driver's delivery record", async () => {
    state.user = adminUser;
    await finishStopFromOffice(stopIds[1], delivered({ signature: jpeg(3) }));
    const [s] = await db.select().from(routeStops).where(eq(routeStops.id, stopIds[1]));
    expect(s.status).toBe("delivered");
    const [ev] = await db.select().from(deliveryEvents).where(eq(deliveryEvents.orderId, s.orderId));
    expect(ev).toMatchObject({ type: "delivered", driverId, userId: (adminUser as unknown as { id: string }).id });
    expect(await unconfirmedStops(db, "2026-11-12")).toMatchObject([{ pending: 1 }]);
  });

  it("only staff can confirm for a driver", async () => {
    state.user = driverUser;
    await expect(finishStopFromOffice(stopIds[2], delivered({ signature: jpeg(4) }))).rejects.toThrow("Not authorised");
  });
});

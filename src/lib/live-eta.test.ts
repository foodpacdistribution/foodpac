import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "./db";
import { deliveryEvents, drivers, orders, plans, routes, routeStops, settings, users } from "./db/schema";
import { finishStop, startDriverRoute } from "./driver-stops";
import { nowSecondsIn } from "./time";

// A driver's day end to end against a real Postgres: set off late, deliver, deliver out of turn,
// and a delivery that sat on the phone without signal. Arrival times must follow the van.

const state = vi.hoisted(() => ({ db: null as unknown, user: null as unknown }));
vi.mock("./db", async (orig) => ({ ...(await orig<typeof import("./db")>()), getDb: async () => state.db }));
vi.mock("./auth/dal", () => ({ assertUser: async () => state.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const TZ = "Australia/Sydney";
const H = 3600;
// 2026-11-11 in Sydney (UTC+11): local seconds-after-midnight → Date.
const local = (s: number) => new Date(Date.UTC(2026, 10, 10, 13, 0, 0) + s * 1000);
const outcome = { type: "delivered" as const, recipient: null, note: null, photo: null, signature: null, at: null };

let db: DB;
let routeId: string;
let stopIds: string[];

async function setup() {
  const [d] = await db.insert(drivers).values({ name: "Sam" }).returning();
  const [u] = await db.insert(users).values({ email: "sam@x.test", name: "Sam", passwordHash: "x", role: "driver", driverId: d.id }).returning();
  state.user = { ...u };
  const [p] = await db.insert(plans).values({ deliveryDate: "2026-11-11", status: "dispatched" }).returning();
  // Planned: leave 8:00, four stops 10 min apart with 5 min unloading, 15 min back to the depot.
  const os = await db
    .insert(orders)
    .values([1, 2, 3, 4].map((n) => ({ orderNumber: `T-${n}`, deliveryDate: "2026-11-11", address: `${n} Test St`, status: "dispatched" as const, ...(n === 4 ? { windowStartMin: 10 * 60 } : {}) })))
    .returning();
  const [r] = await db
    .insert(routes)
    .values({ planId: p.id, driverId: d.id, startS: 8 * H, endS: 8 * H + 75 * 60, distanceM: 1, driveS: 1, serviceS: 1, waitS: 0, dispatchedAt: new Date() })
    .returning();
  routeId = r.id;
  const rows = await db
    .insert(routeStops)
    .values(
      os.map((o, i) => ({
        routeId,
        orderId: o.id,
        seq: i + 1,
        etaS: 8 * H + 600 + i * 900,
        etdS: 8 * H + 900 + i * 900,
        legDistanceM: 1,
        legDriveS: 600,
      })),
    )
    .returning();
  stopIds = rows.map((s) => s.id);
}

const stops = () => db.select().from(routeStops).where(eq(routeStops.routeId, routeId)).orderBy(asc(routeStops.seq));
const route = async () => (await db.select().from(routes).where(eq(routes.id, routeId)))[0];

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  state.db = db;
  await db.insert(settings).values({ id: 1, timezone: TZ }).onConflictDoUpdate({ target: settings.id, set: { timezone: TZ } });
  await setup();
}, 30000);

describe("a driver's day", () => {
  it("counts arrival times from when the driver really sets off", async () => {
    await startDriverRoute(routeId, local(8 * H + 40 * 60));
    const r = await route();
    expect(r.status).toBe("in_progress");
    expect(r.startS).toBe(8 * H + 40 * 60);
    expect(r.plannedDurationS).toBe(75 * 60);
    const st = await stops();
    expect(st.map((s) => s.etaS)).toEqual([8 * H + 50 * 60, 9 * H + 5 * 60, 9 * H + 20 * 60, 9 * H + 35 * 60]);
    // Stop 4 opens at 10:00: arriving 9:35 now means waiting.
    expect(st[3].waitS).toBe(25 * 60);
    expect(r.endS).toBe(10 * H + 5 * 60 + 15 * 60);
    expect((await db.select().from(deliveryEvents)).map((e) => e.type)).toEqual(["route_started"]);
  });

  it("a second tap on Start changes nothing", async () => {
    const before = await stops();
    await startDriverRoute(routeId, local(9 * H));
    expect(await stops()).toEqual(before);
  });

  it("re-times the stops still to do after each delivery", async () => {
    // Stop 1 done at 9:10 (planned 8:55): everything after moves 15 min later.
    await finishStop(stopIds[0], outcome, local(9 * H + 10 * 60));
    const st = await stops();
    expect(st[1].etaS).toBe(9 * H + 20 * 60);
    expect(st[2].etaS).toBe(9 * H + 35 * 60);
    expect(st[0].etaS).toBe(8 * H + 50 * 60); // the done stop keeps what was planned
  });

  it("re-times from the latest delivery when an older one arrives late from the phone", async () => {
    // Driver did stop 3 at 9:30 out of turn; it's uploaded first.
    await finishStop(stopIds[2], outcome, local(9 * H + 30 * 60));
    const st = await stops();
    expect(st[1].etaS).toBe(9 * H + 40 * 60);
    expect(st[3].etaS).toBe(9 * H + 55 * 60); // then waits for its 10:00 window
    expect(st[3].waitS).toBe(5 * 60);
  });

  it("finishing the last stop completes the route; history keeps the planned duration", async () => {
    await finishStop(stopIds[1], outcome, local(9 * H + 45 * 60));
    await finishStop(stopIds[3], outcome, local(10 * H + 5 * 60));
    const r = await route();
    expect(r.status).toBe("completed");
    expect(r.plannedDurationS).toBe(75 * 60);
  });
});

describe("delivered without tapping Start", () => {
  it("takes the first delivery as setting off and re-times the rest", async () => {
    await db.delete(plans);
    await db.delete(orders);
    await db.delete(users);
    await setup();
    await finishStop(stopIds[0], outcome, local(9 * H));
    const r = await route();
    expect(r.status).toBe("in_progress");
    // Planned 15 min from leaving to finishing stop 1.
    expect(nowSecondsIn(TZ, r.startedAt!)).toBe(8 * H + 45 * 60);
    expect(r.startS).toBe(8 * H + 45 * 60);
    expect((await stops())[1].etaS).toBe(9 * H + 10 * 60);
  });
});

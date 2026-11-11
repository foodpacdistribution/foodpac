import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "./db";
import { customers, drivers, orders, plans, routes, routeStops, settings } from "./db/schema";
import { emailDelivered, emailHeadsUp, emailNextStop, emailRouteStarted } from "./delivery-emails";

const state = vi.hoisted(() => ({ db: null as unknown, sent: [] as { to: string; subject: string }[] }));
vi.mock("./db", async (orig) => ({ ...(await orig<typeof import("./db")>()), getDb: async () => state.db }));
vi.mock("./email", async (orig) => ({
  ...(await orig<typeof import("./email")>()),
  emailEnabled: () => true,
  sendEmail: async (m: { to: string; subject: string }) => void state.sent.push({ to: m.to, subject: m.subject }),
  sendEmailResult: async (m: { to: string; subject: string }) => (state.sent.push({ to: m.to, subject: m.subject }), { ok: true, id: "x" }),
}));

let db: DB;
let routeId: string;

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  state.db = db;
  await db.insert(settings).values({ id: 1, timezone: "Australia/Sydney", notifyCustomers: true }).onConflictDoUpdate({ target: settings.id, set: { notifyCustomers: true } });
  const [a, b] = await db.insert(customers).values([{ name: "Cafe A", email: "a@x.test" }, { name: "Cafe B", email: "b@x.test" }]).returning();
  const [d] = await db.insert(drivers).values({ name: "Sam" }).returning();
  const [p] = await db.insert(plans).values({ deliveryDate: "2026-11-11" }).returning();
  const [r] = await db.insert(routes).values({ planId: p.id, driverId: d.id, startS: 8 * 3600, endS: 10 * 3600, distanceM: 1, driveS: 1, serviceS: 1, waitS: 0, status: "in_progress" }).returning();
  routeId = r.id;
  // Third order has no customer (imported): never emailed.
  const os = await db
    .insert(orders)
    .values([
      { orderNumber: "T-1", deliveryDate: "2026-11-11", address: "1 A St", customerId: a.id },
      { orderNumber: "T-2", deliveryDate: "2026-11-11", address: "2 B St", customerId: b.id },
      { orderNumber: "T-3", deliveryDate: "2026-11-11", address: "3 C St" },
    ])
    .returning();
  await db.insert(routeStops).values(os.map((o, i) => ({ routeId, orderId: o.id, seq: i + 1, etaS: 8 * 3600 + (i + 1) * 900, etdS: 8 * 3600 + (i + 1) * 900 + 300, legDistanceM: 1, legDriveS: 600 })));
}, 30000);

beforeEach(() => {
  state.sent = [];
});

const stops = () => db.select().from(routeStops).where(eq(routeStops.routeId, routeId)).orderBy(asc(routeStops.seq));

describe("delivery emails", () => {
  it("tells everyone with an email that it's on its way; the first stop that it's first", async () => {
    await emailRouteStarted(routeId);
    expect(state.sent).toEqual([
      { to: "a@x.test", subject: "Your delivery is on its way: you're the first stop" },
      { to: "b@x.test", subject: "Your delivery is on its way: expected around 8:30am" },
    ]);
    expect((await stops())[0].nextNotifiedAt).not.toBeNull();
  });

  it("doesn't tell the first stop it's next a second time", async () => {
    await emailNextStop(routeId);
    expect(state.sent).toEqual([]);
  });

  it("after a delivery, the next customer hears they're next, once", async () => {
    const [first] = await stops();
    await db.update(routeStops).set({ status: "delivered", completedAt: new Date() }).where(eq(routeStops.id, first.id));
    await emailDelivered(first.id);
    await emailNextStop(routeId);
    await emailNextStop(routeId);
    expect(state.sent).toEqual([
      { to: "a@x.test", subject: "Delivered: order T-1" },
      { to: "b@x.test", subject: "You're next: your delivery is expected around 8:30am" },
    ]);
  });

  it("the driver's 10-minutes-away email goes once, and says why when it can't", async () => {
    const [, second, third] = await stops();
    expect(await emailHeadsUp(db, second)).toEqual({ sent: true });
    const again = (await stops())[1];
    expect(await emailHeadsUp(db, again)).toEqual({ sent: false, reason: "The customer has already been told you're on your way." });
    expect(await emailHeadsUp(db, third)).toEqual({ sent: false, reason: "This customer has no email address on file. Call them instead." });
    expect(state.sent).toEqual([{ to: "b@x.test", subject: "Your driver is about 10 minutes away" }]);
  });

  it("sends nothing while the setting is off", async () => {
    await db.update(settings).set({ notifyCustomers: false });
    await db.update(routeStops).set({ nextNotifiedAt: null }).where(eq(routeStops.routeId, routeId));
    await emailRouteStarted(routeId);
    await emailNextStop(routeId);
    expect(state.sent).toEqual([]);
    const [, , third] = await stops();
    expect((await emailHeadsUp(db, third)).sent).toBe(false);
  });
});

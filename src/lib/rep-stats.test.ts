import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { type DB, schema } from "./db";
import { customers, customerVisits, salesOrders, settings, users } from "./db/schema";
import { shiftDate } from "./dates";
import { daysOf, orderRate, repStats, teamStats } from "./rep-stats";
import { todayIn } from "./time";

// "My sales": a salesperson's visits, and what their customers bought, over a stretch of days.

const TZ = "Australia/Brisbane";
let db: DB;
let sam: string;
let kim: string;
let today: string;
let n = 0;

const order = (customerId: string, totalCents: number, daysAgo: number, status: "confirmed" | "cancelled" = "confirmed") =>
  db.insert(salesOrders).values({
    number: `SO-${++n}`,
    idempotencyKey: `k${n}`,
    customerId,
    status,
    paymentMethod: "invoice",
    deliveryDate: today,
    recipient: "x",
    phone: "",
    address: "x",
    subtotalCents: totalCents,
    deliveryFeeCents: 0,
    gstCents: 0,
    totalCents,
    createdAt: new Date(Date.now() - daysAgo * 86_400_000),
  } as typeof salesOrders.$inferInsert);

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  await db.insert(settings).values({ id: 1 });
  today = todayIn(TZ);
  [{ id: sam }, { id: kim }] = await db
    .insert(users)
    .values([
      { email: "sam@x.test", name: "Sam", role: "sales", passwordHash: "x" },
      { email: "kim@x.test", name: "Kim", role: "sales", passwordHash: "x" },
    ])
    .returning();
  const [old, fresh, lost, kims] = await db
    .insert(customers)
    .values([
      { name: "Old Regular", salesRepId: sam, salesStage: "won", salesStageAt: new Date(Date.now() - 200 * 86_400_000) },
      { name: "New Tea Shop", salesRepId: sam, salesStage: "won", salesStageAt: new Date(Date.now() - 2 * 86_400_000) },
      { name: "Said No", salesRepId: sam, salesStage: "not_now" },
      { name: "Kim's Shop", salesRepId: kim, salesStage: "won" },
    ])
    .returning();
  await order(old.id, 10_000, 100); // first order long ago
  await order(old.id, 30_000, 3);
  await order(fresh.id, 20_000, 1); // first order this week
  await order(fresh.id, 99_000, 1, "cancelled"); // doesn't count
  await order(old.id, 40_000, 40); // the 30 days before
  await order(kims.id, 77_000, 2); // Kim's, not Sam's
  await db.insert(customerVisits).values([
    { customerId: fresh.id, userId: sam, outcome: "ordered" },
    { customerId: fresh.id, userId: sam, outcome: "samples", createdAt: new Date(Date.now() - 5 * 86_400_000) },
    { customerId: lost.id, userId: sam, outcome: "not_now", channel: "call" },
    { customerId: lost.id, userId: sam, outcome: "interested", createdAt: new Date(Date.now() - 60 * 86_400_000) }, // too long ago
    { customerId: kims.id, userId: kim, outcome: "interested" },
  ]);
}, 30000);

describe("a salesperson's numbers", () => {
  it("counts their visits and what their customers bought", async () => {
    const st = await repStats(db, sam, { from: shiftDate(today, -29), to: today, timeZone: TZ });
    expect(st.visits).toMatchObject({ total: 3, inStore: 2, calls: 1, stores: 2, byOutcome: { ordered: 1, samples: 1, not_now: 1 }, orderRate: 33 });
    expect(st.sales).toEqual({ cents: 50_000, orders: 2, prevCents: 40_000 });
    expect(st.firstOrders.map((f) => f.name)).toEqual(["New Tea Shop"]);
    expect(st.won.map((w) => w.name)).toEqual(["New Tea Shop"]);
    expect(st.pipeline).toMatchObject({ won: 2, not_now: 1, new: 0 });
    expect(st.top.map((t) => t.name)).toEqual(["Old Regular", "New Tea Shop"]);
    expect(st.series).toHaveLength(30);
    expect(st.series.reduce((t, d) => t + d.visits, 0)).toBe(3);
  });

  it("puts the team side by side, best sales first", async () => {
    const team = await teamStats(db, { from: shiftDate(today, -6), to: today, timeZone: TZ });
    expect(team.map((r) => [r.name, r.salesCents, r.visits, r.won])).toEqual([
      ["Kim", 77_000, 1, 1],
      ["Sam", 50_000, 3, 1],
    ]);
  });
});

describe("helpers", () => {
  it("lists the days and the share of visits that ordered", () => {
    expect(daysOf("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(orderRate({ ordered: 1 }, 4)).toBe(25);
    expect(orderRate({}, 0)).toBeNull();
  });
});

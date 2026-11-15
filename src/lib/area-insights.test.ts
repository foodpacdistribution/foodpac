import { describe, expect, it } from "vitest";
import { thin, vanDaysNear } from "./area-insights";
import { salesTrend, visitScore } from "./customer-map";

// A road heading east from Sunnybank, about 11 km, as a Tuesday run.
const road: [number, number][] = Array.from({ length: 101 }, (_, i) => [-27.58, 153.06 + i * 0.001]);

describe("delivery runs on the customer map", () => {
  it("thins a road path but keeps both ends", () => {
    const t = thin(road, 500);
    expect(t.length).toBeLessThan(30);
    expect(t[0]).toEqual(road[0]);
    expect(t[t.length - 1]).toEqual(road[road.length - 1]);
  });

  it("knows which weekdays a van passes nearby", () => {
    const runs = [
      { weekday: 2, path: road },
      // Thursday: just the two ends of a long straight stretch; the middle still counts.
      { weekday: 4, path: [road[0], road[100]] },
    ];
    const near = { lat: -27.585, lng: 153.11 }; // ~550 m off the road
    const far = { lat: -27.65, lng: 153.11 }; // ~7.8 km away
    expect(vanDaysNear(runs, [near, far])).toEqual([[2, 4], []]);
  });
});

describe("which areas are worth a visit", () => {
  const base = { due: 0, talks: 0, leads: 0, won: 5, last90Cents: 100_000, prev90Cents: 100_000 };
  it("puts customers due a call first, then talks, then leads", () => {
    expect(visitScore({ ...base, due: 2 })).toBeGreaterThan(visitScore({ ...base, talks: 2 }));
    expect(visitScore({ ...base, talks: 1 })).toBeGreaterThan(visitScore({ ...base, leads: 1 }));
  });
  it("adds a little for sales falling", () => {
    expect(salesTrend({ last90Cents: 82_000, prev90Cents: 100_000 })).toBe(-18);
    expect(visitScore({ ...base, last90Cents: 82_000 })).toBe(2);
    // Too little before to compare.
    expect(salesTrend({ last90Cents: 5_000, prev90Cents: 10_000 })).toBeNull();
  });
});

describe("map queries on a real database", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { schema } = await import("./db");
  const { customers, drivers, plans, routes, salesOrders } = await import("./db/schema");
  const { recentSales, vanRuns } = await import("./area-insights");
  type DB = import("./db").DB;

  it("reads sales lately and the last four weeks' runs", async () => {
    const lite = drizzle(new PGlite(), { schema });
    await migrate(lite, { migrationsFolder: "drizzle" });
    const db = lite as unknown as DB;
    const [c] = await db.insert(customers).values({ name: "Noodle Bar" }).returning();
    const order = (days: number, cents: number) => ({
      number: `FP-${days}`,
      idempotencyKey: `k${days}`,
      customerId: c.id,
      status: "confirmed" as const,
      paymentStatus: "unpaid" as const,
      paymentMethod: "invoice" as const,
      subtotalCents: cents,
      deliveryFeeCents: 0,
      gstCents: 0,
      totalCents: cents,
      deliveryDate: "2026-11-01",
      recipient: "Mei",
      address: "1 Main St",
      createdAt: new Date(Date.now() - days * 86_400_000),
    });
    await db.insert(salesOrders).values([order(10, 5000), order(100, 8000), order(400, 9000)]);
    expect((await recentSales(db)).get(c.id)).toEqual({ last90: 5000, prev90: 8000 });

    const [d] = await db.insert(drivers).values({ name: "Van 1" }).returning();
    const route = (planId: string) => ({ planId, driverId: d.id, startS: 0, endS: 1, distanceM: 1, driveS: 1, serviceS: 1, waitS: 0, geometry: road });
    const [recent, old] = await db.insert(plans).values([{ deliveryDate: "2026-11-10" }, { deliveryDate: "2026-09-01" }]).returning();
    await db.insert(routes).values([route(recent.id), route(old.id)]);
    const runs = await vanRuns(db, "2026-11-15");
    expect(runs.map((r) => r.weekday)).toEqual([2]); // 10 Nov 2026 is a Tuesday
  }, 30000);
});

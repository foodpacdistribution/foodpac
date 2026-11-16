import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "./db";
import { customers, salesOrders } from "./db/schema";
import { newCustomerFunnel } from "./new-customers";

vi.mock("server-only", () => ({}));

let db: DB;
const DAY = 86_400_000;
const now = new Date();
const ago = (d: number) => new Date(now.getTime() - d * DAY);

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
}, 30000);

describe("approved_at", () => {
  it("is set by the database when an account is approved, however that happens", async () => {
    const [signup] = await db.insert(customers).values({ name: "Signup", approved: false, registeredOnline: true }).returning();
    expect(signup.approvedAt).toBeNull();
    const [approved] = await db.update(customers).set({ approved: true }).where(eq(customers.id, signup.id)).returning();
    expect(approved.approvedAt).toBeInstanceOf(Date);
    // Opened by staff: can order from the start.
    const [staff] = await db.insert(customers).values({ name: "Staff added" }).returning();
    expect(staff.approvedAt).toBeInstanceOf(Date);
    await db.delete(customers);
  });
});

describe("newCustomerFunnel", () => {
  it("counts accounts opened, approved and ordered, and who is stuck", async () => {
    const [ordered, , waiting] = await db
      .insert(customers)
      .values([
        { name: "Ordered", registeredOnline: true, createdAt: ago(10), approvedAt: ago(9) },
        { name: "No order yet", createdAt: ago(5), approvedAt: ago(5) },
        { name: "Waiting", approved: false, registeredOnline: true, createdAt: ago(3) },
        { name: "Old", createdAt: ago(200), approvedAt: ago(200) },
      ])
      .returning();
    await db.insert(salesOrders).values({
      number: "SO-1",
      customerId: ordered.id,
      paymentMethod: "invoice",
      subtotalCents: 1000,
      deliveryFeeCents: 0,
      gstCents: 100,
      totalCents: 1100,
      deliveryDate: "2026-11-10",
      recipient: "x",
      address: "x",
      idempotencyKey: "k1",
      createdAt: ago(7),
    });
    const f = await newCustomerFunnel(db, ago(30), now, now);
    expect(f).toMatchObject({ opened: 3, online: 2, approved: 2, ordered: 1, reminders: { sent: 0, ordered: 0 } });
    expect(f.daysToFirstOrder).toBeCloseTo(3, 1);
    expect(f.waiting).toEqual([{ id: waiting.id, name: "Waiting", days: 3 }]);
    expect(f.noOrder.map((c) => c.name)).toEqual(["No order yet"]);
  });
});

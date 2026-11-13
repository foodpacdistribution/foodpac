import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { customerProfile } from "./customer-profile";
import { type DB, schema } from "./db";
import { customers, deliveryEvents, orders, quotes, salesOrderItems, salesOrders } from "./db/schema";

let db: DB;
let customerId: string;
const TODAY = "2026-11-13";

const order = (n: string, o: Partial<typeof salesOrders.$inferInsert>) => ({
  number: n,
  customerId,
  paymentMethod: "invoice" as const,
  subtotalCents: 0,
  deliveryFeeCents: 0,
  gstCents: 0,
  totalCents: 10000,
  deliveryDate: "2026-11-01",
  recipient: "Amy",
  address: "1 Test St",
  idempotencyKey: `k-${n}`,
  ...o,
});

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  [{ id: customerId }] = await db.insert(customers).values({ name: "Sushi Paradise", creditLimitCents: 50000 }).returning();
  const [paid, unpaid] = await db
    .insert(salesOrders)
    .values([
      order("SO-1", { status: "confirmed", paymentStatus: "paid", paidAt: new Date("2026-11-02T01:00:00Z") }),
      order("SO-2", { status: "confirmed", totalCents: 20000, creditAppliedCents: 5000, dueDate: "2026-11-10" }),
      order("SO-3", { status: "cancelled", totalCents: 99999, cancelledAt: new Date() }),
    ])
    .returning();
  await db.insert(salesOrderItems).values([
    { salesOrderId: paid.id, sku: "BOWL", name: "Paper bowl 750ml", qty: 2, unitPriceCents: 100, packSize: "", unit: "pkt", gst: true, lineCents: 200 },
    { salesOrderId: unpaid.id, sku: "BOWL", name: "Paper bowl 750ml", qty: 3, unitPriceCents: 100, packSize: "", unit: "pkt", gst: true, lineCents: 300 },
  ] as never);
  // An imported EMERGE invoice: a delivery with goods and no shop order.
  const [d] = await db
    .insert(orders)
    .values({ orderNumber: "SO002312", deliveryDate: "2026-11-12", customerId, customerName: "Sushi Paradise", address: "Shop 49", status: "delivered", goods: [{ name: "PAPER BOWL 750ML", qty: 4, unit: "PKT" }, { name: "Chopsticks", qty: 1, unit: "CTN" }] })
    .returning();
  await db.insert(deliveryEvents).values({ orderId: d.id, type: "delivered", recipient: "Kenji" });
  await db.insert(quotes).values({ number: "Q-1", customerId, validUntil: "2026-11-01", status: "sent", subtotalCents: 0, deliveryFeeCents: 0, gstCents: 0, totalCents: 500 });
}, 30000);

describe("customerProfile", () => {
  it("adds up sales without cancelled orders, and what's unpaid and overdue", async () => {
    const p = (await customerProfile(db, customerId, TODAY))!;
    expect(p.stats).toMatchObject({ lifetimeCents: 30000, orders: 2, avgOrderCents: 15000, unpaidCents: 15000, overdueCents: 15000, deliveries: 1, delivered: 1, lastDelivery: "2026-11-12" });
    expect(p.sales.find((s) => s.number === "SO-2")).toMatchObject({ dueCents: 15000, overdue: true });
  });

  it("counts what they buy across shop orders and imported invoices", async () => {
    const p = (await customerProfile(db, customerId, TODAY))!;
    expect(p.topProducts[0]).toMatchObject({ name: "Paper bowl 750ml", orders: 3, qty: 9, last: "2026-11-12" });
    expect(p.topProducts.map((t) => t.name)).toContain("Chopsticks");
  });

  it("puts everything on one timeline, newest first", async () => {
    const p = (await customerProfile(db, customerId, TODAY))!;
    const kinds = p.timeline.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["joined", "order", "paid", "cancelled", "delivered", "quote"]));
    expect(p.timeline.find((e) => e.kind === "delivered")).toMatchObject({ title: "Delivered: {number}", vars: { number: "SO002312" }, detail: "Kenji" });
    const times = p.timeline.map((e) => e.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("is null for a customer that doesn't exist", async () => {
    expect(await customerProfile(db, "00000000-0000-0000-0000-000000000000", TODAY)).toBeNull();
  });
});

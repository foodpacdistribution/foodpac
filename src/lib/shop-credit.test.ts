import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "./db";
import { schema } from "./db";
import { cartItems, customers, products, settings, users } from "./db/schema";
import { creditBalance, postCredit } from "./credit";
import { getSettings } from "./planning";
import { cancelOrder, deliveryDates, placeOrder } from "./shop";
import { createStaffOrder } from "./staff-orders";

vi.mock("next/server", () => ({ after: () => {} }));

// Customers spending their own store credit at checkout.

let db: DB;
let userId: string;
let cups: string;
let key = 0;

const customer = async (paymentTerms: "prepay" | "net30" = "prepay") => {
  const [c] = await db.insert(customers).values({ name: `Shop ${++key}`, paymentTerms }).returning();
  return c;
};
const giveCredit = (customerId: string, dollars: number) => postCredit(db, { customerId, type: "promotion_credit", amount: dollars, sourceType: "manual", description: "test", by: userId });
const checkout = async (c: typeof customers.$inferSelect, method: "card" | "bank_transfer" | "invoice", useCredit: boolean) => {
  await db.insert(cartItems).values({ customerId: c.id, productId: cups, qty: 2 });
  const s = await getSettings(db);
  return placeOrder(
    db,
    c,
    userId,
    { idempotencyKey: `k${++key}`, method, deliveryDate: deliveryDates(s)[0], recipient: "Mei", phone: null, address: "1 Main St", instructions: null, windowStartMin: null, windowEndMin: null, notes: null, useCredit },
    s,
    true,
  );
};

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  // Every day a delivery day and no minimum, so the test runs any day of the week.
  await db.insert(settings).values({ id: 1, deliveryDays: [0, 1, 2, 3, 4, 5, 6], minOrderCents: 0, deliveryFeeCents: 0 });
  [{ id: userId }] = await db.insert(users).values({ email: "buyer@x.test", name: "Buyer", role: "admin", passwordHash: "x" }).returning({ id: users.id });
  // $50 a carton, GST on: 2 cartons = $110.
  [{ id: cups }] = await db.insert(products).values({ sku: "CUP8", name: "Cup 8 oz", priceCents: 5000, stock: 1000 }).returning({ id: products.id });
}, 30000);

beforeEach(() => {
  key++;
});

describe("paying with store credit at checkout", () => {
  it("takes part of the order off the credit and leaves the rest to pay", async () => {
    const c = await customer();
    await giveCredit(c.id, 30);
    const so = await checkout(c, "bank_transfer", true);
    expect(so).toMatchObject({ totalCents: 11000, creditAppliedCents: 3000, paymentStatus: "unpaid", status: "confirmed" });
    expect(await creditBalance(db, c.id)).toBe(0);
  });

  it("confirms a card order straight away when credit covers it, with nothing to charge", async () => {
    const c = await customer();
    await giveCredit(c.id, 200);
    const so = await checkout(c, "card", true);
    expect(so).toMatchObject({ creditAppliedCents: 11000, paymentStatus: "paid", status: "confirmed", paymentMethod: "bank_transfer" });
    expect(so.deliveryOrderId).toBeTruthy();
    expect(await creditBalance(db, c.id)).toBe(90);
  });

  it("leaves the credit alone unless asked", async () => {
    const c = await customer();
    await giveCredit(c.id, 50);
    const so = await checkout(c, "bank_transfer", false);
    expect(so.creditAppliedCents).toBe(0);
    expect(await creditBalance(db, c.id)).toBe(50);
  });

  it("counts only what's left after credit against the credit limit", async () => {
    const c = await customer("net30");
    await db.update(customers).set({ creditLimitCents: 10000 }).where(eq(customers.id, c.id));
    await giveCredit(c.id, 20);
    const so = await checkout({ ...c, creditLimitCents: 10000 }, "invoice", true);
    expect(so).toMatchObject({ creditAppliedCents: 2000, paymentMethod: "invoice" });
  });

  it("gives the credit back when the order is cancelled", async () => {
    const c = await customer();
    await giveCredit(c.id, 40);
    const so = await checkout(c, "bank_transfer", true);
    await cancelOrder(db, so.id);
    expect(await creditBalance(db, c.id)).toBe(40);
  });
});

describe("first-order offers", () => {
  // $110 orders (2 cartons at $50 + GST); $100 before GST.
  const withOffer = async (min: number, off: number) => {
    const c = await customer();
    const [row] = await db.update(customers).set({ firstOrderMinCents: min, firstOrderOffCents: off }).where(eq(customers.id, c.id)).returning();
    return row;
  };
  const fresh = async (id: string) => (await db.select().from(customers).where(eq(customers.id, id)))[0];

  it("takes the offer off a first order that reaches the minimum, once", async () => {
    const c = await withOffer(10000, 3000);
    const so = await checkout(c, "bank_transfer", false);
    expect(so).toMatchObject({ creditAppliedCents: 3000, paymentStatus: "unpaid" });
    expect((await fresh(c.id)).firstOrderOfferOrderId).toBe(so.id);
    expect(await creditBalance(db, c.id)).toBe(0);
    const second = await checkout(await fresh(c.id), "bank_transfer", false);
    expect(second.creditAppliedCents).toBe(0);
  });

  it("leaves it for later when the first order is under the minimum", async () => {
    const c = await withOffer(20000, 3000);
    expect((await checkout(c, "bank_transfer", false)).creditAppliedCents).toBe(0);
    expect((await fresh(c.id)).firstOrderOfferOrderId).toBeNull();
  });

  it("comes before store credit, and a card order it covers needs no card", async () => {
    const c = await withOffer(10000, 3000);
    await giveCredit(c.id, 100);
    const so = await checkout(c, "card", true);
    expect(so).toMatchObject({ creditAppliedCents: 11000, paymentStatus: "paid", paymentMethod: "bank_transfer" });
    expect(await creditBalance(db, c.id)).toBe(20);
  });

  it("is open again when that order is cancelled, without leaving its credit behind", async () => {
    const c = await withOffer(10000, 3000);
    await giveCredit(c.id, 10);
    const so = await checkout(c, "bank_transfer", true);
    expect(so.creditAppliedCents).toBe(4000);
    await cancelOrder(db, so.id);
    expect(await creditBalance(db, c.id)).toBe(10);
    expect((await fresh(c.id)).firstOrderOfferOrderId).toBeNull();
  });

  it("applies to a first order a salesperson takes too", async () => {
    const c = await withOffer(10000, 3000);
    const s = await getSettings(db);
    const so = await createStaffOrder(
      db,
      userId,
      { customerId: c.id, method: "invoice", idempotencyKey: `s${++key}`, deliveryDate: deliveryDates(s)[0], recipient: "Mei", phone: null, address: "1 Main St", instructions: null, windowStartMin: null, windowEndMin: null, notes: null, deliveryFeeCents: 0, lines: [{ productId: cups, qty: 2, unitPriceCents: 5000 }] },
      "2000-01-01",
    );
    expect(so.creditAppliedCents).toBe(3000);
  });
});

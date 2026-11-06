import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "./db";
import { schema } from "./db";
import { customerCreditAccounts, customerCreditTransactions, customers, customerReturnItems, inventoryMovements, orders, products, salesOrderItems, salesOrders, users } from "./db/schema";
import { adjustCredit, applyCreditToOrder, creditBalance, postCredit } from "./credit";
import { cancelCustomerReturn, completeCustomerReturn, createCustomerReturn, receiveCustomerReturn, returnableOrderLines } from "./customer-returns";
import { cancelOrder } from "./shop";
import { createStaffOrder, updateStaffOrder } from "./staff-orders";

let db: DB;
let staff: string;
let cust: string;
let cups: string;
let key = 0;
const today = "2026-11-10";

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  [{ id: staff }] = await db.insert(users).values({ email: "office@x.test", name: "Office", role: "admin", passwordHash: "x" }).returning({ id: users.id });
  [{ id: cust }] = await db.insert(customers).values({ name: "John Smith Cafe", paymentTerms: "net14" }).returning({ id: customers.id });
  [{ id: cups }] = await db.insert(products).values({ sku: "CUP8", name: "Cup 8 oz", priceCents: 10000, stock: 100 }).returning({ id: products.id });
}, 30000);

const dbRefusal = async (q: PromiseLike<unknown>) => {
  try {
    await q;
  } catch (e) {
    return String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message);
  }
  return "no error";
};
const base = { deliveryDate: "2026-11-12", recipient: "John", phone: null, address: "1 Main St", instructions: null, windowStartMin: null, windowEndMin: null, notes: null, deliveryFeeCents: 0 };
/** qty cups at $100 ex GST = $110 each incl. GST. */
const order = (qty: number, creditCents = 0) =>
  createStaffOrder(db, staff, { ...base, customerId: cust, lines: [{ productId: cups, qty, unitPriceCents: 10000 }], method: "invoice", idempotencyKey: `c${++key}`, creditCents }, today);
const get = async (id: string) => (await db.select().from(salesOrders).where(eq(salesOrders.id, id)))[0];
const history = () => db.select().from(customerCreditTransactions).where(eq(customerCreditTransactions.customerId, cust)).orderBy(asc(customerCreditTransactions.createdAt));

describe("store credit wallet", () => {
  it("records every movement with balance before and after", async () => {
    await adjustCredit(db, staff, cust, "manual_credit", 100, "Goodwill");
    await adjustCredit(db, staff, cust, "promotion_credit", 50, "Opening promo");
    expect(await creditBalance(db, cust)).toBe(150);
    const h = await history();
    expect(h.map((t) => [t.transactionType, t.amount, t.balanceBefore, t.balanceAfter])).toEqual([
      ["manual_credit", 100, 0, 100],
      ["promotion_credit", 50, 100, 150],
    ]);
    expect(h[0].transactionNumber).toMatch(/^CT-\d+$/);
    await expect(adjustCredit(db, staff, cust, "manual_credit", 10, " ")).rejects.toThrow(/why/);
  });

  it("never goes below zero and can't be edited", async () => {
    await expect(adjustCredit(db, staff, cust, "credit_reversal", 151, "Mistake")).rejects.toThrow(/Not enough store credit: \$150.00 available/);
    const [t] = await history();
    expect(await dbRefusal(db.update(customerCreditTransactions).set({ amount: 999 }).where(eq(customerCreditTransactions.id, t.id)))).toMatch(/can't be changed or deleted/);
    expect(await dbRefusal(db.delete(customerCreditTransactions).where(eq(customerCreditTransactions.id, t.id)))).toMatch(/can't be changed or deleted/);
    expect(await dbRefusal(db.update(customerCreditAccounts).set({ balance: 1000 }).where(eq(customerCreditAccounts.customerId, cust)))).toMatch(/only changes through a credit transaction/);
    // Wrong sign for the type.
    await expect(postCredit(db, { customerId: cust, type: "order_redemption", amount: 5, sourceType: "manual" })).rejects.toThrow(/must take credit off/);
  });

  it("lets only one of two simultaneous orders spend the same credit", async () => {
    await adjustCredit(db, staff, cust, "credit_reversal", 50, "Reset to 100 for the test");
    expect(await creditBalance(db, cust)).toBe(100);
    const results = await Promise.allSettled([order(1, 10000), order(1, 10000)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/Not enough store credit/);
    expect(await creditBalance(db, cust)).toBe(0);
    // The failed order rolled back completely (no order without its credit).
    expect((await db.select().from(salesOrders)).length).toBe(1);
  });
});

describe("credit on orders", () => {
  it("pays part of an order; the rest is still due", async () => {
    await adjustCredit(db, staff, cust, "manual_credit", 250, "Credit for the example");
    const so = await order(3, 25000); // $330 total, $250 credit
    expect(await get(so.id)).toMatchObject({ totalCents: 33000, creditAppliedCents: 25000, paymentStatus: "unpaid" });
    expect(await creditBalance(db, cust)).toBe(0);
    const [last] = (await history()).slice(-1);
    expect(last).toMatchObject({ transactionType: "order_redemption", amount: -250, balanceAfter: 0, sourceNumber: so.number });
  });

  it("marks an order paid when credit covers it, and gives credit back when it's cancelled", async () => {
    await adjustCredit(db, staff, cust, "manual_credit", 500, "More credit");
    const so = await order(2, 99999); // capped at $220
    expect(await get(so.id)).toMatchObject({ creditAppliedCents: 22000, paymentStatus: "paid" });
    expect(await creditBalance(db, cust)).toBe(280);
    await cancelOrder(db, so.id);
    expect(await creditBalance(db, cust)).toBe(500);
    expect((await get(so.id)).creditAppliedCents).toBe(0);
    expect((await history()).slice(-1)[0]).toMatchObject({ transactionType: "redemption_reversal", amount: 220, sourceNumber: so.number });
  });

  it("gives back credit an order no longer needs when it's reduced", async () => {
    const so = await order(4, 44000); // fully paid with credit
    expect(await creditBalance(db, cust)).toBe(60);
    await updateStaffOrder(db, so.id, { ...base, lines: [{ productId: cups, qty: 1, unitPriceCents: 10000 }] }, today);
    expect(await get(so.id)).toMatchObject({ totalCents: 11000, creditAppliedCents: 11000 });
    expect(await creditBalance(db, cust)).toBe(390);
    // Made bigger again: the extra is due.
    await updateStaffOrder(db, so.id, { ...base, lines: [{ productId: cups, qty: 2, unitPriceCents: 10000 }] }, today);
    expect(await get(so.id)).toMatchObject({ totalCents: 22000, creditAppliedCents: 11000, paymentStatus: "unpaid" });
  });

  it("applies credit to an existing unpaid order", async () => {
    const so = await order(1);
    await db.transaction(async (tx) => applyCreditToOrder(tx as unknown as DB, so.id, 5000, staff));
    expect(await get(so.id)).toMatchObject({ creditAppliedCents: 5000, paymentStatus: "unpaid" });
    expect(await creditBalance(db, cust)).toBe(340);
  });
});

describe("customer returns", () => {
  async function deliveredOrder(qty: number, paid = false) {
    const so = await order(qty);
    await db.update(orders).set({ status: "delivered" }).where(eq(orders.id, so.deliveryOrderId!));
    if (paid) await db.update(salesOrders).set({ paymentStatus: "paid", paidAt: new Date() }).where(eq(salesOrders.id, so.id));
    const [line] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, so.id));
    return { so, line };
  }

  it("turns returned goods into store credit, restocking only what's sellable", async () => {
    const { so, line } = await deliveredOrder(5);
    const start = await creditBalance(db, cust);
    const stock0 = (await db.select().from(products).where(eq(products.id, cups)))[0].stock;
    const r = await createCustomerReturn(db, staff, { salesOrderId: so.id, reason: "ordered_by_mistake", resolution: "credit", notes: null, lines: [{ salesOrderItemId: line.id, qty: 3 }] });
    expect(r).toMatchObject({ status: "requested", subtotal: 300, gst: 30, total: 330 });
    expect(r.returnNumber).toMatch(/^CR-\d+$/);
    // Submitting doesn't add stock or credit.
    expect((await db.select().from(products).where(eq(products.id, cups)))[0].stock).toBe(stock0);
    await expect(completeCustomerReturn(db, staff, r.id)).rejects.toThrow(/Check the goods in/);

    const [item] = await db.select().from(customerReturnItems).where(eq(customerReturnItems.customerReturnId, r.id));
    // All 3 came back fine and go back on the shelf.
    await receiveCustomerReturn(db, staff, r.id, [{ id: item.id, receivedQty: 3, condition: "restock" }]);
    expect((await db.select().from(products).where(eq(products.id, cups)))[0].stock).toBe(stock0 + 3);
    const [m] = await db.select().from(inventoryMovements).where(eq(inventoryMovements.referenceNumber, r.returnNumber));
    expect(m).toMatchObject({ movementType: "customer_return", qty: 3 });

    await completeCustomerReturn(db, staff, r.id);
    expect(await creditBalance(db, cust)).toBe(start + 330);
    expect((await history()).slice(-1)[0]).toMatchObject({ transactionType: "return_credit", amount: 330, sourceType: "customer_return", sourceNumber: r.returnNumber });
    expect((await returnableOrderLines(db, so.id))[0].returnable).toBe(2);
  });

  it("doesn't restock damaged goods", async () => {
    const { so, line } = await deliveredOrder(2);
    const stock0 = (await db.select().from(products).where(eq(products.id, cups)))[0].stock;
    const r = await createCustomerReturn(db, staff, { salesOrderId: so.id, reason: "damaged", resolution: "credit", notes: null, lines: [{ salesOrderItemId: line.id, qty: 2 }] });
    const [item] = await db.select().from(customerReturnItems).where(eq(customerReturnItems.customerReturnId, r.id));
    await receiveCustomerReturn(db, staff, r.id, [{ id: item.id, receivedQty: 2, condition: "write_off" }]);
    expect((await db.select().from(products).where(eq(products.id, cups)))[0].stock).toBe(stock0);
  });

  it("refunds only paid orders, and only what was bought", async () => {
    const unpaid = await deliveredOrder(1);
    await expect(createCustomerReturn(db, staff, { salesOrderId: unpaid.so.id, reason: "no_longer_needed", resolution: "refund", notes: null, lines: [{ salesOrderItemId: unpaid.line.id, qty: 1 }] })).rejects.toThrow(/hasn't been paid/);
    const { so, line } = await deliveredOrder(2, true);
    await expect(createCustomerReturn(db, staff, { salesOrderId: so.id, reason: "no_longer_needed", resolution: "refund", notes: null, lines: [{ salesOrderItemId: line.id, qty: 3 }] })).rejects.toThrow(/only 2/);
    const r = await createCustomerReturn(db, staff, { salesOrderId: so.id, reason: "no_longer_needed", resolution: "refund", notes: null, lines: [{ salesOrderItemId: line.id, qty: 1 }] });
    const [item] = await db.select().from(customerReturnItems).where(eq(customerReturnItems.customerReturnId, r.id));
    await receiveCustomerReturn(db, staff, r.id, [{ id: item.id, receivedQty: 1, condition: "restock" }]);
    const before = await creditBalance(db, cust);
    await expect(completeCustomerReturn(db, staff, r.id)).rejects.toThrow(/how the money/);
    await completeCustomerReturn(db, staff, r.id, { method: "bank_transfer", reference: "EFT 123" });
    expect(await creditBalance(db, cust)).toBe(before); // a refund isn't credit
    const done = (await db.select().from(salesOrders).where(eq(salesOrders.id, so.id)))[0];
    expect(done.status).toBe("confirmed");
  });

  it("won't take returns before delivery, and cancels cleanly", async () => {
    const so = await order(1);
    const [line] = await db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, so.id));
    await expect(createCustomerReturn(db, staff, { salesOrderId: so.id, reason: "other", resolution: "credit", notes: null, lines: [{ salesOrderItemId: line.id, qty: 1 }] })).rejects.toThrow(/delivered orders/);
    const d = await deliveredOrder(1);
    const r = await createCustomerReturn(db, staff, { salesOrderId: d.so.id, reason: "other", resolution: "exchange", notes: null, lines: [{ salesOrderItemId: d.line.id, qty: 1 }] });
    await cancelCustomerReturn(db, r.id);
    expect((await returnableOrderLines(db, d.so.id))[0].returnable).toBe(1);
  });
});

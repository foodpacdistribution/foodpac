import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "./db";
import { schema } from "./db";
import { customers, orders, products, salesOrderItems, salesOrders, users } from "./db/schema";
import { cancelOrder } from "./shop";
import { createStaffOrder, editBlocker, updateStaffOrder } from "./staff-orders";
import { fillWaiting, listWaiting } from "./stock-allocation";

let db: DB;
let cust: string;
let staff: string;
let cups: string;
let lids: string;
const today = "2026-11-10";
let key = 0;

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  [{ id: staff }] = await db.insert(users).values({ email: "office@x.test", name: "Office", role: "admin", passwordHash: "x" }).returning({ id: users.id });
  [{ id: cust }] = await db.insert(customers).values({ name: "Lucky Noodle Bar", paymentTerms: "net14" }).returning({ id: customers.id });
  [{ id: cups }] = await db.insert(products).values({ sku: "CUP8", name: "Cup 8 oz", priceCents: 4000, stock: 5 }).returning({ id: products.id });
  [{ id: lids }] = await db.insert(products).values({ sku: "LID8", name: "Lid 8 oz", priceCents: 2000, stock: 10, gst: false }).returning({ id: products.id });
}, 30000);

const stock = async (id: string) => (await db.select({ s: products.stock }).from(products).where(eq(products.id, id)))[0].s;
const lines = async (orderId: string) => db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, orderId));
const base = { customerId: "", deliveryDate: "2026-11-12", recipient: "Mei", phone: null, address: "1 Main St, Sunnybank", instructions: null, windowStartMin: null, windowEndMin: null, notes: null, deliveryFeeCents: 1500 };
const place = (l: { productId: string; qty: number; unitPriceCents: number }[]) =>
  createStaffOrder(db, staff, { ...base, customerId: cust, lines: l, method: "invoice", idempotencyKey: `k${++key}` }, today);

describe("orders staff enter", () => {
  it("reserves what's in stock and keeps the rest waiting", async () => {
    const so = await place([{ productId: cups, qty: 8, unitPriceCents: 3600 }]);
    expect(await stock(cups)).toBe(0);
    const [l] = await lines(so.id);
    expect(l).toMatchObject({ qty: 8, backorderQty: 3, unitPriceCents: 3600, lineCents: 28800 });
    // Confirmed, on account, due 14 days after delivery, with a delivery for the planner.
    expect(so).toMatchObject({ status: "confirmed", paymentMethod: "invoice", dueDate: "2026-11-26", subtotalCents: 28800, deliveryFeeCents: 1500, gstCents: 3030 });
    const [d] = await db.select().from(orders).where(eq(orders.id, so.deliveryOrderId!));
    expect(d).toMatchObject({ customerId: cust, deliveryDate: "2026-11-12", demand: 8, source: "shop" });
  });

  it("gives goods received to waiting orders, oldest first", async () => {
    const second = await place([{ productId: cups, qty: 2, unitPriceCents: 4000 }]);
    expect((await lines(second.id))[0].backorderQty).toBe(2);
    const waiting = await listWaiting(db, [cups]);
    expect(waiting.map((w) => w.qty)).toEqual([3, 2]);

    await db.update(products).set({ stock: 4 }).where(eq(products.id, cups));
    const filled = await fillWaiting(db, [cups]);
    expect(filled.map((f) => f.qty)).toEqual([3, 1]);
    expect(await stock(cups)).toBe(0);
    expect((await listWaiting(db, [cups])).map((w) => w.qty)).toEqual([1]);
  });

  it("follows quantity changes: less clears waiting first, more takes stock or waits", async () => {
    const [w] = await listWaiting(db, [cups]); // the second order: 2 ordered, 1 waiting
    // Down to 1: the waiting unit goes, the reserved one stays.
    await updateStaffOrder(db, w.orderId, { ...base, lines: [{ productId: cups, qty: 1, unitPriceCents: 4000 }] }, today);
    expect((await lines(w.orderId))[0]).toMatchObject({ qty: 1, backorderQty: 0 });
    expect(await stock(cups)).toBe(0);

    // Add lids (in stock) and change the price; totals follow (lids are GST free).
    await updateStaffOrder(db, w.orderId, { ...base, deliveryFeeCents: 0, lines: [{ productId: cups, qty: 1, unitPriceCents: 3800 }, { productId: lids, qty: 4, unitPriceCents: 2000 }] }, today);
    expect(await stock(lids)).toBe(6);
    const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, w.orderId));
    expect(so).toMatchObject({ subtotalCents: 11800, deliveryFeeCents: 0, gstCents: 380, totalCents: 12180 });

    // Removing a line puts its stock back.
    await updateStaffOrder(db, w.orderId, { ...base, lines: [{ productId: cups, qty: 1, unitPriceCents: 3800 }] }, today);
    expect(await stock(lids)).toBe(10);
  });

  it("moves the delivery when the date changes", async () => {
    const [w] = await db.select().from(salesOrders).orderBy(salesOrders.createdAt).limit(1);
    await updateStaffOrder(db, w.id, { ...base, deliveryDate: "2026-11-14", lines: [{ productId: cups, qty: 8, unitPriceCents: 3600 }] }, today);
    const [d] = await db.select().from(orders).where(eq(orders.id, w.deliveryOrderId!));
    expect(d.deliveryDate).toBe("2026-11-14");
    await expect(updateStaffOrder(db, w.id, { ...base, deliveryDate: "2026-11-01", lines: [{ productId: cups, qty: 8, unitPriceCents: 3600 }] }, today)).rejects.toThrow(/past/);
  });

  it("returns only reserved stock on cancel, and hands it to whoever is waiting", async () => {
    const waiter = await place([{ productId: cups, qty: 3, unitPriceCents: 4000 }]); // all 3 wait
    expect((await lines(waiter.id))[0].backorderQty).toBe(3);
    const [first] = await db.select().from(salesOrders).orderBy(salesOrders.createdAt).limit(1); // 8 cups, all reserved
    await cancelOrder(db, first.id);
    // 8 back on the shelf, 3 go straight to the waiting order.
    expect((await lines(waiter.id))[0].backorderQty).toBe(0);
    expect(await stock(cups)).toBe(5);
  });

  it("won't change card, cancelled or dispatched orders", () => {
    expect(editBlocker({ status: "confirmed", paymentMethod: "card", fulfilment: "new", invoiceStatus: "proforma" }, null)).toMatch(/Card/);
    expect(editBlocker({ status: "cancelled", paymentMethod: "invoice", fulfilment: "new", invoiceStatus: "proforma" }, null)).toMatch(/cancelled/);
    expect(editBlocker({ status: "confirmed", paymentMethod: "invoice", fulfilment: "new", invoiceStatus: "proforma" }, "dispatched")).toMatch(/out for delivery/);
    expect(editBlocker({ status: "confirmed", paymentMethod: "invoice", fulfilment: "packed", invoiceStatus: "proforma" }, "planned")).toBeNull();
    expect(editBlocker({ status: "confirmed", paymentMethod: "invoice", fulfilment: "new", invoiceStatus: "final" }, null)).toMatch(/final/);
  });
});

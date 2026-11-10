import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "./db";
import { schema } from "./db";
import { customers, orders, products, salesOrderItems, salesOrders, users } from "./db/schema";
import { cancelOrder } from "./shop";
import { createStaffOrder, editBlocker, followDeliveryDate, missedDelivery, moveSalesToDay, updateStaffOrder } from "./staff-orders";
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
    expect(editBlocker({ status: "confirmed", paymentMethod: "invoice", fulfilment: "loaded", invoiceStatus: "proforma" }, "dispatched")).toMatch(/loaded|out for delivery/);
    // A failed drop came back on the van: it can be changed and sent again.
    expect(editBlocker({ status: "confirmed", paymentMethod: "invoice", fulfilment: "loaded", invoiceStatus: "proforma" }, "failed")).toBeNull();
  });
});

describe("missed delivery days", () => {
  const missedIds = async () => (await db.select({ id: salesOrders.id }).from(salesOrders).where(missedDelivery(today))).map((r) => r.id);
  /** An order placed for a day that has since passed (staff can't enter a past date, so it's moved back). */
  const pastOrder = async (day: string, deliveryStatus: "pending" | "dispatched" | "failed" | "delivered") => {
    const so = await place([{ productId: lids, qty: 1, unitPriceCents: 2000 }]);
    await db.update(salesOrders).set({ deliveryDate: day, fulfilment: deliveryStatus === "pending" ? "new" : "loaded" }).where(eq(salesOrders.id, so.id));
    await db.update(orders).set({ deliveryDate: day, status: deliveryStatus }).where(eq(orders.id, so.deliveryOrderId!));
    return so;
  };

  it("lists confirmed orders whose day passed without a delivery", async () => {
    const notPlanned = await pastOrder("2026-11-09", "pending");
    const failed = await pastOrder("2026-11-09", "failed");
    const delivered = await pastOrder("2026-11-09", "delivered");
    const ancient = await pastOrder("2026-08-01", "pending");
    const ids = await missedIds();
    expect(ids).toEqual(expect.arrayContaining([notPlanned.id, failed.id]));
    expect(ids).not.toContain(delivered.id);
    expect(ids).not.toContain(ancient.id); // older than the look-back
  });

  it("moves a missed order, delivery and all, back into the planner's queue", async () => {
    const so = await pastOrder("2026-11-09", "failed");
    const res = await moveSalesToDay(db, [so.id], "2026-11-12", today);
    expect(res).toMatchObject({ moved: 1, skipped: [] });
    const [after] = await db.select().from(salesOrders).where(eq(salesOrders.id, so.id));
    expect(after).toMatchObject({ deliveryDate: "2026-11-12", dueDate: "2026-11-26", fulfilment: "packed" });
    const [d] = await db.select().from(orders).where(eq(orders.id, so.deliveryOrderId!));
    expect(d).toMatchObject({ deliveryDate: "2026-11-12", status: "pending", driverId: null });
    expect(await missedIds()).not.toContain(so.id);
  });

  it("leaves delivered orders, vans out today and past dates alone", async () => {
    const delivered = await pastOrder("2026-11-09", "delivered");
    const outToday = await place([{ productId: lids, qty: 1, unitPriceCents: 2000 }]);
    await db.update(orders).set({ deliveryDate: today, status: "dispatched" }).where(eq(orders.id, outToday.deliveryOrderId!));
    const res = await moveSalesToDay(db, [delivered.id, outToday.id], "2026-11-12", today);
    expect(res.moved).toBe(0);
    expect(res.skipped).toEqual(expect.arrayContaining([delivered.number, outToday.number]));
    await expect(moveSalesToDay(db, [outToday.id], "2026-11-01", today)).rejects.toThrow(/past/);
  });

  it("gives a missed order with no delivery a new one", async () => {
    const so = await pastOrder("2026-11-09", "pending");
    await db.update(salesOrders).set({ deliveryOrderId: null }).where(eq(salesOrders.id, so.id));
    await db.delete(orders).where(eq(orders.id, so.deliveryOrderId!));
    const res = await moveSalesToDay(db, [so.id], "2026-11-13", today);
    expect(res.created).toHaveLength(1);
    const [d] = await db.select().from(orders).where(eq(orders.id, res.created[0]));
    expect(d).toMatchObject({ deliveryDate: "2026-11-13", orderNumber: so.number });
  });

  it("keeps the shop order's day in step when its delivery is moved", async () => {
    const so = await place([{ productId: lids, qty: 1, unitPriceCents: 2000 }]);
    await db.update(orders).set({ deliveryDate: "2026-11-16" }).where(eq(orders.id, so.deliveryOrderId!));
    await followDeliveryDate(db, so.deliveryOrderId!, "2026-11-16");
    const [after] = await db.select().from(salesOrders).where(eq(salesOrders.id, so.id));
    expect(after).toMatchObject({ deliveryDate: "2026-11-16", dueDate: "2026-11-30" });
  });
});

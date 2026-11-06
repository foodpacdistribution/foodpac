import { PGlite } from "@electric-sql/pglite";
import { asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "../db";
import { schema } from "../db";
import { customers, goodsReceiptItems, inventoryMovements, products, purchaseOrders, purchaseReturnItems, purchaseReturns, salesOrderItems, users } from "../db/schema";
import { createStaffOrder } from "../staff-orders";
import { changeStock } from "../stock-ledger";
import { lineTotal, purchaseTotals, returnValue } from "./labels";
import { createPurchaseOrder, saveSupplier, setPurchaseOrderStatus, updatePurchaseOrder } from "./orders";
import { recordPayment } from "./payments";
import { postReceipt, startReceiptForPo, startReplacementReceipt, updateReceipt } from "./receipts";
import { cancelReturn, createReturn, dispatchReturn, recordRefund, recordSupplierResponse, responseStatus, returnableLines } from "./returns";

let db: DB;
let staff: string;
let supplier: string;
let cups: string;
let lids: string;

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  [{ id: staff }] = await db.insert(users).values({ email: "buyer@x.test", name: "Buyer", role: "admin", passwordHash: "x" }).returning({ id: users.id });
  supplier = (await saveSupplier(db, null, { name: "Pack Co", contactName: "Sam", email: "orders@packco.test", phone: null, address: null, abn: null, notes: null, active: true })).id;
  [{ id: cups }] = await db.insert(products).values({ sku: "CUP8", name: "Cup 8 oz", priceCents: 4000, stock: 0 }).returning({ id: products.id });
  [{ id: lids }] = await db.insert(products).values({ sku: "LID8", name: "Lid 8 oz", priceCents: 2000, stock: 0, gst: false }).returning({ id: products.id });
}, 30000);

/** The database's own refusal (Drizzle wraps it as the `cause`). */
const dbRefusal = async (q: PromiseLike<unknown>) => {
  try {
    await q;
  } catch (e) {
    return String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message);
  }
  return "no error";
};
const stock = async (id: string) => (await db.select({ s: products.stock }).from(products).where(eq(products.id, id)))[0].s;
const ledger = (id: string) => db.select().from(inventoryMovements).where(eq(inventoryMovements.productId, id)).orderBy(asc(inventoryMovements.createdAt));

/** Orders `qty` cups (and 50 lids) from the supplier and books it all into stock. */
async function buyAndReceive(qty: number) {
  const po = await createPurchaseOrder(db, staff, { supplierId: supplier, orderDate: "2026-11-01", expectedDate: null, supplierReference: null, notes: null, lines: [{ productId: cups, qty, unitCost: 0.5 }, { productId: lids, qty: 50, unitCost: 0.1234 }] });
  await setPurchaseOrderStatus(db, po.id, "confirm");
  const grn = await startReceiptForPo(db, staff, po.id, "2026-11-03");
  await postReceipt(db, staff, grn.id);
  const [cupLine] = await db.select().from(goodsReceiptItems).where(eq(goodsReceiptItems.goodsReceiptId, grn.id)).orderBy(asc(goodsReceiptItems.sku));
  return { po, grn, cupLine };
}

describe("money", () => {
  it("adds up to the cent with GST only on taxable lines", () => {
    expect(lineTotal(50, 0.1234)).toBe(6.17);
    expect(purchaseTotals([{ lineTotal: 50, gst: true }, { lineTotal: 6.17, gst: false }])).toEqual({ subtotal: 56.17, gst: 5, total: 61.17 });
    expect(returnValue([{ qty: 8, unitCost: 0.5, gst: true }])).toBe(4.4);
  });

  it("works out the supplier's answer", () => {
    expect(responseStatus([{ requestedQty: 10, acceptedQty: 10 }])).toBe("accepted");
    expect(responseStatus([{ requestedQty: 10, acceptedQty: 8 }])).toBe("partially_accepted");
    expect(responseStatus([{ requestedQty: 10, acceptedQty: 0 }])).toBe("rejected");
  });
});

describe("purchase orders and goods receipts", () => {
  it("puts goods in stock only when the receipt is posted, and logs it", async () => {
    const po = await createPurchaseOrder(db, staff, { supplierId: supplier, orderDate: "2026-11-01", expectedDate: "2026-11-04", supplierReference: null, notes: null, lines: [{ productId: cups, qty: 100, unitCost: 0.5 }] });
    expect(po).toMatchObject({ status: "draft", subtotal: 50, gst: 5, total: 55 });
    expect(po.poNumber).toMatch(/^PO-\d+$/);
    await expect(startReceiptForPo(db, staff, po.id, "2026-11-03")).rejects.toThrow(/sent to or confirmed/);
    await setPurchaseOrderStatus(db, po.id, "send");
    await setPurchaseOrderStatus(db, po.id, "confirm");

    const grn = await startReceiptForPo(db, staff, po.id, "2026-11-03");
    expect(await stock(cups)).toBe(0); // checking, not in stock yet
    const [line] = await db.select().from(goodsReceiptItems).where(eq(goodsReceiptItems.goodsReceiptId, grn.id));
    await updateReceipt(db, grn.id, { receiptDate: "2026-11-03", deliveryReference: "DN-1", notes: null, lines: [{ id: line.id, receivedQty: 60, notes: null }] });
    await postReceipt(db, staff, grn.id);
    expect(await stock(cups)).toBe(60);
    expect((await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)))[0].status).toBe("partially_received");
    const [m] = (await ledger(cups)).slice(-1);
    expect(m).toMatchObject({ movementType: "purchase_receipt", qty: 60, balanceAfter: 60, referenceNumber: grn.grnNumber, createdBy: staff });

    // A posted receipt is locked, in the database too.
    await expect(updateReceipt(db, grn.id, { receiptDate: "2026-11-03", deliveryReference: null, notes: null, lines: [] })).rejects.toThrow(/in stock already/);
    expect(await dbRefusal(db.update(goodsReceiptItems).set({ receivedQty: 99 }).where(eq(goodsReceiptItems.id, line.id)))).toMatch(/can't be changed/);
    // Lines are locked once goods arrive.
    await expect(updatePurchaseOrder(db, po.id, { supplierId: supplier, orderDate: "2026-11-01", expectedDate: null, supplierReference: null, notes: null, lines: [{ productId: cups, qty: 5, unitCost: 1 }] })).rejects.toThrow(/booked in/);

    // The rest arrives; can't receive more than ordered.
    const second = await startReceiptForPo(db, staff, po.id, "2026-11-05");
    const [l2] = await db.select().from(goodsReceiptItems).where(eq(goodsReceiptItems.goodsReceiptId, second.id));
    expect(l2.receivedQty).toBe(40);
    await updateReceipt(db, second.id, { receiptDate: "2026-11-05", deliveryReference: null, notes: null, lines: [{ id: l2.id, receivedQty: 41, notes: null }] });
    await expect(postReceipt(db, staff, second.id)).rejects.toThrow(/still to come/);
    await updateReceipt(db, second.id, { receiptDate: "2026-11-05", deliveryReference: null, notes: null, lines: [{ id: l2.id, receivedQty: 40, notes: null }] });
    await postReceipt(db, staff, second.id);
    expect(await stock(cups)).toBe(100);
    expect((await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)))[0].status).toBe("received");
  });

  it("hands received goods to customers waiting for them", async () => {
    const [{ id: cust }] = await db.insert(customers).values({ name: "Lucky Noodle Bar" }).returning({ id: customers.id });
    await db.update(products).set({ stock: 0 }).where(eq(products.id, lids)); // logged as 'other'
    const so = await createStaffOrder(db, staff, { customerId: cust, deliveryDate: "2026-11-20", recipient: "Mei", phone: null, address: "1 Main St", instructions: null, windowStartMin: null, windowEndMin: null, notes: null, deliveryFeeCents: 0, lines: [{ productId: lids, qty: 7, unitPriceCents: 2000 }], method: "invoice", idempotencyKey: "wait-1" }, "2026-11-10");
    expect((await db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, so.id)))[0].backorderQty).toBe(7);
    await buyAndReceive(10); // brings 50 lids
    expect((await db.select().from(salesOrderItems).where(eq(salesOrderItems.salesOrderId, so.id)))[0].backorderQty).toBe(0);
    expect(await stock(lids)).toBe(43);
    const last = (await ledger(lids)).slice(-2).map((m) => [m.movementType, m.qty, m.balanceAfter, m.referenceNumber]);
    expect(last).toEqual([
      ["purchase_receipt", 50, 50, expect.stringMatching(/^GRN-/)],
      ["sale_reserved", -7, 43, so.number],
    ]);
  });
});

describe("purchase returns (we send goods back to the supplier)", () => {
  it("follows the spec: 100 bought, 10 asked, 8 accepted, 8 sent back → 92", async () => {
    await db.update(products).set({ stock: 0 }).where(eq(products.id, cups));
    const { grn, cupLine } = await buyAndReceive(100);
    expect(await stock(cups)).toBe(100);

    // 1. Asking for a return doesn't touch stock.
    const r = await createReturn(db, staff, { goodsReceiptId: grn.id, returnDate: "2026-11-06", returnReason: "Crushed cartons", notes: null, lines: [{ goodsReceiptItemId: cupLine.id, qty: 10, reason: "Crushed" }], photos: [{ mime: "image/jpeg", data: new Uint8Array([1, 2, 3]) }] });
    expect(r).toMatchObject({ status: "open", supplierStatus: "pending" });
    expect(await stock(cups)).toBe(100);
    // Can't send back before the supplier says yes.
    await expect(dispatchReturn(db, staff, r.id, [])).rejects.toThrow(/acceptance/);

    // 2. Supplier accepts 8 of 10: still no stock change.
    const [item] = await db.select().from(purchaseReturnItems).where(eq(purchaseReturnItems.purchaseReturnId, r.id));
    await expect(recordSupplierResponse(db, staff, r.id, { lines: [{ id: item.id, acceptedQty: 11 }], response: null, resolution: "refund" })).rejects.toThrow(/more than/);
    const answered = await recordSupplierResponse(db, staff, r.id, { lines: [{ id: item.id, acceptedQty: 8 }], response: "8 OK, 2 are fine", resolution: "refund" });
    expect(answered).toMatchObject({ supplierStatus: "partially_accepted", approvedBy: staff });
    expect(await stock(cups)).toBe(100);

    // 3. Only the accepted 8 can go out.
    await expect(dispatchReturn(db, staff, r.id, [{ id: item.id, qty: 10 }])).rejects.toThrow(/only the 8/);
    await dispatchReturn(db, staff, r.id, [{ id: item.id, qty: 8 }]);
    expect(await stock(cups)).toBe(92);
    const [m] = (await ledger(cups)).slice(-1);
    expect(m).toMatchObject({ movementType: "purchase_return", qty: -8, balanceAfter: 92, referenceNumber: r.returnNumber, createdBy: staff });

    // Accepted isn't refunded: the refund is its own record, capped at what went back (8 × $0.50 + GST).
    expect((await db.select().from(purchaseReturns).where(eq(purchaseReturns.id, r.id)))[0]).toMatchObject({ status: "dispatched", refundAmount: 0 });
    await expect(recordRefund(db, staff, r.id, { refundDate: "2026-11-08", amount: 5, method: "bank_transfer", reference: null, notes: null })).rejects.toThrow(/4.40/);
    const part = await recordRefund(db, staff, r.id, { refundDate: "2026-11-08", amount: 2.2, method: "bank_transfer", reference: "RF1", notes: null });
    expect(part.closed).toBe(false);
    const rest = await recordRefund(db, staff, r.id, { refundDate: "2026-11-09", amount: 2.2, method: "bank_transfer", reference: "RF2", notes: null });
    expect(rest.closed).toBe(true);
    expect((await db.select().from(purchaseReturns).where(eq(purchaseReturns.id, r.id)))[0]).toMatchObject({ status: "closed", refundAmount: 4.4 });

    // 8 of the 100 are gone back; 92 more could still be returned from this receipt.
    expect((await returnableLines(db, grn.id)).find((l) => l.id === cupLine.id)?.returnable).toBe(92);
  });

  it("keeps stock when the supplier rejects", async () => {
    const { grn, cupLine } = await buyAndReceive(20);
    const before = await stock(cups);
    const r = await createReturn(db, staff, { goodsReceiptId: grn.id, returnDate: "2026-11-06", returnReason: "Wrong colour", notes: null, lines: [{ goodsReceiptItemId: cupLine.id, qty: 5, reason: null }], photos: [] });
    const [item] = await db.select().from(purchaseReturnItems).where(eq(purchaseReturnItems.purchaseReturnId, r.id));
    const answered = await recordSupplierResponse(db, staff, r.id, { lines: [{ id: item.id, acceptedQty: 0 }], response: "Not faulty", resolution: null });
    expect(answered).toMatchObject({ supplierStatus: "rejected", status: "closed" });
    expect(await stock(cups)).toBe(before);
    await expect(dispatchReturn(db, staff, r.id, [])).rejects.toThrow();
    // Rejected goods are free to be asked about again.
    expect((await returnableLines(db, grn.id)).find((l) => l.id === cupLine.id)?.returnable).toBe(20);
  });

  it("won't let two requests claim more than was received", async () => {
    const { grn, cupLine } = await buyAndReceive(10);
    const a = await createReturn(db, staff, { goodsReceiptId: grn.id, returnDate: "2026-11-06", returnReason: "Damaged", notes: null, lines: [{ goodsReceiptItemId: cupLine.id, qty: 7, reason: null }], photos: [] });
    await expect(createReturn(db, staff, { goodsReceiptId: grn.id, returnDate: "2026-11-06", returnReason: "Damaged", notes: null, lines: [{ goodsReceiptItemId: cupLine.id, qty: 4, reason: null }], photos: [] })).rejects.toThrow(/only 3/);
    await cancelReturn(db, a.id);
    expect((await returnableLines(db, grn.id)).find((l) => l.id === cupLine.id)?.returnable).toBe(10);
  });

  it("exchanges: replacements come back in on a goods receipt and close the return", async () => {
    const { grn, cupLine } = await buyAndReceive(30);
    const start = await stock(cups);
    const r = await createReturn(db, staff, { goodsReceiptId: grn.id, returnDate: "2026-11-06", returnReason: "Leaking", notes: null, lines: [{ goodsReceiptItemId: cupLine.id, qty: 6, reason: null }], photos: [] });
    const [item] = await db.select().from(purchaseReturnItems).where(eq(purchaseReturnItems.purchaseReturnId, r.id));
    await recordSupplierResponse(db, staff, r.id, { lines: [{ id: item.id, acceptedQty: 6 }], response: null, resolution: "exchange" });
    await dispatchReturn(db, staff, r.id, []);
    expect(await stock(cups)).toBe(start - 6);
    const repl = await startReplacementReceipt(db, staff, r.id, "2026-11-10");
    await postReceipt(db, staff, repl.id);
    expect(await stock(cups)).toBe(start);
    expect((await db.select().from(purchaseReturns).where(eq(purchaseReturns.id, r.id)))[0].status).toBe("closed");
    expect((await db.select().from(purchaseReturnItems).where(eq(purchaseReturnItems.id, item.id)))[0].replacedQty).toBe(6);
  });

  it("won't send back stock that's reserved for customer orders", async () => {
    const { grn, cupLine } = await buyAndReceive(5);
    const r = await createReturn(db, staff, { goodsReceiptId: grn.id, returnDate: "2026-11-06", returnReason: "Damaged", notes: null, lines: [{ goodsReceiptItemId: cupLine.id, qty: 5, reason: null }], photos: [] });
    const [item] = await db.select().from(purchaseReturnItems).where(eq(purchaseReturnItems.purchaseReturnId, r.id));
    await recordSupplierResponse(db, staff, r.id, { lines: [{ id: item.id, acceptedQty: 5 }], response: null, resolution: "refund" });
    // Everything but 2 is taken by customers.
    await changeStock(db, cups, -((await stock(cups)) - 2), { type: "adjustment", note: "test" });
    await expect(dispatchReturn(db, staff, r.id, [])).rejects.toThrow(/Not enough free stock of CUP8 to send back: 2 free, 5 to go/);
    expect(await stock(cups)).toBe(2);
    // The failed dispatch rolled back completely.
    expect((await db.select().from(purchaseReturns).where(eq(purchaseReturns.id, r.id)))[0].status).toBe("open");
  });
});

describe("database protections", () => {
  it("refuses to dispatch more than accepted, even bypassing the app", async () => {
    const { grn, cupLine } = await buyAndReceive(10);
    const r = await createReturn(db, staff, { goodsReceiptId: grn.id, returnDate: "2026-11-06", returnReason: "x", notes: null, lines: [{ goodsReceiptItemId: cupLine.id, qty: 4, reason: null }], photos: [] });
    const [item] = await db.select().from(purchaseReturnItems).where(eq(purchaseReturnItems.purchaseReturnId, r.id));
    // No answer yet: nothing may go out.
    await expect(db.update(purchaseReturnItems).set({ dispatchedQty: 1 }).where(eq(purchaseReturnItems.id, item.id))).rejects.toThrow();
    await recordSupplierResponse(db, staff, r.id, { lines: [{ id: item.id, acceptedQty: 3 }], response: null, resolution: "refund" });
    await db.update(purchaseReturns).set({ status: "dispatched" }).where(eq(purchaseReturns.id, r.id));
    await expect(db.update(purchaseReturnItems).set({ dispatchedQty: 4 }).where(eq(purchaseReturnItems.id, item.id))).rejects.toThrow(); // CHECK: dispatched ≤ accepted
    expect(await dbRefusal(db.insert(purchaseReturnItems).values({ ...item, id: undefined, dispatchedQty: 1, acceptedQty: 1 }))).toMatch(/starts with nothing/);
  });

  it("keeps the stock ledger append-only and in step with stock", async () => {
    const [m] = await ledger(cups);
    expect(await dbRefusal(db.update(inventoryMovements).set({ qty: 1 }).where(eq(inventoryMovements.id, m.id)))).toMatch(/can't be changed or deleted/);
    expect(await dbRefusal(db.delete(inventoryMovements).where(eq(inventoryMovements.id, m.id)))).toMatch(/can't be changed or deleted/);
    for (const id of [cups, lids]) {
      const [{ sum }] = await db.select({ sum: sql<number>`coalesce(sum(${inventoryMovements.qty}), 0)::float8` }).from(inventoryMovements).where(eq(inventoryMovements.productId, id));
      expect(Number(sum)).toBe(await stock(id));
    }
  });

  it("caps supplier payments at the order total (no credit)", async () => {
    const po = await createPurchaseOrder(db, staff, { supplierId: supplier, orderDate: "2026-11-01", expectedDate: null, supplierReference: null, notes: null, lines: [{ productId: cups, qty: 10, unitCost: 2 }] });
    await expect(recordPayment(db, staff, { purchaseOrderId: po.id, paymentDate: "2026-11-01", amount: 5, method: "bank_transfer", reference: null, notes: null })).rejects.toThrow(/gone to the supplier/);
    await setPurchaseOrderStatus(db, po.id, "send");
    await recordPayment(db, staff, { purchaseOrderId: po.id, paymentDate: "2026-11-01", amount: 20, method: "bank_transfer", reference: null, notes: null });
    await expect(recordPayment(db, staff, { purchaseOrderId: po.id, paymentDate: "2026-11-02", amount: 2.01, method: "bank_transfer", reference: null, notes: null })).rejects.toThrow(/2.00 left/);
    await expect(setPurchaseOrderStatus(db, po.id, "cancel")).rejects.toThrow(/Payments/);
  });
});

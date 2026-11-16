import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { productCosts, profitOf } from "./costs";
import { type DB, schema } from "./db";
import { goodsReceiptItems, goodsReceipts, products, purchaseOrderItems, purchaseOrders, suppliers } from "./db/schema";

vi.mock("server-only", () => ({}));

const TODAY = "2026-11-16";
let db: DB;
const ids: Record<string, string> = {};

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  const ps = await db
    .insert(products)
    .values([
      { sku: "RECEIVED", name: "Received", priceCents: 1000, costCents: 100 },
      { sku: "OLD", name: "Only received long ago", priceCents: 1000 },
      { sku: "MANUAL", name: "Manual cost", priceCents: 1000, costCents: 650 },
      { sku: "ORDERED", name: "Ordered only", priceCents: 1000 },
      { sku: "NONE", name: "No cost", priceCents: 1000 },
    ])
    .returning();
  for (const p of ps) ids[p.sku] = p.id;
  const [s] = await db.insert(suppliers).values({ name: "Supplier" }).returning();
  const [po] = await db.insert(purchaseOrders).values({ poNumber: "PO-1", supplierId: s.id, status: "received", orderDate: "2026-01-01" }).returning();
  const [draft] = await db.insert(purchaseOrders).values({ poNumber: "PO-2", supplierId: s.id, status: "draft", orderDate: "2026-11-01" }).returning();
  const line = (poId: string, sku: string, unitCost: number) => ({ purchaseOrderId: poId, productId: ids[sku], sku, name: sku, unit: "carton", orderedQty: 10, unitCost, gst: true, lineTotal: unitCost * 10 });
  await db.insert(purchaseOrderItems).values([line(po.id, "ORDERED", 7.25), line(po.id, "RECEIVED", 1), line(draft.id, "ORDERED", 1)]);
  const receipt = async (n: string, date: string, items: [string, number, number][]) => {
    const [gr] = await db.insert(goodsReceipts).values({ grnNumber: n, purchaseOrderId: po.id, supplierId: s.id, receiptDate: date }).returning();
    await db.insert(goodsReceiptItems).values(items.map(([sku, qty, unitCost]) => ({ goodsReceiptId: gr.id, productId: ids[sku], sku, name: sku, unit: "carton", receivedQty: qty, unitCost, gst: true })));
    await db.update(goodsReceipts).set({ status: "posted" }).where(eq(goodsReceipts.id, gr.id));
  };
  // This year: 10 at $5 and 30 at $6 → $5.75 average. Last year's $9 no longer counts.
  await receipt("GR-1", "2025-06-01", [["RECEIVED", 100, 9], ["OLD", 4, 3]]);
  await receipt("GR-2", "2026-03-01", [["RECEIVED", 10, 5]]);
  await receipt("GR-3", "2026-10-01", [["RECEIVED", 30, 6]]);
}, 30000);

describe("productCosts", () => {
  it("uses received goods first, then the cost typed in, then the last purchase order", async () => {
    const costs = await productCosts(db, TODAY);
    expect(costs.get(ids.RECEIVED)).toEqual({ cents: 575, source: "received" });
    expect(costs.get(ids.OLD)).toEqual({ cents: 300, source: "received" });
    expect(costs.get(ids.MANUAL)).toEqual({ cents: 650, source: "manual" });
    // Draft purchase orders aren't prices anyone agreed to.
    expect(costs.get(ids.ORDERED)).toEqual({ cents: 725, source: "ordered" });
    expect(costs.has(ids.NONE)).toBe(false);
  });

  it("can be asked for some products only", async () => {
    const costs = await productCosts(db, TODAY, [ids.MANUAL]);
    expect([...costs.keys()]).toEqual([ids.MANUAL]);
    expect((await productCosts(db, TODAY, [])).size).toBe(0);
  });
});

describe("profitOf", () => {
  it("leaves sales with no cost out of the margin", () => {
    const costs = new Map([["a", { cents: 600, source: "manual" as const }]]);
    const p = profitOf(
      [
        { productId: "a", qty: 2, cents: 2000 },
        { productId: "b", qty: 1, cents: 500 },
        { productId: null, qty: 1, cents: 300 },
      ],
      costs,
    );
    expect(p).toEqual({ soldCents: 2000, costCents: 1200, profitCents: 800, uncostedCents: 800, marginPct: 40 });
  });
});

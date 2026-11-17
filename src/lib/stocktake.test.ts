import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DB } from "./db";
import { schema } from "./db";
import { cartItems, customers, inventoryMovements, products, settings, users } from "./db/schema";
import { getSettings } from "./planning";
import { deliveryDates, placeOrder } from "./shop";
import { stocktake } from "./stocktake";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));

// A stocktake sets stock from what was counted on the shelf, in cartons and loose packs.

let db: DB;
let userId: string;
const stockOf = async (sku: string) => (await db.select({ stock: products.stock }).from(products).where(eq(products.sku, sku)))[0].stock;

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  await db.insert(settings).values({ id: 1, deliveryDays: [0, 1, 2, 3, 4, 5, 6], minOrderCents: 0, deliveryFeeCents: 0 });
  [{ id: userId }] = await db.insert(users).values({ email: "a@x.test", name: "Admin", role: "admin", passwordHash: "x" }).returning({ id: users.id });
  await db.insert(products).values([
    { sku: "BAG", name: "Bin bags", priceCents: 500, stock: 162, unit: "packet", packSize: "8 packets / carton" },
    { sku: "NAP", name: "Napkins", priceCents: 2500, stock: 55, unit: "carton", packSize: "" },
    { sku: "CUP", name: "Cups", priceCents: 400, stock: 100, unit: "sleeve", packSize: "20 sleeves / carton" },
  ]);
}, 30000);

describe("stocktake", () => {
  it("works out the new stock without saving when previewing", async () => {
    const { rows } = await stocktake(db, [{ sku: "bag", count: "20CTN+7P" }], { apply: false });
    expect(rows[0]).toMatchObject({ counted: 167, reserved: 0, newStock: 167, oldStock: 162 });
    expect(await stockOf("BAG")).toBe(162);
  });

  it("saves counts as stock counts in the ledger", async () => {
    const { changed } = await stocktake(db, [{ sku: "BAG", count: "20ctn + 7pk" }, { sku: "NAP", count: "33CTN+10PK" }], { apply: true, by: userId });
    expect(changed).toBe(2);
    expect(await stockOf("BAG")).toBe(167);
    // Sold by the carton: the loose packs can't be kept as stock.
    expect(await stockOf("NAP")).toBe(33);
    const moves = await db.select().from(inventoryMovements).where(eq(inventoryMovements.sku, "BAG"));
    expect(moves.at(-1)).toMatchObject({ movementType: "count", qty: 5, balanceAfter: 167 });
  });

  it("takes off what's already sold but not yet delivered, since it's still on the shelf", async () => {
    const [c] = await db.insert(customers).values({ name: "Cafe", paymentTerms: "prepay" }).returning();
    const [cup] = await db.select().from(products).where(eq(products.sku, "CUP"));
    await db.insert(cartItems).values({ customerId: c.id, productId: cup.id, qty: 30 });
    const s = await getSettings(db);
    await placeOrder(db, c, userId, { idempotencyKey: "k1", method: "bank_transfer", deliveryDate: deliveryDates(s)[0], recipient: "Mei", phone: null, address: "1 Main St", instructions: null, windowStartMin: null, windowEndMin: null, notes: null, useCredit: false }, s, true);
    expect(await stockOf("CUP")).toBe(70);

    // 4 cartons and 5 sleeves on the shelf = 85, of which 30 are the customer's.
    const { rows } = await stocktake(db, [{ sku: "CUP", count: "4ctn+5pk" }], { apply: true, by: userId });
    expect(rows[0]).toMatchObject({ counted: 85, reserved: 30, newStock: 55, short: false });
    expect(await stockOf("CUP")).toBe(55);
  });

  it("reports unknown SKUs, unreadable counts and duplicates without saving them", async () => {
    const { rows, changed } = await stocktake(db, [{ sku: "NOPE", count: "1" }, { sku: "BAG", count: "lots" }, { sku: "NAP", count: "2" }, { sku: "NAP", count: "3" }], { apply: true, by: userId });
    expect(rows.map((r) => r.error ?? "ok")).toEqual(["No product has this SKU", 'Can\'t read "lots"', "ok", "Counted twice in this list"]);
    expect(changed).toBe(1);
    expect(await stockOf("NAP")).toBe(2);
  });
});

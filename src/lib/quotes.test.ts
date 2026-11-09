import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { syncCustomerCodes } from "./customer-code";
import { checkCustomerRow, duplicateCustomers, parseTerms } from "./customer-import";
import { applyCustomerImport } from "./customers";
import type { DB } from "./db";
import { schema } from "./db";
import { customers, products, quoteItems, quotes, users } from "./db/schema";
import { linkQuoteToOrder, quoteEditBlocker, quoteForOrder, quoteWithItems, saveQuote } from "./quotes";
import { createStaffOrder } from "./staff-orders";

let db: DB;
let staff: string;
let cust: string;
let other: string;
let cups: string;
let lids: string;
const today = "2026-11-10";

beforeAll(async () => {
  // Migrate up to just before customer codes, add customers the old way, then run the rest: the
  // customers already there must get codes in the order they were added.
  const before = mkdtempSync(join(tmpdir(), "fp-mig-"));
  cpSync("drizzle", before, { recursive: true });
  const journalPath = join(before, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < "0023");
  writeFileSync(journalPath, JSON.stringify(journal));
  const pg = new PGlite();
  const lite = drizzle(pg, { schema });
  await migrate(lite, { migrationsFolder: before });
  await pg.exec(`
    insert into customers (name, created_at) values ('Second Café', '2026-02-01'), ('First Noodle Bar', '2026-01-01');`);
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;

  [{ id: staff }] = await db.insert(users).values({ email: "office@x.test", name: "Office", role: "admin", passwordHash: "x" }).returning({ id: users.id });
  [{ id: cust }] = await db.insert(customers).values({ name: "Lucky Noodle Bar", paymentTerms: "net14" }).returning({ id: customers.id });
  [{ id: other }] = await db.insert(customers).values({ name: "Sunny Side Café" }).returning({ id: customers.id });
  [{ id: cups }] = await db.insert(products).values({ sku: "CUP8", name: "Cup 8 oz", priceCents: 4000, stock: 5 }).returning({ id: products.id });
  [{ id: lids }] = await db.insert(products).values({ sku: "LID8", name: "Lid 8 oz", priceCents: 2000, stock: 10, gst: false }).returning({ id: products.id });
}, 30000);

const codeOf = async (name: string) => (await db.select({ code: customers.code }).from(customers).where(eq(customers.name, name)))[0]?.code;

describe("customer codes", () => {
  it("numbers existing customers oldest first, and new ones carry on", async () => {
    expect(await codeOf("First Noodle Bar")).toBe("C10001");
    expect(await codeOf("Second Café")).toBe("C10002");
    expect(await codeOf("Lucky Noodle Bar")).toBe("C10003");
    expect(await codeOf("Sunny Side Café")).toBe("C10004");
  });

  it("skips past codes typed in that look like ours", async () => {
    await db.insert(customers).values({ name: "Typed In", code: "C10050" });
    await syncCustomerCodes(db);
    await db.insert(customers).values({ name: "Next One" });
    expect(await codeOf("Next One")).toBe("C10051");
  });

  it("won't give two customers the same code, whatever the case", async () => {
    await db.insert(customers).values({ name: "Old A", code: "LUCKY01" });
    await expect(db.insert(customers).values({ name: "Old B", code: "lucky01" })).rejects.toThrow();
  });
});

describe("customer import", () => {
  it("reads payment terms the way old systems write them", () => {
    expect(["COD", "Prepaid", "0 days", "7 days", "Net 14", "30 days EOM", "月结"].map(parseTerms)).toEqual(["prepay", "prepay", "prepay", "net7", "net14", "net30", "net30"]);
    expect(parseTerms("whenever")).toBeNull();
  });

  it("checks rows and spots the same customer twice", () => {
    expect(checkCustomerRow({ code: "ab 12", name: "X", creditLimit: "$3,000", active: "inactive" })).toEqual({ ok: true, value: { code: "ab-12", name: "X", creditLimitCents: 300000, active: false } });
    expect(checkCustomerRow({ email: "nope" }).ok).toBe(false);
    expect(checkCustomerRow({ name: "X", email: "nope" })).toMatchObject({ ok: false });
    expect([...duplicateCustomers([{ code: "A1" }, { code: "a1" }, { name: "Shop" }, { name: " shop " }]).entries()]).toEqual([
      [1, 0],
      [3, 2],
    ]);
  });

  it("updates by code, matches by name without one, and adds the rest", async () => {
    const { result } = await applyCustomerImport(db, [
      { code: "LUCKY01", phone: "0400 111 222", paymentTerms: "30 days" },
      { name: "sunny side café", email: "hi@sunny.test" },
      { code: "OLD-77", name: "Golden Dragon", paymentTerms: "COD" },
      { name: "Brand New Bakery" },
    ]);
    expect(result).toEqual({ created: 2, updated: 2, errors: [] });
    const all = await db.select().from(customers).orderBy(asc(customers.code));
    const by = (name: string) => all.find((c) => c.name === name)!;
    expect(by("Old A")).toMatchObject({ code: "LUCKY01", phone: "0400 111 222", paymentTerms: "net30" });
    expect(by("Sunny Side Café")).toMatchObject({ code: "C10004", email: "hi@sunny.test" });
    expect(by("Golden Dragon")).toMatchObject({ code: "OLD-77", paymentTerms: "prepay", salesStage: "won", approved: true });
    expect(by("Brand New Bakery").code).toMatch(/^C1005\d$/);
  });

  it("saves nothing when a row is wrong", async () => {
    const before = (await db.select().from(customers)).length;
    const { result } = await applyCustomerImport(db, [{ name: "Fine" }, { code: "NEW-1" }, { name: "Bad", paymentTerms: "someday" }]);
    expect(result.errors.map((e) => e.row)).toEqual([3, 4]);
    expect((await db.select().from(customers)).length).toBe(before);
  });
});

describe("quotes", () => {
  let quoteId: string;

  it("makes a numbered quote with the prices offered", async () => {
    const q = await saveQuote(
      db,
      staff,
      null,
      { customerId: cust, validUntil: "2026-12-10", deliveryFeeCents: 1500, notes: "Prices held 30 days", internalNote: null, lines: [{ productId: lids, qty: 2, unitPriceCents: 1800 }, { productId: cups, qty: 3, unitPriceCents: 3500 }, { productId: lids, qty: 1, unitPriceCents: 1800 }] },
      today,
    );
    quoteId = q.id;
    expect(q).toMatchObject({ number: "QT-10001", status: "draft", subtotalCents: 3 * 1800 + 3 * 3500, deliveryFeeCents: 1500, gstCents: Math.round((3 * 3500 + 1500) * 0.1) });
    const { items } = (await quoteWithItems(db, q.id))!;
    // Same product twice is one line; lines keep the order they were added in.
    expect(items.map((it) => [it.sku, it.qty, it.position])).toEqual([
      ["LID8", 3, 0],
      ["CUP8", 3, 1],
    ]);
    // A quote reserves nothing.
    expect((await db.select({ s: products.stock }).from(products).where(eq(products.id, cups)))[0].s).toBe(5);
  });

  it("can be changed, but not moved to another customer or dated in the past", async () => {
    const input = { customerId: cust, validUntil: "2026-12-10", deliveryFeeCents: 0, notes: null, internalNote: "Call Mei", lines: [{ productId: cups, qty: 10, unitPriceCents: 3400 }] };
    const q = await saveQuote(db, staff, quoteId, input, today);
    expect(q).toMatchObject({ number: "QT-10001", subtotalCents: 34000, internalNote: "Call Mei" });
    expect((await db.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId))).length).toBe(1);
    await expect(saveQuote(db, staff, quoteId, { ...input, customerId: other }, today)).rejects.toThrow(/stays with its customer/);
    await expect(saveQuote(db, staff, null, { ...input, validUntil: "2026-11-01" }, today)).rejects.toThrow(/past/);
    await expect(saveQuote(db, staff, null, { ...input, lines: [] }, today)).rejects.toThrow(/at least one product/);
  });

  it("becomes one sales order, then can't be changed", async () => {
    await expect(quoteForOrder(db, quoteId, other, "k1")).rejects.toThrow(/different customer/);
    await quoteForOrder(db, quoteId, cust, "k1");
    const so = await createStaffOrder(
      db,
      staff,
      { customerId: cust, deliveryDate: "2026-11-12", recipient: "Mei", phone: null, address: "1 Main St", instructions: null, windowStartMin: null, windowEndMin: null, notes: "From quote QT-10001", deliveryFeeCents: 0, lines: [{ productId: cups, qty: 10, unitPriceCents: 3400 }], method: "invoice", idempotencyKey: "k1" },
      today,
    );
    await linkQuoteToOrder(db, quoteId, so.id);
    const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
    expect(q).toMatchObject({ status: "accepted", salesOrderId: so.id });
    expect(q.acceptedAt).toBeInstanceOf(Date);
    expect(quoteEditBlocker(q)).toMatch(/sales order/);
    // A retry of the same order is fine; a second, different order isn't.
    await expect(quoteForOrder(db, quoteId, cust, "k1")).resolves.toBeTruthy();
    await expect(quoteForOrder(db, quoteId, cust, "k2")).rejects.toThrow(/already become order FP-/);
    await expect(saveQuote(db, staff, quoteId, { customerId: cust, validUntil: "2026-12-10", deliveryFeeCents: 0, notes: null, internalNote: null, lines: [{ productId: cups, qty: 1, unitPriceCents: 1 }] }, today)).rejects.toThrow(/sales order/);
  });
});

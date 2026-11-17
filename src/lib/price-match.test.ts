import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { addToList, customerList } from "./customer-list";
import { type DB, schema } from "./db";
import { customerPrices, customers, favourites, priceMatches, products, settings, users } from "./db/schema";
import { decidePriceMatch, pendingMatches, savePriceMatch, savingsLines, withdrawPriceMatch } from "./price-match";

let db: DB;
let rep: { id: string; role: string };
let office: { id: string; role: string };
const today = "2026-11-17";

const product = async (sku: string, priceCents: number, costCents: number | null) =>
  (await db.insert(products).values({ sku, name: `Product ${sku}`, priceCents, costCents }).returning())[0];
const customer = async (name: string) => (await db.insert(customers).values({ name }).returning())[0];
const priceOf = async (customerId: string, productId: string) =>
  (await db.select().from(customerPrices).where(and(eq(customerPrices.customerId, customerId), eq(customerPrices.productId, productId))))[0]?.priceCents ?? null;

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  const [r] = await db.insert(users).values({ email: "rep@test", name: "Rita Rep", passwordHash: "x", role: "sales" }).returning();
  const [o] = await db.insert(users).values({ email: "office@test", name: "Olly Office", passwordHash: "x", role: "admin" }).returning();
  rep = { id: r.id, role: "sales" };
  office = { id: o.id, role: "admin" };
}, 30000);

describe("savePriceMatch", () => {
  it("gives a salesperson's price straight away within the margin floor, and lists the product", async () => {
    // Cost $17, 15% minimum margin: down to $20.00 on their own.
    const p = await product("PM-1", 2500, 1700);
    const c = await customer("Floor Cafe");
    const r = await savePriceMatch(db, rep, { customerId: c.id, productId: p.id, competitorCents: 2100, competitor: "Other Co", priceCents: 2000, monthlyQty: 10 }, today);
    expect(r.pending).toBe(false);
    expect(await priceOf(c.id, p.id)).toBe(2000);
    const [fav] = await db.select().from(favourites).where(eq(favourites.customerId, c.id));
    expect(fav).toMatchObject({ productId: p.id, addedBy: rep.id });
  });

  it("sends a price under the floor to the office, and the customer keeps their price until it's approved", async () => {
    const p = await product("PM-2", 2500, 1700);
    const c = await customer("Low Price Deli");
    const r = await savePriceMatch(db, rep, { customerId: c.id, productId: p.id, competitorCents: 1950, priceCents: 1950 }, today);
    expect(r.pending).toBe(true);
    expect(await priceOf(c.id, p.id)).toBeNull();
    expect((await pendingMatches(db)).some((m) => m.id === r.match.id)).toBe(true);

    await decidePriceMatch(db, office, r.match.id, true);
    expect(await priceOf(c.id, p.id)).toBe(1950);
    await expect(decidePriceMatch(db, office, r.match.id, false)).rejects.toThrow("already decided");
  });

  it("asks the office when the cost isn't known", async () => {
    const p = await product("PM-3", 2500, null);
    const c = await customer("No Cost Bar");
    const r = await savePriceMatch(db, rep, { customerId: c.id, productId: p.id, competitorCents: 2400, priceCents: 2400 }, today);
    expect(r.pending).toBe(true);
  });

  it("never holds up the office", async () => {
    const p = await product("PM-4", 2500, 1700);
    const c = await customer("Office Matched");
    const r = await savePriceMatch(db, office, { customerId: c.id, productId: p.id, competitorCents: 1500, priceCents: 1500 }, today);
    expect(r.pending).toBe(false);
    expect(await priceOf(c.id, p.id)).toBe(1500);
  });

  it("replaces an earlier offer still waiting for the same product", async () => {
    const p = await product("PM-5", 2500, 1700);
    const c = await customer("Second Offer");
    const first = await savePriceMatch(db, rep, { customerId: c.id, productId: p.id, competitorCents: 1900, priceCents: 1900 }, today);
    await savePriceMatch(db, rep, { customerId: c.id, productId: p.id, competitorCents: 1900, priceCents: 1950 }, today);
    const rows = await db.select().from(priceMatches).where(eq(priceMatches.customerId, c.id));
    expect(rows.map((m) => m.priceCents)).toEqual([1950]);
    await expect(withdrawPriceMatch(db, rep, first.match.id)).rejects.toThrow("not found");
  });

  it("turned down: no price for the customer", async () => {
    const p = await product("PM-6", 2500, 1700);
    const c = await customer("Turned Down");
    const r = await savePriceMatch(db, rep, { customerId: c.id, productId: p.id, competitorCents: 1000, priceCents: 1000 }, today);
    await decidePriceMatch(db, office, r.match.id, false);
    expect(await priceOf(c.id, p.id)).toBeNull();
    await expect(decidePriceMatch(db, rep, r.match.id, true)).rejects.toThrow("Only the office");
  });

  it("rejects nonsense amounts", async () => {
    const p = await product("PM-7", 2500, 1700);
    const c = await customer("Bad Input");
    await expect(savePriceMatch(db, rep, { customerId: c.id, productId: p.id, competitorCents: 0, priceCents: 2000 }, today)).rejects.toThrow("what they pay now");
    await expect(savePriceMatch(db, rep, { customerId: c.id, productId: p.id, competitorCents: 2000, priceCents: 2000, monthlyQty: 1.5 }, today)).rejects.toThrow("whole number");
  });
});

describe("savingsLines", () => {
  it("lists approved matches where we're no dearer, at today's price", async () => {
    const cheap = await product("SV-1", 2500, 1700);
    const dear = await product("SV-2", 1000, 500);
    const c = await customer("Savings Sheet");
    await savePriceMatch(db, rep, { customerId: c.id, productId: cheap.id, competitorCents: 2600, priceCents: 2200, monthlyQty: 5 }, today);
    // They already pay less than our list price, and we offered the list price: not on the sheet.
    await savePriceMatch(db, rep, { customerId: c.id, productId: dear.id, competitorCents: 900, priceCents: 1000 }, today);
    // Matched: same price, still on the sheet.
    const same = await product("SV-3", 1500, 1000);
    await savePriceMatch(db, rep, { customerId: c.id, productId: same.id, competitorCents: 1400, priceCents: 1400 }, today);
    const lines = await savingsLines(db, c.id);
    expect(lines.map((l) => l.sku)).toEqual(["SV-1", "SV-3"]);
    expect(lines[0]).toMatchObject({ competitorCents: 2600, ourCents: 2200, monthlyQty: 5 });
    expect(lines[1]).toMatchObject({ competitorCents: 1400, ourCents: 1400 });
  });
});

describe("customer list", () => {
  it("adds products with a usual quantity, keeps it on a second add without one", async () => {
    const p = await product("CL-1", 1200, 600);
    const c = await customer("List Shop");
    await addToList(db, rep, c.id, [{ productId: p.id, qty: 6 }]);
    await addToList(db, rep, c.id, [{ productId: p.id, qty: null }]);
    const [item] = await customerList(db, c.id);
    expect(item).toMatchObject({ sku: "CL-1", qty: 6, priceCents: 1200, addedByName: "Rita Rep", byCustomer: false });
    await expect(addToList(db, rep, c.id, [{ productId: p.id, qty: 0 }])).rejects.toThrow("Quantity");
  });
});

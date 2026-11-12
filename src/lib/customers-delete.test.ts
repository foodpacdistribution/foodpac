import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { applyCustomerImport, removeCustomer } from "./customers";
import { type DB, schema } from "./db";
import { customerCreditAccounts, customers, quotes } from "./db/schema";

let db: DB;
const add = async (name: string, extra: Partial<typeof customers.$inferInsert> = {}) =>
  (await db.insert(customers).values({ name, ...extra }).returning())[0];
const quoteFor = (customerId: string, number: string) =>
  db.insert(quotes).values({ number, customerId, validUntil: "2026-12-01", subtotalCents: 1000, deliveryFeeCents: 0, gstCents: 100, totalCents: 1100 });

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
}, 30000);

describe("removeCustomer", () => {
  it("deletes a customer who only has quotes, and their quotes", async () => {
    const c = await add("Quoted Only");
    await quoteFor(c.id, "Q-T1");
    await quoteFor(c.id, "Q-T2");
    expect(await removeCustomer(db, c.id)).toEqual({ name: "Quoted Only", quotes: 2 });
    expect(await db.select().from(customers).where(eq(customers.id, c.id))).toEqual([]);
    expect(await db.select().from(quotes).where(eq(quotes.customerId, c.id))).toEqual([]);
  });

  it("keeps a customer with store credit, and says why", async () => {
    const c = await add("Has Credit");
    await db.insert(customerCreditAccounts).values({ customerId: c.id });
    await expect(removeCustomer(db, c.id)).rejects.toThrow("store credit");
    expect(await db.select().from(customers).where(eq(customers.id, c.id))).toHaveLength(1);
  });

  it("says when the customer is already gone", async () => {
    await expect(removeCustomer(db, "00000000-0000-0000-0000-000000000000")).rejects.toThrow("Customer not found");
  });
});

describe("applyCustomerImport with a sales stage", () => {
  it("puts new and existing customers in the chosen stage", async () => {
    const won = await add("Sushi Stage Test", { salesStage: "won" });
    const { result } = await applyCustomerImport(db, [{ name: "sushi stage test", phone: "0400 000 001" }, { name: "Brand New Sushi" }], { stage: "new" });
    expect(result).toMatchObject({ created: 1, updated: 1, errors: [] });
    const [before] = await db.select().from(customers).where(eq(customers.id, won.id));
    expect(before).toMatchObject({ salesStage: "new", phone: "0400 000 001" });
    const [made] = await db.select().from(customers).where(eq(customers.name, "Brand New Sushi"));
    expect(made.salesStage).toBe("new");
  });

  it("finds a customer by name when the file's code is new to the system, keeping its code", async () => {
    const c = await add("Code Later Sushi", { code: "C-KEEP" });
    const { result } = await applyCustomerImport(db, [{ code: "OLDSYS1", name: "Code Later Sushi", email: "a@b.test" }]);
    expect(result).toMatchObject({ created: 0, updated: 1 });
    const [after] = await db.select().from(customers).where(eq(customers.id, c.id));
    expect(after).toMatchObject({ code: "C-KEEP", email: "a@b.test" });
    expect(await db.select().from(customers).where(eq(customers.name, "Code Later Sushi"))).toHaveLength(1);
  });
});

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { customerList } from "./customer-list";
import { type DB, schema } from "./db";
import { cartItems, customerPrices, customers, products, settings } from "./db/schema";
import { getCart, getProductBySku, listCatalog } from "./shop";

// The shop's prices are the back office's: the product's price, unless that customer has their own.

let db: DB;
let productId: string;
let plain: typeof customers.$inferSelect;
let special: typeof customers.$inferSelect;

const prices = async (c: typeof customers.$inferSelect) => {
  const [inCatalog] = (await listCatalog(db, c, { limit: 50 })).filter((p) => p.id === productId);
  const page = await getProductBySku(db, c, "FP-9001");
  const [inCart] = await getCart(db, c);
  return { catalog: inCatalog.priceCents, page: page?.priceCents, cart: inCart.priceCents, cartLine: inCart.lineCents };
};

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  const [p] = await db.insert(products).values({ sku: "FP-9001", name: "Aloe drink 500ml", unit: "carton", priceCents: 1565, stock: 50 }).returning();
  productId = p.id;
  [plain, special] = await db
    .insert(customers)
    .values([
      { name: "Plain Cafe", approved: true },
      { name: "Special Cafe", approved: true },
    ])
    .returning();
  await db.insert(customerPrices).values({ customerId: special.id, productId, priceCents: 1400 });
  await db.insert(cartItems).values([
    { customerId: plain.id, productId, qty: 2 },
    { customerId: special.id, productId, qty: 2 },
  ]);
});

describe("shop prices", () => {
  it("shows the back office price everywhere, and a customer's own price only to them", async () => {
    expect(await prices(plain)).toEqual({ catalog: 1565, page: 1565, cart: 1565, cartLine: 3130 });
    expect(await prices(special)).toEqual({ catalog: 1400, page: 1400, cart: 1400, cartLine: 2800 });
    expect((await customerList(db, plain.id)).length).toBe(0);
  });

  it("follows a price changed in the back office straight away (the customer's own price stays)", async () => {
    await db.update(products).set({ priceCents: 1720 }).where(eq(products.id, productId));
    expect(await prices(plain)).toEqual({ catalog: 1720, page: 1720, cart: 1720, cartLine: 3440 });
    expect((await prices(special)).catalog).toBe(1400);
  });

  it("goes back to the back office price when a customer's own price is removed", async () => {
    await db.delete(customerPrices).where(eq(customerPrices.customerId, special.id));
    expect(await prices(special)).toEqual({ catalog: 1720, page: 1720, cart: 1720, cartLine: 3440 });
  });

  it("shows no price before the account is approved", async () => {
    const [waiting] = await db.insert(customers).values({ name: "New Cafe", approved: false }).returning();
    expect((await listCatalog(db, waiting, { limit: 50 })).find((p) => p.id === productId)?.priceCents).toBeNull();
  });
});

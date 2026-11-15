import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "@/lib/db";
import { customers, products, salesOrders, settings, users } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { deliveryDates } from "@/lib/shop";

// Sales staff quoting and taking orders on the spot, for their own customers only.

const state = { db: null as unknown as DB, user: null as unknown as { id: string; role: string } };
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", async (orig) => {
  const real = await orig<typeof import("@/lib/auth/dal")>();
  return {
    ...real,
    assertUser: async (roles: string[]) => {
      if (!roles.includes(state.user.role)) throw new real.AuthError("Not authorised");
      return state.user;
    },
  };
});
vi.mock("@/lib/customer-locations", () => ({ locateCustomersLater: () => {} }));
vi.mock("@/lib/geo/geocode", () => ({ geocodeOrderIds: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const { saveQuote, setQuoteStatus } = await import("./quotes");
const { createOrderForCustomer, markPaid } = await import("./sales");
const { loadPipeline } = await import("@/lib/pipeline");

let sam: string;
let kim: string;
let mine: string;
let theirs: string;
let nobodys: string;
let cups: string;
let key = 0;

const rep = async (id: string) => (await state.db.select({ rep: customers.salesRepId }).from(customers).where(eq(customers.id, id)))[0].rep;
const quote = (customerId: string) => saveQuote(null, { customerId, validUntil: "2099-01-01", deliveryFee: "0", notes: "", internalNote: "", lines: [{ productId: cups, qty: 2, unitPrice: "50" }] });
const order = async (customerId: string) =>
  createOrderForCustomer({
    customerId,
    method: "invoice",
    deliveryDate: deliveryDates(await getSettings(state.db))[0],
    recipient: "Mei",
    phone: "",
    address: "1 Main St",
    instructions: "",
    windowStart: "",
    windowEnd: "",
    notes: "",
    deliveryFee: "0",
    lines: [{ productId: cups, qty: 2, unitPrice: "50" }],
    emailCustomer: false,
    idempotencyKey: `k${++key}`,
  });

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  state.db = lite as unknown as DB;
  await state.db.insert(settings).values({ id: 1, deliveryDays: [0, 1, 2, 3, 4, 5, 6], minOrderCents: 0 });
  [{ id: sam }, { id: kim }] = await state.db
    .insert(users)
    .values([
      { email: "sam@x.test", name: "Sam", role: "sales", passwordHash: "x" },
      { email: "kim@x.test", name: "Kim", role: "sales", passwordHash: "x" },
    ])
    .returning();
  [{ id: mine }, { id: theirs }, { id: nobodys }] = await state.db
    .insert(customers)
    .values([
      { name: "Sam's Shop", salesRepId: sam },
      { name: "Kim's Shop", salesRepId: kim },
      { name: "Nobody's Shop" },
    ])
    .returning();
  [{ id: cups }] = await state.db.insert(products).values({ sku: "CUP8", name: "Cup 8 oz", priceCents: 5000, stock: 1000 }).returning();
  state.user = { id: sam, role: "sales" };
}, 30000);

describe("sales staff quoting and taking orders", () => {
  it("quote and order for their own customers", async () => {
    expect(await quote(mine)).toMatchObject({ ok: true });
    expect(await order(mine)).toMatchObject({ ok: true });
  });

  it("take on an unassigned customer by quoting for it", async () => {
    expect(await quote(nobodys)).toMatchObject({ ok: true });
    expect(await rep(nobodys)).toBe(sam);
  });

  it("can't work on another salesperson's customer", async () => {
    expect(await quote(theirs)).toMatchObject({ ok: false, error: expect.stringContaining("Another salesperson") });
    expect(await order(theirs)).toMatchObject({ ok: false, error: expect.stringContaining("Another salesperson") });
    state.user = { id: kim, role: "sales" };
    const r = await quote(theirs);
    state.user = { id: sam, role: "sales" };
    expect(await setQuoteStatus((r as { data: { id: string } }).data.id, "declined")).toMatchObject({ ok: false });
  });

  it("leave payments and the rest of an order to the office", async () => {
    const r = await order(mine);
    expect(await markPaid((r as { data: { id: string } }).data.id, true)).toMatchObject({ ok: false });
  });
});

describe("buying less, from real orders", () => {
  it("spots a regular product a customer stopped buying", async () => {
    // Cups every two weeks from June to early September, then only other things.
    const lids = (await state.db.insert(products).values({ sku: "LID8", name: "Lid 8 oz", priceCents: 1000, stock: 1000 }).returning())[0].id;
    const days = ["2026-06-01", "2026-06-15", "2026-06-29", "2026-07-13", "2026-07-27", "2026-08-10", "2026-08-24", "2026-09-07"];
    const [c] = await state.db.insert(customers).values({ name: "Drifting Cafe", salesStage: "won" }).returning();
    state.user = { id: sam, role: "admin" };
    for (const d of days) {
      const r = (await order(c.id)) as { data: { id: string } };
      await state.db.update(salesOrders).set({ createdAt: new Date(`${d}T02:00:00Z`) }).where(eq(salesOrders.id, r.data.id));
    }
    const recent = (await createOrderForCustomer({
      customerId: c.id,
      method: "invoice",
      deliveryDate: deliveryDates(await getSettings(state.db))[0],
      recipient: "Mei",
      phone: "",
      address: "1 Main St",
      instructions: "",
      windowStart: "",
      windowEnd: "",
      notes: "",
      deliveryFee: "0",
      lines: [{ productId: lids, qty: 2, unitPrice: "10" }],
      emailCustomer: false,
      idempotencyKey: `k${++key}`,
    })) as { data: { id: string } };
    expect(recent).toMatchObject({ ok: true });
    const { customers: list } = await loadPipeline(state.db);
    expect(list.find((x) => x.id === c.id)?.due).toMatchObject({ kind: "slipping", product: "Cup 8 oz", everyDays: 14 });
  });
});

import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "@/lib/db";
import { creditBalance } from "@/lib/credit";
import { customers, users } from "@/lib/db/schema";

const state = { db: null as unknown as DB, user: null as unknown as { id: string; role: string } };
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", async (orig) => {
  const real = await orig<typeof import("@/lib/auth/dal")>();
  return {
    ...real,
    // Like the real one: the signed-in user, if their role may do this.
    assertUser: async (roles: string[]) => {
      if (!roles.includes(state.user.role)) throw new real.AuthError("Not authorised");
      return state.user;
    },
  };
});
vi.mock("@/lib/customer-locations", () => ({ locateCustomersLater: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const { saveCustomer, removeCustomerLogin } = await import("./customers");
const { openCustomerAccount } = await import("./pipeline");
const { adjustCustomerCredit } = await import("./customer-returns");

let customerId: string;
let salesId: string;

const formOf = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const row = async () => (await state.db.select().from(customers).where(eq(customers.id, customerId)))[0];

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  state.db = lite as unknown as DB;
  [{ id: salesId }] = await state.db.insert(users).values({ email: "sam@sales.test", name: "Sam", role: "sales", passwordHash: "x" }).returning();
}, 30000);

beforeEach(async () => {
  await state.db.delete(users).where(eq(users.role, "customer"));
  // Store credit history can't be deleted, so customers that have some stay, out of the way.
  await state.db.delete(customers).where(sql`${customers.id} not in (select customer_id from customer_credit_accounts)`);
  await state.db.update(customers).set({ name: sql`'gone ' || ${customers.id}`, code: sql`'X' || ${customers.id}` });
  [{ id: customerId }] = await state.db
    .insert(customers)
    .values({ code: "C900", name: "Old Name", paymentTerms: "net30", creditLimitCents: 500000, approved: false, active: true, salesStage: "interested" })
    .returning();
});

describe("saveCustomer by sales staff", () => {
  beforeEach(() => {
    state.user = { id: salesId, role: "sales" };
  });

  it("changes the details, stage and portal login", async () => {
    const r = await saveCustomer(
      null,
      formOf({ id: customerId, name: "New Name", phone: "0400 000 000", address: "1 Test St, Sunnybank QLD 4109", salesStage: "won", loginEmail: "Shop@Example.com", loginName: "Amy", password: "secret123" }),
    );
    expect(r).toMatchObject({ ok: true });
    expect(await row()).toMatchObject({ name: "New Name", phone: "0400 000 000", address: "1 Test St, Sunnybank QLD 4109", salesStage: "won", salesRepId: salesId });
    const [login] = await state.db.select().from(users).where(eq(users.customerId, customerId));
    expect(login).toMatchObject({ email: "shop@example.com", name: "Amy", role: "customer" });

    // And can remove it again.
    expect(await removeCustomerLogin(customerId)).toMatchObject({ ok: true });
    expect(await state.db.select().from(users).where(eq(users.customerId, customerId))).toEqual([]);
  });

  it("sets terms, credit limit and approval, but not the code or switching it off", async () => {
    await saveCustomer(null, formOf({ id: customerId, name: "Old Name", code: "C1", paymentTerms: "net14", creditLimit: "2500", approved: "on" }));
    // "active" missing from the form would otherwise switch the customer off.
    expect(await row()).toMatchObject({ code: "C900", paymentTerms: "net14", creditLimitCents: 250000, approved: true, active: true });
  });

  it("adds customers, who are theirs to look after", async () => {
    expect(await saveCustomer(null, formOf({ name: "Brand New", paymentTerms: "prepay", approved: "on" }))).toMatchObject({ ok: true });
    const [c] = await state.db.select().from(customers).where(eq(customers.name, "Brand New"));
    expect(c).toMatchObject({ salesRepId: salesId, approved: true, active: true });
  });
});

describe("saveCustomer by the office", () => {
  it("still changes everything", async () => {
    state.user = { id: salesId, role: "admin" };
    await saveCustomer(null, formOf({ id: customerId, name: "Old Name", code: "C901", paymentTerms: "prepay", creditLimit: "100", approved: "on", active: "on" }));
    expect(await row()).toMatchObject({ code: "C901", paymentTerms: "prepay", creditLimitCents: 10000, approved: true, active: true });
  });
});

describe("opening an account once a store signs", () => {
  beforeEach(() => {
    state.user = { id: salesId, role: "sales" };
  });

  it("sets up a new store ready to order: login, terms, limit and starting credit", async () => {
    const r = await openCustomerAccount(
      null,
      formOf({
        name: "Golden Dumpling",
        abn: "12 345 678 901",
        phone: "0411 222 333",
        email: "Owner@Golden.test",
        address: "5 Market St, Sunnybank QLD 4109",
        loginEmail: "owner@golden.test",
        loginName: "Lily",
        password: "dumpling88",
        paymentTerms: "net14",
        creditLimit: "3000",
        startingCredit: "150",
        creditReason: "Welcome credit",
      }),
    );
    expect(r).toMatchObject({ ok: true, data: { name: "Golden Dumpling", login: { email: "owner@golden.test", password: "dumpling88" }, creditBalance: 150 } });
    const [c] = await state.db.select().from(customers).where(eq(customers.name, "Golden Dumpling"));
    expect(c).toMatchObject({ approved: true, active: true, salesStage: "won", salesRepId: salesId, paymentTerms: "net14", creditLimitCents: 300000, email: "owner@golden.test", abn: "12 345 678 901" });
    const [login] = await state.db.select().from(users).where(eq(users.customerId, c.id));
    expect(login).toMatchObject({ email: "owner@golden.test", name: "Lily", role: "customer" });
    expect(await creditBalance(state.db, c.id)).toBe(150);
  });

  it("finishes a lead already on the pipeline, without a login if they order through the rep", async () => {
    const r = await openCustomerAccount(null, formOf({ id: customerId, name: "Old Name", paymentTerms: "prepay", creditLimit: "999" }));
    expect(r).toMatchObject({ ok: true, data: { login: null, creditBalance: null } });
    // Pay up front has no credit limit.
    expect(await row()).toMatchObject({ approved: true, salesStage: "won", salesRepId: salesId, paymentTerms: "prepay", creditLimitCents: null });
    expect(await state.db.select().from(users).where(eq(users.customerId, customerId))).toEqual([]);
  });

  it("saves nothing when part of it is wrong", async () => {
    const r = await openCustomerAccount(null, formOf({ name: "Half Done", paymentTerms: "net30", loginEmail: "x@half.test", password: "short" }));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("8 characters") });
    expect(await state.db.select().from(customers).where(eq(customers.name, "Half Done"))).toEqual([]);
  });

  it("won't make a second customer with the same name", async () => {
    expect(await openCustomerAccount(null, formOf({ name: "old name", paymentTerms: "prepay" }))).toMatchObject({ ok: false, error: expect.stringContaining("already a customer") });
  });

  it("lets sales staff give and take back store credit, but not dispatchers", async () => {
    expect(await adjustCustomerCredit(null, formOf({ customerId, kind: "manual_credit", amount: "80", reason: "To order with" }))).toMatchObject({ ok: true });
    expect(await adjustCustomerCredit(null, formOf({ customerId, kind: "credit_reversal", amount: "30", reason: "Typo" }))).toMatchObject({ ok: true });
    expect(await creditBalance(state.db, customerId)).toBe(50);
    state.user = { id: salesId, role: "dispatcher" };
    expect(await adjustCustomerCredit(null, formOf({ customerId, kind: "manual_credit", amount: "5", reason: "x" }))).toMatchObject({ ok: false });
  });
});

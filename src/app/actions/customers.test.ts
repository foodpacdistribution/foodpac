import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "@/lib/db";
import { customers, users } from "@/lib/db/schema";

const state = { db: null as unknown as DB, user: null as unknown as { id: string; role: string } };
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/dal")>()), assertUser: async () => state.user }));
vi.mock("@/lib/customer-locations", () => ({ locateCustomersLater: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const { saveCustomer, removeCustomerLogin } = await import("./customers");

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
  await state.db.delete(customers);
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

  it("can't change the office's fields, whatever the form sends", async () => {
    await saveCustomer(null, formOf({ id: customerId, name: "Old Name", code: "C1", paymentTerms: "prepay", creditLimit: "99999", approved: "on" }));
    // "active" missing from the form would otherwise switch the customer off.
    expect(await row()).toMatchObject({ code: "C900", paymentTerms: "net30", creditLimitCents: 500000, approved: false, active: true });
  });

  it("can't add customers here", async () => {
    expect(await saveCustomer(null, formOf({ name: "Brand New" }))).toMatchObject({ ok: false, error: expect.stringContaining("Sales Pipeline") });
  });
});

describe("saveCustomer by the office", () => {
  it("still changes everything", async () => {
    state.user = { id: salesId, role: "admin" };
    await saveCustomer(null, formOf({ id: customerId, name: "Old Name", code: "C901", paymentTerms: "prepay", creditLimit: "100", approved: "on", active: "on" }));
    expect(await row()).toMatchObject({ code: "C901", paymentTerms: "prepay", creditLimitCents: 10000, approved: true, active: true });
  });
});
